---
sidebar_position: 4
---

# Prisma

[`@p9s/prisma`](https://github.com/crubier/p9s/tree/main/packages/prisma) runs Prisma queries as a user, in an interactive transaction with `withUser`, or each in a transaction of its own with `userClient`. [`examples/integrations/prisma`](https://github.com/crubier/p9s/tree/main/examples/integrations/prisma) adopts p9s in a Hono and Prisma app with it.

The reference of each function, its options and its errors: [`@p9s/prisma`](../packages/prisma) and [`@p9s/postgres`](../packages/postgres).

## p9s adopt

```bash
npx @p9s/cli adopt
```

[`p9s adopt`](../packages/cli#adopt) adds `@p9s/postgres` and `@p9s/prisma` to `package.json`, writes `src/p9s.ts`, which exports the identity `users` of [the config](#config), and in a Hono app, answers 403 to refused writes with `app.onError`. Then run the queries of each request with `withUser(prisma, users, userId, tx => ...)`, and delete the permission checks, as in [the example](#the-example).

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

[`before/`](https://github.com/crubier/p9s/tree/main/examples/integrations/prisma/before) checks every route with `src/permissions.ts`. [`adopt.patch`](https://github.com/crubier/p9s/blob/main/examples/integrations/prisma/adopt.patch) is what `p9s adopt` writes: `src/p9s.ts`, and `app.onError`. [`after.patch`](https://github.com/crubier/p9s/blob/main/examples/integrations/prisma/after.patch) is the rest, by hand: it deletes `src/permissions.ts` and its checks, and runs the queries of each request as its user with `withUser`.

## Benchmark

The [example](https://github.com/crubier/p9s/tree/main/examples/integrations/prisma) before p9s and after p9s, each on its own database with the rows of [`benchmark-seed.sql`](https://github.com/crubier/p9s/blob/main/examples/integrations/adoption/benchmark-seed.sql): 1000 users in 100 teams, 1000 projects and 20,000 documents, of which each user reads about 1200. 20 of the users send each request 600 times to each app, 4 at a time, in 3 rounds that switch which app goes first. Times are in milliseconds, and the app has no endpoint that counts.

| Request | Before: median | p95 | Requests/s | After: median | p95 | Requests/s | After / before |
|---|---:|---:|---:|---:|---:|---:|---:|
| List projects `GET /projects` | 0.71 | 1.28 | 4,947 | 2.36 | 3.41 | 1,629 | 3.32× |
| List documents `GET /documents` | 6.5 | 7.95 | 612 | 9.3 | 11.16 | 422 | 1.43× |
| Read a document `GET /documents/:id` | 0.84 | 1.48 | 4,318 | 1.2 | 1.95 | 3,048 | 1.43× |
| Create a document `POST /documents` | 0.47 | 0.86 | 7,554 | 1.16 | 1.9 | 3,078 | 2.47× |
| Update a document `PATCH /documents/:id` | 0.82 | 1.47 | 4,384 | 2.59 | 3.58 | 1,476 | 3.16× |
| Share a document `PUT /documents/:id/shares/:user_id` | 0.96 | 1.67 | 3,769 | 2.13 | 3.14 | 1,751 | 2.22× |

Measured on 2026-10-10: Apple M2 Max, 12 cores, 64 GiB, Darwin 25.6.0 arm64. Bun 1.3.0, PostgreSQL 18.6, p9s 0.1.0. [How it runs](../benchmarks#the-examples).
