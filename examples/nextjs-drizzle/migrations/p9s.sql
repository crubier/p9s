
  
-----------------------------------------------------------------------------------------------------------------------
-- Preamble
-----------------------------------------------------------------------------------------------------------------------
-- p9s objects are created unqualified, and security definer functions pin search_path to the configured schema
do $$
begin
  if current_schema() is distinct from 'public' then
    raise exception 'p9s: run this migration with % as the current schema, got %', 'public', current_schema();
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


  create extension if not exists "uuid-ossp";

  
-----------------------------------------------------------------------------------------------------------------------
-- Special functions
-----------------------------------------------------------------------------------------------------------------------
create or replace aggregate "or_bitmap_8" (bit) (
  sfunc = bitor,
  stype = bit,
  initcond = '00000000'
);

grant execute on function "or_bitmap_8" (bit) to "app_user";
grant execute on function "or_bitmap_8" (bit) to "app_backend";


  
-----------------------------------------------------------------------------------------------------------------------
-- 'resource' node table
-----------------------------------------------------------------------------------------------------------------------
create table if not exists "resource_node" (
  "id" uuid unique not null default uuid_generate_v4(),
  constraint "resource_pkey" primary key ("id")
);

select pg_temp.p9s_set_privileges('"resource_node"'::regclass, array['app_user']::text[], array['app_backend']::text[]);

-----------------------------------------------------------------------------------------------------------------------
-- 'resource' edge table
-----------------------------------------------------------------------------------------------------------------------
create table if not exists "resource_edge" (
  "parent_id" uuid not null,
  "child_id" uuid not null,
  "permission" bit(8),
  constraint "resource_edge_pkey" primary key ("parent_id", "child_id"),
  constraint "resource_edge_parent_fkey" foreign key ("parent_id") references "resource_node" ("id") on delete cascade on update cascade,
  constraint "resource_edge_child_fkey" foreign key ("child_id") references "resource_node" ("id") on delete cascade on update cascade
);

create index if not exists "resource_edge_parent_id_index" on "resource_edge" ("parent_id");

create index if not exists "resource_edge_child_id_index" on "resource_edge" ("child_id");

select pg_temp.p9s_set_privileges('"resource_edge"'::regclass, array['app_user']::text[], array['app_backend']::text[]);

-----------------------------------------------------------------------------------------------------------------------
-- 'resource' transitive edge cache table
-----------------------------------------------------------------------------------------------------------------------
create table if not exists "resource_edge_cache" (
  "parent_id" uuid not null,
  "child_id" uuid not null,
  "permission" bit(8),
  constraint "resource_edge_cache_pkey" primary key ("parent_id", "child_id")
);

-- Cache rows are derived data, they go away with their nodes
alter table "resource_edge_cache" drop constraint if exists "resource_edge_cache_parent_pkey";
alter table "resource_edge_cache" add constraint "resource_edge_cache_parent_pkey" foreign key ("parent_id") references "resource_node" ("id") on delete cascade on update cascade;
alter table "resource_edge_cache" drop constraint if exists "resource_edge_cache_child_pkey";
alter table "resource_edge_cache" add constraint "resource_edge_cache_child_pkey" foreign key ("child_id") references "resource_node" ("id") on delete cascade on update cascade;

create index if not exists "resource_edge_cache_parent_id_index" on "resource_edge_cache" ("parent_id");

create index if not exists "resource_edge_cache_child_id_index" on "resource_edge_cache" ("child_id");

-- Only p9s triggers write to the cache
select pg_temp.p9s_set_privileges('"resource_edge_cache"'::regclass, array['app_user', 'app_backend']::text[], array[]::text[]);

-----------------------------------------------------------------------------------------------------------------------
-- 'resource' compute recursive permissions, towards parent
-----------------------------------------------------------------------------------------------------------------------
create or replace function "resource_edge_cache_parent_compute" ("var_child_id" uuid)
  returns setof "resource_edge_cache"
  as $$
  with recursive "search_graph" ("parent_id", "child_id", "permission", "depth", "path") 
  as (
    (values ("var_child_id", "var_child_id", ~  b'0'::bit(8), 0, array[]::uuid[])) -- seed
    union all
    select -- recursive query
      "the_edge"."parent_id" as "parent_id",
      "the_search_graph"."child_id" as "child_id",
      ("the_search_graph"."permission"::bit(8) & "the_edge"."permission"::bit(8))::bit(8) as "permission", -- bitwise "and" on permission along a path
      "the_search_graph"."depth" + 1 as "depth", -- increment depth
      "the_search_graph"."path" || "the_edge"."child_id" as "path" -- append node id to path
    from "resource_edge" as "the_edge"
    join "search_graph" as "the_search_graph" 
    on "the_edge"."child_id" = "the_search_graph"."parent_id"
    where ("the_edge"."child_id" <> all ("the_search_graph"."path")) -- prevent from cycling
    and "the_search_graph"."depth" <= 16 -- max search depth
  )
    select
      "the_search_graph"."parent_id",
      "the_search_graph"."child_id",
      "or_bitmap_8" ("the_search_graph"."permission") -- bitwise "or" on permissions between various paths
    from "search_graph" as "the_search_graph"
    group by ("the_search_graph"."parent_id", "the_search_graph"."child_id");

-- query a recursive table. you can add limit output or use a cursor
$$
language sql
stable;

grant execute on function "resource_edge_cache_parent_compute" ("var_child_id" uuid) to "app_user";
grant execute on function "resource_edge_cache_parent_compute" ("var_child_id" uuid) to "app_backend";

-----------------------------------------------------------------------------------------------------------------------
-- 'resource' compute recursive permissions, towards child
-----------------------------------------------------------------------------------------------------------------------
create or replace function "resource_edge_cache_child_compute" ("var_parent_id" uuid)
  returns setof "resource_edge_cache"
  as $$
  with recursive "search_graph" ("parent_id", "child_id", "permission", "depth", "path") 
  as (
    (values ("var_parent_id", "var_parent_id", ~  b'0'::bit(8), 0, array[]::uuid[])) -- seed
    union all
    select -- recursive query
      "the_search_graph"."parent_id" as "parent_id",
      "the_edge"."child_id" as "child_id",
      ("the_search_graph"."permission"::bit(8) & "the_edge"."permission"::bit(8))::bit(8) as "permission", -- bitwise "and" on permission along a path
      "the_search_graph"."depth" + 1 as "depth", -- increment depth
      "the_search_graph"."path" || "the_edge"."parent_id" as "path" -- append node id to path
    from "resource_edge" as "the_edge"
    join "search_graph" as "the_search_graph" 
    on "the_search_graph"."child_id" = "the_edge"."parent_id"
    where ("the_edge"."parent_id" <> all ("the_search_graph"."path")) -- prevent from cycling
    and "the_search_graph"."depth" <= 16 -- max search depth
  )
    select
      "the_search_graph"."parent_id",
      "the_search_graph"."child_id",
      "or_bitmap_8" ("the_search_graph"."permission") -- bitwise "or" on permissions between various paths
    from "search_graph" as "the_search_graph"
    group by ("the_search_graph"."parent_id", "the_search_graph"."child_id");

-- query a recursive table. you can add limit output or use a cursor
$$
language sql
stable;

grant execute on function "resource_edge_cache_child_compute" ("var_parent_id" uuid) to "app_user";
grant execute on function "resource_edge_cache_child_compute" ("var_parent_id" uuid) to "app_backend";

-----------------------------------------------------------------------------------------------------------------------
-- 'resource' view of all transitive edges. 
-----------------------------------------------------------------------------------------------------------------------
-- This direction is easy, since we have less parents than children in general
create or replace view "resource_edge_cache_view" as
select
  "parent_permissions"."parent_id" as "parent_id",
  "parent_permissions"."child_id" as "child_id",
  "parent_permissions"."permission" as "permission"
from
  "resource_node" as "the_node",
  lateral "resource_edge_cache_parent_compute" ("the_node"."id") as "parent_permissions";

select pg_temp.p9s_set_privileges('"resource_edge_cache_view"'::regclass, array['app_user', 'app_backend']::text[], array[]::text[]);

-----------------------------------------------------------------------------------------------------------------------
-- 'resource' function to rebuild the cache from scratch
-----------------------------------------------------------------------------------------------------------------------
create or replace function "resource_edge_cache_backfill" ()
  returns setof "resource_edge_cache"
  as $$
  select pg_advisory_xact_lock(hashtext('p9s:public:'));
  delete from "resource_edge_cache";
  insert into "resource_edge_cache" ("parent_id", "child_id", "permission")
  select "parent_id", "child_id", "permission"
  from
    "resource_edge_cache_view"
    returning
      *
$$
language sql
volatile
security definer set search_path = "public", pg_temp;


revoke execute on function "resource_edge_cache_backfill" () from public;
grant execute on function "resource_edge_cache_backfill" () to "app_backend";

