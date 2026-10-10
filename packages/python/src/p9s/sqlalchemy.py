"""SQLAlchemy: ``as_user`` runs a transaction of a session as the user, sync or async."""

from __future__ import annotations

from contextlib import asynccontextmanager, contextmanager
from typing import TYPE_CHECKING, AsyncIterator, Iterator, Union

from sqlalchemy import text

from .identity import Identity, Settings, UserId

if TYPE_CHECKING:
    from sqlalchemy.engine import Connection
    from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession
    from sqlalchemy.orm import Session


def _statement(identity: Identity, user_id: UserId, role: str | None, settings: Settings | None, read_only: bool):
    pairs = identity.settings(user_id, role=role, settings=settings, read_only=read_only)
    statement = text("select " + ", ".join(f"set_config(:name_{i}, :value_{i}, true)" for i in range(len(pairs))))
    params = {key: value for i, (name, value) in enumerate(pairs) for key, value in ((f"name_{i}", name), (f"value_{i}", value))}
    return statement, params


def set_user(
    session: Union[Session, Connection],
    identity: Identity,
    user_id: UserId,
    *,
    read_only: bool = False,
    role: str | None = None,
    settings: Settings | None = None,
) -> None:
    """Acts as the user for the rest of the transaction the session is in, or begins."""
    statement, params = _statement(identity, user_id, role, settings, read_only)
    session.execute(statement, params)


@contextmanager
def as_user(
    session: Session,
    identity: Identity,
    user_id: UserId,
    *,
    read_only: bool = False,
    role: str | None = None,
    settings: Settings | None = None,
) -> Iterator[Session]:
    """Runs the block in a transaction of the session as the user: every query goes through the policies, it commits
    when the block ends, and rolls back when it raises. The settings end with the transaction, so a pooled connection
    never keeps the identity of a previous request."""
    with session.begin():
        set_user(session, identity, user_id, read_only=read_only, role=role, settings=settings)
        yield session


async def set_user_async(
    session: Union[AsyncSession, AsyncConnection],
    identity: Identity,
    user_id: UserId,
    *,
    read_only: bool = False,
    role: str | None = None,
    settings: Settings | None = None,
) -> None:
    """Acts as the user for the rest of the transaction the async session is in, or begins."""
    statement, params = _statement(identity, user_id, role, settings, read_only)
    await session.execute(statement, params)


@asynccontextmanager
async def as_user_async(
    session: AsyncSession,
    identity: Identity,
    user_id: UserId,
    *,
    read_only: bool = False,
    role: str | None = None,
    settings: Settings | None = None,
) -> AsyncIterator[AsyncSession]:
    """``as_user`` for an ``AsyncSession``."""
    async with session.begin():
        await set_user_async(session, identity, user_id, read_only=read_only, role=role, settings=settings)
        yield session
