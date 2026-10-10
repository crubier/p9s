import { expect, describe, test, beforeEach, afterEach } from 'bun:test'
import { query as sql, identifier, raw, type SQL } from "pg-sql2";
import { setupTests, testDatabaseUrl } from '@p9s/postgres-testing';
import { bits, combineModes, setupBlog } from './helpers';
import { CHECKED_ROWS, CHECKED_WRITTEN_ROWS, LISTED_RESOURCES } from '../generation';

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

  // As a role, in a rolled back transaction: the rows of the statement, how many rows it read from blog_post, and how
  // many of them the select policy checked one by one before listing the readable resources
  const asRole = (roleId: number) => async (statement: SQL) => {
    const count = sql`select (coalesce(seq_tup_read, 0) + coalesce(idx_tup_fetch, 0))::int as "n" from pg_stat_xact_user_tables where relname = 'blog_post'`;
    const results = await context.runTestQuery(sql`
      begin;
      ${count};
      set local role ${identifier(context.database_user_username)};
      select set_config('jwt.claims.role_id', ${raw(`'${roleId}'`)}, true);
      ${statement};
      select coalesce(nullif(current_setting('p9s.checked_blog_post_select', true), ''), '0')::int as "checked";
      reset role;
      ${count};
      rollback;`);
    const [before, rows, checked, after] = [results[1], results.at(-5), results.at(-4), results.at(-2)];
    return { rows: rows as any[], postsRead: after[0].n - before[0].n, checked: checked[0].checked as number };
  };
  const asRole2 = asRole(2);
  const asRole3 = asRole(3);
  const plan = async (statement: SQL) =>
    (await asRole2(sql`explain (analyze, costs off, timing off) ${statement}`)).rows.map(row => row["QUERY PLAN"]).join("\n");
  // The listings of readable resources the select policy ran, as the function and its argument, sorted
  const listings = async (statement: SQL, role = asRole2, setup = sql``) => {
    const lines = (await role(sql`${setup} explain (analyze, verbose, costs off, timing off) ${statement}`)).rows.map(row => row["QUERY PLAN"] as string);
    return lines.flatMap((line, i) => /ProjectSet \(actual rows/.test(line)
      ? [lines[i + 1]!.match(/current_resource_access_0_(\w+)\('?(\d*)'?(?:::bigint)?\)/)?.slice(1).join("(").concat(")") ?? lines[i + 1]!] : []).sort();
  };
  const cost = async (statement: SQL) =>
    (await asRole2(sql`explain (format json) ${statement}`)).rows[0]["QUERY PLAN"][0].Plan["Total Cost"] as number;
  const budget = (value: string) => sql`set local p9s.check_rows = ${raw(`'${value}'`)};`;

  for (const combineAssignmentsWith of combineModes) {
    describe(`combineAssignmentsWith ${combineAssignmentsWith}`, () => {
      // Postgres checks the policy before a filter that is not leakproof, like ilike, and the filter makes it expect
      // few rows. Rows that the first listings do not have are checked one by one, 200 of them, then the policy lists
      // every readable resource once, behind offset 0 or not.
      test('a filter that is not leakproof checks the first rows, then lists readable resources once', async () => {
        await load(combineAssignmentsWith);
        const search = sql`select count(*)::int as "n" from "blog_post" where "name" ilike '%post 1777%'`;
        const fenced = sql`select count(*)::int as "n" from (select "name" from "blog_post" offset 0) as "post" where "name" ilike '%post 1777%'`;
        const [searched, fencedSearched] = [await asRole2(search), await asRole2(fenced)];
        expect(searched.rows[0].n).toBeGreaterThan(0);
        expect(fencedSearched.rows[0].n).toBe(searched.rows[0].n);
        expect(searched.checked).toBe(CHECKED_ROWS);
        expect(fencedSearched.checked).toBe(CHECKED_ROWS);
        expect(await plan(search)).toMatch(/ProjectSet \(actual rows=[\d.]+ loops=1\)/);
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

      // A user who reads few resources lists them all at the second row, whatever the statement, and checks one
      test('a user who reads few resources checks the first row, then lists them all', async () => {
        await load(combineAssignmentsWith);
        const statement = sql`select count(*)::int as "n" from "blog_post"`;
        const count = await asRole3(statement);
        // The posts of the group, and those shared with its parent role
        expect(count.rows[0].n).toBe((POSTS / 512 | 0) + SHARED.length);
        expect(count.checked).toBe(1);
        expect(await listings(statement, asRole3)).toEqual([`first(${LISTED_RESOURCES})`]);
        const search = await asRole3(sql`select "id" from "blog_post" where "name" ilike '%post 1%'`);
        expect(search.rows.length).toBeGreaterThan(0);
        expect(search.checked).toBe(1);
        expect((await asRole3(sql`${budget("10")} ${statement}`)).checked).toBe(10);
        expect((await asRole3(sql`${budget("on")} ${statement}`)).rows).toEqual(count.rows);
      }, { timeout: 60000 });

      // A lookup by id checks its row by its ancestors, and lists nothing. Past the first row, a statement lists some of
      // the resources of the user, checks the rows that are not among them one by one, 200 by default, then lists every
      // resource: a first page or the rows of a group never list them all, a count or a search do. p9s.check_rows says
      // how many rows to check for every user, on for every row, off for none.
      test('reads check the rows they read up to p9s.check_rows, then list', async () => {
        await load(combineAssignmentsWith);
        const lookup = sql`select "id" from "blog_post" where "id" = 300`;
        expect(await asRole2(lookup)).toMatchObject({ rows: [{ id: 300 }], checked: 1 });
        expect(await listings(lookup)).toEqual([]);
        expect(await asRole2(sql`select "id" from "blog_post" where "id" = 299`)).toMatchObject({ rows: [], checked: 1 });

        const page = sql`select "id" from "blog_post" order by "id" limit 50`;
        const first = await asRole2(page);
        expect(first.rows).toHaveLength(50);
        expect(first.checked).toBeLessThan(50);
        expect(first.postsRead).toBeLessThan(200);
        expect(await listings(page)).not.toContain("list()");
        const group = sql`select "id" from "blog_post" where "group_id" = 80`;
        expect((await asRole2(group)).rows.length).toBeGreaterThan(0);
        expect(await listings(group)).not.toContain("list()");
        // A page that walks more rows the user cannot read than a page holds: none of them is listed first
        const { rows: visible } = await asRole2(sql`select "id" from "blog_post" where "id" <= 2000 order by "id"`);
        const ids = visible.map(({ id }) => id as number);
        const afterGap = ids.find((id, i) => i > 0 && id - ids[i - 1]! > 150)!;
        const sparse = sql`select "id" from "blog_post" where "id" >= ${raw(String(afterGap - 120))} order by "id" limit 50`;
        const sparsePage = await asRole2(sparse);
        expect(sparsePage.rows).toHaveLength(50);
        expect(sparsePage.checked).toBeGreaterThanOrEqual(120);
        expect(await listings(sparse)).not.toContain("list()");
        const count = sql`select count(*)::int from "blog_post"`;
        expect((await asRole2(count)).checked).toBe(CHECKED_ROWS);
        expect(await listings(count)).toEqual([`first(${LISTED_RESOURCES})`, "list()"]);

        const always = await asRole2(sql`${budget("on")} select "id" from "blog_post" where "group_id" between 70 and 90`);
        expect(always.checked).toBeGreaterThan(600);
        expect(await listings(count, asRole2, budget("on"))).toEqual([]);
        expect((await asRole2(sql`${budget("off")} ${page}`)).checked).toBe(0);
        expect(await listings(count, asRole2, budget("off"))).toEqual(["list()"]);
        expect((await asRole2(sql`${budget("10")} ${page}`)).checked).toBe(10);
        expect((await asRole2(sql`${budget("010")} ${page}`)).checked).toBe(10);
        expect((await asRole2(sql`${budget("ten")} ${count}`)).checked).toBe(CHECKED_ROWS);
        // The rows do not depend on how many are checked
        const statements = [page, sql`select "id" from "blog_post" where "name" ilike '%7%' order by "id"`, sql`select count(*)::int from "blog_post"`,
          sql`select "id" from "blog_post" where "group_id" between 70 and 90 order by "id"`, sql`select "id" from "blog_post" where "id" in (300, 301, 302)`];
        for (const statement of statements) {
          const expected = (await asRole2(statement)).rows;
          for (const value of ["on", "off", "0", "1", "49", "100000"]) {
            expect((await asRole2(sql`${budget(value)} ${statement}`)).rows).toEqual(expected);
          }
        }
      }, { timeout: 120000 });

      // Checking every row, or listing once, the policy costs little to the planner: large scans are not compiled with
      // JIT, whose default threshold is 100000, and listing does not count for every lookup of a nested loop
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

      // Writes check the rows they update and delete the same way, and so does the select policy of the statement that
      // writes, which only goes back to listing first for the next statement
      test('updates and deletes check the rows they write, then list', async () => {
        await load(combineAssignmentsWith);
        for (const write of [sql`update "blog_post" set "name" = "name" where "id" = 300`, sql`delete from "blog_post" where "id" = 300`]) {
          expect(await listings(write)).toEqual([]);
          expect((await asRole2(write)).checked).toBeGreaterThan(0);
        }
        // Each exec is a statement of its own, in the same transaction
        await context.exec(sql`begin`);
        try {
          await context.exec(sql`set local role ${identifier(context.database_user_username)}`);
          await context.exec(sql`select set_config('jwt.claims.role_id', '2', true)`);
          await context.exec(sql`update "blog_post" set "name" = "name" where "id" = 300`);
          const [rows] = await context.exec(sql`explain (analyze, verbose, costs off, timing off) select count(*)::int from "blog_post"`);
          const lines = rows.map((row: Record<string, string>) => row["QUERY PLAN"]!);
          expect(lines.some((line: string, i: number) => /ProjectSet \(actual rows/.test(line) && lines[i + 1]!.includes("_first("))).toBe(true);
        } finally {
          await context.exec(sql`rollback`);
        }
        const expected = (await asRole2(sql`select count(*)::int as "n" from "blog_post" where "name" ilike '%7%'`)).rows[0].n;
        for (const value of ["on", "off", "50"]) {
          const updated = (await asRole2(sql`${budget(value)} with "the_rows" as (update "blog_post" set "name" = "name" where "name" ilike '%7%' returning 1) select count(*)::int as "n" from "the_rows"`)).rows[0].n;
          expect(updated).toBe(expected);
          const deleted = (await asRole2(sql`${budget(value)} with "the_rows" as (delete from "blog_post" where "name" ilike '%7%' returning 1) select count(*)::int as "n" from "the_rows"`)).rows[0].n;
          expect(deleted).toBe(expected);
        }
        const { rows: [{ n: checked, read }] } = await asRole2(sql`
          update "blog_post" set "name" = "name" where "name" ilike '%7%';
          select current_setting('p9s.checked_blog_post_update')::int as "n", current_setting('p9s.checked_blog_post_select')::int as "read"`);
        expect(checked).toBe(CHECKED_WRITTEN_ROWS);
        expect(read).toBe(CHECKED_WRITTEN_ROWS);
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
