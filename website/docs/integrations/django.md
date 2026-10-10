---
sidebar_position: 8
---

# Django

[`p9s`](https://github.com/crubier/p9s/tree/main/packages/python) on PyPI has a middleware that runs every request of Django in a transaction as its user. [`examples/integrations/django`](https://github.com/crubier/p9s/tree/main/examples/integrations/django) adopts p9s in a Django app with it.

The reference of each function, its options and its errors: [`p9s` for Python](../packages/python#p9sdjango).

## p9s adopt

```bash
npx @p9s/cli adopt
uv sync
```

[`p9s adopt`](../packages/cli#adopt) adds `p9s[django]` to `pyproject.toml`, and the middleware of p9s and `P9S_CONFIG` to the settings that `manage.py` names. With `--user-id app.auth.user_id_of`, it sets `P9S_USER_ID` too. Then answer 403 to refused writes, and delete the permission checks, as in [the example](#the-example). The sections below are what it writes, for an app that makes the changes by hand.

## Install

```bash
pip install "p9s[django]"
```

## Config

The middleware reads the role and the setting from [the config](./adopting#the-config), which `P9S_CONFIG` names:

```python
# settings.py
P9S_CONFIG = BASE_DIR / "p9s.config.json"
P9S_USER_ID = "app.auth.user_id_of"  # a function of the request, request.user.pk by default
```

## Each request as its user

```python
MIDDLEWARE = [..., "django.contrib.auth.middleware.AuthenticationMiddleware", "p9s.django.P9sMiddleware"]
```

`P9sMiddleware` runs every request in a transaction as its user, after the middleware that finds the user. Or only some views, with `@as_request_user`, or a block, in a task or a command, with `as_user`:

```python
from p9s.django import as_request_user, as_user

@as_request_user
def documents(request):
    return JsonResponse(list(Document.objects.values("id", "title")), safe=False)

with as_user(user_id):
    Document.objects.create(project_id=project_id, title=title)
```

The tables Django reads for itself during a request, like sessions, then need grants to `app_user` too.

## Refused writes

A refused write breaks the transaction it runs in. Run it in a savepoint, with `transaction.atomic()`, so the transaction of the request survives, and answer 403:

```python
from p9s import is_refused

try:
    with transaction.atomic():
        Document.objects.create(project_id=project_id, title=title)
except DatabaseError as error:
    if is_refused(error):
        return JsonResponse({"error": "forbidden"}, status=403)
    raise
```

## The migration

After `manage.py migrate`:

```bash
npx @p9s/cli postgres migrate --config p9s.config.json
```

Or as a migration of Django, in `<app>/migrations`, after the migration of `--previous`, which `manage.py migrate` then runs:

```bash
npx @p9s/cli postgres generate --config p9s.config.json --format django --previous documents.0001_initial
```

The models do not change, and `makemigrations` finds nothing to do: Django compares the models with its migrations, not with the database. Foreign keys should cascade in the database, with `on_delete=models.DB_CASCADE`: with `models.CASCADE`, Django deletes the dependent rows itself, as the user, who may delete a document but not its shares.

## The example

[`before/`](https://github.com/crubier/p9s/tree/main/examples/integrations/django/before) checks every view with `documents/permissions.py`. [`adopt.patch`](https://github.com/crubier/p9s/blob/main/examples/integrations/django/adopt.patch) is what `p9s adopt --user-id documents.middleware.user_id_of` writes: the package, and the middleware of p9s after the one that finds the user. [`after.patch`](https://github.com/crubier/p9s/blob/main/examples/integrations/django/after.patch) is the rest, by hand: it deletes `permissions.py` and its checks, and answers 403 to refused writes, in a savepoint of each view that writes.

## Benchmark

The [example](https://github.com/crubier/p9s/tree/main/examples/integrations/django) before p9s and after p9s, each on its own database with the rows of [`benchmark-seed.sql`](https://github.com/crubier/p9s/blob/main/examples/integrations/adoption/benchmark-seed.sql): 1000 users in 100 teams, 1000 projects and 20,000 documents, of which each user reads about 1200. 20 of the users send each request 600 times to each app, 4 at a time, in 3 rounds that switch which app goes first. Times are in milliseconds, and the app has no endpoint that counts.

| Request | Before: median | p95 | Requests/s | After: median | p95 | Requests/s | After / before |
|---|---:|---:|---:|---:|---:|---:|---:|
| List projects `GET /projects` | 14.16 | 16.16 | 279 | 23.57 | 26.49 | 168 | 1.66× |
| List documents `GET /documents` | 23.5 | 25.71 | 169 | 40.17 | 43.66 | 99 | 1.71× |
| Read a document `GET /documents/:id` | 16.51 | 20.71 | 235 | 23 | 37.97 | 157 | 1.39× |
| Create a document `POST /documents` | 14.19 | 17.33 | 274 | 27.23 | 32.66 | 142 | 1.92× |
| Update a document `PATCH /documents/:id` | 16.29 | 19.33 | 240 | 31.51 | 37.12 | 123 | 1.93× |
| Share a document `PUT /documents/:id/shares/:user_id` | 18.4 | 22.86 | 211 | 31.86 | 38.28 | 122 | 1.73× |

Measured on 2026-10-10: Apple M2 Max, 12 cores, 64 GiB, Darwin 25.6.0 arm64. Python 3.12.10, Django 6.1.2, PostgreSQL 18.6, p9s 0.1.0. [How it runs](../benchmarks#the-examples).
