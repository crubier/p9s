import { expect, describe, test, beforeEach, afterEach } from 'bun:test'
import { query as sql, raw } from "pg-sql2";
import { setupTests } from '@p9s/postgres-testing';
import { createMigration } from '../generation';
import { FIRST_GENERATED_ID, as, bits, blogMigrationConfig, combineModes, setupBlogTables } from './helpers';

// ORMs and APIs insert with returning, like Prisma, Drizzle, PostGraphile and PostgREST: Postgres checks the rows it
// returns with the select policy, before the triggers of the statement give them a place in the graph
describe('writes that return rows', () => {
  const { setup, teardown, context } = setupTests();
  beforeEach(setup);
  afterEach(teardown);

  // Role 1 has every bit on group 1, role 2 may only insert there, role 3 may read post 'shared', alone, in group 2
  const load = async (combineAssignmentsWith: (typeof combineModes)[number]) => {
    await setupBlogTables(context);
    await context.exec(createMigration(blogMigrationConfig(context, { combineAssignmentsWith })));
    await context.exec(sql`
      select setval('resource_id_seq', ${raw(String(FIRST_GENERATED_ID))});
      select setval('role_id_seq', ${raw(String(FIRST_GENERATED_ID))});
      insert into "resource_group" ("id", "parent_id") values (1, null), (2, null);
      insert into "role_group" ("id", "parent_id") values (1, null), (2, null), (3, null);
      insert into "blog_post" ("group_id", "name") values (1, 'first'), (2, 'shared');
      insert into "assignment_edge" ("resource_id", "role_id", "permission") values (1, 1, ${bits("1111")}), (1, 2, ${bits("0100")});
      insert into "assignment_edge" ("resource_id", "role_id", "permission") select "resource_id", 3, ${bits("1000")} from "blog_post" where "name" = 'shared';`);
  };
  const asRole = (roleId: number, statement: ReturnType<typeof sql>) => as(context, context.database_user_username, statement, sql`${raw(String(roleId))}`);

  for (const combineAssignmentsWith of combineModes) {
    test(`an insert returns the rows it inserts to users who may read them under their parent (combineAssignmentsWith: ${combineAssignmentsWith})`, async () => {
      await load(combineAssignmentsWith);
      expect(await asRole(1, sql`insert into "blog_post" ("group_id", "name") values (1, 'second'), (1, 'third') returning "name"`))
        .toEqual([{ name: "second" }, { name: "third" }]);
      // Who may insert without reading gets the rows inserted, not returned
      expect(await asRole(2, sql`insert into "blog_post" ("group_id", "name") values (1, 'blind')`)).toEqual([]);
      await expect(asRole(2, sql`insert into "blog_post" ("group_id", "name") values (1, 'blind returned') returning "name"`))
        .rejects.toThrow(/row-level security/);
      // Once the statement has ended, the rows have permissions of their own
      expect((await asRole(1, sql`select "name" from "blog_post" order by "name"`)).map((row: { name: string }) => row.name))
        .toEqual(["blind", "first", "second", "third"]);
    });
  }

  test('a read after an insert in the same query string still reads what the user may read, and nothing else', async () => {
    await load("none");
    const results = await context.runTestQuery(sql`
      set local role ${raw(`"${context.database_user_username}"`)};
      select set_config('jwt.claims.role_id', '1', true);
      insert into "blog_post" ("group_id", "name") values (1, 'fourth') returning "name";
      select "name" from "blog_post" order by "name";
      select set_config('jwt.claims.role_id', '3', true);
      select "name" from "blog_post" order by "name";`);
    expect(results[2]).toEqual([{ name: "fourth" }]);
    expect(results[3].map((row: { name: string }) => row.name)).toEqual(["first", "fourth"]);
    expect(results[5].map((row: { name: string }) => row.name)).toEqual(["shared"]);
  });
});
