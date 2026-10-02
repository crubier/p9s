---
sidebar_position: 5
---

# Benchmarks

`benchmarks/postgres` builds a synthetic multi-tenant dataset and measures what p9s costs at read and write time.

## Dataset

For a size factor `f`:

- a resource tree of 5 levels (org, workspace, folder, project, object) with `f` children per node, so about `f^5` objects. Each level is a table, and objects are spread over 18 tables. Every row points to its parent through a `parent_id` column, so every edge is a home edge.
- a role tree of 3 levels (company, team, user), so `f^3` users, also rows with a `parent_id`
- assignments at every level, some regular and some random
- RLS enabled on the folder and object tables
- an 84-bit permission bitmap with random edge bits

## What is measured

- **Load**: bulk insert with triggers disabled, then the time to rebuild the caches.
- **Cache size**: rows and `pg_total_relation_size` of every edge and cache table.
- **Reads** as the application role, going through RLS: a point lookup, the first page of 50 rows, and counting every visible row. Each read runs against the p9s policies and against a baseline policy that walks both trees at query time with recursive queries and no cache. The run also checks that both policies show the same rows to a sample of users.
- **Incremental writes** with triggers on, each one in a rolled back transaction: at every level of the resource tree, add a row, move it or detach it by writing its `parent_id`, and change the bits of its edge; share, revoke and change assignments; add, remove and move users and teams.
- **Row writes** as an application would make them: create objects one at a time and 1000 in one statement, move, rename and delete them, mostly as the application role through RLS, and delete a folder.
- **Concurrent writes**: throughput and latency of several clients creating objects, alone and while a graph writer keeps moving workspaces.

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

Results are printed as tables and written to `benchmarks/postgres/results/<date>-<db>-<git sha>.json`, with the Postgres version and settings, the machine, and the git commit. `bun run bench:compare <before.json> <after.json>` lists the metrics that changed by more than 20% between two runs. `compose.yaml` configures Postgres so that the dataset fits in memory, and turns JIT off because it only adds compile time to short queries.

## Example results

Postgres 14 with default settings on an Apple M2 Max, size factor 8 (37k resources, 584 roles), integer ids. p50 in milliseconds.

| Scenario                     | p9s, `combineAssignmentsWith: none` | p9s, `role` | No-cache baseline |
| ---------------------------- | ----------------------------------- | ----------- | ----------------- |
| Point lookup                 | 0.51                                | 0.26        | 0.40–0.42         |
| First page of 50 rows        | 1.4                                 | 1.2         | 23–27             |
| Count visible rows (1.8k rows) | 1.0                               | 0.87        | 34                |

| Write                                  | `none` | `role` |
| -------------------------------------- | ------ | ------ |
| Add an object                          | 0.20   | 0.20   |
| Move an object                         | 0.39   | 0.39   |
| Move a project                         | 0.45   | 0.47   |
| Move a workspace (585 nodes)           | 6.9    | 7.2    |
| Share a folder with a user             | 0.08   | 0.17   |
| Add a user to a team                   | 0.13   | 0.26   |
| Move a team to another org             | 0.25   | 2.6    |
| Create an object, as the app role      | 0.66   | 0.36   |
| Create 1000 objects in one statement   | 45     | 45     |
| Delete 1000 objects in one statement   | 18     | 34     |

| Concurrent writes, 4 clients                          | `none`     | `role`     |
| ----------------------------------------------------- | ---------- | ---------- |
| Create objects in projects                            | 4900 tx/s  | 5500 tx/s  |
| Create objects without parent                         | 25600 tx/s | 26300 tx/s |
| Create objects while a graph writer moves workspaces  | 200 tx/s   | 230 tx/s   |

Creating a row with a parent and moving one take the graph lock, so they wait for a concurrent workspace move. Rows without parent don't touch the graph beyond their own cache row.

For a single row, walking the trees at query time is as fast as reading the caches. Reads that touch many rows are where the caches pay off. A write costs about as much as the number of cache rows it changes: moving a workspace changes the rows between each of its 585 nodes and the workspace's old and new ancestors, so it is the most expensive write here. `combineAssignmentsWith: role` makes reads cheaper, and assignment and role changes more expensive.