-----------------------------------------------------------------------------------------------------------------------
-- 'resource' Update cache when insert edge
-----------------------------------------------------------------------------------------------------------------------
create or replace function "resource_edge_insert_trigger_function"()
returns trigger as $$
begin
  
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'p9s: permission graph writes must run in READ COMMITTED isolation, not %', current_setting('transaction_isolation');
  end if;
  perform pg_advisory_xact_lock(hashtext('p9s:public:'));

    -- Add fresh edges from descendants
    with combined as (
      -- Old edge
      select
        "a_new_edge_cache"."parent_id" as "parent_id",
        "a_new_edge_cache"."child_id" as "child_id",
        "a_new_edge_cache"."permission" as "permission"
      from "resource_edge_cache_parent_compute" (new."child_id") as "a_new_edge_cache"
      union
      -- Transitive children of old edge
      select 
        "a_new_edge_cache"."parent_id" as "parent_id",
        "a_new_edge_cache"."child_id" as "child_id",
        "a_new_edge_cache"."permission" as "permission"
      from "resource_edge_cache_child_compute" (new."child_id") as "a_old_edge_cache",
      lateral "resource_edge_cache_parent_compute" ("a_old_edge_cache"."child_id") as "a_new_edge_cache"
      -- Don't add the new edge on that side of the union
      where ( "a_new_edge_cache"."parent_id" <> new."parent_id" or "a_new_edge_cache"."child_id" <> new."child_id" )
    )
    insert into "resource_edge_cache" ("parent_id", "child_id", "permission")
    select "parent_id", "child_id", "permission" from combined
    on conflict on constraint "resource_edge_cache_pkey"
    do update set "permission" = excluded."permission";

  return null;
end;
$$ language plpgsql security definer set search_path = "public", pg_temp;


revoke execute on function "resource_edge_insert_trigger_function" () from public;


drop trigger if exists "10_resource_edge_insert_trigger" on "resource_edge";
create trigger "10_resource_edge_insert_trigger"
after insert on "resource_edge"
for each row execute function "resource_edge_insert_trigger_function"();


-----------------------------------------------------------------------------------------------------------------------
-- 'resource' Update cache when update edge
-----------------------------------------------------------------------------------------------------------------------

create or replace function "resource_edge_update_trigger_function"()
returns trigger as $$
begin
  
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'p9s: permission graph writes must run in READ COMMITTED isolation, not %', current_setting('transaction_isolation');
  end if;
  perform pg_advisory_xact_lock(hashtext('p9s:public:'));

  -- Remove old all edges from descendants like in delete
  with combined as (
    -- Old edge
    select 
      old."parent_id" as "parent_id",
      old."child_id" as "child_id",
      old."permission" as "permission"
    union
    -- Transitive children of old edge
    select 
      "a_old_edge_cache"."parent_id" as "parent_id",
      "a_old_edge_cache"."child_id" as "child_id",
      "a_old_edge_cache"."permission" as "permission"
    from "resource_edge_cache_child_compute" (old."child_id") as "a_old_edge_cache"
    -- Don't add the old edge on that side of the union
    where ( "a_old_edge_cache"."parent_id" <> old."parent_id" or "a_old_edge_cache"."child_id" <> old."child_id" )
  )
  delete from "resource_edge_cache"
  where "child_id" in (select "child_id" from combined);

  -- Re-add fresh edges from descendants like in delete
  with combined as (
    -- Old edge
    select
      "a_new_edge_cache"."parent_id" as "parent_id",
      "a_new_edge_cache"."child_id" as "child_id",
      "a_new_edge_cache"."permission" as "permission"
    from "resource_edge_cache_parent_compute" (old."child_id") as "a_new_edge_cache"
    union
    -- Transitive children of old edge
    select 
      "a_new_edge_cache"."parent_id" as "parent_id",
      "a_new_edge_cache"."child_id" as "child_id",
      "a_new_edge_cache"."permission" as "permission"
    from "resource_edge_cache_child_compute" (old."child_id") as "a_old_edge_cache",
    lateral "resource_edge_cache_parent_compute" ("a_old_edge_cache"."child_id") as "a_new_edge_cache"
    -- Don't add the new edge on that side of the union
    where ( "a_new_edge_cache"."parent_id" <> old."parent_id" or "a_new_edge_cache"."child_id" <> old."child_id" )
  )
  insert into "resource_edge_cache" ("parent_id", "child_id", "permission")
  select "parent_id", "child_id", "permission" from combined
  where exists (select 1 from "resource_node" where "resource_node"."id" = combined."parent_id")
  and exists (select 1 from "resource_node" where "resource_node"."id" = combined."child_id")
  on conflict on constraint "resource_edge_cache_pkey"
  do update set "permission" = excluded."permission";

  -- Add fresh edges from descendants like in insert
  with combined as (
    -- Old edge
    select
      "a_new_edge_cache"."parent_id" as "parent_id",
      "a_new_edge_cache"."child_id" as "child_id",
      "a_new_edge_cache"."permission" as "permission"
    from "resource_edge_cache_parent_compute" (new."child_id") as "a_new_edge_cache"
    union
    -- Transitive children of old edge
    select 
      "a_new_edge_cache"."parent_id" as "parent_id",
      "a_new_edge_cache"."child_id" as "child_id",
      "a_new_edge_cache"."permission" as "permission"
    from "resource_edge_cache_child_compute" (new."child_id") as "a_old_edge_cache",
    lateral "resource_edge_cache_parent_compute" ("a_old_edge_cache"."child_id") as "a_new_edge_cache"
    -- Don't add the new edge on that side of the union
    where ( "a_new_edge_cache"."parent_id" <> new."parent_id" or "a_new_edge_cache"."child_id" <> new."child_id" )
  )
  insert into "resource_edge_cache" ("parent_id", "child_id", "permission")
  select "parent_id", "child_id", "permission" from combined
  where exists (select 1 from "resource_node" where "resource_node"."id" = combined."parent_id")
  and exists (select 1 from "resource_node" where "resource_node"."id" = combined."child_id")
  on conflict on constraint "resource_edge_cache_pkey"
  do update set "permission" = excluded."permission";

  return null;
end;
$$ language plpgsql security definer set search_path = "public", pg_temp;


revoke execute on function "resource_edge_update_trigger_function" () from public;


drop trigger if exists "10_resource_edge_update_trigger" on "resource_edge";
create trigger "10_resource_edge_update_trigger"
after update on "resource_edge"
for each row execute function "resource_edge_update_trigger_function"();

-----------------------------------------------------------------------------------------------------------------------
-- 'resource' Update cache when delete edge
-----------------------------------------------------------------------------------------------------------------------

create or replace function "resource_edge_delete_trigger_function"()
returns trigger as $$
begin
  
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'p9s: permission graph writes must run in READ COMMITTED isolation, not %', current_setting('transaction_isolation');
  end if;
  perform pg_advisory_xact_lock(hashtext('p9s:public:'));

  -- Remove old all edges from descendants
  with combined as (
    -- Old edge
    select 
      old."parent_id" as "parent_id",
      old."child_id" as "child_id",
      old."permission" as "permission"
    union
    -- Transitive children of old edge
    select 
      "a_old_edge_cache"."parent_id" as "parent_id",
      "a_old_edge_cache"."child_id" as "child_id",
      "a_old_edge_cache"."permission" as "permission"
    from "resource_edge_cache_child_compute" (old."child_id") as "a_old_edge_cache"
    -- Don't add the old edge on that side of the union
    where ( "a_old_edge_cache"."parent_id" <> old."parent_id" or "a_old_edge_cache"."child_id" <> old."child_id" )
  )
  delete from "resource_edge_cache"
  where "child_id" in (select "child_id" from combined);

  -- Re-add fresh edges from descendants
  with combined as (
    -- Old edge
    select
      "a_new_edge_cache"."parent_id" as "parent_id",
      "a_new_edge_cache"."child_id" as "child_id",
      "a_new_edge_cache"."permission" as "permission"
    from "resource_edge_cache_parent_compute" (old."child_id") as "a_new_edge_cache"
    union
    -- Transitive children of old edge
    select 
      "a_new_edge_cache"."parent_id" as "parent_id",
      "a_new_edge_cache"."child_id" as "child_id",
      "a_new_edge_cache"."permission" as "permission"
    from "resource_edge_cache_child_compute" (old."child_id") as "a_old_edge_cache",
    lateral "resource_edge_cache_parent_compute" ("a_old_edge_cache"."child_id") as "a_new_edge_cache"
    -- Don't add the new edge on that side of the union
    where ( "a_new_edge_cache"."parent_id" <> old."parent_id" or "a_new_edge_cache"."child_id" <> old."child_id" )
  )
  insert into "resource_edge_cache" ("parent_id", "child_id", "permission")
  select "parent_id", "child_id", "permission" from combined
  where exists (select 1 from "resource_node" where "resource_node"."id" = combined."parent_id")
  and exists (select 1 from "resource_node" where "resource_node"."id" = combined."child_id")
  on conflict on constraint "resource_edge_cache_pkey"
  do update set "permission" = excluded."permission";

  return null;
end;
$$ language plpgsql security definer set search_path = "public", pg_temp;


revoke execute on function "resource_edge_delete_trigger_function" () from public;


drop trigger if exists "10_resource_edge_delete_trigger" on "resource_edge";
create trigger "10_resource_edge_delete_trigger"
after delete on "resource_edge"
for each row execute function "resource_edge_delete_trigger_function"();

-----------------------------------------------------------------------------------------------------------------------
-- 'resource' Update cache when insert node
-----------------------------------------------------------------------------------------------------------------------

create or replace function "resource_node_insert_trigger_function"()
returns trigger as $$
begin
  -- Add self reference to cache, a node has full access to itself
  insert into "resource_edge_cache" ("parent_id", "child_id", "permission")
  values (new."id", new."id", ~ b'0'::bit(8))
  on conflict on constraint "resource_edge_cache_pkey"
  do update set "permission" = excluded."permission";

  return null;
