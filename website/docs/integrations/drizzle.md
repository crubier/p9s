---
sidebar_position: 2
---

# Drizzle

`withUser` of [`@p9s/drizzle`](https://github.com/crubier/p9s/tree/main/packages/drizzle) runs a Drizzle transaction as a user. [`examples/integrations/drizzle`](https://github.com/crubier/p9s/tree/main/examples/integrations/drizzle) adopts p9s in a Hono and Drizzle app with it, and [`examples/apps/nextjs-drizzle`](https://github.com/crubier/p9s/tree/main/examples/apps/nextjs-drizzle) is a complete Next.js app built that way.

The reference of each function, its options and its errors: [`@p9s/drizzle`](../packages/drizzle) and [`@p9s/postgres`](../packages/postgres).

## p9s adopt

```bash
npx @p9s/cli adopt
```

[`p9s adopt`](../packages/cli#adopt) adds `@p9s/postgres` and `@p9s/drizzle` to `package.json`, writes `src/p9s.ts`, which exports the identity `users` of [the config](#config), and in a Hono app, answers 403 to refused writes with `app.onError`. Then run the queries of each request with `withUser(db, users, userId, tx => ...)`, and delete the permission checks, as in [the example](#the-example).

## Install

```bash
npm install @p9s/drizzle @p9s/postgres
npm install --save-dev @p9s/cli
```

## Config

`createIdentity` reads the role and the setting from [the config](./adopting#the-config):

```ts
import { createIdentity } from "@p9s/postgres";
import config from "./p9s.config.json";

const users = createIdentity(config);
```

`generateConfigurationFromDrizzleSchema` of `@p9s/drizzle` can derive the tables from the Drizzle schema instead, so that they follow it.

## Each request as its user

```ts
import { withUser } from "@p9s/drizzle";

app.get("/projects", async c => c.json(await withUser(db, users, c.get("userId"), tx =>
  tx.select({ id: projects.id, name: projects.name }).from(projects).orderBy(asc(projects.id)), { readOnly: true })));
```

`withUser` takes the database of `drizzle-orm/node-postgres`, `neon-serverless`, `pglite` or any other driver with interactive transactions. It commits when the function returns, and rolls back when it throws.

## Refused writes

Drizzle wraps the error of Postgres in a `DrizzleQueryError`, which `isRefused(error)` of `@p9s/postgres` sees through:

```ts
import { isRefused } from "@p9s/postgres";

app.onError((error, c) => isRefused(error) ? c.json({ error: "forbidden" }, 403) : c.json({ error: "internal" }, 500));
```

An update or a delete of a row the user reads but cannot change returns no row with `.returning()`.

## The migration

After `drizzle-kit migrate`:

```bash
npx @p9s/cli postgres migrate --config p9s.config.json
```

The schema of Drizzle does not change. Keep migrating with `drizzle-kit generate` and `drizzle-kit migrate`, which compare the schema with the snapshots of earlier migrations, and never with the database. `drizzle-kit push` compares it with the database, and would turn RLS off and drop the tables and views of p9s, which it does not know.

## The example

[`before/`](https://github.com/crubier/p9s/tree/main/examples/integrations/drizzle/before) checks every route with `src/permissions.ts`. [`adopt.patch`](https://github.com/crubier/p9s/blob/main/examples/integrations/drizzle/adopt.patch) is what `p9s adopt` writes: `src/p9s.ts`, and `app.onError`. [`after.patch`](https://github.com/crubier/p9s/blob/main/examples/integrations/drizzle/after.patch) is the rest, by hand: it deletes `src/permissions.ts` and its checks, and runs the queries of each request as its user with `withUser`.

## Benchmark

The [example](https://github.com/crubier/p9s/tree/main/examples/integrations/drizzle) before p9s and after p9s, each on its own database with the rows of [`benchmark-seed.sql`](https://github.com/crubier/p9s/blob/main/examples/integrations/adoption/benchmark-seed.sql): 1000 users in 100 teams, 1000 projects and 20,000 documents, of which each user reads about 1200. 20 of the users send each request 600 times to each app, 4 at a time, in 3 rounds that switch which app goes first. Times are in milliseconds.

| Request | Before: median | p95 | Requests/s | After: median | p95 | Requests/s | After / before |
|---|---:|---:|---:|---:|---:|---:|---:|
| List projects `GET /projects` | 0.66 | 1.38 | 5,289 | 1.5 | 2.41 | 2,373 | 2.27× |
| List documents `GET /documents` | 4.57 | 5.68 | 857 | 7.34 | 8.56 | 535 | 1.61× |
| Read a document `GET /documents/:id` | 0.85 | 1.51 | 4,244 | 0.66 | 1.14 | 5,483 | 0.78× |
| Create a document `POST /documents` | 0.51 | 0.89 | 6,871 | 0.83 | 1.44 | 4,312 | 1.63× |
| Update a document `PATCH /documents/:id` | 0.81 | 1.35 | 4,527 | 1.07 | 1.89 | 3,102 | 1.32× |
| Share a document `PUT /documents/:id/shares/:user_id` | 0.97 | 1.63 | 3,837 | 1.08 | 1.82 | 3,278 | 1.11× |

Measured on 2026-10-10: Apple M2 Max, 12 cores, 64 GiB, Darwin 25.6.0 arm64. Bun 1.3.0, PostgreSQL 18.6, p9s 0.1.0. [How it runs](../benchmarks#the-examples).
