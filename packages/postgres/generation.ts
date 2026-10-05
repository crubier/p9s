
// To get syntax highlighting in VSCode with the qufiwefefwoyn.inline-sql-syntax extension
import { type SQL, query as sql, join, literal, identifier, compile, raw } from "pg-sql2";
import { getCompleteConfig, getNaming } from "@p9s/core";
import type { CompleteConfig, Naming, Config } from "@p9s/core";

type Kind = "resource" | "role";

export const createMigration = <User extends string>(config: Config<User>) => {
  const completeConfig = getCompleteConfig(config);
  const naming = getNaming(completeConfig);

  const result = sql`
  ${createMigrationPreamble(naming, completeConfig)}

  ${createMigrationExtensions(naming, completeConfig)}

  ${createMigrationAggregates(naming, completeConfig)}

  ${createMigrationGraphTables("resource", naming, completeConfig)}

  ${createMigrationGraphTables("role", naming, completeConfig)}

  ${createMigrationAssignmentTable(naming, completeConfig)}

  ${createMigrationDataModelBindings(naming, completeConfig)}

  ${createMigrationViews("resource", naming, completeConfig)}

  ${createMigrationViews("role", naming, completeConfig)}

  ${createMigrationLegacyUpgrade("resource", naming, completeConfig)}

  ${createMigrationLegacyUpgrade("role", naming, completeConfig)}

  ${createMigrationResourceOrRole("resource", naming, completeConfig)}

  ${createMigrationResourceOrRole("role", naming, completeConfig)}

  ${createMigrationAssignments(naming, completeConfig)}

  ${createMigrationDataModelPolicies(naming, completeConfig)}

  ${createMigrationCleanup(naming, completeConfig)}

  ${createMigrationLeaves(naming, completeConfig)}

  ${createMigrationBootstrap(naming, completeConfig)}
  `
  return result;
}


const getIdType = (config: CompleteConfig<any>) => {
  return {
    "uuid": {
      type: sql`uuid`,
      extension: sql`create extension if not exists "uuid-ossp";`,
    },
    "integer": {
      type: sql`integer`,
      extension: sql``,
    },
  }[config.engine.id.mode];
}

const getRoles = (config: CompleteConfig<any>) => {
  const users: string[] = config.engine.users;
  const writers: string[] = config.engine.graphWriters;
  return { users, writers, everyone: [...new Set([...users, ...writers])] };
}

// pg-sql2's literal() turns most strings into bind parameters, which a multi-statement migration script cannot use
const textLiteral = (value: string) => raw(`'${value.replace(/'/g, "''")}'`);

// The name behind an identifier, as stored in the catalogs
const nameOf = (name: SQL) => compile(name).text.slice(1, -1).replace(/""/g, '"');

const roleArray = (roles: string[]) => sql`array[${join(roles.map(textLiteral), ", ")}]::text[]`;

// Tables are passed as a regclass literal so the helper can look up their owner and serial sequences
const setPrivileges = (target: SQL, readRoles: string[], writeRoles: string[]) =>
  sql`select pg_temp.p9s_set_privileges(${textLiteral(compile(target).text)}::regclass, ${roleArray(readRoles)}, ${roleArray(writeRoles)});`;

const grantExecute = (fn: SQL, roles: string[]) => sql`
revoke execute on function ${fn} from public;
${join(roles.map(role => sql`grant execute on function ${fn} to ${identifier(role)};`), `\n`)}`;

const definer = (naming: Naming<any>) => sql`security definer set search_path = ${naming.schema}, pg_temp`;

const ones = (config: CompleteConfig<any>) => sql`~ b'0'::bit(${literal(config.engine.permission.bitmap.size)})`;

// Ids of new rows: one sequence per tree in integer mode, so that ids are unique across all the bound tables
const idDefault = (kind: Kind, naming: Naming<any>, config: CompleteConfig<any>) => config.engine.id.mode === "uuid"
  ? sql`uuid_generate_v4()`
  : sql`nextval(${textLiteral(compile(naming[kind].idSequence).text)}::regclass)`;

// Graph writes are serialized so that, under READ COMMITTED, each trigger statement sees edges committed by
// concurrent writers. Under REPEATABLE READ / SERIALIZABLE the trigger snapshot would predate those commits.
const lockKey = (config: CompleteConfig<any>) => textLiteral(`p9s:${config.engine.schema}:${config.engine.naming.prefix ?? ""}`);

const lockGraph = (config: CompleteConfig<any>) => sql`
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'p9s: permission graph writes must run in READ COMMITTED isolation, not %', current_setting('transaction_isolation');
  end if;
  perform pg_advisory_xact_lock(hashtext(${lockKey(config)}));`;

const lockGraphStatement = (config: CompleteConfig<any>) =>
  sql`perform pg_advisory_xact_lock(hashtext(${lockKey(config)}));`;

// Kept as a hashed subplan. A plain `in` in a where clause becomes a semi-join, and with hash joins disabled that
// rescans the whole subquery for every outer row.
const isIn = (value: SQL, subquery: SQL) => sql`(${value} in (${subquery})) is true`;

// The planner has no estimate for recursive queries and assumes many affected nodes, so it hashes the whole edge
// and cache tables when a few index lookups would do. Index lookups stay proportional to the rows actually touched.
const indexLookupsOnly = sql`
set enable_hashjoin = off
set enable_mergejoin = off`;

type TriggerEvent = "insert" | "update" | "delete";

// Statement triggers see the changed rows as "p9s_old_rows" and "p9s_new_rows". A trigger with transition tables
// can only have one event.
const attachStatementTrigger = (functionName: SQL, triggerName: SQL, table: SQL, event: TriggerEvent) => sql`
drop trigger if exists ${triggerName} on ${table};
create trigger ${triggerName}
after ${{ insert: sql`insert`, update: sql`update`, delete: sql`delete` }[event]} on ${table}
referencing ${{ insert: sql`new table as "p9s_new_rows"`, update: sql`old table as "p9s_old_rows" new table as "p9s_new_rows"`, delete: sql`old table as "p9s_old_rows"` }[event]}
for each statement execute function ${functionName}();
`;

const triggerFunction = (naming: Naming<any>, functionName: SQL, body: SQL, settings = sql``) => sql`
create or replace function ${functionName}()
returns trigger as $$
begin
${body}
  return null;
end;
$$ language plpgsql ${definer(naming)}${settings};

${grantExecute(sql`${functionName} ()`, [])}
`;

// Statement triggers also fire when no row changed, for example on a cascade with nothing to cascade to, which must
// not take the lock or check isolation. `skip` lets a trigger return early on changes that cannot affect the graph.
const statementTrigger = (naming: Naming<any>, config: CompleteConfig<any>, functionName: SQL, triggerName: SQL, table: SQL, event: TriggerEvent, body: SQL, settings = sql``, skip?: SQL) => sql`
${triggerFunction(naming, functionName, sql`
  if not exists (select from ${event === "delete" ? sql`"p9s_old_rows"` : sql`"p9s_new_rows"`}) then
    return null;
  end if;
  ${skip ? sql`if ${skip} then
    return null;
  end if;` : sql``}
  ${lockGraph(config)}
${body}`, settings)}
${attachStatementTrigger(functionName, triggerName, table, event)}`;


// A bound table: each of its rows is a node of the resource (or role) tree, identified by its id column
interface Binding {
  table: SQL;
  tableName: string;
  id: SQL;
  triggerFunction: SQL;
  triggers: Record<TriggerEvent, SQL>;
  parent?: {
    column: SQL;
    // Present when the parent column holds a key of the parent table rather than its id
    lookup?: { table: SQL, key: SQL, id: SQL, tableName: string };
    function: SQL;
  };
  // On leaf tables: the column holding the resource (or role) id of the parent when the parent column holds a key, and
  // the trigger that keeps it
  leaf: { parentId: SQL, triggerFunction: SQL, trigger: SQL };
}

const isOfKind = (kind: Kind, table: CompleteConfig<any>["tables"][number]) => kind === "resource" ? table.isResource : table.isRole;
const isLeafOfKind = (kind: Kind, table: CompleteConfig<any>["tables"][number]) => kind === "resource" ? table.resourceLeaf : table.roleLeaf;

const getBindings = (kind: Kind, naming: Naming<any>, config: CompleteConfig<any>): Binding[] =>
  config.tables.filter(table => isOfKind(kind, table) && !isLeafOfKind(kind, table)).map(table => toBinding(kind, naming, config, table));

// Leaf tables are described like bound tables, but their rows are not nodes: only their parent is used
const getLeaves = (kind: Kind, naming: Naming<any>, config: CompleteConfig<any>): Binding[] =>
  config.tables.filter(table => isOfKind(kind, table) && isLeafOfKind(kind, table)).map(table => toBinding(kind, naming, config, table));

// Tables whose rows have an id of the tree. Rows of role leaf tables keep one, that tells who the current user is, so
// it is unique across the role nodes as well.
const getIdBindings = (kind: Kind, naming: Naming<any>, config: CompleteConfig<any>): Binding[] =>
  [...getBindings(kind, naming, config), ...(kind === "role" ? getLeaves(kind, naming, config) : [])];

const toBinding = (kind: Kind, naming: Naming<any>, config: CompleteConfig<any>, table: CompleteConfig<any>["tables"][number]): Binding => {
  const tableNaming = naming.tables[table.name];
  if (!tableNaming) {
    throw new Error(`Table naming config not found for table: ${table.name}`);
  }
  const id = kind === "resource" ? tableNaming.resourceId : tableNaming.roleId;
  const parentConfig = kind === "resource" ? table.resourceParent : table.roleParent;
  const binding: Binding = {
    table: sql`${tableNaming.schema}.${tableNaming.name}`,
    tableName: table.name,
    id,
    triggerFunction: kind === "resource" ? tableNaming.resourceTriggerFunction : tableNaming.roleTriggerFunction,
    triggers: kind === "resource"
      ? { insert: tableNaming.resourceInsertTrigger, update: tableNaming.resourceUpdateTrigger, delete: tableNaming.resourceDeleteTrigger }
      : { insert: tableNaming.roleInsertTrigger, update: tableNaming.roleUpdateTrigger, delete: tableNaming.roleDeleteTrigger },
    leaf: kind === "resource"
      ? { parentId: tableNaming.resourceParentId, triggerFunction: tableNaming.resourceLeafTriggerFunction, trigger: tableNaming.resourceLeafTrigger }
      : { parentId: tableNaming.roleParentId, triggerFunction: tableNaming.roleLeafTriggerFunction, trigger: tableNaming.roleLeafTrigger },
  };
  if (parentConfig) {
    const parentTable = parentConfig.table === undefined ? undefined : config.tables.find(other => other.name === parentConfig.table);
    if (parentConfig.table !== undefined && !parentTable) {
      throw new Error(`Parent table ${parentConfig.table} of table ${table.name} is not in the config`);
    }
    const parentNaming = parentTable && naming.tables[parentTable.name]!;
    const parentId = parentNaming && (kind === "resource" ? parentNaming.resourceId : parentNaming.roleId);
    const key = parentConfig.key !== undefined ? identifier(parentConfig.key) : parentId;
    binding.parent = {
      column: identifier(parentConfig.column),
      lookup: parentNaming && parentId && key && compile(key).text !== compile(parentId).text
        ? { table: sql`${parentNaming.schema}.${parentNaming.name}`, key, id: parentId, tableName: parentTable!.name }
        : undefined,
      function: kind === "resource" ? tableNaming.resourceParentFunction : tableNaming.roleParentFunction,
    };
  }
  return binding;
};