end;
$$ language plpgsql security definer set search_path = "public", pg_temp;


revoke execute on function "resource_node_insert_trigger_function" () from public;


drop trigger if exists "10_resource_node_insert_trigger" on "resource_node";
create trigger "10_resource_node_insert_trigger"
after insert on "resource_node"
for each row execute function "resource_node_insert_trigger_function"();

-----------------------------------------------------------------------------------------------------------------------
-- 'resource' Update cache when update node
-----------------------------------------------------------------------------------------------------------------------

create or replace function "resource_node_update_trigger_function"()
returns trigger as $$
begin
  -- Update self reference in cache, a node has full access to itself
  update "resource_edge_cache"
  set "parent_id" = new."id", "child_id" = new."id"
  where "parent_id" = old."id" and "child_id" = old."id";

  return null;
end;
$$ language plpgsql security definer set search_path = "public", pg_temp;


revoke execute on function "resource_node_update_trigger_function" () from public;



drop trigger if exists "10_resource_node_update_trigger" on "resource_node";
create trigger "10_resource_node_update_trigger"
after update on "resource_node"
for each row execute function "resource_node_update_trigger_function"();

-----------------------------------------------------------------------------------------------------------------------
-- 'resource' Update cache when delete node
-----------------------------------------------------------------------------------------------------------------------

create or replace function "resource_node_delete_trigger_function"()
returns trigger as $$
begin
  -- Remove self reference from cache
  delete from "resource_edge_cache"
  where "parent_id" = old."id" and "child_id" = old."id";

  return null;
end;
$$ language plpgsql security definer set search_path = "public", pg_temp;


revoke execute on function "resource_node_delete_trigger_function" () from public;



drop trigger if exists "10_resource_node_delete_trigger" on "resource_node";
create trigger "10_resource_node_delete_trigger"
after delete on "resource_node"
for each row execute function "resource_node_delete_trigger_function"();


-----------------------------------------------------------------------------------------------------------------------
-- 'resource' actually do bootstrap cache
-----------------------------------------------------------------------------------------------------------------------
select 1 from "resource_edge_cache_backfill"();


-----------------------------------------------------------------------------------------------------------------------
-- 'resource' functions to enable / disable triggers
-----------------------------------------------------------------------------------------------------------------------
create or replace function "resource_trigger_enable"()
returns void as $$
  alter table "resource_edge" enable trigger "10_resource_edge_insert_trigger";
  alter table "resource_edge" enable trigger "10_resource_edge_update_trigger";
  alter table "resource_edge" enable trigger "10_resource_edge_delete_trigger";
  alter table "resource_node" enable trigger "10_resource_node_insert_trigger";
  alter table "resource_node" enable trigger "10_resource_node_update_trigger";
  alter table "resource_node" enable trigger "10_resource_node_delete_trigger";
  -- Backfill cache
  select 1 from "resource_edge_cache_backfill"();
$$ language sql security definer set search_path = "public", pg_temp;


revoke execute on function "resource_trigger_enable" () from public;
grant execute on function "resource_trigger_enable" () to "app_backend";

create or replace function "resource_trigger_disable"()
returns void as $$
  alter table "resource_edge" disable trigger "10_resource_edge_insert_trigger";
  alter table "resource_edge" disable trigger "10_resource_edge_update_trigger";
  alter table "resource_edge" disable trigger "10_resource_edge_delete_trigger";
  alter table "resource_node" disable trigger "10_resource_node_insert_trigger";
  alter table "resource_node" disable trigger "10_resource_node_update_trigger";
  alter table "resource_node" disable trigger "10_resource_node_delete_trigger";
$$ language sql security definer set search_path = "public", pg_temp;


revoke execute on function "resource_trigger_disable" () from public;
grant execute on function "resource_trigger_disable" () to "app_backend";


  
-----------------------------------------------------------------------------------------------------------------------
-- 'role' node table
-----------------------------------------------------------------------------------------------------------------------
create table if not exists "role_node" (
  "id" uuid unique not null default uuid_generate_v4(),
  constraint "role_pkey" primary key ("id")
);

select pg_temp.p9s_set_privileges('"role_node"'::regclass, array['app_user']::text[], array['app_backend']::text[]);

-----------------------------------------------------------------------------------------------------------------------
-- 'role' edge table
-----------------------------------------------------------------------------------------------------------------------
create table if not exists "role_edge" (
  "parent_id" uuid not null,
  "child_id" uuid not null,
  "permission" bit(8),
  constraint "role_edge_pkey" primary key ("parent_id", "child_id"),
  constraint "role_edge_parent_fkey" foreign key ("parent_id") references "role_node" ("id") on delete cascade on update cascade,
  constraint "role_edge_child_fkey" foreign key ("child_id") references "role_node" ("id") on delete cascade on update cascade
);

create index if not exists "role_edge_parent_id_index" on "role_edge" ("parent_id");

create index if not exists "role_edge_child_id_index" on "role_edge" ("child_id");

select pg_temp.p9s_set_privileges('"role_edge"'::regclass, array['app_user']::text[], array['app_backend']::text[]);

-----------------------------------------------------------------------------------------------------------------------
-- 'role' transitive edge cache table
-----------------------------------------------------------------------------------------------------------------------
create table if not exists "role_edge_cache" (
  "parent_id" uuid not null,
  "child_id" uuid not null,
  "permission" bit(8),
  constraint "role_edge_cache_pkey" primary key ("parent_id", "child_id")
);

-- Cache rows are derived data, they go away with their nodes
alter table "role_edge_cache" drop constraint if exists "role_edge_cache_parent_pkey";
alter table "role_edge_cache" add constraint "role_edge_cache_parent_pkey" foreign key ("parent_id") references "role_node" ("id") on delete cascade on update cascade;
alter table "role_edge_cache" drop constraint if exists "role_edge_cache_child_pkey";
alter table "role_edge_cache" add constraint "role_edge_cache_child_pkey" foreign key ("child_id") references "role_node" ("id") on delete cascade on update cascade;

create index if not exists "role_edge_cache_parent_id_index" on "role_edge_cache" ("parent_id");

create index if not exists "role_edge_cache_child_id_index" on "role_edge_cache" ("child_id");

-- Only p9s triggers write to the cache
select pg_temp.p9s_set_privileges('"role_edge_cache"'::regclass, array['app_user', 'app_backend']::text[], array[]::text[]);

-----------------------------------------------------------------------------------------------------------------------
-- 'role' compute recursive permissions, towards parent
-----------------------------------------------------------------------------------------------------------------------
create or replace function "role_edge_cache_parent_compute" ("var_child_id" uuid)
  returns setof "role_edge_cache"
  as $$
  with recursive "search_graph" ("parent_id", "child_id", "permission", "depth", "path") 
  as (
    (values ("var_child_id", "var_child_id", ~  b'0'::bit(8), 0, array[]::uuid[])) -- seed
    union all
    select -- recursive query
      "the_edge"."parent_id" as "parent_id",
      "the_search_graph"."child_id" as "child_id",
      ("the_search_graph"."permission"::bit(8) & "the_edge"."permission"::bit(8))::bit(8) as "permission", -- bitwise "and" on permission along a path
      "the_search_graph"."depth" + 1 as "depth", -- increment depth
      "the_search_graph"."path" || "the_edge"."child_id" as "path" -- append node id to path
    from "role_edge" as "the_edge"
    join "search_graph" as "the_search_graph" 
    on "the_edge"."child_id" = "the_search_graph"."parent_id"
    where ("the_edge"."child_id" <> all ("the_search_graph"."path")) -- prevent from cycling
    and "the_search_graph"."depth" <= 16 -- max search depth
  )
    select
      "the_search_graph"."parent_id",
      "the_search_graph"."child_id",
      "or_bitmap_8" ("the_search_graph"."permission") -- bitwise "or" on permissions between various paths
    from "search_graph" as "the_search_graph"
    group by ("the_search_graph"."parent_id", "the_search_graph"."child_id");

-- query a recursive table. you can add limit output or use a cursor
$$
language sql
stable;

grant execute on function "role_edge_cache_parent_compute" ("var_child_id" uuid) to "app_user";
grant execute on function "role_edge_cache_parent_compute" ("var_child_id" uuid) to "app_backend";

-----------------------------------------------------------------------------------------------------------------------
-- 'role' compute recursive permissions, towards child
-----------------------------------------------------------------------------------------------------------------------
create or replace function "role_edge_cache_child_compute" ("var_parent_id" uuid)
  returns setof "role_edge_cache"
  as $$
  with recursive "search_graph" ("parent_id", "child_id", "permission", "depth", "path") 
  as (
    (values ("var_parent_id", "var_parent_id", ~  b'0'::bit(8), 0, array[]::uuid[])) -- seed
    union all
    select -- recursive query
      "the_search_graph"."parent_id" as "parent_id",
      "the_edge"."child_id" as "child_id",
      ("the_search_graph"."permission"::bit(8) & "the_edge"."permission"::bit(8))::bit(8) as "permission", -- bitwise "and" on permission along a path
      "the_search_graph"."depth" + 1 as "depth", -- increment depth
      "the_search_graph"."path" || "the_edge"."parent_id" as "path" -- append node id to path
    from "role_edge" as "the_edge"
    join "search_graph" as "the_search_graph" 
    on "the_search_graph"."child_id" = "the_edge"."parent_id"
    where ("the_edge"."parent_id" <> all ("the_search_graph"."path")) -- prevent from cycling
    and "the_search_graph"."depth" <= 16 -- max search depth
  )
    select
      "the_search_graph"."parent_id",
      "the_search_graph"."child_id",
      "or_bitmap_8" ("the_search_graph"."permission") -- bitwise "or" on permissions between various paths
    from "search_graph" as "the_search_graph"
    group by ("the_search_graph"."parent_id", "the_search_graph"."child_id");

