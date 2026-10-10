---
sidebar_position: 1
---

# Installation

p9s needs **PostgreSQL** 14 or later. Its CLI runs with Node or Bun, or as a [standalone binary](../packages/cli) for Linux, macOS and Windows that needs neither. The migration is plain SQL: the application that queries the database can be written in any language, and each stack has a small package that runs the queries of a request as its user:

```bash
npm install --save-dev @p9s/cli           # the CLI, or its standalone binary

npm install @p9s/drizzle @p9s/postgres    # or @p9s/prisma, @p9s/kysely
pip install "p9s[sqlalchemy]"             # or "p9s[django]"
bundle add p9s                            # Rails
go get github.com/crubier/p9s/packages/go
cargo add p9s --features axum
composer require p9s/laravel
# Elixir, in mix.exs: {:p9s, "~> 0.1"}
```

To adopt p9s in an app that already checks permissions in its code, follow [adopting p9s](../integrations/adopting) and the page of your stack.

## From an existing database

1. **Propose a config** from the tables and foreign keys of the database, then read it and adjust it, see the [configuration](../configuration/overview):

   ```bash
   DATABASE_URL=postgresql://... npx p9s init --users app_user
   ```

2. **Create the role of the users**, which the server takes for their transactions, and index the parent columns:

   ```sql
   create role app_user nologin;
   grant app_user to app_server;  -- the role the server connects with
   create index on document (folder_id);
   ```

   If the application already keeps memberships and shares in tables of its own, name them in [`links`](../configuration/overview#links-configuration): the migration brings their rows into the graph and keeps it in step with them.

3. **Run the migration**, as the owner of the tables, in one transaction, and only when the database did not run it yet:

   ```bash
   npx p9s postgres migrate
   ```

   Or generate it, and run it with your other migrations, as plain SQL or as a migration of Alembic, Django, Rails, goose, sqlx, Ecto or Laravel, see [the CLI](../packages/cli#in-the-format-of-a-migration-tool):

   ```bash
   npx p9s postgres generate --output migrations/p9s.sql
   npx p9s postgres generate --format rails
   ```

4. **Check the database**:

   ```bash
   npx p9s postgres status
   npx p9s postgres doctor
   ```

5. **Run the queries of each user as that user**, see [acting as a user](../configuration/identity), or the page of your stack in [integrations](../integrations/adopting):

   ```ts
   import { createIdentity } from "@p9s/postgres";
   import config from "./p9s.config";

   const users = createIdentity(config);
   const documents = await users.run(pool, session.roleId, client => client.query("select id, title from document"));
   ```

6. **Give access**: assign a resource to a role, as a graph writer or as a user with the share bit, see the [security model](../configuration/security-model).

On Supabase, start from the [Supabase guide](../integrations/supabase). After a change of the config or an upgrade of p9s, generate the migration again and run it: it updates the database in place, see [upgrading](../configuration/upgrading).

## Development Setup

Working on p9s itself needs **Bun** 1.3 or later, and **Docker** to run the benchmarks and the Postgres tests locally.

```bash
git clone https://github.com/crubier/p9s.git
cd p9s
bun install

# Type check, and run every test on in-process PGlite
bun run typecheck
bun run test

# Run the same tests against a real Postgres server, this also enables the concurrency tests.
# The role in the URL must be able to create databases and roles.
P9S_TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres bun run test

# Benchmarks, see the Benchmarks page
bun run bench
```

## Project Structure

- `packages/core` - Configuration types, defaults, presets, naming and validation
- `packages/postgres` - Generates the SQL migration: graph tables, caches, triggers and RLS policies, and the identity, status, init and doctor helpers
- `packages/drizzle` - Builds a p9s configuration from a Drizzle schema, and runs Drizzle transactions as a user
- `packages/prisma` - Runs Prisma queries as a user
- `packages/kysely` - Runs Kysely transactions as a user
- `packages/python`, `packages/ruby`, `packages/go`, `packages/rust`, `packages/elixir`, `packages/php` - Act as a user from SQLAlchemy and Django, Rails, `database/sql`, pgx and GORM, sqlx and axum, Ecto and Phoenix, and Laravel
- `packages/conformance` - The cases every one of those packages passes
- `packages/cli` - The `p9s` command line, also built as standalone binaries by `scripts/binaries.ts`
- `examples/adoption` - The end to end test of adopting p9s, which each of `examples/{drizzle,prisma,kysely,supabase,postgraphile-rls,fastapi,django,rails,gorm,axum,phoenix,laravel}` runs on its `before/` codebase
- `packages/core-testing`, `packages/postgres-testing` - Test helpers, PGlite and Postgres test databases
- `benchmarks/postgres` - Performance benchmarks
- `examples/nextjs-drizzle` - A team workspace built with Next.js, Drizzle and Better Auth: organizations, teams, nested folders, documents, comments, sharing and API keys, with its p9s configuration in `src/p9s.ts`
- `examples/postgraphile` - The same workspace served by PostGraphile, with a React front end that only talks to GraphQL
