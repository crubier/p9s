
// To get syntax highlighting in VSCode with the qufiwefefwoyn.inline-sql-syntax extension
import { type SQL, query as sql, join, literal, identifier, compile, raw } from "pg-sql2";
import { getCompleteConfig, getNaming } from "@p9s/core";
import type { CompleteConfig, Naming, Config } from "@p9s/core";


export const createMigration = <User extends string>(config: Config<User>) => {
  const completeConfig = getCompleteConfig(config);
  const naming = getNaming(completeConfig);

  const result = sql`
  ${createMigrationPreamble(naming, completeConfig)}

  ${createMigrationExtensions(naming, completeConfig)}

  ${createMigrationAggregates(naming, completeConfig)}

  ${createMigrationResourceOrRole("resource", naming, completeConfig)}

  ${createMigrationResourceOrRole("role", naming, completeConfig)}

  ${createMigrationAssignments(naming, completeConfig)}

  ${createMigrationDataModelBindings(naming, completeConfig)}

  ${createMigrationDataModelPolicies(naming, completeConfig)}

  ${createMigrationCleanup(naming, completeConfig)}

  `
  return result;
}


const getIdType = (config: CompleteConfig<any>) => {
  return {
    "uuid": {
      type: sql`uuid`,
      declaration: sql`uuid unique not null default uuid_generate_v4()`,
      extension: sql`create extension if not exists "uuid-ossp";`,
    },
    "integer": {
      type: sql`integer`,
      declaration: sql`serial unique not null`,
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

const roleArray = (roles: string[]) => sql`array[${join(roles.map(textLiteral), ", ")}]::text[]`;

// Tables are passed as a regclass literal so the helper can look up their owner and serial sequences
const setPrivileges = (target: SQL, readRoles: string[], writeRoles: string[]) =>
  sql`select pg_temp.p9s_set_privileges(${textLiteral(compile(target).text)}::regclass, ${roleArray(readRoles)}, ${roleArray(writeRoles)});`;

const grantExecute = (fn: SQL, roles: string[]) => sql`
revoke execute on function ${fn} from public;
${join(roles.map(role => sql`grant execute on function ${fn} to ${identifier(role)};`), `\n`)}`;

const definer = (naming: Naming<any>) => sql`security definer set search_path = ${naming.schema}, pg_temp`;

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

// `offset 0` stops the planner from turning this into a semi-join: it overestimates the rows returned by the
// recursive compute functions, and would then hash or scan the whole node table on every graph write
const nodeExists = (node: SQL, id: SQL, value: SQL) => sql`exists (select 1 from ${node} where ${node}.${id} = ${value} offset 0)`;

// Kept as a hashed subplan. A plain `in` in a where clause becomes a semi-join, and with hash joins disabled that
// rescans the whole subquery for every outer row.
const isIn = (value: SQL, subquery: SQL) => sql`(${value} in (${subquery})) is true`;

type TriggerEvent = "insert" | "update" | "delete";

// Statement triggers see the changed rows as "p9s_old_rows" and "p9s_new_rows". They also fire when no row changed,
// for example on a foreign key cascade with nothing to cascade to, which must not take the lock or check isolation.
const statementTrigger = (naming: Naming<any>, config: CompleteConfig<any>, functionName: SQL, triggerName: SQL, table: SQL, event: TriggerEvent, body: SQL, settings = sql``) => sql`
create or replace function ${functionName}()
returns trigger as $$
begin
  if not exists (select from ${event === "delete" ? sql`"p9s_old_rows"` : sql`"p9s_new_rows"`}) then
    return null;
  end if;
  ${lockGraph(config)}
${body}
  return null;
end;
$$ language plpgsql ${definer(naming)}${settings};

${grantExecute(sql`${functionName} ()`, [])}

drop trigger if exists ${triggerName} on ${table};
create trigger ${triggerName}
after ${{ insert: sql`insert`, update: sql`update`, delete: sql`delete` }[event]} on ${table}
referencing ${{ insert: sql`new table as "p9s_new_rows"`, update: sql`old table as "p9s_old_rows" new table as "p9s_new_rows"`, delete: sql`old table as "p9s_old_rows"` }[event]}
for each statement execute function ${functionName}();
`;


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
  const { orBitmap } = naming;
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
`;
}


export const createMigrationResourceOrRole = <User extends string>(resourceOrRole: "resource" | "role", naming: Naming<User>, config: CompleteConfig<User>) => {
  const { node, id, pkey, edge, parentId, childId, permission, edgePkey, parentFkey, childFkey,
    edgeParentIdIndex, edgeChildIdIndex, edgeCache, edgeCachePkey, edgeCacheParentFkey, edgeCacheChildFkey,
    edgeCacheParentIdIndex, edgeCacheChildIdIndex, edgeCacheParentCompute, edgeCacheChildCompute, varParentId, varChildId, edgeCacheView,
    edgeCacheBackfill,
    edgeInsertTriggerFunction, edgeInsertTrigger, edgeUpdateTriggerFunction, edgeUpdateTrigger, edgeDeleteTriggerFunction, edgeDeleteTrigger,
    nodeInsertTriggerFunction, nodeInsertTrigger, nodeUpdateTriggerFunction, nodeUpdateTrigger, nodeDeleteTriggerFunction, nodeDeleteTrigger, enableTriggerFunction, disableTriggerFunction
  } = naming[resourceOrRole];
  const size = config.engine.permission.bitmap.size;
  const maxDepth = config.engine.permission.maxDepth[resourceOrRole];
  const { type: idType, declaration: idDeclaration } = getIdType(config);
  const { orBitmap } = naming;
  const { users, writers, everyone } = getRoles(config);
  const ones = sql`~ b'0'::bit(${literal(size)})`;

  // A cache row (ancestor, descendant) can only change when a changed edge parent -> child lies on one of its paths,
  // before or after the change. Its descendant is then the child or below it, an "affected" node. Its ancestor reaches
  // the parent of the first changed edge on that path through unchanged edges, so it is an "upstream" node: a changed
  // parent or one of their ancestors after the change. The rows ending at a node outside the affected set are the same
  // before and after the change, so the walk from an affected node towards its ancestors stops at the first node
  // outside the affected set and reuses that node's cache rows. Only rows whose value differs are written: unchanged
  // rows would still be locked by the upsert, and the combined assignment cache triggers recompute everything written.
  const refreshAffected = ({ parents, children }: { parents: SQL, children: SQL }) => sql`
  with recursive "affected" (${id}) as (
    (${children})
    union
    select "the_edge".${childId}
    from ${edge} as "the_edge"
    join "affected" on "the_edge".${parentId} = "affected".${id}
  ),
  "upstream" (${id}) as (
    (${parents})
    union
    select "the_edge".${parentId}
    from ${edge} as "the_edge"
    join "upstream" on "the_edge".${childId} = "upstream".${id}
  ),
  "walk" (${parentId}, ${childId}, ${permission}, "inside", "depth", "path") as (
    select "affected".${id}, "affected".${id}, ${ones}, true, 0, array["affected".${id}]
    from "affected"
    union all
    select
      "the_edge".${parentId},
      "walk".${childId},
      ("walk".${permission} & "the_edge".${permission})::bit(${literal(size)}), -- bitwise "and" on permission along a path
      "the_edge".${parentId} in (select ${id} from "affected"),
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
      and ${isIn(sql`"walk".${parentId}`, sql`select ${id} from "upstream"`)}
      union all
      select "the_edge_cache".${parentId}, "walk".${childId}, ("the_edge_cache".${permission} & "walk".${permission})::bit(${literal(size)})
      from "walk"
      join ${edgeCache} as "the_edge_cache" on "the_edge_cache".${childId} = "walk".${parentId}
      where not "walk"."inside"
      and ${isIn(sql`"the_edge_cache".${parentId}`, sql`select ${id} from "upstream"`)}
    ) as "the_path"
    -- When a node is deleted, its own delete trigger runs before the foreign key cascades to its edges, whose
    -- triggers would otherwise re-add cache rows (including its self edge) that reference the deleted node
    where ${nodeExists(node, id, sql`"the_path".${parentId}`)}
    and ${nodeExists(node, id, sql`"the_path".${childId}`)}
    group by ("the_path".${parentId}, "the_path".${childId})
  ),
  "stale" as (
    delete from ${edgeCache}
    where ${edgeCache}.${childId} in (select ${id} from "affected")
    and ${isIn(sql`${edgeCache}.${parentId}`, sql`select ${id} from "upstream"`)}
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
  // The planner has no estimate for recursive queries and assumes many affected nodes, so it hashes the whole edge
  // and cache tables when a few index lookups would do. Index lookups stay proportional to the rows actually touched.
  const indexLookupsOnly = sql`
set enable_hashjoin = off
set enable_mergejoin = off`;
  const edgeTrigger = (functionName: SQL, triggerName: SQL, event: TriggerEvent) =>
    statementTrigger(naming, config, functionName, triggerName, edge, event, refreshAffected(changed[event]), indexLookupsOnly);

  return sql`
-----------------------------------------------------------------------------------------------------------------------
-- ${literal(resourceOrRole)} node table
-----------------------------------------------------------------------------------------------------------------------
create table if not exists ${node} (
  ${id} ${idDeclaration},
  constraint ${pkey} primary key (${id})
);

${setPrivileges(node, users, writers)}

-----------------------------------------------------------------------------------------------------------------------
-- ${literal(resourceOrRole)} edge table
-----------------------------------------------------------------------------------------------------------------------
create table if not exists ${edge} (
  ${parentId} ${idType} not null,
  ${childId} ${idType} not null,
  ${permission} bit(${literal(size)}),
  constraint ${edgePkey} primary key (${parentId}, ${childId}),
  constraint ${parentFkey} foreign key (${parentId}) references ${node} (${id}) on delete cascade on update cascade,
  constraint ${childFkey} foreign key (${childId}) references ${node} (${id}) on delete cascade on update cascade
);

create index if not exists ${edgeParentIdIndex} on ${edge} (${parentId});

create index if not exists ${edgeChildIdIndex} on ${edge} (${childId});

${setPrivileges(edge, users, writers)}

-----------------------------------------------------------------------------------------------------------------------
-- ${literal(resourceOrRole)} transitive edge cache table
-----------------------------------------------------------------------------------------------------------------------
create table if not exists ${edgeCache} (
  ${parentId} ${idType} not null,
  ${childId} ${idType} not null,
  ${permission} bit(${literal(size)}),
  constraint ${edgeCachePkey} primary key (${parentId}, ${childId})
);

-- Cache rows are derived data, they go away with their nodes
alter table ${edgeCache} drop constraint if exists ${edgeCacheParentFkey};
alter table ${edgeCache} add constraint ${edgeCacheParentFkey} foreign key (${parentId}) references ${node} (${id}) on delete cascade on update cascade;
alter table ${edgeCache} drop constraint if exists ${edgeCacheChildFkey};
alter table ${edgeCache} add constraint ${edgeCacheChildFkey} foreign key (${childId}) references ${node} (${id}) on delete cascade on update cascade;

create index if not exists ${edgeCacheParentIdIndex} on ${edgeCache} (${parentId});

create index if not exists ${edgeCacheChildIdIndex} on ${edgeCache} (${childId});

-- Only p9s triggers write to the cache
${setPrivileges(edgeCache, everyone, [])}

-----------------------------------------------------------------------------------------------------------------------
-- ${literal(resourceOrRole)} compute recursive permissions, towards parent
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
-- ${literal(resourceOrRole)} compute recursive permissions, towards child
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

-----------------------------------------------------------------------------------------------------------------------
-- ${literal(resourceOrRole)} view of all transitive edges. 
-----------------------------------------------------------------------------------------------------------------------
-- This direction is easy, since we have less parents than children in general
create or replace view ${edgeCacheView} as
select
  "parent_permissions".${parentId} as ${parentId},
  "parent_permissions".${childId} as ${childId},
  "parent_permissions".${permission} as ${permission}
from
  ${node} as "the_node",
  lateral ${edgeCacheParentCompute} ("the_node".${id}) as "parent_permissions";

${setPrivileges(edgeCacheView, everyone, [])}

-----------------------------------------------------------------------------------------------------------------------
-- ${literal(resourceOrRole)} function to rebuild the cache from scratch
-----------------------------------------------------------------------------------------------------------------------
create or replace function ${edgeCacheBackfill} ()
  returns setof ${edgeCache}
  as $$
begin
  ${lockGraphStatement(config)}
  -- Backfills usually follow a bulk load, before autovacuum has gathered statistics. Without them the planner can
  -- seq scan the edge table at every step of the recursive walk, which is quadratic in the number of edges.
  -- This has to be plpgsql: a sql function plans every statement before running the first one.
  analyze ${node};
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
-- ${literal(resourceOrRole)} Update cache when edges change
-----------------------------------------------------------------------------------------------------------------------
${edgeTrigger(edgeInsertTriggerFunction, edgeInsertTrigger, "insert")}
${edgeTrigger(edgeUpdateTriggerFunction, edgeUpdateTrigger, "update")}
${edgeTrigger(edgeDeleteTriggerFunction, edgeDeleteTrigger, "delete")}

-----------------------------------------------------------------------------------------------------------------------
-- ${literal(resourceOrRole)} Update cache when insert node
-----------------------------------------------------------------------------------------------------------------------

create or replace function ${nodeInsertTriggerFunction}()
returns trigger as $$
begin
  -- Add self reference to cache, a node has full access to itself
  insert into ${edgeCache} (${parentId}, ${childId}, ${permission})
  values (new.${id}, new.${id}, ~ b'0'::bit(${literal(size)}))
  on conflict on constraint ${edgeCachePkey}
  do update set ${permission} = excluded.${permission};

  return null;
end;
$$ language plpgsql ${definer(naming)};

${grantExecute(sql`${nodeInsertTriggerFunction} ()`, [])}

drop trigger if exists ${nodeInsertTrigger} on ${node};
create trigger ${nodeInsertTrigger}
after insert on ${node}
for each row execute function ${nodeInsertTriggerFunction}();

-----------------------------------------------------------------------------------------------------------------------
-- ${literal(resourceOrRole)} Update cache when update node
-----------------------------------------------------------------------------------------------------------------------

create or replace function ${nodeUpdateTriggerFunction}()
returns trigger as $$
begin
  -- Update self reference in cache, a node has full access to itself
  update ${edgeCache}
  set ${parentId} = new.${id}, ${childId} = new.${id}
  where ${parentId} = old.${id} and ${childId} = old.${id};

  return null;
end;
$$ language plpgsql ${definer(naming)};

${grantExecute(sql`${nodeUpdateTriggerFunction} ()`, [])}


drop trigger if exists ${nodeUpdateTrigger} on ${node};
create trigger ${nodeUpdateTrigger}
after update on ${node}
for each row execute function ${nodeUpdateTriggerFunction}();

-----------------------------------------------------------------------------------------------------------------------
-- ${literal(resourceOrRole)} Update cache when delete node
-----------------------------------------------------------------------------------------------------------------------

create or replace function ${nodeDeleteTriggerFunction}()
returns trigger as $$
begin
  -- Remove self reference from cache
  delete from ${edgeCache}
  where ${parentId} = old.${id} and ${childId} = old.${id};

  return null;
end;
$$ language plpgsql ${definer(naming)};

${grantExecute(sql`${nodeDeleteTriggerFunction} ()`, [])}


drop trigger if exists ${nodeDeleteTrigger} on ${node};
create trigger ${nodeDeleteTrigger}
after delete on ${node}
for each row execute function ${nodeDeleteTriggerFunction}();


-----------------------------------------------------------------------------------------------------------------------
-- ${literal(resourceOrRole)} actually do bootstrap cache
-----------------------------------------------------------------------------------------------------------------------
select 1 from ${edgeCacheBackfill}();


-----------------------------------------------------------------------------------------------------------------------
-- ${literal(resourceOrRole)} functions to enable / disable triggers
-----------------------------------------------------------------------------------------------------------------------
create or replace function ${enableTriggerFunction}()
returns void as $$
  alter table ${edge} enable trigger ${edgeInsertTrigger};
  alter table ${edge} enable trigger ${edgeUpdateTrigger};
  alter table ${edge} enable trigger ${edgeDeleteTrigger};
  alter table ${node} enable trigger ${nodeInsertTrigger};
  alter table ${node} enable trigger ${nodeUpdateTrigger};
  alter table ${node} enable trigger ${nodeDeleteTrigger};
  -- Backfill cache
  select 1 from ${edgeCacheBackfill}();
$$ language sql ${definer(naming)};

${grantExecute(sql`${enableTriggerFunction} ()`, writers)}

create or replace function ${disableTriggerFunction}()
returns void as $$
  alter table ${edge} disable trigger ${edgeInsertTrigger};
  alter table ${edge} disable trigger ${edgeUpdateTrigger};
  alter table ${edge} disable trigger ${edgeDeleteTrigger};
  alter table ${node} disable trigger ${nodeInsertTrigger};
  alter table ${node} disable trigger ${nodeUpdateTrigger};
  alter table ${node} disable trigger ${nodeDeleteTrigger};
$$ language sql ${definer(naming)};

${grantExecute(sql`${disableTriggerFunction} ()`, writers)}
`;
}


export const createMigrationAssignments = <User extends string>(naming: Naming<User>, config: CompleteConfig<User>) => {
  const { resource, role, permission, orBitmap } = naming;
  const size = config.engine.permission.bitmap.size;
  const {
    edge, resourceId, roleId, edgePkey, resourceFkey, roleFkey, edgeResourceIdIndex, edgeRoleIdIndex,
    edgeCacheView, edgeCacheBackfill, edgeCache, edgeCachePkey,
    edgeCacheResourceFkey,
    edgeCacheRoleFkey,
    edgeCacheResourceIdIndex,
    edgeCacheRoleIdIndex, enableTriggerFunction, disableTriggerFunction,
    edgeInsertTriggerFunction,
    edgeInsertTrigger,
    edgeUpdateTriggerFunction,
    edgeUpdateTrigger,
    edgeDeleteTriggerFunction,
    edgeDeleteTrigger,
    combinedEdgeInsertTriggerFunction,
    combinedEdgeInsertTrigger,
    combinedEdgeUpdateTriggerFunction,
    combinedEdgeUpdateTrigger,
    combinedEdgeDeleteTriggerFunction,
    combinedEdgeDeleteTrigger
  } = naming.assignment;
  const { type: idType } = getIdType(config);
  const { users, writers, everyone } = getRoles(config);
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

  const getCombinedCacheBlock = (resourceOrRole: "role" | "resource") => {
    const thingCombinedWith = naming[resourceOrRole];
    const thingNotCombinedWith = naming[resourceOrRole == "role" ? "resource" : "role"];
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

    // Rows of nodes being deleted must not be re-added while foreign key cascades are still in flight
    const nodesExist = sql`${nodeExists(thingCombinedWith.node, thingCombinedWith.id, sql`"the_edge_cache".${thingCombinedWith.childId}`)}
      and ${nodeExists(thingNotCombinedWith.node, thingNotCombinedWith.id, sql`"the_assignment".${thingNotCombinedWithId}`)}`;
    const byAssignment = (keys: SQL) => recompute(thingNotCombinedWithId, k => sql`"the_assignment".${thingNotCombinedWithId} in (${k}) and ${nodesExist}`, keys);
    const byEdgeCache = (keys: SQL) => recompute(thingCombinedWithId, k => sql`"the_edge_cache".${thingCombinedWith.childId} in (${k}) and ${nodesExist}`, keys);

    const newAssignments = sql`select ${thingNotCombinedWithId} from "p9s_new_rows"`;
    const oldAssignments = sql`select ${thingNotCombinedWithId} from "p9s_old_rows"`;
    const newEdgeCaches = sql`select ${thingCombinedWith.childId} from "p9s_new_rows"`;
    const oldEdgeCaches = sql`select ${thingCombinedWith.childId} from "p9s_old_rows"`;

    const trigger = (functionName: SQL, triggerName: SQL, table: SQL, event: TriggerEvent, body: SQL) =>
      statementTrigger(naming, config, functionName, triggerName, table, event, body);

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

-- Cache rows are derived data, they go away with their nodes
alter table ${edgeCache} drop constraint if exists ${edgeCacheRoleFkey};
alter table ${edgeCache} add constraint ${edgeCacheRoleFkey} foreign key (${roleId}) references ${role.node} (${role.id}) on delete cascade on update cascade;
alter table ${edgeCache} drop constraint if exists ${edgeCacheResourceFkey};
alter table ${edgeCache} add constraint ${edgeCacheResourceFkey} foreign key (${resourceId}) references ${resource.node} (${resource.id}) on delete cascade on update cascade;

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
  return query
  insert into ${edgeCache} (${roleId}, ${resourceId}, ${permission})
  select ${roleId}, ${resourceId}, ${permission}
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
-- Update cache when assignments change
-----------------------------------------------------------------------------------------------------------------------
${trigger(edgeInsertTriggerFunction, edgeInsertTrigger, edge, "insert", byAssignment(newAssignments))}
${trigger(edgeUpdateTriggerFunction, edgeUpdateTrigger, edge, "update", byAssignment(sql`${oldAssignments} union ${newAssignments}`))}
${trigger(edgeDeleteTriggerFunction, edgeDeleteTrigger, edge, "delete", byAssignment(oldAssignments))}

-----------------------------------------------------------------------------------------------------------------------
-- Update cache when the ${literal(resourceOrRole)} transitive edge cache changes
-----------------------------------------------------------------------------------------------------------------------
${trigger(combinedEdgeInsertTriggerFunction, combinedEdgeInsertTrigger, thingCombinedWith.edgeCache, "insert", byEdgeCache(newEdgeCaches))}
${trigger(combinedEdgeUpdateTriggerFunction, combinedEdgeUpdateTrigger, thingCombinedWith.edgeCache, "update", byEdgeCache(sql`${oldEdgeCaches} union ${newEdgeCaches}`))}
${trigger(combinedEdgeDeleteTriggerFunction, combinedEdgeDeleteTrigger, thingCombinedWith.edgeCache, "delete", byEdgeCache(oldEdgeCaches))}

-----------------------------------------------------------------------------------------------------------------------
-- Assignment actually do bootstrap cache
-----------------------------------------------------------------------------------------------------------------------
select 1 from ${edgeCacheBackfill}();

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
-- Assignment from role to resource
-----------------------------------------------------------------------------------------------------------------------
create table if not exists ${edge} (
  ${resourceId} ${idType} not null,
  ${roleId} ${idType} not null,
  ${permission} bit(${literal(size)}),
  constraint ${edgePkey} primary key (${resourceId}, ${roleId}),
  constraint ${resourceFkey} foreign key (${resourceId}) references ${resource.node} (${resource.id}) on delete cascade on update cascade,
  constraint ${roleFkey} foreign key (${roleId}) references ${role.node} (${role.id}) on delete cascade on update cascade
);

create index if not exists ${edgeResourceIdIndex} on ${edge} (${resourceId});

create index if not exists ${edgeRoleIdIndex} on ${edge} (${roleId});

${setPrivileges(edge, users, writers)}

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


export const createMigrationDataModelBindings = <User extends string>(naming: Naming<User>, config: CompleteConfig<User>) => {
  const { type: idType } = getIdType(config);

  // Existing rows get a fresh node each, so the column can be made not null without dropping data
  const bindColumn = (schema: SQL, name: SQL, column: SQL, fkey: SQL, target: Naming<User>["resource"]) => sql`
alter table ${schema}.${name} add column if not exists ${column} ${idType} unique;
do $$
declare
  "the_row" record;
  "the_id" ${idType};
begin
  for "the_row" in select ctid from ${schema}.${name} where ${column} is null loop
    insert into ${target.node} default values returning ${target.id} into "the_id";
    update ${schema}.${name} set ${column} = "the_id" where ctid = "the_row".ctid;
  end loop;
end
$$;
alter table ${schema}.${name} alter column ${column} set not null;
alter table ${schema}.${name} drop constraint if exists ${fkey} cascade;
alter table ${schema}.${name} add constraint ${fkey} foreign key (${column}) references ${target.node} (${target.id}) on delete cascade on update cascade;
`;

  return sql`
-----------------------------------------------------------------------------------------------------------------------
-- Table bindings
-----------------------------------------------------------------------------------------------------------------------
${join(config.tables.map(table => {
    const tableNaming = naming.tables[table.name];
    if (!tableNaming) {
      throw new Error(`Table naming config not found for table: ${table.name}`);
    }
    const { schema, name, resourceId, resourceFkey, roleId, roleFkey } = tableNaming;
    const { resource, role } = naming;
    const resourceBlock = table.isResource ? bindColumn(schema, name, resourceId, resourceFkey, resource) : sql``;
    const roleBlock = table.isRole ? bindColumn(schema, name, roleId, roleFkey, role) : sql``;
    return sql`
  ${resourceBlock}

  ${roleBlock}
  `;
  }), `\n`)}
  `

}


export const createMigrationDataModelPolicies = <User extends string>(naming: Naming<User>, config: CompleteConfig<User>) => {
  const { resource, role, assignment } = naming;
  const currentUserId = sql`${identifier(config.engine.authentication.getCurrentUserId)}()`;
  const hasBit = (alias: string, column: SQL, bit: number) => sql`(${identifier(alias)}.${column} << ${literal(bit)})::bit = b'1'`;

  // A (user, resource) pair has a bit iff some path role -> assignment -> resource has that bit on every edge.
  // Each cache stores the OR over paths of its own segment, so checking the bit segment by segment is exact.
  const accessCheck = (target: SQL, bit: number) => {
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

  return sql`
-----------------------------------------------------------------------------------------------------------------------
-- Table policies
-----------------------------------------------------------------------------------------------------------------------
${join(config.tables.flatMap(table => {
    const tableNaming = naming.tables[table.name];
    if (!tableNaming) {
      throw new Error(`Table naming config not found for table: ${table.name}`);
    }
    return config.engine.users.flatMap(user => {
      return (["select", "insert", "update", "delete"] as const).flatMap(operation => {
        const { schema, name, resourceId, permission } = tableNaming;
        if (!table.isResource || table.permission[user] == null || table.permission[user][operation] == null) {
          return [];
        }
        const bit = table.permission[user][operation];
        const check = accessCheck(sql`${name}.${resourceId}`, bit);
        return [sql`
drop policy if exists ${(permission as any)[user][operation]} on ${schema}.${name};
create policy ${(permission as any)[user][operation]} on ${schema}.${name} 
as permissive for ${join([sql``, sql``], operation) /* Yeah it's hacky I know */} to ${identifier(user)} 
${["select", "update", "delete"].includes(operation) ? sql`using (${check}
)`: sql``}
${["insert", "update"].includes(operation) ? sql`with check (${check}
)`: sql``};
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
    `;
}
