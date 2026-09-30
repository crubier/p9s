import { expect, describe, test, beforeEach, afterEach } from 'bun:test'
import { query as sql } from "pg-sql2";
import { setupTests } from '@p9s/postgres-testing';
import {
  OPERATION_BITS, as, combineModes, createGraphDriver, createPermissionModel, createRandom, emptyGraph, fromNodeId, nodeId, randomOperation, setupBlog,
  type CombineMode, type IdMode,
} from './helpers';

const RESOURCES = 14;
const ROLES = 8;

const configurations: Array<{ combineAssignmentsWith: CombineMode, idMode: IdMode }> = [
  ...combineModes.map(combineAssignmentsWith => ({ combineAssignmentsWith, idMode: "integer" as const })),
  { combineAssignmentsWith: "none", idMode: "uuid" },
];

for (const { combineAssignmentsWith, idMode } of configurations) {
  describe(`RLS policies (combineAssignmentsWith: ${combineAssignmentsWith}, id: ${idMode})`, () => {
    const { setup, teardown, context } = setupTests();
    beforeEach(setup);
    afterEach(teardown);

    test('grant exactly what the reference permission model grants', async () => {
      await setupBlog(context, { combineAssignmentsWith, idMode });
      const driver = createGraphDriver(context, idMode, emptyGraph(RESOURCES, ROLES));
      await driver.createNodes();
      const id = (n: number) => nodeId(idMode, n);
      const user = context.database_user_username;
      const restorePost = (resource: number) => context.exec(sql`
        insert into "blog_post" ("resource_id", "name") values (${id(resource)}, 'post')
        on conflict ("resource_id") do nothing`);
      for (let resource = 1; resource <= RESOURCES; resource++) await restorePost(resource);

      const random = createRandom(7 + combineModes.indexOf(combineAssignmentsWith));
      const attempt = async (statement: Parameters<typeof as>[2], role: number) => {
        try {
          return { ok: true, rows: await as(context, user, statement, id(role)) };
        } catch (error) {
          return { ok: false, rows: [], error: String(error) };
        }
      };

      // Guards against a vacuous pass, e.g. a graph where nobody can do anything
      const outcomes = { allowed: 0, denied: 0 };
      const count = (value: boolean) => { outcomes[value ? "allowed" : "denied"]++; return value; };

      for (let round = 0; round < 3; round++) {
        for (let i = 0; i < 40; i++) await randomOperation(driver, random, { allowNodeReset: false });
        const model = createPermissionModel(driver.graph);
        const allowed = (role: number, resource: number, operation: keyof typeof OPERATION_BITS) =>
          model.allowed(role, resource, OPERATION_BITS[operation]);

        // select: every role sees exactly the resources it may select
        for (let role = 1; role <= ROLES; role++) {
          const rows = await as(context, user, sql`select "resource_id" from "blog_post"`, id(role));
          const visible = rows.map(row => fromNodeId(row.resource_id)).sort((a, b) => a - b);
          const expected = Array.from({ length: RESOURCES }, (_, i) => i + 1).filter(resource => count(allowed(role, resource, "select")));
          expect({ role, visible }).toEqual({ role, visible: expected });
        }

        // update and delete need the select bit too, since their where clause reads the row
        for (let i = 0; i < 20; i++) {
          const role = random.int(1, ROLES), resource = random.int(1, RESOURCES);
          const updated = await attempt(sql`update "blog_post" set "name" = 'updated' where "resource_id" = ${id(resource)} returning "resource_id"`, role);
          expect({ role, resource, updated: updated.rows.length })
            .toEqual({ role, resource, updated: count(allowed(role, resource, "select") && allowed(role, resource, "update")) ? 1 : 0 });

          const deleted = await attempt(sql`delete from "blog_post" where "resource_id" = ${id(resource)} returning "resource_id"`, role);
          expect({ role, resource, deleted: deleted.rows.length })
            .toEqual({ role, resource, deleted: count(allowed(role, resource, "select") && allowed(role, resource, "delete")) ? 1 : 0 });
          await restorePost(resource);
        }

        // insert is checked against the new row only
        for (let i = 0; i < 20; i++) {
          const role = random.int(1, ROLES), resource = random.int(1, RESOURCES);
          await context.exec(sql`delete from "blog_post" where "resource_id" = ${id(resource)}`);
          const inserted = await attempt(sql`insert into "blog_post" ("resource_id", "name") values (${id(resource)}, 'inserted')`, role);
          expect({ role, resource, inserted: inserted.ok }).toEqual({ role, resource, inserted: count(allowed(role, resource, "insert")) });
          if (!inserted.ok) expect(inserted.error).toContain("row-level security");
          await restorePost(resource);
        }
      }
      expect(outcomes.allowed).toBeGreaterThan(50);
      expect(outcomes.denied).toBeGreaterThan(50);
    }, { timeout: 120000 });
  });
}
