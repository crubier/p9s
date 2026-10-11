import { expect, describe, test, beforeEach, afterEach } from 'bun:test'
import { query as sql, identifier, raw, type SQL } from "pg-sql2";
import { setupTests, testDatabaseUrl } from '@p9s/postgres-testing';
import { bits, combineModes, setupBlog } from './helpers';

// Groups in a tree of 1 + 8 + 64 + 512, posts spread over the 512 leaves: post n is in group 74 + n % 512. Role 2 can
// read the first half of the tree, the groups of posts 0 to 255 modulo 512, and a few posts shared with its parent role
// in the other half, under groups it cannot read. Role 3 can read one group of the other half.
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
  insert into "assignment_edge" ("resource_id", "role_id", "permission") values (500, 3, ${bits("1111")});
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

  // As a role, in a rolled back transaction: the rows of the statement, and how many rows it read from blog_post
  const asRole = (roleId: number) => async (statement: SQL) => {
    const count = sql`select (coalesce(seq_tup_read, 0) + coalesce(idx_tup_fetch, 0))::int as "n" from pg_stat_xact_user_tables where relname = 'blog_post'`;
    const results = await context.runTestQuery(sql`
      begin;
      ${count};
      set local role ${identifier(context.database_user_username)};
      select set_config('jwt.claims.role_id', ${raw(`'${roleId}'`)}, true);
      ${statement};
      reset role;
      ${count};
      rollback;`);
    const [before, rows, after] = [results[1], results.at(-4), results.at(-2)];
    return { rows: rows as any[], postsRead: after[0].n - before[0].n };
  };
  const asRole2 = asRole(2);
  const asRole3 = asRole(3);
  const plan = async (statement: SQL) =>
    (await asRole2(sql`explain (analyze, costs off, timing off) ${statement}`)).rows.map(row => row["QUERY PLAN"]).join("\n");
  // The listings of readable resources the policies ran, with how many times each ran
  const listings = async (statement: SQL, role = asRole2) => {
    const lines = (await role(sql`explain (analyze, verbose, costs off, timing off) ${statement}`)).rows.map(row => row["QUERY PLAN"] as string);
    return lines.flatMap((line, i) => /ProjectSet \(actual rows/.test(line) && lines[i + 1]!.includes("current_resource_access_")
      ? [`${lines[i + 1]!.match(/current_resource_access_\d+_(\w+)\(\)/)?.[1]} x${line.match(/loops=(\d+)/)?.[1]}`] : []);
  };
  const cost = async (statement: SQL) =>
    (await asRole2(sql`explain (format json) ${statement}`)).rows[0]["QUERY PLAN"][0].Plan["Total Cost"] as number;

  for (const combineAssignmentsWith of combineModes) {
    describe(`combineAssignmentsWith ${combineAssignmentsWith}`, () => {
      // The policy is a condition Postgres adds to the query: it lists the readable resources once per statement and
      // keeps the rows among them, before a filter that is not leakproof, like ilike, behind offset 0 or not
      test('a filter that is not leakproof lists readable resources once', async () => {
        await load(combineAssignmentsWith);
        const search = sql`select count(*)::int as "n" from "blog_post" where "name" ilike '%post 1777%'`;
        const fenced = sql`select count(*)::int as "n" from (select "name" from "blog_post" offset 0) as "post" where "name" ilike '%post 1777%'`;
        const [searched, fencedSearched] = [await asRole2(search), await asRole2(fenced)];
        expect(searched.rows[0].n).toBeGreaterThan(0);
        expect(fencedSearched.rows[0].n).toBe(searched.rows[0].n);
        expect(await listings(search)).toEqual(["list x1"]);
        expect(await listings(fenced)).toEqual(["list x1"]);
      }, { timeout: 60000 });

      // Comparisons of integers, uuids and timestamps are leakproof, so an index can find where a page starts before
      // the policy runs. An offset reads every row it skips.
      test('a keyset page reads about a page of rows, an offset every row it skips', async () => {
        await load(combineAssignmentsWith);
        const keyset = await asRole2(sql`select "id" from "blog_post" where "id" >= 10240 order by "id" limit 50`);
        const offset = await asRole2(sql`select "id" from "blog_post" order by "id" offset 5000 limit 50`);
        expect(keyset.rows).toHaveLength(50);
        expect(offset.rows).toHaveLength(50);
        expect(keyset.postsRead).toBeLessThan(100);
        expect(offset.postsRead).toBeGreaterThan(5000);
      }, { timeout: 60000 });

      // Every read lists once, whoever the user is and whatever the statement: a lookup by id, a page, a count
      test('every read lists the readable resources once', async () => {
        await load(combineAssignmentsWith);
        const count = sql`select count(*)::int as "n" from "blog_post"`;
        // The posts of the group, and those shared with its parent role
        expect((await asRole3(count)).rows[0].n).toBe((POSTS / 512 | 0) + SHARED.length);
        expect(await listings(count, asRole3)).toEqual(["list x1"]);
        expect((await asRole3(sql`select "id" from "blog_post" where "name" ilike '%post 1%'`)).rows.length).toBeGreaterThan(0);
        const lookup = sql`select "id" from "blog_post" where "id" = 300`;
        expect((await asRole2(lookup)).rows).toEqual([{ id: 300 }]);
        expect((await asRole2(sql`select "id" from "blog_post" where "id" = 299`)).rows).toEqual([]);
        const page = sql`select "id" from "blog_post" order by "id" limit 50`;
        const first = await asRole2(page);
        expect(first.rows).toHaveLength(50);
        expect(first.postsRead).toBeLessThan(200);
        for (const statement of [lookup, page, count, sql`select "id" from "blog_post" where "group_id" = 80`]) {
          expect(await listings(statement)).toEqual(["list x1"]);
        }
      }, { timeout: 60000 });

      // Listing once, the policy costs little to the planner: large scans are not compiled with JIT, whose default
      // threshold is 100000, and listing does not count for every lookup of a nested loop
      test('the policies of reads look cheap to the planner', async () => {
        await load(combineAssignmentsWith);
        expect(await cost(sql`select count(*) from "blog_post" where "name" ilike '%post 1777%'`)).toBeLessThan(10000);
        expect(await cost(sql`select count(*) from "blog_post"`)).toBeLessThan(10000);
        expect(await cost(sql`update "blog_post" set "name" = "name" where "name" ilike '%post 1777%'`)).toBeLessThan(10000);
        const lookups = await plan(sql`select "the_post"."id", "the_other"."id" from "blog_post" as "the_post"
          join "blog_post" as "the_other" on "the_other"."id" = "the_post"."group_id" where "the_post"."id" in (300, 301)`);
        expect(lookups).toContain("Nested Loop");
        expect(lookups).not.toContain("Seq Scan on blog_post");
      }, { timeout: 60000 });

      // Writes list the same way, once for each policy: that of the write and that of reads for the rows it reads, and
      // for an update, again for the new rows, which Postgres checks against the select policy too
      test('updates and deletes list the resources once for each policy', async () => {
        await load(combineAssignmentsWith);
        expect(await listings(sql`update "blog_post" set "name" = "name" where "id" = 300`)).toEqual(["list x1", "list x1", "list x1"]);
        expect(await listings(sql`delete from "blog_post" where "id" = 300`)).toEqual(["list x1", "list x1"]);
        const expected = (await asRole2(sql`select count(*)::int as "n" from "blog_post" where "name" ilike '%7%'`)).rows[0].n;
        const updated = (await asRole2(sql`with "the_rows" as (update "blog_post" set "name" = "name" where "name" ilike '%7%' returning 1) select count(*)::int as "n" from "the_rows"`)).rows[0].n;
        expect(updated).toBe(expected);
        const deleted = (await asRole2(sql`with "the_rows" as (delete from "blog_post" where "name" ilike '%7%' returning 1) select count(*)::int as "n" from "the_rows"`)).rows[0].n;
        expect(deleted).toBe(expected);
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
