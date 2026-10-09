import { z } from "zod";

// Permission per operation (numeric values for table config)
export const permissionPerOperationSchema = z.object({
  select: z.number(),
  insert: z.number(),
  update: z.number(),
  delete: z.number(),
  // Lets users see who has access to a row of the table, and what any role can do on it
  manageAccess: z.number().optional(),
  // Lets users share a row of the table: write the assignments of the row, with bits they have on it
  share: z.number().optional(),
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
  home: z.string(),
  sequence: z.string(),
  guard: z.string(),
  validate: z.string(),
  truncate: z.string(),
  link: z.string(),
  linked: z.string(),
  triggerPrefix: z.string(),
});

// Derived resource or role naming config schema. The node, pkey, fkey and node trigger names are only used to upgrade
// a database created when p9s had node tables.
export const derivedResourceOrRoleNamingConfigSchema = z.object({
  id: z.string(),
  idSequence: z.string(),
  pkey: z.string(),
  node: z.string(),
  edge: z.string(),
  parentId: z.string(),
  childId: z.string(),
  permission: z.string(),
  home: z.string(),
  edgePkey: z.string(),
  edgeGuardTriggerFunction: z.string(),
  edgeGuardInsertTrigger: z.string(),
  edgeGuardUpdateTrigger: z.string(),
  edgeGuardDeleteTrigger: z.string(),
  parentValidateFunction: z.string(),
  nodeInsertFunction: z.string(),
  nodeUpdateFunction: z.string(),
  nodeDeleteFunction: z.string(),
  // The edges of soft deleted rows, kept out of the graph until their rows are restored
  edgeDeleted: z.string(),
  edgeDeletedPkey: z.string(),
  nodeSoftDeleteFunction: z.string(),
  nodeRestoreFunction: z.string(),
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
  // With links of this tree: the column of the edges that links keep, and the function that recomputes them
  linked: z.string(),
  linkRefreshFunction: z.string(),
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
  // The assignments of soft deleted rows, kept out of the graph until their rows are restored
  edgeDeleted: z.string(),
  edgeDeletedPkey: z.string(),
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
  edgeValidateTriggerFunction: z.string(),
  edgeValidateInsertTrigger: z.string(),
  edgeValidateUpdateTrigger: z.string(),
  combinedEdgeInsertTriggerFunction: z.string(),
  combinedEdgeInsertTrigger: z.string(),
  combinedEdgeUpdateTriggerFunction: z.string(),
  combinedEdgeUpdateTrigger: z.string(),
  combinedEdgeDeleteTriggerFunction: z.string(),
  combinedEdgeDeleteTrigger: z.string(),
  // With resourceCache "assigned": the cache rows below a resource exist while it has assignments
  resourceCacheInsertTriggerFunction: z.string(),
  resourceCacheInsertTrigger: z.string(),
  resourceCacheUpdateTriggerFunction: z.string(),
  resourceCacheUpdateTrigger: z.string(),
  resourceCacheDeleteTriggerFunction: z.string(),
  resourceCacheDeleteTrigger: z.string(),
  enableTriggerFunction: z.string(),
  disableTriggerFunction: z.string(),
  // Prefix of the policies of the assignment table, followed by the user and the operation, or by "writer"
  edgePolicy: z.string(),
  // With assignment links: the column of the assignments that links keep, and the function that recomputes them
  linked: z.string(),
  linkRefreshFunction: z.string(),
});

// Derived naming config schema (combines resource, role, assignment)
export const derivedNamingConfigSchema = z.object({
  resource: derivedResourceOrRoleNamingConfigSchema,
  role: derivedResourceOrRoleNamingConfigSchema,
  assignment: assignmentNamingConfigSchema,
  schema: z.string(),
  orBitmap: z.string(),
  truncateGuardFunction: z.string(),
  truncateGuardTrigger: z.string(),
  // With role leaf tables: the role node whose permissions the current user has, its parent for a leaf row
  currentRoleNodeFunction: z.string(),
  // The permission bitmap of a role on a resource, for application code
  permissionFunction: z.string(),
  // With bit names: the type of a bitmap with a boolean per name, and the function that converts one
  permissionFlags: z.string(),
  // The part of the graph users can see, instead of the graph tables: every way the current user reaches a resource
  // with the bits along it, which the policies check, the resources assigned to the current user, the edges between
  // resources it reaches, and the roles it acts as
  currentAccessView: z.string(),
  currentAssignmentView: z.string(),
  currentResourceEdgeView: z.string(),
  currentRoleView: z.string(),
  // Who has access to a resource, for users with the manageAccess bit on it: the assignments that reach it, and the
  // permissions of every role
  accessView: z.string(),
  roleAccessView: z.string(),
  // Users with the share bit on a resource write its assignments through these, or the assignment table itself
  shareFunction: z.string(),
  unshareFunction: z.string(),
  // Soft deleted resources: what the current user would have on them, and the function that restores them
  currentDeletedView: z.string(),
  deletedPermissionFunction: z.string(),
  restoreFunction: z.string(),
});

