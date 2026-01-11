import { z } from "zod";

// Base naming config schema (mirrors defaultBaseNamingConfig structure)
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

export type BaseNamingConfig = z.infer<typeof baseNamingConfigSchema>;

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

export type DerivedResourceOrRoleNamingConfig = z.infer<typeof derivedResourceOrRoleNamingConfigSchema>;

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

export type AssignmentNamingConfig = z.infer<typeof assignmentNamingConfigSchema>;

// Derived naming config schema
export const derivedNamingConfigSchema = z.object({
  resource: derivedResourceOrRoleNamingConfigSchema,
  role: derivedResourceOrRoleNamingConfigSchema,
  assignment: assignmentNamingConfigSchema,
  schema: z.string(),
  orBitmap: z.string(),
});

export type DerivedNamingConfig = z.infer<typeof derivedNamingConfigSchema>;

// Permission per operation schema
export const permissionPerOperationSchema = z.object({
  select: z.number(),
  insert: z.number(),
  update: z.number(),
  delete: z.number(),
});

export type PermissionPerOperation = z.infer<typeof permissionPerOperationSchema>;

// Permission per operation (string version for naming)
export const permissionPerOperationNamingSchema = z.object({
  select: z.string(),
  insert: z.string(),
  update: z.string(),
  delete: z.string(),
});

export type PermissionPerOperationNaming = z.infer<typeof permissionPerOperationNamingSchema>;

// Table config schema (for CompleteConfig.tables)
// Note: User generic is handled via z.record for permission
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

export type TableConfig = z.infer<typeof tableConfigSchema>;

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

export type TableNamingConfigEntry = z.infer<typeof tableNamingConfigEntrySchema>;

// Table naming config schema
export const tableNamingConfigSchema = z.object({
  tables: z.record(z.string(), tableNamingConfigEntrySchema),
});

export type TableNamingConfig = z.infer<typeof tableNamingConfigSchema>;

// Full naming config schema (combines base, derived, and table naming)
export const namingConfigSchema = baseNamingConfigSchema
  .merge(derivedNamingConfigSchema)
  .merge(tableNamingConfigSchema);

export type NamingConfig = z.infer<typeof namingConfigSchema>;

// Engine config schema
export const engineConfigSchema = z.object({
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
  naming: namingConfigSchema.deepPartial(),
});

export type EngineConfig = z.infer<typeof engineConfigSchema>;

// Migration config schema
export const migrationConfigSchema = z.object({
  output: z.object({
    sql: z.string(),
  }),
});

export type MigrationConfig = z.infer<typeof migrationConfigSchema>;

// Complete config schema
export const completeConfigSchema = z.object({
  engine: engineConfigSchema,
  migration: migrationConfigSchema,
  tables: z.array(tableConfigSchema),
});

export type CompleteConfig = z.infer<typeof completeConfigSchema>;

// User-facing config schema (partial version for user input)
export const configSchema = z.object({
  engine: engineConfigSchema.deepPartial().optional(),
  migration: migrationConfigSchema.deepPartial().optional(),
  tables: z.array(tableConfigSchema.deepPartial()).optional(),
});

export type Config = z.infer<typeof configSchema>;
