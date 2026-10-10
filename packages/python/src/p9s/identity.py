"""What a transaction needs to act as an application user: the database role the policies are for, and the setting the
current user function of the migration reads, from ``engine.authentication`` of the config of p9s. Both are set with
``set_config(..., true)``, so that they end with the transaction, and a pooled connection never keeps the identity of a
previous request."""

from __future__ import annotations

import json
from os import PathLike
from typing import Any, Mapping, Union

UserId = Union[int, str, None]
Settings = Mapping[str, Union[str, int, bool, None]]


def _text(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "on" if value else "off"
    return str(value)


class Identity:
    """The role and the setting of the config, like ``createIdentity`` of ``@p9s/postgres``."""

    def __init__(self, config: Mapping[str, Any], *, setting: str | None = None, claim: str | None = None):
        engine = config.get("engine") or {}
        authentication = engine.get("authentication") or {}
        users = list(engine.get("users") or [])
        if not users:
            raise ValueError("p9s: engine.users is empty")
        self.setting: str = setting or authentication.get("setting") or ""
        if not self.setting:
            raise ValueError(
                'p9s: set engine.authentication.setting, like "app.user_id", for the migration to read the current user '
                "from it, or pass the setting the current user function reads"
            )
        # The claim of the setting, when it holds JSON claims, like request.jwt.claims of PostgREST
        self.claim: str | None = claim if claim is not None else (authentication.get("claim") if setting is None else None)
        self.role: str = users[0]
        self.roles = frozenset([*users, *(engine.get("graphWriters") or [])])

    @classmethod
    def from_file(cls, path: str | PathLike[str], **options: Any) -> Identity:
        """Reads the identity from p9s.config.json."""
        with open(path, encoding="utf-8") as file:
            return cls(json.load(file), **options)

    def value(self, user_id: UserId) -> str:
        if user_id is None:
            return ""
        if self.claim:
            return json.dumps({self.claim: str(user_id)}, separators=(",", ":"))
        return str(user_id)

    def settings(
        self, user_id: UserId, *, role: str | None = None, settings: Settings | None = None, read_only: bool = False
    ) -> list[tuple[str, str]]:
        """The settings of a transaction of the user, as (name, value) pairs, the role first, with
        ``transaction_read_only`` for a read only transaction, which Postgres takes even after the transaction has run a
        statement. No user reads as no one."""
        chosen = role or self.role
        if chosen not in self.roles:
            raise ValueError(f"p9s: {chosen} is not a role of engine.users or engine.graphWriters")
        return [
            ("role", chosen),
            (self.setting, self.value(user_id)),
            *((name, _text(value)) for name, value in (settings or {}).items()),
            *([("transaction_read_only", "on")] if read_only else []),
        ]

    def statement(
        self, user_id: UserId, *, role: str | None = None, settings: Settings | None = None, read_only: bool = False
    ) -> tuple[str, dict[str, str]]:
        """The statement to run first in a transaction, with named parameters:
        ``select set_config(%(name_0)s, %(value_0)s, true), ...``"""
        pairs = self.settings(user_id, role=role, settings=settings, read_only=read_only)
        text = "select " + ", ".join(f"set_config(%(name_{i})s, %(value_{i})s, true)" for i in range(len(pairs)))
        params: dict[str, str] = {}
        for i, (name, value) in enumerate(pairs):
            params[f"name_{i}"] = name
            params[f"value_{i}"] = value
        return text, params


def is_refused(error: BaseException | None) -> bool:
    """Whether an error is Postgres refusing a statement to the user, with insufficient_privilege (42501): a row the
    policies do not let through, a statement the role has no privilege for, or a share of bits the user does not have.
    psycopg gives it as ``sqlstate``, psycopg2 as ``pgcode``, SQLAlchemy wraps it in ``orig``, Django in ``__cause__``."""
    current: object = error
    for _ in range(8):
        if current is None:
            return False
        if getattr(current, "sqlstate", None) == "42501" or getattr(current, "pgcode", None) == "42501":
            return True
        current = getattr(current, "orig", None) or getattr(current, "__cause__", None)
    return False
