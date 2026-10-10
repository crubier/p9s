---
sidebar_position: 6
---

# Kysely

[`@p9s/kysely`](https://github.com/crubier/p9s/tree/main/packages/kysely) runs a Kysely transaction as a user. Without an ORM, [`run`](./postgres#run) of `@p9s/postgres` does the same on a pool of node-postgres or Neon.

Guide: [Kysely and node-postgres](../integrations/kysely). Example: [Kysely](https://github.com/crubier/p9s/tree/main/examples/integrations/kysely), a Hono app adopting p9s.

## Install

```bash
npm install @p9s/kysely @p9s/postgres
```

`kysely` 0.27 or later is a peer dependency. The identity comes from [`createIdentity`](./postgres#createidentity) of `@p9s/postgres`.

## withUser

```ts
import { withUser } from "@p9s/kysely";
import { users } from "./p9s.ts";

const documents = await withUser(db, users, userId, trx =>
  trx.selectFrom("documents").select(["id", "title"]).orderBy("id").execute(), { readOnly: true });
```

`withUser(db, identity, userId, fn, options?)` runs `fn(trx)` in a Kysely transaction, `db.transaction().execute(fn)`, as the user, and returns what it returns. It runs `set transaction read only` first for `readOnly`, rather than the access mode of the transaction, which some dialects leave out, then `select set_config(...)` of the settings of the user, so every query of `trx` goes through the policies.

| Parameter | |
| --- | --- |
| `db` | A `Kysely<DB>` on Postgres |
| `identity` | The [`Identity`](./postgres#identity) of the config |
| `userId` | The id of the user, or `null` or `undefined` for no one |
| `fn` | The queries of the user, given the `Transaction<DB>` |
| `options` | `readOnly`, `role` and `settings`, as for [`Identity`](./postgres#identity) |

It commits when `fn` returns, and rolls back and throws again when it throws. A role that is not one of `engine.users` or `engine.graphWriters` throws, and the transaction rolls back. A write the policies refuse throws the error of the driver, which [`isRefused`](./postgres#isrefused) tells.