-- query a recursive table. you can add limit output or use a cursor
$$
language sql
stable;

grant execute on function "role_edge_cache_child_compute" ("var_parent_id" uuid) to "app_user";
grant execute on function "role_edge_cache_child_compute" ("var_parent_id" uuid) to "app_backend";

-----------------------------------------------------------------------------------------------------------------------
-- 'role' view of all transitive edges. 
-----------------------------------------------------------------------------------------------------------------------
-- This direction is easy, since we have less parents than children in general
create or replace view "role_edge_cache_view" as
select
  "parent_permissions"."parent_id" as "parent_id",
  "parent_permissions"."child_id" as "child_id",
  "parent_permissions"."permission" as "permission"
from
  "role_node" as "the_node",
  lateral "role_edge_cache_parent_compute" ("the_node"."id") as "parent_permissions";

select pg_temp.p9s_set_privileges('"role_edge_cache_view"'::regclass, array['app_user', 'app_backend']::text[], array[]::text[]);

-----------------------------------------------------------------------------------------------------------------------
-- 'role' function to rebuild the cache from scratch
-----------------------------------------------------------------------------------------------------------------------
create or replace function "role_edge_cache_backfill" ()
  returns setof "role_edge_cache"
  as $$
  select pg_advisory_xact_lock(hashtext('p9s:public:'));
  delete from "role_edge_cache";
  insert into "role_edge_cache" ("parent_id", "child_id", "permission")
  select "parent_id", "child_id", "permission"
  from
    "role_edge_cache_view"
    returning
      *
$$
language sql
volatile
security definer set search_path = "public", pg_temp;


revoke execute on function "role_edge_cache_backfill" () from public;
grant execute on function "role_edge_cache_backfill" () to "app_backend";

-----------------------------------------------------------------------------------------------------------------------
-- 'role' Update cache when insert edge
-----------------------------------------------------------------------------------------------------------------------
create or replace function "role_edge_insert_trigger_function"()
returns trigger as $$
begin
  
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'p9s: permission graph writes must run in READ COMMITTED isolation, not %', current_setting('transaction_isolation');
  end if;
  perform pg_advisory_xact_lock(hashtext('p9s:public:'));

    -- Add fresh edges from descendants
    with combined as (
      -- Old edge
      select
        "a_new_edge_cache"."parent_id" as "parent_id",
        "a_new_edge_cache"."child_id" as "child_id",
        "a_new_edge_cache"."permission" as "permission"
      from "role_edge_cache_parent_compute" (new."child_id") as "a_new_edge_cache"
      union
      -- Transitive children of old edge
      select 
        "a_new_edge_cache"."parent_id" as "parent_id",
        "a_new_edge_cache"."child_id" as "child_id",
        "a_new_edge_cache"."permission" as "permission"
      from "role_edge_cache_child_compute" (new."child_id") as "a_old_edge_cache",
      lateral "role_edge_cache_parent_compute" ("a_old_edge_cache"."child_id") as "a_new_edge_cache"
      -- Don't add the new edge on that side of the union
      where ( "a_new_edge_cache"."parent_id" <> new."parent_id" or "a_new_edge_cache"."child_id" <> new."child_id" )
    )
    insert into "role_edge_cache" ("parent_id", "child_id", "permission")
    select "parent_id", "child_id", "permission" from combined
    on conflict on constraint "role_edge_cache_pkey"
    do update set "permission" = excluded."permission";

  return null;
end;
$$ language plpgsql security definer set search_path = "public", pg_temp;


revoke execute on function "role_edge_insert_trigger_function" () from public;


drop trigger if exists "10_role_edge_insert_trigger" on "role_edge";
create trigger "10_role_edge_insert_trigger"
after insert on "role_edge"
for each row execute function "role_edge_insert_trigger_function"();


-----------------------------------------------------------------------------------------------------------------------
-- 'role' Update cache when update edge
-----------------------------------------------------------------------------------------------------------------------

create or replace function "role_edge_update_trigger_function"()
returns trigger as $$
begin
  
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'p9s: permission graph writes must run in READ COMMITTED isolation, not %', current_setting('transaction_isolation');
  end if;
  perform pg_advisory_xact_lock(hashtext('p9s:public:'));

  -- Remove old all edges from descendants like in delete
  with combined as (
    -- Old edge
    select 
      old."parent_id" as "parent_id",
      old."child_id" as "child_id",
      old."permission" as "permission"
    union
    -- Transitive children of old edge
    select 
      "a_old_edge_cache"."parent_id" as "parent_id",
      "a_old_edge_cache"."child_id" as "child_id",
      "a_old_edge_cache"."permission" as "permission"
    from "role_edge_cache_child_compute" (old."child_id") as "a_old_edge_cache"
    -- Don't add the old edge on that side of the union
    where ( "a_old_edge_cache"."parent_id" <> old."parent_id" or "a_old_edge_cache"."child_id" <> old."child_id" )
  )
  delete from "role_edge_cache"
  where "child_id" in (select "child_id" from combined);

  -- Re-add fresh edges from descendants like in delete
  with combined as (
    -- Old edge
    select
      "a_new_edge_cache"."parent_id" as "parent_id",
      "a_new_edge_cache"."child_id" as "child_id",
      "a_new_edge_cache"."permission" as "permission"
    from "role_edge_cache_parent_compute" (old."child_id") as "a_new_edge_cache"
    union
    -- Transitive children of old edge
    select 
      "a_new_edge_cache"."parent_id" as "parent_id",
      "a_new_edge_cache"."child_id" as "child_id",
      "a_new_edge_cache"."permission" as "permission"
    from "role_edge_cache_child_compute" (old."child_id") as "a_old_edge_cache",
    lateral "role_edge_cache_parent_compute" ("a_old_edge_cache"."child_id") as "a_new_edge_cache"
    -- Don't add the new edge on that side of the union
    where ( "a_new_edge_cache"."parent_id" <> old."parent_id" or "a_new_edge_cache"."child_id" <> old."child_id" )
  )
  insert into "role_edge_cache" ("parent_id", "child_id", "permission")
  select "parent_id", "child_id", "permission" from combined
  where exists (select 1 from "role_node" where "role_node"."id" = combined."parent_id")
  and exists (select 1 from "role_node" where "role_node"."id" = combined."child_id")
  on conflict on constraint "role_edge_cache_pkey"
  do update set "permission" = excluded."permission";

  -- Add fresh edges from descendants like in insert
  with combined as (
    -- Old edge
    select
      "a_new_edge_cache"."parent_id" as "parent_id",
      "a_new_edge_cache"."child_id" as "child_id",
      "a_new_edge_cache"."permission" as "permission"
    from "role_edge_cache_parent_compute" (new."child_id") as "a_new_edge_cache"
    union
    -- Transitive children of old edge
    select 
      "a_new_edge_cache"."parent_id" as "parent_id",
      "a_new_edge_cache"."child_id" as "child_id",
      "a_new_edge_cache"."permission" as "permission"
    from "role_edge_cache_child_compute" (new."child_id") as "a_old_edge_cache",
    lateral "role_edge_cache_parent_compute" ("a_old_edge_cache"."child_id") as "a_new_edge_cache"
    -- Don't add the new edge on that side of the union
    where ( "a_new_edge_cache"."parent_id" <> new."parent_id" or "a_new_edge_cache"."child_id" <> new."child_id" )
  )
  insert into "role_edge_cache" ("parent_id", "child_id", "permission")
  select "parent_id", "child_id", "permission" from combined
  where exists (select 1 from "role_node" where "role_node"."id" = combined."parent_id")
  and exists (select 1 from "role_node" where "role_node"."id" = combined."child_id")
  on conflict on constraint "role_edge_cache_pkey"
  do update set "permission" = excluded."permission";

  return null;
end;
$$ language plpgsql security definer set search_path = "public", pg_temp;


revoke execute on function "role_edge_update_trigger_function" () from public;


drop trigger if exists "10_role_edge_update_trigger" on "role_edge";
create trigger "10_role_edge_update_trigger"
after update on "role_edge"
for each row execute function "role_edge_update_trigger_function"();

-----------------------------------------------------------------------------------------------------------------------
-- 'role' Update cache when delete edge
-----------------------------------------------------------------------------------------------------------------------

