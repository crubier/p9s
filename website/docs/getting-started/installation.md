---
sidebar_position: 1
---

# Installation

p9s needs **PostgreSQL** 14 or later, and Node or Bun to generate its migration. The migration is plain SQL: the application that queries the database can be written in any language.

```bash
npm install @p9s/core @p9s/postgres
npm install --save-dev @p9s/cli
# With Drizzle or Prisma, the helpers that run queries as a user
npm install @p9s/drizzle   # or @p9s/prisma
```

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

3. **Generate the migration**, and run it with your other migrations, as the owner of the tables:

   ```bash
   npx p9s postgres generate --output migrations/p9s.sql
   ```

4. **Check the database**:

   ```bash
   npx p9s postgres status
   npx p9s postgres doctor
   ```

5. **Run the queries of each user as that user**, see [acting as a user](../configuration/identity):

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
- `packages/cli` - The `p9s` command line
- `packages/core-testing`, `packages/postgres-testing` - Test helpers, PGlite and Postgres test databases
- `benchmarks/postgres` - Performance benchmarks
- `examples/nextjs-drizzle` - A team workspace built with Next.js, Drizzle and Better Auth: organizations, teams, nested folders, documents, comments, sharing and API keys, with its p9s configuration in `src/p9s.ts`
- `examples/postgraphile` - The same workspace served by PostGraphile, with a React front end that only talks to GraphQL
