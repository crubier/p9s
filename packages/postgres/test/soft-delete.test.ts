import { expect, describe, test, beforeEach, afterEach } from 'bun:test'
import { query as sql, raw } from "pg-sql2";
import { createMigration } from '../generation';
import { setupTests } from '@p9s/postgres-testing';
import { as, bits, blogMigrationConfig, cacheMismatches, combineModes, createRandom, noMismatches, setupBlogTables, type TestContext } from './helpers';
import type { CombineMode } from './helpers';

const softDeleted = ["resource_group", "role_group", "blog_post", "blog_comment", "api_key"];

const softDeleteConfig = (context: TestContext, combineAssignmentsWith: CombineMode = "none", softDelete = true) => {
  const config = blogMigrationConfig(context, { combineAssignmentsWith });
  return {
    ...config,
    tables: config.tables.map(table => softDelete && softDeleted.includes(table.name) ? { ...table, softDelete: "deleted_at" } : table),
  };
};

const setupSoftDelete = async (context: TestContext, combineAssignmentsWith: CombineMode = "none", softDelete = true) => {
  await setupBlogTables(context);
  await context.exec(raw(softDeleted.map(table => `alter table "${table}" add column "deleted_at" timestamptz;`).join("\n")));
  await context.exec(createMigration(softDeleteConfig(context, combineAssignmentsWith, softDelete)));
  await context.exec(sql`select setval('resource_id_seq', 1000); select setval('role_id_seq', 1000);`);
};

const count = async (context: TestContext, query: string) => (await context.runTestQuery(raw(query)))[0][0].n as number;
const postResourceId = async (context: TestContext, name: string) =>
  (await context.runTestQuery(sql`select "resource_id" from "blog_post" where "name" = ${raw(`'${name}'`)}`))[0][0].resource_id as number;
const visiblePosts = async (context: TestContext, roleId = "1") =>
  (await as(context, context.database_user_username, sql`select "name" from "blog_post" where "deleted_at" is null order by 1`, raw(roleId))).map(row => row.name);

