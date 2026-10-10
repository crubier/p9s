---
sidebar_position: 4
---

# Drizzle

[`@p9s/drizzle`](https://github.com/crubier/p9s/tree/main/packages/drizzle) runs a Drizzle transaction as a user, and derives the tables of a config from a Drizzle schema.

Guide: [Drizzle](../integrations/drizzle). Examples: [Drizzle](https://github.com/crubier/p9s/tree/main/examples/integrations/drizzle), a Hono app adopting p9s, and the full [Next.js app](https://github.com/crubier/p9s/tree/main/examples/apps/nextjs-drizzle).

## Install

```bash
npm install @p9s/drizzle @p9s/postgres
```

`drizzle-orm` 0.45 or later is a peer dependency. The identity comes from [`createIdentity`](./postgres#createidentity) of `@p9s/postgres`.

## withUser

```ts
import { withUser } from "@p9s/drizzle";
import { users } from "./p9s.ts";

const rows = await withUser(db, users, userId, tx =>
  tx.select().from(documents).orderBy(documents.id), { readOnly: true });
```

`withUser(db, identity, userId, fn, options?)` runs `fn(tx)` in a Drizzle transaction as the user, and returns what it returns. Every query of `tx` goes through the policies. It begins with `accessMode: "read only"` for `readOnly`, and runs `select set_config(...)` of the settings of the user first, so they end with the transaction.

| Parameter | |
| --- | --- |
| `db` | A Postgres database of Drizzle: anything with `transaction(fn, config)`, so a database of another copy of `drizzle-orm` fits too |
| `identity` | The [`Identity`](./postgres#identity) of the config |
| `userId` | The id of the user, or `null` or `undefined` for no one |
| `fn` | The queries of the user, given the transaction |
| `options` | `readOnly`, `role` and `settings`, as for [`Identity`](./postgres#identity) |

It commits when `fn` returns, and rolls back and throws again when it throws. A role that is not one of `engine.users` or `engine.graphWriters` throws, and the transaction rolls back. A write the policies refuse throws a `DrizzleQueryError`, whose `cause` is the error of Postgres, which [`isRefused`](./postgres#isrefused) tells.

## generateConfigurationFromDrizzleSchema

```ts
import { generateConfigurationFromDrizzleSchema } from "@p9s/drizzle";
import * as schema from "./schema.ts";

export const config = generateConfigurationFromDrizzleSchema(schema, {
  users: ["app_user"],
  tables: {
    folders: { resourceParent: { column: "parent_id", table: "folders", key: "id" } },
    documents: { resourceParent: { column: "folder_id", table: "folders", key: "id" }, permission: { app_user: { select: 0, update: 1 } } },
  },
  engine: { authentication: { setting: "app.user_id" } },
});
```

`generateConfigurationFromDrizzleSchema(schema, options)` returns a [config](./core) with a table for each Postgres table of the module, keeping its schema when it is not `public`. A table is a resource unless `isResource: false`, and a role when its name is one of `users`, `groups`, `teams`, `tokens`, `members`, `accounts` or `roles`, singular or plural, unless `isRole` says otherwise.

| Option | |
| --- | --- |
| `users` | The roles of `engine.users` |
| `schema` | `engine.schema`, when it is not `public` |
| `tables` | For each table name: `isResource`, `isRole`, `resourceId`, `resourceFkey`, `resourceParent`, `resourceLeaf`, `roleId`, `roleFkey`, `roleParent`, `roleLeaf`, `softDelete`, `search` and `permission`, as in [the config](../configuration/overview) |
| `engine` | The rest of `engine`, merged over `users` and `schema` |
| `migration` | `migration` of the config |

`permission` keeps bit 0, as values are positions in the bitmap. `extractTablesFromDrizzleSchema(schema)` returns the Postgres tables of a module, which it reads. `p9s drizzle configure` of [the CLI](./cli#drizzle-configure) does the same from the command line.
