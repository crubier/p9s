import { expect, describe, test, beforeEach, afterEach } from 'bun:test'
import { query as sql, raw, identifier } from "pg-sql2";
import { setupTests } from '@p9s/postgres-testing';
import type { Config } from '@p9s/core';
import { createMigration } from '../generation';
import { combineModes, defaultResourceCache, type CombineMode, type TestContext } from './helpers';

// Teams and shares that an application kept in its own tables before p9s: the rows of team_member are role edges, those
// of document_share and document_user_share assignments, and p9s follows every change of these tables
describe('links', () => {
  const { setup, teardown, context } = setupTests();
  beforeEach(setup);
  afterEach(teardown);

  const linksConfig = (ctx: TestContext, { links = true, combineAssignmentsWith = "none" }: { links?: boolean, combineAssignmentsWith?: CombineMode } = {}): Config<string> => ({
    engine: {
      combineAssignmentsWith,
      resourceCache: defaultResourceCache,
      users: [ctx.database_user_username],
      graphWriters: [ctx.database_writer_username],
      authentication: { getCurrentUserId: "current_role_id" },
      permission: { bitmap: { size: 8, names: { read: 0, edit: 1 } } },
    },
    tables: [
      { name: "app_user", isRole: true, roleId: "role_id" },
      { name: "team", isRole: true, roleId: "role_id" },
      { name: "document", isResource: true, resourceId: "resource_id", permission: { [ctx.database_user_username]: { select: 0, insert: 1, update: 1, delete: 1 } } },
    ],
    links: links ? [
      { name: "team_member", kind: "role", parent: { column: "team_id", table: "team", key: "id" }, child: { column: "user_id", table: "app_user", key: "id" } },
      {
        name: "document_share", kind: "assignment",
        resource: { column: "document_id", table: "document", key: "id" }, role: { column: "team_id", table: "team", key: "id" },
        permission: { column: "access", values: { viewer: ["read"], editor: ["read", "edit"] } },
      },
      {
        name: "document_user_share", kind: "assignment",
        resource: { column: "document_id", table: "document", key: "id" }, role: { column: "user_id", table: "app_user", key: "id" },
        permission: { column: "can_edit", values: { false: ["read"], true: ["read", "edit"] } },
      },
    ] : [],
  });

  const load = async (combineAssignmentsWith: CombineMode = "none") => {
    const user = identifier(context.database_user_username);
    await context.exec(sql`
      create table "app_user" ("id" integer primary key, "name" text not null);
      create table "team" ("id" integer primary key, "name" text not null);
      create table "team_member" ("team_id" integer not null references "team" on delete cascade, "user_id" integer not null references "app_user" on delete cascade, primary key ("team_id", "user_id"));
      create table "document" ("id" serial primary key, "title" text not null);
      create table "document_share" ("id" serial primary key, "document_id" integer not null references "document" on delete cascade, "team_id" integer not null references "team" on delete cascade, "access" text not null);
      create table "document_user_share" ("document_id" integer not null references "document" on delete cascade, "user_id" integer not null references "app_user" on delete cascade, "can_edit" boolean not null, primary key ("document_id", "user_id"));
      create index on "document_share" ("document_id", "team_id");
      create function "current_role_id"() returns integer as $$ select nullif(current_setting('jwt.claims.role_id', true), '')::integer $$ language sql stable;
      grant select, insert, update, delete on table "document" to ${user};
      grant usage on sequence "document_id_seq" to ${user};
      grant select, insert, update, delete on table "document_user_share" to ${user};
      insert into "app_user" values (1, 'alice'), (2, 'bob'), (3, 'carol');
      insert into "team" values (10, 'eng'), (11, 'sales');
      insert into "team_member" values (10, 1), (10, 2), (11, 3);
      insert into "document" ("id", "title") values (1, 'plan'), (2, 'budget'), (3, 'memo');
      insert into "document_share" ("document_id", "team_id", "access") values (1, 10, 'viewer'), (2, 11, 'editor');
      insert into "document_user_share" values (3, 2, true);`);
    await context.exec(createMigration(linksConfig(context, { combineAssignmentsWith })));
  };

  const roleIdOf = async (name: string) => (await context.runTestQuery(sql`select "role_id" from "app_user" where "name" = ${raw(`'${name}'`)}`))[0][0].role_id as number;
  const asUser = async (name: string, statement: ReturnType<typeof sql>) => {
    const results = await context.runTestQuery(sql`
      set local role ${identifier(context.database_user_username)};
      select set_config('jwt.claims.role_id', ${raw(`'${await roleIdOf(name)}'`)}, true);
      ${statement}`);
    return results.at(-1) as any[];
  };
  const titlesOf = async (name: string) => (await asUser(name, sql`select "title" from "document" order by "title"`)).map((row: { title: string }) => row.title);
  const updated = async (name: string, title: string) =>
    (await asUser(name, sql`update "document" set "title" = "title" where "title" = ${raw(`'${title}'`)} returning "id"`)).length === 1;

  test('existing memberships and shares give the access they gave', async () => {
    await load();
    expect(await titlesOf("alice")).toEqual(["plan"]);
    expect(await titlesOf("bob")).toEqual(["memo", "plan"]);
    expect(await titlesOf("carol")).toEqual(["budget"]);
    expect(await updated("alice", "plan")).toBe(false);
    expect(await updated("carol", "budget")).toBe(true);
    expect(await updated("bob", "memo")).toBe(true);
    const linked = await context.runTestQuery(sql`select count(*)::int as "count" from "assignment_edge" where "linked"`);
    expect(linked[0][0].count).toBe(3);
  });

  for (const combineAssignmentsWith of combineModes) test(`changes of the link tables change the access (combineAssignmentsWith: ${combineAssignmentsWith})`, async () => {
    await load(combineAssignmentsWith);
    await context.exec(sql`insert into "team_member" values (11, 1)`);
    expect(await titlesOf("alice")).toEqual(["budget", "plan"]);
    expect(await updated("alice", "budget")).toBe(true);

    await context.exec(sql`update "document_share" set "access" = 'editor' where "document_id" = 1`);
    expect(await updated("alice", "plan")).toBe(true);

    await context.exec(sql`delete from "team_member" where "team_id" = 11 and "user_id" = 1`);
    expect(await titlesOf("alice")).toEqual(["plan"]);

    await context.exec(sql`delete from "document_share" where "document_id" = 1`);
    expect(await titlesOf("alice")).toEqual([]);
    expect(await titlesOf("bob")).toEqual(["memo"]);

    await context.exec(sql`update "document_user_share" set "can_edit" = false where "document_id" = 3`);
    expect(await titlesOf("bob")).toEqual(["memo"]);
    expect(await updated("bob", "memo")).toBe(false);

    await context.exec(sql`delete from "team" where "id" = 11`);
    expect(await titlesOf("carol")).toEqual([]);
  });

  test('the rows of a pair add their bits', async () => {
    await load();
    await context.exec(sql`insert into "document_share" ("document_id", "team_id", "access") values (1, 10, 'editor')`);
    expect(await updated("alice", "plan")).toBe(true);
    await context.exec(sql`delete from "document_share" where "document_id" = 1 and "access" = 'editor'`);
    expect(await updated("alice", "plan")).toBe(false);
    expect(await titlesOf("alice")).toEqual(["plan"]);
    // A value that is not listed gives nothing
    await context.exec(sql`update "document_share" set "access" = 'commenter' where "document_id" = 1`);
    expect(await titlesOf("alice")).toEqual([]);
  });

  test('users share through a link table, only with the bits they have', async () => {
    await load();
    expect(await asUser("bob", sql`insert into "document_user_share" values (3, 3, false)`)).toEqual([]);
    expect(await titlesOf("carol")).toEqual(["budget", "memo"]);
    await expect(asUser("carol", sql`insert into "document_user_share" values (3, 1, true)`)).rejects.toThrow(/only give bits the current user has/);
    await expect(asUser("carol", sql`update "document_user_share" set "can_edit" = true where "user_id" = 3`)).rejects.toThrow(/only give bits/);
    // Taking edit away from bob takes bits carol does not have
    await expect(asUser("carol", sql`delete from "document_user_share" where "user_id" = 2`)).rejects.toThrow(/only give bits/);
    expect(await titlesOf("alice")).toEqual(["plan"]);
  });

  test('running the migration again keeps the access, and a config without links removes what they gave', async () => {
    await load();
    await context.exec(createMigration(linksConfig(context)));
    expect(await titlesOf("bob")).toEqual(["memo", "plan"]);

    // Functions of the application are left alone, even with the name of a link function
    await context.exec(sql`create function "my_link_sync"() returns integer as $$ select 1 $$ language sql`);
    await context.exec(createMigration(linksConfig(context, { links: false })));
    expect(await titlesOf("bob")).toEqual([]);
    expect((await context.runTestQuery(sql`select "my_link_sync"() as "one"`))[0][0].one).toBe(1);
    const linkFunctions = await context.runTestQuery(sql`select "proname" from pg_proc where "proname" like '%\_link\_%' and "proname" <> 'my_link_sync'`);
    expect(linkFunctions[0]).toEqual([]);
    const columns = await context.runTestQuery(sql`select count(*)::int as "count" from information_schema.columns where "column_name" = 'linked'`);
    expect(columns[0][0].count).toBe(0);
    const triggers = await context.runTestQuery(sql`select count(*)::int as "count" from pg_trigger where "tgrelid" in ('document_share'::regclass, 'team_member'::regclass) and not "tgisinternal"`);
    expect(triggers[0][0].count).toBe(0);
    // Rows written while the tables are not linked count once they are linked again
    await context.exec(sql`
      insert into "team_member" values (11, 1);
      truncate "document_share";
      insert into "document_share" ("document_id", "team_id", "access") values (2, 11, 'viewer');`);
    expect(await titlesOf("alice")).toEqual([]);

    await context.exec(createMigration(linksConfig(context)));
    expect(await titlesOf("alice")).toEqual(["budget"]);
    expect(await titlesOf("bob")).toEqual(["memo"]);
  });

  test('a link table cannot be truncated, and keys that match no row stop the migration', async () => {
    await load();
    await expect(context.exec(sql`truncate "team_member"`)).rejects.toThrow(/cannot be truncated/);
    await context.exec(sql`
      create table "loose_member" ("team_id" integer, "user_id" integer);
      insert into "loose_member" values (99, 1);`);
    const config = linksConfig(context);
    const loose = { ...config, links: [...config.links!, { name: "loose_member", kind: "role" as const, parent: { column: "team_id", table: "team", key: "id" }, child: { column: "user_id", table: "app_user", key: "id" } }] };
    await expect(context.exec(createMigration(loose))).rejects.toThrow(/hold no row of the tables they link/);
  });

  test('the config of a link is checked', () => {
    const config = linksConfig(context);
    expect(() => createMigration({ ...config, links: [{ name: "x", kind: "assignment", resource: { column: "d", table: "document" }, role: { column: "t", table: "team" } }] }))
      .toThrow(/needs the bits its rows give/);
    expect(() => createMigration({ ...config, links: [{ name: "x", kind: "role", parent: { column: "d", table: "document" }, child: { column: "t", table: "team" } }] }))
      .toThrow(/not a role table/);
    expect(() => createMigration({ ...config, links: [{ name: "x", kind: "role", parent: { column: "a", table: "team" }, child: { column: "b", table: "team" }, permission: ["share"] }] }))
      .toThrow(/Bit "share" is not in/);
  });
});
