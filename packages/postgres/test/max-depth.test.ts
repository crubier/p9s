import { expect, describe, test, beforeEach, afterEach } from 'bun:test'
import { query as sql, raw } from "pg-sql2";
import { createMigration } from '../generation';
import { setupTests } from '@p9s/postgres-testing';
import { FIRST_GENERATED_ID, as, bits, blogMigrationConfig, cacheMismatches, noMismatches, setupBlogTables, type TestContext } from './helpers';

const tooDeep = (kind: string, maxDepth: number) => new RegExp(`the ${kind} edge .* makes a path of more than ${maxDepth} edges`);

const setupShallowBlog = async (context: TestContext, maxDepth: { resource: number, role: number }) => {
  await setupBlogTables(context);
  const config = blogMigrationConfig(context);
  await context.exec(createMigration({ ...config, engine: { ...config.engine, permission: { ...config.engine.permission, maxDepth } } }));
  await context.exec(sql`
    select setval('resource_id_seq', ${raw(String(FIRST_GENERATED_ID))});
    select setval('role_id_seq', ${raw(String(FIRST_GENERATED_ID))});`);
};

const groups = (context: TestContext, kind: "resource" | "role", rows: Array<[number, number | null]>) =>
  context.exec(sql`insert into ${raw(`"${kind}_group"`)} ("id", "parent_id") values ${raw(rows.map(([id, parent]) => `(${id}, ${parent ?? "null"})`).join(", "))}`);

describe('maxDepth', () => {
  const { setup, teardown, context } = setupTests();
  beforeEach(setup);
  afterEach(teardown);

  test('writes that make a resource path longer than maxDepth are rejected', async () => {
    await setupShallowBlog(context, { resource: 3, role: 3 });
    const rejected = (statement: Promise<unknown>) => expect(statement).rejects.toThrow(tooDeep("resource", 3));
    // 1 -> 2 -> 3 -> 4 has 3 edges
    await groups(context, "resource", [[1, null], [2, 1], [3, 2], [4, 3]]);

    // A row with a parent, in a tree table or in another table
    await rejected(groups(context, "resource", [[5, 4]]));
    await rejected(context.exec(sql`insert into "blog_post" ("group_id") values (4)`));
    await context.exec(sql`insert into "blog_post" ("group_id") values (3)`);

    // Moving a subtree: 6 -> 7 -> 8 fits under 1, not under 2
    await groups(context, "resource", [[6, null], [7, 6], [8, 7]]);
    await rejected(context.exec(sql`update "resource_group" set "parent_id" = 2 where "id" = 6`));
    await context.exec(sql`update "resource_group" set "parent_id" = 1 where "id" = 6`);

    // Several edges of one statement that only make a long path together, written by a graph writer
    await groups(context, "resource", [[9, null], [10, null]]);
    const writer = context.database_writer_username;
    await rejected(as(context, writer, sql`insert into "resource_edge" values (3, 9, ${bits("1111")}), (9, 10, ${bits("1111")})`));
    await as(context, writer, sql`insert into "resource_edge" values (2, 9, ${bits("1111")}), (9, 10, ${bits("1111")})`);
    // Changing the parent of an edge: 1 -> 2 -> 3 -> 9 -> 10
    await rejected(as(context, writer, sql`update "resource_edge" set "parent_id" = 3 where "parent_id" = 2 and "child_id" = 9`));

    // Rejected statements leave nothing behind
    const [[{ count }]] = await context.runTestQuery(sql`select count(*)::int as "count" from "resource_group" where "id" = 5`);
    expect(count).toBe(0);
    expect(await cacheMismatches(context, "none")).toEqual(noMismatches);
  });

  test('paths are counted without going around cycles', async () => {
    await setupShallowBlog(context, { resource: 2, role: 2 });
    const writer = context.database_writer_username;
    await groups(context, "resource", [[1, null], [2, null], [3, null], [4, null]]);
    await as(context, writer, sql`insert into "resource_edge" values (1, 2, ${bits("1111")}), (2, 3, ${bits("1111")})`);
    // 3 -> 1 closes a cycle, and every simple path in it, like 2 -> 3 -> 1, still has 2 edges
    await as(context, writer, sql`insert into "resource_edge" values (3, 1, ${bits("1111")})`);
    // 4 -> 1 -> 2 -> 3 would have 3
    await expect(as(context, writer, sql`insert into "resource_edge" values (4, 1, ${bits("1111")})`)).rejects.toThrow(tooDeep("resource", 2));
    await expect(as(context, writer, sql`insert into "resource_edge" values (3, 4, ${bits("1111")})`)).rejects.toThrow(tooDeep("resource", 2));
    expect(await cacheMismatches(context, "none")).toEqual(noMismatches);
  });

  test('the role tree has its own limit, and role leaf rows add no depth', async () => {
    await setupShallowBlog(context, { resource: 8, role: 2 });
    await groups(context, "role", [[1, null], [2, 1], [3, 2]]);
    await expect(groups(context, "role", [[4, 3]])).rejects.toThrow(tooDeep("role", 2));
    await context.exec(sql`insert into "api_key" ("group_id") values (3)`);
    await groups(context, "resource", [[1, null], [2, 1], [3, 2], [4, 3]]);
    expect(await cacheMismatches(context, "none")).toEqual(noMismatches);
  });

  test('rows loaded with the triggers disabled are checked when they are enabled again', async () => {
    await setupShallowBlog(context, { resource: 3, role: 3 });
    await context.exec(sql`select "resource_trigger_disable"()`);
    await groups(context, "resource", [[1, null], [2, 1], [3, 2], [4, 3], [5, 4]]);
    await expect(context.exec(sql`select "resource_trigger_enable"()`)).rejects.toThrow("the resource path 1 -> 2 -> 3 -> 4 -> 5 has more than 3 edges");
    await context.exec(sql`delete from "resource_group" where "id" = 5`);
    await context.exec(sql`select "resource_trigger_enable"()`);
    expect(await cacheMismatches(context, "none")).toEqual(noMismatches);
  });
});
