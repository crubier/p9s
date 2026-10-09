---
sidebar_position: 7
---

# SQLAlchemy and FastAPI

[`p9s`](https://github.com/crubier/p9s/tree/main/packages/python) on PyPI runs a transaction of a SQLAlchemy session as a user, sync or async. [`examples/fastapi`](https://github.com/crubier/p9s/tree/main/examples/fastapi) adopts p9s in a FastAPI app on async SQLAlchemy, with Alembic migrations.

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

[`before/`](https://github.com/crubier/p9s/tree/main/examples/fastapi/before) works out the access of a user in `app/permissions.py`, which every route asks first. [`after.patch`](https://github.com/crubier/p9s/blob/main/examples/fastapi/after.patch) deletes it, and gives each route a session as its user. The models do not change.
