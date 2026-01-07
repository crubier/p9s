
// To get syntax highlighting in VSCode with the qufiwefefwoyn.inline-sql-syntax extension
import { type SQL, query as sql, join, literal, identifier } from "pg-sql2";
import { getCompleteConfig, getNaming } from "../core/configuration";
import type { CompleteConfig, Naming, Config } from "../core/configuration";


export const createMigration = <User extends string>(config: Config<User>) => {
  const completeConfig = getCompleteConfig(config);
  const naming = getNaming(completeConfig);
  // const users = completeConfig.engine.config.engine.users.map(user => sql.identifier(user));

  const result = sql`
  ${createMigrationExtensions(naming, completeConfig)}

  ${createMigrationAggregates(naming, completeConfig)}

  ${createMigrationResourceOrRole("resource", naming, completeConfig)}

  ${createMigrationResourceOrRole("role", naming, completeConfig)}

  ${createMigrationAssignments(naming, completeConfig)}

  ${createMigrationDataModelBindings(naming, completeConfig)}

  ${createMigrationDataModelPolicies(naming, completeConfig)}

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


export const createMigrationExtensions = <User extends string>(naming: Naming<User>, config: CompleteConfig<User>) => {
  return getIdType(config).extension;
}


export const createMigrationAggregates = <User extends string>(naming: Naming<User>, config: CompleteConfig<User>) => {
  const { orBitmap } = naming;

  const size = config.engine.permission.bitmap.size;

  return sql`
-----------------------------------------------------------------------------------------------------------------------
-- Special functions
-----------------------------------------------------------------------------------------------------------------------
drop aggregate if exists ${orBitmap} (bit);

create aggregate ${orBitmap} (
  basetype = bit,
  sfunc = bitor,
  stype = bit,
  initcond = ${literal(`0`.repeat(size))}
);

${join(config.engine.users.map(user => sql`grant execute on function ${orBitmap} (bit) to ${identifier(user)};`), `\n`)}
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

  return sql`
-----------------------------------------------------------------------------------------------------------------------
-- ${literal(resourceOrRole)} node table
-----------------------------------------------------------------------------------------------------------------------
drop table if exists ${node} cascade;

create table ${node} (
  ${id} ${idDeclaration},
  constraint ${pkey} primary key (${id})
);

${join(config.engine.users.map(user => sql`grant select, insert, update, delete on table ${node} to ${identifier(user)};`), `\n`)}

-----------------------------------------------------------------------------------------------------------------------
-- ${literal(resourceOrRole)} edge table
-----------------------------------------------------------------------------------------------------------------------
drop table if exists ${edge} cascade;

create table ${edge} (
  ${parentId} ${idType} not null,
  ${childId} ${idType} not null,
  ${permission} bit(${literal(size)}),
  constraint ${edgePkey} primary key (${parentId}, ${childId}),
  constraint ${parentFkey} foreign key (${parentId}) references ${node} (${id}) on delete cascade on update cascade,
  constraint ${childFkey} foreign key (${childId}) references ${node} (${id}) on delete cascade on update cascade
);

create index if not exists ${edgeParentIdIndex} on ${edge} (${parentId});

create index if not exists ${edgeChildIdIndex} on ${edge} (${childId});

${join(config.engine.users.map(user => sql`grant select, insert, update, delete on table ${edge} to ${identifier(user)};`), `\n`)}

-----------------------------------------------------------------------------------------------------------------------
-- ${literal(resourceOrRole)} transitive edge cache table
-----------------------------------------------------------------------------------------------------------------------
drop table if exists ${edgeCache} cascade;

create table ${edgeCache} (
  ${parentId} ${idType} not null,
  ${childId} ${idType} not null,
  ${permission} bit(${literal(size)}),
  constraint ${edgeCachePkey} primary key (${parentId}, ${childId}),
  constraint ${edgeCacheParentFkey} foreign key (${parentId}) references ${node} (${id}),
  constraint ${edgeCacheChildFkey} foreign key (${childId}) references ${node} (${id})
);

create index if not exists ${edgeCacheParentIdIndex} on ${edgeCache} (${parentId});

create index if not exists ${edgeCacheChildIdIndex} on ${edgeCache} (${childId});

${join(config.engine.users.map(user => sql`grant select, insert, update, delete on table ${edgeCache} to ${identifier(user)};`), `\n`)}

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

${join(config.engine.users.map(user => sql`grant execute on function ${edgeCacheParentCompute} (${varChildId} ${idType}) to ${identifier(user)};`), `\n`)}

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

${join(config.engine.users.map(user => sql`grant execute on function ${edgeCacheChildCompute} (${varParentId} ${idType}) to ${identifier(user)};`), `\n`)}

-----------------------------------------------------------------------------------------------------------------------
-- ${literal(resourceOrRole)} view of all transitive edges. 
-----------------------------------------------------------------------------------------------------------------------
-- This direction is easy, since we have less parents than children in general
create view ${edgeCacheView} as
select
  "parent_permissions".${parentId} as ${parentId},
  "parent_permissions".${childId} as ${childId},
  "parent_permissions".${permission} as ${permission}
from
  ${node} as "the_node",
  lateral ${edgeCacheParentCompute} ("the_node".${id}) as "parent_permissions";

${join(config.engine.users.map(user => sql`grant select on table ${edgeCacheView} to ${identifier(user)};`), `\n`)}

-----------------------------------------------------------------------------------------------------------------------
-- ${literal(resourceOrRole)} function to create the cache
-----------------------------------------------------------------------------------------------------------------------
create or replace function ${edgeCacheBackfill} ()
  returns setof ${edgeCache}
  as $$
  insert into ${edgeCache} (${parentId}, ${childId}, ${permission})
  select ${parentId}, ${childId}, ${permission}
  from
    ${edgeCacheView}
  on conflict on constraint ${edgeCachePkey}
    do update set
      ${permission} = excluded.${permission}
    returning
      *
$$
language sql
volatile;

${join(config.engine.users.map(user => sql`grant execute on function ${edgeCacheBackfill} () to ${identifier(user)};`), `\n`)}

-----------------------------------------------------------------------------------------------------------------------
-- ${literal(resourceOrRole)} Update cache when insert edge
-----------------------------------------------------------------------------------------------------------------------
create or replace function ${edgeInsertTriggerFunction}()
returns trigger as $$
begin

    -- Add fresh edges from descendants
    with combined as (
      -- Old edge
      select
        "a_new_edge_cache".${parentId} as ${parentId},
        "a_new_edge_cache".${childId} as ${childId},
        "a_new_edge_cache".${permission} as ${permission}
      from ${edgeCacheParentCompute} (new.${childId}) as "a_new_edge_cache"
      union
      -- Transitive children of old edge
      select 
        "a_new_edge_cache".${parentId} as ${parentId},
        "a_new_edge_cache".${childId} as ${childId},
        "a_new_edge_cache".${permission} as ${permission}
      from ${edgeCacheChildCompute} (new.${childId}) as "a_old_edge_cache",
      lateral ${edgeCacheParentCompute} ("a_old_edge_cache".${childId}) as "a_new_edge_cache"
      -- Don't add the new edge on that side of the union
      where ( "a_new_edge_cache".${parentId} <> new.${parentId} or "a_new_edge_cache".${childId} <> new.${childId} )
    )
    insert into ${edgeCache} (${parentId}, ${childId}, ${permission})
    select ${parentId}, ${childId}, ${permission} from combined
    on conflict on constraint ${edgeCachePkey}
    do update set ${permission} = excluded.${permission};

  return null;
end;
$$ language plpgsql;

${join(config.engine.users.map(user => sql`grant execute on function ${edgeInsertTriggerFunction} () to ${identifier(user)};`), `\n`)}

drop trigger if exists ${edgeInsertTrigger} on ${edge};
create trigger ${edgeInsertTrigger}
after insert on ${edge}
for each row execute function ${edgeInsertTriggerFunction}();


-----------------------------------------------------------------------------------------------------------------------
-- ${literal(resourceOrRole)} Update cache when update edge
-----------------------------------------------------------------------------------------------------------------------

create or replace function ${edgeUpdateTriggerFunction}()
returns trigger as $$
begin

  -- Remove old all edges from descendants like in delete
  with combined as (
    -- Old edge
    select 
      old.${parentId} as ${parentId},
      old.${childId} as ${childId},
      old.${permission} as ${permission}
    union
    -- Transitive children of old edge
    select 
      "a_old_edge_cache".${parentId} as ${parentId},
      "a_old_edge_cache".${childId} as ${childId},
      "a_old_edge_cache".${permission} as ${permission}
    from ${edgeCacheChildCompute} (old.${childId}) as "a_old_edge_cache"
    -- Don't add the old edge on that side of the union
    where ( "a_old_edge_cache".${parentId} <> old.${parentId} or "a_old_edge_cache".${childId} <> old.${childId} )
  )
  delete from ${edgeCache}
  where ${childId} in (select ${childId} from combined);

  -- Re-add fresh edges from descendants like in delete
  with combined as (
    -- Old edge
    select
      "a_new_edge_cache".${parentId} as ${parentId},
      "a_new_edge_cache".${childId} as ${childId},
      "a_new_edge_cache".${permission} as ${permission}
    from ${edgeCacheParentCompute} (old.${childId}) as "a_new_edge_cache"
    union
    -- Transitive children of old edge
    select 
      "a_new_edge_cache".${parentId} as ${parentId},
      "a_new_edge_cache".${childId} as ${childId},
      "a_new_edge_cache".${permission} as ${permission}
    from ${edgeCacheChildCompute} (old.${childId}) as "a_old_edge_cache",
    lateral ${edgeCacheParentCompute} ("a_old_edge_cache".${childId}) as "a_new_edge_cache"
    -- Don't add the new edge on that side of the union
    where ( "a_new_edge_cache".${parentId} <> old.${parentId} or "a_new_edge_cache".${childId} <> old.${childId} )
  )
  insert into ${edgeCache} (${parentId}, ${childId}, ${permission})
  select ${parentId}, ${childId}, ${permission} from combined
  on conflict on constraint ${edgeCachePkey}
  do update set ${permission} = excluded.${permission};

  -- Add fresh edges from descendants like in insert
  with combined as (
    -- Old edge
    select
      "a_new_edge_cache".${parentId} as ${parentId},
      "a_new_edge_cache".${childId} as ${childId},
      "a_new_edge_cache".${permission} as ${permission}
    from ${edgeCacheParentCompute} (new.${childId}) as "a_new_edge_cache"
    union
    -- Transitive children of old edge
    select 
      "a_new_edge_cache".${parentId} as ${parentId},
      "a_new_edge_cache".${childId} as ${childId},
      "a_new_edge_cache".${permission} as ${permission}
    from ${edgeCacheChildCompute} (new.${childId}) as "a_old_edge_cache",
    lateral ${edgeCacheParentCompute} ("a_old_edge_cache".${childId}) as "a_new_edge_cache"
    -- Don't add the new edge on that side of the union
    where ( "a_new_edge_cache".${parentId} <> new.${parentId} or "a_new_edge_cache".${childId} <> new.${childId} )
  )
  insert into ${edgeCache} (${parentId}, ${childId}, ${permission})
  select ${parentId}, ${childId}, ${permission} from combined
  on conflict on constraint ${edgeCachePkey}
  do update set ${permission} = excluded.${permission};

  return null;
end;
$$ language plpgsql;

${join(config.engine.users.map(user => sql`grant execute on function ${edgeUpdateTriggerFunction} () to ${identifier(user)};`), `\n`)}

drop trigger if exists ${edgeUpdateTrigger} on ${edge};
create trigger ${edgeUpdateTrigger}
after update on ${edge}
for each row execute function ${edgeUpdateTriggerFunction}();

-----------------------------------------------------------------------------------------------------------------------
-- ${literal(resourceOrRole)} Update cache when delete edge
-----------------------------------------------------------------------------------------------------------------------

create or replace function ${edgeDeleteTriggerFunction}()
returns trigger as $$
begin

  -- Remove old all edges from descendants
  with combined as (
    -- Old edge
    select 
      old.${parentId} as ${parentId},
      old.${childId} as ${childId},
      old.${permission} as ${permission}
    union
    -- Transitive children of old edge
    select 
      "a_old_edge_cache".${parentId} as ${parentId},
      "a_old_edge_cache".${childId} as ${childId},
      "a_old_edge_cache".${permission} as ${permission}
    from ${edgeCacheChildCompute} (old.${childId}) as "a_old_edge_cache"
    -- Don't add the old edge on that side of the union
    where ( "a_old_edge_cache".${parentId} <> old.${parentId} or "a_old_edge_cache".${childId} <> old.${childId} )
  )
  delete from ${edgeCache}
  where ${childId} in (select ${childId} from combined);

  -- Re-add fresh edges from descendants
  with combined as (
    -- Old edge
    select
      "a_new_edge_cache".${parentId} as ${parentId},
      "a_new_edge_cache".${childId} as ${childId},
      "a_new_edge_cache".${permission} as ${permission}
    from ${edgeCacheParentCompute} (old.${childId}) as "a_new_edge_cache"
    union
    -- Transitive children of old edge
    select 
      "a_new_edge_cache".${parentId} as ${parentId},
      "a_new_edge_cache".${childId} as ${childId},
      "a_new_edge_cache".${permission} as ${permission}
    from ${edgeCacheChildCompute} (old.${childId}) as "a_old_edge_cache",
    lateral ${edgeCacheParentCompute} ("a_old_edge_cache".${childId}) as "a_new_edge_cache"
    -- Don't add the new edge on that side of the union
    where ( "a_new_edge_cache".${parentId} <> old.${parentId} or "a_new_edge_cache".${childId} <> old.${childId} )
  )
  insert into ${edgeCache} (${parentId}, ${childId}, ${permission})
  select ${parentId}, ${childId}, ${permission} from combined
  on conflict on constraint ${edgeCachePkey}
  do update set ${permission} = excluded.${permission};

  return null;
end;
$$ language plpgsql;

${join(config.engine.users.map(user => sql`grant execute on function ${edgeDeleteTriggerFunction} () to ${identifier(user)};`), `\n`)}

drop trigger if exists ${edgeDeleteTrigger} on ${edge};
create trigger ${edgeDeleteTrigger}
after delete on ${edge}
for each row execute function ${edgeDeleteTriggerFunction}();

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
$$ language plpgsql;

${join(config.engine.users.map(user => sql`grant execute on function ${nodeInsertTriggerFunction} () to ${identifier(user)};`), `\n`)}

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
$$ language plpgsql;

${join(config.engine.users.map(user => sql`grant execute on function ${nodeUpdateTriggerFunction} () to ${identifier(user)};`), `\n`)}


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
$$ language plpgsql;

${join(config.engine.users.map(user => sql`grant execute on function ${nodeDeleteTriggerFunction} () to ${identifier(user)};`), `\n`)}


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
$$ language sql;

${join(config.engine.users.map(user => sql`grant execute on function ${enableTriggerFunction} () to ${identifier(user)};`), `\n`)}

create or replace function ${disableTriggerFunction}()
returns void as $$
  alter table ${edge} disable trigger ${edgeInsertTrigger};
  alter table ${edge} disable trigger ${edgeUpdateTrigger};
  alter table ${edge} disable trigger ${edgeDeleteTrigger};
  alter table ${node} disable trigger ${nodeInsertTrigger};
  alter table ${node} disable trigger ${nodeUpdateTrigger};
  alter table ${node} disable trigger ${nodeDeleteTrigger};
$$ language sql;

${join(config.engine.users.map(user => sql`grant execute on function ${disableTriggerFunction} () to ${identifier(user)};`), `\n`)}
`;
}


