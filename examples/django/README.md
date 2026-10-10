# Adopting p9s in a Django app

A [Django](https://www.djangoproject.com) app for projects and documents, as the [adoption tests](../adoption)
describe it: teams get access to projects, users to documents, and the app checks every request in its code.

## Before

[`before/`](./before) is the app as it was. [`documents/models.py`](./before/documents/models.py) declares the
tables, and `manage.py makemigrations` wrote their [migration](./before/documents/migrations). Foreign keys cascade in
the database, with `on_delete=models.DB_CASCADE`.
[`documents/permissions.py`](./before/documents/permissions.py) works out the access of a user from the tables
`team_members`, `project_shares` and `document_shares`, and every view of
[`documents/views.py`](./before/documents/views.py) asks it first.

## The migration

[`p9s.config.json`](./p9s.config.json) describes the tables: users and teams are roles, projects and documents are
resources, a document is in its project. Its `links` name the tables where the app keeps memberships and shares, and
which bits each access gives. With `authentication.key`, the app tells p9s the id of the user in its `users` table, and
with `grantPrivileges`, the migration grants `app_user` what its permissions name.

After `manage.py migrate`, in the folder of the app, with `DATABASE_URL` set:

```bash
npx @p9s/cli postgres migrate --config p9s.config.json
```

It runs in one transaction, creates the role `app_user`, brings the rows of the link tables into the graph, and from
then on keeps the graph in step with them. The models do not change, and `makemigrations` finds nothing to do: Django
compares the models with its migrations, not with the database.

Foreign keys should cascade in the database. With `on_delete=models.CASCADE`, Django deletes the dependent rows itself,
as the user, who may delete a document but not its shares.

To run p9s with the other migrations of the app instead, as a migration of Django:

```bash
npx @p9s/cli postgres generate --config p9s.config.json --format django --previous documents.0001_initial
```

Then `manage.py migrate` runs it, and the adoption test checks that too.

## After

[`adopt.patch`](./adopt.patch) is what [`p9s adopt`](../../packages/cli/src/adopt) writes, with `--user-id
documents.middleware.user_id_of`: it adds [`p9s`](../../packages/python), and the middleware of p9s after the one that
finds the user. [`after.patch`](./after.patch) is the rest, by hand: it deletes `documents/permissions.py` and its
checks, and answers 403 to refused writes.

```python
MIDDLEWARE = ["documents.middleware.UserFromHeader", "p9s.django.P9sMiddleware"]
P9S_CONFIG = BASE_DIR / "p9s.config.json"
P9S_USER_ID = "documents.middleware.user_id_of"
```

Each request then runs in a transaction that acts as its user, and the policies decide what each query reads and
writes. Without `P9S_USER_ID`, the middleware takes `request.user.pk`, from `django.contrib.auth`. A view, a task or a
command can also run as a user with `as_user(user_id)`.

A write the policies refuse fails with `insufficient_privilege`. The views run in a savepoint, with
`transaction.atomic()`, so the transaction of the request survives the refusal, and answer 403 when
`is_refused(error)` says so. An update or a delete of a document the user reads but cannot change touches no row, and
gets 403 too.

In an app, `pip install "p9s[django]"`. The example takes the package of this repository, with a path in
`[tool.uv.sources]`.

## The test

[`adoption.test.ts`](./adoption.test.ts) runs the app before, the migration, and the app after on a real Postgres 15
or later, with [uv](https://docs.astral.sh/uv) and gunicorn, and checks that every user gets the same answers, see
[the adoption tests](../adoption):

```bash
P9S_ADOPTION_DATABASE_URL=postgresql://postgres@localhost:5432/postgres bun test examples/django
```
