import { expect, describe, test, beforeEach, afterEach } from 'bun:test'
import { query as sql, identifier, raw } from "pg-sql2";
import { createMigration } from '../generation';
import { setupTests, testDatabaseUrl } from '@p9s/postgres-testing';
import {
  FIRST_GENERATED_ID, OPERATION_BITS, as, bits, blogMigrationConfig, cacheMismatches, combineModes, createGraphDriver, createPermissionModel, createRandom, emptyGraph,
  fromNodeId, noMismatches, randomOperation, setupBlog, setupBlogTables, type TestContext,
} from './helpers';

const graphTables = ["resource_edge", "resource_edge_cache", "assignment_edge", "role_edge", "role_edge_cache"];

// Every graph row, to check that a write left the graph exactly as it was
const graphState = async (context: TestContext) => {
  const results = await context.runTestQuery(sql`${raw(graphTables.map(table => `select md5(coalesce(string_agg(t::text, ',' order by t::text), '')) as "${table}" from "${table}" as t;`).join("\n"))}`);
  return Object.assign({}, ...results.map(rows => rows[0]));
};

const userTriggers = async (context: TestContext, table: string) => {
  const [rows] = await context.runTestQuery(sql`select "tgname" from pg_trigger where "tgrelid" = ${raw(`'${table}'::regclass`)} and not "tgisinternal" order by 1`);
  return rows.map((row: { tgname: string }) => row.tgname);
};

