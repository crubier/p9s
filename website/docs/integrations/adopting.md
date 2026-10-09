---
sidebar_position: 1
---

# Adopting p9s in an existing app

An app with users, teams and shares checks its permissions in its code: queries join memberships and shares to filter what each user sees, and a check runs before every update and delete. Adopting p9s moves those checks into Postgres, in the same four steps in every stack:

1. Describe the tables in `p9s.config.json`.
2. Run the migration of p9s, one command.
3. Run each request in a transaction as its user, with the package of the stack.
4. Delete the permission code, and answer 403 to a write the policies refuse.

Each stack has [an example](https://github.com/crubier/p9s/tree/main/examples/adoption) that does exactly that to the same small app, and a test that checks every user gets the same answers before and after.

| Stack | Package | Each request as its user | Example |
| --- | --- | --- | --- |
| [Drizzle](./drizzle) | `@p9s/drizzle` | `withUser(db, users, userId, tx => ...)` | [Drizzle](https://github.com/crubier/p9s/tree/main/examples/drizzle) |
| [Prisma](./prisma) | `@p9s/prisma` | `withUser(prisma, users, userId, tx => ...)` | [Prisma](https://github.com/crubier/p9s/tree/main/examples/prisma) |
| [Kysely and node-postgres](./kysely) | `@p9s/kysely`, `@p9s/postgres` | `withUser(db, users, userId, trx => ...)` | [Kysely](https://github.com/crubier/p9s/tree/main/examples/kysely) |
| [PostGraphile](../configuration/postgraphile) | `@p9s/postgres` | `pgSettings: users.pgSettings(userId)` | [PostGraphile](https://github.com/crubier/p9s/tree/main/examples/postgraphile-rls) |
| [Supabase](./supabase) | none, a preset | the JWT of the user | [Supabase](https://github.com/crubier/p9s/tree/main/examples/supabase) |
| [SQLAlchemy and FastAPI](./sqlalchemy) | `p9s[sqlalchemy]` | `with as_user(session, users, user_id):` | [FastAPI](https://github.com/crubier/p9s/tree/main/examples/fastapi) |
| [Django](./django) | `p9s[django]` | `P9sMiddleware` | [Django](https://github.com/crubier/p9s/tree/main/examples/django) |
| [Rails](./rails) | the `p9s` gem | `include P9s::Controller` | [Rails](https://github.com/crubier/p9s/tree/main/examples/rails) |
| [Go](./go) | `github.com/crubier/p9s/packages/go` | `p9sgorm.AsUser(ctx, db, users, userID, func(tx) error)` | [GORM](https://github.com/crubier/p9s/tree/main/examples/gorm) |
| [Rust](./rust) | the `p9s` crate | the `UserTx` extractor | [axum](https://github.com/crubier/p9s/tree/main/examples/axum) |
| [Elixir](./elixir) | `p9s` on Hex | `use P9s.Controller` | [Phoenix](https://github.com/crubier/p9s/tree/main/examples/phoenix) |
| [Laravel](./laravel) | `p9s/laravel` | the `AsUser` middleware | [Laravel](https://github.com/crubier/p9s/tree/main/examples/laravel) |

Any other client runs one statement at the start of each transaction, see [other stacks](./other-stacks).

## The config

The config says which tables are roles and resources, and where the app already keeps its memberships and shares. The packages of every language read the role and the setting from it too, so it lives at the root of the app:

```json
{
  "$schema": "https://p9s.vercel.app/p9s.config.schema.json",
  "engine": {
    "users": ["app_user"],
    "authentication": {
      "getCurrentUserId": "current_role_id",
      "setting": "app.user_id",
      "key": { "table": "users", "column": "id" }
    },
    "grantPrivileges": true,
    "permission": { "bitmap": { "size": 8, "names": { "read": 0, "write": 1, "delete": 2 } } }
  },
  "tables": [
    { "name": "users", "isRole": true, "roleId": "role_id" },
    { "name": "teams", "isRole": true, "roleId": "role_id" },
    { "name": "projects", "isResource": true, "resourceId": "resource_id", "permission": { "app_user": { "select": 0 } } },
    {
      "name": "documents",
      "isResource": true,
      "resourceId": "resource_id",
      "resourceParent": { "column": "project_id", "table": "projects", "key": "id" },
      "permission": { "app_user": { "select": 0, "insert": 1, "update": 1, "delete": 2 } }
    }
  ],
  "links": [
    {
      "name": "team_members",
      "kind": "role",
      "parent": { "column": "team_id", "table": "teams", "key": "id" },
      "child": { "column": "user_id", "table": "users", "key": "id" }
    },
    {
      "name": "project_shares",
      "kind": "assignment",
      "resource": { "column": "project_id", "table": "projects", "key": "id" },
      "role": { "column": "team_id", "table": "teams", "key": "id" },
      "permission": { "column": "access", "values": { "viewer": ["read"], "editor": ["read", "write"], "owner": ["read", "write", "delete"] } }
    }
  ]
}
```

- `users` and `teams` are roles, `projects` and `documents` resources, and a document is in its project, so a share of a project reaches its documents.
- `links` name the tables of memberships and shares the app already has. The migration brings their rows into the graph, and triggers keep it in step with them: the app keeps writing them as before, and p9s checks that a share gives no more than its author has. `permission.values` turns the values of a column into the bits they give.
- With `authentication.key`, the app sets the id of the user in its own `users` table, and p9s finds the role of that user.
- With `grantPrivileges`, the migration grants `app_user` the statements its permissions name. A permission that leaves out an operation refuses it.

`$schema` gives completion and checks in editors, see [the CLI](../packages/cli#the-json-schema-of-the-config), and `p9s validate config` checks the rest. [Links](../configuration/overview#links-configuration) and [acting as a user](../configuration/identity) tell more.

## The migration

After the migrations of the app, in its folder, with `DATABASE_URL` set:

```bash
npx @p9s/cli postgres migrate --config p9s.config.json
```

It runs in one transaction, creates the role `app_user`, brings the rows of the links into the graph, and does nothing when the database already ran it. Without Node, a [standalone binary](../packages/cli) does the same. `p9s postgres status` tells whether the database is up to date, and `p9s postgres doctor` checks it.

To run p9s with the other migrations of the app instead, `p9s postgres generate --format <tool>` writes a migration of Alembic, Django, Rails, goose, sqlx, Ecto or Laravel, see [the CLI](../packages/cli#in-the-format-of-a-migration-tool). Generate it again when the config changes.

## Each request as its user

The app connects as before, as the owner of its tables, and its server runs each request in a transaction that takes the role `app_user` and sets the id of the user, which the package of the stack does in one line. The settings end with the transaction, so a pooled connection never keeps the identity of a previous request. The queries of the app do not change: the policies filter the rows each one reads, and refuse the writes the user may not make. Its migrations, seeds and jobs keep running as the owner, outside of that.

## Refused writes

Postgres refuses a row the policies do not let through, a statement the role has no privilege for, and a share of bits the user does not have, with `insufficient_privilege`, code `42501`. Each package has a function that tells, through the errors of the ORM, for an error handler that answers 403. An update or a delete of a row the user reads but cannot change is not an error: it touches no row, which the app answers with 403 too.

## The test of each example

Each example has `before/`, the app as it was, `p9s.config.json`, and `after.patch`, the change that adopts p9s. Its test, run in CI on Postgres, takes a fresh copy of `before/`, creates its database with its own migrations and seeds it, and records what each user can read, create, update, delete and share through its API. Then it runs the migration of p9s as one command, checks the database as each user, applies the patch, and checks that the API gives every user the same answers. With the format of its migration tool, it also makes a new database with the migrate command of the app alone. See [the adoption tests](https://github.com/crubier/p9s/tree/main/examples/adoption).
