---
sidebar_position: 1
---

# Configuration Overview

p9s uses a configuration object to define your permission system. The configuration is validated using Zod schemas at runtime, and missing fields are filled from defaults.

## Basic Configuration

```typescript
import type { Config } from "@p9s/core";

const config: Config<"authenticated"> = {
  engine: {
    schema: "public",
    // Roles that run end-user queries, they get RLS policies and see their own part of the permission graph
    users: ["authenticated"],
    // Roles allowed to change edges and assignments, see the security model
    graphWriters: ["app_backend"],
    permission: {
      bitmap: { size: 16 },
      maxDepth: { resource: 16, role: 16 },
    },
    authentication: {
      getCurrentUserId: "current_role_id",
    },
    id: { mode: "uuid" },
    combineAssignmentsWith: "role",
  },
  migration: {
    output: { sql: "p9s-migration.sql" },
  },
  tables: [
    {
      name: "folder",
      isResource: true,
      resourceId: "resource_id",
      // A folder is in the folder whose "id" is in its "parent_id" column
      resourceParent: { column: "parent_id", table: "folder", key: "id" },
      // Bit positions in the permission bitmap
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
    {
      name: "user",
      isRole: true,
      roleId: "role_id",
    },
  ],
};
```

Generate the SQL with the CLI (`p9s postgres generate`), or in code:

```typescript
import { createMigration } from "@p9s/postgres";
import { compile } from "pg-sql2";

const { text } = compile(createMigration(config));
```