// The parent id of a row, as the table owner (in triggers) or through the security definer lookup (in policies)
const parentOf = (binding: Binding, row: SQL) => {
  const { column, lookup } = binding.parent!;
  return lookup
    ? sql`(select "the_parent".${lookup.id} from ${lookup.table} as "the_parent" where "the_parent".${lookup.key} = ${row}.${column})`
    : sql`${row}.${column}`;
};
const parentOfInPolicy = (binding: Binding, row: SQL) => {
  const { column, lookup, function: lookupFunction } = binding.parent!;
  return lookup ? sql`${lookupFunction}(${row}.${column})` : sql`${row}.${column}`;
};
// A leaf row keeps the id of its parent, so that policies read a column rather than call the lookup for every row
const parentOfLeaf = (binding: Binding, row: SQL) => {
  const { column, lookup } = binding.parent!;
  return lookup ? sql`${row}.${binding.leaf.parentId}` : sql`${row}.${column}`;
};

// A parent key that matches no row of the parent table would silently give no home edge
const checkParentsFound = (binding: Binding, rows: SQL) => binding.parent?.lookup ? sql`
  if exists (select from ${rows} as "the_row" where "the_row".${binding.parent.column} is not null and ${parentOf(binding, sql`"the_row"`)} is null) then
    raise exception 'p9s: % rows have a % that matches no row of %', ${textLiteral(binding.tableName)}, ${textLiteral(nameOf(binding.parent.column))}, ${textLiteral(binding.parent.lookup.tableName)}
      using errcode = 'foreign_key_violation';
  end if;` : sql``;

const idsOf = (bindings: Binding[], config: CompleteConfig<any>) => bindings.length === 0
  ? sql`select null::${getIdType(config).type} where false`
  : join(bindings.map(({ table, id }) => sql`select ${id} from ${table}`), ` union all `);

// The ids of every bound row: the nodes of the tree
const boundIds = (kind: Kind, naming: Naming<any>, config: CompleteConfig<any>) => idsOf(getBindings(kind, naming, config), config);

// The ids of the nodes and of the role leaf rows, which must not collide either
const allIds = (kind: Kind, naming: Naming<any>, config: CompleteConfig<any>) => idsOf(getIdBindings(kind, naming, config), config);


// Integer ids of a tree come from one sequence shared by its tables, so that they are unique across tables. A bound
// column with ids of its own, like a serial primary key, would collide with the other tables, so the migration stops
// before changing anything.
const ownIdDefaultsCheck = <User extends string>(naming: Naming<User>, config: CompleteConfig<User>) => {
  const columns = (["resource", "role"] as const).flatMap(kind => getIdBindings(kind, naming, config).map(binding => sql`
    (${textLiteral(compile(binding.table).text)}, ${textLiteral(nameOf(binding.id))}, ${textLiteral(compile(naming[kind].idSequence).text)}, ${textLiteral(kind)})`));
  if (columns.length === 0) {
    return sql``;
  }
  return sql`
do $$
declare
  "the_columns" text := (
    select string_agg(format('%s.%I', "the_binding"."table_name", "the_binding"."column_name"), ', ' order by "the_binding"."table_name")
    from (values ${join(columns, `,`)}) as "the_binding" ("table_name", "column_name", "sequence_name", "kind")
    join pg_attribute as "the_column"
      on "the_column"."attrelid" = to_regclass("the_binding"."table_name")
      and "the_column"."attname" = "the_binding"."column_name"
      and not "the_column"."attisdropped"
    where "the_column"."attidentity" <> ''
    or "the_column"."attgenerated" <> ''
    or ("the_column"."atthasdef" and not exists (
      select from pg_attrdef as "the_default"
      join pg_depend as "the_dependency"
        on "the_dependency"."classid" = 'pg_attrdef'::regclass
        and "the_dependency"."objid" = "the_default"."oid"
        and "the_dependency"."refobjid" = to_regclass("the_binding"."sequence_name")
      where "the_default"."adrelid" = "the_column"."attrelid" and "the_default"."adnum" = "the_column"."attnum"
    ))
  );
begin
  if "the_columns" is not null then
    raise exception 'p9s: % already generate their own ids. In integer mode, p9s gives every row of a tree an id from one shared sequence, and ids from another sequence would collide with the other tables. Bind a separate column for p9s instead, for example resourceId: "resource_id" or roleId: "role_id".', "the_columns"
      using errcode = 'invalid_table_definition';
  end if;
end
$$;
`;
}

export const createMigrationPreamble = <User extends string>(naming: Naming<User>, config: CompleteConfig<User>) => {
  return sql`
-----------------------------------------------------------------------------------------------------------------------
-- Preamble
-----------------------------------------------------------------------------------------------------------------------
-- p9s objects are created unqualified, and security definer functions pin search_path to the configured schema
do $$
begin
  if current_schema() is distinct from ${textLiteral(config.engine.schema)} then
    raise exception 'p9s: run this migration with % as the current schema, got %', ${textLiteral(config.engine.schema)}, current_schema();
  end if;
end
$$;
${config.engine.id.mode === "integer" ? ownIdDefaultsCheck(naming, config) : sql``}

-- Session-local helper. It never touches the owner's privileges, revoking those would lock the migration role out.
create or replace function pg_temp.p9s_set_privileges(target regclass, read_roles text[], write_roles text[])
returns void as $$
declare
  owner_role name := (select pg_get_userbyid(relowner) from pg_class where oid = target);
  the_role text;
  the_sequence text;
begin
  foreach the_role in array read_roles || write_roles loop
    continue when the_role = owner_role;
    execute format('revoke all on table %s from %I', target, the_role);
  end loop;
  foreach the_role in array read_roles loop
    continue when the_role = owner_role;
    execute format('grant select on table %s to %I', target, the_role);
  end loop;
  foreach the_role in array write_roles loop
    continue when the_role = owner_role;
    execute format('grant select, insert, update, delete on table %s to %I', target, the_role);
    for the_sequence in
      select pg_get_serial_sequence(target::text, attname) from pg_attribute
      where attrelid = target and attnum > 0 and not attisdropped and pg_get_serial_sequence(target::text, attname) is not null
    loop
      execute format('grant usage, select on sequence %s to %I', the_sequence, the_role);
    end loop;
  end loop;
end;
$$ language plpgsql;
`;
}


export const createMigrationExtensions = <User extends string>(naming: Naming<User>, config: CompleteConfig<User>) => {
  return getIdType(config).extension;
}


export const createMigrationAggregates = <User extends string>(naming: Naming<User>, config: CompleteConfig<User>) => {
  const { orBitmap, truncateGuardFunction } = naming;
  const { everyone } = getRoles(config);

  const size = config.engine.permission.bitmap.size;

  return sql`
-----------------------------------------------------------------------------------------------------------------------
-- Special functions
-----------------------------------------------------------------------------------------------------------------------
create or replace aggregate ${orBitmap} (bit) (
  sfunc = bitor,
  stype = bit,
  initcond = ${literal(`0`.repeat(size))}
);

${join(everyone.map(user => sql`grant execute on function ${orBitmap} (bit) to ${identifier(user)};`), `\n`)}

-- Truncate skips row and statement triggers, it would leave the graph pointing at rows that no longer exist
create or replace function ${truncateGuardFunction}()
returns trigger as $$
begin
  raise exception 'p9s: % cannot be truncated while p9s triggers are enabled, delete its rows instead, or disable the triggers and enable them again afterwards', tg_table_name;
end;
$$ language plpgsql;

${grantExecute(sql`${truncateGuardFunction} ()`, [])}
`;
}


