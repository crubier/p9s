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
    // Roles allowed to change nodes, edges and assignments, see the security model
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
      name: "document",
      isResource: true,
      resourceId: "resource_id",
      // Bit positions in the permission bitmap
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

The migration is idempotent: running it again updates functions, triggers, policies and privileges without dropping data, and backfills node ids for business rows that existed before a table was bound to p9s.

## Configuration Sections

### Engine Configuration

| Property                          | Type                             | Description                                                              |
| --------------------------------- | -------------------------------- | ------------------------------------------------------------------------ |
| `schema`                          | `string`                         | PostgreSQL schema name, must be the current schema when migrating        |
| `users`                           | `string[]`                       | Roles that query business tables through RLS                             |
| `graphWriters`                    | `string[]`                       | Roles allowed to modify nodes, edges and assignments (default: none)     |
| `permission.bitmap.size`          | `number`                         | Size of permission bitmap (4-1024)                                       |
| `permission.maxDepth.resource`    | `number`                         | Max depth for resource tree (1-128)                                      |
| `permission.maxDepth.role`        | `number`                         | Max depth for role tree (1-128)                                          |
| `authentication.getCurrentUserId` | `string`                         | SQL function returning the current user's role node id                   |
| `id.mode`                         | `'integer' \| 'uuid'`            | Type of node ids                                                         |
| `combineAssignmentsWith`          | `'none' \| 'role' \| 'resource'` | Also cache assignments combined with the role or resource tree           |

`getCurrentUserId` must exist before the migration runs, for example:

```sql
create function current_role_id() returns uuid language sql stable as $$
  select nullif(current_setting('jwt.claims.role_id', true), '')::uuid
$$;
```

With `combineAssignmentsWith: "role"`, p9s maintains an `assignment_edge_cache` of every (user, resource) pair reachable through an assignment, and RLS policies read it instead of joining the role cache. Reads get cheaper and assignment or role changes get more expensive, see [Benchmarks](../benchmarks).

### Migration Configuration

| Property     | Type     | Description                        |
| ------------ | -------- | ---------------------------------- |
| `output.sql` | `string` | Output file path for SQL migration |

### Tables Configuration

Each table entry defines how a database table integrates with the permission system:

| Property       | Type      | Description                                                         |
| -------------- | --------- | ------------------------------------------------------------------- |
| `schema`       | `string`  | Table schema                                                        |
| `name`         | `string`  | Table name                                                          |
| `isResource`   | `boolean` | Whether rows are resources, adds a column referencing `resource_node` |
| `resourceId`   | `string`  | Resource node id column name                                        |
| `resourceFkey` | `string`  | Resource foreign key name                                           |
| `isRole`       | `boolean` | Whether rows are roles, adds a column referencing `role_node`       |
| `roleId`       | `string`  | Role node id column name                                            |
| `roleFkey`     | `string`  | Role foreign key name                                               |
| `permission`   | `object`  | For each user role, the bit checked for each operation              |

## Validation

Configuration is validated at runtime using Zod schemas. Key validations include:

- Bitmap size must be between 4 and 1024
- Max depth must be between 1 and 128
- Permission users in tables must exist in `engine.users`

```typescript
import { validateCompleteConfig } from "@p9s/core";

const result = validateCompleteConfig(config);
if (!result.success) {
  console.error("Validation errors:", result.errors);
}
```
