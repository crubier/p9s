---
sidebar_position: 1.5
---

# Acting as a user

The policies apply to the database roles of `engine.users`, and ask `getCurrentUserId()` who the user is. So every transaction of a request takes one of these roles, and tells the id of the user. With `engine.authentication.setting`, the migration creates the current user function, which reads that setting:

```ts
const config = {
  engine: {
    users: ["app_user"],
    authentication: { getCurrentUserId: "current_role_id", setting: "app.role_id" },
  },
  tables: [/* ... */],
};
```

```sql
create or replace function current_role_id() returns integer
  as $$ select nullif(current_setting('app.role_id', true), '')::integer $$
  language sql stable;
```

The id is the role id of the row of the user: the `roleId` column of a role table, or of a [role leaf table](./overview#role-leaf-tables) like API keys. A transaction of the user starts with:

```sql
begin;
select set_config('role', 'app_user', true), set_config('app.role_id', '42', true);
-- the queries of the request
commit;
```

`set_config(..., true)` only lasts until the end of the transaction, so a connection that goes back to the pool keeps nothing of the user, and a pooler in transaction mode, like PgBouncer, works. Never use `set role` or `set` for the session on a pooled connection. The role the server connects with must be a member of `app_user`: `grant app_user to app_server`. Without an id, or with an empty one, the user reads nothing.

Without `setting`, `getCurrentUserId` must exist before the migration runs, like `auth.uid()` on [Supabase](../integrations/supabase).

### The id of the user in the app

An application that already has a users table knows its users by their id in that table, not by the role id p9s gives them. With `key`, the setting holds that id, and the current user function looks the role id up:

```ts
authentication: {
  getCurrentUserId: "current_role_id",
  setting: "app.user_id",
  key: { table: "users", column: "id" },
}
```

```sql
select set_config('role', 'app_user', true), set_config('app.user_id', '7', true);
```

The key is any unique column of a role table, of any type, like an email or the subject of a token. The function runs as the owner, so the policies of the users table do not hide the row, and once per query. A key that matches no row reads as no one.

### A claim of the JWT

PostgREST, and so Supabase, sets the claims of the JWT of a request as JSON, in `request.jwt.claims`. With `claim`, the setting holds such claims, and the user is that claim of them, the role id, or with `key`, the key:

```ts
authentication: {
  getCurrentUserId: "current_role_id",
  setting: "request.jwt.claims",
  claim: "sub",
  key: { table: "users", column: "id" },
}
```

A request with a JWT whose `sub` is `7` then runs as the user 7 of the users table, with no function to write. `createIdentity` sets the same claims, `{"sub":"7"}`, for a server that connects directly. [`examples/supabase`](https://github.com/crubier/p9s/tree/main/examples/supabase) uses it.

## node-postgres, Neon and PGlite

`createIdentity` from `@p9s/postgres` builds these statements from the config:

```ts
import { createIdentity } from "@p9s/postgres";
import { p9sConfig } from "./p9s";

const users = createIdentity(p9sConfig);

// A transaction on a connection of the pool, as the user: commits when fn returns, rolls back when it throws
const documents = await users.run(pool, session.roleId, async client =>
  (await client.query("select id, title from document order by updated_at desc limit 50")).rows);

// Read only, with other settings for the triggers of the app
await users.run(pool, session.roleId, fn, { readOnly: true, settings: { "app.request_id": requestId } });

// As a graph writer of engine.graphWriters
await users.run(pool, session.roleId, fn, { role: "app_backend" });
```

For any other client, `statement(userId, options)` gives the first statement of the transaction, as `{ text, values }` with `$1` parameters. `settings(userId, options)` gives the same settings as `[name, value]` pairs, and `pgSettings(userId, options)` as an object, for servers that set them on each request, like the `pgSettings` of [PostGraphile](./postgraphile).

## Drizzle

```ts
import { withUser } from "@p9s/drizzle";

const rows = await withUser(db, users, session.roleId, tx => tx.select().from(document).limit(50), { readOnly: true });
```

`withUser` takes the database of `drizzle-orm/node-postgres`, `neon-serverless`, `pglite` or any other driver with interactive transactions. [`examples/nextjs-drizzle`](https://github.com/crubier/p9s/tree/main/examples/nextjs-drizzle) runs every request of its users that way.

## Prisma

```ts
import { userClient, withUser } from "@p9s/prisma";

// Every query runs in a transaction of its own, as the user
const posts = await userClient(prisma, users, session.roleId).post.findMany();

// Several queries in one transaction, as the user
await withUser(prisma, users, session.roleId, async tx => {
  const post = await tx.post.create({ data: { title: "Hello", folderId } });
  await tx.comment.create({ data: { body: "First", postId: post.id } });
});
```

`userClient` is a [client extension](https://www.prisma.io/docs/orm/prisma-client/client-extensions) that sends each query in a batch transaction after the settings of the user, and keeps the types of the client. Its tests run Prisma 7 with the `@prisma/adapter-pg` driver adapter.

[`examples/prisma`](https://github.com/crubier/p9s/tree/main/examples/prisma) moves a Prisma app from checks in its code to `withUser`.

## Other languages

SQLAlchemy, Django, Rails, Go, Rust, Elixir and Laravel have packages that read the config too, see [adopting p9s](../integrations/adopting), and any client that runs a transaction can do the same, see [other stacks](../integrations/other-stacks).

## Refused writes

Postgres refuses a row the policies do not let through, a statement the role has no privilege for, and a share of bits the user does not have, with `insufficient_privilege` (`42501`). Clients wrap that error: node-postgres and Kysely give it as is, Drizzle as its `cause`, Prisma in the `meta` of a `PrismaClientKnownRequestError`, supabase-js as the `error` of the query, and GraphQL servers like PostGraphile as the `originalError` of a `GraphQLError`. `isRefused` of `@p9s/postgres` looks through all of them, so an API can answer 403:

```ts
import { isRefused } from "@p9s/postgres";

app.onError((error, c) => {
  if (isRefused(error)) return c.json({ error: "forbidden" }, 403);
  throw error;
});
```

An update or a delete of a row the user reads but cannot change is not an error: the row is not there for the statement, which changes 0 rows.

## Inserting and reading back

ORMs and APIs read back the rows they insert, with `insert ... returning`. Postgres checks those rows with the select policy before the statement gives them their place in the graph, so while a statement inserts into a table, its select policy also lets a row through when its parent has the select bit, which the row gets as soon as the statement ends. A user with the insert bit but not the select bit on the parent inserts, but cannot read back.
