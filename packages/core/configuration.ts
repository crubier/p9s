import type { SQL, } from "pg-sql2";
import type { ReplaceNestedTypes, RecursivePartial } from "./util";
import type {
  BaseNamingConfig,
  DerivedNamingConfig,
  DerivedResourceOrRoleNamingConfig,
  TableNamingConfigEntry as TableNamingConfigEntryBase,
  TableConfig as TableConfigBase,
  EngineConfig as EngineConfigBase,
  MigrationConfig,
  PermissionPerOperation,
  PermissionPerOperationNaming,
} from "./configuration-schema";

import { identifier } from "pg-sql2";
import { deepMerge, replaceNestedStrings } from "./util";

// Re-export base types from schema (non-generic)
export type {
  BaseNamingConfig,
  DerivedNamingConfig,
  DerivedResourceOrRoleNamingConfig,
  MigrationConfig,
  PermissionPerOperation,
  PermissionPerOperationNaming,
};

// Generic types that extend the zod base types with User parameter for compile-time safety
export type TableNamingConfigEntry<User extends string> = Omit<TableNamingConfigEntryBase, 'permission'> & {
  permission: { [user in User]: PermissionPerOperationNaming }
};

export type TableNamingConfig<User extends string> = {
  tables: { [key: string]: TableNamingConfigEntry<User> }
};

export type NamingConfig<User extends string> = BaseNamingConfig & DerivedNamingConfig & TableNamingConfig<User>;

export type TableConfig<User extends string> = Omit<TableConfigBase, 'permission'> & {
  permission: { [user in User]: PermissionPerOperation }
};

export type EngineConfig<User extends string> = Omit<EngineConfigBase, 'users' | 'naming'> & {
  users: Array<User>,
  naming: RecursivePartial<NamingConfig<User>>
};

export type CompleteConfig<User extends string> = {
  engine: EngineConfig<User>,
  migration: MigrationConfig,
  tables: Array<TableConfig<User>>
};

export type Config<User extends string> = {
  engine?: RecursivePartial<EngineConfig<User>>,
  migration?: RecursivePartial<MigrationConfig>,
  tables?: Array<RecursivePartial<TableConfig<User>>>,
};

export const defaultBaseNamingConfig = {
  prefix: "",
  id: "id",
  resource: { name: "resource" },
  role: { name: "role" },
  assignment: { name: "assignment" },
  node: "node",
  edge: "edge",
  parent: "parent",
  child: "child",
  pkey: "pkey",
  fkey: "fkey",
  function: "function",
  index: "index",
  cache: "cache",
  permission: "permission",
  compute: "compute",
  var: "var",
  view: "view",
  reverse: "reverse",
  backfill: "backfill",
  refresh: "refresh",
  trigger: "trigger",
  policy: "policy",
  select: "select",
  insert: "insert",
  update: "update",
  delete: "delete",
  recursive: "recursive",
  enable: "enable",
  disable: "disable"
};

