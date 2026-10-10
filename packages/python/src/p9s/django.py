"""Django: ``as_user`` runs a block in a transaction as the user, ``as_request_user`` a view, and ``P9sMiddleware``
every request.

Settings:

- ``P9S_CONFIG``: the path of p9s.config.json
- ``P9S_USER_ID``: the dotted path of a function of the request that returns the id of its user, or None.
  ``request.user.pk`` of signed in users by default.
"""

from __future__ import annotations

import functools
from contextlib import contextmanager
from typing import Any, Callable, Iterator

from django.conf import settings as django_settings
from django.db import connections, transaction
from django.utils.module_loading import import_string

from .identity import Identity, Settings, UserId


@functools.lru_cache(maxsize=None)
def _identity_of(path: str) -> Identity:
    return Identity.from_file(path)


def default_identity() -> Identity:
    """The identity of the config ``P9S_CONFIG`` names."""
    return _identity_of(str(django_settings.P9S_CONFIG))


def _default_user_id(request: Any) -> UserId:
    user = getattr(request, "user", None)
    return user.pk if user is not None and user.is_authenticated else None


def user_id_of(request: Any) -> UserId:
    path = getattr(django_settings, "P9S_USER_ID", None)
    return (import_string(path) if path else _default_user_id)(request)


@contextmanager
def as_user(
    user_id: UserId,
    *,
    using: str = "default",
    read_only: bool = False,
    role: str | None = None,
    settings: Settings | None = None,
    identity: Identity | None = None,
) -> Iterator[None]:
    """Runs the block in a transaction as the user: every query of the connection goes through the policies, it commits
    when the block ends, and rolls back when it raises. Inside a transaction already, acts as the user until it ends.
    The identity of ``P9S_CONFIG`` by default."""
    chosen = identity or default_identity()
    with transaction.atomic(using=using):
        with connections[using].cursor() as cursor:
            cursor.execute(*chosen.statement(user_id, role=role, settings=settings, read_only=read_only))
        yield


def as_request_user(view: Callable[..., Any]) -> Callable[..., Any]:
    """Runs a view in a transaction as the user of its request."""

    @functools.wraps(view)
    def wrapped(request: Any, *args: Any, **kwargs: Any) -> Any:
        with as_user(user_id_of(request)):
            return view(request, *args, **kwargs)

    return wrapped


class P9sMiddleware:
    """Runs every request in a transaction as its user. Put it after the middleware that signs users in."""

    def __init__(self, get_response: Callable[[Any], Any]):
        self.get_response = get_response

    def __call__(self, request: Any) -> Any:
        with as_user(user_id_of(request)):
            return self.get_response(request)
