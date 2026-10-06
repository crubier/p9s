import { expect, describe, test, beforeEach, afterEach } from 'bun:test'
import { query as sql, identifier, raw, type SQL } from "pg-sql2";
import { setupTests, testDatabaseUrl } from '@p9s/postgres-testing';
import { bits, combineModes, setupBlog } from './helpers';

// Groups in a tree of 1 + 8 + 64 + 512, posts spread over the 512 leaves: post n is in group 74 + n % 512. Role 2 can
// read the first half of the tree, the groups of posts 0 to 255 modulo 512, and a few posts shared with its parent role
// in the other half, under groups it cannot read.
const POSTS = 20000;
const SHARED = [300, 400, 1300, 2400, 4400];
const readsGraph = sql`
  insert into "resource_group" ("id", "parent_id")
  select s, case when s = 1 then null else (s - 2) / 8 + 1 end from generate_series(1, 585) as s;
  insert into "role_group" ("id", "parent_id") values (1, null), (2, 1), (3, 1);
  insert into "blog_post" ("group_id", "name") select 74 + s % 512, 'post ' || s from generate_series(1, ${raw(String(POSTS))}) as s;
  insert into "assignment_edge" ("resource_id", "role_id", "permission")
  select s, 2, ${bits("1111")} from generate_series(2, 5) as s;
  -- Bits without select, on a group of the other half
  insert into "assignment_edge" ("resource_id", "role_id", "permission") values (6, 2, ${bits("0111")});
  insert into "assignment_edge" ("resource_id", "role_id", "permission")
  select "resource_id", 1, ${bits("1000")} from "blog_post" where "id" in (${raw(SHARED.join(", "))});`;

// The policies of RLS reads, and how Postgres plans them, at a size where a sequential scan is not the answer to
// everything. The docs page "Querying through RLS" explains each of these.
describe.skipIf(!testDatabaseUrl)('reads through RLS (real Postgres only)', () => {
  const { setup, teardown, context } = setupTests();
  beforeEach(setup);
  afterEach(teardown);

  const load = async (combineAssignmentsWith: typeof combineModes[number]) => {
    await setupBlog(context, { combineAssignmentsWith });
    await context.exec(sql`
      select resource_trigger_disable();
      select role_trigger_disable();
      ${readsGraph}
      select resource_trigger_enable();
      select role_trigger_enable();
      analyze;`);
    if (combineAssignmentsWith !== "none") {
      await context.exec(sql`select assignment_trigger_enable(); analyze;`);
    }
  };

  // As role 2, in a rolled back transaction: the rows of the statement, and how many rows it read from blog_post
  const asRole2 = async (statement: SQL) => {
    const count = sql`select (coalesce(seq_tup_read, 0) + coalesce(idx_tup_fetch, 0))::int as "n" from pg_stat_xact_user_tables where relname = 'blog_post'`;
    const results = await context.runTestQuery(sql`
      begin;
      ${count};
      set local role ${identifier(context.database_user_username)};
      select set_config('jwt.claims.role_id', '2', true);
      ${statement};
      reset role;
      ${count};
      rollback;`);
    const [before, rows, after] = [results[1], results.at(-4), results.at(-2)];
    return { rows: rows as any[], postsRead: after[0].n - before[0].n };
  };
  const plan = async (statement: SQL) =>
    (await asRole2(sql`explain (analyze, costs off, timing off) ${statement}`)).rows.map(row => row["QUERY PLAN"]).join("\n");

  for (const combineAssignmentsWith of combineModes) {
    describe(`combineAssignmentsWith ${combineAssignmentsWith}`, () => {
      // Postgres checks the policy before a filter that is not leakproof, like ilike, and plans the policy for the
      // rows it expects the scan to return. A filter that looks selective makes it check the ancestors of every row.
      // Behind offset 0, the scan has no other filter, and Postgres lists the readable resources once.
      test('a filter that is not leakproof runs after a policy that lists readable resources once, behind offset 0', async () => {
        await load(combineAssignmentsWith);
        const search = sql`select count(*)::int as "n" from "blog_post" where "name" ilike '%post 1777%'`;
        const fenced = sql`select count(*)::int as "n" from (select "name" from "blog_post" offset 0) as "post" where "name" ilike '%post 1777%'`;
        const [[{ n: matches }], [{ n: fencedMatches }]] = [(await asRole2(search)).rows, (await asRole2(fenced)).rows];
        expect(matches).toBeGreaterThan(0);
        expect(fencedMatches).toBe(matches);
        expect(await plan(search)).not.toContain("hashed SubPlan");
        expect(await plan(fenced)).toContain("hashed SubPlan");
      }, { timeout: 60000 });

      // Comparisons of integers, uuids and timestamps are leakproof, so an index can find where a page starts before
      // the policy runs. An offset reads, and checks, every row it skips.
      test('a keyset page reads about a page of rows, an offset every row it skips', async () => {
        await load(combineAssignmentsWith);
        const keyset = await asRole2(sql`select "id" from "blog_post" where "id" >= 10240 order by "id" limit 50`);
        const offset = await asRole2(sql`select "id" from "blog_post" order by "id" offset 5000 limit 50`);
        expect(keyset.rows).toHaveLength(50);
        expect(offset.rows).toHaveLength(50);
        expect(keyset.postsRead).toBeLessThan(100);
        expect(offset.postsRead).toBeGreaterThan(5000);
      }, { timeout: 60000 });

      // A bit on a resource is on every edge of a path from an assignment, so it is also on the path to the parent.
      // A row readable under a parent that is not was assigned itself, or reached through another edge.
      test('rows readable under a parent that is not come from the assignments of the user', async () => {
        await load(combineAssignmentsWith);
        const { rows: hidden } = await asRole2(sql`
          select "id" from "blog_post" where substring(resource_permission("group_id")::text from 1 for 1) <> '1' order by "id"`);
        expect(hidden.map(({ id }) => id)).toEqual(SHARED);
        const { rows: assigned, postsRead } = await asRole2(sql`
          select "id" from "blog_post" where "resource_id" in (select "resource_id" from "current_assignment") order by "id"`);
        expect(assigned.map(({ id }) => id)).toEqual(SHARED);
        expect(postsRead).toBeLessThan(100);
      }, { timeout: 60000 });
    });
  }
});
