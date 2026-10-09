import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import DBAPIError, InternalError
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import Session

from p9s import Identity, is_refused
from p9s.sqlalchemy import as_user, as_user_async, set_user

from .conftest import CONFIG, needs_database, sqlalchemy_url

pytestmark = needs_database

users = Identity(CONFIG)
who = text("select current_user, current_setting('app.user_id', true)")


@pytest.fixture
def engine(database):
    # One connection, so that each test sees whether a transaction leaves anything on it
    engine = create_engine(sqlalchemy_url(database), pool_size=1, max_overflow=0)
    yield engine
    engine.dispose()


def test_as_user_acts_as_the_user_until_the_transaction_ends(engine):
    with Session(engine) as session:
        with as_user(session, users, 7):
            assert session.execute(who).one() == ("p9s_python_user", "7")
        with session.begin():
            role, user_id = session.execute(who).one()
            assert role != "p9s_python_user" and user_id in (None, "")


def test_as_user_rolls_back_when_the_block_raises(engine):
    with Session(engine) as session:
        with pytest.raises(RuntimeError):
            with as_user(session, users, 7, role="p9s_python_writer"):
                session.execute(text("insert into p9s_python_note (body) values ('rolled back')"))
                raise RuntimeError("stop")
        with session.begin():
            assert session.execute(text("select count(*) from p9s_python_note where body = 'rolled back'")).scalar() == 0


def test_a_refused_write_is_refused(engine):
    with Session(engine) as session:
        with pytest.raises(DBAPIError) as raised:
            with as_user(session, users, 7):
                session.execute(text("insert into p9s_python_note (body) values ('refused')"))
        assert is_refused(raised.value)


def test_read_only(engine):
    with Session(engine) as session:
        with pytest.raises(InternalError) as raised:
            with as_user(session, users, 7, read_only=True, role="p9s_python_writer"):
                session.execute(text("insert into p9s_python_note (body) values ('read only')"))
        assert not is_refused(raised.value)


def test_set_user_in_a_transaction_of_a_connection(engine):
    with engine.begin() as connection:
        set_user(connection, users, "alice", settings={"app.audit": True})
        assert connection.execute(text("select current_user, current_setting('app.user_id'), current_setting('app.audit')")).one() == (
            "p9s_python_user",
            "alice",
            "on",
        )


async def test_as_user_async(database):
    engine = create_async_engine(sqlalchemy_url(database), pool_size=1, max_overflow=0)
    try:
        async with AsyncSession(engine) as session:
            async with as_user_async(session, users, 7):
                assert (await session.execute(who)).one() == ("p9s_python_user", "7")
            async with session.begin():
                assert (await session.execute(who)).one()[0] != "p9s_python_user"
            with pytest.raises(DBAPIError) as raised:
                async with as_user_async(session, users, 7):
                    await session.execute(text("insert into p9s_python_note (body) values ('refused')"))
            assert is_refused(raised.value)
    finally:
        await engine.dispose()
