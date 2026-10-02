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

    do $$
    declare
      "the_columns" text := (
        select string_agg(format('%s.%I', "the_binding"."table_name", "the_binding"."column_name"), ', ' order by "the_binding"."table_name")
        from (values 
        ('"public"."blog_post"', 'resource_id', '"resource_id_seq"', 'resource'),
        ('"public"."human_user"', 'role_id', '"role_id_seq"', 'role')) as "the_binding" ("table_name", "column_name", "sequence_name", "kind")
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

    -- Truncate skips row and statement triggers, it would leave the graph pointing at rows that no longer exist
    create or replace function "truncate_guard_trigger_function"()
    returns trigger as $$
    begin
      raise exception 'p9s: % cannot be truncated while p9s triggers are enabled, delete its rows instead, or disable the triggers and enable them again afterwards', tg_table_name;
    end;
    $$ language plpgsql;


    revoke execute on function "truncate_guard_trigger_function" () from public;



      
    -----------------------------------------------------------------------------------------------------------------------
    -- 'resource' ids
    -----------------------------------------------------------------------------------------------------------------------

    create sequence if not exists "resource_id_seq" as integer;
    grant usage, select on sequence "resource_id_seq" to "user1";


    -----------------------------------------------------------------------------------------------------------------------
    -- 'resource' edge table
    -----------------------------------------------------------------------------------------------------------------------
    -- Endpoints are ids of bound rows, checked by the triggers below. Home edges are the ones p9s keeps in sync with the
    -- parent column of their child row.
    create table if not exists "resource_edge" (
      "parent_id" integer not null,
      "child_id" integer not null,
      "permission" bit(4),
      "home" boolean not null default false,
      constraint "resource_edge_pkey" primary key ("parent_id", "child_id")
    );

    alter table "resource_edge" add column if not exists "home" boolean not null default false;

    create index if not exists "resource_edge_parent_id_index" on "resource_edge" ("parent_id");

    create index if not exists "resource_edge_child_id_index" on "resource_edge" ("child_id");

    select pg_temp.p9s_set_privileges('"resource_edge"'::regclass, array['user1']::text[], array[]::text[]);

    -----------------------------------------------------------------------------------------------------------------------
    -- 'resource' transitive edge cache table
    -----------------------------------------------------------------------------------------------------------------------
    -- Every bound row has a self row (id, id, all bits), which also makes the cache the registry of ids in use
    create table if not exists "resource_edge_cache" (
      "parent_id" integer not null,
      "child_id" integer not null,
      "permission" bit(4),
      constraint "resource_edge_cache_pkey" primary key ("parent_id", "child_id")
    );

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
    -- 'role' ids
    -----------------------------------------------------------------------------------------------------------------------

    create sequence if not exists "role_id_seq" as integer;
    grant usage, select on sequence "role_id_seq" to "user1";


    -----------------------------------------------------------------------------------------------------------------------
    -- 'role' edge table
    -----------------------------------------------------------------------------------------------------------------------
    -- Endpoints are ids of bound rows, checked by the triggers below. Home edges are the ones p9s keeps in sync with the
    -- parent column of their child row.
    create table if not exists "role_edge" (
      "parent_id" integer not null,
      "child_id" integer not null,
      "permission" bit(4),
      "home" boolean not null default false,
      constraint "role_edge_pkey" primary key ("parent_id", "child_id")
    );

    alter table "role_edge" add column if not exists "home" boolean not null default false;

    create index if not exists "role_edge_parent_id_index" on "role_edge" ("parent_id");

    create index if not exists "role_edge_child_id_index" on "role_edge" ("child_id");

    select pg_temp.p9s_set_privileges('"role_edge"'::regclass, array['user1']::text[], array[]::text[]);

    -----------------------------------------------------------------------------------------------------------------------
    -- 'role' transitive edge cache table
    -----------------------------------------------------------------------------------------------------------------------
    -- Every bound row has a self row (id, id, all bits), which also makes the cache the registry of ids in use
    create table if not exists "role_edge_cache" (
      "parent_id" integer not null,
      "child_id" integer not null,
      "permission" bit(4),
      constraint "role_edge_cache_pkey" primary key ("parent_id", "child_id")
    );

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
    -- Assignment from role to resource
    -----------------------------------------------------------------------------------------------------------------------
    create table if not exists "assignment_edge" (
      "resource_id" integer not null,
      "role_id" integer not null,
      "permission" bit(4),
      constraint "assignment_edge_pkey" primary key ("resource_id", "role_id")
    );

    create index if not exists "assignment_edge_resource_id_index" on "assignment_edge" ("resource_id");

    create index if not exists "assignment_edge_role_id_index" on "assignment_edge" ("role_id");

    select pg_temp.p9s_set_privileges('"assignment_edge"'::regclass, array['user1']::text[], array[]::text[]);


      
    -----------------------------------------------------------------------------------------------------------------------
    -- Table bindings
    -----------------------------------------------------------------------------------------------------------------------

    alter table "public"."blog_post" add column if not exists "resource_id" integer unique;

    alter table "public"."human_user" add column if not exists "role_id" integer unique;

    do $$
    declare
      "the_max" integer := (select max("the_id"."id") from (select "resource_id" from "public"."blog_post") as "the_id" ("id"));
    begin
      if "the_max" >= (select case when "is_called" then "last_value" + 1 else "last_value" end from "resource_id_seq") then
        perform setval('"resource_id_seq"'::regclass, "the_max");
      end if;
    end
    $$;

    do $$
    declare
      "the_max" integer := (select max("the_id"."id") from (select "role_id" from "public"."human_user") as "the_id" ("id"));
    begin
      if "the_max" >= (select case when "is_called" then "last_value" + 1 else "last_value" end from "role_id_seq") then
        perform setval('"role_id_seq"'::regclass, "the_max");
      end if;
    end
    $$;

    do $$
    begin
      if not (select "atthasdef" from pg_attribute where "attrelid" = '"public"."blog_post"'::regclass and "attname" = 'resource_id') then
        alter table "public"."blog_post" alter column "resource_id" set default nextval('"resource_id_seq"'::regclass);
      end if;
    end
    $$;
    update "public"."blog_post" set "resource_id" = default where "resource_id" is null;
    alter table "public"."blog_post" alter column "resource_id" set not null;


    do $$
    begin
      if not (select "atthasdef" from pg_attribute where "attrelid" = '"public"."human_user"'::regclass and "attname" = 'role_id') then
        alter table "public"."human_user" alter column "role_id" set default nextval('"role_id_seq"'::regclass);
      end if;
    end
    $$;
    update "public"."human_user" set "role_id" = default where "role_id" is null;
    alter table "public"."human_user" alter column "role_id" set not null;



      
    -----------------------------------------------------------------------------------------------------------------------
    -- 'resource' view of all transitive edges, computed from scratch
    -----------------------------------------------------------------------------------------------------------------------
    -- This direction is easy, since we have less parents than children in general
    create or replace view "resource_edge_cache_view" as
    select
      "parent_permissions"."parent_id" as "parent_id",
      "parent_permissions"."child_id" as "child_id",
      "parent_permissions"."permission" as "permission"
    from
      (select "resource_id" from "public"."blog_post") as "the_node" ("id"),
      lateral "resource_edge_cache_parent_compute" ("the_node"."id") as "parent_permissions";

    select pg_temp.p9s_set_privileges('"resource_edge_cache_view"'::regclass, array['user1']::text[], array[]::text[]);


      
    -----------------------------------------------------------------------------------------------------------------------
    -- 'role' view of all transitive edges, computed from scratch
    -----------------------------------------------------------------------------------------------------------------------
    -- This direction is easy, since we have less parents than children in general
    create or replace view "role_edge_cache_view" as
    select
      "parent_permissions"."parent_id" as "parent_id",
      "parent_permissions"."child_id" as "child_id",
      "parent_permissions"."permission" as "permission"
    from
      (select "role_id" from "public"."human_user") as "the_node" ("id"),
      lateral "role_edge_cache_parent_compute" ("the_node"."id") as "parent_permissions";

    select pg_temp.p9s_set_privileges('"role_edge_cache_view"'::regclass, array['user1']::text[], array[]::text[]);


      
    -----------------------------------------------------------------------------------------------------------------------
    -- Upgrade from node tables: 'resource'
    -----------------------------------------------------------------------------------------------------------------------
    do $$
    declare
      "the_count" bigint;
    begin
      if to_regclass('resource_node') is not null then
        select count(*) into "the_count" from "resource_node" as "the_node" where not exists (select from "public"."blog_post" as "the_row" where "the_row"."resource_id" = "the_node"."id");
        if "the_count" > 0 then
          raise exception 'p9s: % % nodes are not a row of a bound table. Bind a table that holds them (a table with only an id column is enough) or delete them, then run the migration again.', "the_count", 'resource';
        end if;
        alter table "resource_edge" drop constraint if exists "resource_edge_parent_fkey";
        alter table "resource_edge" drop constraint if exists "resource_edge_child_fkey";
        alter table "resource_edge_cache" drop constraint if exists "resource_edge_cache_parent_pkey";
        alter table "resource_edge_cache" drop constraint if exists "resource_edge_cache_child_pkey";
        alter table "assignment_edge" drop constraint if exists "assignment_edge_resource_fkey";
        alter table if exists "assignment_edge_cache" drop constraint if exists "assignment_edge_cache_resource_fkey";
        alter table "public"."blog_post" drop constraint if exists "resource_blog_post_fkey";
        -- Recreated below. The bootstrap rebuilds the cache, there is no need to refresh it edge by edge here.
        drop trigger if exists "10_resource_edge_insert_trigger" on "resource_edge";
        drop trigger if exists "10_resource_edge_update_trigger" on "resource_edge";
        drop trigger if exists "10_resource_edge_delete_trigger" on "resource_edge";
        -- Edges that match a parent column become the home edges of their rows
        
        drop table "resource_node";
        drop function if exists "resource_node_insert_trigger_function"();
        drop function if exists "resource_node_update_trigger_function"();
        drop function if exists "resource_node_delete_trigger_function"();
      end if;
    end
    $$;


      
    -----------------------------------------------------------------------------------------------------------------------
    -- Upgrade from node tables: 'role'
    -----------------------------------------------------------------------------------------------------------------------
    do $$
    declare
      "the_count" bigint;
    begin
      if to_regclass('role_node') is not null then
        select count(*) into "the_count" from "role_node" as "the_node" where not exists (select from "public"."human_user" as "the_row" where "the_row"."role_id" = "the_node"."id");
        if "the_count" > 0 then
          raise exception 'p9s: % % nodes are not a row of a bound table. Bind a table that holds them (a table with only an id column is enough) or delete them, then run the migration again.', "the_count", 'role';
        end if;
        alter table "role_edge" drop constraint if exists "role_edge_parent_fkey";
        alter table "role_edge" drop constraint if exists "role_edge_child_fkey";
        alter table "role_edge_cache" drop constraint if exists "role_edge_cache_parent_pkey";
        alter table "role_edge_cache" drop constraint if exists "role_edge_cache_child_pkey";
        alter table "assignment_edge" drop constraint if exists "assignment_edge_role_fkey";
        alter table if exists "assignment_edge_cache" drop constraint if exists "assignment_edge_cache_role_fkey";
        alter table "public"."human_user" drop constraint if exists "role_human_user_fkey";
        -- Recreated below. The bootstrap rebuilds the cache, there is no need to refresh it edge by edge here.
        drop trigger if exists "10_role_edge_insert_trigger" on "role_edge";
        drop trigger if exists "10_role_edge_update_trigger" on "role_edge";
        drop trigger if exists "10_role_edge_delete_trigger" on "role_edge";
        -- Edges that match a parent column become the home edges of their rows
        
        drop table "role_node";
        drop function if exists "role_node_insert_trigger_function"();
        drop function if exists "role_node_update_trigger_function"();
        drop function if exists "role_node_delete_trigger_function"();
      end if;
    end
    $$;


      
    -----------------------------------------------------------------------------------------------------------------------
    -- 'resource' function to rebuild the cache from scratch
    -----------------------------------------------------------------------------------------------------------------------
    create or replace function "resource_edge_cache_backfill" ()
      returns setof "resource_edge_cache"
      as $$
    begin
      perform pg_advisory_xact_lock(hashtext('p9s:public:'));
      if exists (select from (select "resource_id" from "public"."blog_post") as "the_id" ("id") group by "the_id"."id" having count(*) > 1) then
        raise exception 'p9s: the % id % is used by more than one bound row', 'resource',
          (select "the_id"."id" from (select "resource_id" from "public"."blog_post") as "the_id" ("id") group by "the_id"."id" having count(*) > 1 limit 1)
          using errcode = 'unique_violation';
      end if;
      if exists (select from "resource_edge" as "the_edge" where "the_edge"."parent_id" not in (select "resource_id" from "public"."blog_post") or "the_edge"."child_id" not in (select "resource_id" from "public"."blog_post")) then
        raise exception 'p9s: % edges connect ids that are not rows of bound tables', 'resource' using errcode = 'foreign_key_violation';
      end if;
      if exists (select from "assignment_edge" as "the_assignment" where "the_assignment"."resource_id" not in (select "resource_id" from "public"."blog_post")) then
        raise exception 'p9s: assignments reference % ids that are not rows of bound tables', 'resource' using errcode = 'foreign_key_violation';
      end if;
      -- Backfills usually follow a bulk load, before autovacuum has gathered statistics. Without them the planner can
      -- seq scan the edge table at every step of the recursive walk, which is quadratic in the number of edges.
      -- This has to be plpgsql: a sql function plans every statement before running the first one.
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
    -- 'resource' Update cache when edges change
    -----------------------------------------------------------------------------------------------------------------------


    create or replace function "resource_edge_insert_trigger_function"()
    returns trigger as $$
    begin

      if not exists (select from "p9s_new_rows") then
        return null;
      end if;
      
      
      if current_setting('transaction_isolation') <> 'read committed' then
        raise exception 'p9s: permission graph writes must run in READ COMMITTED isolation, not %', current_setting('transaction_isolation');
      end if;
      perform pg_advisory_xact_lock(hashtext('p9s:public:'));

      if exists (select from "p9s_new_rows" as "the_edge"
        left join "resource_edge_cache" as "the_parent_self" on "the_parent_self"."parent_id" = "the_edge"."parent_id" and "the_parent_self"."child_id" = "the_edge"."parent_id"
        left join "resource_edge_cache" as "the_child_self" on "the_child_self"."parent_id" = "the_edge"."child_id" and "the_child_self"."child_id" = "the_edge"."child_id"
        where "the_parent_self"."parent_id" is null or "the_child_self"."parent_id" is null) then
        raise exception 'p9s: the % edge % does not connect two rows of bound tables', 'resource',
          (select format('%s -> %s', "the_edge"."parent_id", "the_edge"."child_id") from "p9s_new_rows" as "the_edge"
        left join "resource_edge_cache" as "the_parent_self" on "the_parent_self"."parent_id" = "the_edge"."parent_id" and "the_parent_self"."child_id" = "the_edge"."parent_id"
        left join "resource_edge_cache" as "the_child_self" on "the_child_self"."parent_id" = "the_edge"."child_id" and "the_child_self"."child_id" = "the_edge"."child_id"
        where "the_parent_self"."parent_id" is null or "the_child_self"."parent_id" is null limit 1)
          using errcode = 'foreign_key_violation';
      end if;

      with recursive "affected" ("parent_id") as (
        (select "child_id" from "p9s_new_rows")
        union
        select "the_edge"."child_id"
        from "resource_edge" as "the_edge"
        join "affected" on "the_edge"."parent_id" = "affected"."parent_id"
      ),
      "upstream" ("parent_id") as (
        (select "parent_id" from "p9s_new_rows")
        union
        select "the_edge"."parent_id"
        from "resource_edge" as "the_edge"
        join "upstream" on "the_edge"."child_id" = "upstream"."parent_id"
      ),
      "walk" ("parent_id", "child_id", "permission", "inside", "depth", "path") as (
        select "affected"."parent_id", "affected"."parent_id", ~ b'0'::bit(4), true, 0, array["affected"."parent_id"]
        from "affected"
        union all
        select
          "the_edge"."parent_id",
          "walk"."child_id",
          ("walk"."permission" & "the_edge"."permission")::bit(4), -- bitwise "and" on permission along a path
          "the_edge"."parent_id" in (select "parent_id" from "affected"),
          "walk"."depth" + 1,
          "walk"."path" || "the_edge"."parent_id"
        from "walk"
        join "resource_edge" as "the_edge" on "the_edge"."child_id" = "walk"."parent_id"
        where "walk"."inside"
        and "the_edge"."parent_id" <> all ("walk"."path") -- prevent from cycling
        and "walk"."depth" <= 16 -- max search depth
      ),
      "fresh" as (
        select "the_path"."parent_id", "the_path"."child_id", "or_bitmap_4" ("the_path"."permission") as "permission" -- bitwise "or" on permissions between various paths
        from (
          select "walk"."parent_id", "walk"."child_id", "walk"."permission"
          from "walk"
          where "walk"."inside"
          and ("walk"."parent_id" in (select "parent_id" from "upstream")) is true
          union all
          select "the_edge_cache"."parent_id", "walk"."child_id", ("the_edge_cache"."permission" & "walk"."permission")::bit(4)
          from "walk"
          join "resource_edge_cache" as "the_edge_cache" on "the_edge_cache"."child_id" = "walk"."parent_id"
          where not "walk"."inside"
          and ("the_edge_cache"."parent_id" in (select "parent_id" from "upstream")) is true
        ) as "the_path"
        group by ("the_path"."parent_id", "the_path"."child_id")
      ),
      -- An array is computed once and drives a single index scan. As a join, the planner can prefer a whole table scan
      -- when it overestimates the rows of "fresh".
      "stale" as (
        delete from "resource_edge_cache"
        where "resource_edge_cache"."child_id" = any (array (select "parent_id" from "affected"))
        and ("resource_edge_cache"."parent_id" in (select "parent_id" from "upstream")) is true
        and ("resource_edge_cache"."parent_id", "resource_edge_cache"."child_id") not in (select "fresh"."parent_id", "fresh"."child_id" from "fresh")
      )
      insert into "resource_edge_cache" ("parent_id", "child_id", "permission")
      select "fresh"."parent_id", "fresh"."child_id", "fresh"."permission"
      from "fresh"
      where not exists (
        select 1 from "resource_edge_cache" as "the_edge_cache"
        where "the_edge_cache"."parent_id" = "fresh"."parent_id"
        and "the_edge_cache"."child_id" = "fresh"."child_id"
        and "the_edge_cache"."permission" = "fresh"."permission"
      )
      on conflict on constraint "resource_edge_cache_pkey"
      do update set "permission" = excluded."permission";
      return null;
    end;
    $$ language plpgsql security definer set search_path = "public", pg_temp
    set enable_hashjoin = off
    set enable_mergejoin = off;


    revoke execute on function "resource_edge_insert_trigger_function" () from public;



    drop trigger if exists "10_resource_edge_insert_trigger" on "resource_edge";
    create trigger "10_resource_edge_insert_trigger"
    after insert on "resource_edge"
    referencing new table as "p9s_new_rows"
    for each statement execute function "resource_edge_insert_trigger_function"();



    create or replace function "resource_edge_update_trigger_function"()
    returns trigger as $$
    begin

      if not exists (select from "p9s_new_rows") then
        return null;
      end if;
      
      
      if current_setting('transaction_isolation') <> 'read committed' then
        raise exception 'p9s: permission graph writes must run in READ COMMITTED isolation, not %', current_setting('transaction_isolation');
      end if;
      perform pg_advisory_xact_lock(hashtext('p9s:public:'));

      if exists (select from "p9s_new_rows" as "the_edge"
        left join "resource_edge_cache" as "the_parent_self" on "the_parent_self"."parent_id" = "the_edge"."parent_id" and "the_parent_self"."child_id" = "the_edge"."parent_id"
        left join "resource_edge_cache" as "the_child_self" on "the_child_self"."parent_id" = "the_edge"."child_id" and "the_child_self"."child_id" = "the_edge"."child_id"
        where "the_parent_self"."parent_id" is null or "the_child_self"."parent_id" is null) then
        raise exception 'p9s: the % edge % does not connect two rows of bound tables', 'resource',
          (select format('%s -> %s', "the_edge"."parent_id", "the_edge"."child_id") from "p9s_new_rows" as "the_edge"
        left join "resource_edge_cache" as "the_parent_self" on "the_parent_self"."parent_id" = "the_edge"."parent_id" and "the_parent_self"."child_id" = "the_edge"."parent_id"
        left join "resource_edge_cache" as "the_child_self" on "the_child_self"."parent_id" = "the_edge"."child_id" and "the_child_self"."child_id" = "the_edge"."child_id"
        where "the_parent_self"."parent_id" is null or "the_child_self"."parent_id" is null limit 1)
          using errcode = 'foreign_key_violation';
      end if;

      with recursive "affected" ("parent_id") as (
        (select "child_id" from "p9s_old_rows" union select "child_id" from "p9s_new_rows")
        union
        select "the_edge"."child_id"
        from "resource_edge" as "the_edge"
        join "affected" on "the_edge"."parent_id" = "affected"."parent_id"
      ),
      "upstream" ("parent_id") as (
        (select "parent_id" from "p9s_old_rows" union select "parent_id" from "p9s_new_rows")
        union
        select "the_edge"."parent_id"
        from "resource_edge" as "the_edge"
        join "upstream" on "the_edge"."child_id" = "upstream"."parent_id"
      ),
      "walk" ("parent_id", "child_id", "permission", "inside", "depth", "path") as (
        select "affected"."parent_id", "affected"."parent_id", ~ b'0'::bit(4), true, 0, array["affected"."parent_id"]
        from "affected"
        union all
        select
          "the_edge"."parent_id",
          "walk"."child_id",
          ("walk"."permission" & "the_edge"."permission")::bit(4), -- bitwise "and" on permission along a path
          "the_edge"."parent_id" in (select "parent_id" from "affected"),
          "walk"."depth" + 1,
          "walk"."path" || "the_edge"."parent_id"
        from "walk"
        join "resource_edge" as "the_edge" on "the_edge"."child_id" = "walk"."parent_id"
        where "walk"."inside"
        and "the_edge"."parent_id" <> all ("walk"."path") -- prevent from cycling
        and "walk"."depth" <= 16 -- max search depth
      ),
      "fresh" as (
        select "the_path"."parent_id", "the_path"."child_id", "or_bitmap_4" ("the_path"."permission") as "permission" -- bitwise "or" on permissions between various paths
        from (
          select "walk"."parent_id", "walk"."child_id", "walk"."permission"
          from "walk"
          where "walk"."inside"
          and ("walk"."parent_id" in (select "parent_id" from "upstream")) is true
          union all
          select "the_edge_cache"."parent_id", "walk"."child_id", ("the_edge_cache"."permission" & "walk"."permission")::bit(4)
          from "walk"
          join "resource_edge_cache" as "the_edge_cache" on "the_edge_cache"."child_id" = "walk"."parent_id"
          where not "walk"."inside"
          and ("the_edge_cache"."parent_id" in (select "parent_id" from "upstream")) is true
        ) as "the_path"
        group by ("the_path"."parent_id", "the_path"."child_id")
      ),
      -- An array is computed once and drives a single index scan. As a join, the planner can prefer a whole table scan
      -- when it overestimates the rows of "fresh".
      "stale" as (
        delete from "resource_edge_cache"
        where "resource_edge_cache"."child_id" = any (array (select "parent_id" from "affected"))
        and ("resource_edge_cache"."parent_id" in (select "parent_id" from "upstream")) is true
        and ("resource_edge_cache"."parent_id", "resource_edge_cache"."child_id") not in (select "fresh"."parent_id", "fresh"."child_id" from "fresh")
      )
      insert into "resource_edge_cache" ("parent_id", "child_id", "permission")
      select "fresh"."parent_id", "fresh"."child_id", "fresh"."permission"
      from "fresh"
      where not exists (
        select 1 from "resource_edge_cache" as "the_edge_cache"
        where "the_edge_cache"."parent_id" = "fresh"."parent_id"
        and "the_edge_cache"."child_id" = "fresh"."child_id"
        and "the_edge_cache"."permission" = "fresh"."permission"
      )
      on conflict on constraint "resource_edge_cache_pkey"
      do update set "permission" = excluded."permission";
      return null;
    end;
    $$ language plpgsql security definer set search_path = "public", pg_temp
    set enable_hashjoin = off
    set enable_mergejoin = off;


    revoke execute on function "resource_edge_update_trigger_function" () from public;



    drop trigger if exists "10_resource_edge_update_trigger" on "resource_edge";
    create trigger "10_resource_edge_update_trigger"
    after update on "resource_edge"
    referencing old table as "p9s_old_rows" new table as "p9s_new_rows"
    for each statement execute function "resource_edge_update_trigger_function"();



    create or replace function "resource_edge_delete_trigger_function"()
    returns trigger as $$
    begin

      if not exists (select from "p9s_old_rows") then
        return null;
      end if;
      
      
      if current_setting('transaction_isolation') <> 'read committed' then
        raise exception 'p9s: permission graph writes must run in READ COMMITTED isolation, not %', current_setting('transaction_isolation');
      end if;
      perform pg_advisory_xact_lock(hashtext('p9s:public:'));


      with recursive "affected" ("parent_id") as (
        (select "child_id" from "p9s_old_rows")
        union
        select "the_edge"."child_id"
        from "resource_edge" as "the_edge"
        join "affected" on "the_edge"."parent_id" = "affected"."parent_id"
      ),
      "upstream" ("parent_id") as (
        (select "parent_id" from "p9s_old_rows")
        union
        select "the_edge"."parent_id"
        from "resource_edge" as "the_edge"
        join "upstream" on "the_edge"."child_id" = "upstream"."parent_id"
      ),
      "walk" ("parent_id", "child_id", "permission", "inside", "depth", "path") as (
        select "affected"."parent_id", "affected"."parent_id", ~ b'0'::bit(4), true, 0, array["affected"."parent_id"]
        from "affected"
        union all
        select
          "the_edge"."parent_id",
          "walk"."child_id",
          ("walk"."permission" & "the_edge"."permission")::bit(4), -- bitwise "and" on permission along a path
          "the_edge"."parent_id" in (select "parent_id" from "affected"),
          "walk"."depth" + 1,
          "walk"."path" || "the_edge"."parent_id"
        from "walk"
        join "resource_edge" as "the_edge" on "the_edge"."child_id" = "walk"."parent_id"
        where "walk"."inside"
        and "the_edge"."parent_id" <> all ("walk"."path") -- prevent from cycling
        and "walk"."depth" <= 16 -- max search depth
      ),
      "fresh" as (
        select "the_path"."parent_id", "the_path"."child_id", "or_bitmap_4" ("the_path"."permission") as "permission" -- bitwise "or" on permissions between various paths
        from (
          select "walk"."parent_id", "walk"."child_id", "walk"."permission"
          from "walk"
          where "walk"."inside"
          and ("walk"."parent_id" in (select "parent_id" from "upstream")) is true
          union all
          select "the_edge_cache"."parent_id", "walk"."child_id", ("the_edge_cache"."permission" & "walk"."permission")::bit(4)
          from "walk"
          join "resource_edge_cache" as "the_edge_cache" on "the_edge_cache"."child_id" = "walk"."parent_id"
          where not "walk"."inside"
          and ("the_edge_cache"."parent_id" in (select "parent_id" from "upstream")) is true
        ) as "the_path"
        group by ("the_path"."parent_id", "the_path"."child_id")
      ),
      -- An array is computed once and drives a single index scan. As a join, the planner can prefer a whole table scan
      -- when it overestimates the rows of "fresh".
      "stale" as (
        delete from "resource_edge_cache"
        where "resource_edge_cache"."child_id" = any (array (select "parent_id" from "affected"))
        and ("resource_edge_cache"."parent_id" in (select "parent_id" from "upstream")) is true
        and ("resource_edge_cache"."parent_id", "resource_edge_cache"."child_id") not in (select "fresh"."parent_id", "fresh"."child_id" from "fresh")
      )
      insert into "resource_edge_cache" ("parent_id", "child_id", "permission")
      select "fresh"."parent_id", "fresh"."child_id", "fresh"."permission"
      from "fresh"
      where not exists (
        select 1 from "resource_edge_cache" as "the_edge_cache"
        where "the_edge_cache"."parent_id" = "fresh"."parent_id"
        and "the_edge_cache"."child_id" = "fresh"."child_id"
        and "the_edge_cache"."permission" = "fresh"."permission"
      )
      on conflict on constraint "resource_edge_cache_pkey"
      do update set "permission" = excluded."permission";
      return null;
    end;
    $$ language plpgsql security definer set search_path = "public", pg_temp
    set enable_hashjoin = off
    set enable_mergejoin = off;


    revoke execute on function "resource_edge_delete_trigger_function" () from public;



    drop trigger if exists "10_resource_edge_delete_trigger" on "resource_edge";
    create trigger "10_resource_edge_delete_trigger"
    after delete on "resource_edge"
    referencing old table as "p9s_old_rows"
    for each statement execute function "resource_edge_delete_trigger_function"();


    drop trigger if exists "05_truncate_guard_trigger" on "resource_edge";
    create trigger "05_truncate_guard_trigger" before truncate on "resource_edge" for each statement execute function "truncate_guard_trigger_function"();

    -----------------------------------------------------------------------------------------------------------------------
    -- 'resource' home edges are written by p9s only
    -----------------------------------------------------------------------------------------------------------------------
    -- p9s writes them from the triggers of bound tables, one level deeper than a statement sent by a client
    create or replace function "resource_edge_guard_trigger_function"()
    returns trigger as $$
    begin
      if pg_trigger_depth() > 1 then
        return case when tg_op = 'DELETE' then old else new end;
      end if;
      if tg_op = 'INSERT' then
        raise exception 'p9s: home edges are created by p9s from the parent column of their row'
          using errcode = 'insufficient_privilege';
      elsif tg_op = 'UPDATE' then
        if new."home" and not old."home" then
          raise exception 'p9s: an edge cannot be made a home edge, home edges follow the parent column of their row'
            using errcode = 'insufficient_privilege';
        end if;
        -- Changing a home edge makes it a regular edge, which moving or deleting its row leaves alone
        new."home" := false;
        return new;
      end if;
      raise exception 'p9s: home edges are removed by moving or deleting their row. To delete one apart from its row, first make it a regular edge with update ... set home = false'
        using errcode = 'insufficient_privilege';
    end;
    $$ language plpgsql;


    revoke execute on function "resource_edge_guard_trigger_function" () from public;


    drop trigger if exists "05_resource_edge_guard_insert_trigger" on "resource_edge";
    create trigger "05_resource_edge_guard_insert_trigger" before insert on "resource_edge" for each row when (new."home") execute function "resource_edge_guard_trigger_function"();
    drop trigger if exists "05_resource_edge_guard_update_trigger" on "resource_edge";
    create trigger "05_resource_edge_guard_update_trigger" before update on "resource_edge" for each row when (old."home" or new."home") execute function "resource_edge_guard_trigger_function"();
    drop trigger if exists "05_resource_edge_guard_delete_trigger" on "resource_edge";
    create trigger "05_resource_edge_guard_delete_trigger" before delete on "resource_edge" for each row when (old."home") execute function "resource_edge_guard_trigger_function"();

    -----------------------------------------------------------------------------------------------------------------------
    -- 'resource' rows of bound tables
    -----------------------------------------------------------------------------------------------------------------------

    -- 'blog_post' rows are 'resource' nodes

    create or replace function "blog_post_resource_insert_trigger_function"()
    returns trigger as $$
    begin

      if not exists (select from "p9s_new_rows") then
        return null;
      end if;
      if exists (select from "p9s_new_rows" as "the_row"
        join "resource_edge_cache" as "the_self" on "the_self"."parent_id" = "the_row"."resource_id" and "the_self"."child_id" = "the_row"."resource_id") then
        raise exception 'p9s: the % id % is already used by another row', 'resource',
          (select "the_row"."resource_id" from "p9s_new_rows" as "the_row"
        join "resource_edge_cache" as "the_self" on "the_self"."parent_id" = "the_row"."resource_id" and "the_self"."child_id" = "the_row"."resource_id" limit 1)
          using errcode = 'unique_violation';
      end if;
      -- A new row cannot be referenced by others yet, so its self row needs no lock
      insert into "resource_edge_cache" ("parent_id", "child_id", "permission")
      select "the_row"."resource_id", "the_row"."resource_id", ~ b'0'::bit(4) from "p9s_new_rows" as "the_row";
      
      return null;
    end;
    $$ language plpgsql security definer set search_path = "public", pg_temp
    set enable_hashjoin = off
    set enable_mergejoin = off;


    revoke execute on function "blog_post_resource_insert_trigger_function" () from public;



    drop trigger if exists "10_blog_post_resource_insert_trigger" on "public"."blog_post";
    create trigger "10_blog_post_resource_insert_trigger"
    after insert on "public"."blog_post"
    referencing new table as "p9s_new_rows"
    for each statement execute function "blog_post_resource_insert_trigger_function"();


    create or replace function "blog_post_resource_update_trigger_function"()
    returns trigger as $$
    begin

      if not exists (select from "p9s_new_rows") then
        return null;
      end if;
      if exists (select "the_row"."resource_id" from "p9s_old_rows" as "the_row" except select "the_row"."resource_id" from "p9s_new_rows" as "the_row") then
        raise exception 'p9s: the % id of a % row cannot change', 'resource', 'blog_post'
          using errcode = 'integrity_constraint_violation';
      end if;
      
      return null;
    end;
    $$ language plpgsql security definer set search_path = "public", pg_temp
    set enable_hashjoin = off
    set enable_mergejoin = off;


    revoke execute on function "blog_post_resource_update_trigger_function" () from public;



    drop trigger if exists "10_blog_post_resource_update_trigger" on "public"."blog_post";
    create trigger "10_blog_post_resource_update_trigger"
    after update on "public"."blog_post"
    referencing old table as "p9s_old_rows" new table as "p9s_new_rows"
    for each statement execute function "blog_post_resource_update_trigger_function"();


    create or replace function "blog_post_resource_delete_trigger_function"()
    returns trigger as $$
    begin

      if not exists (select from "p9s_old_rows") then
        return null;
      end if;
      
      if current_setting('transaction_isolation') <> 'read committed' then
        raise exception 'p9s: permission graph writes must run in READ COMMITTED isolation, not %', current_setting('transaction_isolation');
      end if;
      perform pg_advisory_xact_lock(hashtext('p9s:public:'));
      delete from "assignment_edge" as "the_assignment"
      using "p9s_old_rows" as "the_row"
      where "the_assignment"."resource_id" = "the_row"."resource_id";
      delete from "resource_edge" as "the_edge"
      using (
        select "the_edge"."parent_id", "the_edge"."child_id" from "p9s_old_rows" as "the_row" join "resource_edge" as "the_edge" on "the_edge"."parent_id" = "the_row"."resource_id"
        union
        select "the_edge"."parent_id", "the_edge"."child_id" from "p9s_old_rows" as "the_row" join "resource_edge" as "the_edge" on "the_edge"."child_id" = "the_row"."resource_id"
      ) as "the_removed"
      where "the_edge"."parent_id" = "the_removed"."parent_id" and "the_edge"."child_id" = "the_removed"."child_id";
      delete from "resource_edge_cache" as "the_self"
      using "p9s_old_rows" as "the_row"
      where "the_self"."parent_id" = "the_row"."resource_id" and "the_self"."child_id" = "the_row"."resource_id";
      return null;
    end;
    $$ language plpgsql security definer set search_path = "public", pg_temp
    set enable_hashjoin = off
    set enable_mergejoin = off;


    revoke execute on function "blog_post_resource_delete_trigger_function" () from public;



    drop trigger if exists "10_blog_post_resource_delete_trigger" on "public"."blog_post";
    create trigger "10_blog_post_resource_delete_trigger"
    after delete on "public"."blog_post"
    referencing old table as "p9s_old_rows"
    for each statement execute function "blog_post_resource_delete_trigger_function"();

    drop trigger if exists "05_truncate_guard_trigger" on "public"."blog_post";
    create trigger "05_truncate_guard_trigger" before truncate on "public"."blog_post" for each statement execute function "truncate_guard_trigger_function"();


    -----------------------------------------------------------------------------------------------------------------------
    -- 'resource' functions to enable / disable triggers
    -----------------------------------------------------------------------------------------------------------------------
    create or replace function "resource_trigger_disable"()
    returns void as $$
    begin
      alter table "resource_edge" disable trigger "10_resource_edge_insert_trigger";
      alter table "resource_edge" disable trigger "10_resource_edge_update_trigger";
      alter table "resource_edge" disable trigger "10_resource_edge_delete_trigger";
      alter table "resource_edge" disable trigger "05_resource_edge_guard_insert_trigger";
      alter table "resource_edge" disable trigger "05_resource_edge_guard_update_trigger";
      alter table "resource_edge" disable trigger "05_resource_edge_guard_delete_trigger";
      alter table "resource_edge" disable trigger "05_truncate_guard_trigger";
      alter table "public"."blog_post" disable trigger "10_blog_post_resource_insert_trigger";
      alter table "public"."blog_post" disable trigger "10_blog_post_resource_update_trigger";
      alter table "public"."blog_post" disable trigger "10_blog_post_resource_delete_trigger";
      alter table "public"."blog_post" disable trigger "05_truncate_guard_trigger";
      alter table "assignment_edge" disable trigger "05_assignment_edge_validate_insert_trigger";
      alter table "assignment_edge" disable trigger "05_assignment_edge_validate_update_trigger";
      alter table "assignment_edge" disable trigger "05_truncate_guard_trigger";
    end;
    $$ language plpgsql security definer set search_path = "public", pg_temp;


    revoke execute on function "resource_trigger_disable" () from public;


    -- Also brings the graph up to date with rows written while the triggers were disabled
    create or replace function "resource_trigger_enable"()
    returns void as $$
    begin
      perform pg_advisory_xact_lock(hashtext('p9s:public:'));
      alter table "resource_edge" disable trigger "10_resource_edge_insert_trigger";
      alter table "resource_edge" disable trigger "10_resource_edge_update_trigger";
      alter table "resource_edge" disable trigger "10_resource_edge_delete_trigger";
      alter table "resource_edge" disable trigger "05_resource_edge_guard_insert_trigger";
      alter table "resource_edge" disable trigger "05_resource_edge_guard_update_trigger";
      alter table "resource_edge" disable trigger "05_resource_edge_guard_delete_trigger";
      alter table "resource_edge" disable trigger "05_truncate_guard_trigger";
      alter table "public"."blog_post" disable trigger "10_blog_post_resource_insert_trigger";
      alter table "public"."blog_post" disable trigger "10_blog_post_resource_update_trigger";
      alter table "public"."blog_post" disable trigger "10_blog_post_resource_delete_trigger";
      alter table "public"."blog_post" disable trigger "05_truncate_guard_trigger";
      alter table "assignment_edge" disable trigger "05_assignment_edge_validate_insert_trigger";
      alter table "assignment_edge" disable trigger "05_assignment_edge_validate_update_trigger";
      alter table "assignment_edge" disable trigger "05_truncate_guard_trigger";
      
      -- No parent column: the home edges of these rows become regular edges
      update "resource_edge" as "the_edge" set "home" = false
      from "public"."blog_post" as "the_row"
      where "the_edge"."child_id" = "the_row"."resource_id" and "the_edge"."home";
      alter table "resource_edge" enable trigger "10_resource_edge_insert_trigger";
      alter table "resource_edge" enable trigger "10_resource_edge_update_trigger";
      alter table "resource_edge" enable trigger "10_resource_edge_delete_trigger";
      alter table "resource_edge" enable trigger "05_resource_edge_guard_insert_trigger";
      alter table "resource_edge" enable trigger "05_resource_edge_guard_update_trigger";
      alter table "resource_edge" enable trigger "05_resource_edge_guard_delete_trigger";
      alter table "resource_edge" enable trigger "05_truncate_guard_trigger";
      alter table "public"."blog_post" enable trigger "10_blog_post_resource_insert_trigger";
      alter table "public"."blog_post" enable trigger "10_blog_post_resource_update_trigger";
      alter table "public"."blog_post" enable trigger "10_blog_post_resource_delete_trigger";
      alter table "public"."blog_post" enable trigger "05_truncate_guard_trigger";
      alter table "assignment_edge" enable trigger "05_assignment_edge_validate_insert_trigger";
      alter table "assignment_edge" enable trigger "05_assignment_edge_validate_update_trigger";
      alter table "assignment_edge" enable trigger "05_truncate_guard_trigger";
      perform "resource_edge_cache_backfill"();
    end;
    $$ language plpgsql security definer set search_path = "public", pg_temp;


    revoke execute on function "resource_trigger_enable" () from public;



      
    -----------------------------------------------------------------------------------------------------------------------
    -- 'role' function to rebuild the cache from scratch
    -----------------------------------------------------------------------------------------------------------------------
    create or replace function "role_edge_cache_backfill" ()
      returns setof "role_edge_cache"
      as $$
    begin
      perform pg_advisory_xact_lock(hashtext('p9s:public:'));
      if exists (select from (select "role_id" from "public"."human_user") as "the_id" ("id") group by "the_id"."id" having count(*) > 1) then
        raise exception 'p9s: the % id % is used by more than one bound row', 'role',
          (select "the_id"."id" from (select "role_id" from "public"."human_user") as "the_id" ("id") group by "the_id"."id" having count(*) > 1 limit 1)
          using errcode = 'unique_violation';
      end if;
      if exists (select from "role_edge" as "the_edge" where "the_edge"."parent_id" not in (select "role_id" from "public"."human_user") or "the_edge"."child_id" not in (select "role_id" from "public"."human_user")) then
        raise exception 'p9s: % edges connect ids that are not rows of bound tables', 'role' using errcode = 'foreign_key_violation';
      end if;
      if exists (select from "assignment_edge" as "the_assignment" where "the_assignment"."role_id" not in (select "role_id" from "public"."human_user")) then
        raise exception 'p9s: assignments reference % ids that are not rows of bound tables', 'role' using errcode = 'foreign_key_violation';
      end if;
      -- Backfills usually follow a bulk load, before autovacuum has gathered statistics. Without them the planner can
      -- seq scan the edge table at every step of the recursive walk, which is quadratic in the number of edges.
      -- This has to be plpgsql: a sql function plans every statement before running the first one.
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
    -- 'role' Update cache when edges change
    -----------------------------------------------------------------------------------------------------------------------


    create or replace function "role_edge_insert_trigger_function"()
    returns trigger as $$
    begin

      if not exists (select from "p9s_new_rows") then
        return null;
      end if;
      
      
      if current_setting('transaction_isolation') <> 'read committed' then
        raise exception 'p9s: permission graph writes must run in READ COMMITTED isolation, not %', current_setting('transaction_isolation');
      end if;
      perform pg_advisory_xact_lock(hashtext('p9s:public:'));

      if exists (select from "p9s_new_rows" as "the_edge"
        left join "role_edge_cache" as "the_parent_self" on "the_parent_self"."parent_id" = "the_edge"."parent_id" and "the_parent_self"."child_id" = "the_edge"."parent_id"
        left join "role_edge_cache" as "the_child_self" on "the_child_self"."parent_id" = "the_edge"."child_id" and "the_child_self"."child_id" = "the_edge"."child_id"
        where "the_parent_self"."parent_id" is null or "the_child_self"."parent_id" is null) then
        raise exception 'p9s: the % edge % does not connect two rows of bound tables', 'role',
          (select format('%s -> %s', "the_edge"."parent_id", "the_edge"."child_id") from "p9s_new_rows" as "the_edge"
        left join "role_edge_cache" as "the_parent_self" on "the_parent_self"."parent_id" = "the_edge"."parent_id" and "the_parent_self"."child_id" = "the_edge"."parent_id"
        left join "role_edge_cache" as "the_child_self" on "the_child_self"."parent_id" = "the_edge"."child_id" and "the_child_self"."child_id" = "the_edge"."child_id"
        where "the_parent_self"."parent_id" is null or "the_child_self"."parent_id" is null limit 1)
          using errcode = 'foreign_key_violation';
      end if;

      with recursive "affected" ("parent_id") as (
        (select "child_id" from "p9s_new_rows")
        union
        select "the_edge"."child_id"
        from "role_edge" as "the_edge"
        join "affected" on "the_edge"."parent_id" = "affected"."parent_id"
      ),
      "upstream" ("parent_id") as (
        (select "parent_id" from "p9s_new_rows")
        union
        select "the_edge"."parent_id"
        from "role_edge" as "the_edge"
        join "upstream" on "the_edge"."child_id" = "upstream"."parent_id"
      ),
      "walk" ("parent_id", "child_id", "permission", "inside", "depth", "path") as (
        select "affected"."parent_id", "affected"."parent_id", ~ b'0'::bit(4), true, 0, array["affected"."parent_id"]
        from "affected"
        union all
        select
          "the_edge"."parent_id",
          "walk"."child_id",
          ("walk"."permission" & "the_edge"."permission")::bit(4), -- bitwise "and" on permission along a path
          "the_edge"."parent_id" in (select "parent_id" from "affected"),
          "walk"."depth" + 1,
          "walk"."path" || "the_edge"."parent_id"
        from "walk"
        join "role_edge" as "the_edge" on "the_edge"."child_id" = "walk"."parent_id"
        where "walk"."inside"
        and "the_edge"."parent_id" <> all ("walk"."path") -- prevent from cycling
        and "walk"."depth" <= 16 -- max search depth
      ),
      "fresh" as (
        select "the_path"."parent_id", "the_path"."child_id", "or_bitmap_4" ("the_path"."permission") as "permission" -- bitwise "or" on permissions between various paths
        from (
          select "walk"."parent_id", "walk"."child_id", "walk"."permission"
          from "walk"
          where "walk"."inside"
          and ("walk"."parent_id" in (select "parent_id" from "upstream")) is true
          union all
          select "the_edge_cache"."parent_id", "walk"."child_id", ("the_edge_cache"."permission" & "walk"."permission")::bit(4)
          from "walk"
          join "role_edge_cache" as "the_edge_cache" on "the_edge_cache"."child_id" = "walk"."parent_id"
          where not "walk"."inside"
          and ("the_edge_cache"."parent_id" in (select "parent_id" from "upstream")) is true
        ) as "the_path"
        group by ("the_path"."parent_id", "the_path"."child_id")
      ),
      -- An array is computed once and drives a single index scan. As a join, the planner can prefer a whole table scan
      -- when it overestimates the rows of "fresh".
      "stale" as (
        delete from "role_edge_cache"
        where "role_edge_cache"."child_id" = any (array (select "parent_id" from "affected"))
        and ("role_edge_cache"."parent_id" in (select "parent_id" from "upstream")) is true
        and ("role_edge_cache"."parent_id", "role_edge_cache"."child_id") not in (select "fresh"."parent_id", "fresh"."child_id" from "fresh")
      )
      insert into "role_edge_cache" ("parent_id", "child_id", "permission")
      select "fresh"."parent_id", "fresh"."child_id", "fresh"."permission"
      from "fresh"
      where not exists (
        select 1 from "role_edge_cache" as "the_edge_cache"
        where "the_edge_cache"."parent_id" = "fresh"."parent_id"
        and "the_edge_cache"."child_id" = "fresh"."child_id"
        and "the_edge_cache"."permission" = "fresh"."permission"
      )
      on conflict on constraint "role_edge_cache_pkey"
      do update set "permission" = excluded."permission";
      return null;
    end;
    $$ language plpgsql security definer set search_path = "public", pg_temp
    set enable_hashjoin = off
    set enable_mergejoin = off;


    revoke execute on function "role_edge_insert_trigger_function" () from public;



    drop trigger if exists "10_role_edge_insert_trigger" on "role_edge";
    create trigger "10_role_edge_insert_trigger"
    after insert on "role_edge"
    referencing new table as "p9s_new_rows"
    for each statement execute function "role_edge_insert_trigger_function"();



    create or replace function "role_edge_update_trigger_function"()
    returns trigger as $$
    begin

      if not exists (select from "p9s_new_rows") then
        return null;
      end if;
      
      
      if current_setting('transaction_isolation') <> 'read committed' then
        raise exception 'p9s: permission graph writes must run in READ COMMITTED isolation, not %', current_setting('transaction_isolation');
      end if;
      perform pg_advisory_xact_lock(hashtext('p9s:public:'));

      if exists (select from "p9s_new_rows" as "the_edge"
        left join "role_edge_cache" as "the_parent_self" on "the_parent_self"."parent_id" = "the_edge"."parent_id" and "the_parent_self"."child_id" = "the_edge"."parent_id"
        left join "role_edge_cache" as "the_child_self" on "the_child_self"."parent_id" = "the_edge"."child_id" and "the_child_self"."child_id" = "the_edge"."child_id"
        where "the_parent_self"."parent_id" is null or "the_child_self"."parent_id" is null) then
        raise exception 'p9s: the % edge % does not connect two rows of bound tables', 'role',
          (select format('%s -> %s', "the_edge"."parent_id", "the_edge"."child_id") from "p9s_new_rows" as "the_edge"
        left join "role_edge_cache" as "the_parent_self" on "the_parent_self"."parent_id" = "the_edge"."parent_id" and "the_parent_self"."child_id" = "the_edge"."parent_id"
        left join "role_edge_cache" as "the_child_self" on "the_child_self"."parent_id" = "the_edge"."child_id" and "the_child_self"."child_id" = "the_edge"."child_id"
        where "the_parent_self"."parent_id" is null or "the_child_self"."parent_id" is null limit 1)
          using errcode = 'foreign_key_violation';
      end if;

      with recursive "affected" ("parent_id") as (
        (select "child_id" from "p9s_old_rows" union select "child_id" from "p9s_new_rows")
        union
        select "the_edge"."child_id"
        from "role_edge" as "the_edge"
        join "affected" on "the_edge"."parent_id" = "affected"."parent_id"
      ),
      "upstream" ("parent_id") as (
        (select "parent_id" from "p9s_old_rows" union select "parent_id" from "p9s_new_rows")
        union
        select "the_edge"."parent_id"
        from "role_edge" as "the_edge"
        join "upstream" on "the_edge"."child_id" = "upstream"."parent_id"
      ),
      "walk" ("parent_id", "child_id", "permission", "inside", "depth", "path") as (
        select "affected"."parent_id", "affected"."parent_id", ~ b'0'::bit(4), true, 0, array["affected"."parent_id"]
        from "affected"
        union all
        select
          "the_edge"."parent_id",
          "walk"."child_id",
          ("walk"."permission" & "the_edge"."permission")::bit(4), -- bitwise "and" on permission along a path
          "the_edge"."parent_id" in (select "parent_id" from "affected"),
          "walk"."depth" + 1,
          "walk"."path" || "the_edge"."parent_id"
        from "walk"
        join "role_edge" as "the_edge" on "the_edge"."child_id" = "walk"."parent_id"
        where "walk"."inside"
        and "the_edge"."parent_id" <> all ("walk"."path") -- prevent from cycling
        and "walk"."depth" <= 16 -- max search depth
      ),
      "fresh" as (
        select "the_path"."parent_id", "the_path"."child_id", "or_bitmap_4" ("the_path"."permission") as "permission" -- bitwise "or" on permissions between various paths
        from (
          select "walk"."parent_id", "walk"."child_id", "walk"."permission"
          from "walk"
          where "walk"."inside"
          and ("walk"."parent_id" in (select "parent_id" from "upstream")) is true
          union all
          select "the_edge_cache"."parent_id", "walk"."child_id", ("the_edge_cache"."permission" & "walk"."permission")::bit(4)
          from "walk"
          join "role_edge_cache" as "the_edge_cache" on "the_edge_cache"."child_id" = "walk"."parent_id"
          where not "walk"."inside"
          and ("the_edge_cache"."parent_id" in (select "parent_id" from "upstream")) is true
        ) as "the_path"
        group by ("the_path"."parent_id", "the_path"."child_id")
      ),
      -- An array is computed once and drives a single index scan. As a join, the planner can prefer a whole table scan
      -- when it overestimates the rows of "fresh".
      "stale" as (
        delete from "role_edge_cache"
        where "role_edge_cache"."child_id" = any (array (select "parent_id" from "affected"))
        and ("role_edge_cache"."parent_id" in (select "parent_id" from "upstream")) is true
        and ("role_edge_cache"."parent_id", "role_edge_cache"."child_id") not in (select "fresh"."parent_id", "fresh"."child_id" from "fresh")
      )
      insert into "role_edge_cache" ("parent_id", "child_id", "permission")
      select "fresh"."parent_id", "fresh"."child_id", "fresh"."permission"
      from "fresh"
      where not exists (
        select 1 from "role_edge_cache" as "the_edge_cache"
        where "the_edge_cache"."parent_id" = "fresh"."parent_id"
        and "the_edge_cache"."child_id" = "fresh"."child_id"
        and "the_edge_cache"."permission" = "fresh"."permission"
      )
      on conflict on constraint "role_edge_cache_pkey"
      do update set "permission" = excluded."permission";
      return null;
    end;
    $$ language plpgsql security definer set search_path = "public", pg_temp
    set enable_hashjoin = off
    set enable_mergejoin = off;


    revoke execute on function "role_edge_update_trigger_function" () from public;



    drop trigger if exists "10_role_edge_update_trigger" on "role_edge";
    create trigger "10_role_edge_update_trigger"
    after update on "role_edge"
    referencing old table as "p9s_old_rows" new table as "p9s_new_rows"
    for each statement execute function "role_edge_update_trigger_function"();



    create or replace function "role_edge_delete_trigger_function"()
    returns trigger as $$
    begin

      if not exists (select from "p9s_old_rows") then
        return null;
      end if;
      
      
      if current_setting('transaction_isolation') <> 'read committed' then
        raise exception 'p9s: permission graph writes must run in READ COMMITTED isolation, not %', current_setting('transaction_isolation');
      end if;
      perform pg_advisory_xact_lock(hashtext('p9s:public:'));


      with recursive "affected" ("parent_id") as (
        (select "child_id" from "p9s_old_rows")
        union
        select "the_edge"."child_id"
        from "role_edge" as "the_edge"
        join "affected" on "the_edge"."parent_id" = "affected"."parent_id"
      ),
      "upstream" ("parent_id") as (
        (select "parent_id" from "p9s_old_rows")
        union
        select "the_edge"."parent_id"
        from "role_edge" as "the_edge"
        join "upstream" on "the_edge"."child_id" = "upstream"."parent_id"
      ),
      "walk" ("parent_id", "child_id", "permission", "inside", "depth", "path") as (
        select "affected"."parent_id", "affected"."parent_id", ~ b'0'::bit(4), true, 0, array["affected"."parent_id"]
        from "affected"
        union all
        select
          "the_edge"."parent_id",
          "walk"."child_id",
          ("walk"."permission" & "the_edge"."permission")::bit(4), -- bitwise "and" on permission along a path
          "the_edge"."parent_id" in (select "parent_id" from "affected"),
          "walk"."depth" + 1,
          "walk"."path" || "the_edge"."parent_id"
        from "walk"
        join "role_edge" as "the_edge" on "the_edge"."child_id" = "walk"."parent_id"
        where "walk"."inside"
        and "the_edge"."parent_id" <> all ("walk"."path") -- prevent from cycling
        and "walk"."depth" <= 16 -- max search depth
      ),
      "fresh" as (
        select "the_path"."parent_id", "the_path"."child_id", "or_bitmap_4" ("the_path"."permission") as "permission" -- bitwise "or" on permissions between various paths
        from (
          select "walk"."parent_id", "walk"."child_id", "walk"."permission"
          from "walk"
          where "walk"."inside"
          and ("walk"."parent_id" in (select "parent_id" from "upstream")) is true
          union all
          select "the_edge_cache"."parent_id", "walk"."child_id", ("the_edge_cache"."permission" & "walk"."permission")::bit(4)
          from "walk"
          join "role_edge_cache" as "the_edge_cache" on "the_edge_cache"."child_id" = "walk"."parent_id"
          where not "walk"."inside"
          and ("the_edge_cache"."parent_id" in (select "parent_id" from "upstream")) is true
        ) as "the_path"
        group by ("the_path"."parent_id", "the_path"."child_id")
      ),
      -- An array is computed once and drives a single index scan. As a join, the planner can prefer a whole table scan
      -- when it overestimates the rows of "fresh".
      "stale" as (
        delete from "role_edge_cache"
        where "role_edge_cache"."child_id" = any (array (select "parent_id" from "affected"))
        and ("role_edge_cache"."parent_id" in (select "parent_id" from "upstream")) is true
        and ("role_edge_cache"."parent_id", "role_edge_cache"."child_id") not in (select "fresh"."parent_id", "fresh"."child_id" from "fresh")
      )
      insert into "role_edge_cache" ("parent_id", "child_id", "permission")
      select "fresh"."parent_id", "fresh"."child_id", "fresh"."permission"
      from "fresh"
      where not exists (
        select 1 from "role_edge_cache" as "the_edge_cache"
        where "the_edge_cache"."parent_id" = "fresh"."parent_id"
        and "the_edge_cache"."child_id" = "fresh"."child_id"
        and "the_edge_cache"."permission" = "fresh"."permission"
      )
      on conflict on constraint "role_edge_cache_pkey"
      do update set "permission" = excluded."permission";
      return null;
    end;
    $$ language plpgsql security definer set search_path = "public", pg_temp
    set enable_hashjoin = off
    set enable_mergejoin = off;


    revoke execute on function "role_edge_delete_trigger_function" () from public;



    drop trigger if exists "10_role_edge_delete_trigger" on "role_edge";
    create trigger "10_role_edge_delete_trigger"
    after delete on "role_edge"
    referencing old table as "p9s_old_rows"
    for each statement execute function "role_edge_delete_trigger_function"();


    drop trigger if exists "05_truncate_guard_trigger" on "role_edge";
    create trigger "05_truncate_guard_trigger" before truncate on "role_edge" for each statement execute function "truncate_guard_trigger_function"();

    -----------------------------------------------------------------------------------------------------------------------
    -- 'role' home edges are written by p9s only
    -----------------------------------------------------------------------------------------------------------------------
    -- p9s writes them from the triggers of bound tables, one level deeper than a statement sent by a client
    create or replace function "role_edge_guard_trigger_function"()
    returns trigger as $$
    begin
      if pg_trigger_depth() > 1 then
        return case when tg_op = 'DELETE' then old else new end;
      end if;
      if tg_op = 'INSERT' then
        raise exception 'p9s: home edges are created by p9s from the parent column of their row'
          using errcode = 'insufficient_privilege';
      elsif tg_op = 'UPDATE' then
        if new."home" and not old."home" then
          raise exception 'p9s: an edge cannot be made a home edge, home edges follow the parent column of their row'
            using errcode = 'insufficient_privilege';
        end if;
        -- Changing a home edge makes it a regular edge, which moving or deleting its row leaves alone
        new."home" := false;
        return new;
      end if;
      raise exception 'p9s: home edges are removed by moving or deleting their row. To delete one apart from its row, first make it a regular edge with update ... set home = false'
        using errcode = 'insufficient_privilege';
    end;
    $$ language plpgsql;


    revoke execute on function "role_edge_guard_trigger_function" () from public;


    drop trigger if exists "05_role_edge_guard_insert_trigger" on "role_edge";
    create trigger "05_role_edge_guard_insert_trigger" before insert on "role_edge" for each row when (new."home") execute function "role_edge_guard_trigger_function"();
    drop trigger if exists "05_role_edge_guard_update_trigger" on "role_edge";
    create trigger "05_role_edge_guard_update_trigger" before update on "role_edge" for each row when (old."home" or new."home") execute function "role_edge_guard_trigger_function"();
    drop trigger if exists "05_role_edge_guard_delete_trigger" on "role_edge";
    create trigger "05_role_edge_guard_delete_trigger" before delete on "role_edge" for each row when (old."home") execute function "role_edge_guard_trigger_function"();

    -----------------------------------------------------------------------------------------------------------------------
    -- 'role' rows of bound tables
    -----------------------------------------------------------------------------------------------------------------------

    -- 'human_user' rows are 'role' nodes

    create or replace function "human_user_role_insert_trigger_function"()
    returns trigger as $$
    begin

      if not exists (select from "p9s_new_rows") then
        return null;
      end if;
      if exists (select from "p9s_new_rows" as "the_row"
        join "role_edge_cache" as "the_self" on "the_self"."parent_id" = "the_row"."role_id" and "the_self"."child_id" = "the_row"."role_id") then
        raise exception 'p9s: the % id % is already used by another row', 'role',
          (select "the_row"."role_id" from "p9s_new_rows" as "the_row"
        join "role_edge_cache" as "the_self" on "the_self"."parent_id" = "the_row"."role_id" and "the_self"."child_id" = "the_row"."role_id" limit 1)
          using errcode = 'unique_violation';
      end if;
      -- A new row cannot be referenced by others yet, so its self row needs no lock
      insert into "role_edge_cache" ("parent_id", "child_id", "permission")
      select "the_row"."role_id", "the_row"."role_id", ~ b'0'::bit(4) from "p9s_new_rows" as "the_row";
      
      return null;
    end;
    $$ language plpgsql security definer set search_path = "public", pg_temp
    set enable_hashjoin = off
    set enable_mergejoin = off;


    revoke execute on function "human_user_role_insert_trigger_function" () from public;



    drop trigger if exists "10_human_user_role_insert_trigger" on "public"."human_user";
    create trigger "10_human_user_role_insert_trigger"
    after insert on "public"."human_user"
    referencing new table as "p9s_new_rows"
    for each statement execute function "human_user_role_insert_trigger_function"();


    create or replace function "human_user_role_update_trigger_function"()
    returns trigger as $$
    begin

      if not exists (select from "p9s_new_rows") then
        return null;
      end if;
      if exists (select "the_row"."role_id" from "p9s_old_rows" as "the_row" except select "the_row"."role_id" from "p9s_new_rows" as "the_row") then
        raise exception 'p9s: the % id of a % row cannot change', 'role', 'human_user'
          using errcode = 'integrity_constraint_violation';
      end if;
      
      return null;
    end;
    $$ language plpgsql security definer set search_path = "public", pg_temp
    set enable_hashjoin = off
    set enable_mergejoin = off;


    revoke execute on function "human_user_role_update_trigger_function" () from public;



    drop trigger if exists "10_human_user_role_update_trigger" on "public"."human_user";
    create trigger "10_human_user_role_update_trigger"
    after update on "public"."human_user"
    referencing old table as "p9s_old_rows" new table as "p9s_new_rows"
    for each statement execute function "human_user_role_update_trigger_function"();


    create or replace function "human_user_role_delete_trigger_function"()
    returns trigger as $$
    begin

      if not exists (select from "p9s_old_rows") then
        return null;
      end if;
      
      if current_setting('transaction_isolation') <> 'read committed' then
        raise exception 'p9s: permission graph writes must run in READ COMMITTED isolation, not %', current_setting('transaction_isolation');
      end if;
      perform pg_advisory_xact_lock(hashtext('p9s:public:'));
      delete from "assignment_edge" as "the_assignment"
      using "p9s_old_rows" as "the_row"
      where "the_assignment"."role_id" = "the_row"."role_id";
      delete from "role_edge" as "the_edge"
      using (
        select "the_edge"."parent_id", "the_edge"."child_id" from "p9s_old_rows" as "the_row" join "role_edge" as "the_edge" on "the_edge"."parent_id" = "the_row"."role_id"
        union
        select "the_edge"."parent_id", "the_edge"."child_id" from "p9s_old_rows" as "the_row" join "role_edge" as "the_edge" on "the_edge"."child_id" = "the_row"."role_id"
      ) as "the_removed"
      where "the_edge"."parent_id" = "the_removed"."parent_id" and "the_edge"."child_id" = "the_removed"."child_id";
      delete from "role_edge_cache" as "the_self"
      using "p9s_old_rows" as "the_row"
      where "the_self"."parent_id" = "the_row"."role_id" and "the_self"."child_id" = "the_row"."role_id";
      return null;
    end;
    $$ language plpgsql security definer set search_path = "public", pg_temp
    set enable_hashjoin = off
    set enable_mergejoin = off;


    revoke execute on function "human_user_role_delete_trigger_function" () from public;



    drop trigger if exists "10_human_user_role_delete_trigger" on "public"."human_user";
    create trigger "10_human_user_role_delete_trigger"
    after delete on "public"."human_user"
    referencing old table as "p9s_old_rows"
    for each statement execute function "human_user_role_delete_trigger_function"();

    drop trigger if exists "05_truncate_guard_trigger" on "public"."human_user";
    create trigger "05_truncate_guard_trigger" before truncate on "public"."human_user" for each statement execute function "truncate_guard_trigger_function"();


    -----------------------------------------------------------------------------------------------------------------------
    -- 'role' functions to enable / disable triggers
    -----------------------------------------------------------------------------------------------------------------------
    create or replace function "role_trigger_disable"()
    returns void as $$
    begin
      alter table "role_edge" disable trigger "10_role_edge_insert_trigger";
      alter table "role_edge" disable trigger "10_role_edge_update_trigger";
      alter table "role_edge" disable trigger "10_role_edge_delete_trigger";
      alter table "role_edge" disable trigger "05_role_edge_guard_insert_trigger";
      alter table "role_edge" disable trigger "05_role_edge_guard_update_trigger";
      alter table "role_edge" disable trigger "05_role_edge_guard_delete_trigger";
      alter table "role_edge" disable trigger "05_truncate_guard_trigger";
      alter table "public"."human_user" disable trigger "10_human_user_role_insert_trigger";
      alter table "public"."human_user" disable trigger "10_human_user_role_update_trigger";
      alter table "public"."human_user" disable trigger "10_human_user_role_delete_trigger";
      alter table "public"."human_user" disable trigger "05_truncate_guard_trigger";
    end;
    $$ language plpgsql security definer set search_path = "public", pg_temp;


    revoke execute on function "role_trigger_disable" () from public;


    -- Also brings the graph up to date with rows written while the triggers were disabled
    create or replace function "role_trigger_enable"()
    returns void as $$
    begin
      perform pg_advisory_xact_lock(hashtext('p9s:public:'));
      alter table "role_edge" disable trigger "10_role_edge_insert_trigger";
      alter table "role_edge" disable trigger "10_role_edge_update_trigger";
      alter table "role_edge" disable trigger "10_role_edge_delete_trigger";
      alter table "role_edge" disable trigger "05_role_edge_guard_insert_trigger";
      alter table "role_edge" disable trigger "05_role_edge_guard_update_trigger";
      alter table "role_edge" disable trigger "05_role_edge_guard_delete_trigger";
      alter table "role_edge" disable trigger "05_truncate_guard_trigger";
      alter table "public"."human_user" disable trigger "10_human_user_role_insert_trigger";
      alter table "public"."human_user" disable trigger "10_human_user_role_update_trigger";
      alter table "public"."human_user" disable trigger "10_human_user_role_delete_trigger";
      alter table "public"."human_user" disable trigger "05_truncate_guard_trigger";
      
      -- No parent column: the home edges of these rows become regular edges
      update "role_edge" as "the_edge" set "home" = false
      from "public"."human_user" as "the_row"
      where "the_edge"."child_id" = "the_row"."role_id" and "the_edge"."home";
      alter table "role_edge" enable trigger "10_role_edge_insert_trigger";
      alter table "role_edge" enable trigger "10_role_edge_update_trigger";
      alter table "role_edge" enable trigger "10_role_edge_delete_trigger";
      alter table "role_edge" enable trigger "05_role_edge_guard_insert_trigger";
      alter table "role_edge" enable trigger "05_role_edge_guard_update_trigger";
      alter table "role_edge" enable trigger "05_role_edge_guard_delete_trigger";
      alter table "role_edge" enable trigger "05_truncate_guard_trigger";
      alter table "public"."human_user" enable trigger "10_human_user_role_insert_trigger";
      alter table "public"."human_user" enable trigger "10_human_user_role_update_trigger";
      alter table "public"."human_user" enable trigger "10_human_user_role_delete_trigger";
      alter table "public"."human_user" enable trigger "05_truncate_guard_trigger";
      perform "role_edge_cache_backfill"();
    end;
    $$ language plpgsql security definer set search_path = "public", pg_temp;


    revoke execute on function "role_trigger_enable" () from public;



      
    -----------------------------------------------------------------------------------------------------------------------
    -- Assignments connect rows of bound tables
    -----------------------------------------------------------------------------------------------------------------------

    create or replace function "assignment_edge_validate_trigger_function"()
    returns trigger as $$
    begin

      if not exists (select from "p9s_new_rows") then
        return null;
      end if;
      
      if current_setting('transaction_isolation') <> 'read committed' then
        raise exception 'p9s: permission graph writes must run in READ COMMITTED isolation, not %', current_setting('transaction_isolation');
      end if;
      perform pg_advisory_xact_lock(hashtext('p9s:public:'));

      if exists (select from "p9s_new_rows" as "the_assignment"
        left join "resource_edge_cache" as "the_resource_self" on "the_resource_self"."parent_id" = "the_assignment"."resource_id" and "the_resource_self"."child_id" = "the_assignment"."resource_id"
        left join "role_edge_cache" as "the_role_self" on "the_role_self"."parent_id" = "the_assignment"."role_id" and "the_role_self"."child_id" = "the_assignment"."role_id"
        where "the_resource_self"."parent_id" is null or "the_role_self"."parent_id" is null) then
        raise exception 'p9s: the assignment of resource % to role % does not reference rows of bound tables',
          (select "the_assignment"."resource_id" from "p9s_new_rows" as "the_assignment"
        left join "resource_edge_cache" as "the_resource_self" on "the_resource_self"."parent_id" = "the_assignment"."resource_id" and "the_resource_self"."child_id" = "the_assignment"."resource_id"
        left join "role_edge_cache" as "the_role_self" on "the_role_self"."parent_id" = "the_assignment"."role_id" and "the_role_self"."child_id" = "the_assignment"."role_id"
        where "the_resource_self"."parent_id" is null or "the_role_self"."parent_id" is null limit 1), (select "the_assignment"."role_id" from "p9s_new_rows" as "the_assignment"
        left join "resource_edge_cache" as "the_resource_self" on "the_resource_self"."parent_id" = "the_assignment"."resource_id" and "the_resource_self"."child_id" = "the_assignment"."resource_id"
        left join "role_edge_cache" as "the_role_self" on "the_role_self"."parent_id" = "the_assignment"."role_id" and "the_role_self"."child_id" = "the_assignment"."role_id"
        where "the_resource_self"."parent_id" is null or "the_role_self"."parent_id" is null limit 1)
          using errcode = 'foreign_key_violation';
      end if;
      return null;
    end;
    $$ language plpgsql security definer set search_path = "public", pg_temp
    set enable_hashjoin = off
    set enable_mergejoin = off;


    revoke execute on function "assignment_edge_validate_trigger_function" () from public;



    drop trigger if exists "05_assignment_edge_validate_insert_trigger" on "assignment_edge";
    create trigger "05_assignment_edge_validate_insert_trigger"
    after insert on "assignment_edge"
    referencing new table as "p9s_new_rows"
    for each statement execute function "assignment_edge_validate_trigger_function"();


    drop trigger if exists "05_assignment_edge_validate_update_trigger" on "assignment_edge";
    create trigger "05_assignment_edge_validate_update_trigger"
    after update on "assignment_edge"
    referencing old table as "p9s_old_rows" new table as "p9s_new_rows"
    for each statement execute function "assignment_edge_validate_trigger_function"();


    drop trigger if exists "05_truncate_guard_trigger" on "assignment_edge";
    create trigger "05_truncate_guard_trigger" before truncate on "assignment_edge" for each statement execute function "truncate_guard_trigger_function"();


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


      
    -----------------------------------------------------------------------------------------------------------------------
    -- Bootstrap caches
    -----------------------------------------------------------------------------------------------------------------------

    select "resource_trigger_enable"();
    select "role_trigger_enable"();


      "
  `);
})