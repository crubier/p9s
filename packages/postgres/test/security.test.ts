import { expect, describe, test, beforeEach, afterEach } from 'bun:test'
import { query as sql, identifier, raw } from "pg-sql2";
import { setupTests } from '@p9s/postgres-testing';
import { as, bits, cacheMismatches, noMismatches, setupBlog, type TestContext } from './helpers';

const expectRejected = async (promise: Promise<unknown>, message: RegExp = /permission denied/) => {
  let error: unknown;
  try { await promise; } catch (e) { error = e; }
  expect(String(error)).toMatch(message);
};

// Resource groups 1 -> 2 and 1 -> 3, role groups 1 and 2, role 1 has every bit on group 2, one post in groups 2 and 3
const seedGraph = async (ctx: TestContext) => {
  await ctx.exec(sql`
    insert into "resource_group" ("id") values (1), (2), (3);
    insert into "resource_edge" values (1, 2, ${bits("1111")}), (1, 3, ${bits("1111")});
    insert into "role_group" ("id") values (1), (2);
    insert into "assignment_edge" ("resource_id", "role_id", "permission") values (2, 1, ${bits("1111")});
    insert into "blog_post" ("group_id", "name") values (2, 'two'), (3, 'three');
  `);
};

const graphTables = ["resource_edge", "role_edge", "assignment_edge"];
const cacheTables = ["resource_edge_cache", "role_edge_cache", "assignment_edge_cache"];

// Privileges are checked before execution, so these fail even when they would not touch a row
const writeStatements = (table: string) => [
  sql`insert into ${identifier(table)} select * from ${identifier(table)} where false`,
  sql`update ${identifier(table)} set "permission" = "permission" where false`,
  sql`delete from ${identifier(table)} where false`,
];