// Edge and cache tables, and the functions computing the cache from the edges
export const createMigrationGraphTables = <User extends string>(kind: Kind, naming: Naming<User>, config: CompleteConfig<User>) => {
  const { idSequence, edge, parentId, childId, permission, home, edgePkey, edgeParentIdIndex, edgeChildIdIndex,
    edgeCache, edgeCachePkey, edgeCacheParentIdIndex, edgeCacheChildIdIndex, edgeCacheParentCompute, edgeCacheChildCompute,
    varParentId, varChildId } = naming[kind];
  const size = config.engine.permission.bitmap.size;
  const maxDepth = config.engine.permission.maxDepth[kind];
  const { type: idType } = getIdType(config);
  const { orBitmap } = naming;
  const { users, writers, everyone } = getRoles(config);

  return sql`
-----------------------------------------------------------------------------------------------------------------------
-- ${literal(kind)} ids
-----------------------------------------------------------------------------------------------------------------------
${config.engine.id.mode === "integer" ? sql`
create sequence if not exists ${idSequence} as integer;
${join(everyone.map(user => sql`grant usage, select on sequence ${idSequence} to ${identifier(user)};`), `\n`)}
` : sql``}

-----------------------------------------------------------------------------------------------------------------------
-- ${literal(kind)} edge table
-----------------------------------------------------------------------------------------------------------------------
-- Endpoints are ids of bound rows, checked by the triggers below. Home edges are the ones p9s keeps in sync with the
-- parent column of their child row.
create table if not exists ${edge} (
  ${parentId} ${idType} not null,
  ${childId} ${idType} not null,
  ${permission} bit(${literal(size)}),
  ${home} boolean not null default false,
  constraint ${edgePkey} primary key (${parentId}, ${childId})
);

alter table ${edge} add column if not exists ${home} boolean not null default false;

-- The triggers look up the children of nodes that mostly have none. Postgres estimates such a lookup as the edges per
-- distinct parent, so when a few nodes hold most of the rows, it would scan the whole table for a node without
-- children. Count every node instead: a node has about one child on average.
alter table ${edge} alter column ${parentId} set (n_distinct = -1);

create index if not exists ${edgeParentIdIndex} on ${edge} (${parentId});

create index if not exists ${edgeChildIdIndex} on ${edge} (${childId});

${setPrivileges(edge, users, writers)}

-----------------------------------------------------------------------------------------------------------------------
-- ${literal(kind)} transitive edge cache table
-----------------------------------------------------------------------------------------------------------------------
-- Every bound row has a self row (id, id, all bits), which also makes the cache the registry of ids in use
create table if not exists ${edgeCache} (
  ${parentId} ${idType} not null,
  ${childId} ${idType} not null,
  ${permission} bit(${literal(size)}),
  constraint ${edgeCachePkey} primary key (${parentId}, ${childId})
);

create index if not exists ${edgeCacheParentIdIndex} on ${edgeCache} (${parentId});

create index if not exists ${edgeCacheChildIdIndex} on ${edgeCache} (${childId});
${kind === "resource" ? sql`
-- Policies either check the ancestors of each row, or list once every resource the user can see, from the ones
-- assigned to them. Postgres estimates the descendants of an assigned resource as the cache rows per distinct parent,
-- a few rows, while assignments are mostly high in the tree, over large subtrees. It would then list every visible
-- resource to check a single row. Estimate the descendants of a resource as those of the largest subtree instead.
alter table ${edgeCache} alter column ${parentId} set (n_distinct = 1);
` : sql``}
-- Only p9s triggers write to the cache
${setPrivileges(edgeCache, everyone, [])}

-----------------------------------------------------------------------------------------------------------------------
-- ${literal(kind)} compute recursive permissions, towards parent
-----------------------------------------------------------------------------------------------------------------------
create or replace function ${edgeCacheParentCompute} (${varChildId} ${idType})
  returns setof ${edgeCache}
  as $$
  with recursive "search_graph" (${parentId}, ${childId}, ${permission}, "depth", "path") 
  as (
    (values (${varChildId}, ${varChildId}, ~  b'0'::bit(${literal(size)}), 0, array[]::${idType}[])) -- seed
    union all
    select -- recursive query
      "the_edge".${parentId} as ${parentId},
      "the_search_graph".${childId} as ${childId},
      ("the_search_graph".${permission}::bit(${literal(size)}) & "the_edge".${permission}::bit(${literal(size)}))::bit(${literal(size)}) as ${permission}, -- bitwise "and" on permission along a path
      "the_search_graph"."depth" + 1 as "depth", -- increment depth
      "the_search_graph"."path" || "the_edge".${childId} as "path" -- append node id to path
    from ${edge} as "the_edge"
    join "search_graph" as "the_search_graph" 
    on "the_edge".${childId} = "the_search_graph".${parentId}
    where ("the_edge".${childId} <> all ("the_search_graph"."path")) -- prevent from cycling
    and "the_search_graph"."depth" <= ${literal(maxDepth)} -- max search depth
  )
    select
      "the_search_graph".${parentId},
      "the_search_graph".${childId},
      ${orBitmap} ("the_search_graph".${permission}) -- bitwise "or" on permissions between various paths
    from "search_graph" as "the_search_graph"
    group by ("the_search_graph".${parentId}, "the_search_graph".${childId});

-- query a recursive table. you can add limit output or use a cursor
$$
language sql
stable;

${join(everyone.map(user => sql`grant execute on function ${edgeCacheParentCompute} (${varChildId} ${idType}) to ${identifier(user)};`), `\n`)}

-----------------------------------------------------------------------------------------------------------------------
-- ${literal(kind)} compute recursive permissions, towards child
-----------------------------------------------------------------------------------------------------------------------
create or replace function ${edgeCacheChildCompute} (${varParentId} ${idType})
  returns setof ${edgeCache}
  as $$
  with recursive "search_graph" (${parentId}, ${childId}, ${permission}, "depth", "path") 
  as (
    (values (${varParentId}, ${varParentId}, ~  b'0'::bit(${literal(size)}), 0, array[]::${idType}[])) -- seed
    union all
    select -- recursive query
      "the_search_graph".${parentId} as ${parentId},
      "the_edge".${childId} as ${childId},
      ("the_search_graph".${permission}::bit(${literal(size)}) & "the_edge".${permission}::bit(${literal(size)}))::bit(${literal(size)}) as ${permission}, -- bitwise "and" on permission along a path
      "the_search_graph"."depth" + 1 as "depth", -- increment depth
      "the_search_graph"."path" || "the_edge".${parentId} as "path" -- append node id to path
    from ${edge} as "the_edge"
    join "search_graph" as "the_search_graph" 
    on "the_search_graph".${childId} = "the_edge".${parentId}
    where ("the_edge".${parentId} <> all ("the_search_graph"."path")) -- prevent from cycling
    and "the_search_graph"."depth" <= ${literal(maxDepth)} -- max search depth
  )
    select
      "the_search_graph".${parentId},
      "the_search_graph".${childId},
      ${orBitmap} ("the_search_graph".${permission}) -- bitwise "or" on permissions between various paths
    from "search_graph" as "the_search_graph"
    group by ("the_search_graph".${parentId}, "the_search_graph".${childId});

-- query a recursive table. you can add limit output or use a cursor
$$
language sql
stable;

${join(everyone.map(user => sql`grant execute on function ${edgeCacheChildCompute} (${varParentId} ${idType}) to ${identifier(user)};`), `\n`)}
`;
}


export const createMigrationAssignmentTable = <User extends string>(naming: Naming<User>, config: CompleteConfig<User>) => {
  const { edge, resourceId, roleId, permission, edgePkey, edgeResourceIdIndex, edgeRoleIdIndex } = naming.assignment;
  const size = config.engine.permission.bitmap.size;
  const { type: idType } = getIdType(config);
  const { users, writers } = getRoles(config);
  return sql`
-----------------------------------------------------------------------------------------------------------------------
-- Assignment from role to resource
-----------------------------------------------------------------------------------------------------------------------
create table if not exists ${edge} (
  ${resourceId} ${idType} not null,
  ${roleId} ${idType} not null,
  ${permission} bit(${literal(size)}),
  constraint ${edgePkey} primary key (${resourceId}, ${roleId})
);

create index if not exists ${edgeResourceIdIndex} on ${edge} (${resourceId});

create index if not exists ${edgeRoleIdIndex} on ${edge} (${roleId});

${setPrivileges(edge, users, writers)}
`;
}


export const createMigrationDataModelBindings = <User extends string>(naming: Naming<User>, config: CompleteConfig<User>) => {
  const { type: idType } = getIdType(config);
  const kinds = ["resource", "role"] as const;

  const addColumn = ({ table, id }: Binding) => sql`
alter table ${table} add column if not exists ${id} ${idType} unique;`;

  // New ids must not collide with ids already in bound columns, like explicit ids or the nodes of older p9s versions
  const advanceSequence = (kind: Kind) => {
    const { idSequence } = naming[kind];
    return sql`
do $$
declare
  "the_max" integer := (select max("the_id"."id") from (${allIds(kind, naming, config)}) as "the_id" ("id"));
begin
  if "the_max" >= (select case when "is_called" then "last_value" + 1 else "last_value" end from ${idSequence}) then
    perform setval(${textLiteral(compile(idSequence).text)}::regclass, "the_max");
  end if;
end
$$;`;
  };

  // Existing rows get a fresh id each. A column that already has a default, like a uuid primary key, keeps it.
  const bindColumn = (kind: Kind, { table, id }: Binding) => sql`
do $$
begin
  if not (select "atthasdef" from pg_attribute where "attrelid" = ${textLiteral(compile(table).text)}::regclass and "attname" = ${textLiteral(nameOf(id))}) then
    alter table ${table} alter column ${id} set default ${idDefault(kind, naming, config)};
  end if;
end
$$;
update ${table} set ${id} = default where ${id} is null;
alter table ${table} alter column ${id} set not null;
`;

  return sql`
-----------------------------------------------------------------------------------------------------------------------
-- Table bindings
-----------------------------------------------------------------------------------------------------------------------
${join(kinds.flatMap(kind => getIdBindings(kind, naming, config).map(addColumn)), `\n`)}
${join(kinds.flatMap(kind => getLeaves(kind, naming, config)).filter(leaf => leaf.parent?.lookup).map(({ table, leaf }) => sql`
alter table ${table} add column if not exists ${leaf.parentId} ${idType};`), `\n`)}
${config.engine.id.mode === "integer" ? join(kinds.map(advanceSequence), `\n`) : sql``}
${join(kinds.flatMap(kind => getIdBindings(kind, naming, config).map(binding => bindColumn(kind, binding))), `\n`)}
`;
}


export const createMigrationViews = <User extends string>(kind: Kind, naming: Naming<User>, config: CompleteConfig<User>) => {
  const { parentId, childId, permission, edgeCacheParentCompute, edgeCacheView } = naming[kind];
  const { everyone } = getRoles(config);
  return sql`
-----------------------------------------------------------------------------------------------------------------------
-- ${literal(kind)} view of all transitive edges, computed from scratch
-----------------------------------------------------------------------------------------------------------------------
-- This direction is easy, since we have less parents than children in general
create or replace view ${edgeCacheView} as
select
  "parent_permissions".${parentId} as ${parentId},
  "parent_permissions".${childId} as ${childId},
  "parent_permissions".${permission} as ${permission}
from
  (${boundIds(kind, naming, config)}) as "the_node" ("id"),
  lateral ${edgeCacheParentCompute} ("the_node"."id") as "parent_permissions";

${setPrivileges(edgeCacheView, everyone, [])}
`;
}