create or replace function "role_edge_delete_trigger_function"()
returns trigger as $$
begin
  
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'p9s: permission graph writes must run in READ COMMITTED isolation, not %', current_setting('transaction_isolation');
  end if;
  perform pg_advisory_xact_lock(hashtext('p9s:public:'));

  -- Remove old all edges from descendants
  with combined as (
    -- Old edge
    select 
      old."parent_id" as "parent_id",
      old."child_id" as "child_id",
      old."permission" as "permission"
    union
    -- Transitive children of old edge
    select 
      "a_old_edge_cache"."parent_id" as "parent_id",
      "a_old_edge_cache"."child_id" as "child_id",
      "a_old_edge_cache"."permission" as "permission"
    from "role_edge_cache_child_compute" (old."child_id") as "a_old_edge_cache"
    -- Don't add the old edge on that side of the union
    where ( "a_old_edge_cache"."parent_id" <> old."parent_id" or "a_old_edge_cache"."child_id" <> old."child_id" )
  )
  delete from "role_edge_cache"
  where "child_id" in (select "child_id" from combined);

  -- Re-add fresh edges from descendants
  with combined as (
    -- Old edge
    select
      "a_new_edge_cache"."parent_id" as "parent_id",
      "a_new_edge_cache"."child_id" as "child_id",
      "a_new_edge_cache"."permission" as "permission"
    from "role_edge_cache_parent_compute" (old."child_id") as "a_new_edge_cache"
    union
    -- Transitive children of old edge
    select 
      "a_new_edge_cache"."parent_id" as "parent_id",
      "a_new_edge_cache"."child_id" as "child_id",
      "a_new_edge_cache"."permission" as "permission"
    from "role_edge_cache_child_compute" (old."child_id") as "a_old_edge_cache",
    lateral "role_edge_cache_parent_compute" ("a_old_edge_cache"."child_id") as "a_new_edge_cache"
    -- Don't add the new edge on that side of the union
    where ( "a_new_edge_cache"."parent_id" <> old."parent_id" or "a_new_edge_cache"."child_id" <> old."child_id" )
  )
  insert into "role_edge_cache" ("parent_id", "child_id", "permission")
  select "parent_id", "child_id", "permission" from combined
  where exists (select 1 from "role_node" where "role_node"."id" = combined."parent_id")
  and exists (select 1 from "role_node" where "role_node"."id" = combined."child_id")
  on conflict on constraint "role_edge_cache_pkey"
  do update set "permission" = excluded."permission";

  return null;
end;
$$ language plpgsql security definer set search_path = "public", pg_temp;


revoke execute on function "role_edge_delete_trigger_function" () from public;


drop trigger if exists "10_role_edge_delete_trigger" on "role_edge";
create trigger "10_role_edge_delete_trigger"
after delete on "role_edge"
for each row execute function "role_edge_delete_trigger_function"();

-----------------------------------------------------------------------------------------------------------------------
-- 'role' Update cache when insert node
-----------------------------------------------------------------------------------------------------------------------

create or replace function "role_node_insert_trigger_function"()
returns trigger as $$
begin
  -- Add self reference to cache, a node has full access to itself
  insert into "role_edge_cache" ("parent_id", "child_id", "permission")
  values (new."id", new."id", ~ b'0'::bit(8))
  on conflict on constraint "role_edge_cache_pkey"
  do update set "permission" = excluded."permission";

  return null;
end;
$$ language plpgsql security definer set search_path = "public", pg_temp;


revoke execute on function "role_node_insert_trigger_function" () from public;


drop trigger if exists "10_role_node_insert_trigger" on "role_node";
create trigger "10_role_node_insert_trigger"
after insert on "role_node"
for each row execute function "role_node_insert_trigger_function"();

-----------------------------------------------------------------------------------------------------------------------
-- 'role' Update cache when update node
-----------------------------------------------------------------------------------------------------------------------

create or replace function "role_node_update_trigger_function"()
returns trigger as $$
begin
  -- Update self reference in cache, a node has full access to itself
  update "role_edge_cache"
  set "parent_id" = new."id", "child_id" = new."id"
  where "parent_id" = old."id" and "child_id" = old."id";

  return null;
end;
$$ language plpgsql security definer set search_path = "public", pg_temp;


revoke execute on function "role_node_update_trigger_function" () from public;



drop trigger if exists "10_role_node_update_trigger" on "role_node";
create trigger "10_role_node_update_trigger"
after update on "role_node"
for each row execute function "role_node_update_trigger_function"();

-----------------------------------------------------------------------------------------------------------------------
-- 'role' Update cache when delete node
-----------------------------------------------------------------------------------------------------------------------

create or replace function "role_node_delete_trigger_function"()
returns trigger as $$
begin
  -- Remove self reference from cache
  delete from "role_edge_cache"
  where "parent_id" = old."id" and "child_id" = old."id";

  return null;
end;
$$ language plpgsql security definer set search_path = "public", pg_temp;


revoke execute on function "role_node_delete_trigger_function" () from public;



drop trigger if exists "10_role_node_delete_trigger" on "role_node";
create trigger "10_role_node_delete_trigger"
after delete on "role_node"
for each row execute function "role_node_delete_trigger_function"();


-----------------------------------------------------------------------------------------------------------------------
-- 'role' actually do bootstrap cache
-----------------------------------------------------------------------------------------------------------------------
select 1 from "role_edge_cache_backfill"();


-----------------------------------------------------------------------------------------------------------------------
-- 'role' functions to enable / disable triggers
-----------------------------------------------------------------------------------------------------------------------
create or replace function "role_trigger_enable"()
returns void as $$
  alter table "role_edge" enable trigger "10_role_edge_insert_trigger";
  alter table "role_edge" enable trigger "10_role_edge_update_trigger";
  alter table "role_edge" enable trigger "10_role_edge_delete_trigger";
  alter table "role_node" enable trigger "10_role_node_insert_trigger";
  alter table "role_node" enable trigger "10_role_node_update_trigger";
  alter table "role_node" enable trigger "10_role_node_delete_trigger";
  -- Backfill cache
  select 1 from "role_edge_cache_backfill"();
$$ language sql security definer set search_path = "public", pg_temp;


revoke execute on function "role_trigger_enable" () from public;
grant execute on function "role_trigger_enable" () to "app_backend";

create or replace function "role_trigger_disable"()
returns void as $$
  alter table "role_edge" disable trigger "10_role_edge_insert_trigger";
  alter table "role_edge" disable trigger "10_role_edge_update_trigger";
  alter table "role_edge" disable trigger "10_role_edge_delete_trigger";
  alter table "role_node" disable trigger "10_role_node_insert_trigger";
  alter table "role_node" disable trigger "10_role_node_update_trigger";
  alter table "role_node" disable trigger "10_role_node_delete_trigger";
$$ language sql security definer set search_path = "public", pg_temp;


revoke execute on function "role_trigger_disable" () from public;
grant execute on function "role_trigger_disable" () to "app_backend";


  
-----------------------------------------------------------------------------------------------------------------------
-- Assignment from role to resource
-----------------------------------------------------------------------------------------------------------------------
create table if not exists "assignment_edge" (
  "resource_id" uuid not null,
  "role_id" uuid not null,
  "permission" bit(8),
  constraint "assignment_edge_pkey" primary key ("resource_id", "role_id"),
  constraint "assignment_edge_resource_fkey" foreign key ("resource_id") references "resource_node" ("id") on delete cascade on update cascade,
  constraint "assignment_edge_role_fkey" foreign key ("role_id") references "role_node" ("id") on delete cascade on update cascade
);

create index if not exists "assignment_edge_resource_id_index" on "assignment_edge" ("resource_id");

create index if not exists "assignment_edge_role_id_index" on "assignment_edge" ("role_id");

select pg_temp.p9s_set_privileges('"assignment_edge"'::regclass, array['app_user']::text[], array['app_backend']::text[]);


drop trigger if exists "10_assignment_edge_insert_trigger" on "assignment_edge";
drop trigger if exists "10_assignment_edge_update_trigger" on "assignment_edge";
drop trigger if exists "10_assignment_edge_delete_trigger" on "assignment_edge";

drop trigger if exists "20_assignment_edge_role_insert_trigger" on "role_edge_cache";
drop trigger if exists "20_assignment_edge_role_update_trigger" on "role_edge_cache";
drop trigger if exists "20_assignment_edge_role_delete_trigger" on "role_edge_cache";

drop trigger if exists "20_assignment_edge_resource_insert_trigger" on "resource_edge_cache";
drop trigger if exists "20_assignment_edge_resource_update_trigger" on "resource_edge_cache";
drop trigger if exists "20_assignment_edge_resource_delete_trigger" on "resource_edge_cache";




-----------------------------------------------------------------------------------------------------------------------
-- Assignment transitive edge cache table
-----------------------------------------------------------------------------------------------------------------------
create table if not exists "assignment_edge_cache" (
  "role_id" uuid not null,
  "resource_id" uuid not null,
  "permission" bit(8),
  constraint "assignment_edge_cache_pkey" primary key ("role_id", "resource_id")
);

-- Cache rows are derived data, they go away with their nodes
alter table "assignment_edge_cache" drop constraint if exists "assignment_edge_cache_role_fkey";
alter table "assignment_edge_cache" add constraint "assignment_edge_cache_role_fkey" foreign key ("role_id") references "role_node" ("id") on delete cascade on update cascade;
alter table "assignment_edge_cache" drop constraint if exists "assignment_edge_cache_resource_fkey";
alter table "assignment_edge_cache" add constraint "assignment_edge_cache_resource_fkey" foreign key ("resource_id") references "resource_node" ("id") on delete cascade on update cascade;

create index if not exists "assignment_edge_cache_role_id_index" on "assignment_edge_cache" ("role_id");

create index if not exists "assignment_edge_cache_resource_id_index" on "assignment_edge_cache" ("resource_id");

-- Only p9s triggers write to the cache
select pg_temp.p9s_set_privileges('"assignment_edge_cache"'::regclass, array['app_user', 'app_backend']::text[], array[]::text[]);


