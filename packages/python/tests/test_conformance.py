"""The conformance suite of p9s, see packages/conformance: SQLAlchemy, sync and async, and Django"""

import json
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import Session

from p9s import Identity, is_refused
from p9s.sqlalchemy import as_user, as_user_async

from .conftest import CONFORMANCE_URL, configure_django, sqlalchemy_url

pytestmark = pytest.mark.skipif(CONFORMANCE_URL is None, reason="P9S_CONFORMANCE_DATABASE_URL is not set")

SUITE = Path(__file__).resolve().parents[2] / "conformance"
CASES = json.loads((SUITE / "cases.json").read_text())


class RolledBack(Exception):
    pass


@pytest.fixture(scope="module")
def users():
    return Identity.from_file(SUITE / CASES["config"])


def test_the_role_and_the_setting_come_from_the_config(users):
    assert (users.role, users.setting) == (CASES["role"], CASES["setting"])


def test_sqlalchemy(users):
    engine = create_engine(sqlalchemy_url(CONFORMANCE_URL), pool_size=1, max_overflow=0)
    try:
        for _ in range(2):
            for case in CASES["reads"]:
                with Session(engine) as session, as_user(session, users, case["user"], read_only=True):
                    assert session.scalars(text(CASES["read"])).all() == case["ids"]

        insert = CASES["insert"]
        with Session(engine) as session, as_user(session, users, insert["user"]):
            row = session.execute(text(insert["sql"])).one()
        assert row.folder_id == insert["folderId"] and row.id > 3

        with pytest.raises(Exception) as refused:
            with Session(engine) as session, as_user(session, users, CASES["refused"]["user"]):
                session.execute(text(CASES["refused"]["sql"]))
        assert is_refused(refused.value)

        inside = None
        with pytest.raises(RolledBack):
            with Session(engine) as session, as_user(session, users, CASES["whoUser"]):
                inside = tuple(session.execute(text(CASES["who"])).one())
                raise RolledBack
        assert inside == (CASES["role"], str(CASES["whoUser"]))
        with engine.connect() as connection:
            role, user_id = connection.execute(text(CASES["who"])).one()
        assert role != CASES["role"] and user_id == ""
    finally:
        engine.dispose()


async def test_sqlalchemy_async(users):
    engine = create_async_engine(sqlalchemy_url(CONFORMANCE_URL), pool_size=1, max_overflow=0)
    try:
        for _ in range(2):
            for case in CASES["reads"]:
                async with AsyncSession(engine) as session, as_user_async(session, users, case["user"], read_only=True):
                    assert (await session.scalars(text(CASES["read"]))).all() == case["ids"]

        insert = CASES["insert"]
        async with AsyncSession(engine) as session, as_user_async(session, users, insert["user"]):
            row = (await session.execute(text(insert["sql"]))).one()
        assert row.folder_id == insert["folderId"] and row.id > 3

        with pytest.raises(Exception) as refused:
            async with AsyncSession(engine) as session, as_user_async(session, users, CASES["refused"]["user"]):
                await session.execute(text(CASES["refused"]["sql"]))
        assert is_refused(refused.value)

        with pytest.raises(RolledBack):
            async with AsyncSession(engine) as session, as_user_async(session, users, CASES["whoUser"]):
                raise RolledBack
        async with engine.connect() as connection:
            role, user_id = (await connection.execute(text(CASES["who"]))).one()
        assert role != CASES["role"] and user_id == ""
    finally:
        await engine.dispose()


def test_django(users, tmp_path_factory):
    configure_django(tmp_path_factory.mktemp("django"))
    from django.db import connections

    from p9s.django import as_user as as_django_user

    def query(sql):
        with connections["conformance"].cursor() as cursor:
            cursor.execute(sql)
            return cursor.fetchall()

    for _ in range(2):
        for case in CASES["reads"]:
            with as_django_user(case["user"], using="conformance", read_only=True, identity=users):
                assert [row[0] for row in query(CASES["read"])] == case["ids"]

    insert = CASES["insert"]
    with as_django_user(insert["user"], using="conformance", identity=users):
        [(note_id, folder_id)] = query(insert["sql"])
    assert folder_id == insert["folderId"] and note_id > 3

    with pytest.raises(Exception) as refused:
        with as_django_user(CASES["refused"]["user"], using="conformance", identity=users):
            query(CASES["refused"]["sql"])
    assert is_refused(refused.value)

    inside = None
    with pytest.raises(RolledBack):
        with as_django_user(CASES["whoUser"], using="conformance", identity=users):
            inside = query(CASES["who"])[0]
            raise RolledBack
    assert inside == (CASES["role"], str(CASES["whoUser"]))
    role, user_id = query(CASES["who"])[0]
    assert role != CASES["role"] and user_id == ""
    connections["conformance"].close()