// Databases created when p9s had node tables. Every node must be a bound row, then the node table and everything
// that referenced it go away. Without cascade, so objects the user built on top of them stop the migration.
export const createMigrationLegacyUpgrade = <User extends string>(kind: Kind, naming: Naming<User>, config: CompleteConfig<User>) => {
  const { node, id, edge, parentId, childId, home, parentFkey, childFkey, edgeCache, edgeCacheParentFkey, edgeCacheChildFkey,
    edgeInsertTrigger, edgeUpdateTrigger, edgeDeleteTrigger, nodeInsertTriggerFunction, nodeUpdateTriggerFunction, nodeDeleteTriggerFunction } = naming[kind];
  const { assignment } = naming;
  const bindings = getBindings(kind, naming, config);
  const notBound = (value: SQL) => bindings.length === 0
    ? sql`true`
    : join(bindings.map(binding => sql`not exists (select from ${binding.table} as "the_row" where "the_row".${binding.id} = ${value})`), ` and `);
  const tableFkeys = config.tables.filter(table => kind === "resource" ? table.isResource : table.isRole).map(table => {
    const tableNaming = naming.tables[table.name]!;
    return sql`alter table ${tableNaming.schema}.${tableNaming.name} drop constraint if exists ${kind === "resource" ? tableNaming.resourceFkey : tableNaming.roleFkey};`;
  });
  return sql`
-----------------------------------------------------------------------------------------------------------------------
-- Upgrade from node tables: ${literal(kind)}
-----------------------------------------------------------------------------------------------------------------------
do $$
declare
  "the_count" bigint;
begin
  if to_regclass(${textLiteral(nameOf(node))}) is not null then
    select count(*) into "the_count" from ${node} as "the_node" where ${notBound(sql`"the_node".${id}`)};
    if "the_count" > 0 then
      raise exception 'p9s: % % nodes are not a row of a bound table. Bind a table that holds them (a table with only an id column is enough) or delete them, then run the migration again.', "the_count", ${textLiteral(kind)};
    end if;
    alter table ${edge} drop constraint if exists ${parentFkey};
    alter table ${edge} drop constraint if exists ${childFkey};
    alter table ${edgeCache} drop constraint if exists ${edgeCacheParentFkey};
    alter table ${edgeCache} drop constraint if exists ${edgeCacheChildFkey};
    alter table ${assignment.edge} drop constraint if exists ${kind === "resource" ? assignment.resourceFkey : assignment.roleFkey};
    alter table if exists ${assignment.edgeCache} drop constraint if exists ${kind === "resource" ? assignment.edgeCacheResourceFkey : assignment.edgeCacheRoleFkey};
    ${join(tableFkeys, `\n    `)}
    -- Recreated below. The bootstrap rebuilds the cache, there is no need to refresh it edge by edge here.
    drop trigger if exists ${edgeInsertTrigger} on ${edge};
    drop trigger if exists ${edgeUpdateTrigger} on ${edge};
    drop trigger if exists ${edgeDeleteTrigger} on ${edge};
    -- Edges that match a parent column become the home edges of their rows
    ${join(bindings.filter(binding => binding.parent).map(binding => sql`
    update ${edge} as "the_edge" set ${home} = true
    from ${binding.table} as "the_row"
    where "the_edge".${childId} = "the_row".${binding.id} and "the_edge".${parentId} = ${parentOf(binding, sql`"the_row"`)};`), `\n`)}
    drop table ${node};
    drop function if exists ${nodeInsertTriggerFunction}();
    drop function if exists ${nodeUpdateTriggerFunction}();
    drop function if exists ${nodeDeleteTriggerFunction}();
  end if;
end
$$;
`;
}


