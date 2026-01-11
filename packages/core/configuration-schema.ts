import { z } from "zod";

// Permission per operation (numeric values for table config)
export const permissionPerOperationSchema = z.object({
  select: z.number(),
  insert: z.number(),
  update: z.number(),
  delete: z.number(),
});

// Permission per operation (string values for naming config)
export const permissionPerOperationNamingSchema = z.object({
  select: z.string(),
  insert: z.string(),
  update: z.string(),
  delete: z.string(),
});

// Base naming config schema (matches defaultBaseNamingConfig structure)
export const baseNamingConfigSchema = z.object({
  prefix: z.string(),
  id: z.string(),
  resource: z.object({ name: z.string() }),
  role: z.object({ name: z.string() }),
  assignment: z.object({ name: z.string() }),
  node: z.string(),
  edge: z.string(),
  parent: z.string(),
  child: z.string(),
  pkey: z.string(),
  fkey: z.string(),
  function: z.string(),
  index: z.string(),
  cache: z.string(),
  permission: z.string(),
  compute: z.string(),
  var: z.string(),
  view: z.string(),
  reverse: z.string(),
  backfill: z.string(),
  refresh: z.string(),
  trigger: z.string(),
  policy: z.string(),
  select: z.string(),
  insert: z.string(),
  update: z.string(),
  delete: z.string(),
  recursive: z.string(),
  enable: z.string(),
  disable: z.string(),
});

// Derived resource or role naming config schema
export const derivedResourceOrRoleNamingConfigSchema = z.object({
  id: z.string(),
  pkey: z.string(),
  node: z.string(),
  edge: z.string(),
  parentId: z.string(),
  childId: z.string(),
  permission: z.string(),
  edgePkey: z.string(),
  parentFkey: z.string(),
  childFkey: z.string(),
  edgeParentIdIndex: z.string(),
  edgeChildIdIndex: z.string(),
  edgeCache: z.string(),
  edgeCachePkey: z.string(),
  edgeCacheParentFkey: z.string(),
  edgeCacheChildFkey: z.string(),
  edgeCacheParentIdIndex: z.string(),
  edgeCacheChildIdIndex: z.string(),
  edgeCacheParentCompute: z.string(),
  edgeCacheChildCompute: z.string(),
  varParentId: z.string(),
  varChildId: z.string(),
  edgeCacheView: z.string(),
  edgeCacheBackfill: z.string(),
  edgeInsertTriggerFunction: z.string(),
  edgeInsertTrigger: z.string(),
  edgeUpdateTriggerFunction: z.string(),
  edgeUpdateTrigger: z.string(),
  edgeDeleteTriggerFunction: z.string(),
  edgeDeleteTrigger: z.string(),
  nodeInsertTriggerFunction: z.string(),
  nodeInsertTrigger: z.string(),
  nodeUpdateTriggerFunction: z.string(),
  nodeUpdateTrigger: z.string(),
  nodeDeleteTriggerFunction: z.string(),
  nodeDeleteTrigger: z.string(),
  enableTriggerFunction: z.string(),
  disableTriggerFunction: z.string(),
});

// Assignment naming config schema
export const assignmentNamingConfigSchema = z.object({
  edge: z.string(),
  resourceId: z.string(),
  roleId: z.string(),
  edgePkey: z.string(),
  resourceFkey: z.string(),
  roleFkey: z.string(),
  edgeResourceIdIndex: z.string(),
  edgeRoleIdIndex: z.string(),
  permission: z.string(),
  edgeCache: z.string(),
  edgeCachePkey: z.string(),
  edgeCacheResourceFkey: z.string(),
  edgeCacheRoleFkey: z.string(),
  edgeCacheResourceIdIndex: z.string(),
  edgeCacheRoleIdIndex: z.string(),
  edgeCacheView: z.string(),
  edgeCacheBackfill: z.string(),
  edgeInsertTriggerFunction: z.string(),
  edgeInsertTrigger: z.string(),
  edgeUpdateTriggerFunction: z.string(),
  edgeUpdateTrigger: z.string(),
  edgeDeleteTriggerFunction: z.string(),
  edgeDeleteTrigger: z.string(),
  combinedEdgeInsertTriggerFunction: z.string(),
  combinedEdgeInsertTrigger: z.string(),
  combinedEdgeUpdateTriggerFunction: z.string(),
  combinedEdgeUpdateTrigger: z.string(),
  combinedEdgeDeleteTriggerFunction: z.string(),
  combinedEdgeDeleteTrigger: z.string(),
  enableTriggerFunction: z.string(),
  disableTriggerFunction: z.string(),
});

// Derived naming config schema (combines resource, role, assignment)
export const derivedNamingConfigSchema = z.object({
  resource: derivedResourceOrRoleNamingConfigSchema,
  role: derivedResourceOrRoleNamingConfigSchema,
  assignment: assignmentNamingConfigSchema,
  schema: z.string(),
  orBitmap: z.string(),
});

