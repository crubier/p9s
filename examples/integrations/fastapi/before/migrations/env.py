from alembic import context
from sqlalchemy import create_engine

from app.db import database_url
from app.models import Base

target_metadata = Base.metadata


def run_migrations_online() -> None:
    with create_engine(database_url()).connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


run_migrations_online()