export const createMigrationResourceOrRole = <User extends string>(kind: Kind, naming: Naming<User>, config: CompleteConfig<User>) => {
  const { edge, parentId, childId, permission, home, edgePkey, edgeCache, edgeCachePkey, edgeCacheView, edgeCacheBackfill,
    edgeInsertTriggerFunction, edgeInsertTrigger, edgeUpdateTriggerFunction, edgeUpdateTrigger, edgeDeleteTriggerFunction, edgeDeleteTrigger,
    edgeGuardTriggerFunction, edgeGuardInsertTrigger, edgeGuardUpdateTrigger, edgeGuardDeleteTrigger,
    enableTriggerFunction, disableTriggerFunction
  } = naming[kind];
  const { assignment, truncateGuardTrigger } = naming;
  const size = config.engine.permission.bitmap.size;
  const maxDepth = config.engine.permission.maxDepth[kind];
  const { orBitmap } = naming;
  const { users, writers } = getRoles(config);
  const { type: idType } = getIdType(config);
  const bindings = getBindings(kind, naming, config);
  const assignmentId = kind === "resource" ? assignment.resourceId : assignment.roleId;
  const allBits = ones(config);

  // A cache row (ancestor, descendant) can only change when a changed edge parent -> child lies on one of its paths,
  // before or after the change. Its descendant is then the child or below it, an "affected" node. Its ancestor reaches
  // the parent of the first changed edge on that path through unchanged edges, so it is an "upstream" node: a changed
  // parent or one of their ancestors after the change. The rows ending at a node outside the affected set are the same
  // before and after the change, so the walk from an affected node towards its ancestors stops at the first node
  // outside the affected set and reuses that node's cache rows. Only rows whose value differs are written: unchanged
  // rows would still be locked by the upsert, and the combined assignment cache triggers recompute everything written.
  // A self row is recomputed as all ones, so it is left as it is.
  const refreshAffected = ({ parents, children }: { parents: SQL, children: SQL }) => sql`
  with recursive "affected" (${parentId}) as (
    (${children})
    union
    select "the_edge".${childId}
    from ${edge} as "the_edge"
    join "affected" on "the_edge".${parentId} = "affected".${parentId}
  ),
  "upstream" (${parentId}) as (
    (${parents})
    union
    select "the_edge".${parentId}
    from ${edge} as "the_edge"
    join "upstream" on "the_edge".${childId} = "upstream".${parentId}
  ),
  "walk" (${parentId}, ${childId}, ${permission}, "inside", "depth", "path") as (
    select "affected".${parentId}, "affected".${parentId}, ${allBits}, true, 0, array["affected".${parentId}]
    from "affected"
    union all
    select
      "the_edge".${parentId},
      "walk".${childId},
      ("walk".${permission} & "the_edge".${permission})::bit(${literal(size)}), -- bitwise "and" on permission along a path
      "the_edge".${parentId} in (select ${parentId} from "affected"),
      "walk"."depth" + 1,
      "walk"."path" || "the_edge".${parentId}
    from "walk"
    join ${edge} as "the_edge" on "the_edge".${childId} = "walk".${parentId}
    where "walk"."inside"
    and "the_edge".${parentId} <> all ("walk"."path") -- prevent from cycling
    and "walk"."depth" <= ${literal(maxDepth)} -- max search depth
  ),
  "fresh" as (
    select "the_path".${parentId}, "the_path".${childId}, ${orBitmap} ("the_path".${permission}) as ${permission} -- bitwise "or" on permissions between various paths
    from (
      select "walk".${parentId}, "walk".${childId}, "walk".${permission}
      from "walk"
      where "walk"."inside"
      and ${isIn(sql`"walk".${parentId}`, sql`select ${parentId} from "upstream"`)}
      union all
      -- Filtered after the join: on the cache lookup, Postgres would count building the hash of "upstream" once per
      -- walked node, and prefer comparing every walked node with the whole cache.
      select "the_ancestor".${parentId}, "the_ancestor".${childId}, "the_ancestor".${permission}
      from (
        select "the_edge_cache".${parentId}, "walk".${childId}, ("the_edge_cache".${permission} & "walk".${permission})::bit(${literal(size)}) as ${permission}
        from "walk"
        join ${edgeCache} as "the_edge_cache" on "the_edge_cache".${childId} = "walk".${parentId}
        where not "walk"."inside"
        offset 0
      ) as "the_ancestor"
      where ${isIn(sql`"the_ancestor".${parentId}`, sql`select ${parentId} from "upstream"`)}
    ) as "the_path"
    group by ("the_path".${parentId}, "the_path".${childId})
  ),
  -- An array is computed once and drives a single index scan. As a join, the planner can prefer a whole table scan
  -- when it overestimates the rows of "fresh".
  "stale" as (
    delete from ${edgeCache}
    where ${edgeCache}.${childId} = any (array (select ${parentId} from "affected"))
    and ${isIn(sql`${edgeCache}.${parentId}`, sql`select ${parentId} from "upstream"`)}
    and (${edgeCache}.${parentId}, ${edgeCache}.${childId}) not in (select "fresh".${parentId}, "fresh".${childId} from "fresh")
  )
  insert into ${edgeCache} (${parentId}, ${childId}, ${permission})
  select "fresh".${parentId}, "fresh".${childId}, "fresh".${permission}
  from "fresh"
  where not exists (
    select 1 from ${edgeCache} as "the_edge_cache"
    where "the_edge_cache".${parentId} = "fresh".${parentId}
    and "the_edge_cache".${childId} = "fresh".${childId}
    and "the_edge_cache".${permission} = "fresh".${permission}
  )
  on conflict on constraint ${edgeCachePkey}
  do update set ${permission} = excluded.${permission};`;

  const changed = {
    insert: { parents: sql`select ${parentId} from "p9s_new_rows"`, children: sql`select ${childId} from "p9s_new_rows"` },
    update: {
      parents: sql`select ${parentId} from "p9s_old_rows" union select ${parentId} from "p9s_new_rows"`,
      children: sql`select ${childId} from "p9s_old_rows" union select ${childId} from "p9s_new_rows"`,
    },
    delete: { parents: sql`select ${parentId} from "p9s_old_rows"`, children: sql`select ${childId} from "p9s_old_rows"` },
  };

  // Self rows are the registry of the ids of bound rows. Joins on the cache key stay index lookups, an `exists` could
  // be planned as a hashed subplan over the whole cache.
  const selfRow = (alias: string, value: SQL) =>
    sql`left join ${edgeCache} as ${identifier(alias)} on ${identifier(alias)}.${parentId} = ${value} and ${identifier(alias)}.${childId} = ${value}`;
  const invalidEdges = sql`from "p9s_new_rows" as "the_edge"
    ${selfRow("the_parent_self", sql`"the_edge".${parentId}`)}
    ${selfRow("the_child_self", sql`"the_edge".${childId}`)}
    where "the_parent_self".${parentId} is null or "the_child_self".${parentId} is null`;
  const validateEdges = sql`
  if exists (select ${invalidEdges}) then
    raise exception 'p9s: the % edge % does not connect two rows of bound tables', ${textLiteral(kind)},
      (select format('%s -> %s', "the_edge".${parentId}, "the_edge".${childId}) ${invalidEdges} limit 1)
      using errcode = 'foreign_key_violation';
  end if;`;

  const edgeTrigger = (functionName: SQL, triggerName: SQL, event: TriggerEvent) =>
    statementTrigger(naming, config, functionName, triggerName, edge, event,
      sql`${event === "delete" ? sql`` : validateEdges}
${refreshAffected(changed[event])}`, indexLookupsOnly);

  // What bound rows do to the graph, shared by the tables of this tree. Each takes the ids of the rows a statement
  // changed, and for inserts and parent changes, the parent id of each row (null for none). Only the bound-table
  // triggers call them, so they run as the owner with its search path. With array arguments, plpgsql would plan each
  // statement again on every call; every lookup is by key, so the generic plan is as good.
  const nodeFunction = (functionName: SQL, args: SQL, body: SQL) => sql`
create or replace function ${functionName} (${args})
returns void as $$
begin
${body}
end;
$$ language plpgsql set plan_cache_mode = force_generic_plan;

${grantExecute(sql`${functionName} (${args})`, [])}
`;
  const idsArgument = sql`"the_ids" ${idType}[]`;
  const idsAndParentsArguments = sql`"the_ids" ${idType}[], "the_parents" ${idType}[]`;
  const rows = sql`unnest("the_ids", coalesce("the_parents", '{}')) as "the_row" ("id", "parent")`;
  // Rows of role leaf tables keep a role id without being nodes
  const usedIds = join([
    sql`select "the_row"."id" from unnest("the_ids") as "the_row" ("id")
    join ${edgeCache} as "the_self" on "the_self".${parentId} = "the_row"."id" and "the_self".${childId} = "the_row"."id"`,
    ...(kind === "role" ? getLeaves(kind, naming, config) : []).map(leaf => sql`select "the_row"."id" from unnest("the_ids") as "the_row" ("id")
    join ${leaf.table} as "the_leaf" on "the_leaf".${leaf.id} = "the_row"."id"`),
  ], `\n    union all\n    `);

  const nodeFunctions = sql`
${nodeFunction(naming[kind].nodeInsertFunction, idsAndParentsArguments, sql`
  if exists (${usedIds}) then
    raise exception 'p9s: the % id % is already used by another row', ${textLiteral(kind)},
      (select "the_used"."id" from (${usedIds}) as "the_used" limit 1)
      using errcode = 'unique_violation';
  end if;
  -- A new row cannot be referenced by others yet, so its self row needs no lock
  insert into ${edgeCache} (${parentId}, ${childId}, ${permission})
  select "the_row"."id", "the_row"."id", ${allBits} from unnest("the_ids") as "the_row" ("id");
  if exists (select from unnest("the_parents") as "the_parent" ("id") where "the_parent"."id" is not null) then
    ${lockGraph(config)}
    insert into ${edge} (${parentId}, ${childId}, ${permission}, ${home})
    select "the_row"."parent", "the_row"."id", ${allBits}, true
    from ${rows}
    where "the_row"."parent" is not null
    on conflict on constraint ${edgePkey} do nothing;
  end if;`)}
-- The home edge follows the parent column. It moves when nothing else links the new parent to the row, otherwise it
-- gives way to that edge and the edge keeps its bits.
${nodeFunction(naming[kind].nodeUpdateFunction, idsAndParentsArguments, sql`
  ${lockGraph(config)}
  update ${edge} as "the_edge" set ${parentId} = "the_row"."parent"
  from ${rows}
  where "the_edge".${childId} = "the_row"."id" and "the_edge".${home}
  and "the_row"."parent" is not null and "the_edge".${parentId} <> "the_row"."parent"
  and not exists (select from ${edge} as "the_other" where "the_other".${parentId} = "the_row"."parent" and "the_other".${childId} = "the_row"."id");

  delete from ${edge} as "the_edge"
  using ${rows}
  where "the_edge".${childId} = "the_row"."id" and "the_edge".${home}
  and "the_edge".${parentId} is distinct from "the_row"."parent";

  insert into ${edge} (${parentId}, ${childId}, ${permission}, ${home})
  select "the_row"."parent", "the_row"."id", ${allBits}, true
  from ${rows}
  where "the_row"."parent" is not null
  on conflict on constraint ${edgePkey} do nothing;`)}
-- The lock comes first: an edge to these rows committed while they are deleted must be seen by the deletes below
${nodeFunction(naming[kind].nodeDeleteFunction, idsArgument, sql`
  ${lockGraph(config)}
  delete from ${assignment.edge} as "the_assignment"
  where "the_assignment".${assignmentId} = any ("the_ids");
  delete from ${edge} as "the_edge"
  where "the_edge".${parentId} = any ("the_ids") or "the_edge".${childId} = any ("the_ids");
  delete from ${edgeCache} as "the_self"
  using unnest("the_ids") as "the_row" ("id")
  where "the_self".${parentId} = "the_row"."id" and "the_self".${childId} = "the_row"."id";`)}`;

  // The bound row is the node: its triggers hand the ids and parents of the changed rows to the node functions. One
  // function serves the three triggers, plpgsql plans its statements separately for each. `having` skips statements
  // that changed no row.
  const boundTriggers = (binding: Binding) => {
    const { table, id, triggerFunction: functionName, triggers, parent } = binding;
    const parentIds = parent ? sql`array_agg(${parentOf(binding, sql`"the_row"`)})` : sql`null`;
    const moved = parent && sql`from "p9s_new_rows" as "the_row" join "p9s_old_rows" as "the_old_row" using (${id})
      where "the_row".${parent.column} is distinct from "the_old_row".${parent.column}`;
    return sql`
-- ${literal(binding.tableName)} rows are ${literal(kind)} nodes
create or replace function ${functionName}()
returns trigger as $$
begin
  if tg_op = 'INSERT' then${checkParentsFound(binding, sql`"p9s_new_rows"`)}
    perform ${naming[kind].nodeInsertFunction}(array_agg("the_row".${id}), ${parentIds}) from "p9s_new_rows" as "the_row" having count(*) > 0;
  elsif tg_op = 'UPDATE' then
    if exists (select ${id} from "p9s_old_rows" except select ${id} from "p9s_new_rows") then
      raise exception 'p9s: the % id of a % row cannot change', ${textLiteral(kind)}, ${textLiteral(binding.tableName)} using errcode = 'integrity_constraint_violation';
    end if;${moved ? sql`
    if exists (select ${moved}) then${checkParentsFound(binding, sql`"p9s_new_rows"`)}
      perform ${naming[kind].nodeUpdateFunction}(array_agg("the_row".${id}), ${parentIds})
      ${moved};
    end if;` : sql``}
  else
    perform ${naming[kind].nodeDeleteFunction}(array_agg("the_row".${id})) from "p9s_old_rows" as "the_row" having count(*) > 0;
  end if;
  return null;
end;
$$ language plpgsql ${definer(naming)};
${grantExecute(sql`${functionName} ()`, [])}
${join((["insert", "update", "delete"] as const).map(event => attachStatementTrigger(functionName, triggers[event], table, event)), ``)}
drop trigger if exists ${truncateGuardTrigger} on ${table};
create trigger ${truncateGuardTrigger} before truncate on ${table} for each statement execute function ${naming.truncateGuardFunction}();
`;
  };

  // Enable and disable cover every p9s trigger of this tree. Assignments are validated against both trees, their
  // triggers go with the resource tree.
  const triggersByTable: Array<[SQL, SQL[]]> = [
    [edge, [edgeInsertTrigger, edgeUpdateTrigger, edgeDeleteTrigger, edgeGuardInsertTrigger, edgeGuardUpdateTrigger, edgeGuardDeleteTrigger, truncateGuardTrigger]],
    ...bindings.map(({ table, triggers }): [SQL, SQL[]] => [table, [triggers.insert, triggers.update, triggers.delete, truncateGuardTrigger]]),
    ...(kind === "resource" ? [[assignment.edge, [assignment.edgeValidateInsertTrigger, assignment.edgeValidateUpdateTrigger, truncateGuardTrigger]] as [SQL, SQL[]]] : []),
  ];
  const toggleTriggers = (action: SQL) => join(triggersByTable.flatMap(([table, triggers]) =>
    triggers.map(trigger => sql`alter table ${table} ${action} trigger ${trigger};`)), `\n  `);

  // Rows written while the triggers were disabled get their home edges, and home edges follow their parent column
  const homeEdgeFixups = join(bindings.map(binding => binding.parent ? sql`
  ${checkParentsFound(binding, binding.table)}
  delete from ${edge} as "the_edge"
  using ${binding.table} as "the_row"
  where "the_edge".${childId} = "the_row".${binding.id} and "the_edge".${home}
  and "the_edge".${parentId} is distinct from ${parentOf(binding, sql`"the_row"`)};
  insert into ${edge} (${parentId}, ${childId}, ${permission}, ${home})
  select ${parentOf(binding, sql`"the_row"`)}, "the_row".${binding.id}, ${allBits}, true
  from ${binding.table} as "the_row"
  where "the_row".${binding.parent.column} is not null
  on conflict on constraint ${edgePkey} do nothing;` : sql`
  -- No parent column: the home edges of these rows become regular edges
  update ${edge} as "the_edge" set ${home} = false
  from ${binding.table} as "the_row"
  where "the_edge".${childId} = "the_row".${binding.id} and "the_edge".${home};`), `\n`);

  const ids = boundIds(kind, naming, config);
  const everyId = allIds(kind, naming, config);

  return sql`
-----------------------------------------------------------------------------------------------------------------------
-- ${literal(kind)} function to rebuild the cache from scratch
-----------------------------------------------------------------------------------------------------------------------
create or replace function ${edgeCacheBackfill} ()
  returns setof ${edgeCache}
  as $$
begin
  ${lockGraphStatement(config)}
  if exists (select from (${everyId}) as "the_id" ("id") group by "the_id"."id" having count(*) > 1) then
    raise exception 'p9s: the % id % is used by more than one bound row', ${textLiteral(kind)},
      (select "the_id"."id" from (${everyId}) as "the_id" ("id") group by "the_id"."id" having count(*) > 1 limit 1)
      using errcode = 'unique_violation';
  end if;
  if exists (select from ${edge} as "the_edge" where "the_edge".${parentId} not in (${ids}) or "the_edge".${childId} not in (${ids})) then
    raise exception 'p9s: % edges connect ids that are not rows of bound tables', ${textLiteral(kind)} using errcode = 'foreign_key_violation';
  end if;
  if exists (select from ${assignment.edge} as "the_assignment" where "the_assignment".${assignmentId} not in (${ids})) then
    raise exception 'p9s: assignments reference % ids that are not rows of bound tables', ${textLiteral(kind)} using errcode = 'foreign_key_violation';
  end if;
  -- Backfills usually follow a bulk load, before autovacuum has gathered statistics. Without them the planner can
  -- seq scan the edge table at every step of the recursive walk, which is quadratic in the number of edges.
  -- This has to be plpgsql: a sql function plans every statement before running the first one.
  analyze ${edge};
  delete from ${edgeCache};
  return query
  insert into ${edgeCache} (${parentId}, ${childId}, ${permission})
  select ${parentId}, ${childId}, ${permission}
  from
    ${edgeCacheView}
    returning
      *;
end;
$$
language plpgsql
volatile
${definer(naming)};

${grantExecute(sql`${edgeCacheBackfill} ()`, writers)}

-----------------------------------------------------------------------------------------------------------------------
-- ${literal(kind)} Update cache when edges change
-----------------------------------------------------------------------------------------------------------------------
${edgeTrigger(edgeInsertTriggerFunction, edgeInsertTrigger, "insert")}
${edgeTrigger(edgeUpdateTriggerFunction, edgeUpdateTrigger, "update")}
${edgeTrigger(edgeDeleteTriggerFunction, edgeDeleteTrigger, "delete")}

drop trigger if exists ${truncateGuardTrigger} on ${edge};
create trigger ${truncateGuardTrigger} before truncate on ${edge} for each statement execute function ${naming.truncateGuardFunction}();

-----------------------------------------------------------------------------------------------------------------------
-- ${literal(kind)} home edges are written by p9s only
-----------------------------------------------------------------------------------------------------------------------
-- p9s writes them from the triggers of bound tables, one level deeper than a statement sent by a client
create or replace function ${edgeGuardTriggerFunction}()
returns trigger as $$
begin
  if pg_trigger_depth() > 1 then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'INSERT' then
    raise exception 'p9s: home edges are created by p9s from the parent column of their row'
      using errcode = 'insufficient_privilege';
  elsif tg_op = 'UPDATE' then
    if new.${home} and not old.${home} then
      raise exception 'p9s: an edge cannot be made a home edge, home edges follow the parent column of their row'
        using errcode = 'insufficient_privilege';
    end if;
    -- Changing a home edge makes it a regular edge, which moving or deleting its row leaves alone
    new.${home} := false;
    return new;
  end if;
  raise exception 'p9s: home edges are removed by moving or deleting their row. To delete one apart from its row, first make it a regular edge with update ... set home = false'
    using errcode = 'insufficient_privilege';
end;
$$ language plpgsql;

${grantExecute(sql`${edgeGuardTriggerFunction} ()`, [])}

drop trigger if exists ${edgeGuardInsertTrigger} on ${edge};
create trigger ${edgeGuardInsertTrigger} before insert on ${edge} for each row when (new.${home}) execute function ${edgeGuardTriggerFunction}();
drop trigger if exists ${edgeGuardUpdateTrigger} on ${edge};
create trigger ${edgeGuardUpdateTrigger} before update on ${edge} for each row when (old.${home} or new.${home}) execute function ${edgeGuardTriggerFunction}();
drop trigger if exists ${edgeGuardDeleteTrigger} on ${edge};
create trigger ${edgeGuardDeleteTrigger} before delete on ${edge} for each row when (old.${home}) execute function ${edgeGuardTriggerFunction}();

-----------------------------------------------------------------------------------------------------------------------
-- ${literal(kind)} rows of bound tables
-----------------------------------------------------------------------------------------------------------------------
${nodeFunctions}
${join(bindings.map(boundTriggers), `\n`)}

-----------------------------------------------------------------------------------------------------------------------
-- ${literal(kind)} functions to enable / disable triggers
-----------------------------------------------------------------------------------------------------------------------
create or replace function ${disableTriggerFunction}()
returns void as $$
begin
  ${toggleTriggers(sql`disable`)}
end;
$$ language plpgsql ${definer(naming)};

${grantExecute(sql`${disableTriggerFunction} ()`, writers)}

-- Also brings the graph up to date with rows written while the triggers were disabled
create or replace function ${enableTriggerFunction}()
returns void as $$
begin
  ${lockGraphStatement(config)}
  ${toggleTriggers(sql`disable`)}
  ${homeEdgeFixups}
  ${toggleTriggers(sql`enable`)}
  perform ${edgeCacheBackfill}();
end;
$$ language plpgsql ${definer(naming)};

${grantExecute(sql`${enableTriggerFunction} ()`, writers)}
`;
}