describe('permission graph privileges', () => {
  const { setup, teardown, context } = setupTests();
  beforeEach(setup);
  afterEach(teardown);

  test('app users can read the graph and caches but not write them', async () => {
    await setupBlog(context, { combineAssignmentsWith: "role" });
    await seedGraph(context);
    const user = context.database_user_username;

    for (const table of [...graphTables, ...cacheTables]) {
      expect(await as(context, user, sql`select count(*)::int as "n" from ${identifier(table)}`)).toHaveLength(1);
      for (const statement of writeStatements(table)) {
        await expectRejected(as(context, user, statement));
      }
    }
  });

  test('app users cannot grant themselves access', async () => {
    await setupBlog(context);
    await seedGraph(context);
    const user = context.database_user_username;
    const visibleToRole2 = async () => (await as(context, user, sql`select count(*)::int as "n" from "blog_post"`, raw("2")))[0].n;

    expect(await visibleToRole2()).toBe(0);
    await expectRejected(as(context, user, sql`insert into "assignment_edge" ("resource_id", "role_id", "permission") values (1, 2, ${bits("1111")})`));
    await expectRejected(as(context, user, sql`insert into "resource_edge_cache" values (1, 2, ${bits("1111")})`));
    await expectRejected(as(context, user, sql`select "resource_edge_cache_backfill"()`));
    await expectRejected(as(context, user, sql`select "resource_trigger_disable"()`));
    expect(await visibleToRole2()).toBe(0);
  });

  test('app users cannot take over the id of another row', async () => {
    await setupBlog(context);
    await seedGraph(context);
    const user = context.database_user_username;
    // Role 1 may insert in group 2, and would inherit the permissions of group 3 by reusing its id
    await expectRejected(as(context, user, sql`insert into "blog_post" ("group_id", "resource_id", "name") values (2, 3, 'stolen')`, raw("1")), /already used/);
    await expectRejected(as(context, user, sql`update "blog_post" set "resource_id" = 3 where "group_id" = 2`, raw("1")), /already used|cannot change|row-level security/);
    expect(await cacheMismatches(context, "none")).toEqual(noMismatches);
  });

  test('app users cannot insert rows without a parent', async () => {
    await setupBlog(context);
    await seedGraph(context);
    await expectRejected(as(context, context.database_user_username, sql`insert into "blog_post" ("name") values ('orphan')`, raw("1")), /row-level security/);
  });

  test('graph writers can change the graph, and caches follow', async () => {
    await setupBlog(context, { combineAssignmentsWith: "role" });
    const writer = context.database_writer_username;

    // Default ids come from the p9s sequences
    const [[resource], [role]] = await context.runTestQuery(sql`
      insert into "resource_group" default values returning "id";
      insert into "role_group" default values returning "id";
      insert into "resource_group" ("id") values (100);`);
    await as(context, writer, sql`insert into "resource_edge" values (100, ${raw(String(resource.id))}, ${bits("1010")})`);
    await as(context, writer, sql`insert into "assignment_edge" ("resource_id", "role_id", "permission") values (100, ${raw(String(role.id))}, ${bits("1111")})`);

    expect(await cacheMismatches(context, "role")).toEqual(noMismatches);
    expect(await as(context, writer, sql`select "resource_id", "permission" from "assignment_edge_cache"`))
      .toEqual([{ resource_id: 100, permission: "1111" }]);

    for (const table of cacheTables) {
      await expectRejected(as(context, writer, sql`delete from ${identifier(table)} where false`));
    }
  });

  test('edges and assignments must connect rows of bound tables', async () => {
    await setupBlog(context, { combineAssignmentsWith: "role" });
    await seedGraph(context);
    const writer = context.database_writer_username;
    await expectRejected(as(context, writer, sql`insert into "resource_edge" values (1, 99, ${bits("1111")})`), /does not connect two rows/);
    await expectRejected(as(context, writer, sql`insert into "role_edge" values (99, 1, ${bits("1111")})`), /does not connect two rows/);
    await expectRejected(as(context, writer, sql`update "resource_edge" set "child_id" = 99 where "child_id" = 3`), /does not connect two rows/);
    await expectRejected(as(context, writer, sql`insert into "assignment_edge" ("resource_id", "role_id", "permission") values (99, 1, ${bits("1111")})`), /does not reference rows/);
    await expectRejected(as(context, writer, sql`insert into "assignment_edge" ("resource_id", "role_id", "permission") values (1, 99, ${bits("1111")})`), /does not reference rows/);
    expect(await cacheMismatches(context, "role")).toEqual(noMismatches);
  });

  test('home edges are only created and removed by p9s', async () => {
    await setupBlog(context);
    await seedGraph(context);
    const writer = context.database_writer_username;
    const [[post]] = await context.runTestQuery(sql`select "resource_id" from "blog_post" where "group_id" = 2`);
    const postId = raw(String(post.resource_id));
    const homeEdges = async () => (await context.runTestQuery(sql`
      select "parent_id", "permission", "home" from "resource_edge" where "child_id" = ${postId}`))[0];
    expect(await homeEdges()).toEqual([{ parent_id: 2, permission: "1111", home: true }]);

    await expectRejected(as(context, writer, sql`insert into "resource_edge" values (3, ${postId}, ${bits("1111")}, true)`), /home edges are created by p9s/);
    await expectRejected(as(context, writer, sql`delete from "resource_edge" where "child_id" = ${postId}`), /home edges are removed by moving or deleting their row/);
    await expectRejected(as(context, writer, sql`update "resource_edge" set "home" = true where "parent_id" = 1 and "child_id" = 2`), /cannot be made a home edge/);

    // Changing a home edge claims it: it stays when its row moves away
    await as(context, writer, sql`update "resource_edge" set "permission" = ${bits("1000")} where "child_id" = ${postId}`);
    expect(await homeEdges()).toEqual([{ parent_id: 2, permission: "1000", home: false }]);
    await context.exec(sql`update "blog_post" set "group_id" = 3 where "resource_id" = ${postId}`);
    expect(await homeEdges()).toEqual([
      { parent_id: 2, permission: "1000", home: false },
      { parent_id: 3, permission: "1111", home: true },
    ]);
    expect(await cacheMismatches(context, "none")).toEqual(noMismatches);
  });

  test('ids of bound rows cannot change', async () => {
    await setupBlog(context);
    await seedGraph(context);
    await expectRejected(context.exec(sql`update "resource_group" set "id" = 50 where "id" = 1`), /cannot change/);
    await expectRejected(context.exec(sql`update "blog_post" set "resource_id" = 50 where "group_id" = 3`), /cannot change/);
  });

  test('truncate is rejected while triggers are enabled', async () => {
    await setupBlog(context);
    await seedGraph(context);
    for (const table of ["blog_post", "resource_group", "resource_edge", "assignment_edge"]) {
      await expectRejected(context.exec(sql`truncate ${identifier(table)} cascade`), /cannot be truncated/);
    }
    expect(await cacheMismatches(context, "none")).toEqual(noMismatches);
  });

  test('triggers ignore temporary tables that shadow p9s tables', async () => {
    await setupBlog(context);
    await seedGraph(context);
    await context.exec(sql`insert into "resource_group" ("id") values (4)`);
    const writer = context.database_writer_username;

    // Without a pinned search_path, pg_temp is searched first and the trigger would compute from the fake edge 3 -> 2
    await as(context, writer, sql`
      create temp table "resource_edge" ("parent_id" integer, "child_id" integer, "permission" bit(4)) on commit drop;
      insert into pg_temp."resource_edge" values (3, 2, ${bits("1111")});
      insert into public."resource_edge" values (3, 4, ${bits("1111")})
    `);
    expect(await cacheMismatches(context, "none")).toEqual(noMismatches);
    const [[fake]] = await context.runTestQuery(sql`select count(*)::int as "n" from "resource_edge_cache" where "parent_id" = 3 and "child_id" = 2`);
    expect(fake.n).toBe(0);
  });

  test('graph writes outside READ COMMITTED are rejected', async () => {
    await setupBlog(context);
    await seedGraph(context);
    await expectRejected(context.runTestQuery(sql`
      set transaction isolation level repeatable read;
      insert into "resource_edge" values (2, 3, ${bits("1111")})
    `), /READ COMMITTED/);
    await expectRejected(context.runTestQuery(sql`
      set transaction isolation level repeatable read;
      update "blog_post" set "group_id" = 3 where "group_id" = 2
    `), /READ COMMITTED/);
    expect(await cacheMismatches(context, "none")).toEqual(noMismatches);
  });
});
