import { expect, test } from 'bun:test'
import { compile } from "pg-sql2";
import { createMigration } from './generation'

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
    -- Special functions
    -----------------------------------------------------------------------------------------------------------------------
    drop aggregate if exists "or_bitmap_4" (bit);

    create aggregate "or_bitmap_4" (
      basetype = bit,
      sfunc = bitor,
      stype = bit,
      initcond = '0000'
    );

    grant execute on function "or_bitmap_4" (bit) to "user1";


      
    -----------------------------------------------------------------------------------------------------------------------
    -- 'resource' node table
    -----------------------------------------------------------------------------------------------------------------------
    drop table if exists "resource_node" cascade;

    create table "resource_node" (
      "id" serial unique not null,
      constraint "resource_pkey" primary key ("id")
    );

    grant select, insert, update, delete on table "resource_node" to "user1";

    -----------------------------------------------------------------------------------------------------------------------
    -- 'resource' edge table
    -----------------------------------------------------------------------------------------------------------------------
    drop table if exists "resource_edge" cascade;

    create table "resource_edge" (
      "parent_id" integer not null,
      "child_id" integer not null,
      "permission" bit(4),
      constraint "resource_edge_pkey" primary key ("parent_id", "child_id"),
      constraint "resource_edge_parent_fkey" foreign key ("parent_id") references "resource_node" ("id") on delete cascade on update cascade,
      constraint "resource_edge_child_fkey" foreign key ("child_id") references "resource_node" ("id") on delete cascade on update cascade
    );

    create index if not exists "resource_edge_parent_id_index" on "resource_edge" ("parent_id");

    create index if not exists "resource_edge_child_id_index" on "resource_edge" ("child_id");

    grant select, insert, update, delete on table "resource_edge" to "user1";

    -----------------------------------------------------------------------------------------------------------------------
    -- 'resource' transitive edge cache table
    -----------------------------------------------------------------------------------------------------------------------
    drop table if exists "resource_edge_cache" cascade;

    create table "resource_edge_cache" (
      "parent_id" integer not null,
      "child_id" integer not null,
      "permission" bit(4),
      constraint "resource_edge_cache_pkey" primary key ("parent_id", "child_id"),
      constraint "resource_edge_cache_parent_pkey" foreign key ("parent_id") references "resource_node" ("id"),
      constraint "resource_edge_cache_child_pkey" foreign key ("child_id") references "resource_node" ("id")
    );

    create index if not exists "resource_edge_cache_parent_id_index" on "resource_edge_cache" ("parent_id");

    create index if not exists "resource_edge_cache_child_id_index" on "resource_edge_cache" ("child_id");

    grant select, insert, update, delete on table "resource_edge_cache" to "user1";

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
    create view "resource_edge_cache_view" as
    select
      "parent_permissions"."parent_id" as "parent_id",
      "parent_permissions"."child_id" as "child_id",
      "parent_permissions"."permission" as "permission"
    from
      "resource_node" as "the_node",
      lateral "resource_edge_cache_parent_compute" ("the_node"."id") as "parent_permissions";

    grant select on table "resource_edge_cache_view" to "user1";

    -----------------------------------------------------------------------------------------------------------------------
    -- 'resource' function to create the cache
    -----------------------------------------------------------------------------------------------------------------------
    create or replace function "resource_edge_cache_backfill" ()
      returns setof "resource_edge_cache"
      as $$
      insert into "resource_edge_cache" ("parent_id", "child_id", "permission")
      select "parent_id", "child_id", "permission"
      from
        "resource_edge_cache_view"
      on conflict on constraint "resource_edge_cache_pkey"
        do update set
          "permission" = excluded."permission"
        returning
          *
    $$
    language sql
    volatile;

    grant execute on function "resource_edge_cache_backfill" () to "user1";

    -----------------------------------------------------------------------------------------------------------------------
    -- 'resource' Update cache when insert edge
    -----------------------------------------------------------------------------------------------------------------------
    create or replace function "resource_edge_insert_trigger_function"()
    returns trigger as $$
    begin

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
    $$ language plpgsql;

    grant execute on function "resource_edge_insert_trigger_function" () to "user1";

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
      on conflict on constraint "resource_edge_cache_pkey"
      do update set "permission" = excluded."permission";

      return null;
    end;
    $$ language plpgsql;

    grant execute on function "resource_edge_update_trigger_function" () to "user1";

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
      on conflict on constraint "resource_edge_cache_pkey"
      do update set "permission" = excluded."permission";

      return null;
    end;
    $$ language plpgsql;

    grant execute on function "resource_edge_delete_trigger_function" () to "user1";

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
    $$ language plpgsql;

    grant execute on function "resource_node_insert_trigger_function" () to "user1";

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
    $$ language plpgsql;

    grant execute on function "resource_node_update_trigger_function" () to "user1";


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
    $$ language plpgsql;

    grant execute on function "resource_node_delete_trigger_function" () to "user1";


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
    $$ language sql;

    grant execute on function "resource_trigger_enable" () to "user1";

    create or replace function "resource_trigger_disable"()
    returns void as $$
      alter table "resource_edge" disable trigger "10_resource_edge_insert_trigger";
      alter table "resource_edge" disable trigger "10_resource_edge_update_trigger";
      alter table "resource_edge" disable trigger "10_resource_edge_delete_trigger";
      alter table "resource_node" disable trigger "10_resource_node_insert_trigger";
      alter table "resource_node" disable trigger "10_resource_node_update_trigger";
      alter table "resource_node" disable trigger "10_resource_node_delete_trigger";
    $$ language sql;

    grant execute on function "resource_trigger_disable" () to "user1";


      
    -----------------------------------------------------------------------------------------------------------------------
    -- 'role' node table
    -----------------------------------------------------------------------------------------------------------------------
    drop table if exists "role_node" cascade;

    create table "role_node" (
      "id" serial unique not null,
      constraint "role_pkey" primary key ("id")
    );

    grant select, insert, update, delete on table "role_node" to "user1";

    -----------------------------------------------------------------------------------------------------------------------
    -- 'role' edge table
    -----------------------------------------------------------------------------------------------------------------------
    drop table if exists "role_edge" cascade;

    create table "role_edge" (
      "parent_id" integer not null,
      "child_id" integer not null,
      "permission" bit(4),
      constraint "role_edge_pkey" primary key ("parent_id", "child_id"),
      constraint "role_edge_parent_fkey" foreign key ("parent_id") references "role_node" ("id") on delete cascade on update cascade,
      constraint "role_edge_child_fkey" foreign key ("child_id") references "role_node" ("id") on delete cascade on update cascade
    );

    create index if not exists "role_edge_parent_id_index" on "role_edge" ("parent_id");

    create index if not exists "role_edge_child_id_index" on "role_edge" ("child_id");

    grant select, insert, update, delete on table "role_edge" to "user1";

    -----------------------------------------------------------------------------------------------------------------------
    -- 'role' transitive edge cache table
    -----------------------------------------------------------------------------------------------------------------------
    drop table if exists "role_edge_cache" cascade;

    create table "role_edge_cache" (
      "parent_id" integer not null,
      "child_id" integer not null,
      "permission" bit(4),
      constraint "role_edge_cache_pkey" primary key ("parent_id", "child_id"),
      constraint "role_edge_cache_parent_pkey" foreign key ("parent_id") references "role_node" ("id"),
      constraint "role_edge_cache_child_pkey" foreign key ("child_id") references "role_node" ("id")
    );

    create index if not exists "role_edge_cache_parent_id_index" on "role_edge_cache" ("parent_id");

    create index if not exists "role_edge_cache_child_id_index" on "role_edge_cache" ("child_id");

    grant select, insert, update, delete on table "role_edge_cache" to "user1";

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
    create view "role_edge_cache_view" as
    select
      "parent_permissions"."parent_id" as "parent_id",
      "parent_permissions"."child_id" as "child_id",
      "parent_permissions"."permission" as "permission"
    from
      "role_node" as "the_node",
      lateral "role_edge_cache_parent_compute" ("the_node"."id") as "parent_permissions";

    grant select on table "role_edge_cache_view" to "user1";

    -----------------------------------------------------------------------------------------------------------------------
    -- 'role' function to create the cache
    -----------------------------------------------------------------------------------------------------------------------
    create or replace function "role_edge_cache_backfill" ()
      returns setof "role_edge_cache"
      as $$
      insert into "role_edge_cache" ("parent_id", "child_id", "permission")
      select "parent_id", "child_id", "permission"
      from
        "role_edge_cache_view"
      on conflict on constraint "role_edge_cache_pkey"
        do update set
          "permission" = excluded."permission"
        returning
          *
    $$
    language sql
    volatile;

    grant execute on function "role_edge_cache_backfill" () to "user1";

    -----------------------------------------------------------------------------------------------------------------------
    -- 'role' Update cache when insert edge
    -----------------------------------------------------------------------------------------------------------------------
    create or replace function "role_edge_insert_trigger_function"()
    returns trigger as $$
    begin

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
    $$ language plpgsql;

    grant execute on function "role_edge_insert_trigger_function" () to "user1";

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
      on conflict on constraint "role_edge_cache_pkey"
      do update set "permission" = excluded."permission";

      return null;
    end;
    $$ language plpgsql;

    grant execute on function "role_edge_update_trigger_function" () to "user1";

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
      on conflict on constraint "role_edge_cache_pkey"
      do update set "permission" = excluded."permission";

      return null;
    end;
    $$ language plpgsql;

    grant execute on function "role_edge_delete_trigger_function" () to "user1";

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
    $$ language plpgsql;

    grant execute on function "role_node_insert_trigger_function" () to "user1";

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
    $$ language plpgsql;

    grant execute on function "role_node_update_trigger_function" () to "user1";


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
    $$ language plpgsql;

    grant execute on function "role_node_delete_trigger_function" () to "user1";


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
    $$ language sql;

    grant execute on function "role_trigger_enable" () to "user1";

    create or replace function "role_trigger_disable"()
    returns void as $$
      alter table "role_edge" disable trigger "10_role_edge_insert_trigger";
      alter table "role_edge" disable trigger "10_role_edge_update_trigger";
      alter table "role_edge" disable trigger "10_role_edge_delete_trigger";
      alter table "role_node" disable trigger "10_role_node_insert_trigger";
      alter table "role_node" disable trigger "10_role_node_update_trigger";
      alter table "role_node" disable trigger "10_role_node_delete_trigger";
    $$ language sql;

    grant execute on function "role_trigger_disable" () to "user1";


      
    -----------------------------------------------------------------------------------------------------------------------
    -- Assignment from role to resource
    -----------------------------------------------------------------------------------------------------------------------
    drop table if exists "assignment_edge" cascade;

    create table "assignment_edge" (
      "resource_id" integer not null,
      "role_id" integer not null,
      "permission" bit(4),
      constraint "assignment_edge_pkey" primary key ("resource_id", "role_id"),
      constraint "assignment_edge_resource_fkey" foreign key ("resource_id") references "resource_node" ("id") on delete cascade on update cascade,
      constraint "assignment_edge_role_fkey" foreign key ("role_id") references "role_node" ("id") on delete cascade on update cascade
    );

    create index if not exists "assignment_edge_resource_id_index" on "assignment_edge" ("resource_id");

    create index if not exists "assignment_edge_role_id_index" on "assignment_edge" ("role_id");

    grant select, insert, update, delete on table "assignment_edge" to "user1";




      
    -----------------------------------------------------------------------------------------------------------------------
    -- Table bindings
    -----------------------------------------------------------------------------------------------------------------------

      

      
    alter table "public"."human_user" drop column if exists "role_id" cascade;
    alter table "public"."human_user" add column "role_id" integer unique not null;
    alter table "public"."human_user" drop constraint if exists "role_human_user_fkey" cascade;
    alter table "public"."human_user" add constraint "role_human_user_fkey" foreign key ("role_id") references "role_node" ("id") on delete cascade on update cascade;

      

      
    alter table "public"."blog_post" drop column if exists "resource_id" cascade;
    alter table "public"."blog_post" add column "resource_id" integer unique not null;
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
      
        

      "
  `);
})