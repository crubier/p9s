# Adopting p9s in a Phoenix app

A [Phoenix](https://www.phoenixframework.org) API on [Ecto](https://hexdocs.pm/ecto), for projects and documents, as
the [adoption tests](../adoption) describe it: teams get access to projects, users to documents, and the app checks
every request in its code.

## Before

[`before/`](./before) is the app as it was. [`priv/repo/migrations`](./before/priv/repo/migrations) creates the
tables. [`lib/documents/permissions.ex`](./before/lib/documents/permissions.ex) works out the access of a user from the
tables `team_members`, `project_shares` and `document_shares`, and every action of
[`DocumentController`](./before/lib/documents_web/controllers/document_controller.ex) asks it first.

## The migration

[`p9s.config.json`](./p9s.config.json) describes the tables: users and teams are roles, projects and documents are
resources, a document is in its project. Its `links` name the tables where the app keeps memberships and shares, and
which bits each access gives. With `authentication.key`, the app tells p9s the id of the user in its `users` table, and
with `grantPrivileges`, the migration grants `app_user` what its permissions name.

After `mix ecto.migrate`, in the folder of the app, with `DATABASE_URL` set:

```bash
npx @p9s/cli postgres migrate --config p9s.config.json
```

It runs in one transaction, creates the role `app_user`, brings the rows of the link tables into the graph, and from
then on keeps the graph in step with them. The schemas do not change: Ecto reads the fields its schemas name, and leaves
the `role_id` and `resource_id` columns p9s adds to their defaults.

To run p9s with the other migrations of the app instead, as a migration of Ecto:

```bash
npx @p9s/cli postgres generate --config p9s.config.json --format ecto
```

Then `mix ecto.migrate` runs it, and the adoption test checks that too.

## After

[`adopt.patch`](./adopt.patch) is what [`p9s adopt`](../../packages/cli/src/adopt) writes, with `--user-id
conn.assigns.user_id`: it adds [`p9s`](../../packages/elixir), and uses `P9s.Controller` in the controllers of the app,
in `DocumentsWeb.controller/0`. [`after.patch`](./after.patch) is the rest, by hand: it deletes
`lib/documents/permissions.ex` and its checks, and defines `p9s_refused/2`:

```elixir
use Phoenix.Controller, formats: [:json]
use P9s.Controller, repo: Documents.Repo

def p9s_user_id(conn), do: conn.assigns.user_id

def p9s_refused(conn, _error), do: forbidden(conn)
```

Every action then runs in a transaction as its user, read only for `GET`, and the policies decide what each query reads
and writes. A write they refuse fails with `insufficient_privilege`, the transaction rolls back, and `p9s_refused/2`
answers 403. An `update_all` or a `delete_all` of a document the user reads but cannot change counts 0 rows, and gets
403 too.

In an app, `{:p9s, "~> 0.1"}`. The example takes the package of this repository, with a path in `mix.exs`.

## The test

[`adoption.test.ts`](./adoption.test.ts) builds and runs the app before, the migration, and the app after on a real
Postgres, with Elixir 1.18 or later, and checks that every user gets the same answers, see
[the adoption tests](../adoption):

```bash
P9S_ADOPTION_DATABASE_URL=postgresql://postgres@localhost:5432/postgres bun test examples/phoenix
```
