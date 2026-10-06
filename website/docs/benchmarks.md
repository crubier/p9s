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
- `4f` comments on each post, the objects of the first table. With `--comments leaf` (the default) they are rows of a [leaf table](./configuration/overview#leaf-tables), with `--comments node` nodes of the graph under their post.
- 2 API keys per user (`--keys-per-user`). With `--keys leaf` (the default) they are rows of a [role leaf table](./configuration/overview#role-leaf-tables), with `--keys node` roles of the graph under their user.
- RLS enabled on the folder, object and comment tables
- an 84-bit permission bitmap with random edge bits

## What is measured

- **Load**: bulk insert with triggers disabled, then the time to rebuild the caches.
- **Cache size**: rows and `pg_total_relation_size` of every edge and cache table.
- **Reads** as the application role, going through RLS, as a user and as an API key: a point lookup, the first page of 50 rows, counting every visible row, a search of names with `ilike`, plain and [behind `offset 0`](./configuration/querying#filters-that-are-not-leakproof), and a page after 100 rows by offset and one by keyset. The first page and the count also run [with `p9s.check_rows` on](./configuration/querying#first-pages). Also the bitmap of `resource_permission` for one object, and for each row of a page of 50. Each read runs against the p9s policies and against a baseline policy that walks both trees at query time with recursive queries and no cache. The run also checks that both policies show the same rows to a sample of users.
- **Incremental writes** with triggers on, each one in a rolled back transaction: at every level of the resource tree, add a row, move it or detach it by writing its `parent_id`, and change the bits of its edge; share, revoke and change assignments, and share then revoke an org, workspace, folder or project that has no other assignment; add, remove and move users and teams.
- **Row writes** as an application would make them: create objects one at a time and 1000 in one statement, move, rename and delete them, mostly as the application role through RLS, and delete a folder. The same for comments, and deleting a post with its comments. The same for API keys, and deleting a user with its keys.
- **Concurrent writes**: throughput and latency of several clients creating objects, comments or API keys, alone and while a graph writer keeps moving workspaces.

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

# Both resource caches on the same dataset
bun run bench --resource-cache full,assigned

# Comments or API keys as nodes instead of leaves, to compare both with bench:compare
bun run bench --comments node --out results/node
bun run bench --keys node --out results/key-node
```

Results are printed as tables and written to `benchmarks/postgres/results/<date>-<db>-<git sha>.json`, with the Postgres version and settings, the machine, and the git commit. `bun run bench:compare <before.json> <after.json>` lists the metrics that changed by more than 20% between two runs. `compose.yaml` configures Postgres so that the dataset fits in memory, and turns JIT off because it only adds compile time to short queries.

## Example results

Postgres 14 with default settings on an Apple M2 Max, size factor 8 (37k resources, 584 roles), integer ids. p50 in milliseconds.

| Scenario                     | p9s, `combineAssignmentsWith: none` | p9s, `role` | No-cache baseline |
| ---------------------------- | ----------------------------------- | ----------- | ----------------- |
| Point lookup                 | 0.51                                | 0.26        | 0.40–0.42         |
| First page of 50 rows        | 1.4                                 | 1.2         | 23–27             |
| Count visible rows (1.8k rows) | 1.0                               | 0.87        | 34                |
| `resource_permission` of a row | 0.12                              | 0.10        |                   |
| First page of 50 rows, with `resource_permission` of each | 3.4  | 1.9         |                   |

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
| Create 1000 objects in one statement   | 45     | 57     |
| Delete 1000 objects in one statement   | 18     | 34     |

| Concurrent writes, 4 clients                          | `none`     | `role`     |
| ----------------------------------------------------- | ---------- | ---------- |
| Create objects in projects                            | 4900 tx/s  | 5500 tx/s  |
| Create objects without parent                         | 25600 tx/s | 26300 tx/s |
| Create objects while a graph writer moves workspaces  | 200 tx/s   | 230 tx/s   |

Creating a row with a parent and moving one take the graph lock, so they wait for a concurrent workspace move. Rows without parent don't touch the graph beyond their own cache row.

For a single row, walking the trees at query time is as fast as reading the caches. Reads that touch many rows are where the caches pay off. A write costs about as much as the number of cache rows it changes: moving a workspace changes the rows between each of its 585 nodes and the workspace's old and new ancestors, so it is the most expensive write here. `combineAssignmentsWith: role` makes reads cheaper, and assignment and role changes more expensive.

### Leaf tables

The same dataset with 58k comments on the 1.8k posts, as leaves and as nodes, `combineAssignmentsWith: none`. p50 in milliseconds.

|                                                  | Comments as nodes | Comments as leaves |
| ------------------------------------------------ | ----------------- | ------------------ |
| Resource edges / cache rows                      | 96k / 532k        | 37k / 182k         |
| Cache size                                       | 66 MB             | 25 MB              |
| Cache rebuild                                    | 4.2 s             | 1.3 s              |
| Comments of a post                               | 2.6               | 1.3                |
| Count visible comments                           | 7.5               | 7.0                |
| Create 1000 comments in one statement            | 47                | 11                 |
| Delete a post and its 32 comments                | 1.1               | 0.39               |
| Move a workspace                                 | 23                | 7.8                |
| Create comments while a graph writer moves workspaces, 4 clients | 84 tx/s | 4200 tx/s |

Leaf rows have no cache rows, so the graph and every write that walks it shrink: a workspace move no longer recomputes the cache rows of the comments below it. Writing a comment never waits for the graph lock.

### Role leaf tables

The same dataset with 2 API keys for each of the 512 users, as roles under their user and as role leaves. p50 in milliseconds.

|                                                     | Keys as nodes, `none` / `role` | Keys as leaves, `none` / `role` |
| --------------------------------------------------- | ------------------------------ | ------------------------------- |
| Role edges / cache rows                             | 1.6k / 5.8k                    | 576 / 1.7k                      |
| Assignment cache rows with `role`                   | 50k                            | 18k                             |
| Read an object, as an API key                       | 0.58 / 0.47                    | 0.52 / 0.29                     |
| Create an API key                                   | 0.21 / 0.33                    | 0.11 / 0.08                     |
| Create 1000 API keys in one statement               | 30 / 155                       | 12 / 13                         |
| Move an API key to another user                     | 0.99 / 1.28                    | 0.10 / 0.07                     |
| Create API keys while a graph writer moves workspaces, 4 clients | 230 / 170 tx/s    | 21,000 / 20,000 tx/s            |

Once role leaf tables exist, each policy of a statement looks up the parent of the current user once, whether it is a key or a user, which adds 5 to 10 µs. Writing a key never takes the graph lock, so it does not wait for graph writes.

### Users who see much of the graph

A policy either checks the ancestors of each row, or lists once every resource the user can see. Listing pays off for statements over many rows, and checking ancestors for a few rows. p9s tells the planner that an assigned resource can have most of the cache below it, so a statement over a few rows checks their ancestors. In a flat graph, where one group holds 20,000 posts and a user is assigned on it, `combineAssignmentsWith: none`:

|                     | Before: listing visible resources | Now                          |
| ------------------- | --------------------------------- | ---------------------------- |
| Read one post       | 17.5 ms                           | 0.03 ms, checking ancestors  |
| Update one post     | 36 ms                             | 0.7 ms, checking ancestors   |
| Count visible posts | 7.6 ms                            | 7.6 ms, still listing        |

In the balanced trees of the benchmark, an org admin who sees most objects reads one in 0.5 ms and renames one in 1.7 ms either way. A statement over many rows by a user who sees few resources now checks ancestors too: as the application user, creating 1000 objects in one statement takes 57 ms instead of 45 ms with `combineAssignmentsWith: role`.

### Searches and pages

With a size of 10 (111k resources, 5,600 posts of which a user reads about 200), uuid ids and `combineAssignmentsWith: role`, p50 in milliseconds:

|                                   | p50  |
| --------------------------------- | ---- |
| Count visible posts               | 1.95 |
| Search names with `ilike`         | 60   |
| The same, behind `offset 0`       | 1.92 |
| Page after 100 rows, by offset    | 2.82 |
| Page by keyset                    | 1.87 |

`ilike` is not leakproof, so the policy runs before it, planned for the few rows the search looks like it returns: Postgres checks the ancestors of each of the 5,600 posts. Behind `offset 0` it lists the 200 readable ones once. [Querying through RLS](./configuration/querying) explains these and other patterns.

### Hiding the graph

Policies read the graph through [views of the current user](./configuration/security-model#what-users-see-of-the-graph) rather than the tables, so that users cannot read the graph whole. With a size of 10 and integer ids, p50 in milliseconds over two runs each, before and after:

|                                   | `none`                | `role`                | `resource`            |
| --------------------------------- | --------------------- | --------------------- | --------------------- |
| Point lookup                      | 0.59–0.65 / 0.61–0.65 | 0.25 / 0.25–0.26      | 0.27–0.30 / 0.28–0.32 |
| First page of 50 rows             | 2.1–2.3 / 2.0–2.3     | 1.8–1.9 / 1.7–1.9     | 3.3–3.4 / 3.4–3.6     |
| Count visible objects             | 1.9–2.1 / 1.9         | 1.5 / 1.5–1.6         | 3.2–3.4 / 3.3–3.6     |
| Search behind `offset 0`          | 1.9–2.1 / 1.9–2.0     | 1.6–1.7 / 1.6         | 3.5–3.7 / 3.3–3.6     |
| `resource_permission` of a row    | 0.14–0.16 / 0.13–0.15 | 0.09–0.10 / 0.09      | 0.10–0.11 / 0.10      |

The differences are those between two runs of the same code, and writes do not change. Postgres plans the views like the tables: a view is a security barrier, but the comparisons of ids that select the rows of a resource are leakproof, so they still run first, in the index. Each policy reads the view of its bit, which only keeps the edges with that bit.

With `combineAssignmentsWith: resource`, p9s now also tells the planner that a role can be assigned most of the cache. In the flat graph above, where a user is assigned the root of 20,000 posts and 20,000 other roles are each assigned a post, reading one post takes 0.2 ms instead of 3.8 ms, and updating it 0.6 ms instead of 14 ms, round trip included. The other modes do not change: 0.4 and 1.3 ms with `none`, 0.2 and 0.6 ms with `role`.

### Caching only below assignments

With [`resourceCache: "assigned"`](./configuration/overview#resource-cache), the resource cache only has the rows below resources that have assignments. With a size of 10 and uuid ids, on Postgres 18, p50 in milliseconds, `full` / `assigned`:

|                                          | `none`        | `role`        |
| ---------------------------------------- | ------------- | ------------- |
| Resource cache, rows                     | 543k / 485k   | 543k / 485k   |
| Resource cache, MB                       | 81.6 / 73.8   | 81.6 / 73.8   |
| Cache rebuild, s                         | 3.96 / 3.24   | 3.94 / 3.50   |
| Point lookup                             | 0.95 / 0.80   | 0.55 / 0.50   |
| First page of 50 rows                    | 2.85 / 2.41   | 3.29 / 2.15   |
| `resource_permission` of a row           | 0.26 / 0.29   | 0.23 / 0.21   |
| Move a folder                            | 3.37 / 2.45   | 2.38 / 2.70   |
| Move an object                           | 0.80 / 0.94   | 0.67 / 0.72   |
| Create 1000 objects in one statement     | 73 / 74       | 79 / 80       |
| First share of a project, 10 below       | 0.20 / 0.32   | 0.24 / 0.35   |
| First share of a folder, 110 below       | 0.19 / 0.89   | 0.26 / 0.90   |
| First share of a workspace, 1,110 below  | 0.20 / 6.04   | 0.28 / 6.55   |
| First share of an org, 11,110 below      | 0.22 / 63     | 0.40 / 61     |
| Revoke the last share of an org          | 0.16 / 5.29   | 0.27 / 5.22   |

The benchmark shares 15,000 times over 111,000 resources, at every level, so only 11% of the rows go: 57% go in the example app, where 870 resources are shared. Reads and writes in the tree cost the same, within the noise of a run. A first share writes a row for every resource below, about 5.5 µs each, and the last revoke deletes them.

Before this, the primary key of the cache started with the parent. Postgres 18 could then look the ancestors of a resource up with a skip scan of that key, which it expected to take a single search, as p9s tells it that parents have most of the cache, and which took one search per parent. Both plans cost about the same to the planner, and with `role` and the assigned cache it took the skip scan: `resource_permission` of a row took 3 ms instead of 0.2 ms, and a first page with permissions 119 ms instead of 3.8 ms. The key now starts with the child, and the index on the child, which it replaces, is gone: 13% less space in both modes.

