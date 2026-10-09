---
sidebar_position: 2
---

# CLI

```bash
npm install --save-dev @p9s/cli
```

The `p9s` command reads its config from `p9s.config.ts`, `p9s.config.js`, `.p9src.json` or the `p9s` key of `package.json`, or from any file given with `--config <path>`, like `p9s.config.json`. Commands that connect to a database take `--database-url`, or read `DATABASE_URL`.

## init

```bash
npx p9s init --users app_user
```

Reads the tables, primary keys and foreign keys of a schema, `public` by default, and writes a config to start from, `p9s.config.ts` by default, or JSON for a `.json` output:

- Tables named like tenants, such as `organization` or `workspace`, are resources and roles: members are in them, and resources are below them.
- Tables of users, members, teams and groups are roles.
- The other tables with a primary key of one column are resources, under the tables their foreign keys point to. A table with several such keys follows the first it sets, its own table first, see [parent columns](../configuration/overview#parent-columns).
- Tables of migrations, sessions and accounts of authentication libraries, tables whose primary key has several columns, and the tables of p9s are left out.

It sets the current user from the setting `app.role_id`, see [acting as a user](../configuration/identity), uuid ids when every key is a uuid, and one bit for each operation. Comments in the file tell what it guessed: read them, then adjust the config before generating the migration.

## postgres generate

```bash
npx p9s postgres generate --output migrations/p9s.sql
```

Writes the migration of the config, to `migration.output.sql` of the config or `p9s-migration.sql` by default. Run it with your migrations, as the owner of the tables. Running it again on a database that ran an earlier one updates it, see [upgrading](../configuration/upgrading).

### In the format of a migration tool

```bash
npx p9s postgres generate --format rails
```

With `--format`, the migration is a migration of the tool of the stack, which runs with the other migrations of the app, in their order and in a transaction. It also creates the roles of the config that do not exist, as `postgres migrate` does. `--output` is then the folder of the migrations, the one of the tool by default, and the file is named with a timestamp and the hash of the migration, so that a new config makes a new migration.

| Format | Folder | Runs with |
| --- | --- | --- |
| `alembic` | `migrations/versions` | `alembic upgrade head`, after the revision of `--previous` |
| `django` | `<app>/migrations` | `manage.py migrate`, after the migration of `--previous`, like `documents.0001_initial` |
| `rails` | `db/migrate` | `rails db:migrate` |
| `goose` | `migrations` | `goose up`, or `goose.Up` with embedded migrations |
| `sqlx` | `migrations` | `sqlx migrate run`, or `sqlx::migrate!`, which needs a build script to see a new file |
| `ecto` | `priv/repo/migrations` | `mix ecto.migrate`, in the module of `--module`, `<App>.Repo.Migrations` of `mix.exs` by default |
| `laravel` | `database/migrations` | `php artisan migrate` |

The examples of [Alembic](https://github.com/crubier/p9s/tree/main/examples/fastapi), [Django](https://github.com/crubier/p9s/tree/main/examples/django), [Rails](https://github.com/crubier/p9s/tree/main/examples/rails), [goose](https://github.com/crubier/p9s/tree/main/examples/gorm), [sqlx](https://github.com/crubier/p9s/tree/main/examples/axum), [Ecto](https://github.com/crubier/p9s/tree/main/examples/phoenix) and [Laravel](https://github.com/crubier/p9s/tree/main/examples/laravel) test it: the migrate command of the app makes a database where each user reads and writes as the rules say.

## postgres migrate

```bash
npx p9s postgres migrate --config p9s.config.json
```

Runs the migration of the config on the database, as the role of the URL, which should own the tables. It runs in one transaction, so a migration that fails changes nothing, and it does nothing when the database already ran the migration of this config, as `postgres status` tells: run it on every deploy. `--force` runs it anyway.

Users and graph writers of the config that do not exist become roles without login, granted to the role that migrates, which then needs to be allowed to create roles. With `--no-create-roles`, the migration fails on a missing role instead.

## postgres status

```bash
npx p9s postgres status
```

Tells whether the database ran the migration of this config with this version of p9s: `current`, `outdated` when it ran another config or version, or `missing`. Exits with 1 unless it is current, to check a deployment before serving with a new config.

## postgres doctor {#doctor}

```bash
npx p9s postgres doctor --sample 500
```

Checks a database against the config, and exits with 1 on an error:

- **migration**: the status above.
- **roles**: the roles of `engine.users` are not superusers, do not bypass RLS, and do not own a resource table, since the owner of a table skips its policies unless they are forced.
- **rls**: row level security is on for every resource table.
- **grants**: users may read the resource tables.
- **indexes**: every parent column has an index: p9s looks rows up by them on every write.
- **jit**: JIT is off for the users, or warns: the policies cost little to the planner, but statements over large tables still compile, which takes longer than they run.
- **cache**: the cache rows of `--sample` nodes of each tree, 200 by default, match a recompute from the edges.

## validate config

```bash
npx p9s validate config
```

Checks the config against the schema of `@p9s/core`, and prints its errors. With `--strict`, exits with 1 when there are some.

## drizzle configure

```bash
npx p9s drizzle configure --schema src/schema.ts
```

Derives the config from a Drizzle schema, see `@p9s/drizzle` and [the Next.js example](https://github.com/crubier/p9s/tree/main/examples/nextjs-drizzle).