describe('leaf tables', () => {
  const { setup, teardown, context } = setupTests();
  beforeEach(setup);
  afterEach(teardown);

  for (const combineAssignmentsWith of combineModes) {
    test(`leaf rows are not nodes: writing them leaves the graph untouched (combineAssignmentsWith: ${combineAssignmentsWith})`, async () => {
      await setupBlog(context, { combineAssignmentsWith });
      await context.exec(sql`
        insert into "resource_group" ("id", "parent_id") values (1, null), (2, 1);
        insert into "blog_post" ("group_id", "name") values (1, 'first'), (2, 'second');`);
      const [[columns], triggers] = [await context.runTestQuery(sql`
        select array_agg("column_name"::text order by "column_name") as "names" from "information_schema"."columns" where "table_name" = 'blog_comment'`), await userTriggers(context, "blog_comment")];
      // No resource id: only the id of the parent post, which policies read rather than look the post up
      expect(columns[0].names).toEqual(["body", "id", "post_id", "resource_parent_id"]);
      expect(triggers).toEqual(["10_blog_comment_resource_parent_trigger"]);

      const before = await graphState(context);
      await context.exec(sql`
        insert into "blog_comment" ("post_id", "body") select "id", 'comment' from "blog_post", generate_series(1, 500);
        update "blog_comment" set "body" = 'edited';
        update "blog_comment" set "post_id" = (select max("id") from "blog_post");
        delete from "blog_comment" where "id" % 2 = 0;
        truncate "blog_comment";`);
      expect(await graphState(context)).toEqual(before);
    });
  }

  test('a leaf can hold the id of its parent node directly', async () => {
    await setupBlogTables(context);
    const user = identifier(context.database_user_username);
    await context.exec(sql`
      create table "group_note" ("id" serial primary key, "group_id" integer references "resource_group" ("id") on delete cascade);
      grant select, insert, update, delete on table "group_note" to ${user};
      grant usage on sequence "group_note_id_seq" to ${user};`);
    const config = blogMigrationConfig(context);
    await context.exec(createMigration({
      ...config,
      tables: [...config.tables, {
        name: "group_note",
        isResource: true,
        resourceLeaf: true,
        resourceParent: { column: "group_id" },
        permission: { [context.database_user_username]: { ...OPERATION_BITS } },
      }],
    }));
    const RESOURCES = 10, ROLES = 6;
    const driver = createGraphDriver(context, "integer", emptyGraph(RESOURCES, ROLES));
    await driver.createNodes();
    await context.exec(sql`insert into "group_note" ("group_id") select "id" from "resource_group"`);
    const random = createRandom(11);
    for (let i = 0; i < 40; i++) await randomOperation(driver, random, { allowNodeReset: false });
    const model = createPermissionModel(driver.graph);
    let visibleNotes = 0;
    for (let role = 1; role <= ROLES; role++) {
      const rows = await as(context, context.database_user_username, sql`select "group_id" from "group_note"`, raw(String(role)));
      const visible = rows.map(row => fromNodeId(row.group_id)).sort((a, b) => a - b);
      visibleNotes += visible.length;
      const expected = Array.from({ length: RESOURCES }, (_, i) => i + 1).filter(resource => model.allowed(role, resource, OPERATION_BITS.select));
      expect({ role, visible }).toEqual({ role, visible: expected });
    }
    expect(visibleNotes).toBeGreaterThan(0);
  });

  test('the parent id of a leaf row follows its parent column, whatever the client writes', async () => {
    await setupBlog(context);
    await context.exec(sql`
      insert into "resource_group" ("id") values (1), (2);
      insert into "role_group" ("id") values (1);
      insert into "blog_post" ("group_id", "name") values (1, 'readable'), (2, 'hidden');
      insert into "assignment_edge" ("resource_id", "role_id", "permission") values (1, 1, ${bits("1111")});`);
    const [[readable, hidden]] = await context.runTestQuery(sql`select "id", "resource_id" from "blog_post" order by "id"`);
    const user = context.database_user_username;
    const parentIds = async () => (await context.runTestQuery(sql`select "body", "resource_parent_id" from "blog_comment" order by "body"`))[0];

    // Pointing a comment of the hidden post at the readable post's node would make it visible
    await context.exec(sql`
      insert into "blog_comment" ("post_id", "body", "resource_parent_id") values (${raw(String(hidden.id))}, 'forged', ${raw(String(readable.resource_id))});
      insert into "blog_comment" ("post_id", "body") values (${raw(String(hidden.id))}, 'updated');
      update "blog_comment" set "resource_parent_id" = ${raw(String(readable.resource_id))} where "body" = 'updated';`);
    expect(await parentIds()).toEqual([
      { body: "forged", resource_parent_id: hidden.resource_id },
      { body: "updated", resource_parent_id: hidden.resource_id },
    ]);
    expect(await as(context, user, sql`select "body" from "blog_comment"`, raw("1"))).toEqual([]);
    await expect(as(context, user, sql`insert into "blog_comment" ("post_id", "body", "resource_parent_id") values (${raw(String(hidden.id))}, 'forged', ${raw(String(readable.resource_id))})`, raw("1")))
      .rejects.toThrow("row-level security");

    await context.exec(sql`update "blog_comment" set "post_id" = ${raw(String(readable.id))} where "body" = 'updated'`);
    expect((await parentIds())[1]).toEqual({ body: "updated", resource_parent_id: readable.resource_id });
    expect(await as(context, user, sql`select "body" from "blog_comment"`, raw("1"))).toEqual([{ body: "updated" }]);

    await context.exec(sql`alter table "blog_comment" drop constraint "blog_comment_post_id_fkey"`);
    await expect(context.exec(sql`insert into "blog_comment" ("post_id", "body") values (-1, 'dangling')`)).rejects.toThrow("matches no row of blog_post");
  });

  test('a leaf without parent is out of reach of users', async () => {
    await setupBlog(context);
    await context.exec(sql`
      insert into "resource_group" ("id") values (1);
      insert into "role_group" ("id") values (1);
      insert into "blog_post" ("group_id", "name") values (1, 'post');
      insert into "assignment_edge" ("resource_id", "role_id", "permission") values (1, 1, ${bits("1111")});
      insert into "blog_comment" ("post_id", "body") values (null, 'orphan');`);
    const user = context.database_user_username;
    expect(await as(context, user, sql`select "body" from "blog_comment"`, raw("1"))).toEqual([]);
    await expect(as(context, user, sql`insert into "blog_comment" ("post_id", "body") values (null, 'orphan')`, raw("1"))).rejects.toThrow("row-level security");
    await expect(as(context, user, sql`update "blog_comment" set "post_id" = null`, raw("1"))).resolves.toEqual([]);
    await context.exec(sql`insert into "blog_comment" ("post_id", "body") select "id", 'comment' from "blog_post"`);
    await expect(as(context, user, sql`update "blog_comment" set "post_id" = null where "post_id" is not null`, raw("1"))).rejects.toThrow("row-level security");
  });

  describe('a node table that becomes a leaf table', () => {
    // Comments as nodes, under their post through a lookup of the post id
    const nodeComments = () => {
      const config = blogMigrationConfig(context);
      return {
        ...config,
        tables: config.tables.map(table => table.name === "blog_comment" ? { ...table, resourceLeaf: false, resourceId: "resource_id" } : table),
      };
    };
    const setupNodeComments = async () => {
      await setupBlogTables(context);
      await context.exec(createMigration(nodeComments()));
      await context.exec(sql`
        select setval('resource_id_seq', ${raw(String(FIRST_GENERATED_ID))});
        insert into "resource_group" ("id", "parent_id") values (1, null), (2, 1), (3, 1);
        insert into "role_group" ("id") values (1), (2);
        insert into "blog_post" ("group_id", "name") values (2, 'post'), (3, 'other post');
        insert into "blog_comment" ("post_id", "body") select "id", 'comment ' || s from "blog_post", generate_series(1, 3) as s;
        insert into "assignment_edge" ("resource_id", "role_id", "permission") values (2, 1, ${bits("1111")}), (3, 2, ${bits("1000")});`);
    };
    const comments = (role: number) => as(context, context.database_user_username, sql`select "body", "post_id" from "blog_comment" order by "id"`, raw(String(role)));

    test('loses its nodes, edges and assignments, and its rows get the permissions of their parent', async () => {
      await setupNodeComments();
      // A comment shared with the other group and assigned on its own, which the leaf table no longer allows
      await context.exec(sql`
        insert into "resource_edge" ("parent_id", "child_id", "permission")
        select 3, "resource_id", ${bits("1111")} from "blog_comment" where "body" = 'comment 1' and "post_id" = (select "id" from "blog_post" where "group_id" = 2);
        insert into "assignment_edge" ("resource_id", "role_id", "permission")
        select "resource_id", 2, ${bits("1111")} from "blog_comment" where "body" = 'comment 2' and "post_id" = (select "id" from "blog_post" where "group_id" = 2);`);
      expect(await userTriggers(context, "blog_comment")).not.toEqual([]);
      expect((await comments(2)).length).toBe(5);

      await context.exec(createMigration(blogMigrationConfig(context)));
      expect(await userTriggers(context, "blog_comment")).toEqual(["10_blog_comment_resource_parent_trigger"]);
      const [[leftovers]] = await context.runTestQuery(sql`
        select
          (select count(*) from "resource_edge" join "blog_comment" on "resource_id" in ("parent_id", "child_id"))::int as "edges",
          (select count(*) from "resource_edge_cache" join "blog_comment" on "resource_id" in ("parent_id", "child_id"))::int as "cache",
          (select count(*) from "assignment_edge" join "blog_comment" using ("resource_id"))::int as "assignments"`);
      expect(leftovers).toEqual({ edges: 0, cache: 0, assignments: 0 });
      expect(await cacheMismatches(context, "none")).toEqual(noMismatches);
      expect((await comments(1)).length).toBe(3);
      expect((await comments(2)).length).toBe(3);

      // Running the migration again changes nothing, and writing comments no longer touches the graph
      await context.exec(createMigration(blogMigrationConfig(context)));
      const before = await graphState(context);
      await context.exec(sql`insert into "blog_comment" ("post_id", "body") select "id", 'new' from "blog_post"`);
      expect(await graphState(context)).toEqual(before);

      // And back: the comments become nodes again, each under its post
      await context.exec(createMigration(nodeComments()));
      const [[nodes]] = await context.runTestQuery(sql`
        select
          (select count(*) from "blog_comment")::int as "comments",
          (select count(*) from "resource_edge" join "blog_comment" on "child_id" = "resource_id" join "blog_post" on "blog_post"."id" = "post_id"
            where "parent_id" = "blog_post"."resource_id" and "home")::int as "home_edges"`);
      expect(nodes).toEqual({ comments: 8, home_edges: 8 });
      expect(await cacheMismatches(context, "none")).toEqual(noMismatches);
      expect((await comments(2)).length).toBe(4);
      expect(await userTriggers(context, "blog_comment")).not.toContain("10_blog_comment_resource_parent_trigger");
    });

    test('stops the migration while its rows have children', async () => {
      await setupNodeComments();
      await context.exec(sql`
        insert into "resource_edge" ("parent_id", "child_id", "permission")
        select "resource_id", 3, ${bits("1111")} from "blog_comment" limit 1;`);
      await expect(context.exec(createMigration(blogMigrationConfig(context)))).rejects.toThrow("cannot become a leaf table");
    });
  });
});

