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

const keyRoleIds = async (context: TestContext) => {
  const [rows] = await context.runTestQuery(sql`select "group_id", "role_id" from "api_key" order by "id"`);
  return rows as Array<{ group_id: number | null, role_id: number }>;
};

const postNames = (context: TestContext, currentRoleId: number) =>
  as(context, context.database_user_username, sql`select "name" from "blog_post" order by "name"`, raw(String(currentRoleId)));

describe('role leaf tables', () => {
  const { setup, teardown, context } = setupTests();
  beforeEach(setup);
  afterEach(teardown);

  for (const combineAssignmentsWith of combineModes) {
    test(`role leaf rows are not nodes: writing them leaves the graph untouched (combineAssignmentsWith: ${combineAssignmentsWith})`, async () => {
      await setupBlog(context, { combineAssignmentsWith });
      await context.exec(sql`insert into "role_group" ("id", "parent_id") values (1, null), (2, 1);`);
      const [[columns], triggers] = [await context.runTestQuery(sql`
        select array_agg("column_name"::text order by "column_name") as "names" from "information_schema"."columns" where "table_name" = 'api_key'`), await userTriggers(context, "api_key")];
      // A role id, that tells who the current user is, and no role parent id: the parent column holds the role id
      expect(columns[0].names).toEqual(["group_id", "id", "role_id"]);
      expect(triggers).toEqual(["10_api_key_role_parent_trigger"]);

      const before = await graphState(context);
      await context.exec(sql`
        insert into "api_key" ("group_id") select "id" from "role_group", generate_series(1, 500);
        update "api_key" set "group_id" = 2;
        delete from "api_key" where "id" % 2 = 0;
        truncate "api_key";`);
      expect(await graphState(context)).toEqual(before);
    });

    test(`a user that is a role leaf row has the permissions of its parent (combineAssignmentsWith: ${combineAssignmentsWith})`, async () => {
      await setupBlog(context, { combineAssignmentsWith });
      const RESOURCES = 10, ROLES = 6;
      const driver = createGraphDriver(context, "integer", emptyGraph(RESOURCES, ROLES));
      await driver.createNodes();
      await context.exec(sql`
        insert into "blog_post" ("group_id", "name") select "id", 'post ' || "id" from "resource_group";
        insert into "api_key" ("group_id") select "id" from "role_group" order by "id";
        insert into "api_key" ("group_id") values (null);`);
      const random = createRandom(17);
      // Resetting a group would delete its keys
      for (let i = 0; i < 40; i++) await randomOperation(driver, random, { allowNodeReset: false });
      const model = createPermissionModel(driver.graph);
      const keys = await keyRoleIds(context);
      let visiblePosts = 0;
      for (const key of keys) {
        const visible = (await postNames(context, key.role_id)).map(row => row.name).sort();
        if (key.group_id === null) {
          expect(visible).toEqual([]);
          continue;
        }
        const role = fromNodeId(key.group_id);
        visiblePosts += visible.length;
        const expected = Array.from({ length: RESOURCES }, (_, i) => i + 1).filter(resource => model.allowed(role, resource, OPERATION_BITS.select)).map(resource => `post ${resource}`).sort();
        expect({ role, visible }).toEqual({ role, visible: expected });
        expect((await postNames(context, role)).map(row => row.name).sort()).toEqual(visible);
      }
      expect(visiblePosts).toBeGreaterThan(0);

      // Writes too: a key can insert where its parent can
      for (const key of keys.filter(key => key.group_id !== null)) {
        const role = fromNodeId(key.group_id!);
        for (let resource = 1; resource <= RESOURCES; resource++) {
          const insert = as(context, context.database_user_username, sql`insert into "blog_post" ("group_id", "name") values (${raw(String(resource))}, 'new')`, raw(String(key.role_id)));
          if (model.allowed(role, resource, OPERATION_BITS.insert)) await insert;
          else await expect(insert).rejects.toThrow("row-level security");
        }
      }
    });
  }

  test('role ids of leaf rows are unique across the role tree, and are not nodes', async () => {
    await setupBlog(context);
    await context.exec(sql`
      insert into "role_group" ("id") values (1);
      insert into "resource_group" ("id") values (1);
      insert into "api_key" ("group_id") values (1);`);
    const [key] = await keyRoleIds(context);
    const keyId = raw(String(key!.role_id));
    expect(key!.role_id).toBeGreaterThan(FIRST_GENERATED_ID);

    await expect(context.exec(sql`insert into "role_group" ("id") values (${keyId})`)).rejects.toThrow("already used by another row");
    await expect(context.exec(sql`insert into "api_key" ("group_id", "role_id") values (1, 1)`)).rejects.toThrow("already used by another row");
    await expect(context.exec(sql`update "api_key" set "role_id" = 2`)).rejects.toThrow("cannot change");
    const writer = (statement: ReturnType<typeof sql>) => as(context, context.database_writer_username, statement);
    await expect(writer(sql`insert into "role_edge" ("parent_id", "child_id", "permission") values (1, ${keyId}, ${bits("1111")})`)).rejects.toThrow("does not connect two rows of bound tables");
    await expect(writer(sql`insert into "role_edge" ("parent_id", "child_id", "permission") values (${keyId}, 1, ${bits("1111")})`)).rejects.toThrow("does not connect two rows of bound tables");
    await expect(writer(sql`insert into "assignment_edge" ("resource_id", "role_id", "permission") values (1, ${keyId}, ${bits("1111")})`)).rejects.toThrow("does not reference rows of bound tables");

    // The backfill checks them too, for rows written while the triggers were off
    await context.exec(sql`
      alter table "api_key" disable trigger user;
      insert into "api_key" ("group_id", "role_id") values (1, 1);
      alter table "api_key" enable trigger user;`);
    await expect(context.exec(sql`select role_trigger_enable()`)).rejects.toThrow("used by more than one bound row");
  });

  test('a role leaf can follow a parent key, whatever the client writes', async () => {
    await setupBlogTables(context);
    const config = blogMigrationConfig(context);
    await context.exec(sql`
      create table "member" ("id" serial primary key, "group_id" integer references "role_group" ("id") on delete set null);
      create table "member_key" ("id" serial primary key, "member_id" integer references "member" ("id") on delete cascade);`);
    await context.exec(createMigration({
      ...config,
      tables: [...config.tables, {
        name: "member",
        isRole: true,
        roleId: "role_id",
        roleParent: { column: "group_id" },
      }, {
        name: "member_key",
        isRole: true,
        roleId: "role_id",
        roleLeaf: true,
        roleParent: { column: "member_id", table: "member", key: "id" },
      }],
    }));
    const [[columns]] = await context.runTestQuery(sql`
      select array_agg("column_name"::text order by "column_name") as "names" from "information_schema"."columns" where "table_name" = 'member_key'`);
    expect(columns.names).toEqual(["id", "member_id", "role_id", "role_parent_id"]);
    await context.exec(sql`
      select setval('resource_id_seq', ${raw(String(FIRST_GENERATED_ID))});
      select setval('role_id_seq', ${raw(String(FIRST_GENERATED_ID))});
      insert into "resource_group" ("id") values (1), (2);
      insert into "role_group" ("id") values (1), (2);
      insert into "member" ("group_id") values (1), (2);
      insert into "blog_post" ("group_id", "name") values (1, 'readable'), (2, 'hidden');
      insert into "assignment_edge" ("resource_id", "role_id", "permission") values (1, 1, ${bits("1111")});`);
    const [[readable, hidden]] = await context.runTestQuery(sql`select "id", "role_id" from "member" order by "id"`);

    // Pointing a key of the member without access at the other member's node would give it access
    await context.exec(sql`
      insert into "member_key" ("member_id", "role_parent_id") values (${raw(String(hidden.id))}, ${raw(String(readable.role_id))});
      insert into "member_key" ("member_id") values (${raw(String(readable.id))});
      update "member_key" set "role_parent_id" = ${raw(String(readable.role_id))} where "member_id" = ${raw(String(hidden.id))};`);
    const [keys] = await context.runTestQuery(sql`select "member_id", "role_id", "role_parent_id" from "member_key" order by "id"`);
    expect(keys.map((key: any) => key.role_parent_id)).toEqual([hidden.role_id, readable.role_id]);
    expect(await postNames(context, keys[0].role_id)).toEqual([]);
    expect(await postNames(context, keys[1].role_id)).toEqual([{ name: "readable" }]);

    await context.exec(sql`update "member_key" set "member_id" = ${raw(String(readable.id))}`);
    expect(await postNames(context, keys[0].role_id)).toEqual([{ name: "readable" }]);

    // Leaf ids are unique across leaf tables too
    await context.exec(sql`insert into "api_key" ("group_id") values (1)`);
    const [apiKey] = await keyRoleIds(context);
    await expect(context.exec(sql`insert into "member_key" ("member_id", "role_id") values (${raw(String(readable.id))}, ${raw(String(apiKey!.role_id))})`)).rejects.toThrow("already used by another row");
    await expect(context.exec(sql`insert into "api_key" ("group_id", "role_id") values (1, ${raw(String(keys[0].role_id))})`)).rejects.toThrow("already used by another row");

    await context.exec(sql`alter table "member_key" drop constraint "member_key_member_id_fkey"`);
    await expect(context.exec(sql`insert into "member_key" ("member_id") values (-1)`)).rejects.toThrow("matches no row of member");
  });

  describe('a role node table that becomes a role leaf table', () => {
    // Keys as nodes, under their group
    const nodeKeys = () => {
      const config = blogMigrationConfig(context);
      return {
        ...config,
        tables: config.tables.map(table => table.name === "api_key" ? { ...table, roleLeaf: false } : table),
      };
    };
    const setupNodeKeys = async () => {
      await setupBlogTables(context);
      await context.exec(createMigration(nodeKeys()));
      await context.exec(sql`
        select setval('resource_id_seq', ${raw(String(FIRST_GENERATED_ID))});
        select setval('role_id_seq', ${raw(String(FIRST_GENERATED_ID))});
        insert into "resource_group" ("id") values (1), (2);
        insert into "role_group" ("id", "parent_id") values (1, null), (2, 1), (3, 1);
        insert into "blog_post" ("group_id", "name") values (1, 'first'), (2, 'second');
        insert into "api_key" ("group_id") select "id" from "role_group", generate_series(1, 2);
        insert into "assignment_edge" ("resource_id", "role_id", "permission") values (1, 2, ${bits("1111")}), (2, 3, ${bits("1111")});`);
    };

    test('loses its nodes, edges and assignments, and its rows get the permissions of their parent', async () => {
      await setupNodeKeys();
      // A key shared with group 3 and assigned a post on its own, which the leaf table no longer allows
      const [[shared]] = await context.runTestQuery(sql`select "role_id" from "api_key" where "group_id" = 2 order by "id" limit 1`);
      await context.exec(sql`
        insert into "role_edge" ("parent_id", "child_id", "permission") values (3, ${raw(String(shared.role_id))}, ${bits("1111")});
        insert into "assignment_edge" ("resource_id", "role_id", "permission") select 2, "role_id", ${bits("1111")} from "api_key" where "group_id" = 1;`);
      expect(await userTriggers(context, "api_key")).not.toEqual([]);
      expect(await postNames(context, shared.role_id)).toEqual([{ name: "first" }, { name: "second" }]);

      await context.exec(createMigration(blogMigrationConfig(context)));
      expect(await userTriggers(context, "api_key")).toEqual(["10_api_key_role_parent_trigger"]);
      const [[leftovers]] = await context.runTestQuery(sql`
        select
          (select count(*) from "role_edge" join "api_key" on "role_id" in ("parent_id", "child_id"))::int as "edges",
          (select count(*) from "role_edge_cache" join "api_key" on "role_id" in ("parent_id", "child_id"))::int as "cache",
          (select count(*) from "assignment_edge" join "api_key" using ("role_id"))::int as "assignments"`);
      expect(leftovers).toEqual({ edges: 0, cache: 0, assignments: 0 });
      expect(await cacheMismatches(context, "none")).toEqual(noMismatches);
      for (const key of await keyRoleIds(context)) {
        expect(await postNames(context, key.role_id)).toEqual(await postNames(context, key.group_id!));
      }
      expect(await postNames(context, shared.role_id)).toEqual([{ name: "first" }]);

      // Running the migration again changes nothing, and writing keys no longer touches the graph
      await context.exec(createMigration(blogMigrationConfig(context)));
      const before = await graphState(context);
      await context.exec(sql`insert into "api_key" ("group_id") select "id" from "role_group"`);
      expect(await graphState(context)).toEqual(before);

      // And back: the keys become nodes again, each under its group
      await context.exec(createMigration(nodeKeys()));
      const [[nodes]] = await context.runTestQuery(sql`
        select
          (select count(*) from "api_key")::int as "keys",
          (select count(*) from "role_edge" join "api_key" on "child_id" = "role_id" where "parent_id" = "group_id" and "home")::int as "home_edges"`);
      expect(nodes).toEqual({ keys: 9, home_edges: 9 });
      expect(await cacheMismatches(context, "none")).toEqual(noMismatches);
      expect(await postNames(context, shared.role_id)).toEqual([{ name: "first" }]);
      expect(await userTriggers(context, "api_key")).not.toContain("10_api_key_role_parent_trigger");
    });

    test('stops the migration while its rows have children', async () => {
      await setupNodeKeys();
      await context.exec(sql`
        insert into "role_edge" ("parent_id", "child_id", "permission")
        select "role_id", 3, ${bits("1111")} from "api_key" limit 1;`);
      await expect(context.exec(createMigration(blogMigrationConfig(context)))).rejects.toThrow("cannot become a role leaf table");
    });
  });

  test('the truncate guard of a table that is a node of the other tree stays', async () => {
    await setupBlogTables(context);
    const config = blogMigrationConfig(context);
    const user = identifier(context.database_user_username);
    await context.exec(sql`
      create table "bot" ("id" serial primary key, "group_id" integer references "role_group" ("id"), "folder_id" integer references "resource_group" ("id"));
      grant select on "bot" to ${user};`);
    const withBots = (roleLeaf: boolean) => ({
      ...config,
      tables: [...config.tables, {
        name: "bot",
        isResource: true,
        resourceId: "resource_id",
        resourceParent: { column: "folder_id" },
        isRole: true,
        roleId: "role_id",
        roleLeaf,
        roleParent: { column: "group_id" },
        permission: { [context.database_user_username]: { select: OPERATION_BITS.select } },
      }],
    });
    await context.exec(createMigration(withBots(false)));
    await context.exec(createMigration(withBots(true)));
    expect(await userTriggers(context, "bot")).toContain("05_truncate_guard_trigger");
    await expect(context.exec(sql`truncate "bot"`)).rejects.toThrow();
  });
});

// Role leaf writes need no graph lock, so they go on while a graph writer holds it
describe.skipIf(!testDatabaseUrl)('role leaf writes and the graph lock (real Postgres only)', () => {
  const { setup, teardown, context } = setupTests();
  beforeEach(setup);
  afterEach(teardown);

  test('a graph write in progress does not block role leaf writes', async () => {
    await setupBlog(context);
    await context.exec(sql`insert into "role_group" ("id") values (1), (2);`);
    const [graphWriter, other] = [await context.connect(), await context.connect()];
    try {
      await graphWriter.query(`begin; insert into "role_group" ("id", "parent_id") values (3, 1)`);
      await other.query(`set lock_timeout = '500ms'`);
      await other.query(`insert into "api_key" ("group_id") select "id" from "role_group"`);
      await other.query(`update "api_key" set "group_id" = 2`);
      await other.query(`delete from "api_key"`);
      await expect(other.query(`insert into "role_group" ("id", "parent_id") values (4, 1)`)).rejects.toThrow("lock timeout");
      await graphWriter.query(`rollback`);
    } finally {
      await Promise.all([graphWriter.end(), other.end()]);
    }
  });
});