describe('soft delete', () => {
  const { setup, teardown, context } = setupTests();
  beforeEach(setup);
  afterEach(teardown);

  for (const combineAssignmentsWith of combineModes) {
    test(`a soft deleted row leaves the graph with its edges and assignments, and comes back with them (combineAssignmentsWith: ${combineAssignmentsWith})`, async () => {
      await setupSoftDelete(context, combineAssignmentsWith);
      await context.exec(sql`
        insert into "resource_group" ("id") values (1);
        insert into "resource_group" ("id", "parent_id") values (2, 1);
        insert into "role_group" ("id") values (1);
        insert into "role_group" ("id", "parent_id") values (2, 1);
        insert into "blog_post" ("name", "group_id") values ('in two', 2), ('in one', 1);
        insert into "assignment_edge" ("resource_id", "role_id", "permission") values (1, 1, ${bits("1000")}), (2, 2, ${bits("1100")});
        insert into "resource_edge" ("parent_id", "child_id", "permission") select 1, "resource_id", ${bits("1000")} from "blog_post" where "name" = 'in two';`);
      const graph = async () => (await context.runTestQuery(sql`
        select (select md5(string_agg("t"::text, ',' order by "t"::text)) from "resource_edge" as "t") as "resource",
          (select md5(string_agg("t"::text, ',' order by "t"::text)) from "role_edge" as "t") as "role",
          (select md5(string_agg("t"::text, ',' order by "t"::text)) from "assignment_edge" as "t") as "assignment"`))[0][0];
      const before = await graph();
      expect(await visiblePosts(context, "2")).toEqual(["in one", "in two"]);

      // The group, its home edge and the edges below it, and its assignment, wait aside
      await context.exec(sql`update "resource_group" set "deleted_at" = now() where "id" = 2`);
      expect(await count(context, `select count(*)::int as "n" from "resource_edge" where 2 in ("parent_id", "child_id")`)).toBe(0);
      expect(await count(context, `select count(*)::int as "n" from "resource_edge_deleted"`)).toBe(2);
      expect(await count(context, `select count(*)::int as "n" from "assignment_edge_deleted"`)).toBe(1);
      expect(await cacheMismatches(context, combineAssignmentsWith)).toEqual(noMismatches);
      // The post in it is still linked from the top group
      expect(await visiblePosts(context, "2")).toEqual(["in one", "in two"]);
      expect((await as(context, context.database_user_username, sql`select "resource_permission"("resource_id") as "bits" from "blog_post" where "name" = 'in two'`, raw("2")))[0].bits).toBe("1000");

      await context.exec(sql`update "resource_group" set "deleted_at" = null where "id" = 2`);
      expect(await graph()).toEqual(before);
      expect(await cacheMismatches(context, combineAssignmentsWith)).toEqual(noMismatches);

      // A deleted role takes its members off the graph, and a deleted top group what is below it
      await context.exec(sql`update "role_group" set "deleted_at" = now() where "id" = 1`);
      expect(await visiblePosts(context, "2")).toEqual(["in two"]);
      expect(await cacheMismatches(context, combineAssignmentsWith)).toEqual(noMismatches);
      await context.exec(sql`update "resource_group" set "deleted_at" = now() where "id" = 1; update "role_group" set "deleted_at" = null where "id" = 1;`);
      expect(await visiblePosts(context, "2")).toEqual(["in two"]);
      // Both ends of the assignment of the restored role are restored, not those of the deleted group
      expect(await count(context, `select count(*)::int as "n" from "assignment_edge_deleted"`)).toBe(1);
      expect(await cacheMismatches(context, combineAssignmentsWith)).toEqual(noMismatches);
      await context.exec(sql`update "resource_group" set "deleted_at" = null where "id" = 1`);
      expect(await graph()).toEqual(before);
      expect(await cacheMismatches(context, combineAssignmentsWith)).toEqual(noMismatches);
    });
  }

  for (const combineAssignmentsWith of ["none", "role"] as const) {
    test(`random soft deletes, restores and moves keep the graph and the caches right (combineAssignmentsWith: ${combineAssignmentsWith})`, async () => {
      await setupSoftDelete(context, combineAssignmentsWith);
      const random = createRandom(7);
      const groups = 12;
      await context.exec(raw([
        ...Array.from({ length: groups }, (_, i) => `insert into "resource_group" ("id", "parent_id") values (${i + 1}, ${i === 0 ? "null" : random.int(1, i)});`),
        `insert into "role_group" ("id") values (1), (2); insert into "role_group" ("id", "parent_id") values (3, 1);`,
        ...Array.from({ length: 20 }, (_, i) => `insert into "blog_post" ("name", "group_id") values ('post ${i}', ${random.int(1, groups)});`),
        ...Array.from({ length: 8 }, () => `insert into "assignment_edge" ("resource_id", "role_id", "permission") values (${random.int(1, groups)}, ${random.int(1, 3)}, b'1111') on conflict do nothing;`),
      ].join("\n")));
      const assignments = await count(context, `select count(*)::int as "n" from "assignment_edge"`);
      for (let step = 0; step < 40; step++) {
        const target = random.int(0, 4);
        if (target === 0) {
          await context.exec(raw(`update "resource_group" set "deleted_at" = case when "deleted_at" is null then now() end where "id" = ${random.int(1, groups)}`));
        } else if (target === 1) {
          await context.exec(raw(`update "blog_post" set "deleted_at" = case when "deleted_at" is null then now() end where "name" = 'post ${random.int(0, 19)}'`));
        } else if (target === 2) {
          await context.exec(raw(`update "blog_post" set "group_id" = ${random.int(1, groups)} where "name" = 'post ${random.int(0, 19)}'`));
        } else if (target === 3) {
          // To a group of a smaller id, which keeps the groups a tree
          const group = random.int(2, groups);
          await context.exec(raw(`update "resource_group" set "parent_id" = ${random.int(1, group - 1)} where "id" = ${group}`));
        } else {
          await context.exec(raw(`update "role_group" set "deleted_at" = case when "deleted_at" is null then now() end where "id" = ${random.int(1, 3)}`));
        }
        const [checks] = await context.runTestQuery(sql`
          with "deleted" as (
            select "resource_id" as "id" from "blog_post" where "deleted_at" is not null
            union all select "id" from "resource_group" where "deleted_at" is not null),
          "all_edges" as (select * from "resource_edge" union all select * from "resource_edge_deleted"),
          "parents" as (
            select "resource_id" as "child", "group_id" as "parent" from "blog_post" where "group_id" is not null
            union all select "id", "parent_id" from "resource_group" where "parent_id" is not null)
          select
            (select count(*)::int from "resource_edge" where "parent_id" in (select "id" from "deleted") or "child_id" in (select "id" from "deleted")) as "live_to_deleted",
            (select count(*)::int from "resource_edge_deleted" where "parent_id" not in (select "id" from "deleted") and "child_id" not in (select "id" from "deleted")) as "aside_between_live",
            (select count(*)::int from (select "parent_id", "child_id" from "all_edges" where "home" except select "parent", "child" from "parents") as "t")
              + (select count(*)::int from (select "parent", "child" from "parents" except select "parent_id", "child_id" from "all_edges" where "home") as "t") as "home_mismatches",
            (select count(*)::int from "assignment_edge") + (select count(*)::int from "assignment_edge_deleted") as "assignments"`);
        expect({ step, ...checks[0] }).toEqual({ step, live_to_deleted: 0, aside_between_live: 0, home_mismatches: 0, assignments });
        expect(await cacheMismatches(context, combineAssignmentsWith)).toEqual(noMismatches);
      }
    });
  }

  test('rows written under a soft deleted row, or moved while deleted, come back where they are', async () => {
    await setupSoftDelete(context);
    await context.exec(sql`
      insert into "resource_group" ("id") values (1), (2);
      insert into "role_group" ("id") values (1);
      insert into "assignment_edge" ("resource_id", "role_id", "permission") values (1, 1, ${bits("1111")}), (2, 1, ${bits("1111")});
      update "resource_group" set "deleted_at" = now() where "id" = 1;
      insert into "blog_post" ("name", "group_id") values ('under deleted', 1);
      insert into "blog_post" ("name", "group_id", "deleted_at") values ('deleted', 2, now());`);
    expect(await visiblePosts(context)).toEqual([]);
    expect(await count(context, `select count(*)::int as "n" from "resource_edge"`)).toBe(0);
    expect(await cacheMismatches(context, "none")).toEqual(noMismatches);

    // The deleted post moves to the deleted group: its home edge follows, aside
    await context.exec(sql`update "blog_post" set "group_id" = 1 where "name" = 'deleted'`);
    await context.exec(sql`update "resource_group" set "deleted_at" = null where "id" = 1`);
    expect(await visiblePosts(context)).toEqual(["under deleted"]);
    await context.exec(sql`update "blog_post" set "deleted_at" = null where "name" = 'deleted'`);
    expect(await visiblePosts(context)).toEqual(["deleted", "under deleted"]);
    const [homes] = await context.runTestQuery(sql`select "parent_id" from "resource_edge" where "home" and "child_id" in (select "resource_id" from "blog_post") order by 1`);
    expect(homes).toEqual([{ parent_id: 1 }, { parent_id: 1 }]);
    expect(await count(context, `select count(*)::int as "n" from "resource_edge_deleted"`)).toBe(0);
    expect(await cacheMismatches(context, "none")).toEqual(noMismatches);

    // Nothing links to a deleted row
    await context.exec(sql`update "resource_group" set "deleted_at" = now() where "id" = 2`);
    await expect(context.exec(sql`insert into "resource_edge" ("parent_id", "child_id", "permission") values (2, 1, ${bits("1111")})`)).rejects.toThrow("links a soft deleted row");
    await expect(context.exec(sql`insert into "assignment_edge" ("resource_id", "role_id", "permission") values (2, 1, ${bits("1000")}) on conflict do nothing`)).rejects.toThrow("links a soft deleted row");

    // Deleting for good forgets the edges and assignments aside
    await context.exec(sql`delete from "resource_group" where "id" = 2`);
    expect(await count(context, `select count(*)::int as "n" from "resource_edge_deleted"`)).toBe(0);
    expect(await count(context, `select count(*)::int as "n" from "assignment_edge_deleted"`)).toBe(0);
    expect(await cacheMismatches(context, "none")).toEqual(noMismatches);
  });

  test('users soft delete with the delete bit, see what they deleted and restore it', async () => {
    await setupSoftDelete(context);
    const user = context.database_user_username;
    await context.exec(sql`
      insert into "resource_group" ("id") values (1), (2);
      insert into "role_group" ("id") values (1);
      insert into "assignment_edge" ("resource_id", "role_id", "permission") values (1, 1, ${bits("1111")}), (2, 1, ${bits("1110")});
      insert into "blog_post" ("name", "group_id") values ('mine', 1), ('read only', 2);
      insert into "blog_comment" ("body", "post_id") select 'on ' || "name", "id" from "blog_post";`);
    const mine = await postResourceId(context, "mine");
    const readOnly = await postResourceId(context, "read only");

    await expect(as(context, user, sql`update "blog_post" set "deleted_at" = now() where "name" = 'read only'`, raw("1"))).rejects.toThrow("row-level security");
    await as(context, user, sql`update "blog_post" set "deleted_at" = now() where "name" = 'mine'`, raw("1"));
    expect(await visiblePosts(context)).toEqual(["read only"]);
    // Deleted rows stay readable, for the bits the user would have once they are restored
    expect((await as(context, user, sql`select "name" from "blog_post" order by 1`, raw("1"))).map(row => row.name)).toEqual(["mine", "read only"]);
    expect(await as(context, user, sql`select "resource_id", "permission"::text from "current_deleted_resource"`, raw("1"))).toEqual([{ resource_id: mine, permission: "1111" }]);
    // Below the deleted post, comments have no access
    expect((await as(context, user, sql`select "body" from "blog_comment" order by 1`, raw("1"))).map(row => row.body)).toEqual(["on read only"]);
    // An update cannot bring it back, the restore function does
    expect(await as(context, user, sql`update "blog_post" set "deleted_at" = null where "name" = 'mine' returning "id"`, raw("1"))).toEqual([]);
    expect((await as(context, user, sql`select "resource_restore"(${raw(String(mine))}) as "restored"`, raw("1")))[0].restored).toBe(true);
    expect(await visiblePosts(context)).toEqual(["mine", "read only"]);
    expect(await cacheMismatches(context, "none")).toEqual(noMismatches);

    // Without the delete bit once restored, a deleted row cannot be restored or deleted for good
    await context.exec(sql`update "blog_post" set "deleted_at" = now() where "name" = 'read only'`);
    expect(await as(context, user, sql`select "resource_id", "permission"::text from "current_deleted_resource"`, raw("1"))).toEqual([{ resource_id: readOnly, permission: "1110" }]);
    expect((await as(context, user, sql`select "resource_restore"(${raw(String(readOnly))}) as "restored"`, raw("1")))[0].restored).toBe(false);
    expect(await as(context, user, sql`delete from "blog_post" where "name" = 'read only' returning "id"`, raw("1"))).toEqual([]);
    // Nor by another user, who would have no bits on it
    expect(await as(context, user, sql`select "resource_id" from "current_deleted_resource"`, raw("2"))).toEqual([]);
    expect((await as(context, user, sql`select "resource_restore"(${raw(String(mine))}) as "restored"`, raw("2")))[0].restored).toBe(false);
    await as(context, user, sql`update "blog_post" set "deleted_at" = now() where "name" = 'mine'`, raw("1"));
    expect(await as(context, user, sql`delete from "blog_post" where "name" = 'mine' returning "name"`, raw("1"))).toEqual([{ name: "mine" }]);
    expect(await cacheMismatches(context, "none")).toEqual(noMismatches);

    // Leaf rows stay where they are: soft deleting them needs the delete bit of their parent
    await context.exec(sql`update "blog_post" set "deleted_at" = null where "name" = 'read only'; update "assignment_edge" set "permission" = ${bits("1111")} where "resource_id" = 1;`);
    await expect(as(context, user, sql`update "blog_comment" set "deleted_at" = now()`, raw("1"))).rejects.toThrow("row-level security");
    await context.exec(sql`insert into "blog_post" ("name", "group_id") values ('again', 1); insert into "blog_comment" ("body", "post_id") select 'on again', "id" from "blog_post" where "name" = 'again';`);
    await as(context, user, sql`update "blog_comment" set "deleted_at" = now() where "body" = 'on again'`, raw("1"));
    await as(context, user, sql`update "blog_comment" set "deleted_at" = null where "body" = 'on again'`, raw("1"));
  });

  test('a soft deleted API key has no permissions', async () => {
    await setupSoftDelete(context);
    const user = context.database_user_username;
    await context.exec(sql`
      insert into "resource_group" ("id") values (1);
      insert into "role_group" ("id") values (1);
      insert into "assignment_edge" ("resource_id", "role_id", "permission") values (1, 1, ${bits("1111")});
      insert into "blog_post" ("name", "group_id") values ('post', 1);
      insert into "api_key" ("group_id") values (1);`);
    const key = String((await context.runTestQuery(sql`select "role_id" from "api_key"`))[0][0].role_id);
    expect(await visiblePosts(context, key)).toEqual(["post"]);
    await context.exec(sql`update "api_key" set "deleted_at" = now()`);
    expect(await visiblePosts(context, key)).toEqual([]);
    const post = await postResourceId(context, "post");
    expect((await context.runTestQuery(sql`select count(*)::int as "n" from "resource_role_access" where "resource_id" = ${raw(String(post))} and "role_id" = ${raw(key)}`))[0][0].n).toBe(0);
    await context.exec(sql`update "api_key" set "deleted_at" = null`);
    expect(await visiblePosts(context, key)).toEqual(["post"]);
  });

  test('migrations move the edges of rows deleted before soft delete, or while the triggers were disabled, and give them back without it', async () => {
    await setupSoftDelete(context, "role", false);
    await context.exec(sql`
      insert into "resource_group" ("id") values (1);
      insert into "role_group" ("id") values (1);
      insert into "assignment_edge" ("resource_id", "role_id", "permission") values (1, 1, ${bits("1111")});
      insert into "blog_post" ("name", "group_id", "deleted_at") values ('deleted', 1, now()), ('kept', 1, null);`);
    const config = softDeleteConfig(context, "role");
    await context.exec(createMigration(config));
    expect(await visiblePosts(context)).toEqual(["kept"]);
    expect(await count(context, `select count(*)::int as "n" from "resource_edge_deleted"`)).toBe(1);
    expect(await cacheMismatches(context, "role")).toEqual(noMismatches);

    await context.exec(sql`
      select "resource_trigger_disable"();
      update "blog_post" set "deleted_at" = null where "name" = 'deleted';
      update "resource_group" set "deleted_at" = now();
      select "resource_trigger_enable"();`);
    expect(await count(context, `select count(*)::int as "n" from "resource_edge_deleted"`)).toBe(2);
    expect(await count(context, `select count(*)::int as "n" from "assignment_edge_deleted"`)).toBe(1);
    expect(await visiblePosts(context)).toEqual([]);
    expect(await cacheMismatches(context, "role")).toEqual(noMismatches);

    await context.exec(createMigration(softDeleteConfig(context, "role", false)));
    const [tables] = await context.runTestQuery(sql`select count(*)::int as "n" from pg_class where "relname" in ('resource_edge_deleted', 'role_edge_deleted', 'assignment_edge_deleted', 'current_deleted_resource')`);
    expect(tables[0].n).toBe(0);
    expect(await visiblePosts(context)).toEqual(["deleted", "kept"]);
    expect(await cacheMismatches(context, "role")).toEqual(noMismatches);
  });
});