export const createMigrationAssignments = <User extends string>(naming: Naming<User>, config: CompleteConfig<User>) => {
  const { resource, role, permission, orBitmap, truncateGuardTrigger } = naming;
  const size = config.engine.permission.bitmap.size;
  const {
    edge, resourceId, roleId,
    edgeCacheView, edgeCacheBackfill, edgeCache, edgeCachePkey,
    edgeCacheResourceIdIndex,
    edgeCacheRoleIdIndex, enableTriggerFunction, disableTriggerFunction,
    edgeInsertTriggerFunction,
    edgeInsertTrigger,
    edgeUpdateTriggerFunction,
    edgeUpdateTrigger,
    edgeDeleteTriggerFunction,
    edgeDeleteTrigger,
    edgeValidateTriggerFunction,
    edgeValidateInsertTrigger,
    edgeValidateUpdateTrigger,
    combinedEdgeInsertTriggerFunction,
    combinedEdgeInsertTrigger,
    combinedEdgeUpdateTriggerFunction,
    combinedEdgeUpdateTrigger,
    combinedEdgeDeleteTriggerFunction,
    combinedEdgeDeleteTrigger
  } = naming.assignment;
  const { type: idType } = getIdType(config);
  const { writers, everyone } = getRoles(config);
  const combineAssignmentsWith = config.engine.combineAssignmentsWith;

  // Triggers from every mode are dropped first, so switching combineAssignmentsWith leaves no stale ones behind
  const namingForMode = (mode: "role" | "resource") =>
    getNaming({ ...config, engine: { ...config.engine, combineAssignmentsWith: mode } }).assignment;
  const dropAllTriggers = sql`
drop trigger if exists ${edgeInsertTrigger} on ${edge};
drop trigger if exists ${edgeUpdateTrigger} on ${edge};
drop trigger if exists ${edgeDeleteTrigger} on ${edge};
${join((["role", "resource"] as const).map(mode => {
    const modeNaming = namingForMode(mode);
    const cache = naming[mode].edgeCache;
    return sql`
drop trigger if exists ${modeNaming.combinedEdgeInsertTrigger} on ${cache};
drop trigger if exists ${modeNaming.combinedEdgeUpdateTrigger} on ${cache};
drop trigger if exists ${modeNaming.combinedEdgeDeleteTrigger} on ${cache};`;
  }), `\n`)}
`;

  const selfRow = (kind: Kind, alias: string, value: SQL) => {
    const { edgeCache: cache, parentId, childId } = naming[kind];
    return sql`left join ${cache} as ${identifier(alias)} on ${identifier(alias)}.${parentId} = ${value} and ${identifier(alias)}.${childId} = ${value}`;
  };
  const invalidAssignments = sql`from "p9s_new_rows" as "the_assignment"
    ${selfRow("resource", "the_resource_self", sql`"the_assignment".${resourceId}`)}
    ${selfRow("role", "the_role_self", sql`"the_assignment".${roleId}`)}
    where "the_resource_self".${resource.parentId} is null or "the_role_self".${role.parentId} is null`;
  const validateBody = sql`
  if exists (select ${invalidAssignments}) then
    raise exception 'p9s: the assignment of resource % to role % does not reference rows of bound tables',
      (select "the_assignment".${resourceId} ${invalidAssignments} limit 1), (select "the_assignment".${roleId} ${invalidAssignments} limit 1)
      using errcode = 'foreign_key_violation';
  end if;`;

  const getCombinedCacheBlock = (resourceOrRole: "role" | "resource") => {
    const thingCombinedWith = naming[resourceOrRole];
    const thingCombinedWithId = { role: roleId, resource: resourceId }[resourceOrRole];
    const thingNotCombinedWithId = { role: resourceId, resource: roleId }[resourceOrRole];
    // The cache layout is the same in both modes, so switching modes keeps the table and its dependents
    const combinedColumn = sql`"the_edge_cache".${thingCombinedWith.childId}`;
    const notCombinedColumn = sql`"the_assignment".${thingNotCombinedWithId}`;
    const [roleColumn, resourceColumn] = resourceOrRole === "role" ? [combinedColumn, notCombinedColumn] : [notCombinedColumn, combinedColumn];

    const selectCombined = (filter: SQL) => sql`
    select
      ${roleColumn} as ${roleId},
      ${resourceColumn} as ${resourceId},
      ${orBitmap} ("the_assignment".${permission} & "the_edge_cache".${permission}) as ${permission} -- bitwise "or" on permissions between various paths
    from
      ${edge} as "the_assignment"
    join
      ${thingCombinedWith.edgeCache} as "the_edge_cache"
    on
      "the_assignment".${thingCombinedWithId} = "the_edge_cache".${thingCombinedWith.parentId}
    where ${filter}
    group by ("the_assignment".${thingNotCombinedWithId}, "the_edge_cache".${thingCombinedWith.childId})`;

    // Recomputes every cache row sharing a key with the changed rows: a changed assignment affects all rows of its
    // resource (resp. role), a changed transitive edge affects all rows of its child
    const recompute = (cacheColumn: SQL, sourceFilter: (keys: SQL) => SQL, keys: SQL) => sql`
  delete from ${edgeCache} where ${cacheColumn} in (${keys});
  insert into ${edgeCache} (${roleId}, ${resourceId}, ${permission})
  ${selectCombined(sourceFilter(keys))};`;

    const byAssignment = (keys: SQL) => recompute(thingNotCombinedWithId, k => sql`"the_assignment".${thingNotCombinedWithId} in (${k})`, keys);
    const byEdgeCache = (keys: SQL) => recompute(thingCombinedWithId, k => sql`"the_edge_cache".${thingCombinedWith.childId} in (${k})`, keys);

    const newAssignments = sql`select ${thingNotCombinedWithId} from "p9s_new_rows"`;
    const oldAssignments = sql`select ${thingNotCombinedWithId} from "p9s_old_rows"`;
    const newEdgeCaches = sql`select ${thingCombinedWith.childId} from "p9s_new_rows"`;
    const oldEdgeCaches = sql`select ${thingCombinedWith.childId} from "p9s_old_rows"`;

    // The self row of a new bound row has no assignment yet and nothing can assign it before it commits. The assignments
    // are a join, so they are looked up by index: a correlated exists planned for a bulk write would hash them all.
    const onlyUnassignedSelfRows = sql`not exists (
    select from "p9s_new_rows" as "the_edge_cache"
    where "the_edge_cache".${thingCombinedWith.parentId} <> "the_edge_cache".${thingCombinedWith.childId}
  ) and not exists (
    select from "p9s_new_rows" as "the_edge_cache"
    join ${edge} as "the_assignment" on "the_assignment".${thingCombinedWithId} = "the_edge_cache".${thingCombinedWith.parentId}
  )`;

    const trigger = (functionName: SQL, triggerName: SQL, table: SQL, event: TriggerEvent, body: SQL, skip?: SQL) =>
      statementTrigger(naming, config, functionName, triggerName, table, event, body, sql``, skip);

    return sql`

-----------------------------------------------------------------------------------------------------------------------
-- Assignment transitive edge cache table
-----------------------------------------------------------------------------------------------------------------------
create table if not exists ${edgeCache} (
  ${roleId} ${idType} not null,
  ${resourceId} ${idType} not null,
  ${permission} bit(${literal(size)}),
  constraint ${edgeCachePkey} primary key (${roleId}, ${resourceId})
);

create index if not exists ${edgeCacheRoleIdIndex} on ${edgeCache} (${roleId});

create index if not exists ${edgeCacheResourceIdIndex} on ${edgeCache} (${resourceId});

-- Only p9s triggers write to the cache
${setPrivileges(edgeCache, everyone, [])}


-----------------------------------------------------------------------------------------------------------------------
-- View of all transitive assignment with cache edges
-----------------------------------------------------------------------------------------------------------------------
create or replace view ${edgeCacheView} as
${selectCombined(sql`true`)};

${setPrivileges(edgeCacheView, everyone, [])}

-----------------------------------------------------------------------------------------------------------------------
-- Assignment function to rebuild the cache from scratch
-----------------------------------------------------------------------------------------------------------------------
create or replace function ${edgeCacheBackfill} ()
  returns setof ${edgeCache}
  as $$
begin
  ${lockGraphStatement(config)}
  -- Same as the edge cache backfills, the join plan needs statistics on freshly loaded tables
  analyze ${edge};
  analyze ${thingCombinedWith.edgeCache};
  delete from ${edgeCache};
  -- Policies read the rows of a role together. In this order they fill few pages, whatever plan the view takes.
  return query
  insert into ${edgeCache} (${roleId}, ${resourceId}, ${permission})
  select ${roleId}, ${resourceId}, ${permission}
  from
    ${edgeCacheView}
  order by
    ${roleId}, ${resourceId}
    returning
      *;
end;
$$
language plpgsql
volatile
${definer(naming)};

${grantExecute(sql`${edgeCacheBackfill} ()`, writers)}

-----------------------------------------------------------------------------------------------------------------------
-- Update cache when assignments change
-----------------------------------------------------------------------------------------------------------------------
${trigger(edgeInsertTriggerFunction, edgeInsertTrigger, edge, "insert", byAssignment(newAssignments))}
${trigger(edgeUpdateTriggerFunction, edgeUpdateTrigger, edge, "update", byAssignment(sql`${oldAssignments} union ${newAssignments}`))}
${trigger(edgeDeleteTriggerFunction, edgeDeleteTrigger, edge, "delete", byAssignment(oldAssignments))}

-----------------------------------------------------------------------------------------------------------------------
-- Update cache when the ${literal(resourceOrRole)} transitive edge cache changes
-----------------------------------------------------------------------------------------------------------------------
${trigger(combinedEdgeInsertTriggerFunction, combinedEdgeInsertTrigger, thingCombinedWith.edgeCache, "insert", byEdgeCache(newEdgeCaches), onlyUnassignedSelfRows)}
${trigger(combinedEdgeUpdateTriggerFunction, combinedEdgeUpdateTrigger, thingCombinedWith.edgeCache, "update", byEdgeCache(sql`${oldEdgeCaches} union ${newEdgeCaches}`))}
${trigger(combinedEdgeDeleteTriggerFunction, combinedEdgeDeleteTrigger, thingCombinedWith.edgeCache, "delete", byEdgeCache(oldEdgeCaches))}

-----------------------------------------------------------------------------------------------------------------------
-- Assignment functions to enable / disable triggers
-----------------------------------------------------------------------------------------------------------------------
create or replace function ${enableTriggerFunction}()
returns void as $$
  alter table ${edge} enable trigger ${edgeInsertTrigger};
  alter table ${edge} enable trigger ${edgeUpdateTrigger};
  alter table ${edge} enable trigger ${edgeDeleteTrigger};
  alter table ${thingCombinedWith.edgeCache} enable trigger ${combinedEdgeInsertTrigger};
  alter table ${thingCombinedWith.edgeCache} enable trigger ${combinedEdgeUpdateTrigger};
  alter table ${thingCombinedWith.edgeCache} enable trigger ${combinedEdgeDeleteTrigger};
  -- Backfill cache
  select 1 from ${edgeCacheBackfill}();
$$ language sql ${definer(naming)};

${grantExecute(sql`${enableTriggerFunction} ()`, writers)}

create or replace function ${disableTriggerFunction}()
returns void as $$
  alter table ${edge} disable trigger ${edgeInsertTrigger};
  alter table ${edge} disable trigger ${edgeUpdateTrigger};
  alter table ${edge} disable trigger ${edgeDeleteTrigger};
  alter table ${thingCombinedWith.edgeCache} disable trigger ${combinedEdgeInsertTrigger};
  alter table ${thingCombinedWith.edgeCache} disable trigger ${combinedEdgeUpdateTrigger};
  alter table ${thingCombinedWith.edgeCache} disable trigger ${combinedEdgeDeleteTrigger};
$$ language sql ${definer(naming)};

${grantExecute(sql`${disableTriggerFunction} ()`, writers)}

  `;
  }

  const combinedCacheBlock = (combineAssignmentsWith === "resource" || combineAssignmentsWith === "role") ? getCombinedCacheBlock(combineAssignmentsWith) : sql``;

  return sql`
-----------------------------------------------------------------------------------------------------------------------
-- Assignments connect rows of bound tables
-----------------------------------------------------------------------------------------------------------------------
${triggerFunction(naming, edgeValidateTriggerFunction, sql`
  if not exists (select from "p9s_new_rows") then
    return null;
  end if;
  ${lockGraph(config)}
${validateBody}`, indexLookupsOnly)}
${attachStatementTrigger(edgeValidateTriggerFunction, edgeValidateInsertTrigger, edge, "insert")}
${attachStatementTrigger(edgeValidateTriggerFunction, edgeValidateUpdateTrigger, edge, "update")}

drop trigger if exists ${truncateGuardTrigger} on ${edge};
create trigger ${truncateGuardTrigger} before truncate on ${edge} for each statement execute function ${naming.truncateGuardFunction}();

${dropAllTriggers}

${combinedCacheBlock}
`;
}


