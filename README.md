# p9s (pg-permission-tree)

Hierarchical permissions for Postgres, enforced with Row Level Security.

p9s generates a SQL migration that adds a permission graph to your existing tables: resources (folders, projects, documents...) and roles (users, teams, organizations...) form two trees, assignments link them, and triggers keep cache tables of every transitive permission up to date so that RLS policies only need index lookups.

Website and documentation: [p9s.vercel.app](https://p9s.vercel.app), sources in [`website`](./website).

## Concepts

- **Resources** are business objects: every row of a resource table is a node. Nodes form a tree, or more precisely a DAG, since a node can have several parents (shared folders, symlinks). Rows of a _leaf table_ (`resourceLeaf`), like the comments of a page, are not nodes: they take the permissions of their parent.
- **Roles** are the entities that access resources, also rows of tables forming a DAG (users in teams in organizations). Rows of a _role leaf table_ (`roleLeaf`), like the API keys of a user, are not nodes: they act with the permissions of their parent.
- **Edges** link a parent node to a child node. A table can name the column holding each row's parent (`resourceParent`, `roleParent`), and p9s then keeps a _home edge_ from that parent in sync with the column: creating, moving or deleting a row is a plain `insert`, `update` or `delete`. Graph writers add further edges to share a node under other parents.
- **Assignments** link a role to a resource (share a folder with a team). Users write them for the rows they have the `share` bit on, with bits they have there, and graph writers write any.
- **Permission bitmaps**: every edge and assignment carries a bitmap with one bit per operation class. The permission along a path is the AND of its edges, and the permission between a role and a resource is the OR over all paths between them.
- **Caches**: `resource_edge_cache` and `role_edge_cache` store the transitive closure of each tree with its permissions, and with `combineAssignmentsWith: "role"`, `assignment_edge_cache` also stores assignments combined with the role tree. Triggers keep them exact on every insert, update and delete.
- **RLS**: each configured table gets `select`, `insert`, `update` and `delete` policies checking one bit of the bitmap for the current user. Application code reads the current user's whole bitmap with `resource_permission(resource_id)`, to show the actions they can take, and users with the `manageAccess` bit on a resource, like graph writers before a graph write, can check any user with `resource_permission(resource_id, role_id)`, and list who has access to it with the `resource_access` view.
- **Views of the current user**: application users cannot read the graph tables. Policies and application code read the user's own part of the graph through views: what they can access, what was shared with them, what is below what among the resources they reach, and the teams they are in.

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
      name: "folder",
      isResource: true,
      resourceId: "resource_id",
      // "parent_id" holds the "id" of the parent folder
      resourceParent: { column: "parent_id", table: "folder", key: "id" },
      permission: {
        authenticated: { select: 0, insert: 1, update: 2, delete: 3 },
      },
    },
    {
      name: "document",
      isResource: true,
      resourceId: "resource_id",
      resourceParent: { column: "folder_id", table: "folder", key: "id" },
      permission: {
        authenticated: { select: 0, insert: 1, update: 2, delete: 3 },
      },
    },
    { name: "user", isRole: true, roleId: "role_id" },
  ],
});

