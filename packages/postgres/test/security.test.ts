import { expect, describe, test, beforeEach, afterEach } from 'bun:test'
import { query as sql, identifier, raw } from "pg-sql2";
import { setupTests } from '@p9s/postgres-testing';
import { as, bits, cacheMismatches, noMismatches, setupBlog, type TestContext } from './helpers';

const expectRejected = async (promise: Promise<unknown>, message: RegExp = /permission denied/) => {
  let error: unknown;
  try { await promise; } catch (e) { error = e; }
  expect(String(error)).toMatch(message);
};

// Resources 1 -> 2 and 1 -> 3, roles 1 and 2, role 1 has every bit on resource 2
const seedGraph = async (ctx: TestContext) => {
  await ctx.exec(sql`
    insert into "resource_node" ("id") values (1), (2), (3);
    insert into "resource_edge" values (1, 2, ${bits("1111")}), (1, 3, ${bits("1111")});
    insert into "role_node" ("id") values (1), (2);
    insert into "assignment_edge" ("resource_id", "role_id", "permission") values (2, 1, ${bits("1111")});
    insert into "blog_post" ("resource_id", "name") values (2, 'two'), (3, 'three');
  `);
};

const graphTables = ["resource_node", "resource_edge", "role_node", "role_edge", "assignment_edge"];
const cacheTables = ["resource_edge_cache", "role_edge_cache", "assignment_edge_cache"];

// Privileges are checked before execution, so these fail even when they would not touch a row
const writeStatements = (table: string) => {
  const column = identifier(table.endsWith("_node") ? "id" : "permission");
  return [
    sql`insert into ${identifier(table)} select * from ${identifier(table)} where false`,
    sql`update ${identifier(table)} set ${column} = ${column} where false`,
    sql`delete from ${identifier(table)} where false`,
  ];
};

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

  test('graph writers can change the graph, and caches follow', async () => {
    await setupBlog(context, { combineAssignmentsWith: "role" });
    const writer = context.database_writer_username;

    // Default ids come from the serial sequences, which writers must be able to use
    const [resource] = await as(context, writer, sql`insert into "resource_node" default values returning "id"`);
    const [role] = await as(context, writer, sql`insert into "role_node" default values returning "id"`);
    await as(context, writer, sql`insert into "resource_node" ("id") values (100)`);
    await as(context, writer, sql`insert into "resource_edge" values (100, ${raw(String(resource.id))}, ${bits("1010")})`);
    await as(context, writer, sql`insert into "assignment_edge" ("resource_id", "role_id", "permission") values (100, ${raw(String(role.id))}, ${bits("1111")})`);

    expect(await cacheMismatches(context, "role")).toEqual(noMismatches);
    expect(await as(context, writer, sql`select "resource_id", "permission" from "assignment_edge_cache"`))
      .toEqual([{ resource_id: 100, permission: "1111" }]);

    for (const table of cacheTables) {
      await expectRejected(as(context, writer, sql`delete from ${identifier(table)} where false`));
    }
  });

  test('triggers ignore temporary tables that shadow p9s tables', async () => {
    await setupBlog(context);
    await seedGraph(context);
    const writer = context.database_writer_username;

    // Without a pinned search_path, pg_temp is searched first and the trigger would compute from the fake edge 3 -> 2
    await as(context, writer, sql`
      create temp table "resource_edge" ("parent_id" integer, "child_id" integer, "permission" bit(4)) on commit drop;
      insert into pg_temp."resource_edge" values (3, 2, ${bits("1111")});
      insert into public."resource_node" ("id") values (4);
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
    expect(await cacheMismatches(context, "none")).toEqual(noMismatches);
  });
});
