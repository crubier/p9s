---
sidebar_position: 3
---

# PostGraphile

PostGraphile runs every request as a database role and lets RLS decide, so p9s needs no package of its own there: `pgSettings` of `@p9s/postgres` gives each request the role and the user of the config, and with `engine.postgraphile`, the migration serves the graph through the API. [`examples/integrations/postgraphile-rls`](https://github.com/crubier/p9s/tree/main/examples/integrations/postgraphile-rls) adopts p9s in a PostGraphile app whose policies were written by hand, and [`examples/apps/postgraphile`](https://github.com/crubier/p9s/tree/main/examples/apps/postgraphile) is a complete app built on p9s from the start.

The reference of each function, its options and its errors: [`@p9s/postgres`](../packages/postgres).

## p9s adopt

```bash
npx @p9s/cli adopt
```

[`p9s adopt`](../packages/cli#adopt) adds `@p9s/postgres` to `package.json`, and writes `src/p9s.ts`, which exports the identity `users` of [the config](#config). Then give `pgSettings` the settings of `users`, and drop the policies written by hand, as in [the example](#the-example).

## Install

```bash
npm install @p9s/postgres
npm install --save-dev @p9s/cli
```

## Config

[The config](./adopting#the-config) says what the policies said, as data. With `engine.postgraphile`, the migration also hides the tables and functions of p9s from the API, and gives each resource type a `permission` field:

```json
{
  "$schema": "https://p9s.vercel.app/p9s.config.schema.json",
  "engine": {
    "users": ["app_user"],
    "authentication": { "getCurrentUserId": "current_role_id", "setting": "app.user_id", "key": { "table": "users", "column": "id" } },
    "grantPrivileges": true,
    "postgraphile": true,
    "permission": { "bitmap": { "size": 8, "names": { "read": 0, "write": 1, "delete": 2 } } }
  }
}
```

The tables and links are those of [the config](./adopting#the-config) of every stack. `createIdentity` reads the role and the setting from it:

```ts
import { createIdentity } from "@p9s/postgres";
import config from "./p9s.config.json";

const users = createIdentity(config);
```

## Each request as its user

`pgSettings` gives the settings PostGraphile sets in the transaction of each request, the role of `engine.users` and the id of the user:

```ts
export const preset: GraphileConfig.Preset = {
  extends: [PostGraphileAmberPreset],
  grafast: {
    context: requestContext => ({ pgSettings: users.pgSettings(userIdOf(requestContext)) }),
  },
};
```

`users.pgSettings(userId, { readOnly: true })` also makes the transaction read only. The queries and mutations of the front end do not change: the policies of p9s answer them, and each type gains a `permission` field, like `permission { read write }`, see [PostGraphile](../configuration/postgraphile) for the views, the functions and the sharing mutations it serves.

## Refused writes

A write the policies refuse fails with `insufficient_privilege`, which PostGraphile returns as a GraphQL error, and `isRefused(error)` of `@p9s/postgres` tells. PostGraphile answers an update of a row the user reads but cannot change with no row, and its delete with an error of its own, for the app to answer 403 too.

## The migration

After `graphile-migrate migrate`:

```bash
npx @p9s/cli postgres migrate --config p9s.config.json
```

An app that wrote its policies by hand drops them first, in a migration of its own, with the functions and triggers they used. `graphile-migrate` compares nothing with the database, so it leaves the tables of p9s alone.

## The example

[`before/`](https://github.com/crubier/p9s/tree/main/examples/integrations/postgraphile-rls/before) decides who reads and writes what in its migration: functions that work out the bits of the current user from `team_members`, `project_shares` and `document_shares`, a policy for each statement on `projects` and `documents`, and a trigger that checks the shares of documents. [`adopt.patch`](https://github.com/crubier/p9s/blob/main/examples/integrations/postgraphile-rls/adopt.patch) is what `p9s adopt` writes: `src/p9s.ts`. [`after.patch`](https://github.com/crubier/p9s/blob/main/examples/integrations/postgraphile-rls/after.patch) is the rest, by hand: it adds a migration that drops them, and takes the settings of each request from `users`. The routes and their GraphQL operations stay the same, and its test checks that every user gets the same answers before and after.

## Benchmark

The [example](https://github.com/crubier/p9s/tree/main/examples/integrations/postgraphile-rls) before p9s and after p9s, each on its own database with the rows of [`benchmark-seed.sql`](https://github.com/crubier/p9s/blob/main/examples/integrations/adoption/benchmark-seed.sql): 1000 users in 100 teams, 1000 projects and 20,000 documents, of which each user reads about 1200. 20 of the users send each request 600 times to each app, 4 at a time, in 3 rounds that switch which app goes first. Times are in milliseconds, and the app has no endpoint that counts.

| Request | Before: median | p95 | Requests/s | After: median | p95 | Requests/s | After / before |
|---|---:|---:|---:|---:|---:|---:|---:|
| List projects `GET /projects` | 12.08 | 30.71 | 281 | 2.24 | 3.2 | 1,708 | 0.19× |
| List documents `GET /documents` | 294.51 | 307.15 | 13 | 12.67 | 16.02 | 311 | 0.04× |
| Read a document `GET /documents/:id` | 0.63 | 1.08 | 5,835 | 0.99 | 1.66 | 3,687 | 1.57× |
| Create a document `POST /documents` | 0.62 | 1.27 | 5,533 | 1.14 | 1.99 | 3,122 | 1.84× |
| Update a document `PATCH /documents/:id` | 1.11 | 2.11 | 3,262 | 2.19 | 3.45 | 1,694 | 1.97× |
| Share a document `PUT /documents/:id/shares/:user_id` | 1.36 | 2.39 | 2,695 | 2.18 | 3.45 | 1,690 | 1.60× |

Measured on 2026-10-10: Apple M2 Max, 12 cores, 64 GiB, Darwin 25.6.0 arm64. Bun 1.3.0, PostgreSQL 18.6, p9s 0.1.0. [How it runs](../benchmarks#the-examples).