export const getDerivedResourceOrRoleNamingConfig = <User extends string>(resourceOrRole: "resource" | "role", config: CompleteConfig<User>) => {
  const {
    prefix,
    id,
    node,
    edge,
    parent,
    child,
    pkey,
    fkey,
    index,
    cache,
    permission,
    compute,
    var: varz,
    function: functionz,
    view,
    backfill,
    refresh,
    trigger,
    insert,
    update,
    delete: deletez,
    enable,
    disable
  } = config.engine.naming;

  const { name } = config.engine.naming[resourceOrRole] as { name: string };

  return deepMerge({
    node: `${prefix}${name}_${node}`,
    id: `${id}`,
    pkey: `${prefix}${name}_${pkey}`,
    edge: `${prefix}${name}_${edge}`,
    parentId: `${parent}_${id}`,
    childId: `${child}_${id}`,
    permission: `${permission}`,
    edgePkey: `${prefix}${name}_${edge}_${pkey}`,
    parentFkey: `${prefix}${name}_${edge}_${parent}_${fkey}`,
    childFkey: `${prefix}${name}_${edge}_${child}_${fkey}`,
    edgeParentIdIndex: `${prefix}${name}_${edge}_${parent}_${id}_${index}`,
    edgeChildIdIndex: `${prefix}${name}_${edge}_${child}_${id}_${index}`,
    edgeCache: `${prefix}${name}_${edge}_${cache}`,
    edgeCachePkey: `${prefix}${name}_${edge}_${cache}_${pkey}`,
    edgeCacheParentFkey: `${prefix}${name}_${edge}_${cache}_${parent}_${pkey}`,
    edgeCacheChildFkey: `${prefix}${name}_${edge}_${cache}_${child}_${pkey}`,
    edgeCacheParentIdIndex: `${prefix}${name}_${edge}_${cache}_${parent}_${id}_${index}`,
    edgeCacheChildIdIndex: `${prefix}${name}_${edge}_${cache}_${child}_${id}_${index}`,
    edgeCacheParentCompute: `${prefix}${name}_${edge}_${cache}_${parent}_${compute}`,
    edgeCacheChildCompute: `${prefix}${name}_${edge}_${cache}_${child}_${compute}`,
    varParentId: `${varz}_${parent}_${id}`,
    varChildId: `${varz}_${child}_${id}`,
    edgeCacheView: `${prefix}${name}_${edge}_${cache}_${view}`,
    edgeCacheBackfill: `${prefix}${name}_${edge}_${cache}_${backfill}`,
    edgeInsertTriggerFunction: `${prefix}${name}_${edge}_${insert}_${trigger}_${functionz}`,
    edgeInsertTrigger: `10_${prefix}${name}_${edge}_${insert}_${trigger}`,
    edgeUpdateTriggerFunction: `${prefix}${name}_${edge}_${update}_${trigger}_${functionz}`,
    edgeUpdateTrigger: `10_${prefix}${name}_${edge}_${update}_${trigger}`,
    edgeDeleteTriggerFunction: `${prefix}${name}_${edge}_${deletez}_${trigger}_${functionz}`,
    edgeDeleteTrigger: `10_${prefix}${name}_${edge}_${deletez}_${trigger}`,
    nodeInsertTriggerFunction: `${prefix}${name}_${node}_${insert}_${trigger}_${functionz}`,
    nodeInsertTrigger: `10_${prefix}${name}_${node}_${insert}_${trigger}`,
    nodeUpdateTriggerFunction: `${prefix}${name}_${node}_${update}_${trigger}_${functionz}`,
    nodeUpdateTrigger: `10_${prefix}${name}_${node}_${update}_${trigger}`,
    nodeDeleteTriggerFunction: `${prefix}${name}_${node}_${deletez}_${trigger}_${functionz}`,
    nodeDeleteTrigger: `10_${prefix}${name}_${node}_${deletez}_${trigger}`,
    enableTriggerFunction: `${prefix}${name}_${trigger}_${enable}`,
    disableTriggerFunction: `${prefix}${name}_${trigger}_${disable}`,
  }, config.engine.naming[resourceOrRole]);
}

export const getDerivedNamingConfig = (config: CompleteConfig<any>): DerivedNamingConfig => {
  const {
    prefix,
    edge,
    assignment,
    permission,
    index,
    pkey,
    fkey,
    insert, update, delete: deletez, trigger, function: functionz, cache,
    view, backfill, enable, disable, parent, child, id, compute
  } = deepMerge(defaultBaseNamingConfig, config.engine.naming);

  const size = config.engine.permission.bitmap.size;
  const thingCombinedWith = config.engine.combineAssignmentsWith;

  const resource = getDerivedResourceOrRoleNamingConfig("resource", config);
  const role = getDerivedResourceOrRoleNamingConfig("role", config);

  return {
    resource,
    role,
    assignment: {
      edge: `${prefix}${assignment.name}_${edge}`,
      resourceId: `${resource.name}_${resource.id}`,
      roleId: `${role.name}_${role.id}`,
      edgePkey: `${prefix}${assignment.name}_${edge}_${pkey}`,
      resourceFkey: `${prefix}${assignment.name}_${edge}_${resource.name}_${fkey}`,
      roleFkey: `${prefix}${assignment.name}_${edge}_${role.name}_${fkey}`,
      edgeResourceIdIndex: `${prefix}${assignment.name}_${edge}_${resource.name}_${resource.id}_${index}`,
      edgeRoleIdIndex: `${prefix}${assignment.name}_${edge}_${role.name}_${role.id}_${index}`,
      permission: `${permission}`,
      edgeCache: `${prefix}${assignment.name}_${edge}_${cache}`,
      edgeCachePkey: `${prefix}${assignment.name}_${edge}_${cache}_${pkey}`,
      edgeCacheResourceFkey: `${prefix}${assignment.name}_${edge}_${cache}_${resource.name}_${fkey}`,
      edgeCacheRoleFkey: `${prefix}${assignment.name}_${edge}_${cache}_${role.name}_${fkey}`,
      edgeCacheResourceIdIndex: `${prefix}${assignment.name}_${edge}_${cache}_${resource.name}_${id}_${index}`,
      edgeCacheRoleIdIndex: `${prefix}${assignment.name}_${edge}_${cache}_${role.name}_${id}_${index}`,
      edgeCacheView: `${prefix}${assignment.name}_${edge}_${cache}_${view}`,
      edgeCacheBackfill: `${prefix}${assignment.name}_${edge}_${cache}_${backfill}`,
      edgeInsertTriggerFunction: `${prefix}${assignment.name}_${edge}_${insert}_${trigger}_${functionz}`,
      edgeInsertTrigger: `10_${prefix}${assignment.name}_${edge}_${insert}_${trigger}`,
      edgeUpdateTriggerFunction: `${prefix}${assignment.name}_${edge}_${update}_${trigger}_${functionz}`,
      edgeUpdateTrigger: `10_${prefix}${assignment.name}_${edge}_${update}_${trigger}`,
      edgeDeleteTriggerFunction: `${prefix}${assignment.name}_${edge}_${deletez}_${trigger}_${functionz}`,
      edgeDeleteTrigger: `10_${prefix}${assignment.name}_${edge}_${deletez}_${trigger}`,
      combinedEdgeInsertTriggerFunction: `${prefix}${assignment.name}_${edge}_${thingCombinedWith}_${insert}_${trigger}_${functionz}`,
      combinedEdgeInsertTrigger: `20_${prefix}${assignment.name}_${edge}_${thingCombinedWith}_${insert}_${trigger}`,
      combinedEdgeUpdateTriggerFunction: `${prefix}${assignment.name}_${edge}_${thingCombinedWith}_${update}_${trigger}_${functionz}`,
      combinedEdgeUpdateTrigger: `20_${prefix}${assignment.name}_${edge}_${thingCombinedWith}_${update}_${trigger}`,
      combinedEdgeDeleteTriggerFunction: `${prefix}${assignment.name}_${edge}_${thingCombinedWith}_${deletez}_${trigger}_${functionz}`,
      combinedEdgeDeleteTrigger: `20_${prefix}${assignment.name}_${edge}_${thingCombinedWith}_${deletez}_${trigger}`,
      enableTriggerFunction: `${prefix}${assignment.name}_${trigger}_${enable}`,
      disableTriggerFunction: `${prefix}${assignment.name}_${trigger}_${disable}`
    },
    schema: `${config.engine.schema}`,
    orBitmap: `${prefix}or_bitmap_${size}`,
  }
}

