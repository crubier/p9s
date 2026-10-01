import { expect, test } from 'bun:test'
import { compile } from "pg-sql2";
import { createMigration } from '../generation'

test('Default Migration', () => {
  expect(compile(createMigration({
    engine: {
      permission: { bitmap: { size: 4 } },
      users: ["user1"]
    },
    tables: [{
      name: "human_user",
      isRole: true,
      roleId: "role_id"
    }, {
      name: "blog_post",
      isResource: true,
      resourceId: "resource_id",
      permission: {
        user1: {
          select: 0,
          insert: 1,
          update: 1,
          delete: 1,
        }
      }
    }]
  })).text).toMatchInlineSnapshot(`
    "
      
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


      

      
    -----------------------------------------------------------------------------------------------------------------------
    -- Special functions
    -----------------------------------------------------------------------------------------------------------------------
    create or replace aggregate "or_bitmap_4" (bit) (
      sfunc = bitor,
      stype = bit,
      initcond = '0000'
    );

    grant execute on function "or_bitmap_4" (bit) to "user1";


      
    -----------------------------------------------------------------------------------------------------------------------
    -- 'resource' node table
    -----------------------------------------------------------------------------------------------------------------------
    create table if not exists "resource_node" (
      "id" serial unique not null,
      constraint "resource_pkey" primary key ("id")
    );

    select pg_temp.p9s_set_privileges('"resource_node"'::regclass, array['user1']::text[], array[]::text[]);

    -----------------------------------------------------------------------------------------------------------------------
    -- 'resource' edge table
    -----------------------------------------------------------------------------------------------------------------------
    create table if not exists "resource_edge" (
      "parent_id" integer not null,
      "child_id" integer not null,
      "permission" bit(4),
      constraint "resource_edge_pkey" primary key ("parent_id", "child_id"),
      constraint "resource_edge_parent_fkey" foreign key ("parent_id") references "resource_node" ("id") on delete cascade on update cascade,
      constraint "resource_edge_child_fkey" foreign key ("child_id") references "resource_node" ("id") on delete cascade on update cascade
    );

    create index if not exists "resource_edge_parent_id_index" on "resource_edge" ("parent_id");

    create index if not exists "resource_edge_child_id_index" on "resource_edge" ("child_id");

    select pg_temp.p9s_set_privileges('"resource_edge"'::regclass, array['user1']::text[], array[]::text[]);

    -----------------------------------------------------------------------------------------------------------------------
    -- 'resource' transitive edge cache table
    -----------------------------------------------------------------------------------------------------------------------
    create table if not exists "resource_edge_cache" (
      "parent_id" integer not null,
      "child_id" integer not null,
      "permission" bit(4),
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
    select pg_temp.p9s_set_privileges('"resource_edge_cache"'::regclass, array['user1']::text[], array[]::text[]);

    -----------------------------------------------------------------------------------------------------------------------
    -- 'resource' compute recursive permissions, towards parent
    -----------------------------------------------------------------------------------------------------------------------
    create or replace function "resource_edge_cache_parent_compute" ("var_child_id" integer)
      returns setof "resource_edge_cache"
      as $$
      with recursive "search_graph" ("parent_id", "child_id", "permission", "depth", "path") 
      as (
        (values ("var_child_id", "var_child_id", ~  b'0'::bit(4), 0, array[]::integer[])) -- seed
        union all
        select -- recursive query
          "the_edge"."parent_id" as "parent_id",
          "the_search_graph"."child_id" as "child_id",
          ("the_search_graph"."permission"::bit(4) & "the_edge"."permission"::bit(4))::bit(4) as "permission", -- bitwise "and" on permission along a path
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
          "or_bitmap_4" ("the_search_graph"."permission") -- bitwise "or" on permissions between various paths
        from "search_graph" as "the_search_graph"
        group by ("the_search_graph"."parent_id", "the_search_graph"."child_id");

    -- query a recursive table. you can add limit output or use a cursor
    $$
    language sql
    stable;

    grant execute on function "resource_edge_cache_parent_compute" ("var_child_id" integer) to "user1";

    -----------------------------------------------------------------------------------------------------------------------
    -- 'resource' compute recursive permissions, towards child
    -----------------------------------------------------------------------------------------------------------------------
    create or replace function "resource_edge_cache_child_compute" ("var_parent_id" integer)
      returns setof "resource_edge_cache"
      as $$
      with recursive "search_graph" ("parent_id", "child_id", "permission", "depth", "path") 
      as (
        (values ("var_parent_id", "var_parent_id", ~  b'0'::bit(4), 0, array[]::integer[])) -- seed
        union all
        select -- recursive query
          "the_search_graph"."parent_id" as "parent_id",
          "the_edge"."child_id" as "child_id",
          ("the_search_graph"."permission"::bit(4) & "the_edge"."permission"::bit(4))::bit(4) as "permission", -- bitwise "and" on permission along a path
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
          "or_bitmap_4" ("the_search_graph"."permission") -- bitwise "or" on permissions between various paths
        from "search_graph" as "the_search_graph"
        group by ("the_search_graph"."parent_id", "the_search_graph"."child_id");

    -- query a recursive table. you can add limit output or use a cursor
    $$
    language sql
    stable;

    grant execute on function "resource_edge_cache_child_compute" ("var_parent_id" integer) to "user1";

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

    select pg_temp.p9s_set_privileges('"resource_edge_cache_view"'::regclass, array['user1']::text[], array[]::text[]);

    -----------------------------------------------------------------------------------------------------------------------
    -- 'resource' function to rebuild the cache from scratch
    -----------------------------------------------------------------------------------------------------------------------
    create or replace function "resource_edge_cache_backfill" ()
      returns setof "resource_edge_cache"
      as $$
    begin
      perform pg_advisory_xact_lock(hashtext('p9s:public:'));
      -- Backfills usually follow a bulk load, before autovacuum has gathered statistics. Without them the planner can
      -- seq scan the edge table at every step of the recursive walk, which is quadratic in the number of edges.
      -- This has to be plpgsql: a sql function plans every statement before running the first one.
      analyze "resource_node";
      analyze "resource_edge";
      delete from "resource_edge_cache";
      return query
      insert into "resource_edge_cache" ("parent_id", "child_id", "permission")
      select "parent_id", "child_id", "permission"
      from
        "resource_edge_cache_view"
        returning
          *;
    end;
    $$
    language plpgsql
    volatile
    security definer set search_path = "public", pg_temp;


    revoke execute on function "resource_edge_cache_backfill" () from public;


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
      where exists (select 1 from "resource_node" where "resource_node"."id" = combined."parent_id" offset 0)
      and exists (select 1 from "resource_node" where "resource_node"."id" = combined."child_id" offset 0)
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
      where exists (select 1 from "resource_node" where "resource_node"."id" = combined."parent_id" offset 0)
      and exists (select 1 from "resource_node" where "resource_node"."id" = combined."child_id" offset 0)
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
      where exists (select 1 from "resource_node" where "resource_node"."id" = combined."parent_id" offset 0)
      and exists (select 1 from "resource_node" where "resource_node"."id" = combined."child_id" offset 0)
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
      values (new."id", new."id", ~ b'0'::bit(4))
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



      
    -----------------------------------------------------------------------------------------------------------------------
    -- 'role' node table
    -----------------------------------------------------------------------------------------------------------------------
    create table if not exists "role_node" (
      "id" serial unique not null,
      constraint "role_pkey" primary key ("id")
    );

    select pg_temp.p9s_set_privileges('"role_node"'::regclass, array['user1']::text[], array[]::text[]);

    -----------------------------------------------------------------------------------------------------------------------
    -- 'role' edge table
    -----------------------------------------------------------------------------------------------------------------------
    create table if not exists "role_edge" (
      "parent_id" integer not null,
      "child_id" integer not null,
      "permission" bit(4),
      constraint "role_edge_pkey" primary key ("parent_id", "child_id"),
      constraint "role_edge_parent_fkey" foreign key ("parent_id") references "role_node" ("id") on delete cascade on update cascade,
      constraint "role_edge_child_fkey" foreign key ("child_id") references "role_node" ("id") on delete cascade on update cascade
    );

    create index if not exists "role_edge_parent_id_index" on "role_edge" ("parent_id");

    create index if not exists "role_edge_child_id_index" on "role_edge" ("child_id");

    select pg_temp.p9s_set_privileges('"role_edge"'::regclass, array['user1']::text[], array[]::text[]);

    -----------------------------------------------------------------------------------------------------------------------
    -- 'role' transitive edge cache table
    -----------------------------------------------------------------------------------------------------------------------
    create table if not exists "role_edge_cache" (
      "parent_id" integer not null,
      "child_id" integer not null,
      "permission" bit(4),
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
    select pg_temp.p9s_set_privileges('"role_edge_cache"'::regclass, array['user1']::text[], array[]::text[]);

    -----------------------------------------------------------------------------------------------------------------------
    -- 'role' compute recursive permissions, towards parent
    -----------------------------------------------------------------------------------------------------------------------
    create or replace function "role_edge_cache_parent_compute" ("var_child_id" integer)
      returns setof "role_edge_cache"
      as $$
      with recursive "search_graph" ("parent_id", "child_id", "permission", "depth", "path") 
      as (
        (values ("var_child_id", "var_child_id", ~  b'0'::bit(4), 0, array[]::integer[])) -- seed
        union all
        select -- recursive query
          "the_edge"."parent_id" as "parent_id",
          "the_search_graph"."child_id" as "child_id",
          ("the_search_graph"."permission"::bit(4) & "the_edge"."permission"::bit(4))::bit(4) as "permission", -- bitwise "and" on permission along a path
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
          "or_bitmap_4" ("the_search_graph"."permission") -- bitwise "or" on permissions between various paths
        from "search_graph" as "the_search_graph"
        group by ("the_search_graph"."parent_id", "the_search_graph"."child_id");

    -- query a recursive table. you can add limit output or use a cursor
    $$
    language sql
    stable;

    grant execute on function "role_edge_cache_parent_compute" ("var_child_id" integer) to "user1";

    -----------------------------------------------------------------------------------------------------------------------
    -- 'role' compute recursive permissions, towards child
    -----------------------------------------------------------------------------------------------------------------------
    create or replace function "role_edge_cache_child_compute" ("var_parent_id" integer)
      returns setof "role_edge_cache"
      as $$
      with recursive "search_graph" ("parent_id", "child_id", "permission", "depth", "path") 
      as (
        (values ("var_parent_id", "var_parent_id", ~  b'0'::bit(4), 0, array[]::integer[])) -- seed
        union all
        select -- recursive query
          "the_search_graph"."parent_id" as "parent_id",
          "the_edge"."child_id" as "child_id",
          ("the_search_graph"."permission"::bit(4) & "the_edge"."permission"::bit(4))::bit(4) as "permission", -- bitwise "and" on permission along a path
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
          "or_bitmap_4" ("the_search_graph"."permission") -- bitwise "or" on permissions between various paths
        from "search_graph" as "the_search_graph"
        group by ("the_search_graph"."parent_id", "the_search_graph"."child_id");

    -- query a recursive table. you can add limit output or use a cursor
    $$
    language sql
    stable;

    grant execute on function "role_edge_cache_child_compute" ("var_parent_id" integer) to "user1";

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

    select pg_temp.p9s_set_privileges('"role_edge_cache_view"'::regclass, array['user1']::text[], array[]::text[]);

    -----------------------------------------------------------------------------------------------------------------------
    -- 'role' function to rebuild the cache from scratch
    -----------------------------------------------------------------------------------------------------------------------
    create or replace function "role_edge_cache_backfill" ()
      returns setof "role_edge_cache"
      as $$
    begin
      perform pg_advisory_xact_lock(hashtext('p9s:public:'));
      -- Backfills usually follow a bulk load, before autovacuum has gathered statistics. Without them the planner can
      -- seq scan the edge table at every step of the recursive walk, which is quadratic in the number of edges.
      -- This has to be plpgsql: a sql function plans every statement before running the first one.
      analyze "role_node";
      analyze "role_edge";
      delete from "role_edge_cache";
      return query
      insert into "role_edge_cache" ("parent_id", "child_id", "permission")
      select "parent_id", "child_id", "permission"
      from
        "role_edge_cache_view"
        returning
          *;
    end;
    $$
    language plpgsql
    volatile
    security definer set search_path = "public", pg_temp;


    revoke execute on function "role_edge_cache_backfill" () from public;


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
      where exists (select 1 from "role_node" where "role_node"."id" = combined."parent_id" offset 0)
      and exists (select 1 from "role_node" where "role_node"."id" = combined."child_id" offset 0)
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
      where exists (select 1 from "role_node" where "role_node"."id" = combined."parent_id" offset 0)
      and exists (select 1 from "role_node" where "role_node"."id" = combined."child_id" offset 0)
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
      where exists (select 1 from "role_node" where "role_node"."id" = combined."parent_id" offset 0)
      and exists (select 1 from "role_node" where "role_node"."id" = combined."child_id" offset 0)
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
      values (new."id", new."id", ~ b'0'::bit(4))
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



      
    -----------------------------------------------------------------------------------------------------------------------
    -- Assignment from role to resource
    -----------------------------------------------------------------------------------------------------------------------
    create table if not exists "assignment_edge" (
      "resource_id" integer not null,
      "role_id" integer not null,
      "permission" bit(4),
      constraint "assignment_edge_pkey" primary key ("resource_id", "role_id"),
      constraint "assignment_edge_resource_fkey" foreign key ("resource_id") references "resource_node" ("id") on delete cascade on update cascade,
      constraint "assignment_edge_role_fkey" foreign key ("role_id") references "role_node" ("id") on delete cascade on update cascade
    );

    create index if not exists "assignment_edge_resource_id_index" on "assignment_edge" ("resource_id");

    create index if not exists "assignment_edge_role_id_index" on "assignment_edge" ("role_id");

    select pg_temp.p9s_set_privileges('"assignment_edge"'::regclass, array['user1']::text[], array[]::text[]);


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
    -- Table bindings
    -----------------------------------------------------------------------------------------------------------------------

      

      
    alter table "public"."human_user" add column if not exists "role_id" integer unique;
    do $$
    declare
      "the_row" record;
      "the_id" integer;
    begin
      for "the_row" in select ctid from "public"."human_user" where "role_id" is null loop
        insert into "role_node" default values returning "id" into "the_id";
        update "public"."human_user" set "role_id" = "the_id" where ctid = "the_row".ctid;
      end loop;
    end
    $$;
    alter table "public"."human_user" alter column "role_id" set not null;
    alter table "public"."human_user" drop constraint if exists "role_human_user_fkey" cascade;
    alter table "public"."human_user" add constraint "role_human_user_fkey" foreign key ("role_id") references "role_node" ("id") on delete cascade on update cascade;

      

      
    alter table "public"."blog_post" add column if not exists "resource_id" integer unique;
    do $$
    declare
      "the_row" record;
      "the_id" integer;
    begin
      for "the_row" in select ctid from "public"."blog_post" where "resource_id" is null loop
        insert into "resource_node" default values returning "id" into "the_id";
        update "public"."blog_post" set "resource_id" = "the_id" where ctid = "the_row".ctid;
      end loop;
    end
    $$;
    alter table "public"."blog_post" alter column "resource_id" set not null;
    alter table "public"."blog_post" drop constraint if exists "resource_blog_post_fkey" cascade;
    alter table "public"."blog_post" add constraint "resource_blog_post_fkey" foreign key ("resource_id") references "resource_node" ("id") on delete cascade on update cascade;


      
      
      

      
    -----------------------------------------------------------------------------------------------------------------------
    -- Table policies
    -----------------------------------------------------------------------------------------------------------------------

    drop policy if exists "blog_post_user1_select_policy" on "public"."blog_post";
    create policy "blog_post_user1_select_policy" on "public"."blog_post" 
    as permissive for select to "user1" 
    using (
      exists (
        select
          1
        from
          "resource_edge_cache" "var_resource_edge",
          "assignment_edge" "var_assignment_edge",
          "role_edge_cache" "var_role_edge"
        where
          -- Access chain exists
          "blog_post"."resource_id" = "var_resource_edge"."child_id" and
          "var_resource_edge"."parent_id" = "var_assignment_edge"."resource_id" and
          "var_assignment_edge"."role_id" = "var_role_edge"."parent_id" and
          "var_role_edge"."child_id" = "get_current_user_id"() and
          -- With correct permission bit
          ("var_resource_edge"."permission" << 0)::bit = b'1' and
          ("var_assignment_edge"."permission" << 0)::bit = b'1' and
          ("var_role_edge"."permission" << 0)::bit = b'1'
      )
    )
    ;


    drop policy if exists "blog_post_user1_insert_policy" on "public"."blog_post";
    create policy "blog_post_user1_insert_policy" on "public"."blog_post" 
    as permissive for insert to "user1" 

    with check (
      exists (
        select
          1
        from
          "resource_edge_cache" "var_resource_edge",
          "assignment_edge" "var_assignment_edge",
          "role_edge_cache" "var_role_edge"
        where
          -- Access chain exists
          "blog_post"."resource_id" = "var_resource_edge"."child_id" and
          "var_resource_edge"."parent_id" = "var_assignment_edge"."resource_id" and
          "var_assignment_edge"."role_id" = "var_role_edge"."parent_id" and
          "var_role_edge"."child_id" = "get_current_user_id"() and
          -- With correct permission bit
          ("var_resource_edge"."permission" << 1)::bit = b'1' and
          ("var_assignment_edge"."permission" << 1)::bit = b'1' and
          ("var_role_edge"."permission" << 1)::bit = b'1'
      )
    );


    drop policy if exists "blog_post_user1_update_policy" on "public"."blog_post";
    create policy "blog_post_user1_update_policy" on "public"."blog_post" 
    as permissive for update to "user1" 
    using (
      exists (
        select
          1
        from
          "resource_edge_cache" "var_resource_edge",
          "assignment_edge" "var_assignment_edge",
          "role_edge_cache" "var_role_edge"
        where
          -- Access chain exists
          "blog_post"."resource_id" = "var_resource_edge"."child_id" and
          "var_resource_edge"."parent_id" = "var_assignment_edge"."resource_id" and
          "var_assignment_edge"."role_id" = "var_role_edge"."parent_id" and
          "var_role_edge"."child_id" = "get_current_user_id"() and
          -- With correct permission bit
          ("var_resource_edge"."permission" << 1)::bit = b'1' and
          ("var_assignment_edge"."permission" << 1)::bit = b'1' and
          ("var_role_edge"."permission" << 1)::bit = b'1'
      )
    )
    with check (
      exists (
        select
          1
        from
          "resource_edge_cache" "var_resource_edge",
          "assignment_edge" "var_assignment_edge",
          "role_edge_cache" "var_role_edge"
        where
          -- Access chain exists
          "blog_post"."resource_id" = "var_resource_edge"."child_id" and
          "var_resource_edge"."parent_id" = "var_assignment_edge"."resource_id" and
          "var_assignment_edge"."role_id" = "var_role_edge"."parent_id" and
          "var_role_edge"."child_id" = "get_current_user_id"() and
          -- With correct permission bit
          ("var_resource_edge"."permission" << 1)::bit = b'1' and
          ("var_assignment_edge"."permission" << 1)::bit = b'1' and
          ("var_role_edge"."permission" << 1)::bit = b'1'
      )
    );


    drop policy if exists "blog_post_user1_delete_policy" on "public"."blog_post";
    create policy "blog_post_user1_delete_policy" on "public"."blog_post" 
    as permissive for delete to "user1" 
    using (
      exists (
        select
          1
        from
          "resource_edge_cache" "var_resource_edge",
          "assignment_edge" "var_assignment_edge",
          "role_edge_cache" "var_role_edge"
        where
          -- Access chain exists
          "blog_post"."resource_id" = "var_resource_edge"."child_id" and
          "var_resource_edge"."parent_id" = "var_assignment_edge"."resource_id" and
          "var_assignment_edge"."role_id" = "var_role_edge"."parent_id" and
          "var_role_edge"."child_id" = "get_current_user_id"() and
          -- With correct permission bit
          ("var_resource_edge"."permission" << 1)::bit = b'1' and
          ("var_assignment_edge"."permission" << 1)::bit = b'1' and
          ("var_role_edge"."permission" << 1)::bit = b'1'
      )
    )
    ;

        
    -----------------------------------------------------------------------------------------------------------------------
    -- Enable RLS on tables
    -----------------------------------------------------------------------------------------------------------------------

      alter table "public"."blog_post" enable row level security;
      
        

      
    -----------------------------------------------------------------------------------------------------------------------
    -- Cleanup of a previous combined assignment cache
    -----------------------------------------------------------------------------------------------------------------------
    drop function if exists "assignment_trigger_enable" ();
    drop function if exists "assignment_trigger_disable" ();
    drop function if exists "assignment_edge_cache_backfill" ();
    drop function if exists "assignment_edge_insert_trigger_function" ();
    drop function if exists "assignment_edge_update_trigger_function" ();
    drop function if exists "assignment_edge_delete_trigger_function" ();
    drop function if exists "assignment_edge_role_insert_trigger_function" ();
    drop function if exists "assignment_edge_role_update_trigger_function" ();
    drop function if exists "assignment_edge_role_delete_trigger_function" ();
    drop function if exists "assignment_edge_resource_insert_trigger_function" ();
    drop function if exists "assignment_edge_resource_update_trigger_function" ();
    drop function if exists "assignment_edge_resource_delete_trigger_function" ();
    drop view if exists "assignment_edge_cache_view";
    drop table if exists "assignment_edge_cache";


      "
  `);
})