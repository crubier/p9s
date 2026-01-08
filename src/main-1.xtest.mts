import { expect, test } from 'bun:test'
import { compile, query as sql, identifier } from "pg-sql2";
import { createMigration } from '../packages/postgres/generation'
import { type PostgresTestContext } from './testing.mts';
import { setupTests } from './testing.mts';
setupTests();

test<PostgresTestContext>('SQL end to end test', async ({ client, database_admin_username, database_user_username, runTestQuery }) => {

  // Setup a simple datamodel
  await client.query(compile(sql`
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
  `));

  await client.query(compile(sql`
    -- See https://postgraphile.org/postgraphile/next/postgresql-schema-design
    create function "current_role_id"() returns integer as $$
      select nullif(current_setting('jwt.claims.role_id', true), '-1')::integer
    $$ language sql stable;
  `));

  // Run a p9s migration on top of the datamodel
  await client.query(compile(createMigration({
    engine: {
      permission: {
        bitmap: {
          size: 4
        }
      },
      authentication: {
        getCurrentUserId: "current_role_id",
      },
      users: [
        database_admin_username,
        database_user_username
      ]
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
        [database_user_username]: {
          select: 0,
          insert: 1,
          update: 1,
          delete: 1,
        }
      }
    }]
  })));

  await client.query(compile(sql`
    -- See https://postgraphile.org/postgraphile/next/postgresql-schema-design
    create extension if not exists "pgcrypto";

    -- See https://postgraphile.org/postgraphile/next/postgresql-schema-design
    create type "jwt_token" as (
      role_id integer,
      exp bigint
    );

    -- See https://postgraphile.org/postgraphile/next/postgresql-schema-design
    create function "register_human_user"(
      "human_user_email" varchar(1024)
    ) returns "human_user" as $$
    declare
      "result_role_node" "role_node";
      "result_human_user" "human_user";
    begin
      insert into "role_node" 
      default values
      returning * into "result_role_node";

      insert into "human_user" ("email", "role_id") 
      values ("human_user_email", "result_role_node"."id")
      returning * into "result_human_user";

      return "result_human_user";
    end;
    $$ language plpgsql strict security definer;

    -- See https://postgraphile.org/postgraphile/next/postgresql-schema-design
    create function "authenticate_human_user"(
      "human_user_email" varchar(1024)
    ) returns "jwt_token" as $$
    declare
      "result_human_user" "human_user";
    begin
      select * into "result_human_user"
      from "human_user"
      where "email" = "human_user_email";

      return ("result_human_user"."role_id", extract(epoch from (now() + interval '2 days')))::jwt_token;
    end;
    $$ language plpgsql strict security definer;
  `));

  // Populate the p9s tables with some data
  expect(await runTestQuery(sql`
    insert into "resource_node" ("id") values
    (1),
    (2),
    (3),
    (4),
    (5),
    (6),
    (7),
    (8);

    insert into "resource_edge" ("parent_id", "child_id", "permission") values
    (1, 3, b'1111'::bit(4)),
    (2, 4, b'1100'::bit(4)),
    (3, 4, b'1100'::bit(4)),
    (3, 5, b'1010'::bit(4)),
    (4, 6, b'0100'::bit(4)),
    (4, 8, b'1111'::bit(4)),
    (5, 7, b'1000'::bit(4)),
    (5, 8, b'1111'::bit(4));
  `)).toMatchInlineSnapshot(`
    [
      [],
      [],
    ]
  `);

  expect(await runTestQuery(sql`select * from "resource_node"; `)).toMatchInlineSnapshot(`
    [
      [
        {
          "id": 1,
        },
        {
          "id": 2,
        },
        {
          "id": 3,
        },
        {
          "id": 4,
        },
        {
          "id": 5,
        },
        {
          "id": 6,
        },
        {
          "id": 7,
        },
        {
          "id": 8,
        },
      ],
    ]
  `)

  expect(await runTestQuery(sql`select * from "resource_edge"; `)).toMatchInlineSnapshot(`
    [
      [
        {
          "child_id": 3,
          "parent_id": 1,
          "permission": "1111",
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
          "child_id": 5,
          "parent_id": 3,
          "permission": "1010",
        },
        {
          "child_id": 6,
          "parent_id": 4,
          "permission": "0100",
        },
        {
          "child_id": 7,
          "parent_id": 5,
          "permission": "1000",
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
      ],
    ]
  `)


  expect(await runTestQuery(sql`select * from "resource_edge_cache_parent_compute"(1); `)).toMatchInlineSnapshot(`
    [
      [
        {
          "child_id": 1,
          "parent_id": 1,
          "permission": "1111",
        },
      ],
    ]
  `)

  expect(await runTestQuery(sql`select * from "resource_edge_cache_parent_compute"(2); `)).toMatchInlineSnapshot(`
    [
      [
        {
          "child_id": 2,
          "parent_id": 2,
          "permission": "1111",
        },
      ],
    ]
  `)

  expect(await runTestQuery(sql`select * from "resource_edge_cache_parent_compute"(3); `)).toMatchInlineSnapshot(`
    [
      [
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
      ],
    ]
  `)

  expect(await runTestQuery(sql`select * from "resource_edge_cache_parent_compute"(4); `)).toMatchInlineSnapshot(`
    [
      [
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
      ],
    ]
  `)

  expect(await runTestQuery(sql`select * from "resource_edge_cache_parent_compute"(5); `)).toMatchInlineSnapshot(`
    [
      [
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
      ],
    ]
  `)

  expect(await runTestQuery(sql`select * from "resource_edge_cache_parent_compute"(6); `)).toMatchInlineSnapshot(`
    [
      [
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
      ],
    ]
  `)

  expect(await runTestQuery(sql`select * from "resource_edge_cache_parent_compute"(7); `)).toMatchInlineSnapshot(`
    [
      [
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
      ],
    ]
  `)

  expect(await runTestQuery(sql`select * from "resource_edge_cache_parent_compute"(8); `)).toMatchInlineSnapshot(`
    [
      [
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

  expect(await runTestQuery(sql`select * from "resource_edge_cache_child_compute"(1); `)).toMatchInlineSnapshot(`
    [
      [
        {
          "child_id": 1,
          "parent_id": 1,
          "permission": "1111",
        },
        {
          "child_id": 3,
          "parent_id": 1,
          "permission": "1111",
        },
        {
          "child_id": 4,
          "parent_id": 1,
          "permission": "1100",
        },
        {
          "child_id": 5,
          "parent_id": 1,
          "permission": "1010",
        },
        {
          "child_id": 6,
          "parent_id": 1,
          "permission": "0100",
        },
        {
          "child_id": 7,
          "parent_id": 1,
          "permission": "1000",
        },
        {
          "child_id": 8,
          "parent_id": 1,
          "permission": "1110",
        },
      ],
    ]
  `)

  expect(await runTestQuery(sql`select * from "resource_edge_cache_child_compute"(2); `)).toMatchInlineSnapshot(`
    [
      [
        {
          "child_id": 2,
          "parent_id": 2,
          "permission": "1111",
        },
        {
          "child_id": 4,
          "parent_id": 2,
          "permission": "1100",
        },
        {
          "child_id": 6,
          "parent_id": 2,
          "permission": "0100",
        },
        {
          "child_id": 8,
          "parent_id": 2,
          "permission": "1100",
        },
      ],
    ]
  `)

  expect(await runTestQuery(sql`select * from "resource_edge_cache_child_compute"(3); `)).toMatchInlineSnapshot(`
    [
      [
        {
          "child_id": 3,
          "parent_id": 3,
          "permission": "1111",
        },
        {
          "child_id": 4,
          "parent_id": 3,
          "permission": "1100",
        },
        {
          "child_id": 5,
          "parent_id": 3,
          "permission": "1010",
        },
        {
          "child_id": 6,
          "parent_id": 3,
          "permission": "0100",
        },
        {
          "child_id": 7,
          "parent_id": 3,
          "permission": "1000",
        },
        {
          "child_id": 8,
          "parent_id": 3,
          "permission": "1110",
        },
      ],
    ]
  `)

  expect(await runTestQuery(sql`select * from "resource_edge_cache_child_compute"(4); `)).toMatchInlineSnapshot(`
    [
      [
        {
          "child_id": 4,
          "parent_id": 4,
          "permission": "1111",
        },
        {
          "child_id": 6,
          "parent_id": 4,
          "permission": "0100",
        },
        {
          "child_id": 8,
          "parent_id": 4,
          "permission": "1111",
        },
      ],
    ]
  `)

  expect(await runTestQuery(sql`select * from "resource_edge_cache_child_compute"(5); `)).toMatchInlineSnapshot(`
    [
      [
        {
          "child_id": 5,
          "parent_id": 5,
          "permission": "1111",
        },
        {
          "child_id": 7,
          "parent_id": 5,
          "permission": "1000",
        },
        {
          "child_id": 8,
          "parent_id": 5,
          "permission": "1111",
        },
      ],
    ]
  `)

  expect(await runTestQuery(sql`select * from "resource_edge_cache_child_compute"(6); `)).toMatchInlineSnapshot(`
    [
      [
        {
          "child_id": 6,
          "parent_id": 6,
          "permission": "1111",
        },
      ],
    ]
  `)

  expect(await runTestQuery(sql`select * from "resource_edge_cache_child_compute"(7); `)).toMatchInlineSnapshot(`
    [
      [
        {
          "child_id": 7,
          "parent_id": 7,
          "permission": "1111",
        },
      ],
    ]
  `)

  expect(await runTestQuery(sql`select * from "resource_edge_cache_child_compute"(8); `)).toMatchInlineSnapshot(`
    [
      [
        {
          "child_id": 8,
          "parent_id": 8,
          "permission": "1111",
        },
      ],
    ]
  `)

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


  // Delete some edges 
  expect(await runTestQuery(sql`
  delete from "resource_edge" where
    ("parent_id" = 3 and "child_id" = 4);
  `)).toMatchInlineSnapshot(`
    [
      [],
    ]
  `);

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
          "parent_id": 2,
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
          "parent_id": 2,
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
          "permission": "1010",
        },
        {
          "child_id": 8,
          "parent_id": 2,
          "permission": "1100",
        },
        {
          "child_id": 8,
          "parent_id": 3,
          "permission": "1010",
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

  // Delete some edges 
  expect(await runTestQuery(sql`
  delete from "resource_edge" where
    ("parent_id" = 3 and "child_id" = 5);
  `)).toMatchInlineSnapshot(`
    [
      [],
    ]
  `);

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
          "parent_id": 2,
          "permission": "1100",
        },
        {
          "child_id": 4,
          "parent_id": 4,
          "permission": "1111",
        },
        {
          "child_id": 5,
          "parent_id": 5,
          "permission": "1111",
        },
        {
          "child_id": 6,
          "parent_id": 2,
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
          "parent_id": 2,
          "permission": "1100",
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

  expect(await runTestQuery(sql`
    insert into "resource_edge"("parent_id", "child_id", "permission") values
    (3, 4, b'1100':: bit(4)),
    (3, 5, b'1010':: bit(4));
`)).toMatchInlineSnapshot(`
  [
    [],
  ]
`);

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
  `);

  expect(await runTestQuery(sql`
    update "resource_edge"
    set "permission" = b'0011':: bit(4)
    where "parent_id" = 3 and "child_id" = 5;
`)).toMatchInlineSnapshot(`
  [
    [],
  ]
`);

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
          "permission": "0011",
        },
        {
          "child_id": 5,
          "parent_id": 3,
          "permission": "0011",
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
          "permission": "0000",
        },
        {
          "child_id": 7,
          "parent_id": 3,
          "permission": "0000",
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
          "permission": "1111",
        },
        {
          "child_id": 8,
          "parent_id": 2,
          "permission": "1100",
        },
        {
          "child_id": 8,
          "parent_id": 3,
          "permission": "1111",
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
  `);

  expect(await runTestQuery(sql`
    update "resource_edge"
    set "parent_id" = 3
    where "parent_id" = 4 and "child_id" = 8;
`)).toMatchInlineSnapshot(`
  [
    [],
  ]
`);

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
          "permission": "0011",
        },
        {
          "child_id": 5,
          "parent_id": 3,
          "permission": "0011",
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
          "permission": "0000",
        },
        {
          "child_id": 7,
          "parent_id": 3,
          "permission": "0000",
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
          "permission": "1111",
        },
        {
          "child_id": 8,
          "parent_id": 3,
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
  `);

  expect(await runTestQuery(sql`
    update "resource_edge"
    set "child_id" = 6
    where "parent_id" = 3 and "child_id" = 4;
`)).toMatchInlineSnapshot(`
  [
    [],
  ]
`);

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
          "parent_id": 2,
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
          "permission": "0011",
        },
        {
          "child_id": 5,
          "parent_id": 3,
          "permission": "0011",
        },
        {
          "child_id": 5,
          "parent_id": 5,
          "permission": "1111",
        },
        {
          "child_id": 6,
          "parent_id": 1,
          "permission": "1100",
        },
        {
          "child_id": 6,
          "parent_id": 2,
          "permission": "0100",
        },
        {
          "child_id": 6,
          "parent_id": 3,
          "permission": "1100",
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
          "permission": "0000",
        },
        {
          "child_id": 7,
          "parent_id": 3,
          "permission": "0000",
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
          "permission": "1111",
        },
        {
          "child_id": 8,
          "parent_id": 3,
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
  `);

  // Populate the p9s tables with some data
  expect(await runTestQuery(sql`
delete from "resource_edge";

    insert into "resource_edge"("parent_id", "child_id", "permission") values
  (1, 3, b'1111':: bit(4)),
  (2, 4, b'1100':: bit(4)),
(3, 4, b'1100':: bit(4)),
(3, 5, b'1010':: bit(4)),
(4, 6, b'0100':: bit(4)),
(4, 8, b'1111':: bit(4)),
(5, 7, b'1000':: bit(4)),
(5, 8, b'1111':: bit(4));
`)).toMatchInlineSnapshot(`
  [
    [],
    [],
  ]
`);

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
  `);

  expect(await runTestQuery(sql`
    select 1 as "one" from "register_human_user"('user1@example.com');
    select 1 as "one" from "register_human_user"('user2@example.com');
    select 1 as "one" from "register_human_user"('user3@example.com');
    select 1 as "one" from "register_human_user"('user4@example.com');
    select 1 as "one" from "register_human_user"('user5@example.com');
    select 1 as "one" from "register_human_user"('user6@example.com');
    select 1 as "one" from "register_human_user"('user7@example.com');
    select 1 as "one" from "register_human_user"('user8@example.com');

    insert into "role_edge"("parent_id", "child_id", "permission") values
  (1, 2, b'1111':: bit(4)),
  (2, 3, b'1010':: bit(4)),
(2, 7, b'1110':: bit(4)),
(3, 4, b'1000':: bit(4)),
(3, 5, b'1111':: bit(4)),
(7, 6, b'0100':: bit(4)),
(7, 5, b'1111':: bit(4)),
(8, 7, b'1100':: bit(4));
`)).toMatchInlineSnapshot(`
  [
    [
      {
        "one": 1,
      },
    ],
    [
      {
        "one": 1,
      },
    ],
    [
      {
        "one": 1,
      },
    ],
    [
      {
        "one": 1,
      },
    ],
    [
      {
        "one": 1,
      },
    ],
    [
      {
        "one": 1,
      },
    ],
    [
      {
        "one": 1,
      },
    ],
    [
      {
        "one": 1,
      },
    ],
    [],
  ]
`);

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
  `);

  expect(await runTestQuery(sql`
    insert into "assignment_edge"("role_id", "resource_id", "permission") values
      (1, 3, b'1111':: bit(4)),
      (3, 2, b'1110':: bit(4)),
      (8, 5, b'1110':: bit(4)),
      (2, 1, b'0111':: bit(4)),
      (4, 6, b'0001':: bit(4)),
      (5, 8, b'0001':: bit(4)),
      (6, 8, b'0011':: bit(4)),
      (7, 8, b'0100':: bit(4));
      `)).toMatchInlineSnapshot(`
        [
          [],
        ]
      `);

  expect(await runTestQuery(sql`
      set local role ${identifier(database_user_username)};
      set local "jwt.claims.role_id" = '1';
      select current_role_id();
  `)).toMatchInlineSnapshot(`
    [
      [],
      [],
      [
        {
          "current_role_id": 1,
        },
      ],
    ]
  `);

  // expect(() => runTestQuery(sql`
  // set local role ${identifier(database_user_username)};
  // set local "jwt.claims.role_id" = '1';
  // insert into "blog_post"("resource_id", "name") values
  //   (1, 'post_1'),
  //   (2, 'post_2'),
  //   (3, 'post_3'),
  //   (4, 'post_4'),
  //   (5, 'post_5'),
  //   (6, 'post_6'),
  //   (7, 'post_7'),
  //   (8, 'post_8');
  // select "resource_id", "name" from "blog_post";
  // `)).toThrowError(/.*/);

  expect(await runTestQuery(sql`
    set local role ${identifier(database_user_username)};
    set local "jwt.claims.role_id" = '1';
    insert into "blog_post"("resource_id", "name") values
      (3, 'post_3'),
      (4, 'post_4'),
      (6, 'post_6'),
      (8, 'post_8');
    select "resource_id", "name" from "blog_post";
    `)).toMatchInlineSnapshot(`
      [
        [],
        [],
        [],
        [
          {
            "name": "post_3",
            "resource_id": 3,
          },
          {
            "name": "post_4",
            "resource_id": 4,
          },
          {
            "name": "post_8",
            "resource_id": 8,
          },
        ],
      ]
    `);

  expect(await runTestQuery(sql`
    set local role ${identifier(database_user_username)};
    set local "jwt.claims.role_id" = '2';
    insert into "blog_post"("resource_id", "name") values
      (1, 'post_1');
    select "resource_id", "name" from "blog_post";
    `)).toMatchInlineSnapshot(`
      [
        [],
        [],
        [],
        [
          {
            "name": "post_3",
            "resource_id": 3,
          },
          {
            "name": "post_4",
            "resource_id": 4,
          },
          {
            "name": "post_8",
            "resource_id": 8,
          },
        ],
      ]
    `);

  expect(await runTestQuery(sql`
    set local role ${identifier(database_user_username)};
    set local "jwt.claims.role_id" = '3';
    insert into "blog_post"("resource_id", "name") values
      (2, 'post_2');
    select "resource_id", "name" from "blog_post";
    `)).toMatchInlineSnapshot(`
      [
        [],
        [],
        [],
        [
          {
            "name": "post_2",
            "resource_id": 2,
          },
          {
            "name": "post_3",
            "resource_id": 3,
          },
          {
            "name": "post_4",
            "resource_id": 4,
          },
          {
            "name": "post_8",
            "resource_id": 8,
          },
        ],
      ]
    `);

  expect(await runTestQuery(sql`
    set local role ${identifier(database_user_username)};
    set local "jwt.claims.role_id" = '4';
    select "resource_id", "name" from "blog_post";
    `)).toMatchInlineSnapshot(`
      [
        [],
        [],
        [
          {
            "name": "post_2",
            "resource_id": 2,
          },
          {
            "name": "post_3",
            "resource_id": 3,
          },
          {
            "name": "post_4",
            "resource_id": 4,
          },
          {
            "name": "post_8",
            "resource_id": 8,
          },
        ],
      ]
    `);

  expect(await runTestQuery(sql`
    set local role ${identifier(database_user_username)};
    set local "jwt.claims.role_id" = '5';
    select "resource_id", "name" from "blog_post";
    `)).toMatchInlineSnapshot(`
      [
        [],
        [],
        [
          {
            "name": "post_2",
            "resource_id": 2,
          },
          {
            "name": "post_3",
            "resource_id": 3,
          },
          {
            "name": "post_4",
            "resource_id": 4,
          },
          {
            "name": "post_8",
            "resource_id": 8,
          },
        ],
      ]
    `);

  expect(await runTestQuery(sql`
    set local role ${identifier(database_user_username)};
    set local "jwt.claims.role_id" = '6';
    select "resource_id", "name" from "blog_post";
    `)).toMatchInlineSnapshot(`
      [
        [],
        [],
        [],
      ]
    `);

  expect(await runTestQuery(sql`
    set local role ${identifier(database_user_username)};
    set local "jwt.claims.role_id" = '7';
    select "resource_id", "name" from "blog_post";
    `)).toMatchInlineSnapshot(`
      [
        [],
        [],
        [
          {
            "name": "post_3",
            "resource_id": 3,
          },
          {
            "name": "post_4",
            "resource_id": 4,
          },
          {
            "name": "post_8",
            "resource_id": 8,
          },
        ],
      ]
    `);

  expect(await runTestQuery(sql`
    set local role ${identifier(database_user_username)};
    set local "jwt.claims.role_id" = '8';
    insert into "blog_post"("resource_id", "name") values
      (5, 'post_5');
    select "resource_id", "name" from "blog_post";
    `)).toMatchInlineSnapshot(`
      [
        [],
        [],
        [],
        [
          {
            "name": "post_5",
            "resource_id": 5,
          },
          {
            "name": "post_8",
            "resource_id": 8,
          },
        ],
      ]
    `);




  //   expect(await runTestQuery(sql`
  //     insert into "blog_post"("resource_id", "name") values
  //       (1, 'post_1'),
  //       (2, 'post_2'),
  //       (3, 'post_3'),
  //       (4, 'post_4'),
  //       (5, 'post_5'),
  //       (6, 'post_6'),
  //       (7, 'post_7'),
  //       (8, 'post_8');
  //     `)).toMatchInlineSnapshot(`
  //   [
  //     [],
  //   ]
  // `);


  // expect(await runTestQuery(sql`
  //   set local role ${identifier(database_user_username)};
  //   set local "jwt.claims.role_id" = '1';
  //   select "resource_id", "name" from "blog_post";
  // `)).toMatchInlineSnapshot(`
  //   [
  //     [],
  //     [],
  //     [
  //       {
  //         "name": "post_1",
  //         "resource_id": 1,
  //       },
  //       {
  //         "name": "post_2",
  //         "resource_id": 2,
  //       },
  //       {
  //         "name": "post_3",
  //         "resource_id": 3,
  //       },
  //       {
  //         "name": "post_4",
  //         "resource_id": 4,
  //       },
  //       {
  //         "name": "post_5",
  //         "resource_id": 5,
  //       },
  //       {
  //         "name": "post_6",
  //         "resource_id": 6,
  //       },
  //       {
  //         "name": "post_7",
  //         "resource_id": 7,
  //       },
  //       {
  //         "name": "post_8",
  //         "resource_id": 8,
  //       },
  //     ],
  //   ]
  // `);

})








































