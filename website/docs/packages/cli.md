---
sidebar_position: 2
---

# CLI

```bash
npm install --save-dev @p9s/cli
```

Without Node, each [release](https://github.com/crubier/p9s/releases) has a standalone executable for Linux, macOS and Windows, on x64 and arm64 (Windows on x64 only), with their `SHA256SUMS`:

```bash
curl -fsSL -o p9s https://github.com/crubier/p9s/releases/latest/download/p9s-linux-x64
chmod +x p9s
./p9s postgres migrate --config p9s.config.json
```

The `p9s` command reads its config from `p9s.config.json`, `p9s.config.yaml`, `p9s.config.ts`, `p9s.config.js`, `.p9src.json` or the `p9s` key of `package.json`, or from any file given with `--config <path>`. Commands that connect to a database take `--database-url`, or read `DATABASE_URL`.

### The JSON Schema of the config

[`p9s.config.schema.json`](https://p9s.vercel.app/p9s.config.schema.json) describes the config, for editors to complete and check it. In JSON, name it with `$schema`:

```json
{
  "$schema": "https://p9s.vercel.app/p9s.config.schema.json",
  "engine": { "users": ["app_user"] }
}
```

In YAML, with the YAML extension of VS Code or any editor that uses its language server, a comment does the same:

```yaml
# yaml-language-server: $schema=https://p9s.vercel.app/p9s.config.schema.json
engine:
  users: [app_user]
```

The schema takes no keys the config does not have, so that a typo shows. `p9s validate config` also checks what goes across keys, like a parent table that the config has. `@p9s/core` holds the same file, as `@p9s/core/p9s.config.schema.json`.

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

## adopt

```bash
npx p9s adopt
```

Changes the code of the app in the current folder so that its requests run as their users. It finds the stack from the files of the app, or takes `--stack`, one of `rails`, `django`, `fastapi`, `laravel`, `phoenix`, `go`, `axum`, `supabase`, `postgraphile`, `prisma`, `drizzle` and `kysely`. Depending on the stack, it:

- adds the package of p9s to the manifest, like the `Gemfile`, `pyproject.toml`, `composer.json`, `mix.exs`, `go.mod`, `Cargo.toml` or `package.json`. It leaves the lock file to the package manager, and prints the command to run next, like `bundle install`
- runs every request in a transaction as its user, where the framework has one place for it: `P9s::Controller` in the application controller of Rails, the middleware of Django, the `AsUser` middleware on the routes of Laravel that authenticate users, `P9s.Controller` in the controllers of Phoenix
- answers 403 to a write the policies refuse, in the error handler of the framework: Rails, FastAPI, Laravel and Hono
- leaves the columns p9s adds out of the models that would read or show them, in Rails and Laravel, and lets Rails write rows without reading the rows their `belongs_to` point to
- writes the identity of the config, which the code of the app passes to the packages, in `p9s.go` for Go and `src/p9s.ts` for TypeScript

`--user-id` tells how the app finds the id of the user of a request, when it is not the default of the stack, `current_user.id` in Rails and Phoenix, the signed in user in Django and Laravel: an expression for Rails (`@user_id`), Laravel (of `$request`) and Phoenix (of `conn`), and the dotted path of a function of the request for Django. `--dry-run` lists the files it would change.

It changes nothing it changed already, so running it twice is safe. It ends with what is left to you, which is specific to each app: deleting the permission checks, reading and writing as the user, and answering 404 and 403 where the app checked before. The guide of each stack in [integrations](../integrations/adopting) shows both parts, and each example of the repository holds them in `adopt.patch`, what `p9s adopt` writes, and `after.patch`, the rest.

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

The examples of [Alembic](https://github.com/crubier/p9s/tree/main/examples/integrations/fastapi), [Django](https://github.com/crubier/p9s/tree/main/examples/integrations/django), [Rails](https://github.com/crubier/p9s/tree/main/examples/integrations/rails), [goose](https://github.com/crubier/p9s/tree/main/examples/integrations/gorm), [sqlx](https://github.com/crubier/p9s/tree/main/examples/integrations/axum), [Ecto](https://github.com/crubier/p9s/tree/main/examples/integrations/phoenix) and [Laravel](https://github.com/crubier/p9s/tree/main/examples/integrations/laravel) test it: the migrate command of the app makes a database where each user reads and writes as the rules say.

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

Derives the config from a Drizzle schema, see `@p9s/drizzle` and [the Next.js example](https://github.com/crubier/p9s/tree/main/examples/apps/nextjs-drizzle).