await Bun.write("p9s-migration.sql", compile(migration).text);
```

The migration adds a `resource_id` column to `folder` and `document` and fills it, and every new row gets one by default. A user may insert a row only under a parent where they have the insert bit, and moving a row (changing `folder_id`) also needs the insert bit on the new parent. Index the parent columns, p9s looks rows up by them.

The migration can be re-run safely, it never drops your data. Databases created by earlier versions, with `resource_node` and `role_node` tables, are upgraded in place, see the [upgrade guide](./website/docs/configuration/upgrading.md). The `p9s` CLI (`packages/cli`) does the same from a config file, and `@p9s/drizzle` derives the table list from a Drizzle schema, see [`examples/nextjs-drizzle/src/p9s.ts`](./examples/nextjs-drizzle/src/p9s.ts).

Before using it, read the [security model](./website/docs/configuration/security-model.md): application roles only see their own part of the graph and cannot write edges and assignments, writes that touch the graph must use `READ COMMITTED`, and `TRUNCATE` is rejected on p9s-managed tables.

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
  - [x] Rows of resource tables are the nodes of the resource graph, rows of role tables the nodes of the role graph
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
  - [x] RLS policies are added to resource tables
- [x] Functions to disable and re-enable triggers, for faster batch processing
  - [x] `disableTriggerFunction` disables triggers
  - [x] `enableTriggerFunction` enables triggers and backfills cache using `edgeCacheBackfill`
- [x] Configurable maximum depth when computing cache
  - [x] Defaults to 16
  - [x] `maxDepth` is the most edges on a path of each tree. Writes that would make a longer path are rejected with an error, instead of the path silently granting nothing, and so are bulk loads when the triggers are enabled again. Paths are counted without going twice through a node, so cycles are not infinitely deep. A few hundredths of a millisecond per edge write.
- [x] UUID mode (Other existing mode is INTEGER)
  - [x] UUID mode works, but the benchmark shows that it is 2-3x slower than INTEGER mode
- [x] Clean up code, don't treat self-edges differently
- [x] Combined assignment caches
  - [x] Offer a configuration option to make the `assignmentEdgeCache` table include `role` in the graph computation, such that the `assignmentEdgeCache` table is a transitive combination of the `roleEdge` + `assignment` tables. This is a tiny bit slower when writing new `roleEdge` or `assignment` (which is rare), but is much faster to resolve permissions at read time (which is very frequent), since it avoids a join during permission resolution.
  - [x] Similarly, offer a configuration option to make the `assignmentEdgeCache` table include `resource` in the graph computation. (This is only added for symmetry, but is not useful in practice, since in most cases you'll have many more `resources` than `roles`, so this optimization makes less sense than the reciprocal, and they are mutually exclusive)
- [x] Security model
  - [x] Application `users` only see their own part of the graph, through the views of the current user, and only `graphWriters` can share or link nodes
  - [x] Caches are only written by `security definer` triggers with a pinned `search_path`
- [x] Re-runnable, non-destructive migration, that gives ids to business rows that existed before a table was bound
- [x] Graph writes are serialized with a transaction-level advisory lock, so concurrent writes keep the caches exact
- [x] Test suite: random graph edits checked against a from-scratch recomputation, RLS checked against a reference model, privileges, migration re-runs and concurrency on real Postgres
- [x] Benchmarks of RLS reads against a no-cache baseline, incremental writes, cache size, with JSON output
- [x] Batch edge changes: edge triggers run once per statement, so a multi-row insert, update or delete of edges is processed in one pass
- [x] Faster subtree moves: an edge change only recomputes the cache rows between the nodes below it and the nodes above it, and only writes the rows whose value changed
- [x] Nodeless mode: there are no `resourceNode` and `roleNode` tables, every row of a bound table is a node
  - [x] Edges and assignments are checked by triggers instead of foreign keys, and removed with the rows they connect
  - [x] In integer mode, the resource tables share one id sequence, and so do the role tables
  - [x] Databases with node tables are upgraded in place
  - [x] Views of all nodes, to make tools like Postgraphile happy and ready to serve nodes in a GraphQL schema: on Postgres 15 and later, `resource_node` and `role_node` are views of `(id, table_name)` over every bound table, which run as the querying user, so RLS decides which nodes they show. With `engine.postgraphile: true`, smart comments give them and the views of p9s their keys, hide the internal tables and functions from the API, and each resource table gets a `permission` field, since PostGraphile skips the overloaded `resource_permission`. See [PostGraphile](./website/docs/configuration/postgraphile.md).
- [x] Fast writes in flat graphs. When a few nodes hold most of the rows, Postgres estimated a lookup of children by `parent_id` as a large part of the edge table, so every write scanned the whole edge table, even for a node without children. The edge tables now tell the planner that a node has about one child on average. Inserting a row in a folder of 21,000 rows takes 0.2 ms instead of 4.4 ms.
- [x] Single parent optimization. If the business domain allows for some leaves of the trees (Resources and/or Roles) to only have one single parent, and if the number of that type of leaves is large, then it can be useful to enable single parent optimization for leaves. This can typically be the case in SaaS when modelling data that has access control aggregated at one level (e.g. a `Page` in Notion), but can contain many smaller sub-objects which share the same access control rules (e.g. a `Block` or a `Comment` on a `Page` in Notion). In this case, having the permission system only deal with the `Pages` (small cardinality), and have the permissions for `Block` or `Comment` inherit from the `Page` ones, then single parent optimization for leaves makes sense on the `Block` and `Comment` tables.
  - [x] Offer a configuration option to enable single parent optimization for resource tables: with `resourceLeaf: true`, rows are not nodes and take the permissions of their parent. With 58k comments on 1.8k posts, the resource cache holds 182k rows instead of 532k, creating 1000 comments takes 11 ms instead of 47 ms, and comments are created at full speed while a graph writer moves workspaces (4200 instead of 84 transactions per second).
  - [x] Similarly for role tables: with `roleLeaf: true`, rows are not nodes and act with the permissions of their parent, like the API keys of a user. Users stay nodes, so they can belong to several teams and resources can be shared with them. With two keys per user, API keys are created 20,000 times per second while a graph writer moves workspaces, instead of 230 times as role nodes, and creating 1000 keys takes 12 ms instead of 30 ms.
- [x] Fast single-row queries for users who see much of the graph. A policy either checks the ancestors of each row, or lists once every resource the user can see. Postgres estimated the descendants of an assigned resource as a few rows, so it listed everything even to read or update a single row. The resource cache now tells the planner that a resource can have most of the cache below it. In a flat graph where a user sees 20,000 posts, reading one post takes 0.03 ms instead of 17.5 ms, and updating it 0.7 ms instead of 36 ms.
  - [x] Trigger statements keep fast plans when a session first writes many rows at once. Postgres keeps the plans of trigger statements for the whole session, and plans made for a large statement compared every walked node with the whole cache: with `combineAssignmentsWith: resource`, creating 1000 objects could take 3 s instead of 0.2 s, and every later single-row insert scanned all assignments.
  - [x] Bulk updates of bound rows. The node triggers checked whether a parent column changed with an `exists` over the old and new rows, which Postgres planned to stop early, comparing every new row with every old one when none changed: updating another column of 20,000 rows took 18 s, now 0.14 s. The cache rebuild that ends every migration also checks that edges connect bound rows with anti joins rather than `not in`, which Postgres stops hashing past `work_mem` and then scans once per edge.
- [x] Reads through RLS at 100,000 rows per user. Postgres checks a policy before any filter that is not leakproof, like `ilike`, and plans it for the rows it expects that filter to keep: a search that looks selective checks the ancestors of every row of the table. [Querying through RLS](./website/docs/configuration/querying.md) shows how to keep such filters away from joins, page by keyset instead of offset, and list what was shared with a user from their assignments. [`reads.test.ts`](./packages/postgres/test/reads.test.ts) checks each pattern in every `combineAssignmentsWith` mode, and the benchmarks measure them. In the example app, with 108,000 readable documents, searching takes 0.45 s instead of 30 s, a page deep in the list 0.15 s instead of 2.5 s, and "Shared with me" 5 ms instead of 2.4 s.
  - [x] Shares of the current user as a p9s view: `current_assignment` lists the resources assigned to the user, their teams and the roles above them, with the bits they give, whatever `combineAssignmentsWith`, so that applications do not read the graph tables to list what was shared with them
  - [x] Fast first pages of large readable sets. Postgres plans the policy for every row an index scan could return, not the ones a `limit` keeps, so a first page of 50 listed every readable resource once. With `p9s.check_rows` on, select policies check the ancestors of the rows the scan walks instead: in the example app, the first page of a member who reads 108,000 documents took 4 ms instead of 115 ms, under a 10 ms timeout past which it listed. Policies now do this on their own, see below.
  - [x] Policies that decide as the statement runs. Left to the planner, a filter that is not leakproof, like `ilike`, made Postgres check the ancestors of every row of the table, and a `limit` made it list every readable resource for a page of 50. Select policies now list the first 1000 resources the user has the bit on at the first row, check the first row they miss, list 3000 past it, and list everything after 200 checks. Checks and listings are functions that cost 1 to the planner, so RLS no longer pushes large scans over the JIT threshold, and listings go through the indexes, so a user with few resources never scans a cache. `offset 0` fences and `p9s.check_rows` are no longer needed: in the benchmarks a search takes 1.7–1.9 ms instead of 17–19 ms, about as fast as behind `offset 0`. With 10,000 readable posts out of 20,000, a search takes 15–17 ms instead of 122–130 ms and a first page 0.27–0.38 ms instead of 2.6–3.4 ms. `p9s.check_rows` takes `on`, `off` or a number of rows to check. See [how policies run](./website/docs/configuration/querying.md#how-policies-run).
    - [x] Writes check the rows they write, then list past 50, and so does the select policy of the statement that writes, which the write policies tell which tables the statement writes. Listing first would also walk the index entries that writes leave until a vacuum: in the benchmarks, editing a comment as the application user takes 0.74–0.97 ms instead of 1.2–2.1 ms, deleting one 0.35–0.62 ms instead of 0.83–1.1 ms.
    - [x] 200 checks before listing for reads, 50 for writes. With 50 for both, the first page of an organization of 181,000 documents in the example app, where most of the first rows are unreadable, listed everything: 72–75 ms instead of 5–6 ms with 200. Writes keep 50, as a statement that writes many rows is rarely a page: with 200, deleting 1000 objects took 24 / 51 ms instead of 19–21 / 43–45 ms. [`reads.test.ts`](./packages/postgres/test/reads.test.ts) reads such a sparse page without listing everything, and counts the checks of writes.
    - [x] [`reads.test.ts`](./packages/postgres/test/reads.test.ts) checks, from `EXPLAIN ANALYZE`, which listings each kind of statement runs and how many rows it checks, for every `p9s.check_rows` value, and that the rows never depend on it. [`scans.test.ts`](./packages/postgres/test/scans.test.ts) checks that single-row reads and writes list nothing more than the first 1000 resources, and that a user with few resources never scans a cache.
    - [ ] Statements over every row by users with more than 3000 resources pay for two first listings and 200 checks before listing everything, and each row after that still misses the first listing and reads the count: a count of 10,000 readable posts takes 12–13 ms instead of 5–6 ms with JIT off. It took 140 ms with JIT on.
    - [ ] A lookup by id lists up to 1000 resources: 0.3 ms instead of the 0.03 ms of the single check it made before, and the rows of one group about 1 ms instead of 0.2–0.5 ms.
    - [ ] Cheaper checks. A check through a function costs about 20 µs, twice the check it replaced, as Postgres starts an executor for every call: with `p9s.check_rows` on, statements take twice as long as before.
  - [x] Searches that use an index through RLS. Trigram and full-text operators are not leakproof, so their indexes are never used before the policy. A table's `search` config declares functions like `document_search(value)` that match through the indexes as the owner, keep the rows the select policy of the user lets through, and read them back as the caller through RLS, so nothing of the hidden rows comes back. In the example app, a search for a rare word takes 2 to 18 ms instead of 0.4 s. See [searches](./website/docs/configuration/overview.md#searches) and [why they are safe](./website/docs/configuration/security-model.md#searches).
- [x] Seamless CRUD operations: with a parent column, creating, moving or deleting a row maintains its node and home edge, no separate graph write needed
- [x] Permissions for application code: `resource_permission(resource_id)` returns the bitmap the policies check for the current user, and API keys get that of their parent, in 0.1 ms. A resource without access gets no bits, like an id that is no resource, and only graph writers, or users with the `manageAccess` bit, can ask for another role with `resource_permission(resource_id, role_id)`. Checked against the reference model in every `combineAssignmentsWith` mode.
- [x] Delegated sharing. Application users share through `resource_share(resource_id, role_id, permission)` and `resource_unshare(resource_id, role_id)`, or by writing `assignment_edge` themselves, and RLS policies on `assignment_edge` decide, so no backend has to check them first. See [sharing](./website/docs/configuration/security-model.md#sharing).
  - [x] A `share` bit in each table's `permission` config, next to `select`, `insert`, `update` and `delete`, checked on the resource being shared. Per table like the other bits, since the shared resource is a row of one table, tables can use different bit positions, and some tables may not be shareable at all. Leaf rows cannot be shared on their own: a leaf table cannot set the bit.
  - [x] A user can only grant bits they have on that resource, so sharing never escalates privileges
  - [x] Revoking needs the `share` bit too. A user can change or remove a share made by someone else, as long as it has no bit they don't have: they can take back what an editor gave, not what the admins have.
  - [x] Users can share with any role node, checked like an assignment of a graph writer. Applications restrict who users share with, like the members of their teams, with a restrictive policy of their own on `assignment_edge`.
- [x] Permissions on role tables. Role tables have no RLS of their own. To let RLS decide who adds a user to a team, make the role tables resource tables too, with the same parent column for both trees: adding a member then needs the `insert` bit on the team, and an org admin gets it through an assignment on the org.
- [x] Seeing the permissions of others. A `manageAccess` bit per table lets a user ask what another role can do on a resource where they have that bit, with `resource_permission(resource_id, role_id)`, and list who has access to it with the `resource_access` and `resource_role_access` views, like the "Share" dialog of a document, in 0.5 ms with 180,000 documents. Graph writers still see everything, and others nothing, see [seeing the access of others](./website/docs/configuration/security-model.md#seeing-the-access-of-others)
- [x] Hide the permission graph from application users. Users have no privilege on the edges, assignments and caches anymore, and see their own part of the graph through security-barrier views owned by p9s: `current_resource_access` and one view per policy bit, which the policies read, `current_assignment`, `current_resource_edge` and `current_role`. A function of the user never sees the rows of others. Reads cost the same as before in every `combineAssignmentsWith` mode, see [the benchmarks](./website/docs/benchmarks.md#hiding-the-graph). Postgres looks rows of these views up by given ids, not by a column of each row of another table, see [querying the views](./website/docs/configuration/querying.md#the-views-of-the-current-user).
- [x] Another full example app that uses postgraphile latest version: [`examples/postgraphile`](./examples/postgraphile) is the workspace of the Next.js example, served by PostGraphile 5 without a single resolver: the same spaces, folders, documents, comments, sharing, teams, access overview, API keys, audit log and impersonation, at the same scale, with a React front end that only talks to GraphQL and opens the query of each page in GraphiQL. Its tests ask the API as each person, in the process and over HTTP. Building it found that PostGraphile answers an update of a row RLS hides with no row and no error, which [PostGraphile](./website/docs/configuration/postgraphile.md#what-it-needs) now explains how to refuse, and that the lookups of every parent column of a table were served by GraphQL, which `engine.postgraphile` now hides.
  - [x] Booleans rather than bitmaps in the API. `engine.permission.bitmap.names` names the bits, and the migration creates the type `permission_flags`, with the bitmap and a boolean per name, and `permission_flags(bit)`. The `permission` fields of PostGraphile, on resource tables, nodes and the views of p9s, return it: `permission { read edit share }` rather than `"11100100"`. The example names its eight bits, and its app reads the booleans. See [PostGraphile](./website/docs/configuration/postgraphile.md#what-the-migration-adds).
- [x] Assignment-driven cache reduction
  - [x] Do not store all combinatorical possibilities in cache tables, but only store edges starting from assignments. With `resourceCache: "assigned"`, the resource cache only keeps the rows that start at a resource with assignments, which are the only ones the policies read, and a self row per resource. The first assignment of a resource caches what is below it, and removing its last one drops those rows. See [resource cache](./website/docs/configuration/overview.md#resource-cache).
  - [x] Investigate the performance impact of this (good or bad). If good implement it else document why. Reads and writes in the tree cost the same, and the cache rebuilds faster. A first share costs about 5.5 µs per resource below: 0.9 ms for a folder of 110, 6 ms for a workspace of 1,110 and 63 ms for an org of 11,110, instead of 0.2 ms. How much it saves depends on how many resources are shared: 11% in the benchmark, which shares at every level, 57% in the example app, which now uses it: its resource cache went from 1.32 million rows to 572,000, and the migration took 27 s. The investigation also found that Postgres 18 could look ancestors up with a skip scan of the old primary key, 15 to 30 times slower: the key of the resource cache now starts with the child, and its child index is gone, 13% less space in both modes. See [the benchmarks](./website/docs/benchmarks.md#caching-only-below-assignments).
  - [x] Simplify `combineAssignmentsWith`. Currently, if set to e.g. `role`, it still maintains the `roleEdgeCache`, and the `roleAssignmentCache` tables. This is more compute-optimized, but less space-optimized. We could stop maintaining `roleEdgeCache` in that case and only focus on `roleAssignmentCache`. This would be a bit more complex, but could save space. If space is an issue, need to consider adding this. Space is not an issue: in the example app, the role cache has 10,000 rows and 3.2 MB, less than a third of the assignment cache and 0.4% of the database. It also cannot go: `current_role` lists the roles above the user from it, and the assignment cache is maintained from its changes.
- [x] Customizable prefix for triggers, to order p9s triggers with the other triggers of a table (Postgres runs them in the order of their names): `naming.triggerPrefix` goes before the `05_`, `07_`, `10_` and `20_` that order p9s triggers among themselves. Changing it renames the p9s triggers on the next migration.
- [x] Support soft-delete for all kinds of nodes. `softDelete: "deleted_at"` on a table soft deletes its rows when the column is set, for resource and role tables, nodes and leaves. A deleted node leaves the graph: its edges and assignments wait in tables aside, so a deleted folder hides what is below it, a deleted team stops giving its members access, and a deleted API key has none, until the column is null again. Soft deleting needs the `delete` bit, deleted rows stay readable by those who would read them once restored, and users list them in `current_deleted_resource` and bring them back with `resource_restore(resource_id)`. Reads cost the same as without it. See [soft delete](./website/docs/configuration/overview.md#soft-delete).
- [x] Build an actual life-sized example SaaS app: [`examples/nextjs-drizzle`](./examples/nextjs-drizzle) is a team workspace with organizations, teams, members, nested folders, documents, comments, sharing, an access overview, API keys, an audit log, and admins viewing or acting as members, where RLS decides every permission. Its seed creates 3000 mock users with predictable accounts, and 180,000 documents in 6,000 folders: a member reads about 100,000 of them. Members share through p9s, and see who has access with `manageAccess`; the server only writes team changes as a graph writer.
- [x] Several parent columns per table. A table follows one parent column, so a folder at the top of a workspace, or in another folder, needs a column holding the resource id of either, filled by a trigger of the app, like `parent_resource_id` in the example. Let a table list several parent columns, of which a row sets one. `resourceParent` and `roleParent` now take a list: the parent of a row is the first column of the list that it sets, so a row that sets only one has that one, and a nested folder can keep its organization column. The example follows `parent_id`, or else `org_id`, without its trigger and column. The migration also no longer fires the triggers of the previous migration on bound tables, which broke when a parent column was dropped. See [parent columns](./website/docs/configuration/overview.md#parent-columns).
