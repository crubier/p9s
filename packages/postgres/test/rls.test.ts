import { expect, describe, test, beforeEach, afterEach } from 'bun:test'
import { query as sql, join, raw } from "pg-sql2";
import { setupTests } from '@p9s/postgres-testing';
import {
  BITMAP_SIZE, OPERATION_BITS, as, combineModes, createGraphDriver, createPermissionModel, createRandom, emptyGraph, fromNodeId, nodeId, randomOperation, setupBlog,
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
      // Each group holds one post, which gets its permissions through its home edge. Each post holds one comment, a
      // leaf row with the permissions of its post.
      const posts = new Map<number, number>();
      const groupOfPost = (post: number) => [...posts].find(([, id]) => id === post)?.[0];
      const restoreComment = (resource: number) => context.exec(sql`
        delete from "blog_comment" where "post_id" = ${raw(String(posts.get(resource)))};
        insert into "blog_comment" ("post_id", "body") values (${raw(String(posts.get(resource)))}, 'comment')`);
      const restorePost = async (resource: number) => {
        const [[{ id: post }]] = await context.exec(sql`
          delete from "blog_post" where "group_id" = ${id(resource)};
          insert into "blog_post" ("group_id", "name") values (${id(resource)}, 'post') returning "id"`).then(results => results.slice(-1));
        posts.set(resource, post);
        await restoreComment(resource);
      };
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
        for (let i = 0; i < 60; i++) await randomOperation(driver, random, { allowNodeReset: false });
        const model = createPermissionModel(driver.graph);
        const allowed = (role: number, resource: number, operation: keyof typeof OPERATION_BITS) =>
          model.allowed(role, resource, OPERATION_BITS[operation]);

        // select: every role sees exactly the resources it may select
        for (let role = 1; role <= ROLES; role++) {
          const rows = await as(context, user, sql`select "group_id" from "blog_post"`, id(role));
          const visible = rows.map(row => fromNodeId(row.group_id)).sort((a, b) => a - b);
          const expected = Array.from({ length: RESOURCES }, (_, i) => i + 1).filter(resource => count(allowed(role, resource, "select")));
          expect({ role, visible }).toEqual({ role, visible: expected });
          const comments = await as(context, user, sql`select "post_id" from "blog_comment"`, id(role));
          expect({ role, comments: comments.map(row => groupOfPost(row.post_id)).sort((a, b) => a! - b!) }).toEqual({ role, comments: expected });
        }

        // resource_permission gives application code every bit the policies check, for the current user by default
        const resources = Array.from({ length: RESOURCES }, (_, i) => i + 1);
        const bitmap = (role: number, resource: number) =>
          Array.from({ length: BITMAP_SIZE }, (_, bit) => model.allowed(role, resource, bit) ? "1" : "0").join("");
        for (let role = 1; role <= ROLES; role++) {
          const rows = await as(context, user, sql`
            select "resource", "resource_permission"("id")::text as "permission"
            from (values ${join(resources.map(resource => sql`(${raw(String(resource))}, ${id(resource)})`), ", ")}) as "the_resource" ("resource", "id")
            order by "resource"`, id(role));
          expect({ role, permissions: rows.map(row => row.permission) }).toEqual({ role, permissions: resources.map(resource => bitmap(role, resource)) });
        }
        const pairs = Array.from({ length: ROLES }, (_, i) => i + 1).flatMap(role => resources.map(resource => ({ role, resource })));
        const permissions = await as(context, context.database_writer_username, sql`
          select "resource_permission"("resource", "role")::text as "permission"
          from (values ${join(pairs.map(({ role, resource }, index) => sql`(${raw(String(index))}, ${id(resource)}, ${id(role)})`), ", ")}) as "the_pair" ("index", "resource", "role")
          order by "index"`);
        expect(permissions.map(row => row.permission)).toEqual(pairs.map(({ role, resource }) => bitmap(role, resource)));

        // update and delete need the select bit too, since their where clause reads the row
        for (let i = 0; i < 20; i++) {
          const role = random.int(1, ROLES), resource = random.int(1, RESOURCES);
          const updated = await attempt(sql`update "blog_post" set "name" = 'updated' where "group_id" = ${id(resource)} returning "id"`, role);
          expect({ role, resource, updated: updated.rows.length })
            .toEqual({ role, resource, updated: count(allowed(role, resource, "select") && allowed(role, resource, "update")) ? 1 : 0 });

          const deleted = await attempt(sql`delete from "blog_post" where "group_id" = ${id(resource)} returning "id"`, role);
          expect({ role, resource, deleted: deleted.rows.length })
            .toEqual({ role, resource, deleted: count(allowed(role, resource, "select") && allowed(role, resource, "delete")) ? 1 : 0 });
          await restorePost(resource);

          const post = raw(String(posts.get(resource)));
          const updatedComment = await attempt(sql`update "blog_comment" set "body" = 'updated' where "post_id" = ${post} returning "id"`, role);
          expect({ role, resource, updatedComment: updatedComment.rows.length })
            .toEqual({ role, resource, updatedComment: count(allowed(role, resource, "select") && allowed(role, resource, "update")) ? 1 : 0 });

          const deletedComment = await attempt(sql`delete from "blog_comment" where "post_id" = ${post} returning "id"`, role);
          expect({ role, resource, deletedComment: deletedComment.rows.length })
            .toEqual({ role, resource, deletedComment: count(allowed(role, resource, "select") && allowed(role, resource, "delete")) ? 1 : 0 });
          await restoreComment(resource);
        }

        // insert is checked against the parent of the new row
        for (let i = 0; i < 20; i++) {
          const role = random.int(1, ROLES), resource = random.int(1, RESOURCES);
          await context.exec(sql`delete from "blog_post" where "group_id" = ${id(resource)}`);
          const inserted = await attempt(sql`insert into "blog_post" ("group_id", "name") values (${id(resource)}, 'inserted')`, role);
          expect({ role, resource, inserted: inserted.ok }).toEqual({ role, resource, inserted: count(allowed(role, resource, "insert")) });
          if (!inserted.ok) expect(inserted.error).toContain("row-level security");
          await restorePost(resource);

          await context.exec(sql`delete from "blog_comment" where "post_id" = ${raw(String(posts.get(resource)))}`);
          const insertedComment = await attempt(sql`insert into "blog_comment" ("post_id", "body") values (${raw(String(posts.get(resource)))}, 'inserted')`, role);
          expect({ role, resource, insertedComment: insertedComment.ok }).toEqual({ role, resource, insertedComment: count(allowed(role, resource, "insert")) });
          if (!insertedComment.ok) expect(insertedComment.error).toContain("row-level security");
          await restoreComment(resource);
        }

        // moving a post is updating it, and inserting it under its new parent
        for (let i = 0; i < 20; i++) {
          const role = random.int(1, ROLES), from = random.int(1, RESOURCES), to = random.int(1, RESOURCES);
          if (from === to) continue;
          const moved = await attempt(sql`update "blog_post" set "group_id" = ${id(to)} where "group_id" = ${id(from)} returning "id"`, role);
          const visible = allowed(role, from, "select") && allowed(role, from, "update");
          const expected = count(visible && allowed(role, to, "insert"));
          expect({ role, from, to, moved: moved.ok && moved.rows.length === 1 }).toEqual({ role, from, to, moved: expected });
          if (visible && !expected) expect(moved.error).toContain("row-level security");
          await restorePost(from);
          await restorePost(to);

          // A comment has no node to tell an unchanged parent apart, so moving it needs the bits on both posts. The
          // new row also has to pass the select policy, since the where clause reads it.
          const movedComment = await attempt(sql`
            update "blog_comment" set "post_id" = ${raw(String(posts.get(to)))} where "post_id" = ${raw(String(posts.get(from)))} returning "id"`, role);
          const expectedComment = count(visible && allowed(role, to, "select") && allowed(role, to, "update"));
          expect({ role, from, to, movedComment: movedComment.ok && movedComment.rows.length === 1 }).toEqual({ role, from, to, movedComment: expectedComment });
          if (visible && !expectedComment) expect(movedComment.error).toContain("row-level security");
          await restoreComment(from);
          await restoreComment(to);
        }
      }
      expect(outcomes.allowed).toBeGreaterThan(50);
      expect(outcomes.denied).toBeGreaterThan(50);
    }, { timeout: 120000 });
  });
}
