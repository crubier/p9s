import { expect, describe, test, beforeEach, afterEach } from 'bun:test'
import { query as sql, identifier, raw } from "pg-sql2";
import { createMigration } from '../generation';
import { setupTests } from '@p9s/postgres-testing';
import { OPERATION_BITS, as, bits, cacheMismatches, noMismatches, type TestContext } from './helpers';

// Teams and members are roles, and also resources with the same parent column, so that RLS decides who manages them
const setupTeams = async (context: TestContext) => {
  const user = identifier(context.database_user_username);
  await context.exec(sql`
    create table "team" ("id" serial primary key, "parent_id" integer references "team" ("id") on delete cascade);
    create table "member" ("id" serial primary key, "team_id" integer references "team" ("id") on delete cascade);
    create index on "team" ("parent_id");
    create index on "member" ("team_id");
    grant select, insert, update, delete on table "team", "member" to ${user};
    grant usage on sequence "team_id_seq", "member_id_seq" to ${user};
    create function "current_role_id"() returns integer as $$
      select nullif(current_setting('jwt.claims.role_id', true), '')::integer
    $$ language sql stable;`);
  const parent = { column: "team_id", table: "team", key: "id" };
  await context.exec(createMigration({
    engine: {
      permission: { bitmap: { size: 4 }, maxDepth: { resource: 8, role: 8 } },
      authentication: { getCurrentUserId: "current_role_id" },
      users: [context.database_user_username],
      graphWriters: [context.database_writer_username],
    },
    tables: [
      {
        name: "team", isResource: true, resourceId: "resource_id", isRole: true, roleId: "role_id",
        resourceParent: { ...parent, column: "parent_id" }, roleParent: { ...parent, column: "parent_id" },
        permission: { [context.database_user_username]: { ...OPERATION_BITS } },
      },
      {
        name: "member", isResource: true, resourceId: "resource_id", isRole: true, roleId: "role_id",
        resourceParent: parent, roleParent: parent,
        permission: { [context.database_user_username]: { ...OPERATION_BITS } },
      },
    ],
  }));
};

describe('role tables that are also resource tables', () => {
  const { setup, teardown, context } = setupTests();
  beforeEach(setup);
  afterEach(teardown);

  test('RLS decides who can add and move members, and the role tree follows', async () => {
    await setupTeams(context);
    // Org 1 holds teams 2 and 3. The admin and a member are in the org, and the admin manages the org as a resource.
    const [[org], , , [admin], [member]] = await context.runTestQuery(sql`
      insert into "team" ("parent_id") values (null) returning "resource_id", "role_id";
      insert into "team" ("parent_id") values (1) returning "resource_id", "role_id";
      insert into "team" ("parent_id") values (1) returning "resource_id", "role_id";
      insert into "member" ("team_id") values (1) returning "role_id";
      insert into "member" ("team_id") values (1) returning "role_id";`);
    await as(context, context.database_writer_username, sql`
      insert into "assignment_edge" ("resource_id", "role_id", "permission") values (${raw(String(org.resource_id))}, ${raw(String(admin.role_id))}, ${bits("1111")})`);
    const asAdmin = (statement: ReturnType<typeof sql>) => as(context, context.database_user_username, statement, raw(String(admin.role_id)));
    const asMember = (statement: ReturnType<typeof sql>) => as(context, context.database_user_username, statement, raw(String(member.role_id)));
    const memberOf = async (roleId: number) => (await context.runTestQuery(sql`
      select "team"."id" from "role_edge_cache" join "team" on "team"."role_id" = "role_edge_cache"."parent_id"
      where "role_edge_cache"."child_id" = ${raw(String(roleId))} order by 1`))[0].map((row: { id: number }) => row.id);

    // Adding someone to a team needs the insert bit on the team
    await expect(asMember(sql`insert into "member" ("team_id") values (2)`)).rejects.toThrow("row-level security");
    // Without returning: the select policy would check the new row before p9s gives it its edge
    await asAdmin(sql`insert into "member" ("team_id") values (2)`);
    const [newcomer] = await asAdmin(sql`select "id", "role_id" from "member" where "team_id" = 2`);
    expect(await memberOf(newcomer.role_id)).toEqual([1, 2]);

    // Moving them to another team needs the update bit on them and the insert bit on the new team
    expect(await asMember(sql`update "member" set "team_id" = 3 where "id" = ${raw(String(newcomer.id))} returning "id"`)).toEqual([]);
    await asAdmin(sql`update "member" set "team_id" = 3 where "id" = ${raw(String(newcomer.id))}`);
    expect(await memberOf(newcomer.role_id)).toEqual([1, 3]);

    // Teams are managed the same way
    await expect(asMember(sql`insert into "team" ("parent_id") values (2)`)).rejects.toThrow("row-level security");
    await asAdmin(sql`insert into "team" ("parent_id") values (2)`);
    expect(await cacheMismatches(context, "none")).toEqual(noMismatches);
  });
});
