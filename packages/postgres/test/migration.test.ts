import { expect, describe, test, beforeEach, afterEach } from 'bun:test'
import { query as sql, identifier, raw } from "pg-sql2";
import { setupTests } from '@p9s/postgres-testing';
import { createMigration } from '../generation';
import {
  as, blogMigrationConfig, cacheMismatches, createGraphDriver, createRandom, emptyGraph, noMismatches, nodeId, randomOperation, setupBlog,
  type CombineMode, type TestContext,
} from './helpers';

const snapshot = async (ctx: TestContext) => {
  const [resourceCache, roleCache, assignments, posts] = await ctx.runTestQuery(sql`
    select * from "resource_edge_cache" order by 1, 2;
    select * from "role_edge_cache" order by 1, 2;
    select * from "assignment_edge" order by 1, 2;
    select "id", "resource_id", "name" from "blog_post" order by 1
  `);
  const visible = [];
  for (let role = 1; role <= 6; role++) {
    visible.push(await as(ctx, ctx.database_user_username, sql`select "resource_id" from "blog_post" order by 1`, nodeId("integer", role)));
  }
  return { resourceCache, roleCache, assignments, posts, visible };
};

const userTriggers = async (ctx: TestContext, table: string) => {
  const [rows] = await ctx.runTestQuery(sql`
    select "tgname" from "pg_trigger" where "tgrelid" = ${raw(`'${table}'`)}::regclass and not "tgisinternal" order by 1`);
  return rows.map((row: { tgname: string }) => row.tgname);
};

describe('migration', () => {
  const { setup, teardown, context } = setupTests();
  beforeEach(setup);
  afterEach(teardown);

  test('re-running it on a populated database keeps data, caches and access', async () => {
    await setupBlog(context);
    const driver = createGraphDriver(context, "integer", emptyGraph(10, 6));
    await driver.createNodes();
    await context.exec(sql`insert into "blog_post" ("resource_id", "name") select "id", 'post ' || "id" from "resource_node"`);
    const random = createRandom(3);
    for (let i = 0; i < 60; i++) await randomOperation(driver, random, { allowNodeReset: false });

    const before = await snapshot(context);
    await context.exec(createMigration(blogMigrationConfig(context)));
    expect(await snapshot(context)).toEqual(before);
    expect(await cacheMismatches(context, "none")).toEqual(noMismatches);
  });

  test('binding a table that already has rows gives each row its own node', async () => {
    await context.exec(sql`
      create table "blog_post" ("id" serial primary key, "name" text not null);
      insert into "blog_post" ("name") values ('a'), ('b'), ('c');
      create function "current_role_id"() returns integer as $$ select 1 $$ language sql stable;
    `);
    await context.exec(createMigration(blogMigrationConfig(context)));

    const [posts, nodes, column] = await context.runTestQuery(sql`
      select "name", "resource_id" from "blog_post" order by "name";
      select "id" from "resource_node" order by 1;
      select "is_nullable" from "information_schema"."columns" where "table_name" = 'blog_post' and "column_name" = 'resource_id'
    `);
    expect(posts.map((post: { name: string }) => post.name)).toEqual(["a", "b", "c"]);
    expect(new Set(posts.map((post: { resource_id: number }) => post.resource_id)).size).toBe(3);
    expect(nodes.map((node: { id: number }) => node.id).sort()).toEqual(posts.map((post: { resource_id: number }) => post.resource_id).sort());
    expect(column).toEqual([{ is_nullable: "NO" }]);
  });

  test('switching combineAssignmentsWith leaves no stale triggers behind', async () => {
    const migrate = (combineAssignmentsWith: CombineMode) =>
      context.exec(createMigration(blogMigrationConfig(context, { combineAssignmentsWith })));

    await setupBlog(context, { combineAssignmentsWith: "role" });
    expect(await userTriggers(context, "role_edge_cache")).toHaveLength(3);
    expect(await userTriggers(context, "assignment_edge")).toHaveLength(3);

    const driver = createGraphDriver(context, "integer", emptyGraph(8, 6));
    await driver.createNodes();
    const random = createRandom(11);
    for (let i = 0; i < 40; i++) await randomOperation(driver, random);

    await migrate("resource");
    expect(await userTriggers(context, "role_edge_cache")).toEqual([]);
    expect(await userTriggers(context, "resource_edge_cache")).toHaveLength(3);
    expect(await cacheMismatches(context, "resource")).toEqual(noMismatches);
    for (let i = 0; i < 40; i++) await randomOperation(driver, random);
    expect(await cacheMismatches(context, "resource")).toEqual(noMismatches);

    await migrate("none");
    expect(await userTriggers(context, "role_edge_cache")).toEqual([]);
    expect(await userTriggers(context, "resource_edge_cache")).toEqual([]);
    expect(await userTriggers(context, "assignment_edge")).toEqual([]);
    const [[combinedCache]] = await context.runTestQuery(sql`select count(*)::int as "n" from "pg_tables" where "tablename" = 'assignment_edge_cache'`);
    expect(combinedCache.n).toBe(0);
  });

  test('re-running it revokes write access granted by older versions', async () => {
    await setupBlog(context);
    const user = identifier(context.database_user_username);
    await context.exec(sql`
      grant insert, update, delete on "resource_edge_cache" to ${user};
      grant insert, update, delete on "assignment_edge" to ${user};
    `);
    await context.exec(createMigration(blogMigrationConfig(context)));

    for (const table of ["resource_edge_cache", "assignment_edge"]) {
      let error: unknown;
      try {
        await as(context, context.database_user_username, sql`delete from ${identifier(table)} where false`);
      } catch (e) { error = e; }
      expect(String(error)).toMatch(/permission denied/);
    }
  });

  test('it refuses to run when the current schema is not the configured one', async () => {
    await context.exec(sql`create schema "other"`);
    let error: unknown;
    try {
      await context.exec(sql`set search_path to "other"; ${createMigration(blogMigrationConfig(context))}`);
    } catch (e) { error = e; }
    await context.exec(sql`set search_path to "$user", public`);
    expect(String(error)).toMatch(/current schema/);
    const [tables] = await context.runTestQuery(sql`select count(*)::int as "n" from "pg_tables" where "tablename" = 'resource_node'`);
    expect(tables).toEqual([{ n: 0 }]);
  });
});
