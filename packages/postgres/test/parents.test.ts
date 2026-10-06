import { expect, describe, test, beforeEach, afterEach } from 'bun:test'
import { query as sql, identifier, raw } from "pg-sql2";
import { createMigration } from '../generation';
import { setupTests } from '@p9s/postgres-testing';
import { OPERATION_BITS, as, bits, blogMigrationConfig, cacheMismatches, combineModes, noMismatches, setupBlogTables, type TestContext } from './helpers';
import type { CombineMode } from './helpers';

// A folder is in another folder, or else at the top of its group: its folder column holds the id of the other folder,
// which p9s looks up, and its group column the resource id of the group. A note is a leaf, of a folder or of a post.
const setupFolders = async (context: TestContext, combineAssignmentsWith: CombineMode = "none") => {
  await setupBlogTables(context);
  const user = identifier(context.database_user_username);
  await context.exec(sql`
    create table "folder" (
      "id" serial primary key, "name" text not null,
      "group_id" integer references "resource_group" ("id") on delete cascade,
      "parent_folder_id" integer references "folder" ("id") on delete cascade);
    create table "note" (
      "id" serial primary key, "body" text not null default '',
      "folder_id" integer references "folder" ("id") on delete cascade,
      "post_id" integer references "blog_post" ("id") on delete cascade);
    grant select, insert, update, delete on table "folder", "note" to ${user};
    grant usage on sequence "folder_id_seq", "note_id_seq" to ${user};`);
  const config = foldersConfig(context, combineAssignmentsWith);
  await context.exec(createMigration(config));
  await context.exec(sql`select setval('resource_id_seq', 1000); select setval('role_id_seq', 1000);`);
  return config;
};

const foldersConfig = (context: TestContext, combineAssignmentsWith: CombineMode = "none") => {
  const config = blogMigrationConfig(context, { combineAssignmentsWith });
  const permission = { [context.database_user_username]: { ...OPERATION_BITS } };
  return {
    ...config,
    tables: [...config.tables, {
      name: "folder",
      isResource: true,
      resourceId: "resource_id",
      resourceParent: [{ column: "parent_folder_id", table: "folder", key: "id" }, { column: "group_id" }],
      permission,
    }, {
      name: "note",
      isResource: true,
      resourceLeaf: true,
      resourceParent: [{ column: "folder_id", table: "folder", key: "id" }, { column: "post_id", table: "blog_post", key: "id" }],
      permission,
    }],
  };
};

const homeParents = async (context: TestContext) => (await context.runTestQuery(sql`
  select "folder"."name", "parent"."name" as "folder", "the_edge"."parent_id" = "folder"."group_id" as "in_group"
  from "folder" join "resource_edge" as "the_edge" on "the_edge"."child_id" = "folder"."resource_id" and "the_edge"."home"
  left join "folder" as "parent" on "parent"."resource_id" = "the_edge"."parent_id"
  order by 1`))[0];

