import { expect, describe, test, beforeEach, afterEach } from 'bun:test'
import { query as sql, identifier, raw, type SQL } from "pg-sql2";
import { setupTests, testDatabaseUrl } from '@p9s/postgres-testing';
import type { SearchConfig } from "@p9s/core";
import { createMigration } from "../generation";
import { as, bits, blogMigrationConfig, combineModes, FIRST_GENERATED_ID, setupBlogTables, type CombineMode, type TestContext } from './helpers';

// Groups in a tree of 1 + 8 + 64 + 512, posts spread over the 512 leaves: post n is in group 74 + n % 512. Role 2 can
// read the first half of the tree, the groups of posts 0 to 255 modulo 512. One post in 50 is a needle.
const graph = (posts: number) => sql`
  insert into "resource_group" ("id", "parent_id")
  select s, case when s = 1 then null else (s - 2) / 8 + 1 end from generate_series(1, 585) as s;
  insert into "role_group" ("id", "parent_id") values (1, null), (2, 1), (3, 1);
  insert into "blog_post" ("group_id", "name")
  select 74 + s % 512, 'post ' || s || case when s % 50 = 0 then ' needle' else '' end from generate_series(1, ${raw(String(posts))}) as s;
  insert into "blog_comment" ("post_id", "body") select "id", 'comment on ' || "name" from "blog_post";
  insert into "assignment_edge" ("resource_id", "role_id", "permission")
  select s, 2, ${bits("1111")} from generate_series(2, 5) as s;`;

const searchConfig = (ctx: TestContext, combineAssignmentsWith: CombineMode, searches = true) => {
  const config = blogMigrationConfig(ctx, { combineAssignmentsWith });
  const declared: Record<string, Record<string, SearchConfig>> = {
    blog_post: { search: { columns: ["name"], operator: "ilike" }, words: { columns: ["words"], operator: "@@" } },
    blog_comment: { search: { columns: ["body"], operator: "ilike" } },
  };
  return { ...config, tables: config.tables.map(table => searches && declared[table.name] ? { ...table, search: declared[table.name] } : table) };
};

const load = async (ctx: TestContext, combineAssignmentsWith: CombineMode, posts: number) => {
  await setupBlogTables(ctx);
  await ctx.exec(sql`
    create extension if not exists pg_trgm;
    alter table "blog_post" add column "words" tsvector generated always as (to_tsvector('simple', "name")) stored;
    create index on "blog_post" using gin ("name" gin_trgm_ops);
    create index on "blog_post" using gin ("words");
    create index on "blog_comment" using gin ("body" gin_trgm_ops);`);
  await ctx.exec(createMigration(searchConfig(ctx, combineAssignmentsWith)));
  await ctx.exec(sql`
    select setval('resource_id_seq', ${raw(String(FIRST_GENERATED_ID))});
    select setval('role_id_seq', ${raw(String(FIRST_GENERATED_ID))});
    select resource_trigger_disable();
    select role_trigger_disable();
    ${graph(posts)}
    select resource_trigger_enable();
    select role_trigger_enable();
    analyze;`);
  if (combineAssignmentsWith !== "none") {
    await ctx.exec(sql`select assignment_trigger_enable(); analyze;`);
  }
};

const ids = (rows: { id: number }[]) => rows.map(row => row.id).sort((a, b) => a - b);

