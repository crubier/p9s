---
sidebar_position: 5
---

# Prisma

[`@p9s/prisma`](https://github.com/crubier/p9s/tree/main/packages/prisma) runs Prisma queries as a user: several in an interactive transaction with `withUser`, or each in a transaction of its own with `userClient`.

Guide: [Prisma](../integrations/prisma). Example: [Prisma](https://github.com/crubier/p9s/tree/main/examples/integrations/prisma), a Hono app adopting p9s.

## Install

```bash
npm install @p9s/prisma @p9s/postgres
```

`@prisma/client` 6 or later is a peer dependency. The identity comes from [`createIdentity`](./postgres#createidentity) of `@p9s/postgres`.

## withUser

```ts
import { withUser } from "@p9s/prisma";
import { users } from "./p9s.ts";

const document = await withUser(prisma, users, userId, tx =>
  tx.document.create({ data: { projectId, title } }));
```

`withUser(prisma, identity, userId, fn, options?)` runs `fn(tx)` in an interactive transaction, `prisma.$transaction(fn)`, as the user, and returns what it returns. It runs the statement of the user first, with `transaction_read_only` for `readOnly`, so every query of `tx` goes through the policies.

| Parameter | |
| --- | --- |
| `prisma` | A Prisma client, or anything with an interactive `$transaction` |
| `identity` | The [`Identity`](./postgres#identity) of the config |
| `userId` | The id of the user, or `null` or `undefined` for no one |
| `fn` | The queries of the user, given the transaction client |
| `options` | `readOnly`, `role` and `settings`, as for [`Identity`](./postgres#identity) |

It commits when `fn` returns, and rolls back and throws again when it throws.

## userClient

```ts
import { userClient } from "@p9s/prisma";

const db = userClient(prisma, users, userId, { readOnly: true });
const projects = await db.project.findMany();
```

`userClient(prisma, identity, userId, options?)` returns a client of the same type whose every query runs as the user, each in a batch transaction of its own that begins with the settings of the user. It is a query extension, `prisma.$extends`, so a client per request is cheap. For several queries in one transaction, use `withUser`.

## Errors

A write the policies refuse throws a `PrismaClientKnownRequestError`, with the error of Postgres in `meta.driverAdapterError.cause`, which [`isRefused`](./postgres#isrefused) tells. An update or a delete of a row the user reads but cannot change is no error: the example updates and deletes with `updateMany` and `deleteMany`, whose count is 0 for such a row, and answers 403. A role that is not one of `engine.users` or `engine.graphWriters` throws, and the transaction rolls back.
