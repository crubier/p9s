---
sidebar_position: 1
---

# Core

[`@p9s/core`](https://github.com/crubier/p9s/tree/main/packages/core) has the types of the config, its defaults, its validation, its JSON Schema, the presets, and the names the migration gives to what it creates. The other TypeScript packages and the CLI build on it.

## Installation

```bash
npm install @p9s/core
```

## Configuration Types

### CompleteConfig

The main configuration type with full type safety:

```typescript
import type { CompleteConfig } from "@p9s/core";

type MyUsers = "admin" | "user" | "guest";

const config: CompleteConfig<MyUsers> = {
  engine: {
    schema: "public",
    users: ["admin", "user", "guest"],
    // ... other options
  },
  migration: { output: { sql: "migration.sql" } },
  tables: [],
};
```

### Config (Partial)

For partial configuration that gets merged with defaults:

```typescript
import type { Config } from "@p9s/core";
import { getCompleteConfig } from "@p9s/core";

const partialConfig: Config<"admin" | "user"> = {
  engine: {
    users: ["admin", "user"],
  },
};

const complete = getCompleteConfig(partialConfig);
```

## Validation

### validateConfig

Validates a partial configuration:

```typescript
import { validateConfig } from "@p9s/core";

const result = validateConfig({
  engine: { users: ["admin"] },
});

if (result.success) {
  console.log("Valid config:", result.data);
} else {
  console.error("Errors:", result.errors);
}
```

### validateCompleteConfig

Validates a complete configuration with all required fields:

```typescript
import { validateCompleteConfig } from "@p9s/core";

const result = validateCompleteConfig(config);
```

### parseConfig and parseCompleteConfig

The same checks, which return the config or throw the `ZodError`:

```typescript
import { parseConfig } from "@p9s/core";

const config = parseConfig(JSON.parse(text));
```

### getValidationErrors

Get formatted error messages:

```typescript
import { getValidationErrors } from "@p9s/core";

const result = validateCompleteConfig(config);
const errors = getValidationErrors(result);
// ['engine.permission.bitmap.size: Must be at least 4']
```

## Naming Utilities

### getCompleteNamingConfig

Generates naming configuration for all database objects:

```typescript
import { getCompleteNamingConfig } from "@p9s/core";

const naming = getCompleteNamingConfig(config);
// naming.resource.edge -> 'p9s_resource_edge'
// naming.tables.documents.permission.admin.select -> 'documents_admin_select_policy'
```

### getNaming

Returns naming config with SQL identifiers:

```typescript
import { getNaming } from "@p9s/core";

const naming = getNaming(config);
// naming.resource.node -> SQL identifier object
```

## Default Configuration

```typescript
import { defaultConfig } from "@p9s/core";

// defaultConfig includes:
// - schema: 'public'
// - permission.bitmap.size: 128
// - permission.maxDepth.resource: 16
// - permission.maxDepth.role: 16
// - id.mode: 'integer'
// - combineAssignmentsWith: 'none'
// - resourceCache: 'full'
// - authentication.getCurrentUserId: 'get_current_user_id'
```

## Zod Schemas

All configuration schemas are available for custom validation:

```typescript
import {
  completeConfigSchema,
  configSchema,
  engineConfigSchema,
  tableConfigSchema,
} from "@p9s/core";

// Use with z.toJSONSchema() for JSON Schema generation
import { z } from "zod";
const jsonSchema = z.toJSONSchema(completeConfigSchema);
```

## JSON Schema

`configJsonSchema()` returns the JSON Schema of `p9s.config.json`, which `configJsonSchemaUrl`, `https://p9s.vercel.app/p9s.config.schema.json`, serves, and the package ships it as `@p9s/core/p9s.config.schema.json`. See [the CLI](./cli#the-json-schema-of-the-config) for editors.

## Presets

`supabase` holds the engine settings of a Supabase project, to spread in `engine`: `authenticated` as the user, `service_role` as the graph writer, `auth.uid()` as the current user, and uuid ids. See [Supabase](../integrations/supabase).

```typescript
import { supabase } from "@p9s/core";

const config = { engine: { ...supabase, grantPrivileges: true }, tables: [] };
```

## Packages that act as a user

The packages of each stack read the role and the setting from the config, and run each transaction as a user:

| Language | Package | Reference |
| --- | --- | --- |
| TypeScript | `@p9s/postgres` | [Postgres](./postgres) |
| TypeScript | `@p9s/drizzle` | [Drizzle](./drizzle) |
| TypeScript | `@p9s/prisma` | [Prisma](./prisma) |
| TypeScript | `@p9s/kysely` | [Kysely](./kysely) |
| Python | `p9s` | [Python](./python) |
| Ruby | `p9s` | [Ruby](./ruby) |
| Go | `github.com/crubier/p9s/packages/go` | [Go](./go) |
| Rust | `p9s` | [Rust](./rust) |
| Elixir | `p9s` | [Elixir](./elixir) |
| PHP | `p9s/laravel` | [PHP](./php) |
