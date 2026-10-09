# p9s for Python

Act as a user of [p9s](https://github.com/crubier/p9s), permissions of trees in Postgres with row level security, from
SQLAlchemy and Django: every query of a transaction runs as the role of the users of the config, with the id of the
user in the setting its current user function reads, so the policies of p9s decide what it reads and writes.

```bash
pip install "p9s[sqlalchemy]"   # or "p9s[django]"
```

The role and the setting come from the config of p9s, as for `createIdentity` of `@p9s/postgres`:

```python
from p9s import Identity

users = Identity.from_file("p9s.config.json")
```

## SQLAlchemy

```python
from p9s.sqlalchemy import as_user, as_user_async

with Session(engine) as session, as_user(session, users, user_id):
    documents = session.scalars(select(Document)).all()

async with AsyncSession(engine) as session, as_user_async(session, users, user_id, read_only=True):
    documents = (await session.scalars(select(Document))).all()
```

`as_user` begins a transaction of the session, acts as the user in it, commits when the block ends and rolls back when
it raises. The settings end with the transaction, so a pooled connection never keeps the identity of a previous
request. `set_user(session, users, user_id)` acts as the user for the rest of a transaction already begun.

## Django

```python
# settings.py
P9S_CONFIG = BASE_DIR / "p9s.config.json"
P9S_USER_ID = "app.auth.user_id_of"  # a function of the request, request.user.pk by default
MIDDLEWARE = [..., "p9s.django.P9sMiddleware"]
```

`P9sMiddleware` runs every request in a transaction as its user. Or only some views, with `@as_request_user`, or a
block, with `as_user`:

```python
from p9s.django import as_request_user, as_user

@as_request_user
def documents(request):
    return JsonResponse(list(Document.objects.values("id", "title")), safe=False)

with as_user(user_id):
    Document.objects.create(project_id=project_id, title=title)
```

## Refused writes

Postgres refuses a row the policies do not let through, a statement the role has no privilege for, and a share of bits
the user does not have, with `insufficient_privilege`. `is_refused(error)` tells, through the wrappers of SQLAlchemy and
Django:

```python
from p9s import is_refused

try:
    ...
except DatabaseError as error:
    if is_refused(error):
        return JsonResponse({"error": "forbidden"}, status=403)
    raise
```

Examples: [FastAPI and SQLAlchemy](https://github.com/crubier/p9s/tree/main/examples/fastapi), and
[Django](https://github.com/crubier/p9s/tree/main/examples/django).
