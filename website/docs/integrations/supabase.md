---
sidebar_position: 6
---

# Supabase

PostgREST runs the requests of signed in users as the `authenticated` role, with the claims of their JWT in settings, and `auth.uid()` reads their id from them. The `supabase` preset of `@p9s/core` uses these: the policies are for `authenticated`, the current user is `auth.uid()`, ids are uuids, and `service_role` writes the graph. `anon` reads nothing.

The reference of each function, its options and its errors: [`@p9s/core`](../packages/core), for the preset, and [`@p9s/postgres`](../packages/postgres).

## Configuration

```bash
npm install @p9s/core @p9s/postgres
npm install --save-dev @p9s/cli
```

The table of profiles is a role table whose role id is `id`, the id of the user in `auth.users`, so that `auth.uid()` is the role id of the user:

```ts
// p9s.config.ts
import { supabase, type Config } from "@p9s/core";

const permission = { authenticated: { select: 0, insert: 1, update: 2, delete: 3, share: 4 } };

export default {
  engine: { ...supabase },
  tables: [
    { name: "profiles", isRole: true, roleId: "id" },
    { name: "project", isResource: true, permission },
    { name: "task", isResource: true, resourceParent: { column: "project_id", table: "project", key: "id" }, permission },
  ],
} satisfies Config<"authenticated">;
```

`p9s init --users authenticated` proposes the tables of such a config from the tables and foreign keys of the database, then replace its `engine` with the preset. Index the parent columns, like `task (project_id)`: p9s looks rows up by them, and [`p9s postgres doctor`](../packages/cli#doctor) tells which are missing.

### Apps with a users table of their own

An app whose users have ids of its own, rather than the uuids of `auth.users`, keeps them: with `claim`, p9s reads the user from a claim of the JWT, which a [custom access token hook](https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook) or [third party auth](https://supabase.com/docs/guides/auth/third-party/overview) gives, and with `key`, finds them in the users table, see [a claim of the JWT](../configuration/identity#a-claim-of-the-jwt):

```json
{
  "engine": {
    "users": ["authenticated"],
    "graphWriters": ["service_role"],
    "authentication": {
      "getCurrentUserId": "current_role_id",
      "setting": "request.jwt.claims",
      "claim": "sub",
      "key": { "table": "users", "column": "id" }
    },
    "grantPrivileges": true
  }
}
```

[`examples/integrations/supabase`](https://github.com/crubier/p9s/tree/main/examples/integrations/supabase) moves such an app, whose server read and wrote everything with the service role key, to requests that run as the user, with `npx @p9s/cli postgres migrate`, and tests it end to end. [`adopt.patch`](https://github.com/crubier/p9s/blob/main/examples/integrations/supabase/adopt.patch) is what [`p9s adopt`](../packages/cli#adopt) writes there: the 403 of refused writes, in `app.onError` of its Hono server. [`after.patch`](https://github.com/crubier/p9s/blob/main/examples/integrations/supabase/after.patch) is the rest, by hand: the migration of grants, and requests with the JWT of the user instead of the service role key.

## Migration

Generate the migration into the migrations of the Supabase CLI, and apply it like the others:

```bash
npx p9s postgres generate --config p9s.config.ts --output supabase/migrations/20261008120000_p9s.sql
npx supabase db push
```

After a change of the config, or an upgrade of p9s, generate a new migration file the same way: the migration runs again on a database that ran an earlier one, see [upgrading](../configuration/upgrading).

Supabase gives `anon` and `authenticated` every privilege on the new tables, sequences and functions of `public`. The migration takes back what they have on the objects of p9s, so neither reads the graph or calls its internal functions, and grants `authenticated` what the [security model](../configuration/security-model#database-roles) gives users.

The tables of the app keep the privileges Supabase gave them, which p9s never takes back: a signed in user could join a team by inserting into its memberships through the API. Take them back in a migration of the app, and let `grantPrivileges` grant what the config names:

```sql
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
```

## Reading and writing

With supabase-js, every request goes through the policies:

```ts
const { data: tasks } = await supabase.from("task").select("id, title");
const { data: task } = await supabase.from("task").insert({ project_id: projectId, title: "Write the docs" }).select().single();
```

A user creates a task in a project where they have the insert bit, and reads it back with the select bit. To create a project at the top of the tree, a user needs a parent, so give projects a parent column, like a workspace, or create them from a server with `service_role`, then assign them:

```sql
-- $1: the id of the project, $2: the id of the user, every bit of the default 128
insert into assignment_edge (resource_id, role_id, permission)
select resource_id, $2, ~ b'0'::bit(128) from project where id = $1;
```

Users share what they have the `share` bit on with `resource_share`, see [sharing](../configuration/security-model#sharing).

## Servers that connect directly

A server that connects with the connection string, through Drizzle, Prisma or node-postgres, sets the claim `auth.uid()` reads rather than a setting of p9s:

```ts
import { createIdentity } from "@p9s/postgres";
import config from "./p9s.config";

const users = createIdentity(config, { setting: "request.jwt.claim.sub" });
await users.run(pool, userId, client => client.query("select id, title from task"));
```

The role of the connection string must be able to take the role `authenticated`. See [acting as a user](../configuration/identity) for Drizzle and Prisma.

## Checking the database

```bash
npx p9s postgres status --config p9s.config.ts --database-url "$DATABASE_URL"
npx p9s postgres doctor --config p9s.config.ts --database-url "$DATABASE_URL"
```

`status` tells whether the database ran the migration of this config, and `doctor` checks the roles, RLS, grants, indexes, JIT and caches. Use the direct connection string, or the session pooler.

## Benchmark

The [example](https://github.com/crubier/p9s/tree/main/examples/integrations/supabase) before p9s and after p9s, each on its own database with the rows of [`benchmark-seed.sql`](https://github.com/crubier/p9s/blob/main/examples/integrations/adoption/benchmark-seed.sql): 1000 users in 100 teams, 1000 projects and 20,000 documents, of which each user reads about 1200. 20 of the users send each request 600 times to each app, 4 at a time, in 3 rounds that switch which app goes first. Times are in milliseconds, and the app has no endpoint that counts.

| Request | Before: median | p95 | Requests/s | After: median | p95 | Requests/s | After / before |
|---|---:|---:|---:|---:|---:|---:|---:|
| List projects `GET /projects` | 2.03 | 2.83 | 1,626 | 2.08 | 2.7 | 1,855 | 1.02× |
| List documents `GET /documents` | 4.53 | 5.46 | 870 | 9.72 | 11.96 | 404 | 2.15× |
| Read a document `GET /documents/:id` | 2.99 | 3.91 | 1,289 | 1.16 | 1.64 | 3,272 | 0.39× |
| Create a document `POST /documents` | 1.87 | 2.66 | 1,982 | 1.06 | 1.72 | 3,404 | 0.57× |
| Update a document `PATCH /documents/:id` | 2.81 | 3.55 | 1,384 | 1.92 | 2.74 | 1,945 | 0.68× |
| Share a document `PUT /documents/:id/shares/:user_id` | 3.24 | 4.04 | 1,211 | 2.29 | 3.04 | 1,669 | 0.71× |

Measured on 2026-10-10: Apple M2 Max, 12 cores, 64 GiB, Darwin 25.6.0 arm64. Bun 1.3.0, PostgreSQL 18.6, p9s 0.1.0. [How it runs](../benchmarks#the-examples).
