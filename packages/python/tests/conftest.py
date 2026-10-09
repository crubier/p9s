import json
import os
from urllib.parse import urlsplit

import pytest

DATABASE_URL = os.environ.get("P9S_TEST_DATABASE_URL")

CONFIG = {
    "engine": {
        "users": ["p9s_python_user"],
        "graphWriters": ["p9s_python_writer"],
        "authentication": {"getCurrentUserId": "current_role_id", "setting": "app.user_id"},
    },
    "tables": [],
}

needs_database = pytest.mark.skipif(DATABASE_URL is None, reason="P9S_TEST_DATABASE_URL is not set")


@pytest.fixture
def config_path(tmp_path):
    path = tmp_path / "p9s.config.json"
    path.write_text(json.dumps(CONFIG))
    return path


@pytest.fixture(scope="session")
def database():
    """A table the user role reads but cannot write, and the roles of the config"""
    import psycopg

    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        connection.execute(
            """
            do $$
            begin
              if not exists (select from pg_roles where rolname = 'p9s_python_user') then create role p9s_python_user nologin; end if;
              if not exists (select from pg_roles where rolname = 'p9s_python_writer') then create role p9s_python_writer nologin; end if;
            end
            $$;
            grant p9s_python_user, p9s_python_writer to current_user;
            drop table if exists p9s_python_note;
            create table p9s_python_note (id serial primary key, body text not null);
            grant select on p9s_python_note to p9s_python_user;
            grant select, insert on p9s_python_note to p9s_python_writer;
            grant usage on sequence p9s_python_note_id_seq to p9s_python_writer;
            """
        )
    yield DATABASE_URL


def sqlalchemy_url(url: str, driver: str = "psycopg") -> str:
    return f"postgresql+{driver}://" + url.split("://", 1)[1]


def django_database(url: str) -> dict:
    parts = urlsplit(url)
    return {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": parts.path.lstrip("/"),
        "USER": parts.username or "",
        "PASSWORD": parts.password or "",
        "HOST": parts.hostname or "",
        "PORT": str(parts.port or ""),
    }
