import { expect, describe, test, beforeEach, afterEach } from 'bun:test'
import { query as sql, identifier, join, raw, type SQL } from "pg-sql2";
import { setupTests } from '@p9s/postgres-testing';
import { createMigration } from '../generation';
import { as, bits, blogMigrationConfig, cacheMismatches, combineModes, noMismatches, setupBlog, setupBlogTables, type CombineMode, type TestContext } from './helpers';

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

  test('app users can neither read nor write the graph and caches', async () => {
    await setupBlog(context, { combineAssignmentsWith: "role" });
    await seedGraph(context);
    const user = context.database_user_username;

    for (const table of [...graphTables, ...cacheTables, "resource_edge_cache_view", "role_edge_cache_view", "assignment_edge_cache_view"]) {
      await expectRejected(as(context, user, sql`select count(*) from ${identifier(table)}`));
    }
    for (const table of [...graphTables, ...cacheTables]) {
      for (const statement of writeStatements(table)) {
        await expectRejected(as(context, user, statement));
      }
    }
    await expectRejected(as(context, user, sql`select * from "resource_edge_cache_parent_compute"(2)`));
    await expectRejected(as(context, user, sql`select * from "role_edge_cache_child_compute"(1)`));
  });

  for (const combineAssignmentsWith of combineModes) {
    test(`app users see their own part of the graph through views (combineAssignmentsWith: ${combineAssignmentsWith})`, async () => {
      await setupBlog(context, { combineAssignmentsWith });
      await seedGraph(context);
      const user = context.database_user_username;
      // Role 1 is assigned group 2, role 2 is below role 1, role 3 nothing. Group 2 holds a post: role 1 reaches both.
      await context.exec(sql`
        insert into "role_group" ("id", "parent_id") values (3, null);
        update "role_group" set "parent_id" = 1 where "id" = 2;`);
      const [[post]] = await context.runTestQuery(sql`select "resource_id" from "blog_post" where "group_id" = 2`);
      const access = (roleId: string) => as(context, user, sql`
        select "resource_id", "permission"::text from "current_resource_access" order by "resource_id"`, raw(roleId));
      const select = (roleId: string) => as(context, user, sql`select "resource_id" from "current_resource_access_0" order by "resource_id"`, raw(roleId));
      const shared = (roleId: string) => as(context, user, sql`select "resource_id", "permission"::text from "current_assignment"`, raw(roleId));
      const edges = (roleId: string) => as(context, user, sql`
        select "parent_id", "child_id" from "current_resource_edge" order by "parent_id", "child_id"`, raw(roleId));
      const roles = (roleId: string) => as(context, user, sql`select "role_id" from "current_role" order by "role_id"`, raw(roleId));

      for (const roleId of ["1", "2"]) {
        expect(await access(roleId)).toEqual([{ resource_id: 2, permission: "1111" }, { resource_id: post.resource_id, permission: "1111" }]);
        expect(await select(roleId)).toEqual([{ resource_id: 2 }, { resource_id: post.resource_id }]);
        expect(await shared(roleId)).toEqual([{ resource_id: 2, permission: "1111" }]);
        // Group 1 is above group 2, but out of reach
        expect(await edges(roleId)).toEqual([
          { parent_id: 2, child_id: 2 }, { parent_id: 2, child_id: post.resource_id }, { parent_id: post.resource_id, child_id: post.resource_id }]);
      }
      expect(await roles("1")).toEqual([{ role_id: 1 }]);
      expect(await roles("2")).toEqual([{ role_id: 1 }, { role_id: 2 }]);
      expect(await access("3")).toEqual([]);
      expect(await shared("3")).toEqual([]);
      expect(await edges("3")).toEqual([]);
      expect(await roles("3")).toEqual([{ role_id: 3 }]);
    });
  }

  test('a function of the user only sees the rows of the views, whatever its cost', async () => {
    await setupBlog(context);
    await seedGraph(context);
    const user = context.database_user_username;
    // Postgres would run a cheaper filter first, on rows that the view then leaves out, unless it is a security barrier
    const seen = await as(context, user, sql`
      create temporary table "seen" ("id" integer);
      create function pg_temp."leak" ("the_id" integer) returns boolean
        as 'insert into pg_temp."seen" values ($1) returning true' language sql cost 0.0000001;
      select count(*) from "current_resource_access" where pg_temp."leak"("resource_id");
      select count(*) from "current_resource_access_0" where pg_temp."leak"("resource_id");
      select count(*) from "current_assignment" where pg_temp."leak"("resource_id");
      select count(*) from "current_resource_edge" where pg_temp."leak"("child_id");
      select count(*) from "current_role" where pg_temp."leak"("role_id");
      select distinct "id" from pg_temp."seen" order by "id";`, raw("2"));
    // Role 2 reaches no resource, and is the only role it acts as
    expect(seen).toEqual([{ id: 2 }]);
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

  describe('resource_permission privacy', () => {
    const permissionsAs = async (roleId: SQL | undefined, resourceIds: SQL[]) => (await as(context, context.database_user_username, sql`
      select "resource_permission"("id")::text as "permission"
      from (values ${join(resourceIds.map((id, index) => sql`(${raw(String(index))}, ${id}::integer)`), ", ")}) as "the_resource" ("index", "id")
      order by "index"`, roleId)).map(row => row.permission);
    const postIn = async (group: number) => raw(String((await context.runTestQuery(sql`
      select "resource_id" from "blog_post" where "group_id" = ${raw(String(group))}`))[0][0].resource_id));

    test('tells a user nothing about resources it has no access to', async () => {
      await setupBlog(context);
      await seedGraph(context);
      // Role 1 has every bit on group 2 and its post, none on group 3 and its post. 99 is no resource at all: the
      // answer is the same for a resource the user cannot see as for one that does not exist.
      const resources = [raw("2"), await postIn(2), raw("3"), await postIn(3), raw("99"), raw("null")];
      expect(await permissionsAs(raw("1"), resources)).toEqual(["1111", "1111", "0000", "0000", "0000", "0000"]);
      expect(await permissionsAs(raw("2"), resources)).toEqual(resources.map(() => "0000"));
      expect(await permissionsAs(undefined, resources)).toEqual(resources.map(() => "0000"));
    });

    test('app users can only ask about themselves', async () => {
      await setupBlog(context);
      await seedGraph(context);
      const user = context.database_user_username, writer = context.database_writer_username;
      // Role 2 would learn that group 2 exists, and that role 1 can see it: without the manageAccess bit, nothing
      expect(await as(context, user, sql`select "resource_permission"(2, 1)::text as "permission"`, raw("2"))).toEqual([{ permission: "0000" }]);
      // Mapping any role id to its parent would tell which ids are keys, and whose
      await expectRejected(as(context, user, sql`select "current_role_node"(1)`, raw("2")), /does not exist/);

      const [privileges] = await context.runTestQuery(sql`
        select "signature", has_function_privilege(${raw(`'${user}'`)}, "signature", 'execute') as "user",
          has_function_privilege(${raw(`'${writer}'`)}, "signature", 'execute') as "writer",
          coalesce(array_to_string("proacl", ','), '') ~ '(^|,)=' as "public"
        from (select "oid"::regprocedure::text as "signature", "proacl" from pg_proc
          where "proname" in ('resource_permission', 'current_role_node') and "pronamespace" = 'public'::regnamespace) as "the_function"
        order by "signature"`);
      expect(privileges).toEqual([
        { signature: "current_role_node()", user: true, writer: true, public: false },
        { signature: "resource_permission(integer)", user: true, writer: true, public: false },
        { signature: "resource_permission(integer,integer)", user: true, writer: true, public: false },
      ]);
    });

    test('a key only learns the permissions of its own parent', async () => {
      await setupBlog(context);
      await seedGraph(context);
      const [[key1, key2]] = await context.runTestQuery(sql`
        insert into "api_key" ("group_id") values (1), (2) returning "role_id"`);
      const [k1, k2] = [raw(String(key1.role_id)), raw(String(key2.role_id))];
      const currentRoleNode = async (roleId: SQL) => (await as(context, context.database_user_username, sql`select "current_role_node"() as "id"`, roleId))[0].id;

      expect(await permissionsAs(k1, [raw("2"), raw("3")])).toEqual(["1111", "0000"]);
      expect(await permissionsAs(k2, [raw("2"), raw("3")])).toEqual(["0000", "0000"]);
      expect([await currentRoleNode(k1), await currentRoleNode(k2), await currentRoleNode(raw("1"))]).toEqual([1, 2, 1]);

      // Graph writers can ask for any role, keys included
      const [answers] = await context.runTestQuery(sql`
        set local role ${identifier(context.database_writer_username)};
        select "resource_permission"(2, ${k1})::text as "a", "resource_permission"(2, ${k2})::text as "b",
          "resource_permission"(3, ${k1})::text as "c", "resource_permission"(2, 99)::text as "d"`).then(results => results.slice(-1));
      expect(answers).toEqual([{ a: "1111", b: "0000", c: "0000", d: "0000" }]);
    });

    test('upgrading drops the earlier current_role_node, which mapped any role id', async () => {
      await setupBlog(context);
      await seedGraph(context);
      const [[policy]] = await context.runTestQuery(sql`select "policyname" from pg_policies where "tablename" = 'blog_post' and "cmd" = 'SELECT'`);
      await context.exec(sql`
        create function "current_role_node" ("the_user_id" integer) returns integer language sql stable as $$ select $1 $$;
        alter policy ${identifier(policy.policyname)} on "blog_post" using ("current_role_node"("current_role_id"()) is not null);`);
      await context.exec(createMigration(blogMigrationConfig(context)));
      const [functions] = await context.runTestQuery(sql`
        select "oid"::regprocedure::text as "signature" from pg_proc where "proname" = 'current_role_node' and "pronamespace" = 'public'::regnamespace`);
      expect(functions).toEqual([{ signature: "current_role_node()" }]);
      expect(await as(context, context.database_user_username, sql`select "name" from "blog_post"`, raw("1"))).toEqual([{ name: "two" }]);
    });
  });

  describe('seeing the permissions of others', () => {
    // The delete bit lets users manage the access to a post
    const setupManaged = async (combineAssignmentsWith: CombineMode = "none") => {
      await setupBlogTables(context);
      const config = blogMigrationConfig(context, { combineAssignmentsWith });
      const post = config.tables.find(table => table.name === "blog_post")!;
      post.permission = { [context.database_user_username]: { select: 0, insert: 1, update: 2, delete: 3, manageAccess: 3 } } as any;
      await context.exec(createMigration(config));
      await context.exec(sql`select setval('resource_id_seq', 1000000); select setval('role_id_seq', 1000000);`);
      await seedGraph(context);
      // Role 1 has every bit on group 2 and its post, role 2 can only read the post, a key of role 2 too
      const [[two], [three]] = (await context.runTestQuery(sql`select "resource_id" from "blog_post" order by "group_id"`))[0].map((row: any) => [row.resource_id]);
      const [[key]] = await context.runTestQuery(sql`
        insert into "assignment_edge" ("resource_id", "role_id", "permission") values (${raw(String(two))}, 2, ${bits("1000")});
        insert into "api_key" ("group_id") values (2) returning "role_id";`).then(results => results.slice(-1));
      return { two, three, key: key.role_id as number };
    };
    const query = (roleId: string, statement: SQL) => as(context, context.database_user_username, statement, raw(roleId));

    for (const combineAssignmentsWith of combineModes) {
      test(`a user with the manageAccess bit on a post sees who has access to it (combineAssignmentsWith: ${combineAssignmentsWith})`, async () => {
        const { two, three, key } = await setupManaged(combineAssignmentsWith);
        const access = (roleId: string, resourceId: number) => query(roleId, sql`
          select "role_id", "assigned_resource_id", "permission"::text from "resource_access"
          where "resource_id" = ${raw(String(resourceId))} order by "role_id"`);
        const roles = (roleId: string, resourceId: number) => query(roleId, sql`
          select "role_id", "permission"::text from "resource_role_access"
          where "resource_id" = ${raw(String(resourceId))} order by "role_id"`);
        const permissions = (roleId: string, resourceId: number, of: number[]) => query(roleId, sql`
          select ${join(of.map((other, index) => sql`"resource_permission"(${raw(String(resourceId))}, ${raw(String(other))})::text as ${identifier(`p${index}`)}`), ", ")}`)
          .then(([row]) => Object.values(row));

        // Role 1 has the delete bit on post two: it sees the assignment of group 2 above it, and the one of role 2
        expect(await access("1", two)).toEqual([
          { role_id: 1, assigned_resource_id: 2, permission: "1111" }, { role_id: 2, assigned_resource_id: two, permission: "1000" }]);
        expect(await roles("1", two)).toEqual([{ role_id: 1, permission: "1111" }, { role_id: 2, permission: "1000" }, { role_id: key, permission: "1000" }]);
        expect(await permissions("1", two, [1, 2, key, 99])).toEqual(["1111", "1000", "1000", "0000"]);

        // Nothing about post three, out of reach, or group 2, which has no manageAccess bit
        for (const resourceId of [three, 2]) {
          expect(await access("1", resourceId)).toEqual([]);
          expect(await roles("1", resourceId)).toEqual([]);
          expect(await permissions("1", resourceId, [1, 2])).toEqual(["0000", "0000"]);
        }
        // Role 2 can read post two, but not manage its access
        expect(await access("2", two)).toEqual([]);
        expect(await roles("2", two)).toEqual([]);
        expect(await permissions("2", two, [1, 2])).toEqual(["0000", "0000"]);

        // Graph writers see everything
        const [all] = await context.runTestQuery(sql`
          set local role ${identifier(context.database_writer_username)};
          select (select count(*)::int from "resource_access") as "access", "resource_permission"(${raw(String(two))}, ${raw(String(key))})::text as "key",
            "resource_permission"(${raw(String(three))}, 1)::text as "three"`)
          .then(results => results.slice(-1));
        // Group 2 and post two for role 1, post two for role 2
        expect(all).toEqual([{ access: 3, key: "1000", three: "0000" }]);
      });
    }

    test('a function of the user only sees the rows the manageAccess bit allows, whatever its cost', async () => {
      await setupManaged();
      const seen = await query("2", sql`
        create temporary table "seen" ("id" integer);
        create function pg_temp."leak" ("the_id" integer) returns boolean
          as 'insert into pg_temp."seen" values ($1) returning true' language sql cost 0.0000001;
        select count(*) from "resource_access" where pg_temp."leak"("role_id");
        select count(*) from "resource_role_access" where pg_temp."leak"("role_id");
        select * from pg_temp."seen"`);
      expect(seen).toEqual([]);
    });

    test('leaf rows cannot have the manageAccess or share bit', async () => {
      await setupBlogTables(context);
      for (const extra of [{ manageAccess: 3 }, { share: 3 }]) {
        const config = blogMigrationConfig(context);
        const comment = config.tables.find(table => table.name === "blog_comment")!;
        comment.permission = { [context.database_user_username]: { select: 0, insert: 1, update: 2, delete: 3, ...extra } } as any;
        expect(() => createMigration(config)).toThrow(/Leaf rows have no access of their own/);
      }
    });
  });

  describe('delegated sharing', () => {
    // The delete bit lets users share a post, and groups cannot be shared by users
    const setupSharing = async (combineAssignmentsWith: CombineMode = "none") => {
      await setupBlogTables(context);
      const config = blogMigrationConfig(context, { combineAssignmentsWith });
      const post = config.tables.find(table => table.name === "blog_post")!;
      post.permission = { [context.database_user_username]: { select: 0, insert: 1, update: 2, delete: 3, share: 3 } } as any;
      await context.exec(createMigration(config));
      await context.exec(sql`select setval('resource_id_seq', 1000000); select setval('role_id_seq', 1000000);`);
      await seedGraph(context);
      await context.exec(sql`insert into "role_group" ("id") values (3), (4)`);
      const [twoId, threeId] = (await context.runTestQuery(sql`select "resource_id" from "blog_post" order by "group_id"`))[0].map((row: any) => row.resource_id as number);
      return { two: raw(String(twoId)), three: raw(String(threeId)), twoId };
    };
    const user = () => context.database_user_username;
    const shares = (resourceId: SQL) => context.runTestQuery(sql`
      select "role_id", "permission"::text from "assignment_edge" where "resource_id" = ${resourceId} order by "role_id"`).then(([rows]) => rows);
    const share = (roleId: string, resourceId: SQL, to: number, value: string) =>
      as(context, user(), sql`select "resource_share"(${resourceId}, ${raw(String(to))}, ${bits(value)})`, raw(roleId));
    const unshare = (roleId: string, resourceId: SQL, from: number) =>
      as(context, user(), sql`select "resource_unshare"(${resourceId}, ${raw(String(from))}) as "removed"`, raw(roleId)).then(([row]) => row.removed);
    const posts = (roleId: string) => as(context, user(), sql`select "name" from "blog_post" order by "name"`, raw(roleId)).then(rows => rows.map(row => row.name));

    for (const combineAssignmentsWith of combineModes) {
      test(`users share what they have the share bit on, with bits they have (combineAssignmentsWith: ${combineAssignmentsWith})`, async () => {
        const { two, three } = await setupSharing(combineAssignmentsWith);
        // Role 1 has every bit on group 2, so on post two
        expect(await posts("2")).toEqual([]);
        await share("1", two, 2, "1000");
        expect(await posts("2")).toEqual(["two"]);
        expect(await cacheMismatches(context, combineAssignmentsWith)).toEqual(noMismatches);

        // Nothing out of reach, nor on a table without share bit, with the same error as for no resource at all
        for (const resourceId of [three, raw("2"), raw("99")]) {
          await expectRejected(share("1", resourceId, 2, "1000"), /row-level security/);
        }
        // Role 2 can read post two, but not share it
        await expectRejected(share("2", two, 3, "1000"), /row-level security/);

        // Role 3 can read and share post two: it shares what it has, and nothing more
        await context.exec(sql`insert into "assignment_edge" values (${two}, 3, ${bits("1001")})`);
        await expectRejected(share("3", two, 4, "1100"), /row-level security/);
        await share("3", two, 4, "1001");
        expect(await shares(two)).toEqual([
          { role_id: 2, permission: "1000" }, { role_id: 3, permission: "1001" }, { role_id: 4, permission: "1001" }]);

        // It can change or remove a share made by someone else, unless the share has bits it does not have
        await share("3", two, 2, "1001");
        expect(await unshare("3", two, 4)).toBe(true);
        expect(await unshare("3", two, 4)).toBe(false);
        await share("1", two, 4, "1111");
        await expectRejected(share("3", two, 4, "1000"), /row-level security/);
        expect(await unshare("3", two, 4)).toBe(false);
        expect(await shares(two)).toEqual([
          { role_id: 2, permission: "1001" }, { role_id: 3, permission: "1001" }, { role_id: 4, permission: "1111" }]);
        expect(await cacheMismatches(context, combineAssignmentsWith)).toEqual(noMismatches);
      });
    }

    test('users only see the assignments of what they can share, and graph writers still write any', async () => {
      const { two, three, twoId } = await setupSharing();
      await context.exec(sql`insert into "assignment_edge" values (${two}, 2, ${bits("1000")}), (${three}, 4, ${bits("1000")})`);
      const seen = (roleId: string) => as(context, user(), sql`select "resource_id", "role_id" from "assignment_edge" order by "role_id"`, raw(roleId));
      expect(await seen("1")).toEqual([{ resource_id: twoId, role_id: 2 }]);
      expect(await seen("2")).toEqual([]);
      // Updates and deletes only find the rows they can see
      await as(context, user(), sql`delete from "assignment_edge"`, raw("1"));
      expect(await shares(three)).toEqual([{ role_id: 4, permission: "1000" }]);
      // The share bit is enough, without the select bit, which the policies of posts check
      await context.exec(sql`insert into "assignment_edge" values (${two}, 4, ${bits("0001")})`);
      await share("4", two, 3, "0001");
      expect(await shares(two)).toEqual([{ role_id: 3, permission: "0001" }, { role_id: 4, permission: "0001" }]);

      await as(context, context.database_writer_username, sql`
        insert into "assignment_edge" values (3, 4, ${bits("1111")});
        update "assignment_edge" set "permission" = ${bits("1100")} where "resource_id" = 3 and "role_id" = 4`);
      expect(await shares(raw("3"))).toEqual([{ role_id: 4, permission: "1100" }]);
    });

    test('the application can restrict who users share with', async () => {
      const { two } = await setupSharing();
      // Only roles 2 and 3, like the members of a team of the user
      await context.exec(sql`
        create policy "share_with_team" on "assignment_edge" as restrictive for insert to ${identifier(user())}
        with check ("role_id" in (2, 3))`);
      await share("1", two, 2, "1000");
      await expectRejected(share("1", two, 4, "1000"), /row-level security/);
    });

    test('without share bits, users have no privilege on assignments, and the functions and policies are dropped', async () => {
      await setupSharing();
      await context.exec(createMigration(blogMigrationConfig(context)));
      await expectRejected(as(context, user(), sql`select count(*) from "assignment_edge"`, raw("1")));
      const [functions] = await context.runTestQuery(sql`
        select count(*)::int as "n" from pg_proc where "proname" in ('resource_share', 'resource_unshare') and "pronamespace" = 'public'::regnamespace`);
      expect(functions).toEqual([{ n: 0 }]);
      const [policies] = await context.runTestQuery(sql`
        select "policyname" from pg_policies where "tablename" = 'assignment_edge' order by "policyname"`);
      expect(policies).toEqual([{ policyname: "assignment_edge_policy_writer" }]);
      const [[table]] = await context.runTestQuery(sql`select "relrowsecurity" from pg_class where "oid" = 'assignment_edge'::regclass`);
      expect(table.relrowsecurity).toBe(false);
    });
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
