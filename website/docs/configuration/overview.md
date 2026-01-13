---
sidebar_position: 1
---

# Configuration Overview

p9s uses a configuration object to define your permission system. The configuration is validated using Zod schemas at runtime.

## Basic Configuration

```typescript
import { getCompleteConfig } from "p9s";

const config = getCompleteConfig({
  engine: {
    schema: "public",
    users: ["postgres", "authenticated", "anonymous"],
    permission: {
      bitmap: { size: 128 },
      maxDepth: { resource: 16, role: 16 },
    },
    authentication: {
      getCurrentUserId: "get_current_user_id",
    },
    id: { mode: "uuid" },
    combineAssignmentsWith: "none",
  },
  migration: {
    output: { sql: "permissions.sql" },
  },
  tables: [
    {
      schema: "public",
      name: "documents",
      isResource: true,
      resourceId: "id",
      resourceFkey: "document_fkey",
      isRole: false,
      roleId: "",
      roleFkey: "",
      permission: {
        postgres: { select: 1, insert: 1, update: 1, delete: 1 },
        authenticated: { select: 1, insert: 1, update: 1, delete: 0 },
        anonymous: { select: 1, insert: 0, update: 0, delete: 0 },
      },
    },
  ],
});
```

## Configuration Sections

### Engine Configuration

| Property                          | Type                             | Description                         |
| --------------------------------- | -------------------------------- | ----------------------------------- |
| `schema`                          | `string`                         | PostgreSQL schema name              |
| `users`                           | `string[]`                       | List of database users/roles        |
| `permission.bitmap.size`          | `number`                         | Size of permission bitmap (4-1024)  |
| `permission.maxDepth.resource`    | `number`                         | Max depth for resource tree (1-128) |
| `permission.maxDepth.role`        | `number`                         | Max depth for role tree (1-128)     |
| `authentication.getCurrentUserId` | `string`                         | Function name to get current user   |
| `id.mode`                         | `'integer' \| 'uuid'`            | ID generation mode                  |
| `combineAssignmentsWith`          | `'none' \| 'role' \| 'resource'` | Cache optimization strategy         |

### Migration Configuration

| Property     | Type     | Description                        |
| ------------ | -------- | ---------------------------------- |
| `output.sql` | `string` | Output file path for SQL migration |

### Tables Configuration

Each table entry defines how a database table integrates with the permission system:

| Property       | Type      | Description                  |
| -------------- | --------- | ---------------------------- |
| `schema`       | `string`  | Table schema                 |
| `name`         | `string`  | Table name                   |
| `isResource`   | `boolean` | Whether table is a resource  |
| `resourceId`   | `string`  | Resource ID column name      |
| `resourceFkey` | `string`  | Resource foreign key name    |
| `isRole`       | `boolean` | Whether table is a role      |
| `roleId`       | `string`  | Role ID column name          |
| `roleFkey`     | `string`  | Role foreign key name        |
| `permission`   | `object`  | Per-user permission settings |

## Validation

Configuration is validated at runtime using Zod schemas. Key validations include:

- Bitmap size must be between 4 and 1024
- Max depth must be between 1 and 128
- Permission users in tables must exist in `engine.users`

```typescript
import { validateCompleteConfig } from "p9s/validation";

const result = validateCompleteConfig(config);
if (!result.success) {
  console.error("Validation errors:", result.errors);
}
```
