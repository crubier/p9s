---
sidebar_position: 5
---

# Kysely and node-postgres

`withUser` of [`@p9s/kysely`](https://github.com/crubier/p9s/tree/main/packages/kysely) runs a Kysely transaction as a user, and `run` of [`@p9s/postgres`](https://github.com/crubier/p9s/tree/main/packages/postgres) does the same on a node-postgres pool, Neon or PGlite, without an ORM. [`examples/integrations/kysely`](https://github.com/crubier/p9s/tree/main/examples/integrations/kysely) adopts p9s in a Hono and Kysely app.

The reference of each function, its options and its errors: [`@p9s/kysely`](../packages/kysely) and [`@p9s/postgres`](../packages/postgres).

## p9s adopt

```bash
npx @p9s/cli adopt
```

[`p9s adopt`](../packages/cli#adopt) adds `@p9s/postgres` and `@p9s/kysely` to `package.json`, writes `src/p9s.ts`, which exports the identity `users` of [the config](#config), and in a Hono app, answers 403 to refused writes with `app.onError`. Then run the queries of each request with `withUser(db, users, userId, trx => ...)`, and delete the permission checks, as in [the example](#the-example).

## Install

```bash
npm install @p9s/kysely @p9s/postgres
npm install --save-dev @p9s/cli
```

## Config

`createIdentity` reads the role and the setting from [the config](./adopting#the-config):

```ts
import { createIdentity } from "@p9s/postgres";
import config from "./p9s.config.json";

const users = createIdentity(config);
```

## Each request as its user

```ts
import { withUser } from "@p9s/kysely";

app.get("/documents", async c => c.json(await withUser(db, users, c.get("userId"), trx =>
  trx.selectFrom("documents").select(["id", "project_id", "title"]).orderBy("id").execute(), { readOnly: true })));
```

Without an ORM, `run` takes a connection of the pool, and commits when the function returns, or rolls back when it throws:

```ts
const documents = await users.run(pool, userId, async client =>
  (await client.query("select id, title from documents order by id")).rows, { readOnly: true });
```

`statement(userId)` gives the first statement of the transaction as `{ text, values }`, for other clients, see [acting as a user](../configuration/identity#node-postgres-neon-and-pglite).

## Refused writes

```ts
import { isRefused } from "@p9s/postgres";

app.onError((error, c) => isRefused(error) ? c.json({ error: "forbidden" }, 403) : c.json({ error: "internal" }, 500));
```

An update or a delete of a row the user reads but cannot change touches no row: check `numUpdatedRows`, or `returning`.

## The migration

After the migrations of the app:

```bash
npx @p9s/cli postgres migrate --config p9s.config.json
```

## The example

[`before/`](https://github.com/crubier/p9s/tree/main/examples/integrations/kysely/before) checks every route with `src/permissions.ts`. [`adopt.patch`](https://github.com/crubier/p9s/blob/main/examples/integrations/kysely/adopt.patch) is what `p9s adopt` writes: `src/p9s.ts`, and `app.onError`. [`after.patch`](https://github.com/crubier/p9s/blob/main/examples/integrations/kysely/after.patch) is the rest, by hand: it deletes `src/permissions.ts` and its checks, and runs the queries of each request as its user with `withUser`. Sharing a document is still an insert into `document_shares`, which p9s checks gives no more than the user has.