test<PostgresTestContext>('Disable and enable triggers', async ({ client, database_admin_username, database_user_username, runTestQuery }) => {

  // Setup a simple datamodel
  await client.query(compile(sql`
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
  `));

  await client.query(compile(sql`
    -- See https://postgraphile.org/postgraphile/next/postgresql-schema-design
    create function "current_role_id"() returns integer as $$
      select nullif(current_setting('jwt.claims.role_id', true), '-1')::integer
    $$ language sql stable;
  `));

  // Run a p9s migration on top of the datamodel
  await client.query(compile(createMigration({
    engine: {
      permission: {
        bitmap: {
          size: 4
        }
      },
      authentication: {
        getCurrentUserId: "current_role_id",
      },
      users: [
        database_admin_username,
        database_user_username
      ]
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
        [database_user_username]: {
          select: 0,
          insert: 1,
          update: 1,
          delete: 1,
        }
      }
    }]
  })));

  await client.query(compile(sql`
    -- See https://postgraphile.org/postgraphile/next/postgresql-schema-design
    create extension if not exists "pgcrypto";

    -- See https://postgraphile.org/postgraphile/next/postgresql-schema-design
    create type "jwt_token" as (
      role_id integer,
      exp bigint
    );

    -- See https://postgraphile.org/postgraphile/next/postgresql-schema-design
    create function "register_human_user"(
      "human_user_email" varchar(1024)
    ) returns "human_user" as $$
    declare
      "result_role_node" "role_node";
      "result_human_user" "human_user";
    begin
      insert into "role_node" 
      default values
      returning * into "result_role_node";

      insert into "human_user" ("email", "role_id") 
      values ("human_user_email", "result_role_node"."id")
      returning * into "result_human_user";

      return "result_human_user";
    end;
    $$ language plpgsql strict security definer;

    -- See https://postgraphile.org/postgraphile/next/postgresql-schema-design
    create function "authenticate_human_user"(
      "human_user_email" varchar(1024)
    ) returns "jwt_token" as $$
    declare
      "result_human_user" "human_user";
    begin
      select * into "result_human_user"
      from "human_user"
      where "email" = "human_user_email";

      return ("result_human_user"."role_id", extract(epoch from (now() + interval '2 days')))::jwt_token;
    end;
    $$ language plpgsql strict security definer;
  `));



  await client.query(compile(sql`
    select resource_trigger_disable();
    select role_trigger_disable();
  `));


  // Populate the p9s tables with some data
  expect(await runTestQuery(sql`
    delete from "resource_edge_cache";

    insert into "resource_node" ("id") values
    (1),
    (2),
    (3),
    (4),
    (5),
    (6),
    (7),
    (8);

    insert into "resource_edge" ("parent_id", "child_id", "permission") values
    (1, 3, b'1111'::bit(4)),
    (2, 4, b'1100'::bit(4)),
    (3, 4, b'1100'::bit(4)),
    (3, 5, b'1010'::bit(4)),
    (4, 6, b'0100'::bit(4)),
    (4, 8, b'1111'::bit(4)),
    (5, 7, b'1000'::bit(4)),
    (5, 8, b'1111'::bit(4));
  `)).toMatchInlineSnapshot(`
    [
      [],
      [],
      [],
    ]
  `);

  await client.query(compile(sql`
    select resource_trigger_enable();
    select role_trigger_enable();
  `));

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



})