The migration is idempotent: running it again updates functions, triggers, policies and privileges without dropping data, and gives ids and home edges to business rows that existed before a table was bound to p9s. Databases created with node tables by earlier versions are upgraded, see [Upgrading](./upgrading#from-node-tables).

## Configuration Sections

### Engine Configuration

| Property                          | Type                             | Description                                                              |
| --------------------------------- | -------------------------------- | ------------------------------------------------------------------------ |
| `schema`                          | `string`                         | PostgreSQL schema name, must be the current schema when migrating        |
| `users`                           | `string[]`                       | Roles that query business tables through RLS                             |
| `graphWriters`                    | `string[]`                       | Roles allowed to modify edges and assignments (default: none)            |
| `permission.bitmap.size`          | `number`                         | Size of permission bitmap (4-1024)                                       |
| `permission.bitmap.names`         | `Record<string, number>`         | Names of bit positions: `permission_flags(bit)` gives a boolean per name, and the PostGraphile `permission` fields too, see [PostGraphile](./postgraphile.md) (default: none) |
| `permission.maxDepth.resource`    | `number`                         | Most edges on a path of the resource tree (1-128), longer paths are rejected |
| `permission.maxDepth.role`        | `number`                         | Most edges on a path of the role tree (1-128), longer paths are rejected |
| `naming.triggerPrefix`            | `string`                         | Put before the names of p9s triggers, to order them with yours (default: none) |
| `authentication.getCurrentUserId` | `string`                         | SQL function returning the role id of the current user's row, a node or a role leaf row |
| `authentication.setting`          | `string`                         | Setting holding that role id, like `app.role_id`: the migration then creates `getCurrentUserId`, see [acting as a user](./identity) (default: none) |
| `authentication.key`              | `{ table, column }`              | Column of a role table the setting holds instead of the role id, like the id of the user in the users table of the app, see [the id of the user in the app](./identity#the-id-of-the-user-in-the-app) (default: none) |
| `grantPrivileges`                 | `boolean`                        | Grant users the statements their permissions name, see [privileges](#privileges) (default: `false`) |
| `id.mode`                         | `'integer' \| 'uuid'`            | Type of resource and role ids                                            |
| `combineAssignmentsWith`          | `'none' \| 'role' \| 'resource'` | Also cache assignments combined with the role or resource tree           |
| `resourceCache`                   | `'full' \| 'assigned'`           | Cache every (ancestor, descendant) pair of resources, or only those below resources that have assignments (default: `'full'`), see [resource cache](#resource-cache) |
| `postgraphile`                    | `boolean`                        | Smart comments and `permission` fields for PostGraphile, see [PostGraphile](./postgraphile) |

With `authentication.setting`, the migration creates `getCurrentUserId`, and `createIdentity` and the Drizzle and Prisma helpers set that setting in each transaction of a user, see [acting as a user](./identity). Otherwise `getCurrentUserId` must exist before the migration runs, for example:

```sql
create function current_role_id() returns uuid language sql stable as $$
  select nullif(current_setting('jwt.claims.role_id', true), '')::uuid
$$;
```

With role leaf tables, p9s calls it from `current_role_node()`, which runs as the owner of the migration so that it can read the leaf tables. It should read the request, like a setting, rather than `current_user`, and belong to a role you trust, since it already decides who the user is.

The caches follow paths of up to `maxDepth` edges. A write that would make a longer path, like adding a row under the deepest folder or moving a folder under another, fails with `p9s: the resource edge 4 -> 5 makes a path of more than 16 edges`, and so does enabling the triggers again after a bulk load with a longer path. Paths are counted without going twice through a node, so a cycle does not make a tree deeper than its longest path. The check costs a walk up from the new edge and down from it, a few hundredths of a millisecond per write in the [benchmarks](../benchmarks).

Postgres runs the triggers of a table that fire on the same event in the order of their names. p9s names its triggers `05_…`, `07_…`, `10_…` and `20_…`, so with `naming: { triggerPrefix: "p9s_" }` they become `p9s_05_…`, and run after triggers named `a_…` to `o_…` and before `q_…` to `z_…`. Changing the prefix renames the p9s triggers on the next migration.

With `combineAssignmentsWith: "role"`, p9s maintains an `assignment_edge_cache` of every (user, resource) pair reachable through an assignment, and RLS policies read it instead of joining the role cache. Reads get cheaper and assignment or role changes get more expensive, see [Benchmarks](../benchmarks).

#### Privileges

The policies decide which rows a user role reaches, and Postgres first needs that role to have the privilege of the statement on the table. With `engine.grantPrivileges: true`, the migration grants each role of `engine.users` the statements its `permission` names on each table, with the usage of the schema, and of the sequences of the table when it can insert. A table whose permission is `{ app_user: { select: 0, insert: 1 } }` gets `grant select, insert ... to app_user`. The migration only grants: grants of the app stay, like the select of a few columns of the users table, and removing a statement from the config does not revoke it.

#### Resource cache

Permissions only come from the resources that have assignments, and the policies only read the cache rows that start at one of them. With `resourceCache: "assigned"`, p9s only keeps those rows, and a self row for every resource. In the example app, where 870 of 190,000 resources are shared, that is 572,000 of 1.32 million rows. Reads and writes in the tree cost the same, see [the benchmarks](../benchmarks#caching-only-below-assignments). What changes:

- The first assignment of a resource caches everything below it, and removing its last assignment drops those rows. Sharing a workspace of 1,110 resources for the first time takes 6 ms instead of 0.2 ms, an organization of 11,110 resources 63 ms.
- `current_resource_edge`, and `resource_edge_cache` for graph writers, only tell whether a resource is below another when the one above has assignments. To tell whether a folder would move inside itself, walk up its new parents, as the example app does.

The role cache keeps every pair, as `current_role` lists every role above the user. It is small: 10,000 rows in the example app, against 34,000 in the `assignment_edge_cache` of `combineAssignmentsWith: "role"`, which is also maintained from it.

### Migration Configuration

| Property     | Type     | Description                        |
| ------------ | -------- | ---------------------------------- |
| `output.sql` | `string` | Output file path for SQL migration |

### Tables Configuration

Each table entry defines how a database table integrates with the permission system:

| Property         | Type      | Description                                                                   |
| ---------------- | --------- | ----------------------------------------------------------------------------- |
| `schema`         | `string`  | Table schema                                                                  |
| `name`           | `string`  | Table name                                                                    |
| `isResource`     | `boolean` | Whether rows are resources                                                    |
| `resourceId`     | `string`  | Resource id column, added by p9s if missing, with a default                   |
| `resourceParent` | `object \| object[]` | Column naming each row's parent resource, or several, see below     |
| `resourceLeaf`   | `boolean` | Rows are not nodes and take the permissions of their parent, see below        |
| `resourceFkey`   | `string`  | Foreign key to `resource_node` from earlier versions, dropped when upgrading  |
| `isRole`         | `boolean` | Whether rows are roles                                                        |
| `roleId`         | `string`  | Role id column, added by p9s if missing, with a default                       |
| `roleParent`     | `object \| object[]` | Column naming each row's parent role, or several, see below         |
| `roleLeaf`       | `boolean` | Rows are not nodes and act with the permissions of their parent, see below    |
| `roleFkey`       | `string`  | Foreign key to `role_node` from earlier versions, dropped when upgrading      |
| `softDelete`     | `string`  | Nullable column, like `deleted_at`, that soft deletes a row when set, see below |
| `search`         | `object`  | Searches through indexes, by name: the columns they match and the operator, see below |
| `permission`     | `object`  | For each user role, the bit checked for each operation, and optionally the `manageAccess` bit that lets them see who has access to a row, see [seeing the access of others](./security-model#seeing-the-access-of-others), and the `share` bit that lets them share it, see [sharing](./security-model#sharing) |

#### Parent columns

`resourceParent: { column, table?, key? }` makes p9s keep an edge from each row's parent to the row, its *home edge*, in sync with `column`:

- Without `table`, `column` holds resource ids, of a row of any resource table.
- With `table`, `column` holds values of that table's `key` column. `key` defaults to the parent table's `resourceId` column. With `key: "id"`, the column can be an ordinary foreign key to the parent's primary key.

`roleParent` works the same on the role tree, for example to put each user in a team. A parent `table` must be a resource (or role) table of the config. Index the parent columns, p9s looks rows up by them.

**Several parent columns.** A list of parents makes the parent of a row the first of them that it sets. A folder is in another folder, or else at the top of its organization:

```ts
{
  name: "folder",
  isResource: true,
  resourceId: "resource_id",
  resourceParent: [
    { column: "parent_id", table: "folder", key: "id" },
    { column: "org_id", table: "organization", key: "id" },
  ],
}
```

A nested folder sets both columns: its parent is the folder, and changing its `org_id` moves nothing. Setting `parent_id` to null moves it to the top of its organization. Inserting or moving a row needs the `insert` bit on that parent, whichever column it is in, and a leaf table can list several parents the same way. To let a row set only one of them, add a check constraint like `check (num_nonnulls(parent_id, space_id) <= 1)`. Each column must be a different one, and each `table` a table of the same kind.

#### Leaf tables

Some rows always have a single parent and the same permissions as that parent, and there are many of them: the blocks or comments of a page. With `resourceLeaf: true`, the rows of a table are not nodes. They have no resource id, no edges and no cache rows, and the policies of the table check the permissions of the parent instead. The permission graph then only holds the pages:

```typescript
{
  name: "comment",
  isResource: true,
  resourceLeaf: true,
  resourceParent: { column: "page_id", table: "page", key: "id" },
  permission: {
    authenticated: { select: 0, insert: 1, update: 2, delete: 3 },
  },
}
```

When the parent column holds a key of the parent table, like `page_id` above, p9s adds a `resource_parent_id` column to the leaf table, which a row trigger sets to the resource id of the parent on every insert and on every update of either column. Policies then compare a column, as for nodes, rather than look the parent up for every row they check. Resource ids never change, so the column stays right as long as the parent column does. Writing a leaf row never touches the graph and never waits for the graph lock. In exchange, a leaf row cannot be shared on its own, assigned to a role, or be the parent of other rows. A leaf table needs `isResource` and a `resourceParent`, and no table can name it as parent table. A leaf row without parent is out of reach of users.

Making a node table a leaf table removes its rows from the graph: the migration drops its p9s triggers, and deletes the shares and assignments of its rows. The `resourceId` column stays, p9s no longer uses it. If rows of the table are parents of other nodes, the migration stops: move their children first.

#### Role leaf tables

`roleLeaf: true` does the same on the role tree, for rows that act on behalf of a single parent, like the API keys of a user. Users stay nodes, so that teams can hold them and resources can be shared with them, while their keys stay out of the graph:

```typescript
{
  name: "api_key",
  isRole: true,
  roleId: "role_id",
  roleLeaf: true,
  roleParent: { column: "user_id", table: "user", key: "id" },
}
```

A role leaf row still has a role id, from the same sequence as the role nodes, but only to tell who the current user is: `getCurrentUserId` returns the role id of the key for a request made with it. Policies then look the key up once per query, through the `current_role_node` function, and check the permissions of its parent. A row trigger rejects a role id already used by a node or another leaf row, and an update changing it. With a key as parent column, p9s adds a `role_parent_id` column, kept by the same trigger like `resource_parent_id`. Moving or deleting a key never touches the graph and never waits for the graph lock. In exchange, a key cannot be a member of other roles, be assigned a resource of its own, or be the parent of other roles. A key without parent has no permissions.

Making a role node table a role leaf table removes its rows from the graph, like for resources. Policies only call `current_role_node` when the config has role leaf tables.

#### Soft delete

`softDelete: "deleted_at"` soft deletes a row when its `deleted_at` column is set, on node and leaf tables of both trees. The column is yours, of any type, and p9s only looks at whether it is null:

```typescript
{
  name: "document",
  isResource: true,
  resourceId: "resource_id",
  resourceParent: { column: "folder_id", table: "folder", key: "id" },
  softDelete: "deleted_at",
  permission: {
    authenticated: { select: 0, insert: 1, update: 2, delete: 3 },
  },
}
```

A soft deleted node leaves the graph: its edges, in both directions, and its assignments move to `resource_edge_deleted` (or `role_edge_deleted`) and `assignment_edge_deleted`, and the caches drop what went through them. Deleting a folder hides everything below it, and costs the graph what deleting it for good would: only its own edges move, the rows below keep theirs, and the caches drop the rows that went through it. A deleted role, like a team, stops giving its members its permissions, and a deleted API key has none. Setting the column back to null brings back the edges and assignments whose other end is not deleted, so restoring a folder brings back what was below it, and a document deleted on its own stays deleted. A row inserted or moved under a deleted row waits with it. Edges and assignments that would link a deleted row are rejected, and deleting a row for good forgets what it had aside.

Users soft delete a row by setting the column, which needs the `delete` bit on it. Reads cost the same as without soft delete: with 100,000 rows and 100 of them deleted, counting what a user reads takes 108 ms against 104, and soft deleting, or restoring, a row takes 3 ms. Deleted rows stay readable by users who would have the `select` bit once they are restored, and those with the `delete` bit can delete them for good. As they are out of the graph, users cannot update them: they restore them with `resource_restore(resource_id)`, see [soft deleted rows](./security-model#soft-deleted-rows). Leaf rows never leave the graph, they only need the `delete` bit of their parent to be soft deleted, and keep their permissions while deleted. Applications filter deleted rows out of their queries, like `where deleted_at is null`.

Rows written while the triggers were disabled are sorted out by `resource_trigger_enable()`, which every migration calls: adding `softDelete` to a table whose column is already set moves those rows out of the graph, and removing it from every table of a tree brings them back and drops the tables aside.

#### Searches

RLS checks a policy before any filter that is not leakproof, like `ilike`, `~`, the trigram `%` or full-text `@@`, so their indexes are never used through RLS: a search reads every row of the table and checks it, see [querying through RLS](./querying#filters-that-are-not-leakproof). `search` declares searches that go through the indexes:

```typescript
{
  name: "document",
  isResource: true,
  resourceId: "resource_id",
  resourceParent: { column: "folder_id", table: "folder", key: "id" },
  search: {
    search: { columns: ["title", "content"], operator: "ilike" },
  },
  permission: {
    authenticated: { select: 0, insert: 1, update: 2, delete: 3 },
  },
}
```

Each search is a function named after the table and its key, here `document_search(the_value text)`. It returns the rows of the table where one of the columns matches the value, among those the current user can read, and queries filter, order and page them like a table:

```sql
create extension if not exists pg_trgm;
create index on document using gin (title gin_trgm_ops);
create index on document using gin (content gin_trgm_ops);

select id, title from document_search('%budget%') where org_id = $1 order by updated_at desc limit 50;
```

The operator is `like`, `ilike`, `~`, `~*` or `%`, on text columns with a `text` value, which a [`pg_trgm`](https://www.postgresql.org/docs/current/pgtrgm.html) index serves, or `@@`, on `tsvector` columns with a `tsquery` value, which a GIN index serves. p9s does not create the indexes. The search matches through them as the owner, checks the rows that match against the select policy of the user, and reads those the user can read through RLS: it costs about what matches, readable or not, rather than the whole table. [Searches](./security-model#searches) explains why it shows no more than a filter through RLS would. Each user role with the `select` bit on the table can run it, and a migration drops the searches the config no longer declares.

### Links Configuration

An application that already keeps who belongs to which team, and who shares what, in its own tables names them in `links`. The migration turns their rows into edges and assignments, and from then on triggers keep the graph in step with every insert, update and delete, so the application goes on writing its own tables:

```typescript
{
  tables: [/* app_user, team and document, as role and resource tables */],
  links: [
    {
      name: "team_member", kind: "role",
      parent: { column: "team_id", table: "team", key: "id" },
      child: { column: "user_id", table: "app_user", key: "id" },
    },
    {
      name: "document_share", kind: "assignment",
      resource: { column: "document_id", table: "document", key: "id" },
      role: { column: "team_id", table: "team", key: "id" },
      permission: { column: "access", values: { viewer: ["read"], editor: ["read", "edit"] } },
    },
  ],
}
```

- `kind: "resource"` links a `parent` and a `child` resource, like a document in several folders, `kind: "role"` a `parent` and a `child` role, like a team and its members, and `kind: "assignment"` a `resource` and a `role`.
- Each end is a column of the link table, the table of the other end, and the `key` of that table the column holds, `id` when it holds the node id. A key that matches no row stops the migration, and a later insert, with a foreign key violation.
- `permission` is the bitmap of the edge: bit names or positions, the same for every row, or a `column` and the bits of each of its values, read as text, so `true` and `false` for a boolean. A row whose value is not listed gives nothing. Without `permission`, edges have every bit, and an assignment needs one.
- Several rows for the same pair give the union of their bits, and so do several link tables of the same kind.

The edges and assignments of links have `linked` set, and the migration only removes those. Running the migration again, after rows were written while the triggers were disabled, makes the graph match the link tables again, and a config without a link drops its triggers and the edges it gave.

A user who inserts, updates or deletes a row of a link table of assignments can only give, or take, bits they have on the resource, like when sharing through `assignment_edge`. Who may write a link table at all is up to its grants and its own policies: `privileges` grants users the statements it names, like `privileges: { app_user: ["select", "insert", "delete"] }` for users who share documents. A link table cannot be truncated while linked.

Limits: the ends cannot be leaf or soft deleted tables, a pair that is also the parent column of the child keeps the edge of the parent column, and edges a graph writer changes by hand on a linked pair are overwritten at the next change of the link tables.

## Validation

Configuration is validated at runtime using Zod schemas. Key validations include:

- Bitmap size must be between 4 and 1024
- Max depth must be between 1 and 128
- Permission users in tables must exist in `engine.users`
- A `resourceParent` needs `isResource`, a `roleParent` needs `isRole`, and a parent `table` must be a table of the same kind. Several parents need a column each
- A `resourceLeaf` table needs `isResource` and a `resourceParent`, a `roleLeaf` table needs `isRole` and a `roleParent`, and neither can be the parent table of another table of the same kind
- `softDelete` needs a resource or role table
- `search` needs a resource table with a `select` bit
- A link needs the ends of its kind, on tables of the right kind that are neither leaf nor soft deleted tables, and its bit names must exist

```typescript
import { validateCompleteConfig } from "@p9s/core";

const result = validateCompleteConfig(config);
if (!result.success) {
  console.error("Validation errors:", result.errors);
}
```
