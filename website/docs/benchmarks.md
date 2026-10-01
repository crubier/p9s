---
sidebar_position: 5
---

# Benchmarks

`benchmarks/postgres` builds a synthetic multi-tenant dataset and measures what p9s costs at read and write time.

## Dataset

For a size factor `f`:

- a resource tree of 5 levels (org, workspace, folder, project, object) with `f` children per node, so about `f^5` objects
- a role tree of 3 levels (org, team, user), so `f^3` users
- assignments at every level, some regular and some random
- 19 business tables with RLS enabled, one row per folder and one row per object
- an 84-bit permission bitmap with random edge bits

## What is measured

- **Load**: bulk insert with triggers disabled, then the time to rebuild the caches.
- **Cache size**: rows and `pg_total_relation_size` of every edge and cache table.
- **Reads** as the application role, going through RLS: a point lookup, the first page of 50 rows, and counting every visible row. Each read runs against the p9s policies and against a baseline policy that walks both trees at query time with recursive queries and no cache. The run also checks that both policies show the same rows to a sample of users.
- **Incremental writes** with triggers on, each one in a rolled back transaction: add, move, detach and change the bits of a node at every level of the resource tree, share, revoke and change assignments, and add, remove and move users and teams.

Each scenario runs a few untimed warm-up repetitions, then reports p50, p95 and p99 over the timed ones. `EXPLAIN (ANALYZE, BUFFERS)` plans of every read are saved with the results.

## Running

```bash
# Starts Postgres from benchmarks/postgres/compose.yaml, runs size 5 for integer and uuid ids, with combineAssignmentsWith none and role
bun run bench

# A size sweep over every combination mode
bun run bench --sizes 4,6,8,10 --combine none,role,resource

# Against an existing server, or in-process PGlite
bun run bench --url postgresql://postgres:postgres@localhost:5432/postgres
bun run bench --db pglite --sizes 4 --reps 5
```

Results are printed as tables and written to `benchmarks/postgres/results/<date>-<db>-<git sha>.json`, with the Postgres version and settings, the machine, and the git commit. `compose.yaml` configures Postgres so that the dataset fits in memory, and turns JIT off because it only adds compile time to short queries.

## Example results

Postgres 14 with default settings on an Apple M2 Max, size factor 8 (37k resources, 584 roles), integer ids. p50 in milliseconds.

| Scenario                     | p9s, `combineAssignmentsWith: none` | p9s, `role` | No-cache baseline |
| ---------------------------- | ----------------------------------- | ----------- | ----------------- |
| Point lookup                 | 0.53                                | 0.26        | 0.42–0.53         |
| First page of 50 rows        | 1.4                                 | 1.1         | 20–28             |
| Count visible rows (1.8k rows) | 1.3                               | 1.0         | 35                |

| Write                        | `none` | `role` |
| ---------------------------- | ------ | ------ |
| Add an object                | 0.23   | 0.22   |
| Move an object               | 0.22   | 0.22   |
| Move a project               | 0.53   | 0.56   |
| Move a workspace (585 nodes) | 11     | 11     |
| Share a folder with a user   | 0.08   | 0.37   |
| Add a user to a team         | 0.27   | 0.64   |
| Move a team to another org   | 0.48   | 6.3    |

For a single row, walking the trees at query time is as fast as reading the caches. Reads that touch many rows are where the caches pay off. A write costs about as much as the number of cache rows it changes: moving a workspace changes the rows between each of its 585 nodes and the workspace's old and new ancestors, so it is the most expensive write here. `combineAssignmentsWith: role` makes reads cheaper, and assignment and role changes more expensive.
