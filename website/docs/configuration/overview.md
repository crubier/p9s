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
    // Roles that run end-user queries, they get RLS policies and read-only access to the permission graph
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

The migration is idempotent: running it again updates functions, triggers, policies and privileges without dropping data, and gives ids and home edges to business rows that existed before a table was bound to p9s. Databases created with node tables by earlier versions are upgraded, see [Upgrading](./upgrading).

## Configuration Sections

### Engine Configuration

| Property                          | Type                             | Description                                                              |
| --------------------------------- | -------------------------------- | ------------------------------------------------------------------------ |
| `schema`                          | `string`                         | PostgreSQL schema name, must be the current schema when migrating        |
| `users`                           | `string[]`                       | Roles that query business tables through RLS                             |
| `graphWriters`                    | `string[]`                       | Roles allowed to modify edges and assignments (default: none)            |
| `permission.bitmap.size`          | `number`                         | Size of permission bitmap (4-1024)                                       |
| `permission.maxDepth.resource`    | `number`                         | Most edges on a path of the resource tree (1-128), longer paths are rejected |
| `permission.maxDepth.role`        | `number`                         | Most edges on a path of the role tree (1-128), longer paths are rejected |
| `naming.triggerPrefix`            | `string`                         | Put before the names of p9s triggers, to order them with yours (default: none) |
| `authentication.getCurrentUserId` | `string`                         | SQL function returning the role id of the current user's row, a node or a role leaf row |
| `id.mode`                         | `'integer' \| 'uuid'`            | Type of resource and role ids                                            |
| `combineAssignmentsWith`          | `'none' \| 'role' \| 'resource'` | Also cache assignments combined with the role or resource tree           |

`getCurrentUserId` must exist before the migration runs, for example:

```sql
create function current_role_id() returns uuid language sql stable as $$
  select nullif(current_setting('jwt.claims.role_id', true), '')::uuid
$$;
```

With role leaf tables, p9s calls it from `current_role_node()`, which runs as the owner of the migration so that it can read the leaf tables. It should read the request, like a setting, rather than `current_user`, and belong to a role you trust, since it already decides who the user is.

The caches follow paths of up to `maxDepth` edges. A write that would make a longer path, like adding a row under the deepest folder or moving a folder under another, fails with `p9s: the resource edge 4 -> 5 makes a path of more than 16 edges`, and so does enabling the triggers again after a bulk load with a longer path. Paths are counted without going twice through a node, so a cycle does not make a tree deeper than its longest path. The check costs a walk up from the new edge and down from it, a few hundredths of a millisecond per write in the [benchmarks](../benchmarks).

Postgres runs the triggers of a table that fire on the same event in the order of their names. p9s names its triggers `05_…`, `10_…` and `20_…`, so with `naming: { triggerPrefix: "p9s_" }` they become `p9s_05_…`, and run after triggers named `a_…` to `o_…` and before `q_…` to `z_…`. Changing the prefix renames the p9s triggers on the next migration.

With `combineAssignmentsWith: "role"`, p9s maintains an `assignment_edge_cache` of every (user, resource) pair reachable through an assignment, and RLS policies read it instead of joining the role cache. Reads get cheaper and assignment or role changes get more expensive, see [Benchmarks](../benchmarks).

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
| `resourceParent` | `object`  | Column naming each row's parent resource, see below                          |
| `resourceLeaf`   | `boolean` | Rows are not nodes and take the permissions of their parent, see below        |
| `resourceFkey`   | `string`  | Foreign key to `resource_node` from earlier versions, dropped when upgrading  |
| `isRole`         | `boolean` | Whether rows are roles                                                        |
| `roleId`         | `string`  | Role id column, added by p9s if missing, with a default                       |
| `roleParent`     | `object`  | Column naming each row's parent role, see below                              |
| `roleLeaf`       | `boolean` | Rows are not nodes and act with the permissions of their parent, see below    |
| `roleFkey`       | `string`  | Foreign key to `role_node` from earlier versions, dropped when upgrading      |
| `permission`     | `object`  | For each user role, the bit checked for each operation                        |

#### Parent columns

`resourceParent: { column, table?, key? }` makes p9s keep an edge from each row's parent to the row, its *home edge*, in sync with `column`:

- Without `table`, `column` holds resource ids, of a row of any resource table.
- With `table`, `column` holds values of that table's `key` column. `key` defaults to the parent table's `resourceId` column. With `key: "id"`, the column can be an ordinary foreign key to the parent's primary key.

`roleParent` works the same on the role tree, for example to put each user in a team. A parent `table` must be a resource (or role) table of the config. Index the parent columns, p9s looks rows up by them.

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

## Validation

Configuration is validated at runtime using Zod schemas. Key validations include:

- Bitmap size must be between 4 and 1024
- Max depth must be between 1 and 128
- Permission users in tables must exist in `engine.users`
- A `resourceParent` needs `isResource`, a `roleParent` needs `isRole`, and a parent `table` must be a table of the same kind
- A `resourceLeaf` table needs `isResource` and a `resourceParent`, a `roleLeaf` table needs `isRole` and a `roleParent`, and neither can be the parent table of another table of the same kind

```typescript
import { validateCompleteConfig } from "@p9s/core";

const result = validateCompleteConfig(config);
if (!result.success) {
  console.error("Validation errors:", result.errors);
}
```