// Table naming config entry schema. The fkey names are only used to upgrade from node tables.
export const tableNamingConfigEntrySchema = z.object({
  schema: z.string(),
  name: z.string(),
  resourceId: z.string(),
  resourceFkey: z.string(),
  roleId: z.string(),
  roleFkey: z.string(),
  resourceTriggerFunction: z.string(),
  resourceInsertTrigger: z.string(),
  resourceUpdateTrigger: z.string(),
  resourceDeleteTrigger: z.string(),
  roleTriggerFunction: z.string(),
  roleInsertTrigger: z.string(),
  roleUpdateTrigger: z.string(),
  roleDeleteTrigger: z.string(),
  // Security definer lookups of the parent id from the parent key, for the policies. With several parent columns,
  // the lookups of the others have the name of their column after it.
  resourceParentFunction: z.string(),
  roleParentFunction: z.string(),
  // On leaf tables whose parent column holds a key: the resource (or role) id of the parent, kept by a trigger
  resourceParentId: z.string(),
  resourceLeafTriggerFunction: z.string(),
  resourceLeafTrigger: z.string(),
  roleParentId: z.string(),
  roleLeafTriggerFunction: z.string(),
  roleLeafTrigger: z.string(),
  permission: z.record(z.string(), permissionPerOperationNamingSchema),
});

// Table naming config schema
export const tableNamingConfigSchema = z.object({
  tables: z.record(z.string(), tableNamingConfigEntrySchema),
});

// The function that brings the edges or assignments of a link table up to date with some of its rows, and the trigger
// function and triggers that call it
export const linkNamingConfigEntrySchema = z.object({
  schema: z.string(),
  name: z.string(),
  syncFunction: z.string(),
  triggerFunction: z.string(),
  insertTrigger: z.string(),
  updateTrigger: z.string(),
  deleteTrigger: z.string(),
});

export const linkNamingConfigSchema = z.object({
  links: z.record(z.string(), linkNamingConfigEntrySchema),
});

// Full naming config schema (base + derived + tables + links)
export const namingConfigSchema = baseNamingConfigSchema
  .merge(derivedNamingConfigSchema)
  .merge(tableNamingConfigSchema)
  .merge(linkNamingConfigSchema);

// The column of a bound table that holds its parent in the resource (or role) tree. p9s keeps one edge, the home edge,
// from that parent to the row. Without a table the column holds resource (or role) ids. With a table it holds values
// of that table's key column, which defaults to the table's resource (or role) id column.
export const parentConfigSchema = z.object({
  column: z.string(),
  table: z.string().optional(),
  key: z.string().optional(),
});

// Several parent columns: the parent of a row is the first one it sets, in this order. A folder in another folder, or
// else at the top of its organization, lists both columns.
export const parentsConfigSchema = z.union([parentConfigSchema, z.array(parentConfigSchema).min(1)]);

export const parentsOf = (parents: ParentsConfig | undefined): ParentConfig[] =>
  parents === undefined ? [] : Array.isArray(parents) ? parents : [parents];

// Operators that pg_trgm or full-text indexes serve, and that are not leakproof, so that RLS never runs them on the
// index. `@@` matches a tsvector column with a tsquery, the others text columns with text.
export const searchOperators = ["like", "ilike", "~", "~*", "%", "@@"] as const;

// A search through the indexes of some columns: rows match when one of their columns matches the value
export const searchConfigSchema = z.object({
  columns: z.array(z.string()).min(1),
  operator: z.enum(searchOperators),
});

// Table config schema (for CompleteConfig.tables array entries)
export const tableConfigSchema = z.object({
  schema: z.string(),
  name: z.string(),
  isResource: z.boolean(),
  resourceId: z.string(),
  resourceFkey: z.string(),
  resourceParent: parentsConfigSchema.optional(),
  // Rows of a leaf table are not nodes: they have no resource id and take the permissions of their parent. Nothing
  // can be a child of a leaf row, share it on its own, or assign roles to it.
  resourceLeaf: z.boolean().optional(),
  isRole: z.boolean(),
  roleId: z.string(),
  roleFkey: z.string(),
  roleParent: parentsConfigSchema.optional(),
  // Rows of a role leaf table are not nodes: they keep a role id, only to tell who the current user is, and have the
  // permissions of their parent. Nothing can be a child of a leaf row, share with it on its own, or assign it a resource.
  roleLeaf: z.boolean().optional(),
  permission: z.record(z.string(), permissionPerOperationSchema),
  // A row whose column of this name is not null is soft deleted. Nodes leave the graph with their edges and
  // assignments until the column is null again, leaf rows are hidden from users.
  softDelete: z.string().optional(),
  // Each search is a function named after the table and its key, like document_search for `search`, that matches
  // through the indexes as the owner, and returns the matching rows the user can read
  search: z.record(z.string(), searchConfigSchema).optional(),
});

