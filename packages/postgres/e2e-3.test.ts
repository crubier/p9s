import { expect, describe, test, beforeEach, afterEach } from 'bun:test'
import { query as sql, identifier } from "pg-sql2";
import { createMigration } from './generation'
import { setupTests } from '@p9s/postgres-testing/pglite';

describe('SQL end to end test combined roles', async () => {
  const { setup, teardown, context } = setupTests();
  beforeEach(setup);
  afterEach(teardown);

  test('SQL end to end test combined roles', async () => {
    const { database_admin_username, database_user_username, runTestQuery, exec } = context;

    // Setup a simple datamodel
    await exec(sql`
      create extension if not exists "uuid-ossp";    
      drop table if exists "human_user" cascade;
      create table "human_user" (
        "id" uuid default uuid_generate_v4() primary key,
        "created_at" timestamptz default current_timestamp,
        "updated_at" timestamptz default current_timestamp,
        "email" varchar(1024) unique not null
      );
      grant select, insert, update, delete on table "human_user" to ${identifier(database_user_username)};
      drop table if exists "blog_post" cascade;
      create table "blog_post" (
        "id" uuid default uuid_generate_v4() primary key,
        "created_at" timestamptz default current_timestamp,
        "updated_at" timestamptz default current_timestamp,
        "name" varchar(1024) not null,
        "author" uuid references "human_user"("id")
      );
      grant select, insert, update, delete on table "blog_post" to ${identifier(database_user_username)};
    `);

    await exec(sql`
      create function "current_role_id"() returns integer as $$
        select nullif(current_setting('jwt.claims.role_id', true), '-1')::integer
      $$ language sql stable;
    `);

    // Run a p9s migration on top of the datamodel
    await exec(createMigration({
      engine: {
        permission: { bitmap: { size: 4 } },
        authentication: { getCurrentUserId: "current_role_id" },
        combineAssignmentsWith: "role",
        users: [database_admin_username, database_user_username]
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
          [database_user_username]: { select: 0, insert: 1, update: 1, delete: 1 }
        }
      }]
    }));

    await exec(sql`
      create type "jwt_token" as (role_id integer, exp bigint);
      create function "register_human_user"("human_user_email" varchar(1024)) returns "human_user" as $$
      declare
        "result_role_node" "role_node";
        "result_human_user" "human_user";
      begin
        insert into "role_node" default values returning * into "result_role_node";
        insert into "human_user" ("email", "role_id") values ("human_user_email", "result_role_node"."id") returning * into "result_human_user";
        return "result_human_user";
      end;
      $$ language plpgsql strict security definer;
      create function "authenticate_human_user"("human_user_email" varchar(1024)) returns "jwt_token" as $$
      declare "result_human_user" "human_user";
      begin
        select * into "result_human_user" from "human_user" where "email" = "human_user_email";
        return ("result_human_user"."role_id", extract(epoch from (now() + interval '2 days')))::jwt_token;
      end;
      $$ language plpgsql strict security definer;
    `);

    // Populate the p9s tables with some data
    await exec(sql`insert into "resource_node" ("id") values (1),(2),(3),(4),(5),(6),(7),(8)`);
    await exec(sql`insert into "resource_edge" ("parent_id", "child_id", "permission") values
      (1, 3, b'1111'::bit(4)), (2, 4, b'1100'::bit(4)), (3, 4, b'1100'::bit(4)),
      (3, 5, b'1010'::bit(4)), (4, 6, b'0100'::bit(4)), (4, 8, b'1111'::bit(4)),
      (5, 7, b'1000'::bit(4)), (5, 8, b'1111'::bit(4))`);
    await exec(sql`insert into "role_node" ("id") values (1),(2),(3),(4),(5),(6),(7),(8)`);
    await exec(sql`insert into "role_edge"("parent_id", "child_id", "permission") values
      (1, 2, b'1111'::bit(4)), (2, 3, b'1010'::bit(4)), (2, 7, b'1110'::bit(4)),
      (3, 4, b'1000'::bit(4)), (3, 5, b'1111'::bit(4)), (7, 6, b'0100'::bit(4)),
      (7, 5, b'1111'::bit(4)), (8, 7, b'1100'::bit(4))`);
    await exec(sql`insert into "assignment_edge"("role_id", "resource_id", "permission") values
      (1, 3, b'1111'::bit(4)), (3, 2, b'1110'::bit(4)), (8, 5, b'1110'::bit(4)),
      (2, 1, b'0111'::bit(4)), (4, 6, b'0001'::bit(4)), (5, 8, b'0001'::bit(4)),
      (6, 8, b'0011'::bit(4)), (7, 8, b'0100'::bit(4))`);

    expect(await runTestQuery(sql`select * from "resource_edge_cache"; `)).toMatchInlineSnapshot(`
      [
        [
          {
            "child_id": 1,
            "parent_id": 1,
            "permission": "1111",
          },
          {
            "child_id": 2,
            "parent_id": 2,
            "permission": "1111",
          },
          {
            "child_id": 3,
            "parent_id": 1,
            "permission": "1111",
          },
          {
            "child_id": 3,
            "parent_id": 3,
            "permission": "1111",
          },
          {
            "child_id": 4,
            "parent_id": 1,
            "permission": "1100",
          },
          {
            "child_id": 4,
            "parent_id": 2,
            "permission": "1100",
          },
          {
            "child_id": 4,
            "parent_id": 3,
            "permission": "1100",
          },
          {
            "child_id": 4,
            "parent_id": 4,
            "permission": "1111",
          },
          {
            "child_id": 5,
            "parent_id": 1,
            "permission": "1010",
          },
          {
            "child_id": 5,
            "parent_id": 3,
            "permission": "1010",
          },
          {
            "child_id": 5,
            "parent_id": 5,
            "permission": "1111",
          },
          {
            "child_id": 6,
            "parent_id": 1,
            "permission": "0100",
          },
          {
            "child_id": 6,
            "parent_id": 2,
            "permission": "0100",
          },
          {
            "child_id": 6,
            "parent_id": 3,
            "permission": "0100",
          },
          {
            "child_id": 6,
            "parent_id": 4,
            "permission": "0100",
          },
          {
            "child_id": 6,
            "parent_id": 6,
            "permission": "1111",
          },
          {
            "child_id": 7,
            "parent_id": 1,
            "permission": "1000",
          },
          {
            "child_id": 7,
            "parent_id": 3,
            "permission": "1000",
          },
          {
            "child_id": 7,
            "parent_id": 5,
            "permission": "1000",
          },
          {
            "child_id": 7,
            "parent_id": 7,
            "permission": "1111",
          },
          {
            "child_id": 8,
            "parent_id": 1,
            "permission": "1110",
          },
          {
            "child_id": 8,
            "parent_id": 2,
            "permission": "1100",
          },
          {
            "child_id": 8,
            "parent_id": 3,
            "permission": "1110",
          },
          {
            "child_id": 8,
            "parent_id": 4,
            "permission": "1111",
          },
          {
            "child_id": 8,
            "parent_id": 5,
            "permission": "1111",
          },
          {
            "child_id": 8,
            "parent_id": 8,
            "permission": "1111",
          },
        ],
      ]
    `)

    expect(await runTestQuery(sql`select * from "role_edge_cache"; `)).toMatchInlineSnapshot(`
      [
        [
          {
            "child_id": 1,
            "parent_id": 1,
            "permission": "1111",
          },
          {
            "child_id": 2,
            "parent_id": 1,
            "permission": "1111",
          },
          {
            "child_id": 2,
            "parent_id": 2,
            "permission": "1111",
          },
          {
            "child_id": 3,
            "parent_id": 1,
            "permission": "1010",
          },
          {
            "child_id": 3,
            "parent_id": 2,
            "permission": "1010",
          },
          {
            "child_id": 3,
            "parent_id": 3,
            "permission": "1111",
          },
          {
            "child_id": 4,
            "parent_id": 1,
            "permission": "1000",
          },
          {
            "child_id": 4,
            "parent_id": 2,
            "permission": "1000",
          },
          {
            "child_id": 4,
            "parent_id": 3,
            "permission": "1000",
          },
          {
            "child_id": 4,
            "parent_id": 4,
            "permission": "1111",
          },
          {
            "child_id": 5,
            "parent_id": 1,
            "permission": "1110",
          },
          {
            "child_id": 5,
            "parent_id": 2,
            "permission": "1110",
          },
          {
            "child_id": 5,
            "parent_id": 3,
            "permission": "1111",
          },
          {
            "child_id": 5,
            "parent_id": 5,
            "permission": "1111",
          },
          {
            "child_id": 5,
            "parent_id": 7,
            "permission": "1111",
          },
          {
            "child_id": 5,
            "parent_id": 8,
            "permission": "1100",
          },
          {
            "child_id": 6,
            "parent_id": 1,
            "permission": "0100",
          },
          {
            "child_id": 6,
            "parent_id": 2,
            "permission": "0100",
          },
          {
            "child_id": 6,
            "parent_id": 6,
            "permission": "1111",
          },
          {
            "child_id": 6,
            "parent_id": 7,
            "permission": "0100",
          },
          {
            "child_id": 6,
            "parent_id": 8,
            "permission": "0100",
          },
          {
            "child_id": 7,
            "parent_id": 1,
            "permission": "1110",
          },
          {
            "child_id": 7,
            "parent_id": 2,
            "permission": "1110",
          },
          {
            "child_id": 7,
            "parent_id": 7,
            "permission": "1111",
          },
          {
            "child_id": 7,
            "parent_id": 8,
            "permission": "1100",
          },
          {
            "child_id": 8,
            "parent_id": 8,
            "permission": "1111",
          },
        ],
      ]
    `)

    // Disable triggers, clear caches, re-enable triggers
    await exec(sql`select resource_trigger_disable()`);
    await exec(sql`select role_trigger_disable()`);
    await exec(sql`select assignment_trigger_disable()`);
    await exec(sql`delete from "resource_edge_cache"`);
    await exec(sql`delete from "role_edge_cache"`);
    await exec(sql`delete from "assignment_edge_cache"`);
    await exec(sql`select resource_trigger_enable()`);
    await exec(sql`select role_trigger_enable()`);
    await exec(sql`select assignment_trigger_enable()`);

    expect(await runTestQuery(sql`select * from "resource_edge_cache"; `)).toMatchInlineSnapshot(`
      [
        [
          {
            "child_id": 1,
            "parent_id": 1,
            "permission": "1111",
          },
          {
            "child_id": 2,
            "parent_id": 2,
            "permission": "1111",
          },
          {
            "child_id": 3,
            "parent_id": 1,
            "permission": "1111",
          },
          {
            "child_id": 3,
            "parent_id": 3,
            "permission": "1111",
          },
          {
            "child_id": 4,
            "parent_id": 1,
            "permission": "1100",
          },
          {
            "child_id": 4,
            "parent_id": 2,
            "permission": "1100",
          },
          {
            "child_id": 4,
            "parent_id": 3,
            "permission": "1100",
          },
          {
            "child_id": 4,
            "parent_id": 4,
            "permission": "1111",
          },
          {
            "child_id": 5,
            "parent_id": 1,
            "permission": "1010",
          },
          {
            "child_id": 5,
            "parent_id": 3,
            "permission": "1010",
          },
          {
            "child_id": 5,
            "parent_id": 5,
            "permission": "1111",
          },
          {
            "child_id": 6,
            "parent_id": 1,
            "permission": "0100",
          },
          {
            "child_id": 6,
            "parent_id": 2,
            "permission": "0100",
          },
          {
            "child_id": 6,
            "parent_id": 3,
            "permission": "0100",
          },
          {
            "child_id": 6,
            "parent_id": 4,
            "permission": "0100",
          },
          {
            "child_id": 6,
            "parent_id": 6,
            "permission": "1111",
          },
          {
            "child_id": 7,
            "parent_id": 1,
            "permission": "1000",
          },
          {
            "child_id": 7,
            "parent_id": 3,
            "permission": "1000",
          },
          {
            "child_id": 7,
            "parent_id": 5,
            "permission": "1000",
          },
          {
            "child_id": 7,
            "parent_id": 7,
            "permission": "1111",
          },
          {
            "child_id": 8,
            "parent_id": 1,
            "permission": "1110",
          },
          {
            "child_id": 8,
            "parent_id": 2,
            "permission": "1100",
          },
          {
            "child_id": 8,
            "parent_id": 3,
            "permission": "1110",
          },
          {
            "child_id": 8,
            "parent_id": 4,
            "permission": "1111",
          },
          {
            "child_id": 8,
            "parent_id": 5,
            "permission": "1111",
          },
          {
            "child_id": 8,
            "parent_id": 8,
            "permission": "1111",
          },
        ],
      ]
    `)

    expect(await runTestQuery(sql`select * from "role_edge_cache"; `)).toMatchInlineSnapshot(`
      [
        [
          {
            "child_id": 1,
            "parent_id": 1,
            "permission": "1111",
          },
          {
            "child_id": 2,
            "parent_id": 1,
            "permission": "1111",
          },
          {
            "child_id": 2,
            "parent_id": 2,
            "permission": "1111",
          },
          {
            "child_id": 3,
            "parent_id": 1,
            "permission": "1010",
          },
          {
            "child_id": 3,
            "parent_id": 2,
            "permission": "1010",
          },
          {
            "child_id": 3,
            "parent_id": 3,
            "permission": "1111",
          },
          {
            "child_id": 4,
            "parent_id": 1,
            "permission": "1000",
          },
          {
            "child_id": 4,
            "parent_id": 2,
            "permission": "1000",
          },
          {
            "child_id": 4,
            "parent_id": 3,
            "permission": "1000",
          },
          {
            "child_id": 4,
            "parent_id": 4,
            "permission": "1111",
          },
          {
            "child_id": 5,
            "parent_id": 1,
            "permission": "1110",
          },
          {
            "child_id": 5,
            "parent_id": 2,
            "permission": "1110",
          },
          {
            "child_id": 5,
            "parent_id": 3,
            "permission": "1111",
          },
          {
            "child_id": 5,
            "parent_id": 5,
            "permission": "1111",
          },
          {
            "child_id": 5,
            "parent_id": 7,
            "permission": "1111",
          },
          {
            "child_id": 5,
            "parent_id": 8,
            "permission": "1100",
          },
          {
            "child_id": 6,
            "parent_id": 1,
            "permission": "0100",
          },
          {
            "child_id": 6,
            "parent_id": 2,
            "permission": "0100",
          },
          {
            "child_id": 6,
            "parent_id": 6,
            "permission": "1111",
          },
          {
            "child_id": 6,
            "parent_id": 7,
            "permission": "0100",
          },
          {
            "child_id": 6,
            "parent_id": 8,
            "permission": "0100",
          },
          {
            "child_id": 7,
            "parent_id": 1,
            "permission": "1110",
          },
          {
            "child_id": 7,
            "parent_id": 2,
            "permission": "1110",
          },
          {
            "child_id": 7,
            "parent_id": 7,
            "permission": "1111",
          },
          {
            "child_id": 7,
            "parent_id": 8,
            "permission": "1100",
          },
          {
            "child_id": 8,
            "parent_id": 8,
            "permission": "1111",
          },
        ],
      ]
    `)

    expect(await runTestQuery(sql`select * from "assignment_edge_cache"; `)).toMatchInlineSnapshot(`
      [
        [
          {
            "permission": "1111",
            "resource_id": 3,
            "role_id": 1,
          },
          {
            "permission": "0111",
            "resource_id": 1,
            "role_id": 2,
          },
          {
            "permission": "1111",
            "resource_id": 3,
            "role_id": 2,
          },
          {
            "permission": "0010",
            "resource_id": 1,
            "role_id": 3,
          },
          {
            "permission": "1110",
            "resource_id": 2,
            "role_id": 3,
          },
          {
            "permission": "1010",
            "resource_id": 3,
            "role_id": 3,
          },
          {
            "permission": "0000",
            "resource_id": 1,
            "role_id": 4,
          },
          {
            "permission": "1000",
            "resource_id": 2,
            "role_id": 4,
          },
          {
            "permission": "1000",
            "resource_id": 3,
            "role_id": 4,
          },
          {
            "permission": "0001",
            "resource_id": 6,
            "role_id": 4,
          },
          {
            "permission": "0110",
            "resource_id": 1,
            "role_id": 5,
          },
          {
            "permission": "1110",
            "resource_id": 2,
            "role_id": 5,
          },
          {
            "permission": "1110",
            "resource_id": 3,
            "role_id": 5,
          },
          {
            "permission": "1100",
            "resource_id": 5,
            "role_id": 5,
          },
          {
            "permission": "0101",
            "resource_id": 8,
            "role_id": 5,
          },
          {
            "permission": "0100",
            "resource_id": 1,
            "role_id": 6,
          },
          {
            "permission": "0100",
            "resource_id": 3,
            "role_id": 6,
          },
          {
            "permission": "0100",
            "resource_id": 5,
            "role_id": 6,
          },
          {
            "permission": "0111",
            "resource_id": 8,
            "role_id": 6,
          },
          {
            "permission": "0110",
            "resource_id": 1,
            "role_id": 7,
          },
          {
            "permission": "1110",
            "resource_id": 3,
            "role_id": 7,
          },
          {
            "permission": "1100",
            "resource_id": 5,
            "role_id": 7,
          },
          {
            "permission": "0100",
            "resource_id": 8,
            "role_id": 7,
          },
          {
            "permission": "1110",
            "resource_id": 5,
            "role_id": 8,
          },
        ],
      ]
    `);
  });
});
