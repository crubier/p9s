---
sidebar_position: 7
---

# Python

[`p9s`](https://github.com/crubier/p9s/tree/main/packages/python) on PyPI runs transactions as a user with SQLAlchemy, sync and async, and with Django, for a block, a view or every request.

Guides: [SQLAlchemy and FastAPI](../integrations/sqlalchemy), [Django](../integrations/django). Examples: [FastAPI](https://github.com/crubier/p9s/tree/main/examples/integrations/fastapi), [Django](https://github.com/crubier/p9s/tree/main/examples/integrations/django).

## Install

```bash
pip install "p9s[sqlalchemy]"   # SQLAlchemy 2.0 or later
pip install "p9s[django]"       # Django 4.2 or later
```

Python 3.10 or later. The package has no dependencies of its own: the extras bring SQLAlchemy or Django.

## p9s

### Identity

```python
from p9s import Identity

users = Identity.from_file("p9s.config.json")
```

`Identity(config, *, setting=None, claim=None)` reads the role and the setting of a transaction of a user from `engine` of a config, a mapping, like [`createIdentity`](./postgres#createidentity). `Identity.from_file(path, **options)` reads `p9s.config.json`.

| Argument | Default | |
| --- | --- | --- |
| `setting` | `engine.authentication.setting` | The setting the current user function reads |
| `claim` | `engine.authentication.claim`, when `setting` is not given | The claim of the setting that holds the user, when the setting holds JSON claims |

It raises `ValueError` when `engine.users` is empty, or when there is no setting.

| Member | |
| --- | --- |
| `role` | The role transactions take by default, the first of `engine.users` |
| `setting`, `claim` | The setting the current user function reads, and its claim or `None` |
| `roles` | The roles of `engine.users` and `engine.graphWriters` |
| `value(user_id)` | The value of the setting for a user: the id as text, JSON claims, or `""` for `None` |
| `settings(user_id, *, role=None, settings=None)` | The settings of a transaction of the user, as `(name, value)` pairs, the role first |
| `statement(user_id, *, role=None, settings=None)` | `(text, params)` of `select set_config(%(name_0)s, %(value_0)s, true), ...`, with named parameters |

`user_id` is an `int`, a `str` or `None`, for no one. `role` takes another role of `engine.users` or `engine.graphWriters`, and raises `ValueError` for another. `settings` adds settings to the transaction, like `{"app.tenant_id": 3}`: `None` sets them empty, and booleans `on` and `off`.

### is_refused

```python
from p9s import is_refused

if is_refused(error):
    return JSONResponse({"error": "forbidden"}, status_code=403)
```

`is_refused(error)` tells whether an exception is Postgres refusing a statement to the user, with `insufficient_privilege`, `42501`: a row the policies do not let through, a statement the role has no privilege for, or a share of bits the user does not have. It reads `sqlstate` of psycopg 3 and `pgcode` of psycopg2, through `orig` of SQLAlchemy and `__cause__` of Django.

## p9s.sqlalchemy

### as_user and as_user_async

```python
from p9s.sqlalchemy import as_user, as_user_async

with Session(engine) as session, as_user(session, users, user_id, read_only=True):
    titles = session.scalars(select(Document.title)).all()

async with Session() as session, as_user_async(session, users, user_id):
    session.add(Document(project_id=1, title="Plan"))
```

`as_user(session, identity, user_id, *, read_only=False, role=None, settings=None)` is a context manager that runs its block in a transaction of the session, `session.begin()`, as the user, and yields the session. It runs `set transaction read only` first for `read_only`, then the statement of the user, so every query of the block goes through the policies. It commits when the block ends, and rolls back when it raises. `as_user_async` does the same for an `AsyncSession`, as an async context manager. The session must not be in a transaction already.

### set_user and set_user_async

`set_user(session, identity, user_id, *, role=None, settings=None)` acts as the user for the rest of the transaction a `Session` or `Connection` is in, or begins. `set_user_async` does the same for an `AsyncSession` or `AsyncConnection`. For a read only transaction, run `set transaction read only` before.

A write the policies refuse raises `sqlalchemy.exc.DBAPIError`, with the error of the driver as `orig`, which `is_refused` tells.

## p9s.django

### Settings

| Setting | |
| --- | --- |
| `P9S_CONFIG` | The path of `p9s.config.json` |
| `P9S_USER_ID` | The dotted path of a function of the request that returns the id of its user, or `None`. `request.user.pk` of signed in users by default |

### P9sMiddleware

```python
MIDDLEWARE = [
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "p9s.django.P9sMiddleware",
]
P9S_CONFIG = BASE_DIR / "p9s.config.json"
```

`P9sMiddleware` runs every request in a transaction as its user, on the `default` database. Put it after the middleware that signs users in.

### as_request_user

`@as_request_user` runs a view in a transaction as the user of its request, for apps that adopt p9s view by view.

### as_user

```python
from p9s.django import as_user

with as_user(user_id, read_only=True):
    titles = list(Document.objects.values_list("title", flat=True))
```

`as_user(user_id, *, using="default", read_only=False, role=None, settings=None, identity=None)` runs its block in a transaction of the database `using`, `transaction.atomic`, as the user, for tasks and commands. Inside a transaction already, it acts as the user until that transaction ends. The identity of `P9S_CONFIG` by default, which `default_identity()` returns, read once.

A write the policies refuse raises `django.db.ProgrammingError`, whose `__cause__` is the error of psycopg, which `is_refused` tells. It breaks the transaction it is in: a view that answers 403 and goes on runs the write in a savepoint, `transaction.atomic()`.
