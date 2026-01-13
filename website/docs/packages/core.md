---
sidebar_position: 1
---

# Core Package

The `p9s` core package provides configuration types, validation, and naming utilities.

## Installation

```bash
bun add p9s
```

## Configuration Types

### CompleteConfig

The main configuration type with full type safety:

```typescript
import type { CompleteConfig } from "p9s";

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
import type { Config } from "p9s";
import { getCompleteConfig } from "p9s";

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
import { validateConfig } from "p9s/validation";

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
import { validateCompleteConfig } from "p9s/validation";

const result = validateCompleteConfig(config);
```

### getValidationErrors

Get formatted error messages:

```typescript
import { getValidationErrors } from "p9s/validation";

const result = validateCompleteConfig(config);
const errors = getValidationErrors(result);
// ['engine.permission.bitmap.size: Must be at least 4']
```

## Naming Utilities

### getCompleteNamingConfig

Generates naming configuration for all database objects:

```typescript
import { getCompleteNamingConfig } from "p9s";

const naming = getCompleteNamingConfig(config);
// naming.resource.node -> 'p9s_resource_node'
// naming.tables.documents.permission.admin.select -> 'documents_admin_select_policy'
```

### getNaming

Returns naming config with SQL identifiers:

```typescript
import { getNaming } from "p9s";

const naming = getNaming(config);
// naming.resource.node -> SQL identifier object
```

## Default Configuration

```typescript
import { defaultConfig } from "p9s";

// defaultConfig includes:
// - schema: 'public'
// - permission.bitmap.size: 128
// - permission.maxDepth.resource: 16
// - permission.maxDepth.role: 16
// - id.mode: 'integer'
// - combineAssignmentsWith: 'none'
```

## Zod Schemas

All configuration schemas are available for custom validation:

```typescript
import {
  completeConfigSchema,
  configSchema,
  engineConfigSchema,
  tableConfigSchema,
} from "p9s/configuration-schema";

// Use with z.toJSONSchema() for JSON Schema generation
import { z } from "zod";
const jsonSchema = z.toJSONSchema(completeConfigSchema);
```
