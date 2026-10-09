# Adopting p9s in a PostGraphile app

A [PostGraphile](https://postgraphile.org) API for projects and documents, as the [adoption tests](../adoption)
describe it: teams get access to projects, users to documents. Like most PostGraphile apps, it runs every request as a
database role and lets RLS decide, with policies written by hand. [`examples/postgraphile`](../postgraphile) is a full
app built on p9s from the start, this one adopts it.

## Before

[`before/`](./before) is the app as it was. Its [migration](./before/migrations/committed), run by
[graphile-migrate](https://github.com/graphile/migrate), makes the tables, the role `app_user`, and what decides who
reads and writes what: functions that work out the bits of the current user from `team_members`, `project_shares`
and `document_shares`, a policy for each statement on `projects` and `documents`, and a trigger that checks the shares
of documents.

[`src/graphql.ts`](./before/src/graphql.ts) runs each request as `app_user`, with the id of the user in `app.user_id`.
[`src/server.ts`](./before/src/server.ts) serves the GraphQL API on `/graphql`, and the routes the tests call, each a
GraphQL operation run in the process as its user, as the front end would send it.

## The migration

[`p9s.config.json`](./p9s.config.json) says what the policies said, as data: users and teams are roles, projects and
documents are resources, a document is in its project. Its `links` name the tables where the app keeps memberships and
shares, and which bits each access gives. With `authentication.key`, p9s reads the user from the same `app.user_id`,
and with `engine.postgraphile`, it hides its tables and functions from the API, and gives projects and documents a
`permission` field.

The patch adds a migration that drops the policies, the trigger and their functions. After `graphile-migrate migrate`,
in the folder of the app, with `DATABASE_URL` set:

```bash
npx @p9s/cli postgres migrate --config p9s.config.json
```

It runs in one transaction, brings the rows of the link tables into the graph, and from then on keeps the graph in step
with them.

## After

[`after.patch`](./after.patch) adds that migration, and takes the settings of each request from the config:

```ts
const users = createIdentity(config);

grafast: {
  context: requestContext => ({ pgSettings: users.pgSettings(userIdOf(requestContext)) }),
},
```

The routes and their operations stay the same, and the policies of p9s answer them. A write they
refuse fails with `insufficient_privilege`, which the app answers with 403 when `isRefused(error)` of `@p9s/postgres`
says so. PostGraphile answers an update of a document the user reads but cannot change with no document, and its
delete with an error of its own, both 403 too.

## The test

[`adoption.test.ts`](./adoption.test.ts) runs the app before, the migration, and the app after on a real Postgres, and
checks that every user gets the same answers, see [the adoption tests](../adoption):

```bash
P9S_ADOPTION_DATABASE_URL=postgresql://postgres@localhost:5432/postgres bun test examples/postgraphile-rls
```