describe('several parent columns', () => {
  const { setup, teardown, context } = setupTests();
  beforeEach(setup);
  afterEach(teardown);

  for (const combineAssignmentsWith of combineModes) {
    test(`the home edge follows the first parent column a row sets (combineAssignmentsWith: ${combineAssignmentsWith})`, async () => {
      await setupFolders(context, combineAssignmentsWith);
      await context.exec(sql`
        insert into "resource_group" ("id") values (1), (2);
        insert into "folder" ("name", "group_id") values ('top', 1), ('other', 2);
        insert into "folder" ("name", "group_id", "parent_folder_id") select 'inside', 1, "id" from "folder" where "name" = 'top';
        insert into "folder" ("name", "group_id", "parent_folder_id") select 'deeper', 1, "id" from "folder" where "name" = 'inside';`);
      expect(await homeParents(context)).toEqual([
        { name: "deeper", folder: "inside", in_group: false },
        { name: "inside", folder: "top", in_group: false },
        { name: "other", folder: null, in_group: true },
        { name: "top", folder: null, in_group: true },
      ]);
      expect(await cacheMismatches(context, combineAssignmentsWith)).toEqual(noMismatches);

      // Out of its folder, to the top of its group; then the folder above it moves into another folder, of another group
      await context.exec(sql`update "folder" set "parent_folder_id" = null where "name" = 'inside'`);
      await context.exec(sql`update "folder" set "parent_folder_id" = (select "id" from "folder" where "name" = 'other'), "group_id" = 2 where "name" = 'top'`);
      expect(await homeParents(context)).toEqual([
        { name: "deeper", folder: "inside", in_group: false },
        { name: "inside", folder: null, in_group: true },
        { name: "other", folder: null, in_group: true },
        { name: "top", folder: "other", in_group: false },
      ]);
      expect(await cacheMismatches(context, combineAssignmentsWith)).toEqual(noMismatches);

      // The group of a folder in a folder is not its parent: changing it moves nothing
      const edges = async () => (await context.runTestQuery(sql`select count(*)::int as "n", md5(string_agg("t"::text, ',' order by "t"::text)) as "hash" from "resource_edge_cache" as "t"`))[0][0];
      const before = await edges();
      await context.exec(sql`update "folder" set "group_id" = 2 where "name" = 'deeper'`);
      expect(await edges()).toEqual(before);

      // A folder at the top of nothing has no home edge
      await context.exec(sql`update "folder" set "group_id" = null where "name" = 'inside'`);
      expect((await homeParents(context)).map((row: { name: string }) => row.name)).toEqual(["deeper", "other", "top"]);
      expect(await cacheMismatches(context, combineAssignmentsWith)).toEqual(noMismatches);
    });
  }

  test('a leaf row takes the permissions of the first parent it sets', async () => {
    await setupFolders(context);
    const user = context.database_user_username;
    await context.exec(sql`
      insert into "resource_group" ("id") values (1), (2);
      insert into "role_group" ("id") values (1);
      insert into "folder" ("name", "group_id") values ('readable', 1), ('hidden', 2);
      insert into "blog_post" ("name", "group_id") values ('readable post', 1), ('hidden post', 2);
      insert into "assignment_edge" ("resource_id", "role_id", "permission") values (1, 1, ${bits("1111")});
      insert into "note" ("body", "folder_id", "post_id")
        select 'hidden folder, readable post', "folder"."id", "blog_post"."id" from "folder", "blog_post" where "folder"."name" = 'hidden' and "blog_post"."name" = 'readable post';
      insert into "note" ("body", "folder_id", "post_id")
        select 'readable folder, hidden post', "folder"."id", "blog_post"."id" from "folder", "blog_post" where "folder"."name" = 'readable' and "blog_post"."name" = 'hidden post';`);
    const notes = async () => (await as(context, user, sql`select "body" from "note" order by 1`, raw("1"))).map(row => row.body);
    expect(await notes()).toEqual(["readable folder, hidden post"]);
    await context.exec(sql`update "note" set "folder_id" = null where "body" = 'hidden folder, readable post'`);
    expect(await notes()).toEqual(["hidden folder, readable post", "readable folder, hidden post"]);
  });

  test('users read, create and move folders with the bits of whichever parent they set', async () => {
    await setupFolders(context);
    const user = context.database_user_username;
    await context.exec(sql`
      insert into "resource_group" ("id") values (1), (2);
      insert into "role_group" ("id") values (1);
      insert into "folder" ("name", "group_id") values ('readable', 1), ('hidden', 2);
      insert into "folder" ("name", "parent_folder_id") select 'inside', "id" from "folder" where "name" = 'readable';
      insert into "assignment_edge" ("resource_id", "role_id", "permission") values (1, 1, ${bits("1111")});`);
    const folders = async () => (await as(context, user, sql`select "name" from "folder" order by 1`, raw("1"))).map(row => row.name);
    expect(await folders()).toEqual(["inside", "readable"]);

    // The insert bit on the folder, looked up from its id, or on the group
    await as(context, user, sql`insert into "folder" ("name", "parent_folder_id") select 'new', "id" from "folder" where "name" = 'inside'`, raw("1"));
    await as(context, user, sql`insert into "folder" ("name", "group_id") values ('at the top', 1)`, raw("1"));
    expect(await folders()).toEqual(["at the top", "inside", "new", "readable"]);
    const hidden = (await context.runTestQuery(sql`select "id" from "folder" where "name" = 'hidden'`))[0][0].id;
    await expect(as(context, user, sql`insert into "folder" ("name", "parent_folder_id") values ('forged', ${raw(String(hidden))})`, raw("1")))
      .rejects.toThrow("row-level security");
    await expect(as(context, user, sql`insert into "folder" ("name", "group_id") values ('forged', 2)`, raw("1"))).rejects.toThrow("row-level security");
    // Moving a folder needs the insert bit on its new parent, whichever column it is in
    await expect(as(context, user, sql`update "folder" set "parent_folder_id" = ${raw(String(hidden))} where "name" = 'new'`, raw("1")))
      .rejects.toThrow("row-level security");
    await as(context, user, sql`update "folder" set "parent_folder_id" = null, "group_id" = 1 where "name" = 'new'`, raw("1"));
    await expect(as(context, user, sql`update "folder" set "group_id" = 2 where "name" = 'new'`, raw("1"))).rejects.toThrow("row-level security");
    expect(await cacheMismatches(context, "none")).toEqual(noMismatches);

    // Notes have the permissions of their folder or of their post, and keep the resource id of that parent
    await context.exec(sql`
      insert into "blog_post" ("name", "group_id") values ('post', 1), ('hidden post', 2);
      insert into "note" ("body", "folder_id") select 'in ' || "name", "id" from "folder" where "name" in ('inside', 'hidden');
      insert into "note" ("body", "post_id") select 'on ' || "name", "id" from "blog_post";`);
    expect((await as(context, user, sql`select "body" from "note" order by 1`, raw("1"))).map(row => row.body)).toEqual(["in inside", "on post"]);
    const [parentIds] = await context.runTestQuery(sql`
      select "note"."body", "note"."resource_parent_id" = coalesce("folder"."resource_id", "blog_post"."resource_id") as "kept" from "note"
      left join "folder" on "folder"."id" = "note"."folder_id" left join "blog_post" on "blog_post"."id" = "note"."post_id"`);
    expect(parentIds.every((row: { kept: boolean }) => row.kept)).toBe(true);
    await context.exec(sql`update "note" set "folder_id" = null, "post_id" = (select "id" from "blog_post" where "name" = 'post') where "body" = 'in hidden'`);
    expect((await as(context, user, sql`select "body" from "note" order by 1`, raw("1"))).map(row => row.body)).toEqual(["in hidden", "in inside", "on post"]);
  });

  test('a parent key that matches no row is rejected, whichever column it is in', async () => {
    await setupFolders(context);
    await context.exec(sql`
      alter table "folder" drop constraint "folder_parent_folder_id_fkey";
      alter table "note" drop constraint "note_post_id_fkey";
      insert into "resource_group" ("id") values (1);`);
    await expect(context.exec(sql`insert into "folder" ("name", "parent_folder_id") values ('dangling', -1)`)).rejects.toThrow("parent_folder_id that matches no row of folder");
    await expect(context.exec(sql`insert into "folder" ("name", "group_id") values ('dangling', -1)`)).rejects.toThrow();
    await expect(context.exec(sql`insert into "note" ("post_id") values (-1)`)).rejects.toThrow("post_id that matches no row of blog_post");
  });

  test('a table can go from a column that the app fills to several parent columns, then drop that column', async () => {
    await setupFolders(context);
    // Before: a trigger of the app copies the resource id of the parent folder, or of the group, into one column
    await context.exec(sql`
      alter table "folder" add column "parent_resource_id" integer;
      create function "folder_parent_resource"() returns trigger language plpgsql as $$
      begin
        new."parent_resource_id" := coalesce((select "resource_id" from "folder" where "id" = new."parent_folder_id"), new."group_id");
        return new;
      end
      $$;
      create trigger "folder_parent_resource" before insert or update on "folder" for each row execute function "folder_parent_resource"();`);
    const config = foldersConfig(context);
    const folderConfig = config.tables.find(table => table.name === "folder")!;
    const parents = folderConfig.resourceParent;
    folderConfig.resourceParent = { column: "parent_resource_id" } as any;
    await context.exec(createMigration(config));
    await context.exec(sql`
      insert into "resource_group" ("id") values (1);
      insert into "folder" ("name", "group_id") values ('top', 1);
      insert into "folder" ("name", "group_id", "parent_folder_id") select 'inside', 1, "id" from "folder";`);
    const before = (await homeParents(context));

    // The policies that read the column go with it, the migration creates them again
    folderConfig.resourceParent = parents;
    await context.exec(sql`drop trigger "folder_parent_resource" on "folder"; alter table "folder" drop column "parent_resource_id" cascade;`);
    await context.exec(createMigration(config));
    expect(await homeParents(context)).toEqual(before);
    expect(await cacheMismatches(context, "none")).toEqual(noMismatches);
    const [policies] = await context.runTestQuery(sql`select count(*)::int as "n" from pg_policy where "polrelid" = 'folder'::regclass`);
    expect(policies[0].n).toBe(4);
  });

  test('rows written while the triggers were disabled get the home edge of the parent they set', async () => {
    await setupFolders(context);
    await context.exec(sql`
      insert into "resource_group" ("id") values (1), (2);
      insert into "folder" ("name", "group_id") values ('top', 1);
      select "resource_trigger_disable"();
      insert into "folder" ("name", "parent_folder_id") select 'inside', "id" from "folder" where "name" = 'top';
      update "folder" set "group_id" = 2 where "name" = 'top';
      select "resource_trigger_enable"();`);
    expect(await homeParents(context)).toEqual([
      { name: "inside", folder: "top", in_group: null },
      { name: "top", folder: null, in_group: true },
    ]);
    expect(await cacheMismatches(context, "none")).toEqual(noMismatches);
  });

  test('the lookups of every parent column are hidden from PostGraphile', async () => {
    await setupFolders(context);
    await context.exec(sql`alter table "folder" add column "post_id" integer references "blog_post" ("id")`);
    const config = foldersConfig(context);
    const folderConfig = config.tables.find(table => table.name === "folder")!;
    folderConfig.resourceParent = [...[folderConfig.resourceParent ?? []].flat(), { column: "post_id", table: "blog_post", key: "id" }];
    await context.exec(createMigration({ ...config, engine: { ...config.engine, postgraphile: true } }));
    const [functions] = await context.runTestQuery(sql`
      select "proname" as "name", obj_description("oid", 'pg_proc') as "comment" from pg_proc
      where "proname" in ('folder_resource_parent', 'folder_resource_parent_post_id') order by 1`);
    expect(functions).toEqual(["folder_resource_parent", "folder_resource_parent_post_id"].map(name => ({ name, comment: "@behavior -*" })));
  });
});