export const getTableNamingConfig = <User extends string>(config: CompleteConfig<User>, generalNamingConfig: Omit<NamingConfig<User>, "tables">): TableNamingConfig<User> => {

  const {
    fkey,
    prefix,
    resource: {
      name: resourceName,
      id: resourceId
    },
    role: {
      name: roleName,
      id: roleId
    },
    schema,
    policy,
    select,
    insert,
    update,
    delete: deletez,
  } = generalNamingConfig;

  return {
    tables: Object.fromEntries(config.tables.map(({ name, schema: tableSchema, isResource, isRole, permission, ...customNames }) => {

      const result = {
        schema: `${tableSchema ?? schema}`,
        name: `${name}`,
        resourceId: `${prefix}${resourceName}_${resourceId}`,
        resourceFkey: `${prefix}${resourceName}_${name}_${fkey}`,
        roleId: `${prefix}${roleName}_${roleId}`,
        roleFkey: `${prefix}${roleName}_${name}_${fkey}`,
        permission: Object.fromEntries(Object.entries(permission ?? {}).map(([user, value]) => {
          return [user, {
            select: `${prefix}${name}_${user}_${select}_${policy}`,
            insert: `${prefix}${name}_${user}_${insert}_${policy}`,
            update: `${prefix}${name}_${user}_${update}_${policy}`,
            delete: `${prefix}${name}_${user}_${deletez}_${policy}`
          }];
        }))
      };

      return ([name, deepMerge(result, customNames)])
    }))
  } as TableNamingConfig<User>;
}

export const getCompleteNamingConfig = <User extends string>(config: CompleteConfig<User>): NamingConfig<User> => {

  const generalNamingConfig = deepMerge(
    deepMerge(
      // 1. Default base names
      defaultBaseNamingConfig,
      // 2. Names derived from configured base names, does not overlap with 1
      getDerivedNamingConfig(deepMerge({ engine: { naming: deepMerge(defaultBaseNamingConfig, config.engine.naming) } }, config))
    ),
    // 3. Configured names (base and derived), can overlap with 1 and 2
    config.engine.naming
  );

  const tableNamingConfig = getTableNamingConfig(config, generalNamingConfig);

  return deepMerge(
    generalNamingConfig,
    // 4 Add table names from the table list in config
    tableNamingConfig
  );
}

export type Naming<User extends string> = ReplaceNestedTypes<string, SQL, NamingConfig<User>>;

export const getNaming = <User extends string>(config: CompleteConfig<User>): Naming<User> => {
  return replaceNestedStrings(getCompleteNamingConfig(config), identifier)
}


export const defaultConfig: CompleteConfig<any> = {
  engine: {
    schema: "public",
    users: [],
    permission: {
      bitmap: {
        size: 128
      },
      maxDepth: {
        resource: 16,
        role: 16,
      }
    },
    authentication: {
      getCurrentUserId: "get_current_user_id"
    },
    id: {
      mode: "integer"
    },
    combineAssignmentsWith: "none",
    naming: defaultBaseNamingConfig,
  },
  migration: {
    output: {
      sql: "p9s-migration.sql"
    }
  },
  tables: []
};

export const getCompleteConfig = <User extends string>(config: Config<User>): CompleteConfig<User> => {
  return deepMerge(defaultConfig, config);
}