export const createMigrationAssignments = <User extends string>(naming: Naming<User>, config: CompleteConfig<User>) => {
  const { resource, role, id, pkey, permission, orBitmap } = naming;
  const size = config.engine.permission.bitmap.size;
  const {
    edge, resourceId, roleId, edgePkey, resourceFkey, roleFkey, edgeResourceIdIndex, edgeRoleIdIndex,
    edgeCacheView, edgeCacheBackfill, edgeCache, edgeCachePkey,
    edgeCacheResourceFkey,
    edgeCacheRoleFkey,
    edgeCacheResourceIdIndex,
    edgeCacheRoleIdIndex, enableTriggerFunction, disableTriggerFunction,
    edgeInsertTrigger,
    edgeUpdateTrigger,
    edgeDeleteTrigger,
    combinedEdgeInsertTriggerFunction,
    combinedEdgeInsertTrigger,
    combinedEdgeUpdateTriggerFunction,
    combinedEdgeUpdateTrigger,
    combinedEdgeDeleteTriggerFunction,
    combinedEdgeDeleteTrigger
  } = naming.assignment;
  const { type: idType } = getIdType(config);
  const resourceOrRole = config.engine.combineAssignmentsWith;

  const getCombinedCacheBlock = (resourceOrRole: "role" | "resource") => {
    const thingCombinedWith = naming[resourceOrRole];
    const thingNotCombinedWith = naming[resourceOrRole == "role" ? "resource" : "role"];
    const thingCombinedWithId = { role: roleId, resource: resourceId }[resourceOrRole];
    const thingNotCombinedWithId = { role: resourceId, resource: roleId }[resourceOrRole];
    const thingCombinedWithFkey = { role: edgeCacheRoleFkey, resource: edgeCacheResourceFkey }[resourceOrRole];
    const thingNotCombinedWithFkey = { role: edgeCacheResourceFkey, resource: edgeCacheRoleFkey }[resourceOrRole];
    const thingCombinedWithIdIndex = { role: edgeCacheRoleIdIndex, resource: edgeCacheResourceIdIndex }[resourceOrRole];
    const thingNotCombinedWithIdIndex = { role: edgeCacheResourceIdIndex, resource: edgeCacheRoleIdIndex }[resourceOrRole];


    return sql`

-----------------------------------------------------------------------------------------------------------------------
-- Assignment transitive edge cache table
-----------------------------------------------------------------------------------------------------------------------
drop table if exists ${edgeCache} cascade;

create table ${edgeCache} (
  ${thingCombinedWithId} ${idType} not null,
  ${thingNotCombinedWithId} ${idType} not null,
  ${permission} bit(${literal(size)}),
  constraint ${edgeCachePkey} primary key (${thingCombinedWithId}, ${thingNotCombinedWithId}),
  constraint ${thingCombinedWithFkey} foreign key (${thingCombinedWithId}) references ${thingCombinedWith.node} (${thingCombinedWith.id}),
  constraint ${thingNotCombinedWithFkey} foreign key (${thingNotCombinedWithId}) references ${thingNotCombinedWith.node} (${thingNotCombinedWith.id})
);

create index if not exists ${thingCombinedWithIdIndex} on ${edgeCache} (${thingCombinedWithId});

create index if not exists ${thingNotCombinedWithIdIndex} on ${edgeCache} (${thingNotCombinedWithId});

${join(config.engine.users.map(user => sql`grant select, insert, update, delete on table ${edgeCache} to ${identifier(user)};`), `\n`)}


-----------------------------------------------------------------------------------------------------------------------
-- View of all transitive assignment with cache edges
-----------------------------------------------------------------------------------------------------------------------
-- This direction is easy, since we have less parents than children in general
create view ${edgeCacheView} as
select
  "the_edge_cache".${thingCombinedWith.childId} as ${thingCombinedWithId},
  "the_assignment".${thingNotCombinedWithId} as ${thingNotCombinedWithId},
  ${orBitmap} ("the_assignment".${permission} & "the_edge_cache".${permission}) as ${permission} -- bitwise "or" on permissions between various paths
from
  ${edge} as "the_assignment"
join
  ${thingCombinedWith.edgeCache} as "the_edge_cache"
on
  "the_assignment".${thingCombinedWithId} = "the_edge_cache".${thingCombinedWith.parentId}
group by ("the_assignment".${thingNotCombinedWithId}, "the_edge_cache".${thingCombinedWith.childId});

${join(config.engine.users.map(user => sql`grant select on table ${edgeCacheView} to ${identifier(user)};`), `\n`)}

-----------------------------------------------------------------------------------------------------------------------
-- Assignment function to create the cache
-----------------------------------------------------------------------------------------------------------------------
create or replace function ${edgeCacheBackfill} ()
  returns setof ${edgeCache}
  as $$
  insert into ${edgeCache} (${thingCombinedWithId}, ${thingNotCombinedWithId}, ${permission})
  select ${thingCombinedWithId}, ${thingNotCombinedWithId}, ${permission}
  from
    ${edgeCacheView}
  on conflict on constraint ${edgeCachePkey}
    do update set
      ${permission} = excluded.${permission}
    returning
      *
$$
language sql
volatile;

${join(config.engine.users.map(user => sql`grant execute on function ${edgeCacheBackfill} () to ${identifier(user)};`), `\n`)}







-----------------------------------------------------------------------------------------------------------------------
-- ${literal(resourceOrRole)} functions to enable / disable triggers
-----------------------------------------------------------------------------------------------------------------------
create or replace function ${enableTriggerFunction}()
returns void as $$
  -- alter table ${edge} enable trigger ${edgeInsertTrigger};
  -- alter table ${edge} enable trigger ${edgeUpdateTrigger};
  -- alter table ${edge} enable trigger ${edgeDeleteTrigger};
  -- Backfill cache
  select 1 from ${edgeCacheBackfill}();
$$ language sql;

${join(config.engine.users.map(user => sql`grant execute on function ${enableTriggerFunction} () to ${identifier(user)};`), `\n`)}

create or replace function ${disableTriggerFunction}()
returns void as $$
  -- alter table ${edge} disable trigger ${edgeInsertTrigger};
  -- alter table ${edge} disable trigger ${edgeUpdateTrigger};
  -- alter table ${edge} disable trigger ${edgeDeleteTrigger};
$$ language sql;

${join(config.engine.users.map(user => sql`grant execute on function ${disableTriggerFunction} () to ${identifier(user)};`), `\n`)}

  `;
  }

  const combinedCacheBlock = (resourceOrRole === "resource" || resourceOrRole === "role") ? getCombinedCacheBlock(resourceOrRole) : sql``;

  return sql`
-----------------------------------------------------------------------------------------------------------------------
-- Assignment from role to resource
-----------------------------------------------------------------------------------------------------------------------
drop table if exists ${edge} cascade;

create table ${edge} (
  ${resourceId} ${idType} not null,
  ${roleId} ${idType} not null,
  ${permission} bit(${literal(size)}),
  constraint ${edgePkey} primary key (${resourceId}, ${roleId}),
  constraint ${resourceFkey} foreign key (${resourceId}) references ${resource.node} (${resource.id}) on delete cascade on update cascade,
  constraint ${roleFkey} foreign key (${roleId}) references ${role.node} (${role.id}) on delete cascade on update cascade
);

create index if not exists ${edgeResourceIdIndex} on ${edge} (${resourceId});

create index if not exists ${edgeRoleIdIndex} on ${edge} (${roleId});

${join(config.engine.users.map(user => sql`grant select, insert, update, delete on table ${edge} to ${identifier(user)};`), `\n`)}

${combinedCacheBlock}
`;


}