describe('searches through indexes', () => {
  const { setup, teardown, context } = setupTests();
  beforeEach(setup);
  afterEach(teardown);

  const asRole2 = (statement: SQL) => as(context, context.database_user_username, statement, sql`2`);
  const asOwner = async (statement: SQL) => (await context.runTestQuery(statement)).at(-1) as any[];
  for (const combineAssignmentsWith of combineModes) {
    test(`a search returns the matching rows the user can read, as a filter does through RLS (${combineAssignmentsWith})`, async () => {
      await load(context, combineAssignmentsWith, 2000);
      const everyNeedle = await asOwner(sql`select count(*)::int as "n" from "blog_post" where "name" ilike '%needle%'`);
      const filtered = ids(await asRole2(sql`select "id" from "blog_post" where "name" ilike '%needle%'`));
      expect(filtered.length).toBeGreaterThan(0);
      expect(filtered.length).toBeLessThan(everyNeedle[0].n);
      expect(ids(await asRole2(sql`select "id" from "blog_post_search"('%needle%')`))).toEqual(filtered);
      expect(ids(await asRole2(sql`select "id" from "blog_post_words"(to_tsquery('simple', 'needle'))`))).toEqual(filtered);
      // Comments are leaf rows, readable with their post
      const comments = ids(await asRole2(sql`select "id" from "blog_comment" where "body" ilike '%needle%'`));
      expect(comments.length).toBe(filtered.length);
      expect(ids(await asRole2(sql`select "id" from "blog_comment_search"('%needle%')`))).toEqual(comments);
      // Another user, with nothing assigned, finds nothing
      expect(await as(context, context.database_user_username, sql`select "id" from "blog_post_search"('%needle%')`, sql`3`)).toEqual([]);
    }, { timeout: 60000 });
  }

  test('the rows a search returns are read as the caller: other policies and column privileges apply', async () => {
    await load(context, "none", 2000);
    const user = identifier(context.database_user_username);
    const readable = ids(await asRole2(sql`select "id" from "blog_post_search"('%needle%')`));
    await context.exec(sql`
      create policy "no_needles_ending_in_zero" on "blog_post" as restrictive for select to ${user} using ("name" not like '%00 needle');`);
    const kept = ids(await asRole2(sql`select "id" from "blog_post_search"('%needle%')`));
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(readable.length);
    expect(kept).toEqual(ids(await asRole2(sql`select "id" from "blog_post" where "name" ilike '%needle%'`)));
    await context.exec(sql`
      revoke select on "blog_post" from ${user};
      grant select ("id", "name") on "blog_post" to ${user};`);
    await expect(asRole2(sql`select "id" from "blog_post_search"('%needle%')`)).rejects.toThrow(/permission denied/);
  }, { timeout: 60000 });

  test('only the user roles of a search run it, and its functions for each user stay theirs', async () => {
    await load(context, "none", 200);
    const writer = context.database_writer_username;
    await expect(as(context, writer, sql`select "id" from "blog_post_search"('%needle%')`, sql`2`)).rejects.toThrow(/permission denied/);
    await expect(as(context, writer, sql`select "blog_post_search_${raw(context.database_user_username)}"('%needle%')`, sql`2`)).rejects.toThrow(/permission denied/);
    const [definer] = await asOwner(sql`
      select prosecdef as "definer", array(select unnest(proacl)::text) as "acl" from pg_proc where proname = ${raw(`'blog_post_search_${context.database_user_username}'`)}`);
    expect(definer.definer).toBe(true);
    expect(definer.acl.filter((entry: string) => entry.startsWith("=") || entry.startsWith(`${writer}=`))).toEqual([]);
  }, { timeout: 60000 });

  test('a migration keeps the searches it declares, and drops the others', async () => {
    await load(context, "none", 200);
    const searches = sql`select proname as "name" from pg_proc where proname like 'blog\\_post\\_%' or proname like 'blog\\_comment\\_%' order by proname`;
    const declared = (await asOwner(searches)).map(row => row.name);
    expect(declared).toEqual(expect.arrayContaining(["blog_comment_search", "blog_post_search", "blog_post_words"]));
    await context.exec(createMigration(searchConfig(context, "none")));
    expect((await asOwner(searches)).map(row => row.name)).toEqual(declared);
    await context.exec(createMigration(searchConfig(context, "none", false)));
    expect((await asOwner(searches)).map(row => row.name).filter((name: string) => /search|words/.test(name))).toEqual([]);
  }, { timeout: 60000 });
});

// A search reads the rows that match through the index, where a filter through RLS reads every row of the table
describe.skipIf(!testDatabaseUrl)('searches through indexes, at scale (real Postgres only)', () => {
  const { setup, teardown, context } = setupTests();
  beforeEach(setup);
  afterEach(teardown);

  test('a search reads the matching rows, a filter through RLS every row', async () => {
    await load(context, "none", 20000);
    const count = sql`select (coalesce(seq_tup_read, 0) + coalesce(idx_tup_fetch, 0))::int as "n" from pg_stat_xact_user_tables where relname = 'blog_post'`;
    const postsRead = async (statement: SQL) => {
      const results = await context.runTestQuery(sql`
        begin;
        ${count};
        set local role ${identifier(context.database_user_username)};
        select set_config('jwt.claims.role_id', '2', true);
        ${statement};
        reset role;
        ${count};
        rollback;`);
      return { rows: results.at(-4) as { id: number }[], read: results.at(-2)[0].n - results[1][0].n };
    };
    const filtered = await postsRead(sql`select "id" from "blog_post" where "name" ilike '%needle%'`);
    const searched = await postsRead(sql`select "id" from "blog_post_search"('%needle%')`);
    expect(ids(searched.rows)).toEqual(ids(filtered.rows));
    expect(filtered.read).toBeGreaterThanOrEqual(20000);
    expect(searched.read).toBeLessThan(1000);
  }, { timeout: 120000 });
});