// Without a combined cache, removes the p9s objects a previous mode may have created. This runs after policies are
// replaced, since old ones may read the combined cache. No cascade, so objects created by the user on top of them
// make the migration fail instead of being dropped silently.
export const createMigrationCleanup = <User extends string>(naming: Naming<User>, config: CompleteConfig<User>) => {
  if (config.engine.combineAssignmentsWith !== "none") {
    return sql``;
  }
  const { enableTriggerFunction, disableTriggerFunction, edgeCacheBackfill, edgeCacheView, edgeCache,
    edgeInsertTriggerFunction, edgeUpdateTriggerFunction, edgeDeleteTriggerFunction } = naming.assignment;
  const combinedTriggerFunctions = (["role", "resource"] as const).flatMap(mode => {
    const modeNaming = getNaming({ ...config, engine: { ...config.engine, combineAssignmentsWith: mode } }).assignment;
    return [modeNaming.combinedEdgeInsertTriggerFunction, modeNaming.combinedEdgeUpdateTriggerFunction, modeNaming.combinedEdgeDeleteTriggerFunction];
  });
  return sql`
-----------------------------------------------------------------------------------------------------------------------
-- Cleanup of a previous combined assignment cache
-----------------------------------------------------------------------------------------------------------------------
${join([enableTriggerFunction, disableTriggerFunction, edgeCacheBackfill, edgeInsertTriggerFunction, edgeUpdateTriggerFunction, edgeDeleteTriggerFunction, ...combinedTriggerFunctions]
    .map(fn => sql`drop function if exists ${fn} ();`), `\n`)}
drop view if exists ${edgeCacheView};
drop table if exists ${edgeCache};
`;
}


// A table that becomes a leaf table still has the triggers that made its rows nodes. Its rows leave the graph: their
// edges and assignments go away, and the bootstrap below rebuilds the caches without them. Rows with children would
// leave those children without their parent, so they stop the migration.
export const createMigrationLeaves = <User extends string>(naming: Naming<User>, config: CompleteConfig<User>) => {
  const { assignment, truncateGuardTrigger } = naming;

  const leavesOf = (kind: Kind) => {
    const { edge, edgeCache, parentId, childId, disableTriggerFunction } = naming[kind];
    const other: Kind = kind === "resource" ? "role" : "resource";
    const leaves = getLeaves(kind, naming, config);
    // Role leaf rows keep an id, which their trigger guards. Resource leaf rows only need one to follow a parent key.
    const triggerLeaves = kind === "role" ? leaves : leaves.filter(leaf => leaf.parent?.lookup);
    const others = [...getBindings(kind, naming, config), ...leaves.filter(leaf => !triggerLeaves.includes(leaf))];
    const otherLeaves = (binding: Binding) => leaves.filter(leaf => leaf !== binding);
    // The truncate guard trigger is shared by both trees
    const isNodeOfOther = (tableName: string) => getBindings(other, naming, config).some(binding => binding.tableName === tableName);

    // Ids never change, so the parent id of a leaf row only changes with its parent column. Set from the parent table
    // whatever the client writes, which needs the trigger to bypass the policies of the parent table.
    const leafTrigger = (binding: Binding) => {
      const { table, tableName, id, leaf } = binding;
      const { column, lookup } = binding.parent!;
      const columns = [...(kind === "role" ? [id] : []), ...(lookup ? [column, leaf.parentId] : [])];
      return sql`
create or replace function ${leaf.triggerFunction}()
returns trigger as $$
begin${kind === "role" ? sql`
  if tg_op = 'UPDATE' then
    if new.${id} is distinct from old.${id} then
      raise exception 'p9s: the role id of a % row cannot change', ${textLiteral(tableName)} using errcode = 'integrity_constraint_violation';
    end if;
  elsif exists (select from ${edgeCache} as "the_self" where "the_self".${parentId} = new.${id} and "the_self".${childId} = new.${id})${join(otherLeaves(binding).map(other => sql`
    or exists (select from ${other.table} as "the_leaf" where "the_leaf".${other.id} = new.${id})`), ``)} then
    raise exception 'p9s: the role id % is already used by another row', new.${id} using errcode = 'unique_violation';
  end if;` : sql``}${lookup ? sql`
  new.${leaf.parentId} := ${parentOf(binding, sql`new`)};
  if new.${column} is not null and new.${leaf.parentId} is null then
    raise exception 'p9s: % rows have a % that matches no row of %', ${textLiteral(tableName)}, ${textLiteral(nameOf(column))}, ${textLiteral(lookup.tableName)}
      using errcode = 'foreign_key_violation';
  end if;` : sql``}
  return new;
end;
$$ language plpgsql ${definer(naming)};
${grantExecute(sql`${leaf.triggerFunction} ()`, [])}
drop trigger if exists ${leaf.trigger} on ${table};
create trigger ${leaf.trigger} before insert or update of ${join(columns, `, `)} on ${table} for each row execute function ${leaf.triggerFunction}();${lookup ? sql`
update ${table} as "the_row" set ${leaf.parentId} = "the_parent".${lookup.id}
from ${lookup.table} as "the_parent"
where "the_parent".${lookup.key} = "the_row".${column} and "the_row".${leaf.parentId} is distinct from "the_parent".${lookup.id};` : sql``}`;
    };

    return sql`
${join(others.map(({ table, leaf }) => sql`drop trigger if exists ${leaf.trigger} on ${table};`), `\n`)}
${join(leaves.map(({ table, tableName, id, triggerFunction, triggers }) => sql`
do $$
begin
  if exists (select from pg_trigger where "tgrelid" = ${textLiteral(compile(table).text)}::regclass and "tgname" = ${textLiteral(nameOf(triggers.insert))}) then
    ${lockGraphStatement(config)}
    if exists (select from ${edge} as "the_edge" join ${table} as "the_row" on "the_edge".${parentId} = "the_row".${id}) then
      raise exception 'p9s: rows of % are parents of other ${raw(kind)}s, so % cannot become a ${raw(kind)} leaf table. Move their children first.', ${textLiteral(tableName)}, ${textLiteral(tableName)}
        using errcode = 'dependent_objects_still_exist';
    end if;
    drop trigger ${triggers.insert} on ${table};
    drop trigger if exists ${triggers.update} on ${table};
    drop trigger if exists ${triggers.delete} on ${table};${isNodeOfOther(tableName) ? sql`` : sql`
    drop trigger if exists ${truncateGuardTrigger} on ${table};`}
    drop function if exists ${triggerFunction} ();
    -- Home edges can only be deleted with the triggers off. The bootstrap turns them back on.
    perform ${disableTriggerFunction}();
    delete from ${assignment.edge} as "the_assignment" using ${table} as "the_row" where "the_assignment".${kind === "resource" ? assignment.resourceId : assignment.roleId} = "the_row".${id};
    delete from ${edge} as "the_edge" using ${table} as "the_row" where "the_edge".${childId} = "the_row".${id};
  end if;
end
$$;`), `\n`)}
${join(triggerLeaves.map(leafTrigger), `\n`)}`;
  };

  return sql`
-----------------------------------------------------------------------------------------------------------------------
-- Leaf tables
-----------------------------------------------------------------------------------------------------------------------
${leavesOf("resource")}
${leavesOf("role")}
`;
}


