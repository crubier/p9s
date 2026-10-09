---
sidebar_position: 3
---

# Prisma

[`@p9s/prisma`](https://github.com/crubier/p9s/tree/main/packages/prisma) runs Prisma queries as a user, in an interactive transaction with `withUser`, or each in a transaction of its own with `userClient`. [`examples/prisma`](https://github.com/crubier/p9s/tree/main/examples/prisma) adopts p9s in a Hono and Prisma app with it.

## Install

```bash
npm install @p9s/prisma @p9s/postgres
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
import { userClient, withUser } from "@p9s/prisma";

app.get("/projects", async c => c.json(await withUser(prisma, users, c.get("userId"), tx =>
  tx.project.findMany({ select: { id: true, name: true }, orderBy: { id: "asc" } }), { readOnly: true })));

// Every query in a transaction of its own, as the user
const documents = await userClient(prisma, users, userId).document.findMany();
```

`userClient` is a [client extension](https://www.prisma.io/docs/orm/prisma-client/client-extensions) that sends each query in a batch transaction after the settings of the user, and keeps the types of the client.

## Refused writes

Prisma wraps the error of Postgres in a `PrismaClientKnownRequestError`, which `isRefused(error)` of `@p9s/postgres` sees through:

```ts
import { isRefused } from "@p9s/postgres";

app.onError((error, c) => isRefused(error) ? c.json({ error: "forbidden" }, 403) : c.json({ error: "internal" }, 500));
```

`update` and `delete` fail when the row is not there for the user. `updateMany` and `deleteMany` return a count of 0 for a row the user reads but cannot change, which the app answers with 403.

## The migration

After `prisma migrate deploy`:

```bash
npx @p9s/cli postgres migrate --config p9s.config.json
```

The Prisma schema does not change: p9s adds tables in its own schema, and policies, triggers and functions, which Prisma leaves alone.

## The example

[`before/`](https://github.com/crubier/p9s/tree/main/examples/prisma/before) checks every route with `src/permissions.ts`. [`after.patch`](https://github.com/crubier/p9s/blob/main/examples/prisma/after.patch) deletes it, and runs the queries of each request as its user with `withUser`.