-----------------------------------------------------------------------------------------------------------------------
-- View of all transitive assignment with cache edges
-----------------------------------------------------------------------------------------------------------------------
create or replace view "assignment_edge_cache_view" as

    select
      "the_edge_cache"."child_id" as "role_id",
      "the_assignment"."resource_id" as "resource_id",
      "or_bitmap_8" ("the_assignment"."permission" & "the_edge_cache"."permission") as "permission" -- bitwise "or" on permissions between various paths
    from
      "assignment_edge" as "the_assignment"
    join
      "role_edge_cache" as "the_edge_cache"
    on
      "the_assignment"."role_id" = "the_edge_cache"."parent_id"
    where true
    group by ("the_assignment"."resource_id", "the_edge_cache"."child_id");

select pg_temp.p9s_set_privileges('"assignment_edge_cache_view"'::regclass, array['app_user', 'app_backend']::text[], array[]::text[]);

-----------------------------------------------------------------------------------------------------------------------
-- Assignment function to rebuild the cache from scratch
-----------------------------------------------------------------------------------------------------------------------
create or replace function "assignment_edge_cache_backfill" ()
  returns setof "assignment_edge_cache"
  as $$
  select pg_advisory_xact_lock(hashtext('p9s:public:'));
  delete from "assignment_edge_cache";
  insert into "assignment_edge_cache" ("role_id", "resource_id", "permission")
  select "role_id", "resource_id", "permission"
  from
    "assignment_edge_cache_view"
    returning
      *
$$
language sql
volatile
security definer set search_path = "public", pg_temp;


revoke execute on function "assignment_edge_cache_backfill" () from public;
grant execute on function "assignment_edge_cache_backfill" () to "app_backend";

-----------------------------------------------------------------------------------------------------------------------
-- Update cache when assignments change
-----------------------------------------------------------------------------------------------------------------------

create or replace function "assignment_edge_insert_trigger_function"()
returns trigger as $$
begin
  
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'p9s: permission graph writes must run in READ COMMITTED isolation, not %', current_setting('transaction_isolation');
  end if;
  perform pg_advisory_xact_lock(hashtext('p9s:public:'));

  delete from "assignment_edge_cache" where "resource_id" in (select "resource_id" from "p9s_new_rows");
  insert into "assignment_edge_cache" ("role_id", "resource_id", "permission")
  
    select
      "the_edge_cache"."child_id" as "role_id",
      "the_assignment"."resource_id" as "resource_id",
      "or_bitmap_8" ("the_assignment"."permission" & "the_edge_cache"."permission") as "permission" -- bitwise "or" on permissions between various paths
    from
      "assignment_edge" as "the_assignment"
    join
      "role_edge_cache" as "the_edge_cache"
    on
      "the_assignment"."role_id" = "the_edge_cache"."parent_id"
    where "the_assignment"."resource_id" in (select "resource_id" from "p9s_new_rows") and exists (select 1 from "role_node" where "role_node"."id" = "the_edge_cache"."child_id")
      and exists (select 1 from "resource_node" where "resource_node"."id" = "the_assignment"."resource_id")
    group by ("the_assignment"."resource_id", "the_edge_cache"."child_id");
  return null;
end;
$$ language plpgsql security definer set search_path = "public", pg_temp;


revoke execute on function "assignment_edge_insert_trigger_function" () from public;


create trigger "10_assignment_edge_insert_trigger"
after insert on "assignment_edge"
referencing new table as "p9s_new_rows"
for each statement execute function "assignment_edge_insert_trigger_function"();


create or replace function "assignment_edge_update_trigger_function"()
returns trigger as $$
begin
  
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'p9s: permission graph writes must run in READ COMMITTED isolation, not %', current_setting('transaction_isolation');
  end if;
  perform pg_advisory_xact_lock(hashtext('p9s:public:'));

  delete from "assignment_edge_cache" where "resource_id" in (select "resource_id" from "p9s_old_rows" union select "resource_id" from "p9s_new_rows");
  insert into "assignment_edge_cache" ("role_id", "resource_id", "permission")
  
    select
      "the_edge_cache"."child_id" as "role_id",
      "the_assignment"."resource_id" as "resource_id",
      "or_bitmap_8" ("the_assignment"."permission" & "the_edge_cache"."permission") as "permission" -- bitwise "or" on permissions between various paths
    from
      "assignment_edge" as "the_assignment"
    join
      "role_edge_cache" as "the_edge_cache"
    on
      "the_assignment"."role_id" = "the_edge_cache"."parent_id"
    where "the_assignment"."resource_id" in (select "resource_id" from "p9s_old_rows" union select "resource_id" from "p9s_new_rows") and exists (select 1 from "role_node" where "role_node"."id" = "the_edge_cache"."child_id")
      and exists (select 1 from "resource_node" where "resource_node"."id" = "the_assignment"."resource_id")
    group by ("the_assignment"."resource_id", "the_edge_cache"."child_id");
  return null;
end;
$$ language plpgsql security definer set search_path = "public", pg_temp;


revoke execute on function "assignment_edge_update_trigger_function" () from public;


create trigger "10_assignment_edge_update_trigger"
after update on "assignment_edge"
referencing old table as "p9s_old_rows" new table as "p9s_new_rows"
for each statement execute function "assignment_edge_update_trigger_function"();


create or replace function "assignment_edge_delete_trigger_function"()
returns trigger as $$
begin
  
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'p9s: permission graph writes must run in READ COMMITTED isolation, not %', current_setting('transaction_isolation');
  end if;
  perform pg_advisory_xact_lock(hashtext('p9s:public:'));

  delete from "assignment_edge_cache" where "resource_id" in (select "resource_id" from "p9s_old_rows");
  insert into "assignment_edge_cache" ("role_id", "resource_id", "permission")
  
    select
      "the_edge_cache"."child_id" as "role_id",
      "the_assignment"."resource_id" as "resource_id",
      "or_bitmap_8" ("the_assignment"."permission" & "the_edge_cache"."permission") as "permission" -- bitwise "or" on permissions between various paths
    from
      "assignment_edge" as "the_assignment"
    join
      "role_edge_cache" as "the_edge_cache"
    on
      "the_assignment"."role_id" = "the_edge_cache"."parent_id"
    where "the_assignment"."resource_id" in (select "resource_id" from "p9s_old_rows") and exists (select 1 from "role_node" where "role_node"."id" = "the_edge_cache"."child_id")
      and exists (select 1 from "resource_node" where "resource_node"."id" = "the_assignment"."resource_id")
    group by ("the_assignment"."resource_id", "the_edge_cache"."child_id");
  return null;
end;
$$ language plpgsql security definer set search_path = "public", pg_temp;


revoke execute on function "assignment_edge_delete_trigger_function" () from public;


create trigger "10_assignment_edge_delete_trigger"
after delete on "assignment_edge"
referencing old table as "p9s_old_rows"
for each statement execute function "assignment_edge_delete_trigger_function"();


-----------------------------------------------------------------------------------------------------------------------
-- Update cache when the 'role' transitive edge cache changes
-----------------------------------------------------------------------------------------------------------------------

create or replace function "assignment_edge_role_insert_trigger_function"()
returns trigger as $$
begin
  
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'p9s: permission graph writes must run in READ COMMITTED isolation, not %', current_setting('transaction_isolation');
  end if;
  perform pg_advisory_xact_lock(hashtext('p9s:public:'));

  delete from "assignment_edge_cache" where "role_id" in (select "child_id" from "p9s_new_rows");
  insert into "assignment_edge_cache" ("role_id", "resource_id", "permission")
  
    select
      "the_edge_cache"."child_id" as "role_id",
      "the_assignment"."resource_id" as "resource_id",
      "or_bitmap_8" ("the_assignment"."permission" & "the_edge_cache"."permission") as "permission" -- bitwise "or" on permissions between various paths
    from
      "assignment_edge" as "the_assignment"
    join
      "role_edge_cache" as "the_edge_cache"
    on
      "the_assignment"."role_id" = "the_edge_cache"."parent_id"
    where "the_edge_cache"."child_id" in (select "child_id" from "p9s_new_rows") and exists (select 1 from "role_node" where "role_node"."id" = "the_edge_cache"."child_id")
      and exists (select 1 from "resource_node" where "resource_node"."id" = "the_assignment"."resource_id")
    group by ("the_assignment"."resource_id", "the_edge_cache"."child_id");
  return null;
end;
$$ language plpgsql security definer set search_path = "public", pg_temp;


revoke execute on function "assignment_edge_role_insert_trigger_function" () from public;


create trigger "20_assignment_edge_role_insert_trigger"
after insert on "role_edge_cache"
referencing new table as "p9s_new_rows"
for each statement execute function "assignment_edge_role_insert_trigger_function"();


create or replace function "assignment_edge_role_update_trigger_function"()
returns trigger as $$
begin
  
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'p9s: permission graph writes must run in READ COMMITTED isolation, not %', current_setting('transaction_isolation');
  end if;
  perform pg_advisory_xact_lock(hashtext('p9s:public:'));

  delete from "assignment_edge_cache" where "role_id" in (select "child_id" from "p9s_old_rows" union select "child_id" from "p9s_new_rows");
  insert into "assignment_edge_cache" ("role_id", "resource_id", "permission")
  
    select
      "the_edge_cache"."child_id" as "role_id",
      "the_assignment"."resource_id" as "resource_id",
      "or_bitmap_8" ("the_assignment"."permission" & "the_edge_cache"."permission") as "permission" -- bitwise "or" on permissions between various paths
    from
      "assignment_edge" as "the_assignment"
    join
      "role_edge_cache" as "the_edge_cache"
    on
      "the_assignment"."role_id" = "the_edge_cache"."parent_id"
    where "the_edge_cache"."child_id" in (select "child_id" from "p9s_old_rows" union select "child_id" from "p9s_new_rows") and exists (select 1 from "role_node" where "role_node"."id" = "the_edge_cache"."child_id")
      and exists (select 1 from "resource_node" where "resource_node"."id" = "the_assignment"."resource_id")
    group by ("the_assignment"."resource_id", "the_edge_cache"."child_id");
  return null;