// Brings every cache up to date with the bound rows, edges and assignments, which also makes the migration re-runnable
export const createMigrationBootstrap = <User extends string>(naming: Naming<User>, config: CompleteConfig<User>) => {
  const combined = config.engine.combineAssignmentsWith !== "none";
  return sql`
-----------------------------------------------------------------------------------------------------------------------
-- Bootstrap caches
-----------------------------------------------------------------------------------------------------------------------
${combined ? sql`select ${naming.assignment.disableTriggerFunction}();` : sql``}
select ${naming.resource.enableTriggerFunction}();
select ${naming.role.enableTriggerFunction}();
${combined ? sql`select ${naming.assignment.enableTriggerFunction}();` : sql``}
`;
}


export const createMigrationDataModelPolicies = <User extends string>(naming: Naming<User>, config: CompleteConfig<User>) => {
  const { resource, role, assignment, currentRoleNodeFunction } = naming;
  const { type: idType } = getIdType(config);
  const { users } = getRoles(config);
  const roleLeaves = getLeaves("role", naming, config);
  // A user that is a role leaf row has the permissions of its parent. As a sub-select, the lookup runs once per query.
  const currentUserId = roleLeaves.length === 0
    ? sql`${identifier(config.engine.authentication.getCurrentUserId)}()`
    : sql`(select ${currentRoleNodeFunction}(${identifier(config.engine.authentication.getCurrentUserId)}()))`;
  const hasBit = (alias: string, column: SQL, bit: number | SQL) => sql`(${identifier(alias)}.${column} << ${typeof bit === "number" ? literal(bit) : bit})::bit = b'1'`;
  const nodeBindings = getBindings("resource", naming, config);
  const bindings = new Map([...nodeBindings, ...getLeaves("resource", naming, config)].map(binding => [binding.tableName, binding]));

  // As the owner, so that the policies of role leaf tables do not apply. A parentless leaf row maps to itself, which is
  // not a node and so has no permissions. In plpgsql, which keeps its plan for the session: a sql function that cannot
  // be inlined is planned again by every query.
  const currentRoleNode = roleLeaves.length === 0 ? sql`` : sql`
create or replace function ${currentRoleNodeFunction} ("the_user_id" ${idType})
  returns ${idType}
  as $$
begin
  return coalesce(${join(roleLeaves.map(leaf => sql`
    (select ${parentOfLeaf(leaf, sql`"the_leaf"`)} from ${leaf.table} as "the_leaf" where "the_leaf".${leaf.id} = "the_user_id"),`), ``)}
    "the_user_id"
  );
end
$$ language plpgsql stable ${definer(naming)};

${grantExecute(sql`${currentRoleNodeFunction} (${idType})`, users)}
`;

  // A (user, resource) pair has a bit iff some path role -> assignment -> resource has that bit on every edge.
  // Each cache stores the OR over paths of its own segment, so checking the bit segment by segment is exact.
  const accessCheck = (target: SQL, bit: number | SQL) => {
    switch (config.engine.combineAssignmentsWith) {
      case "role": return sql`
  exists (
    select
      1
    from
      ${resource.edgeCache} "var_resource_edge",
      ${assignment.edgeCache} "var_assignment_edge"
    where
      -- Access chain exists
      ${target} = "var_resource_edge".${resource.childId} and
      "var_resource_edge".${resource.parentId} = "var_assignment_edge".${assignment.resourceId} and
      "var_assignment_edge".${assignment.roleId} = ${currentUserId} and
      -- With correct permission bit
      ${hasBit("var_resource_edge", resource.permission, bit)} and
      ${hasBit("var_assignment_edge", assignment.permission, bit)}
  )`;
      case "resource": return sql`
  exists (
    select
      1
    from
      ${assignment.edgeCache} "var_assignment_edge",
      ${role.edgeCache} "var_role_edge"
    where
      -- Access chain exists
      ${target} = "var_assignment_edge".${assignment.resourceId} and
      "var_assignment_edge".${assignment.roleId} = "var_role_edge".${role.parentId} and
      "var_role_edge".${role.childId} = ${currentUserId} and
      -- With correct permission bit
      ${hasBit("var_assignment_edge", assignment.permission, bit)} and
      ${hasBit("var_role_edge", role.permission, bit)}
  )`;
      default: return sql`
  exists (
    select
      1
    from
      ${resource.edgeCache} "var_resource_edge",
      ${assignment.edge} "var_assignment_edge",
      ${role.edgeCache} "var_role_edge"
    where
      -- Access chain exists
      ${target} = "var_resource_edge".${resource.childId} and
      "var_resource_edge".${resource.parentId} = "var_assignment_edge".${assignment.resourceId} and
      "var_assignment_edge".${assignment.roleId} = "var_role_edge".${role.parentId} and
      "var_role_edge".${role.childId} = ${currentUserId} and
      -- With correct permission bit
      ${hasBit("var_resource_edge", resource.permission, bit)} and
      ${hasBit("var_assignment_edge", assignment.permission, bit)} and
      ${hasBit("var_role_edge", role.permission, bit)}
  )`;
    }
  };

  // Policies read the parent table through this lookup, so that its own policies do not apply. A table whose parent
  // is a row of the same table would otherwise recurse into its own policies.
  const parentFunctions = join(nodeBindings.filter(binding => binding.parent?.lookup).map(binding => {
    const { column, lookup, function: lookupFunction } = binding.parent!;
    return sql`
create or replace function ${lookupFunction} ("the_key" ${binding.table}.${column}%type)
  returns ${idType}
  as $$
  select "the_parent".${lookup!.id} from ${lookup!.table} as "the_parent" where "the_parent".${lookup!.key} = $1
$$ language sql stable ${definer(naming)};

${grantExecute(sql`${lookupFunction} (${binding.table}.${column}%type)`, users)}
`;
  }), `\n`);

  // Moving a row is inserting it under its new parent, unless that parent already links to it. In plpgsql, so that
  // policies calling it are not planned with its queries on every update
  const hasParents = nodeBindings.some(binding => binding.parent);
  const parentValidate = hasParents ? sql`
create or replace function ${resource.parentValidateFunction} ("the_parent" ${idType}, "the_child" ${idType}, "the_insert_bit" integer)
  returns boolean
  as $$
begin
  return "the_parent" is null
    or exists (select from ${resource.edge} as "var_edge" where "var_edge".${resource.parentId} = "the_parent" and "var_edge".${resource.childId} = "the_child")
    or ("the_insert_bit" is not null and ${accessCheck(sql`"the_parent"`, sql`"the_insert_bit"`)});
end
$$ language plpgsql stable;

${grantExecute(sql`${resource.parentValidateFunction} (${idType}, ${idType}, integer)`, users)}
` : sql``;

  return sql`
-----------------------------------------------------------------------------------------------------------------------
-- Table policies
-----------------------------------------------------------------------------------------------------------------------
${currentRoleNode}
${parentFunctions}
${parentValidate}

${join(config.tables.flatMap(table => {
    const tableNaming = naming.tables[table.name];
    if (!tableNaming) {
      throw new Error(`Table naming config not found for table: ${table.name}`);
    }
    const binding = bindings.get(table.name);
    return config.engine.users.flatMap(user => {
      return (["select", "insert", "update", "delete"] as const).flatMap(operation => {
        const { schema, name, resourceId, permission } = tableNaming;
        const userBits = table.permission?.[user];
        if (!table.isResource || userBits == null || userBits[operation] == null) {
          return [];
        }
        const policyName = (permission as any)[user][operation];
        const dropPolicy = sql`drop policy if exists ${policyName} on ${schema}.${name};`;
        const bit = userBits[operation];
        const insertBit = userBits.insert;
        const parent = binding?.parent && (table.resourceLeaf ? parentOfLeaf(binding, name) : parentOfInPolicy(binding, name));
        // A leaf row has the permissions of its parent. Moving one needs the bit on both parents, since the new row
        // cannot be told apart from an update that keeps its parent.
        const ownCheck = accessCheck(table.resourceLeaf ? parent! : sql`${name}.${resourceId}`, bit);
        // A new row has no permissions of its own yet: it gets them from its parent, so only a row with a parent can
        // be inserted, by users allowed to insert under that parent
        if (operation === "insert") {
          if (!parent) {
            return [dropPolicy];
          }
          return [sql`
${dropPolicy}
create policy ${policyName} on ${schema}.${name}
as permissive for insert to ${identifier(user)}
with check (${accessCheck(parent, bit)}
);
`];
        }
        const moveCheck = parent && !table.resourceLeaf && sql`
  and ${resource.parentValidateFunction}(${parent}, ${name}.${resourceId}, ${insertBit == null ? sql`null` : literal(insertBit)})`;
        return [sql`
${dropPolicy}
create policy ${policyName} on ${schema}.${name} 
as permissive for ${join([sql``, sql``], operation) /* Yeah it's hacky I know */} to ${identifier(user)} 
using (${ownCheck}
)
${operation === "update" ? sql`with check (${ownCheck}${moveCheck || sql``}
)` : sql``};
`];
      });
    });
  }),
    `\n`)}
    
-----------------------------------------------------------------------------------------------------------------------
-- Enable RLS on tables
-----------------------------------------------------------------------------------------------------------------------
${join(config.tables.flatMap(table => {
      const tableNaming = naming.tables[table.name];
      if (!tableNaming) {
        throw new Error(`Table naming config not found for table: ${table.name}`);
      }
      const { schema, name } = tableNaming;
      if (!table.isResource) {
        return [];
      }
      return [sql`
  alter table ${schema}.${name} enable row level security;
  `];
    }), `\n`)}
${roleLeaves.length === 0 ? sql`drop function if exists ${currentRoleNodeFunction} (${idType});` : sql``}
    `;
}