// A column of a link table that holds a row of a bound table: a value of its key column, which defaults to the
// resource (or role) id column of that table
export const linkEndSchema = z.object({
  column: z.string(),
  table: z.string(),
  key: z.string().optional(),
});

// Bits, by their name in engine.permission.bitmap.names or by their position
export const bitsSchema = z.array(z.union([z.string(), z.number()]));

// The bits of the edge or assignment of each row of a link table: the same for every row, or by the value of one of
// its columns, as text: `{ column: "access", values: { viewer: ["read"], editor: ["read", "edit"] } }`. A row whose value
// is not listed gives nothing.
export const linkPermissionSchema = z.union([
  bitsSchema,
  z.object({ column: z.string(), values: z.record(z.string(), bitsSchema) }),
]);

// A table of the application whose rows are edges or assignments, like the members of teams or the shares of
// documents. p9s keeps an edge (or assignment) for each pair of rows it links, with the bits of its rows, and follows
// every change of the table.
export const linkConfigSchema = z.object({
  schema: z.string().optional(),
  name: z.string(),
  // "role": a child role is in a parent role, like a user in a team. "resource": a child resource is in a parent
  // resource, besides its parent column. "assignment": a role has access to a resource.
  kind: z.enum(["resource", "role", "assignment"]),
  parent: linkEndSchema.optional(),
  child: linkEndSchema.optional(),
  resource: linkEndSchema.optional(),
  role: linkEndSchema.optional(),
  // Every bit by default for edges, required for assignments
  permission: linkPermissionSchema.optional(),
  // What each user role may do with the link table, granted by the migration: ["select", "insert", "delete"]
  privileges: z.record(z.string(), z.array(z.enum(["select", "insert", "update", "delete"]))).optional(),
});

