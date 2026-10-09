# Adopting p9s in a Kysely app

A [Hono](https://hono.dev) and [Kysely](https://kysely.dev) API for projects and documents, as the
[adoption tests](../adoption) describe it: teams get access to projects, users to documents, and the app checks every
request in its code.

## Before

[`before/`](./before) is the app as it was. Its migrations make the tables, and
[`src/permissions.ts`](./before/src/permissions.ts) works out the access of a user from the tables `team_members`,
`project_shares` and `document_shares`. Every route of [`src/server.ts`](./before/src/server.ts) asks it first.

## The migration

[`p9s.config.json`](./p9s.config.json) describes the tables: users and teams are roles, projects and documents are
resources, a document is in its project. Its `links` name the tables where the app keeps memberships and shares, and
which bits each access gives. With `authentication.key`, the app tells p9s the id of the user in its `users` table, and
with `grantPrivileges`, the migration grants `app_user` what its permissions name.

In the folder of the app, with `DATABASE_URL` set:

```bash
npx @p9s/cli postgres migrate --config p9s.config.json
```

It runs in one transaction, creates the role `app_user`, brings the rows of the link tables into the graph, and from
then on keeps the graph in step with them.

## After

[`after.patch`](./after.patch) deletes `src/permissions.ts`, and runs the queries of each request as its user with
`withUser` of [`@p9s/kysely`](../../packages/kysely):

```ts
const users = createIdentity(config);

app.get("/documents", async c => c.json(await withUser(db, users, c.get("userId"), trx =>
  trx.selectFrom("documents").select(["id", "project_id", "title"]).orderBy("id").execute(), { readOnly: true })));
```

The policies decide what each query reads and writes. A write they refuse fails with `insufficient_privilege`, which the
app answers with 403 when `isRefused(error)` of `@p9s/postgres` says so. The app keeps writing its own tables: sharing a document is still an insert into
`document_shares`, which p9s checks gives no more than the user has.

## The test

[`adoption.test.ts`](./adoption.test.ts) runs the app before, the migration, and the app after on a real Postgres, and
checks that every user gets the same answers, see [the adoption tests](../adoption):

```bash
P9S_ADOPTION_DATABASE_URL=postgresql://postgres@localhost:5432/postgres bun test examples/kysely
```
