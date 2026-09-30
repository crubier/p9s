---
sidebar_position: 1
---

# Installation

## Prerequisites

- **PostgreSQL** 14 or higher
- **Bun** 1.3 or higher
- **Docker** (optional, to run the benchmarks and the Postgres tests locally)

## Development Setup

```bash
git clone https://github.com/crubier/pg-permission-tree.git
cd pg-permission-tree
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

- `packages/core` - Configuration types, defaults, naming and validation
- `packages/postgres` - Generates the SQL migration: graph tables, caches, triggers and RLS policies
- `packages/drizzle` - Builds a p9s configuration from a Drizzle schema
- `packages/cli` - The `p9s` command line
- `packages/core-testing`, `packages/postgres-testing` - Test helpers, PGlite and Postgres test databases
- `benchmarks/postgres` - Performance benchmarks
- `examples/nextjs-drizzle` - A Next.js app using Drizzle and Better Auth, with its p9s configuration in `src/p9s.ts`
