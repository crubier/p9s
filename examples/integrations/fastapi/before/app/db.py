import os

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine


def database_url() -> str:
    """DATABASE_URL, for the psycopg driver of SQLAlchemy"""
    url = os.environ["DATABASE_URL"]
    return "postgresql+psycopg://" + url.split("://", 1)[1]


engine = create_async_engine(database_url())
Session = async_sessionmaker(engine, expire_on_commit=False)


async def session():
    async with Session() as session:
        yield session


__all__ = ["AsyncSession", "Session", "database_url", "engine", "session"]
