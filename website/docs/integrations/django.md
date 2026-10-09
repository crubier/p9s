---
sidebar_position: 8
---

# Django

[`p9s`](https://github.com/crubier/p9s/tree/main/packages/python) on PyPI has a middleware that runs every request of Django in a transaction as its user. [`examples/django`](https://github.com/crubier/p9s/tree/main/examples/django) adopts p9s in a Django app with it.

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

[`before/`](https://github.com/crubier/p9s/tree/main/examples/django/before) checks every view with `documents/permissions.py`. [`after.patch`](https://github.com/crubier/p9s/blob/main/examples/django/after.patch) deletes it and adds the middleware of p9s after the one that finds the user.
