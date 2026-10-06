import { expect, describe, test, beforeEach, afterEach } from 'bun:test'
import { query as sql, raw } from "pg-sql2";
import type { Client } from '@p9s/postgres-testing/pg';
import { setupTests, testDatabaseUrl } from '@p9s/postgres-testing';
import { assignedCacheMismatches, cacheMismatches, noMismatches, setupBlog } from './helpers';

const ROUNDS = 20;

// Each round races two transactions whose trigger computations each depend on the other's uncommitted edge.
// The sleep keeps the first transaction open, so without serialization the second one computes from a stale graph.
describe.skipIf(!testDatabaseUrl)('concurrent graph writes (real Postgres only)', () => {
  const { setup, teardown, context } = setupTests();
  let clients: Client[] = [];
  beforeEach(async () => {
    await setup();
    clients = [await context.connect(), await context.connect()];
  });
  afterEach(async () => {
    await Promise.all(clients.map(client => client.end()));
    await teardown();
  });

  const writerTransaction = (client: Client, statement: string) =>
    client.query(`begin; set local role "${context.database_writer_username}"; ${statement}; select pg_sleep(0.02); commit;`);

  const race = (first: string, second: string) =>
    Promise.all([writerTransaction(clients[0]!, first), writerTransaction(clients[1]!, second)]);

  const count = async (query: ReturnType<typeof sql>) => (await context.runTestQuery(query))[0][0].n as number;

  test('inserting both halves of a path at once still caches the whole path', async () => {
    await setupBlog(context, { resourceCache: "full" });
    await context.exec(sql`insert into "resource_group" ("id") select generate_series(1, ${raw(String(ROUNDS * 3))})`);
    for (let i = 0; i < ROUNDS; i++) {
      const [x, y, z] = [3 * i + 1, 3 * i + 2, 3 * i + 3];
      await race(
        `insert into "resource_edge" values (${x}, ${y}, b'1111')`,
        `insert into "resource_edge" values (${y}, ${z}, b'1111')`,
      );
    }
    expect(await cacheMismatches(context, "none")).toEqual(noMismatches);
    expect(await count(sql`select count(*)::int as "n" from "resource_edge_cache" where "child_id" = "parent_id" + 2`)).toBe(ROUNDS);
  });

  test('deleting the top of a path while extending its bottom leaves no stale path', async () => {
    await setupBlog(context);
    await context.exec(sql`insert into "resource_group" ("id") select generate_series(1, ${raw(String(ROUNDS * 3))})`);
    await context.exec(sql`insert into "resource_edge" select 3 * i + 1, 3 * i + 2, b'1111' from generate_series(0, ${raw(String(ROUNDS - 1))}) as i`);
    for (let i = 0; i < ROUNDS; i++) {
      const [x, y, z] = [3 * i + 1, 3 * i + 2, 3 * i + 3];
      await race(
        `delete from "resource_edge" where "parent_id" = ${x} and "child_id" = ${y}`,
        `insert into "resource_edge" values (${y}, ${z}, b'1111')`,
      );
    }
    expect(await cacheMismatches(context, "none")).toEqual(noMismatches);
    expect(await count(sql`select count(*)::int as "n" from "resource_edge_cache" where "child_id" = "parent_id" + 2`)).toBe(0);
  });

  test('creating a row under a group while the group gains a parent caches the whole path', async () => {
    await setupBlog(context, { resourceCache: "full" });
    await context.exec(sql`insert into "resource_group" ("id") select generate_series(1, ${raw(String(ROUNDS * 2))})`);
    for (let i = 0; i < ROUNDS; i++) {
      const [x, y] = [2 * i + 1, 2 * i + 2];
      await Promise.all([
        writerTransaction(clients[0]!, `insert into "resource_edge" values (${x}, ${y}, b'1111')`),
        clients[1]!.query(`begin; insert into "blog_post" ("group_id", "name") values (${y}, 'post'); select pg_sleep(0.02); commit;`),
      ]);
    }
    expect(await cacheMismatches(context, "none")).toEqual(noMismatches);
    expect(await count(sql`
      select count(*)::int as "n" from "resource_edge_cache" join "blog_post" on "child_id" = "resource_id"
      where "parent_id" = "group_id" - 1`)).toBe(ROUNDS);
  });

  test('assigning a group while adding a member to it gives the member access', async () => {
    await setupBlog(context, { combineAssignmentsWith: "role" });
    await context.exec(sql`
      insert into "resource_group" ("id") select generate_series(1, ${raw(String(ROUNDS))});
      insert into "role_group" ("id") select generate_series(1, ${raw(String(ROUNDS * 2))});
    `);
    for (let i = 0; i < ROUNDS; i++) {
      const [resource, group, member] = [i + 1, 2 * i + 1, 2 * i + 2];
      await race(
        `insert into "assignment_edge" ("resource_id", "role_id", "permission") values (${resource}, ${group}, b'1111')`,
        `insert into "role_edge" values (${group}, ${member}, b'1111')`,
      );
    }
    expect(await cacheMismatches(context, "role")).toEqual(noMismatches);
    expect(await count(sql`select count(*)::int as "n" from "assignment_edge_cache" where "role_id" = 2 * "resource_id"`)).toBe(ROUNDS);
  });

  test('with resourceCache "assigned", assigning a group while it gains a child caches the child', async () => {
    await setupBlog(context, { combineAssignmentsWith: "resource", resourceCache: "assigned" });
    await context.exec(sql`
      insert into "resource_group" ("id") select generate_series(1, ${raw(String(ROUNDS * 2))});
      insert into "role_group" ("id") values (1);
    `);
    for (let i = 0; i < ROUNDS; i++) {
      const [x, y] = [2 * i + 1, 2 * i + 2];
      await race(
        `insert into "assignment_edge" ("resource_id", "role_id", "permission") values (${x}, 1, b'1111')`,
        `insert into "resource_edge" values (${x}, ${y}, b'1111')`,
      );
    }
    expect(await assignedCacheMismatches(context)).toBe(0);
    expect(await cacheMismatches(context, "resource")).toEqual(noMismatches);
    expect(await count(sql`select count(*)::int as "n" from "assignment_edge_cache" where "role_id" = 1 and "resource_id" % 2 = 0`)).toBe(ROUNDS);
    expect(await count(sql`select count(*)::int as "n" from "resource_edge_cache" where "child_id" = "parent_id" + 1`)).toBe(ROUNDS);
  });
});
