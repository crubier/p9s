# Adopting p9s in a Drizzle app

A [Hono](https://hono.dev) and [Drizzle](https://orm.drizzle.team) API for projects and documents, as the
[adoption tests](../adoption) describe it: teams get access to projects, users to documents, and the app checks every
request in its code. [`examples/apps/nextjs-drizzle`](../../apps/nextjs-drizzle) is a full app built on p9s from the start, this one
adopts it.

## Before

[`before/`](./before) is the app as it was. [`src/schema.ts`](./before/src/schema.ts) declares the tables, and
`drizzle-kit generate` wrote its [migrations](./before/drizzle). [`src/permissions.ts`](./before/src/permissions.ts)
works out the access of a user from the tables `team_members`, `project_shares` and `document_shares`, and every route
of [`src/server.ts`](./before/src/server.ts) asks it first.

## The migration

[`p9s.config.json`](./p9s.config.json) describes the tables: users and teams are roles, projects and documents are
resources, a document is in its project. Its `links` name the tables where the app keeps memberships and shares, and
which bits each access gives. With `authentication.key`, the app tells p9s the id of the user in its `users` table, and
with `grantPrivileges`, the migration grants `app_user` what its permissions name. `generateConfigurationFromDrizzleSchema`
of [`@p9s/drizzle`](../../../packages/drizzle) can derive the tables from the Drizzle schema instead.

After `drizzle-kit migrate`, in the folder of the app, with `DATABASE_URL` set:

```bash
npx @p9s/cli postgres migrate --config p9s.config.json
```

It runs in one transaction, creates the role `app_user`, brings the rows of the link tables into the graph, and from
then on keeps the graph in step with them.

The schema of Drizzle does not change. Keep migrating with `drizzle-kit generate` and `drizzle-kit migrate`, which
compare the schema with the snapshots of earlier migrations, and never with the database. `drizzle-kit push` compares
it with the database, and would turn RLS off and drop the tables and views of p9s, which it does not know.

## After

[`adopt.patch`](./adopt.patch) is what [`p9s adopt`](../../../packages/cli/src/adopt) writes: `src/p9s.ts`, which exports
the identity `users` of the config, and the 403 of refused writes in `app.onError`. [`after.patch`](./after.patch) is
the rest, by hand: it deletes `src/permissions.ts` and its checks, and runs the queries of each request as its user with
`withUser` of [`@p9s/drizzle`](../../../packages/drizzle):

```ts
import { users } from "./p9s.ts";

app.get("/projects", async c => c.json(await withUser(db, users, c.get("userId"), tx =>
  tx.select({ id: projects.id, name: projects.name }).from(projects).orderBy(asc(projects.id)), { readOnly: true })));
```

The policies decide what each query reads and writes. A write they refuse fails with `insufficient_privilege`, which
Drizzle wraps in a `DrizzleQueryError`, and the app answers with 403 when `isRefused(error)` of `@p9s/postgres` says so.
An update or a delete of a document the user reads but cannot change returns no row, and gets 403 too. The app keeps
writing its own tables: sharing a document is still an insert into `document_shares`, which p9s checks gives no more
than the user has.

## The test

[`adoption.test.ts`](./adoption.test.ts) runs the app before, the migration, and the app after on a real Postgres, and
checks that every user gets the same answers, see [the adoption tests](../adoption):

```bash
P9S_ADOPTION_DATABASE_URL=postgresql://postgres@localhost:5432/postgres bun test examples/integrations/drizzle
```