export const createMigrationDataModelBindings = <User extends string>(naming: Naming<User>, config: CompleteConfig<User>) => {
  const { type: idType } = getIdType(config);

  return sql`
-----------------------------------------------------------------------------------------------------------------------
-- Table bindings
-----------------------------------------------------------------------------------------------------------------------
${join(config.tables.map(table => {
    const { schema, name, resourceId, resourceFkey, roleId, roleFkey } = naming.tables[table.name];
    const { resource, role } = naming;
    let resourceBlock = sql``;

    if (table.isResource) {
      resourceBlock = sql`
alter table ${schema}.${name} drop column if exists ${resourceId} cascade;
alter table ${schema}.${name} add column ${resourceId} ${idType} unique not null;
alter table ${schema}.${name} drop constraint if exists ${resourceFkey} cascade;
alter table ${schema}.${name} add constraint ${resourceFkey} foreign key (${resourceId}) references ${resource.node} (${resource.id}) on delete cascade on update cascade;
`
    }
    let roleBlock = sql``;
    if (table.isRole) {
      roleBlock = sql`
alter table ${schema}.${name} drop column if exists ${roleId} cascade;
alter table ${schema}.${name} add column ${roleId} ${idType} unique not null;
alter table ${schema}.${name} drop constraint if exists ${roleFkey} cascade;
alter table ${schema}.${name} add constraint ${roleFkey} foreign key (${roleId}) references ${role.node} (${role.id}) on delete cascade on update cascade;
`
    }
    return sql`
  ${resourceBlock}

  ${roleBlock}
  `;
  }), `\n`)}
  `

}


