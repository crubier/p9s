---
sidebar_position: 2
---

# Drizzle

`withUser` of [`@p9s/drizzle`](https://github.com/crubier/p9s/tree/main/packages/drizzle) runs a Drizzle transaction as a user. [`examples/drizzle`](https://github.com/crubier/p9s/tree/main/examples/drizzle) adopts p9s in a Hono and Drizzle app with it, and [`examples/nextjs-drizzle`](https://github.com/crubier/p9s/tree/main/examples/nextjs-drizzle) is a complete Next.js app built that way.

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

[`before/`](https://github.com/crubier/p9s/tree/main/examples/drizzle/before) checks every route with `src/permissions.ts`. [`adopt.patch`](https://github.com/crubier/p9s/blob/main/examples/drizzle/adopt.patch) is what `p9s adopt` writes: `src/p9s.ts`, and `app.onError`. [`after.patch`](https://github.com/crubier/p9s/blob/main/examples/drizzle/after.patch) is the rest, by hand: it deletes `src/permissions.ts` and its checks, and runs the queries of each request as its user with `withUser`.
