---
sidebar_position: 1
---

# Supabase

PostgREST runs the requests of signed in users as the `authenticated` role, with the claims of their JWT in settings, and `auth.uid()` reads their id from them. The `supabase` preset of `@p9s/core` uses these: the policies are for `authenticated`, the current user is `auth.uid()`, ids are uuids, and `service_role` writes the graph. `anon` reads nothing.

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

## Migration

Generate the migration into the migrations of the Supabase CLI, and apply it like the others:

```bash
npx p9s postgres generate --config p9s.config.ts --output supabase/migrations/20261008120000_p9s.sql
npx supabase db push
```

After a change of the config, or an upgrade of p9s, generate a new migration file the same way: the migration runs again on a database that ran an earlier one, see [upgrading](../configuration/upgrading).

Supabase gives `anon` and `authenticated` every privilege on the new tables, sequences and functions of `public`. The migration takes back what they have on the objects of p9s, so neither reads the graph or calls its internal functions, and grants `authenticated` what the [security model](../configuration/security-model#database-roles) gives users.

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