export const createMigrationDataModelPolicies = <User extends string>(naming: Naming<User>, config: CompleteConfig<User>) => {
  return sql`
-----------------------------------------------------------------------------------------------------------------------
-- Table policies
-----------------------------------------------------------------------------------------------------------------------
${join(config.tables.flatMap(table => {
    return config.engine.users.flatMap(user => {
      return (["select", "insert", "update", "delete"] as const).flatMap(operation => {
        const { schema, name, resourceId, permission } = naming.tables[table.name];
        const { resource, role, assignment } = naming;
        if (!table.isResource || table.permission[user] == null || table.permission[user][operation] == null) {
          return [];
        }
        return [sql`
drop policy if exists ${(permission as any)[user][operation]} on ${schema}.${name};
create policy ${(permission as any)[user][operation]} on ${schema}.${name} 
as permissive for ${join([sql``, sql``], operation) /* Yeah it's hacky I know */} to ${sql.identifier(user)} 
${["select", "update", "delete"].includes(operation) ? sql`using ( 
  exists (
    select
      1
    from
      ${resource.edgeCache} "var_resource_edge",
      ${assignment.edge} "var_assignment_edge",
      ${role.edgeCache} "var_role_edge"
    where
      -- Access chain exists
      ${name}.${resourceId} = "var_resource_edge".${resource.childId} and
      "var_resource_edge".${resource.parentId} = "var_assignment_edge".${assignment.resourceId} and
      "var_assignment_edge".${assignment.roleId} = "var_role_edge".${role.parentId} and
      "var_role_edge".${role.childId} = ${identifier(config.engine.authentication.getCurrentUserId)}() and
      -- With correct permission bit
      ("var_resource_edge".${resource.permission} << ${literal(table.permission[user][operation])})::bit = b'1' and
      ("var_assignment_edge".${assignment.permission} << ${literal(table.permission[user][operation])})::bit = b'1' and
      ("var_role_edge".${role.permission} << ${literal(table.permission[user][operation])})::bit = b'1'
  )
)`: sql``}
${["insert", "update"].includes(operation) ? sql`with check ( 
  exists (
    select
      1
    from
      ${resource.edgeCache} "var_resource_edge",
      ${assignment.edge} "var_assignment_edge",
      ${role.edgeCache} "var_role_edge"
    where
      -- Access chain exists
      ${name}.${resourceId} = "var_resource_edge".${resource.childId} and
      "var_resource_edge".${resource.parentId} = "var_assignment_edge".${assignment.resourceId} and
      "var_assignment_edge".${assignment.roleId} = "var_role_edge".${role.parentId} and
      "var_role_edge".${role.childId} = ${identifier(config.engine.authentication.getCurrentUserId)}() and
      -- With correct permission bit
      ("var_resource_edge".${resource.permission} << ${literal(table.permission[user][operation])})::bit = b'1' and
      ("var_assignment_edge".${assignment.permission} << ${literal(table.permission[user][operation])})::bit = b'1' and
      ("var_role_edge".${role.permission} << ${literal(table.permission[user][operation])})::bit = b'1'
  )
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
      const { schema, name } = naming.tables[table.name];
      if (!table.isResource) {
        return [];
      }
      return [sql`
  alter table ${schema}.${name} enable row level security;
  `];
    }), `\n`)}
    `;
}

