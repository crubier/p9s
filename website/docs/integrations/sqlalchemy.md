---
sidebar_position: 7
---

# SQLAlchemy and FastAPI

[`p9s`](https://github.com/crubier/p9s/tree/main/packages/python) on PyPI runs a transaction of a SQLAlchemy session as a user, sync or async. [`examples/integrations/fastapi`](https://github.com/crubier/p9s/tree/main/examples/integrations/fastapi) adopts p9s in a FastAPI app on async SQLAlchemy, with Alembic migrations.

The reference of each function, its options and its errors: [`p9s` for Python](../packages/python#p9ssqlalchemy).

## p9s adopt

```bash
npx @p9s/cli adopt
uv sync
```

In a FastAPI app, [`p9s adopt`](../packages/cli#adopt) adds `p9s[sqlalchemy]` to `pyproject.toml`, makes the identity `users` next to `FastAPI()`, answers 403 to refused writes with an exception handler, and makes autogenerate of Alembic leave alone what p9s adds to the database. Then run the queries of each request in a session as its user, and delete the permission checks, as in [the example](#the-example). The sections below are what it writes, for an app that makes the changes by hand.

## Install

```bash
pip install "p9s[sqlalchemy]"
```

## Config

`Identity` reads the role and the setting from [the config](./adopting#the-config):

```python
from p9s import Identity

users = Identity.from_file("p9s.config.json")
```

## Each request as its user

```python
from p9s.sqlalchemy import as_user, as_user_async

with Session(engine) as session, as_user(session, users, user_id):
    documents = session.scalars(select(Document)).all()

async with AsyncSession(engine) as session, as_user_async(session, users, user_id, read_only=True):
    documents = (await session.scalars(select(Document))).all()
```

`as_user` begins a transaction of the session, acts as the user in it, commits when the block ends and rolls back when it raises. `set_user(session, users, user_id)` acts as the user for the rest of a transaction already begun. With FastAPI, a dependency gives each route a session as its user:

```python
async def writing(user: UserId) -> AsyncIterator[AsyncSession]:
    async with Session() as session, as_user_async(session, users, user):
        yield session

Writing = Annotated[AsyncSession, Depends(writing, scope="function")]
```

With `scope="function"`, the transaction commits before the response is sent, so a commit that fails is the answer.

## Refused writes

`is_refused(error)` tells a write the policies refused, through the wrappers of SQLAlchemy:

```python
from p9s import is_refused

@app.exception_handler(DBAPIError)
async def refused(request: Request, error: DBAPIError):
    if is_refused(error):
        return JSONResponse({"error": "forbidden"}, status_code=403)
    raise error
```

## The migration

After `alembic upgrade head`:

```bash
npx @p9s/cli postgres migrate --config p9s.config.json
```

Or as a migration of Alembic, after the revision of `--previous`, which `alembic upgrade head` then runs:

```bash
npx @p9s/cli postgres generate --config p9s.config.json --format alembic --previous 0001
```

`alembic revision --autogenerate` would propose to drop the tables of p9s, and the `role_id` and `resource_id` columns it adds, which the models do not know. An `include_object` in `migrations/env.py` leaves what only the database has, and autogenerate then finds nothing to change:

```python
def include_object(object, name, type_, reflected, compare_to):
    return not (reflected and compare_to is None)

context.configure(connection=connection, target_metadata=target_metadata, include_object=include_object)
```

## The example

[`before/`](https://github.com/crubier/p9s/tree/main/examples/integrations/fastapi/before) works out the access of a user in `app/permissions.py`, which every route asks first. [`adopt.patch`](https://github.com/crubier/p9s/blob/main/examples/integrations/fastapi/adopt.patch) is what `p9s adopt` writes: the package, the identity, the exception handler and `include_object`. [`after.patch`](https://github.com/crubier/p9s/blob/main/examples/integrations/fastapi/after.patch) is the rest, by hand: it deletes `permissions.py` and its checks, gives each route a session as its user, and answers refused writes with the JSON of the app. The models do not change.

## Benchmark

The [example](https://github.com/crubier/p9s/tree/main/examples/integrations/fastapi) before p9s and after p9s, each on its own database with the rows of [`benchmark-seed.sql`](https://github.com/crubier/p9s/blob/main/examples/integrations/adoption/benchmark-seed.sql): 1000 users in 100 teams, 1000 projects and 20,000 documents, of which each user reads about 1200. 20 of the users send each request 600 times to each app, 4 at a time, in 3 rounds that switch which app goes first. Times are in milliseconds.

| Request | Before: median | p95 | Requests/s | After: median | p95 | Requests/s | After / before |
|---|---:|---:|---:|---:|---:|---:|---:|
| List projects `GET /projects` | 3.8 | 4.72 | 1,015 | 4.55 | 5.24 | 851 | 1.20× |
| List documents `GET /documents` | 26.43 | 41.9 | 147 | 29.06 | 31.08 | 135 | 1.10× |
| Read a document `GET /documents/:id` | 5.32 | 6.11 | 747 | 3.83 | 4.38 | 1,038 | 0.72× |
| Create a document `POST /documents` | 3.92 | 4.57 | 987 | 4.18 | 4.72 | 957 | 1.07× |
| Update a document `PATCH /documents/:id` | 5.8 | 6.94 | 680 | 5.33 | 6.98 | 721 | 0.92× |
| Share a document `PUT /documents/:id/shares/:user_id` | 5.83 | 6.63 | 674 | 5.11 | 5.77 | 784 | 0.88× |

Measured on 2026-10-10: Apple M2 Max, 12 cores, 64 GiB, Darwin 25.6.0 arm64. Python 3.12.10, FastAPI 0.143.0, PostgreSQL 18.6, p9s 0.1.0. [How it runs](../benchmarks#the-examples).
