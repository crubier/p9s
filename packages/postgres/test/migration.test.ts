import { expect, describe, test, beforeEach, afterEach } from 'bun:test'
import { readFileSync } from "node:fs";
import { join as joinPath } from "node:path";
import { query as sql, identifier, join, raw } from "pg-sql2";
import { setupTests } from '@p9s/postgres-testing';
import { createMigration } from '../generation';
import {
  FIRST_GENERATED_ID, as, bits, blogMigrationConfig, cacheMismatches, createGraphDriver, createRandom, emptyGraph, noMismatches, nodeId, randomOperation,
  setupBlog, setupBlogTables, type CombineMode, type IdMode, type TestContext,
} from './helpers';

const snapshot = async (ctx: TestContext) => {
  const [resourceEdges, roleEdges, resourceCache, roleCache, assignments, posts] = await ctx.runTestQuery(sql`
    select * from "resource_edge" order by 1, 2;
    select * from "role_edge" order by 1, 2;
    select * from "resource_edge_cache" order by 1, 2;
    select * from "role_edge_cache" order by 1, 2;
    select * from "assignment_edge" order by 1, 2;
    select "id", "resource_id", "group_id", "name" from "blog_post" order by 1
  `);
  const visible = [];
  for (let role = 1; role <= 6; role++) {
    visible.push(await as(ctx, ctx.database_user_username, sql`select "resource_id" from "blog_post" order by 1`, nodeId("integer", role)));
  }
  return { resourceEdges, roleEdges, resourceCache, roleCache, assignments, posts, visible };
};

const fixture = (name: string, ctx: TestContext) => readFileSync(joinPath(import.meta.dir, "fixtures", `${name}.sql`), "utf8")
  .replaceAll("p9s_fixture_user", ctx.database_user_username)
  .replaceAll("p9s_fixture_writer", ctx.database_writer_username);

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
    await context.exec(sql`insert into "blog_post" ("group_id", "name") select "id", 'post ' || "id" from "resource_group"`);
    const random = createRandom(3);
    for (let i = 0; i < 60; i++) await randomOperation(driver, random, { allowNodeReset: false });

    const before = await snapshot(context);
    await context.exec(createMigration(blogMigrationConfig(context)));
    expect(await snapshot(context)).toEqual(before);
    expect(await cacheMismatches(context, "none")).toEqual(noMismatches);
  });

  test('binding a table that already has rows gives each row its own id', async () => {
    await setupBlogTables(context);
    await context.exec(sql`
      insert into "resource_group" ("id") values (1);
      insert into "blog_post" ("name", "group_id") values ('a', 1), ('b', 1), ('c', null);
    `);
    await context.exec(createMigration(blogMigrationConfig(context)));

    const [posts, selfRows, edges, column] = await context.runTestQuery(sql`
      select "name", "resource_id" from "blog_post" order by "name";
      select "child_id" from "resource_edge_cache" where "parent_id" = "child_id" order by 1;
      select "parent_id", "child_id", "home" from "resource_edge" order by 2;
      select "is_nullable" from "information_schema"."columns" where "table_name" = 'blog_post' and "column_name" = 'resource_id'
    `);
    const ids = posts.map((post: { resource_id: number }) => post.resource_id);
    expect(posts.map((post: { name: string }) => post.name)).toEqual(["a", "b", "c"]);
    expect(new Set([1, ...ids]).size).toBe(4);
    expect(selfRows.map((row: { child_id: number }) => row.child_id)).toEqual([1, ...ids].sort((a, b) => a - b));
    expect(edges).toEqual(ids.slice(0, 2).map((id: number) => ({ parent_id: 1, child_id: id, home: true })));
    expect(column).toEqual([{ is_nullable: "NO" }]);
    expect(await cacheMismatches(context, "none")).toEqual(noMismatches);
  });

  test('enabling triggers brings home edges in line with rows written while they were disabled', async () => {
    await setupBlog(context);
    await context.exec(sql`
      insert into "resource_group" ("id", "parent_id") values (1, null), (2, 1), (3, 1);
      select "resource_trigger_disable"();
      insert into "resource_group" ("id", "parent_id") values (4, 2);
      update "resource_group" set "parent_id" = 2 where "id" = 3;
      insert into "blog_post" ("group_id", "name") values (4, 'post');
      select "resource_trigger_enable"();
    `);
    const [edges] = await context.runTestQuery(sql`select "parent_id", "child_id", "home" from "resource_edge" where "child_id" < 100 order by 2`);
    expect(edges).toEqual([
      { parent_id: 1, child_id: 2, home: true },
      { parent_id: 2, child_id: 3, home: true },
      { parent_id: 2, child_id: 4, home: true },
    ]);
    const [[post]] = await context.runTestQuery(sql`
      select count(*)::int as "n" from "resource_edge_cache" join "blog_post" on "child_id" = "resource_id" where "parent_id" = 1`);
    expect(post.n).toBe(1);
    expect(await cacheMismatches(context, "none")).toEqual(noMismatches);
  });

  test('switching combineAssignmentsWith leaves no stale triggers behind', async () => {
    const migrate = (combineAssignmentsWith: CombineMode) =>
      context.exec(createMigration(blogMigrationConfig(context, { combineAssignmentsWith })));
    const assignmentGuards = ["05_assignment_edge_validate_insert_trigger", "05_assignment_edge_validate_update_trigger", "05_truncate_guard_trigger"];

    await setupBlog(context, { combineAssignmentsWith: "role" });
    expect(await userTriggers(context, "role_edge_cache")).toHaveLength(3);
    expect(await userTriggers(context, "assignment_edge")).toHaveLength(6);

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
    expect(await userTriggers(context, "assignment_edge")).toEqual(assignmentGuards);
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
    const [tables] = await context.runTestQuery(sql`select count(*)::int as "n" from "pg_tables" where "tablename" = 'resource_edge'`);
    expect(tables).toEqual([{ n: 0 }]);
  });

  test('in integer mode, it refuses to bind id columns that generate their own ids', async () => {
    await setupBlogTables(context);
    await context.exec(sql`alter table "role_group" alter column "id" add generated by default as identity`);
    const config = blogMigrationConfig(context);
    // "blog_post"."id" is a serial
    const ownIds = { ...config, tables: config.tables.map(table => table.name === "blog_post" ? { ...table, resourceId: "id" } : table) };
    let error: unknown;
    try {
      await context.exec(createMigration(ownIds));
    } catch (e) { error = e; }
    expect(String(error)).toMatch(/already generate their own ids/);
    expect(String(error)).toContain(`"blog_post".id`);
    expect(String(error)).toContain(`"role_group".id`);
    expect(String(error)).not.toContain(`"resource_group".id`);
    const [tables] = await context.runTestQuery(sql`select count(*)::int as "n" from "pg_tables" where "tablename" in ('resource_edge', 'role_edge')`);
    expect(tables).toEqual([{ n: 0 }]);
  });

  test('in uuid mode, an id column keeps its own default', async () => {
    await setupBlogTables(context, { idMode: "uuid" });
    await context.exec(sql`alter table "resource_group" alter column "id" set default uuid_generate_v4()`);
    await context.exec(createMigration(blogMigrationConfig(context, { idMode: "uuid" })));
    await context.exec(createMigration(blogMigrationConfig(context, { idMode: "uuid" })));
    const [groups] = await context.runTestQuery(sql`insert into "resource_group" default values returning "id"`);
    const [cache] = await context.runTestQuery(sql`select count(*)::int as "n" from "resource_edge_cache" where "parent_id" = ${raw(`'${groups[0].id}'`)} and "child_id" = "parent_id"`);
    expect(cache).toEqual([{ n: 1 }]);
  });
});