// Engine config base schema (without refinements, for partial/optional use)
export const engineConfigBaseSchema = z.object({
  schema: z.string(),
  // Database roles that query business tables through RLS. They see their own part of the permission graph, through
  // the views of the current user.
  users: z.array(z.string()),
  // Database roles allowed to modify nodes, edges and assignments. Caches are only ever written by p9s triggers.
  graphWriters: z.array(z.string()).default([]),
  permission: z.object({
    bitmap: z.object({
      size: z.number(),
      // Names of bits, by their position counted from the left: `{ read: 0, edit: 2 }`. With names, the
      // permission_flags type and function give a bitmap as a boolean per name, and so do the PostGraphile fields
      names: z.record(z.string(), z.number()).optional(),
    }),
    maxDepth: z.object({
      resource: z.number(),
      role: z.number(),
    }),
  }),
  authentication: z.object({
    // The function that returns the role id of the current user, maybe in another schema: "auth.uid"
    getCurrentUserId: z.string(),
    // A setting the server sets to the role id of the user of each transaction, like "app.user_id": the migration then
    // creates the function above, which reads it, and the identity helpers of @p9s/postgres set it
    setting: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_.]*$/, "a setting name with a prefix, like app.user_id").optional(),
    // The setting then holds a key of the app, like the id of the user in its users table, rather than the role id:
    // the current user function looks the role id up in that table
    key: z.object({ table: z.string(), column: z.string() }).optional(),
    // The setting then holds JSON claims, like request.jwt.claims that PostgREST and Supabase set from the JWT, and
    // the current user is this claim of them, like "sub" or a claim of the app's own, like "user_id"
    claim: z.string().optional(),
  }),
  // The migration grants each user role of a table the statements its permission names, and the sequences it needs
  // to insert. Grants of the app stay, the migration only adds.
  grantPrivileges: z.boolean().optional(),
  id: z.object({
    mode: z.enum(["integer", "uuid"]),
  }),
  combineAssignmentsWith: z.enum(["none", "role", "resource"]),
  // "full" caches every (ancestor, descendant) pair of resources. "assigned" only caches the pairs whose ancestor has
  // assignments, which are the ones permissions come from, and a self row per resource.
  resourceCache: z.enum(["full", "assigned"]).default("full"),
  // For PostGraphile: smart comments with the keys of the node views and of the views of p9s, the internal tables and
  // functions hidden from the GraphQL schema, and a permission field on each resource table
  postgraphile: z.boolean().optional(),
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
  // Bit names become the attributes of a composite type, next to its bitmap attribute
  const positions = new Map<number, string>();
  Object.entries(data.permission.bitmap.names ?? {}).forEach(([name, position]) => {
    const path = ["permission", "bitmap", "names", name];
    if (!/^[a-z][a-z0-9_]*$/.test(name) || name === "bitmap") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Bit name "${name}" must be a lowercase identifier other than "bitmap"`, path });
    }
    if (!Number.isInteger(position) || position < 0 || position >= data.permission.bitmap.size) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Bit "${name}" must be a position from 0 to ${data.permission.bitmap.size - 1}`, path });
    } else if (positions.has(position)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Bits "${positions.get(position)}" and "${name}" have the same position ${position}`, path });
    }
    positions.set(position, name);
  });
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
  links: z.array(linkConfigSchema).default([]),
});

// What is wrong with a link of a config, for the schema and for the migration, which refuses it
export const linkIssues = (link: LinkConfig, data: { engine: { permission: { bitmap: { size: number, names?: Record<string, number> } } }, tables: TableConfig[] }) => {
  const issues: Array<{ path: Array<string | number>, message: string }> = [];
  const ends = link.kind === "assignment"
    ? [["resource", link.resource, "resource"], ["role", link.role, "role"]] as const
    : [["parent", link.parent, link.kind], ["child", link.child, link.kind]] as const;
  for (const [key, end, kind] of ends) {
    if (!end) {
      issues.push({ path: [key], message: `A ${link.kind} link needs a ${key}` });
      continue;
    }
    const table = data.tables.find(other => other.name === end.table);
    const [flag, leafKey] = kind === "resource" ? ["isResource", "resourceLeaf"] as const : ["isRole", "roleLeaf"] as const;
    if (!table || !table[flag]) {
      issues.push({ path: [key, "table"], message: `Table "${end.table}" of ${link.name}.${end.column} is not a ${kind} table of the config` });
    } else if (table[leafKey]) {
      issues.push({ path: [key, "table"], message: `Table "${end.table}" is a ${kind} leaf table, its rows are not nodes that ${link.name} can link` });
    } else if (table.softDelete !== undefined) {
      issues.push({ path: [key, "table"], message: `Table "${end.table}" soft deletes its rows, which links do not support yet` });
    }
  }
  const unused = link.kind === "assignment" ? (["parent", "child"] as const) : (["resource", "role"] as const);
  for (const key of unused) {
    if (link[key] !== undefined) issues.push({ path: [key], message: `A ${link.kind} link has no ${key}` });
  }
  if (link.kind === "assignment" && link.permission === undefined) {
    issues.push({ path: ["permission"], message: `An assignment link needs the bits its rows give` });
  }
  const { size, names = {} } = data.engine.permission.bitmap;
  const lists = link.permission === undefined ? [] : Array.isArray(link.permission) ? [link.permission] : Object.values(link.permission.values);
  for (const bit of lists.flat()) {
    if (typeof bit === "string" ? !(bit in names) : !Number.isInteger(bit) || bit < 0 || bit >= size) {
      issues.push({ path: ["permission"], message: typeof bit === "string" ? `Bit "${bit}" is not in engine.permission.bitmap.names` : `Bit ${bit} is not a position from 0 to ${size - 1}` });
    }
  }
  return issues;
};

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
    if (table.resourceLeaf && Object.values(table.permission).some(bits => bits.manageAccess != null || bits.share != null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Leaf rows have no access of their own: manageAccess and share are checked on resources, and the rows of ${table.name} are not`,
        path: ["tables", tableIndex, "permission"],
      });
    }
    for (const [kind, parentKey, flag, leafKey] of [["resource", "resourceParent", "isResource", "resourceLeaf"], ["role", "roleParent", "isRole", "roleLeaf"]] as const) {
      const parents = parentsOf(table[parentKey]);
      if (parents.length > 0 && !table[flag]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `A ${kind} parent needs the table to be a ${kind} table (${flag})`,
          path: ["tables", tableIndex, parentKey],
        });
      }
      if (new Set(parents.map(parent => parent.column)).size < parents.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `The ${kind} parents of ${table.name} need a column each`,
          path: ["tables", tableIndex, parentKey],
        });
      }
      for (const parent of parents) {
        if (parent.table !== undefined && !data.tables.some(other => other.name === parent.table && other[flag])) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Parent table "${parent.table}" is not a ${kind} table of the config`,
            path: ["tables", tableIndex, parentKey, "table"],
          });
        }
        if (parent.table !== undefined && data.tables.some(other => other.name === parent.table && other[leafKey])) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Parent table "${parent.table}" is a ${kind} leaf table, its rows cannot have children`,
            path: ["tables", tableIndex, parentKey, "table"],
          });
        }
      }
    }
    if (table.softDelete !== undefined && !table.isResource && !table.isRole) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Soft delete needs ${table.name} to be a resource or role table`,
        path: ["tables", tableIndex, "softDelete"],
      });
    }
    if (table.search !== undefined && Object.keys(table.search).length > 0 && !(table.isResource && Object.values(table.permission).some(bits => bits.select != null))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `A search returns the rows the select policies let through: ${table.name} needs to be a resource table with a select bit`,
        path: ["tables", tableIndex, "search"],
      });
    }
    for (const [kind, parentKey, flag, leafKey] of [["resource", "resourceParent", "isResource", "resourceLeaf"], ["role", "roleParent", "isRole", "roleLeaf"]] as const) {
      if (table[leafKey] && !(table[flag] && parentsOf(table[parentKey]).length > 0)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `A ${kind} leaf table needs to be a ${kind} table (${flag}) with a parent (${parentKey})`,
          path: ["tables", tableIndex, leafKey],
        });
      }
    }
  });
  const { key, setting, claim } = data.engine.authentication;
  if (claim !== undefined && setting === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `A claim needs a setting, which holds the claims`, path: ["engine", "authentication", "claim"] });
  }
  if (key !== undefined) {
    if (setting === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `A key needs a setting, which holds the key of the current user`, path: ["engine", "authentication", "key"] });
    }
    if (!data.tables.some(table => table.name === key.table && table.isRole)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Table "${key.table}" of the key is not a role table of the config`, path: ["engine", "authentication", "key", "table"] });
    }
  }
  const linkNames = new Set<string>();
  data.links.forEach((link, linkIndex) => {
    if (linkNames.has(link.name)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Table "${link.name}" is linked twice`, path: ["links", linkIndex, "name"] });
    }
    linkNames.add(link.name);
    for (const { path, message } of linkIssues(link, data)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: ["links", linkIndex, ...path] });
    }
    for (const user of Object.keys(link.privileges ?? {})) {
      if (!validUsers.has(user)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Privilege user "${user}" is not in the users array`, path: ["links", linkIndex, "privileges", user] });
      }
    }
  });
});