end;
$$ language plpgsql security definer set search_path = "public", pg_temp;


revoke execute on function "assignment_edge_role_update_trigger_function" () from public;


create trigger "20_assignment_edge_role_update_trigger"
after update on "role_edge_cache"
referencing old table as "p9s_old_rows" new table as "p9s_new_rows"
for each statement execute function "assignment_edge_role_update_trigger_function"();


create or replace function "assignment_edge_role_delete_trigger_function"()
returns trigger as $$
begin
  
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'p9s: permission graph writes must run in READ COMMITTED isolation, not %', current_setting('transaction_isolation');
  end if;
  perform pg_advisory_xact_lock(hashtext('p9s:public:'));

  delete from "assignment_edge_cache" where "role_id" in (select "child_id" from "p9s_old_rows");
  insert into "assignment_edge_cache" ("role_id", "resource_id", "permission")
  
    select
      "the_edge_cache"."child_id" as "role_id",
      "the_assignment"."resource_id" as "resource_id",
      "or_bitmap_8" ("the_assignment"."permission" & "the_edge_cache"."permission") as "permission" -- bitwise "or" on permissions between various paths
    from
      "assignment_edge" as "the_assignment"
    join
      "role_edge_cache" as "the_edge_cache"
    on
      "the_assignment"."role_id" = "the_edge_cache"."parent_id"
    where "the_edge_cache"."child_id" in (select "child_id" from "p9s_old_rows") and exists (select 1 from "role_node" where "role_node"."id" = "the_edge_cache"."child_id")
      and exists (select 1 from "resource_node" where "resource_node"."id" = "the_assignment"."resource_id")
    group by ("the_assignment"."resource_id", "the_edge_cache"."child_id");
  return null;
end;
$$ language plpgsql security definer set search_path = "public", pg_temp;


revoke execute on function "assignment_edge_role_delete_trigger_function" () from public;


create trigger "20_assignment_edge_role_delete_trigger"
after delete on "role_edge_cache"
referencing old table as "p9s_old_rows"
for each statement execute function "assignment_edge_role_delete_trigger_function"();


-----------------------------------------------------------------------------------------------------------------------
-- Assignment actually do bootstrap cache
-----------------------------------------------------------------------------------------------------------------------
select 1 from "assignment_edge_cache_backfill"();

-----------------------------------------------------------------------------------------------------------------------
-- Assignment functions to enable / disable triggers
-----------------------------------------------------------------------------------------------------------------------
create or replace function "assignment_trigger_enable"()
returns void as $$
  alter table "assignment_edge" enable trigger "10_assignment_edge_insert_trigger";
  alter table "assignment_edge" enable trigger "10_assignment_edge_update_trigger";
  alter table "assignment_edge" enable trigger "10_assignment_edge_delete_trigger";
  alter table "role_edge_cache" enable trigger "20_assignment_edge_role_insert_trigger";
  alter table "role_edge_cache" enable trigger "20_assignment_edge_role_update_trigger";
  alter table "role_edge_cache" enable trigger "20_assignment_edge_role_delete_trigger";
  -- Backfill cache
  select 1 from "assignment_edge_cache_backfill"();
$$ language sql security definer set search_path = "public", pg_temp;


revoke execute on function "assignment_trigger_enable" () from public;
grant execute on function "assignment_trigger_enable" () to "app_backend";

create or replace function "assignment_trigger_disable"()
returns void as $$
  alter table "assignment_edge" disable trigger "10_assignment_edge_insert_trigger";
  alter table "assignment_edge" disable trigger "10_assignment_edge_update_trigger";
  alter table "assignment_edge" disable trigger "10_assignment_edge_delete_trigger";
  alter table "role_edge_cache" disable trigger "20_assignment_edge_role_insert_trigger";
  alter table "role_edge_cache" disable trigger "20_assignment_edge_role_update_trigger";
  alter table "role_edge_cache" disable trigger "20_assignment_edge_role_delete_trigger";
$$ language sql security definer set search_path = "public", pg_temp;


revoke execute on function "assignment_trigger_disable" () from public;
grant execute on function "assignment_trigger_disable" () to "app_backend";

  


  
-----------------------------------------------------------------------------------------------------------------------
-- Table bindings
-----------------------------------------------------------------------------------------------------------------------

  

  
  

  
alter table "public"."folder" add column if not exists "resource_id" uuid unique;
do $$
declare
  "the_row" record;
  "the_id" uuid;
begin
  for "the_row" in select ctid from "public"."folder" where "resource_id" is null loop
    insert into "resource_node" default values returning "id" into "the_id";
    update "public"."folder" set "resource_id" = "the_id" where ctid = "the_row".ctid;
  end loop;
end
$$;
alter table "public"."folder" alter column "resource_id" set not null;
alter table "public"."folder" drop constraint if exists "resource_folder_fkey" cascade;
alter table "public"."folder" add constraint "resource_folder_fkey" foreign key ("resource_id") references "resource_node" ("id") on delete cascade on update cascade;


  
  

  
alter table "public"."image" add column if not exists "resource_id" uuid unique;
do $$
declare
  "the_row" record;
  "the_id" uuid;
begin
  for "the_row" in select ctid from "public"."image" where "resource_id" is null loop
    insert into "resource_node" default values returning "id" into "the_id";
    update "public"."image" set "resource_id" = "the_id" where ctid = "the_row".ctid;
  end loop;
end
$$;
alter table "public"."image" alter column "resource_id" set not null;
alter table "public"."image" drop constraint if exists "resource_image_fkey" cascade;
alter table "public"."image" add constraint "resource_image_fkey" foreign key ("resource_id") references "resource_node" ("id") on delete cascade on update cascade;


  
  

  

  
  

  
alter table "public"."text_content" add column if not exists "resource_id" uuid unique;
do $$
declare
  "the_row" record;
  "the_id" uuid;
begin
  for "the_row" in select ctid from "public"."text_content" where "resource_id" is null loop
    insert into "resource_node" default values returning "id" into "the_id";
    update "public"."text_content" set "resource_id" = "the_id" where ctid = "the_row".ctid;
  end loop;
end
$$;
alter table "public"."text_content" alter column "resource_id" set not null;
alter table "public"."text_content" drop constraint if exists "resource_text_content_fkey" cascade;
alter table "public"."text_content" add constraint "resource_text_content_fkey" foreign key ("resource_id") references "resource_node" ("id") on delete cascade on update cascade;


  
  

  

  
alter table "public"."user" add column if not exists "role_id" uuid unique;
do $$
declare
  "the_row" record;
  "the_id" uuid;
begin
  for "the_row" in select ctid from "public"."user" where "role_id" is null loop
    insert into "role_node" default values returning "id" into "the_id";
    update "public"."user" set "role_id" = "the_id" where ctid = "the_row".ctid;
  end loop;
end
$$;
alter table "public"."user" alter column "role_id" set not null;
alter table "public"."user" drop constraint if exists "role_user_fkey" cascade;
alter table "public"."user" add constraint "role_user_fkey" foreign key ("role_id") references "role_node" ("id") on delete cascade on update cascade;

  

  

  
  
  

  
-----------------------------------------------------------------------------------------------------------------------
-- Table policies
-----------------------------------------------------------------------------------------------------------------------

drop policy if exists "folder_app_user_select_policy" on "public"."folder";
create policy "folder_app_user_select_policy" on "public"."folder" 
as permissive for select to "app_user" 
using (
  exists (
    select
      1
    from
      "resource_edge_cache" "var_resource_edge",
      "assignment_edge_cache" "var_assignment_edge"
    where
      -- Access chain exists
      "folder"."resource_id" = "var_resource_edge"."child_id" and
      "var_resource_edge"."parent_id" = "var_assignment_edge"."resource_id" and
      "var_assignment_edge"."role_id" = "current_role_id"() and
      -- With correct permission bit
      ("var_resource_edge"."permission" << 0)::bit = b'1' and
      ("var_assignment_edge"."permission" << 0)::bit = b'1'
  )
)
;


drop policy if exists "folder_app_user_insert_policy" on "public"."folder";
create policy "folder_app_user_insert_policy" on "public"."folder" 
as permissive for insert to "app_user" 

with check (
  exists (
    select
      1
    from
      "resource_edge_cache" "var_resource_edge",
      "assignment_edge_cache" "var_assignment_edge"
    where
      -- Access chain exists
      "folder"."resource_id" = "var_resource_edge"."child_id" and
      "var_resource_edge"."parent_id" = "var_assignment_edge"."resource_id" and
      "var_assignment_edge"."role_id" = "current_role_id"() and
      -- With correct permission bit
      ("var_resource_edge"."permission" << 1)::bit = b'1' and
      ("var_assignment_edge"."permission" << 1)::bit = b'1'
  )
);