// Databases set up by the p9s versions with node tables: blog_post was the only bound table, other nodes were bare
const legacyConfigurations: Array<{ fixtureName: string, idMode: IdMode, combineAssignmentsWith: CombineMode }> = [
  { fixtureName: "node-mode-none-integer", idMode: "integer", combineAssignmentsWith: "none" },
  { fixtureName: "node-mode-role-uuid", idMode: "uuid", combineAssignmentsWith: "role" },
];

for (const { fixtureName, idMode, combineAssignmentsWith } of legacyConfigurations) {
  describe(`upgrade from node tables (${fixtureName})`, () => {
    const { setup, teardown, context } = setupTests();
    beforeEach(setup);
    afterEach(teardown);

    const id = (n: number) => nodeId(idMode, n);
    const idType = idMode === "uuid" ? sql`uuid` : sql`integer`;
    const RESOURCES = 10, ROLES = 6, POSTS_FROM = 7;

    // Nodes 7 to 10 are posts, every resource node has at most one parent, plus a few extra edges
    const setupLegacy = async () => {
      await context.exec(sql`
        create extension if not exists "uuid-ossp";
        create table "blog_post" ("id" serial primary key, "name" text not null default '');
        grant select, insert, update, delete on table "blog_post" to ${identifier(context.database_user_username)};
        grant usage on sequence "blog_post_id_seq" to ${identifier(context.database_user_username)};
        create function "current_role_id"() returns ${idType} as $$
          select nullif(current_setting('jwt.claims.role_id', true), '')::${idType}
        $$ language sql stable;
      `);
      await context.exec(raw(fixture(fixtureName, context)));
      const random = createRandom(5);
      const edgeRows = [];
      for (let child = 2; child <= RESOURCES; child++) edgeRows.push(sql`(${id(random.int(1, Math.min(child - 1, POSTS_FROM - 1)))}, ${id(child)}, ${bits(random.bits(0.8))})`);
      edgeRows.push(sql`(${id(1)}, ${id(9)}, ${bits("1010")})`);
      const roleEdges = [sql`(${id(1)}, ${id(2)}, ${bits("1111")})`, sql`(${id(2)}, ${id(3)}, ${bits("1100")})`, sql`(${id(1)}, ${id(4)}, ${bits("0111")})`];
      const assignments = [];
      for (let role = 1; role <= ROLES; role++) assignments.push(sql`(${id(random.int(1, 4))}, ${id(role)}, ${bits(random.bits(0.8))})`);
      await context.exec(sql`
        insert into "resource_node" ("id") select ${idMode === "uuid" ? sql`(lpad(to_hex(i), 32, '0'))::uuid` : sql`i`} from generate_series(1, ${raw(String(RESOURCES))}) as i;
        insert into "role_node" ("id") select ${idMode === "uuid" ? sql`(lpad(to_hex(i), 32, '0'))::uuid` : sql`i`} from generate_series(1, ${raw(String(ROLES))}) as i;
        insert into "resource_edge" values ${join(edgeRows, ", ")} on conflict do nothing;
        insert into "role_edge" values ${join(roleEdges, ", ")};
        insert into "assignment_edge" ("resource_id", "role_id", "permission") values ${join(assignments, ", ")} on conflict do nothing;
        insert into "blog_post" ("resource_id", "name") select "id", 'post' from "resource_node" order by "id" offset ${raw(String(POSTS_FROM - 1))};
      `);
    };

    const visible = async () => {
      const result = [];
      for (let role = 1; role <= ROLES; role++) {
        result.push(await as(context, context.database_user_username, sql`select "resource_id" from "blog_post" order by 1`, id(role)));
      }
      return result;
    };

    // What the upgrade guide asks for: a bound table for the bare nodes, and parent columns
    const bindBareNodes = () => context.exec(sql`
      create table "resource_group" ("id" ${idType} primary key, "parent_id" ${idType} references "resource_group" ("id") on delete set null);
      create table "role_group" ("id" ${idType} primary key, "parent_id" ${idType} references "role_group" ("id") on delete set null);
      insert into "resource_group" ("id") select "id" from "resource_node" where "id" not in (select "resource_id" from "blog_post");
      insert into "role_group" ("id") select "id" from "role_node";
      update "resource_group" set "parent_id" = (select min("parent_id"::text)::${idType} from "resource_edge" where "child_id" = "resource_group"."id");
      alter table "blog_post" add column "group_id" ${idType} references "resource_group" ("id") on delete cascade;
      update "blog_post" set "group_id" = (select min("parent_id"::text)::${idType} from "resource_edge" where "child_id" = "blog_post"."resource_id");
    `);

    test('keeps edges, caches and access, and marks home edges', async () => {
      await setupLegacy();
      const before = await visible();
      expect(before.some(rows => rows.length > 0)).toBe(true);
      const [edgesBefore] = await context.runTestQuery(sql`select "parent_id", "child_id", "permission" from "resource_edge" order by 1, 2`);

      await bindBareNodes();
      await context.exec(createMigration(blogMigrationConfig(context, { idMode, combineAssignmentsWith })));

      const [nodeTables, edgesAfter, homeEdges, parentColumns] = await context.runTestQuery(sql`
        select count(*)::int as "n" from "pg_tables" where "tablename" in ('resource_node', 'role_node');
        select "parent_id", "child_id", "permission" from "resource_edge" order by 1, 2;
        select "child_id"::text, "parent_id"::text from "resource_edge" where "home" order by 1;
        select "id"::text as "child_id", "parent_id"::text from "resource_group" where "parent_id" is not null
        union all select "resource_id"::text, "group_id"::text from "blog_post" where "group_id" is not null order by 1;
      `);
      expect(nodeTables).toEqual([{ n: 0 }]);
      expect(edgesAfter).toEqual(edgesBefore);
      expect(homeEdges).toEqual(parentColumns);
      expect(await cacheMismatches(context, combineAssignmentsWith)).toEqual(noMismatches);
      expect(await visible()).toEqual(before);

      // New rows get ids no node had, and their home edge
      const [[post]] = await context.runTestQuery(sql`insert into "blog_post" ("group_id", "name") values (${id(1)}, 'new') returning "resource_id"`);
      if (idMode === "integer") expect(post.resource_id).toBe(RESOURCES + 1);
      expect(await cacheMismatches(context, combineAssignmentsWith)).toEqual(noMismatches);

      // And running it again changes nothing
      const again = await visible();
      await context.exec(createMigration(blogMigrationConfig(context, { idMode, combineAssignmentsWith })));
      expect(await visible()).toEqual(again);
    });

    test('refuses to drop nodes that are not rows of bound tables', async () => {
      await setupLegacy();
      const before = await visible();
      const config = blogMigrationConfig(context, { idMode, combineAssignmentsWith });
      const postsOnly = { ...config, tables: config.tables.filter(table => table.name === "blog_post").map(({ resourceParent, ...table }) => table) };
      let error: unknown;
      try {
        await context.exec(createMigration(postsOnly));
      } catch (e) { error = e; }
      expect(String(error)).toMatch(/6 resource nodes are not a row of a bound table/);
      const [[nodes]] = await context.runTestQuery(sql`select count(*)::int as "n" from "resource_node"`);
      expect(nodes.n).toBe(RESOURCES);
      expect(await visible()).toEqual(before);
    });
  });
}