// Leaf writes need no graph lock, so they go on while a graph writer holds it
describe.skipIf(!testDatabaseUrl)('leaf writes and the graph lock (real Postgres only)', () => {
  const { setup, teardown, context } = setupTests();
  beforeEach(setup);
  afterEach(teardown);

  test('a graph write in progress does not block leaf writes', async () => {
    await setupBlog(context);
    await context.exec(sql`
      insert into "resource_group" ("id") values (1), (2);
      insert into "blog_post" ("group_id", "name") values (1, 'post');`);
    const [graphWriter, other] = [await context.connect(), await context.connect()];
    try {
      await graphWriter.query(`begin; insert into "resource_group" ("id", "parent_id") values (3, 1)`);
      await other.query(`set lock_timeout = '500ms'`);
      await other.query(`insert into "blog_comment" ("post_id", "body") select "id", 'comment' from "blog_post"`);
      await other.query(`update "blog_comment" set "body" = 'edited'`);
      await other.query(`delete from "blog_comment"`);
      await expect(other.query(`insert into "blog_post" ("group_id", "name") values (2, 'post')`)).rejects.toThrow("lock timeout");
      await graphWriter.query(`rollback`);
    } finally {
      await Promise.all([graphWriter.end(), other.end()]);
    }
  });
});