drop policy if exists "folder_app_user_update_policy" on "public"."folder";
create policy "folder_app_user_update_policy" on "public"."folder" 
as permissive for update to "app_user" 
using (
  exists (
    select
      1
    from
      "resource_edge_cache" "var_resource_edge",
      "assignment_edge_cache" "var_assignment_edge"
    where
      -- Access chain exists
      "folder"."resource_id" = "var_resource_edge"."child_id" and
      "var_resource_edge"."parent_id" = "var_assignment_edge"."resource_id" and
      "var_assignment_edge"."role_id" = "current_role_id"() and
      -- With correct permission bit
      ("var_resource_edge"."permission" << 2)::bit = b'1' and
      ("var_assignment_edge"."permission" << 2)::bit = b'1'
  )
)
with check (
  exists (
    select
      1
    from
      "resource_edge_cache" "var_resource_edge",
      "assignment_edge_cache" "var_assignment_edge"
    where
      -- Access chain exists
      "folder"."resource_id" = "var_resource_edge"."child_id" and
      "var_resource_edge"."parent_id" = "var_assignment_edge"."resource_id" and
      "var_assignment_edge"."role_id" = "current_role_id"() and
      -- With correct permission bit
      ("var_resource_edge"."permission" << 2)::bit = b'1' and
      ("var_assignment_edge"."permission" << 2)::bit = b'1'
  )
);


drop policy if exists "folder_app_user_delete_policy" on "public"."folder";
create policy "folder_app_user_delete_policy" on "public"."folder" 
as permissive for delete to "app_user" 
using (
  exists (
    select
      1
    from
      "resource_edge_cache" "var_resource_edge",
      "assignment_edge_cache" "var_assignment_edge"
    where
      -- Access chain exists
      "folder"."resource_id" = "var_resource_edge"."child_id" and
      "var_resource_edge"."parent_id" = "var_assignment_edge"."resource_id" and
      "var_assignment_edge"."role_id" = "current_role_id"() and
      -- With correct permission bit
      ("var_resource_edge"."permission" << 3)::bit = b'1' and
      ("var_assignment_edge"."permission" << 3)::bit = b'1'
  )
)
;


drop policy if exists "image_app_user_select_policy" on "public"."image";
create policy "image_app_user_select_policy" on "public"."image" 
as permissive for select to "app_user" 
using (
  exists (
    select
      1
    from
      "resource_edge_cache" "var_resource_edge",
      "assignment_edge_cache" "var_assignment_edge"
    where
      -- Access chain exists
      "image"."resource_id" = "var_resource_edge"."child_id" and
      "var_resource_edge"."parent_id" = "var_assignment_edge"."resource_id" and
      "var_assignment_edge"."role_id" = "current_role_id"() and
      -- With correct permission bit
      ("var_resource_edge"."permission" << 0)::bit = b'1' and
      ("var_assignment_edge"."permission" << 0)::bit = b'1'
  )
)
;


drop policy if exists "image_app_user_insert_policy" on "public"."image";
create policy "image_app_user_insert_policy" on "public"."image" 
as permissive for insert to "app_user" 

with check (
  exists (
    select
      1
    from
      "resource_edge_cache" "var_resource_edge",
      "assignment_edge_cache" "var_assignment_edge"
    where
      -- Access chain exists
      "image"."resource_id" = "var_resource_edge"."child_id" and
      "var_resource_edge"."parent_id" = "var_assignment_edge"."resource_id" and
      "var_assignment_edge"."role_id" = "current_role_id"() and
      -- With correct permission bit
      ("var_resource_edge"."permission" << 1)::bit = b'1' and
      ("var_assignment_edge"."permission" << 1)::bit = b'1'
  )
);


drop policy if exists "image_app_user_update_policy" on "public"."image";
create policy "image_app_user_update_policy" on "public"."image" 
as permissive for update to "app_user" 
using (
  exists (
    select
      1
    from
      "resource_edge_cache" "var_resource_edge",
      "assignment_edge_cache" "var_assignment_edge"
    where
      -- Access chain exists
      "image"."resource_id" = "var_resource_edge"."child_id" and
      "var_resource_edge"."parent_id" = "var_assignment_edge"."resource_id" and
      "var_assignment_edge"."role_id" = "current_role_id"() and
      -- With correct permission bit
      ("var_resource_edge"."permission" << 2)::bit = b'1' and
      ("var_assignment_edge"."permission" << 2)::bit = b'1'
  )
)
with check (
  exists (
    select
      1
    from
      "resource_edge_cache" "var_resource_edge",
      "assignment_edge_cache" "var_assignment_edge"
    where
      -- Access chain exists
      "image"."resource_id" = "var_resource_edge"."child_id" and
      "var_resource_edge"."parent_id" = "var_assignment_edge"."resource_id" and
      "var_assignment_edge"."role_id" = "current_role_id"() and
      -- With correct permission bit
      ("var_resource_edge"."permission" << 2)::bit = b'1' and
      ("var_assignment_edge"."permission" << 2)::bit = b'1'
  )
);


drop policy if exists "image_app_user_delete_policy" on "public"."image";
create policy "image_app_user_delete_policy" on "public"."image" 
as permissive for delete to "app_user" 
using (
  exists (
    select
      1
    from
      "resource_edge_cache" "var_resource_edge",
      "assignment_edge_cache" "var_assignment_edge"
    where
      -- Access chain exists
      "image"."resource_id" = "var_resource_edge"."child_id" and
      "var_resource_edge"."parent_id" = "var_assignment_edge"."resource_id" and
      "var_assignment_edge"."role_id" = "current_role_id"() and
      -- With correct permission bit
      ("var_resource_edge"."permission" << 3)::bit = b'1' and
      ("var_assignment_edge"."permission" << 3)::bit = b'1'
  )
)
;


drop policy if exists "text_content_app_user_select_policy" on "public"."text_content";
create policy "text_content_app_user_select_policy" on "public"."text_content" 
as permissive for select to "app_user" 
using (
  exists (
    select
      1
    from
      "resource_edge_cache" "var_resource_edge",
      "assignment_edge_cache" "var_assignment_edge"
    where
      -- Access chain exists
      "text_content"."resource_id" = "var_resource_edge"."child_id" and
      "var_resource_edge"."parent_id" = "var_assignment_edge"."resource_id" and
      "var_assignment_edge"."role_id" = "current_role_id"() and
      -- With correct permission bit
      ("var_resource_edge"."permission" << 0)::bit = b'1' and
      ("var_assignment_edge"."permission" << 0)::bit = b'1'
  )
)
;


drop policy if exists "text_content_app_user_insert_policy" on "public"."text_content";
create policy "text_content_app_user_insert_policy" on "public"."text_content" 
as permissive for insert to "app_user" 

with check (
  exists (
    select
      1
    from
      "resource_edge_cache" "var_resource_edge",
      "assignment_edge_cache" "var_assignment_edge"
    where
      -- Access chain exists
      "text_content"."resource_id" = "var_resource_edge"."child_id" and
      "var_resource_edge"."parent_id" = "var_assignment_edge"."resource_id" and
      "var_assignment_edge"."role_id" = "current_role_id"() and
      -- With correct permission bit
      ("var_resource_edge"."permission" << 1)::bit = b'1' and
      ("var_assignment_edge"."permission" << 1)::bit = b'1'
  )
);


drop policy if exists "text_content_app_user_update_policy" on "public"."text_content";
create policy "text_content_app_user_update_policy" on "public"."text_content" 
as permissive for update to "app_user" 
using (
  exists (
    select
      1
    from
      "resource_edge_cache" "var_resource_edge",
      "assignment_edge_cache" "var_assignment_edge"
    where
      -- Access chain exists
      "text_content"."resource_id" = "var_resource_edge"."child_id" and
      "var_resource_edge"."parent_id" = "var_assignment_edge"."resource_id" and
      "var_assignment_edge"."role_id" = "current_role_id"() and
      -- With correct permission bit
      ("var_resource_edge"."permission" << 2)::bit = b'1' and
      ("var_assignment_edge"."permission" << 2)::bit = b'1'
  )
)
with check (
  exists (
    select
      1
    from
      "resource_edge_cache" "var_resource_edge",
      "assignment_edge_cache" "var_assignment_edge"
    where
      -- Access chain exists
      "text_content"."resource_id" = "var_resource_edge"."child_id" and
      "var_resource_edge"."parent_id" = "var_assignment_edge"."resource_id" and
      "var_assignment_edge"."role_id" = "current_role_id"() and
      -- With correct permission bit
      ("var_resource_edge"."permission" << 2)::bit = b'1' and
      ("var_assignment_edge"."permission" << 2)::bit = b'1'
  )
);


drop policy if exists "text_content_app_user_delete_policy" on "public"."text_content";
create policy "text_content_app_user_delete_policy" on "public"."text_content" 
as permissive for delete to "app_user" 
using (
  exists (
    select
      1
    from
      "resource_edge_cache" "var_resource_edge",
      "assignment_edge_cache" "var_assignment_edge"
    where
      -- Access chain exists
      "text_content"."resource_id" = "var_resource_edge"."child_id" and
      "var_resource_edge"."parent_id" = "var_assignment_edge"."resource_id" and
      "var_assignment_edge"."role_id" = "current_role_id"() and
      -- With correct permission bit
      ("var_resource_edge"."permission" << 3)::bit = b'1' and
      ("var_assignment_edge"."permission" << 3)::bit = b'1'
  )
)
;

    
-----------------------------------------------------------------------------------------------------------------------
-- Enable RLS on tables
-----------------------------------------------------------------------------------------------------------------------

  alter table "public"."folder" enable row level security;
  

  alter table "public"."image" enable row level security;
  

  alter table "public"."text_content" enable row level security;
  
    

  

  