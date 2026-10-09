# Adopting p9s in a FastAPI app

A [FastAPI](https://fastapi.tiangolo.com) API on async [SQLAlchemy](https://www.sqlalchemy.org), with
[Alembic](https://alembic.sqlalchemy.org) migrations, for projects and documents, as the [adoption tests](../adoption)
describe it: teams get access to projects, users to documents, and the app checks every request in its code.

## Before

[`before/`](./before) is the app as it was. [`app/models.py`](./before/app/models.py) declares the tables, and
`alembic revision --autogenerate` wrote its [migration](./before/migrations/versions).
[`app/permissions.py`](./before/app/permissions.py) works out the access of a user from the tables `team_members`,
`project_shares` and `document_shares`, and every route of [`app/main.py`](./before/app/main.py) asks it first.

## The migration

[`p9s.config.json`](./p9s.config.json) describes the tables: users and teams are roles, projects and documents are
resources, a document is in its project. Its `links` name the tables where the app keeps memberships and shares, and
which bits each access gives. With `authentication.key`, the app tells p9s the id of the user in its `users` table, and
with `grantPrivileges`, the migration grants `app_user` what its permissions name.

After `alembic upgrade head`, in the folder of the app, with `DATABASE_URL` set:

```bash
npx @p9s/cli postgres migrate --config p9s.config.json
```

It runs in one transaction, creates the role `app_user`, brings the rows of the link tables into the graph, and from
then on keeps the graph in step with them. The models do not change. `alembic revision --autogenerate` would propose to
drop the tables of p9s, and the `role_id` and `resource_id` columns it adds, which the models do not know: the patch
gives `migrations/env.py` an `include_object` that leaves what only the database has, and autogenerate then finds
nothing to change.

## After

[`after.patch`](./after.patch) adds [`p9s`](../../packages/python), deletes `app/permissions.py`, and gives each
route a session whose transaction acts as the user with `as_user_async`:

```python
users = Identity.from_file(Path(__file__).parent.parent / "p9s.config.json")

async def writing(user: UserId) -> AsyncIterator[AsyncSession]:
    async with Session() as session, as_user_async(session, users, user):
        yield session

Writing = Annotated[AsyncSession, Depends(writing, scope="function")]
```

With `scope="function"`, the transaction commits before the response is sent, so a commit that fails is the answer.
The policies decide what each query reads and writes. A write they refuse fails with `insufficient_privilege`, which
the app answers with 403 when `is_refused(error)` says so. An update or a delete of a document the user reads but cannot
change returns no row, and gets 403 too.

In an app, `pip install "p9s[sqlalchemy]"`. The example takes the package of this repository, with a path in
`[tool.uv.sources]`.

## The test

[`adoption.test.ts`](./adoption.test.ts) runs the app before, the migration, and the app after on a real Postgres,
with [uv](https://docs.astral.sh/uv), and checks that every user gets the same answers, see
[the adoption tests](../adoption):

```bash
P9S_ADOPTION_DATABASE_URL=postgresql://postgres@localhost:5432/postgres bun test examples/fastapi
```