// Table naming config entry schema
export const tableNamingConfigEntrySchema = z.object({
  schema: z.string(),
  name: z.string(),
  resourceId: z.string(),
  resourceFkey: z.string(),
  roleId: z.string(),
  roleFkey: z.string(),
  permission: z.record(z.string(), permissionPerOperationNamingSchema),
});

// Table naming config schema
export const tableNamingConfigSchema = z.object({
  tables: z.record(z.string(), tableNamingConfigEntrySchema),
});

// Full naming config schema (base + derived + tables)
export const namingConfigSchema = baseNamingConfigSchema
  .merge(derivedNamingConfigSchema)
  .merge(tableNamingConfigSchema);

// Table config schema (for CompleteConfig.tables array entries)
export const tableConfigSchema = z.object({
  schema: z.string(),
  name: z.string(),
  isResource: z.boolean(),
  resourceId: z.string(),
  resourceFkey: z.string(),
  isRole: z.boolean(),
  roleId: z.string(),
  roleFkey: z.string(),
  permission: z.record(z.string(), permissionPerOperationSchema),
});

// Engine config base schema (without refinements, for partial/optional use)
export const engineConfigBaseSchema = z.object({
  schema: z.string(),
  users: z.array(z.string()),
  permission: z.object({
    bitmap: z.object({
      size: z.number(),
    }),
    maxDepth: z.object({
      resource: z.number(),
      role: z.number(),
    }),
  }),
  authentication: z.object({
    getCurrentUserId: z.string(),
  }),
  id: z.object({
    mode: z.enum(["integer", "uuid"]),
  }),
  combineAssignmentsWith: z.enum(["none", "role", "resource"]),
  naming: namingConfigSchema.partial(),
});

// Engine config schema with superRefine for complex validation
export const engineConfigSchema = engineConfigBaseSchema.superRefine((data, ctx) => {
  // Validate bitmap size is within reasonable bounds
  if (data.permission.bitmap.size < 1 || data.permission.bitmap.size > 1024) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Bitmap size must be between 1 and 1024",
      path: ["permission", "bitmap", "size"],
    });
  }
  // Validate maxDepth values are positive
  if (data.permission.maxDepth.resource < 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Resource max depth must be at least 1",
      path: ["permission", "maxDepth", "resource"],
    });
  }
  if (data.permission.maxDepth.role < 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Role max depth must be at least 1",
      path: ["permission", "maxDepth", "role"],
    });
  }
});

// Migration config schema
export const migrationConfigSchema = z.object({
  output: z.object({
    sql: z.string(),
  }),
});

// Complete config base schema (uses refined engine schema for validation)
export const completeConfigBaseSchema = z.object({
  engine: engineConfigSchema,
  migration: migrationConfigSchema,
  tables: z.array(tableConfigSchema),
});

// Complete config schema with superRefine for cross-field validation
export const completeConfigSchema = completeConfigBaseSchema.superRefine((data, ctx) => {
  // Validate that permission keys in tables match the users array
  const validUsers = new Set(data.engine.users);
  data.tables.forEach((table, tableIndex) => {
    Object.keys(table.permission).forEach((user) => {
      if (!validUsers.has(user)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Permission user "${user}" is not in the users array`,
          path: ["tables", tableIndex, "permission", user],
        });
      }
    });
  });
});

// User-facing config schema (partial version for user input)
export const configSchema = z.object({
  engine: engineConfigBaseSchema.partial().optional(),
  migration: migrationConfigSchema.partial().optional(),
  tables: z.array(tableConfigSchema.partial()).optional(),
});

// Type exports inferred from schemas
export type PermissionPerOperation = z.infer<typeof permissionPerOperationSchema>;
export type PermissionPerOperationNaming = z.infer<typeof permissionPerOperationNamingSchema>;
export type BaseNamingConfig = z.infer<typeof baseNamingConfigSchema>;
export type DerivedResourceOrRoleNamingConfig = z.infer<typeof derivedResourceOrRoleNamingConfigSchema>;
export type AssignmentNamingConfig = z.infer<typeof assignmentNamingConfigSchema>;
export type DerivedNamingConfig = z.infer<typeof derivedNamingConfigSchema>;
export type TableNamingConfigEntry = z.infer<typeof tableNamingConfigEntrySchema>;
export type TableNamingConfig = z.infer<typeof tableNamingConfigSchema>;
export type NamingConfig = z.infer<typeof namingConfigSchema>;
export type TableConfig = z.infer<typeof tableConfigSchema>;
export type EngineConfig = z.infer<typeof engineConfigSchema>;
export type MigrationConfig = z.infer<typeof migrationConfigSchema>;
export type CompleteConfig = z.infer<typeof completeConfigSchema>;
export type Config = z.infer<typeof configSchema>;
