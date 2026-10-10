---
sidebar_position: 3
---

# Postgres

[`@p9s/postgres`](https://github.com/crubier/p9s/tree/main/packages/postgres) generates and runs the migration of a config, checks a database against it, and runs transactions as a user with any client of Postgres: node-postgres, Neon serverless, PGlite, or a server that sets the settings of each request itself, like PostGraphile. [`@p9s/drizzle`](./drizzle), [`@p9s/prisma`](./prisma) and [`@p9s/kysely`](./kysely) take the identity it makes.

Guides: [Kysely and node-postgres](../integrations/kysely), [PostGraphile](../integrations/postgraphile), [Supabase](../integrations/supabase), [other stacks](../integrations/other-stacks). Examples: [Kysely](https://github.com/crubier/p9s/tree/main/examples/integrations/kysely), [PostGraphile](https://github.com/crubier/p9s/tree/main/examples/integrations/postgraphile-rls), [Supabase](https://github.com/crubier/p9s/tree/main/examples/integrations/supabase), and the full [PostGraphile app](https://github.com/crubier/p9s/tree/main/examples/apps/postgraphile).

## Install

```bash
npm install @p9s/postgres
```

It depends on `@p9s/core` and `pg-sql2` only, and brings no client of Postgres: it takes the one of the app.

## Acting as a user

### createIdentity

```ts
import { createIdentity } from "@p9s/postgres";
import config from "./p9s.config.json";

export const users = createIdentity(config);
```

`createIdentity(config, options?)` reads the role and the setting of a transaction of a user from `engine` of [the config](../integrations/adopting#the-config), and returns an [`Identity`](#identity). Only `engine` counts, so a config read from JSON fits.

| Option | Default | |
| --- | --- | --- |
| `setting` | `engine.authentication.setting` | The setting the current user function reads, when the migration does not create that function, like `request.jwt.claim.sub`, which `auth.uid()` of Supabase reads |
| `claim` | `engine.authentication.claim`, when `setting` is not given | The claim of the setting that holds the user, when the setting holds JSON claims |

It throws when `engine.users` is empty, and when there is no setting, neither in the config nor in the options.

### Identity

| Member | |
| --- | --- |
| `role` | The role transactions take by default, the first of `engine.users` |
| `setting` | The setting the current user function reads |
| `settings(userId, options?)` | The settings of a transaction of the user, as `[name, value]` pairs, the role first |
| `pgSettings(userId, options?)` | The same as an object, with `transaction_read_only: "on"` for `readOnly`, for servers that set the settings of each request, like `pgSettings` of PostGraphile |
| `statement(userId, options?)` | `{ text, values }` of the statement to run first in a transaction: `select set_config($1, $2, true), set_config($3, $4, true)...` |
| `run(pool, userId, fn, options?)` | Runs `fn(client)` in a transaction on a connection of the pool, as the user, and returns what it returns |

`userId` is a string, a number, a bigint, `null` or `undefined`. No user reads as no one: the setting is empty, and the policies let nothing through but what they give everyone.

The options of `settings`, `statement` and the others:

| Option | Default | |
| --- | --- | --- |
| `role` | `role` | Another role of `engine.users` or `engine.graphWriters`. Another role throws |
| `settings` | none | Other settings of the transaction, like those an audit trigger reads. `null` and `undefined` set them empty |
| `readOnly` | `false` | `run` begins `read only`, `pgSettings` adds `transaction_read_only`. Not for `settings` and `statement` |

Every setting is set with `set_config(name, value, true)`, so it ends with the transaction, and a pooled connection never keeps the identity of a previous request.

### run

```ts
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const titles = await users.run(pool, userId, async client => {
  const { rows } = await client.query("select title from documents order by id");
  return rows.map(row => row.title);
}, { readOnly: true });
```

`run` takes a connection with `pool.connect()`, begins, runs the statement of the user, then `fn`. It commits when `fn` returns, and rolls back and throws again when it throws. A connection that cannot roll back is released as broken, so the pool closes it. The pool is anything with `connect()` that gives a client with `query(text, values)` and `release(error?)`, like the pools of node-postgres and Neon serverless.

### isRefused

```ts
import { isRefused } from "@p9s/postgres";

app.onError((error, c) => isRefused(error) ? c.json({ error: "forbidden" }, 403) : c.json({ error: "internal" }, 500));
```

`isRefused(error)` tells whether an error is Postgres refusing a statement to the user, with `insufficient_privilege`, code `42501`: a row the policies do not let through, a statement the role has no privilege for, or a share of bits the user does not have. It looks through what clients wrap the error of Postgres in: node-postgres gives it as is, Drizzle as its `cause`, Prisma in `meta.driverAdapterError.cause`, and GraphQL as its `originalError`. An update or a delete of a row the user reads but cannot change is no error: it touches no row.

## The migration

### createMigrationSql

```ts
import { createMigrationSql } from "@p9s/postgres";

const sql = createMigrationSql(config);
```

`createMigrationSql(config)` returns the SQL of the migration of a config, which `p9s postgres generate` writes. It is idempotent: a database runs it again, and the migration of a new config, without losing data. `createMigration(config)` returns the same as a fragment of [`pg-sql2`](https://github.com/graphile/crystal/tree/main/utils/pg-sql2), to compose with other SQL. The `createMigration...` functions it is made of, like `createMigrationDataModelPolicies`, are exported for tests and tools, and change with the migration.

### migrate

```ts
import { migrate } from "@p9s/postgres";

const client = await pool.connect();
try {
  const { ran, createdRoles, before } = await migrate(client, config);
} finally {
  client.release();
}
```

`migrate(client, config, options?)` runs the migration of the config in one transaction, which `p9s postgres migrate` does: it applies completely or not at all. The client must not be in a transaction. Concurrent runs wait for each other with an advisory lock, then find the database up to date.

| Option | Default | |
| --- | --- | --- |
| `force` | `false` | Runs the migration even when the database already ran the migration of the config |
| `createRoles` | `true` | Creates the users and graph writers of the config that do not exist, as roles without login, grants them to the role that runs the migration, and turns JIT off for users |

It returns `{ ran, createdRoles, before }`: whether the migration ran, the roles it created, and the [status](#migrationstatus) before. It throws the error of Postgres, after rolling back, when a statement fails.

### migrationStatus

`migrationStatus(client, config)` tells whether the database ran the migration of the config, which `p9s postgres status` prints, for a deploy to check before it serves requests. It returns `{ state, expected, installed }`:

- `state`: `current` when the database ran the migration of the config, `outdated` when it ran another one, of another config or version of p9s, and `missing` when it never ran one
- `expected`: `{ version, hash }` of the migration of the config, which `expectedMigrationRecord(config)` also returns
- `installed`: `{ version, hash }` the database returns, or `null`

The migration records them in a function it creates last, `migrationRecordFunction(config)`, `p9s_migration` with the default prefix, so a database that has it ran the whole migration.

### diagnose

`diagnose(client, config, options?)` checks a database against a config, which `p9s postgres doctor` prints, and returns a list of `{ check, level, message }`, where `level` is `ok`, `warn` or `error`:

- `migration`: the database ran the migration of the config
- `roles`: the users exist, and the policies apply to them: they are not superusers, have no `bypassrls`, and own no table without `force row level security`
- `rls`: row level security is on for every resource table
- `grants`: the users have the privileges their permissions name
- `indexes`: the parent columns are indexed
- `jit`: JIT is off for the users
- `cache`: the caches of a sample of rows match a recompute of them. The `sample` option sets how many rows of each tree, 200 by default

### createMigrationFile

```ts
import { createMigrationFile, migrationDirectories } from "@p9s/postgres";

const { fileName, content } = createMigrationFile(config, "alembic", { previous: "0001" });
await writeFile(path.join(migrationDirectories.alembic, fileName), content);
```

`createMigrationFile(config, format, options?)` wraps the migration in a migration of the tool of a stack, which `p9s postgres generate --format` writes, see [the CLI](./cli#in-the-format-of-a-migration-tool). `migrationFormats` lists the formats: `alembic`, `django`, `rails`, `goose`, `sqlx`, `ecto` and `laravel`, and `migrationDirectories` the folder of each, by convention. The file also creates the roles of the config that do not exist, with the SQL of `createRolesSql(config)`.

| Option | |
| --- | --- |
| `previous` | The migration this one comes after: the revision of Alembic, like `0001`, or `app_label.name` for Django, like `documents.0001_initial`. Both formats throw without it |
| `module` | The module of the migration of Ecto, like `MyApp.Repo.Migrations` |
| `now` | The time of the timestamp of the file name, now by default |

### readTables and proposeConfig

`readTables(client, schema?)` reads the tables of a schema, `public` by default, with their columns, primary keys and foreign keys of one column. `proposeConfig(tables, options?)` guesses a config from them, which `p9s init` writes: tenants are resources and roles, people and groups are roles, and every other table with a key of one column is a resource under the tables its foreign keys point to. It returns `{ config, notes }`, where the notes say what was guessed and what was left out, for a person to check. Its options are `users`, `["app_user"]` by default, and `schema`.

### Constants

`version` is the version of the package, which the migration records. `FEW_RESOURCES`, `MORE_RESOURCES`, `CHECKED_ROWS` and `CHECKED_WRITTEN_ROWS` are the numbers of resources the policies list and of rows they check before listing everything, see [how policies run](../configuration/querying#how-policies-run).
