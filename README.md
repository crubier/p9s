# p9s (pg-permission-tree)

Hierarchical permissions for Postgres, enforced with Row Level Security.

p9s generates a SQL migration that adds a permission graph to your existing tables: resources (folders, projects, documents...) and roles (users, teams, organizations...) form two trees, assignments link them, and triggers keep cache tables of every transitive permission up to date so that RLS policies only need index lookups.

Documentation: [p9s.dev](https://p9s.dev), sources in [`website/docs`](./website/docs).

## Concepts

- **Resources** are business objects. They are nodes of a tree, or more precisely a DAG, since a node can have several parents (shared folders, symlinks).
- **Roles** are the entities that access resources, also nodes of a DAG (users in teams in organizations).
- **Assignments** link a role to a resource (share a folder with a team).
- **Permission bitmaps**: every edge and assignment carries a bitmap with one bit per operation class. The permission along a path is the AND of its edges, and the permission between a role and a resource is the OR over all paths between them.
- **Caches**: `resource_edge_cache` and `role_edge_cache` store the transitive closure of each tree with its permissions, and with `combineAssignmentsWith: "role"`, `assignment_edge_cache` also stores assignments combined with the role tree. Triggers keep them exact on every insert, update and delete.
- **RLS**: each configured table gets `select`, `insert`, `update` and `delete` policies checking one bit of the bitmap for the current user.

## Quick start

```typescript
import { createMigration } from "@p9s/postgres";
import { compile } from "pg-sql2";

const migration = createMigration({
  engine: {
    users: ["authenticated"],
    graphWriters: ["app_backend"],
    authentication: { getCurrentUserId: "current_role_id" },
    id: { mode: "uuid" },
    combineAssignmentsWith: "role",
    permission: { bitmap: { size: 16 } },
  },
  tables: [
    {
      name: "document",
      isResource: true,
      resourceId: "resource_id",
      permission: {
        authenticated: { select: 0, insert: 1, update: 2, delete: 3 },
      },
    },
    { name: "user", isRole: true, roleId: "role_id" },
  ],
});

await Bun.write("p9s-migration.sql", compile(migration).text);
```

The migration can be re-run safely, it never drops your data. The `p9s` CLI (`packages/cli`) does the same from a config file, and `@p9s/drizzle` derives the table list from a Drizzle schema, see [`examples/nextjs-drizzle/src/p9s.ts`](./examples/nextjs-drizzle/src/p9s.ts).

Before using it, read the [security model](./website/docs/configuration/security-model.md): application roles are read-only on the graph, graph writes must use `READ COMMITTED`, and `TRUNCATE` does not maintain the caches.

## Development

```bash
bun install
bun run typecheck
bun run test                                    # on in-process PGlite
P9S_TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres bun run test   # on a real server, adds concurrency tests
bun run bench                                   # benchmarks, starts Postgres with Docker
bun run docs                                    # documentation site
```

The Postgres test suite checks the caches against a from-scratch recomputation after every step of random graph edits, compares RLS decisions with an in-memory reference model, and covers privileges, migration re-runs and concurrent writes. CI runs it on PGlite and on Postgres 18, see [`.github/workflows/ci.yml`](./.github/workflows/ci.yml).

## Features & Roadmap

- [x] Tables for base functionality
  - [x] `resourceNode` represents a business domain object
  - [x] `roleNode` represents a role
  - [x] `resourceEdge` represents a parent-child link between two business domain objects (e.g. a file in a folder)
  - [x] `roleEdge` represents a parent-child link between two roles (e.g. a user in a group)
  - [x] `assignmentEdge` represents a link between a business domain object and a role (e.g. a group is granted access to a folder)
- [x] Configurable permission bitmap size
  - [x] Permissions are represented as a bitmap, with one bit per permission
  - [x] The size of the bitmap is configurable.
  - [x] Recommend being generous when setting bitmap size in order to be future-proof, since changing it in the database is likely to be a costly operation
- [x] Functions to compute transitive permissions (both for `resourceEdge` and `roleEdge`)
  - [x] `edgeCacheParentCompute` computes the transitive permissions edges for a given node, going upwards in the tree (which is typically pretty quick, if each node has few parents)
  - [x] `edgeCacheChildCompute` computes the transitive permissions edges for a given node, going downwards in the tree (which typically is slower, since each node can have many children)
- [x] Views to query transitive permissions (both for `resourceEdge` and `roleEdge`)
  - [x] `resourceEdgeCacheView` is a view that represents all the transitive permissions derived from `resourceEdge`
  - [x] `roleEdgeCacheView` is a view that represents all the transitive permissions derived from `roleEdge`
- [x] Cache the transitive permissions in an actual material table
  - [x] `resourceEdgeCache` stores the transitive persmissions derived from `resourceEdge`
  - [x] `roleEdgeCache` stores the transitive persmissions derived from `roleEdge`
- [x] Add triggers to update caches when edges are CRUDed
  - [x]Triggers to populate `resourceEdgeCache` when `resourceEdge` is CRUDed
  - [x]Triggers to populate `roleEdgeCache` when `roleEdge` is CRUDed
- [x] Add way to backfill cache when needed
  - [x] `resourceEdgeCacheBackfill` function backfills the `resourceEdgeCache`
  - [x] `roleEdgeCacheBackfill` function backfills the `roleEdgeCache`
- [x] Add Row Level Security RLS policies to resources
  - [x] RLS policies are added to tables associated with a `resourceNode`
- [x] Functions to disable and re-enable triggers, for faster batch processing
  - [x] `disableTriggerFunction` disables triggers
  - [x] `enableTriggerFunction` enables triggers and backfills cache using `edgeCacheBackfill`
- [x] Configurable maximum depth when computing cache
  - [x] Defaults to 16
  - [x] Trees deeper than `maxDepth` will not work as expected.
  - [x] If there is a depth of more than `maxDepth` between the node linked to an assignment, and the node linked to a resource, the assignment will not be visible to the resource. Same goes for roles.
- [x] UUID mode (Other existing mode is INTEGER)
  - [x] UUID mode works, but the benchmark shows that it is 2-3x slower than INTEGER mode
- [x] Clean up code, don't treat self-edges differently
- [x] Combined assignment caches
  - [x] Offer a configuration option to make the `assignmentEdgeCache` table include `role` in the graph computation, such that the `assignmentEdgeCache` table is a transitive combination of the `roleEdge` + `assignment` tables. This is a tiny bit slower when writing new `roleEdge` or `assignment` (which is rare), but is much faster to resolve permissions at read time (which is very frequent), since it avoids a join during permission resolution.
  - [x] Similarly, offer a configuration option to make the `assignmentEdgeCache` table include `resource` in the graph computation. (This is only added for symmetry, but is not useful in practice, since in most cases you'll have many more `resources` than `roles`, so this optimization makes less sense than the reciprocal, and they are mutually exclusive)
- [x] Security model
  - [x] Application `users` get read-only access to nodes, edges, assignments and caches, only `graphWriters` can modify the graph
  - [x] Caches are only written by `security definer` triggers with a pinned `search_path`
- [x] Re-runnable, non-destructive migration, that backfills nodes for business rows that existed before a table was bound
- [x] Graph writes are serialized with a transaction-level advisory lock, so concurrent writes keep the caches exact
- [x] Test suite: random graph edits checked against a from-scratch recomputation, RLS checked against a reference model, privileges, migration re-runs and concurrency on real Postgres
- [x] Benchmarks of RLS reads against a no-cache baseline, incremental writes, cache size, with JSON output
- [x] Batch edge changes: edge triggers run once per statement, so a multi-row insert, update or delete of edges is processed in one pass
- [x] Faster subtree moves: an edge change only recomputes the cache rows between the nodes below it and the nodes above it, and only writes the rows whose value changed
- [ ] Nodeless mode. We don't actually need the `resourceNode` and `roleNode` tables. They were only useful for a few things that can be avoided:
  - [ ] Enforcing foreign key constraints can be achieved using correct triggers
  - [ ] Generating integer sequences that are shared over multiple business domain tables can be achieved by sharing an integer sequence between multiple tables, or using UUIDs
  - [ ] Creating a more complete datamodel to make tools like Postgraphile happy and ready to serve nodes in a GraphQL Scheme can be achieved differently with views.
- [ ] Single parent optimization for leaves. If the business domain allows for some leaves of the trees (Resources and/or Roles) to only have one single parent, and if the number of that type of leaves is large, then it can be useful to enable single parent optimization for leaves. This can typically be the case in SaaS when modelling data that has access control aggregated at one level (e.g. a `Page` in Notion), but can contain many smaller sub-objects which share the same access control rules (e.g. a `Block` or a `Comment` on a `Page` in Notion). In this case, having the permission system only deal with the `Pages` (small cardinality), and have the permissions for `Block` or `Comment` inherit from the `Page` ones, then single parent optimization for leaves makes sense on the `Block` and `Comment` tables.
  - [ ] Offer a configuration option to enable single parent optimization for `resourceNode`
  - [ ] Similarly, offer a configuration option to enable single parent optimization for `roleNode` (This is only added for symmetry, but is not useful in practice, since in most cases, you'll want users to be able to belong to multiple groups)
- [ ] Seamless CRUD operations, do not require separate creating a node + edge before creating an entity, leverage views and triggers to do it automatically
- [ ] Assignment-driven cache reduction
  - [ ] Do not store all combinatorical possibilities in cache tables, but only store edges starting from assignments.
  - [ ] Simplify `combineAssignmentsWith`. Currently, if set to e.g. `role`, it still maintains the `roleEdgeCache`, and the `roleAssignmentCache` tables. This is more compute-optimized, but less space-optimized. We could stop maintaining `roleEdgeCache` in that case and only focus on `roleAssignmentCache`. This would be a bit more complex, but could save space. If space is an issue, need to consider adding this.
- [ ] Customizable prefix for triggers, to allow ordering p9s triggers with other existing triggers (Postgres runs triggers in alphanumerical order). Before that, triggers are prefixed with `10`, `20`, etc.
- [ ] Build an actual life-sized example SaaS app