// What a user writes, which getCompleteConfig merges into the defaults: the engine takes the parts it leaves out from
// defaultConfig, and a permission refuses the operations it does not name
const { permission: enginePermission, authentication, id } = engineConfigBaseSchema.shape;
const userEngineConfigSchema = engineConfigBaseSchema.extend({
  permission: z.object({ bitmap: enginePermission.shape.bitmap.partial(), maxDepth: enginePermission.shape.maxDepth.partial() }).partial(),
  authentication: authentication.partial(),
  id: id.partial(),
}).partial();
const userTableConfigSchema = tableConfigSchema.extend({
  permission: z.record(z.string(), permissionPerOperationSchema.partial()),
}).partial();

// User-facing config schema (partial version for user input)
export const configSchema = z.object({
  engine: userEngineConfigSchema.optional(),
  migration: migrationConfigSchema.partial().optional(),
  tables: z.array(userTableConfigSchema).optional(),
  links: z.array(linkConfigSchema).optional(),
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
export type LinkNamingConfigEntry = z.infer<typeof linkNamingConfigEntrySchema>;
export type LinkNamingConfig = z.infer<typeof linkNamingConfigSchema>;
export type LinkEnd = z.infer<typeof linkEndSchema>;
export type Bits = z.infer<typeof bitsSchema>;
export type LinkPermission = z.infer<typeof linkPermissionSchema>;
export type LinkConfig = z.infer<typeof linkConfigSchema>;
export type NamingConfig = z.infer<typeof namingConfigSchema>;
export type ParentConfig = z.infer<typeof parentConfigSchema>;
export type ParentsConfig = z.infer<typeof parentsConfigSchema>;
export type SearchConfig = z.infer<typeof searchConfigSchema>;
export type TableConfig = z.infer<typeof tableConfigSchema>;
export type EngineConfig = z.infer<typeof engineConfigSchema>;
export type MigrationConfig = z.infer<typeof migrationConfigSchema>;
export type CompleteConfig = z.infer<typeof completeConfigSchema>;
export type Config = z.infer<typeof configSchema>;
