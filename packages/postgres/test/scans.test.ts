import { expect, describe, test, beforeEach, afterEach } from 'bun:test'
import { query as sql, identifier, join, literal, raw, type SQL } from "pg-sql2";
import { setupTests, testDatabaseUrl } from '@p9s/postgres-testing';
import { bits, combineModes, setupBlog } from './helpers';

// Trees of 1 + 8 + 64 + 512 + 4096 resources and roles, numbered breadth first from 1. On smaller tables a
// sequential scan is the cheapest plan and nothing to worry about.
const FAN_OUT = 8;
const RESOURCES = 4681;
const ROLES = 4681;
const LEAF = RESOURCES;
const OTHER_PARENT = 585 - 3;

// A flat graph: a root holding three groups and all the posts. The statistics then say a lookup of edges by parent
// returns the whole table, whatever the parent.
const FLAT_POSTS = 20000;
const MAX_ROWS_READ = 100;

const graphTables = ["resource_group", "resource_edge", "resource_edge_cache", "role_group", "role_edge", "role_edge_cache", "assignment_edge", "assignment_edge_cache"];

// A write near the leaves must only touch the rows it changes. A sequential scan of a graph or cache table makes it
// cost as much as the whole graph, which is how planner regressions in the triggers have shown up before.
describe.skipIf(!testDatabaseUrl)('writes near the leaves never scan a whole graph table (real Postgres only)', () => {
  const { setup, teardown, context } = setupTests();
  beforeEach(setup);
  afterEach(teardown);

  // Edges and assignments are written by the graph writer, rows of bound tables by their owner
  const tableStats = (column: SQL, tables = graphTables) => async (statement: SQL, asWriter: boolean) => {
    // pg_stat_xact_user_tables counts the scans of the current transaction, so this is exact and needs no flush
    const count = sql`select relname::text as "table", (${column})::int as "n" from pg_stat_xact_user_tables where relname in (${join(tables.map(table => literal(table)), ", ")})`;
    const results = await context.runTestQuery(sql`
      begin;
      ${asWriter ? sql`set local role ${identifier(context.database_writer_username)}` : sql`select 1`};
      ${count};
      ${statement};
      ${count};
      rollback;`);
    const counts = (rows: Array<{ table: string, n: number }>) => new Map(rows.map(({ table, n }) => [table, n]));
    const [before, after] = [counts(results[2]), counts(results.at(-2))];
    return Object.fromEntries([...after].map(([table, n]) => [table, n - (before.get(table) ?? 0)] as const).filter(([, n]) => n !== 0));
  };
  const seqScans = tableStats(sql`seq_scan`);
  const rowsRead = tableStats(sql`coalesce(seq_tup_read, 0) + coalesce(idx_tup_fetch, 0)`);
  // Policies also look up the api key of the current user
  const userRowsRead = tableStats(sql`coalesce(seq_tup_read, 0) + coalesce(idx_tup_fetch, 0)`, [...graphTables, "api_key"]);

  const load = async (combineAssignmentsWith: typeof combineModes[number], rows: SQL) => {
    await setupBlog(context, { combineAssignmentsWith });
    await context.exec(sql`
      select resource_trigger_disable();
      select role_trigger_disable();
      ${rows}
      select resource_trigger_enable();
      select role_trigger_enable();
      analyze;
    `);
    if (combineAssignmentsWith !== "none") {
      await context.exec(sql`select assignment_trigger_enable(); analyze;`);
    }
  };

  const parentOf = (n: number) => Math.floor((n - 2) / FAN_OUT) + 1;
  const tree = (table: string, size: number) => sql`
    insert into ${identifier(table)} ("id", "parent_id")
    select s, case when s = 1 then null else (s - 2) / ${raw(String(FAN_OUT))} + 1 end from generate_series(1, ${raw(String(size))}) as s;`;
  const deepGraph = sql`
    ${tree("resource_group", RESOURCES)}
    ${tree("role_group", ROLES)}
    insert into "blog_post" ("group_id", "name") values (${raw(String(LEAF))}, 'post');
    insert into "api_key" ("group_id") select s from generate_series(1, ${raw(String(ROLES))}) as s;
    insert into "assignment_edge" ("resource_id", "role_id", "permission")
    select (s * 37) % ${raw(String(RESOURCES))} + 1, s % ${raw(String(ROLES))} + 1, ${bits("1011")} from generate_series(1, 10000) as s
    on conflict do nothing;`;

  const leaf = raw(String(LEAF));
  const leafWrites: Array<[string, SQL, boolean]> = [
    // First, as a session keeps the plans of the trigger statements: they are then planned for many rows
    ["add 1000 posts to leaves", sql`insert into "blog_post" ("group_id", "name") select ${raw(String(RESOURCES - 4095))} + s % 4096, 'new' from generate_series(1, 1000) as s`, false],
    ["add a leaf", sql`insert into "resource_group" ("id", "parent_id") values (${raw(String(RESOURCES + 1))}, ${raw(String(parentOf(LEAF)))})`, false],
    ["add a post to a leaf", sql`insert into "blog_post" ("group_id", "name") values (${leaf}, 'new')`, false],
    ["rename a post", sql`update "blog_post" set "name" = 'renamed' where "group_id" = ${leaf}`, false],
    ["move a leaf row", sql`update "resource_group" set "parent_id" = ${raw(String(OTHER_PARENT))} where "id" = ${leaf}`, false],
    ["detach a leaf row", sql`update "resource_group" set "parent_id" = null where "id" = ${leaf}`, false],
    ["delete a post", sql`delete from "blog_post" where "group_id" = ${leaf}`, false],
    ["delete a leaf row", sql`delete from "resource_group" where "id" = ${leaf}`, false],
    ["link a leaf to a second parent", sql`insert into "resource_edge" values (${raw(String(OTHER_PARENT))}, ${leaf}, ${bits("1111")})`, true],
    ["move a leaf edge", sql`update "resource_edge" set "parent_id" = ${raw(String(OTHER_PARENT))} where "child_id" = ${leaf}`, true],
    ["change the bits of a leaf edge", sql`update "resource_edge" set "permission" = ${bits("0101")} where "child_id" = ${leaf}`, true],
    ["detach a leaf edge", sql`update "resource_edge" set "home" = false where "child_id" = ${leaf}; delete from "resource_edge" where "child_id" = ${leaf}`, true],
    ["assign a leaf", sql`insert into "assignment_edge" ("resource_id", "role_id", "permission") values (${leaf}, ${raw(String(ROLES))}, ${bits("1111")}) on conflict do nothing`, true],
    ["move a leaf role", sql`update "role_group" set "parent_id" = ${raw(String(parentOf(ROLES) - 1))} where "id" = ${raw(String(ROLES))}`, false],
    // API keys are role leaves: their writes only check that their role id is not a node
    ["add 1000 api keys", sql`insert into "api_key" ("group_id") select ${raw(String(ROLES - 4095))} + s % 4096 from generate_series(1, 1000) as s`, false],
    ["add an api key", sql`insert into "api_key" ("group_id") values (${raw(String(ROLES))})`, false],
    ["move an api key", sql`update "api_key" set "group_id" = 1 where "id" = 1`, false],
    ["delete an api key", sql`delete from "api_key" where "id" = 1`, false],
  ];

  const flatGraph = sql`
    insert into "resource_group" ("id", "parent_id") values (1, null), (2, 1), (3, 1), (4, 1);
    insert into "role_group" ("id", "parent_id") values (1, null), (2, 1), (3, 1);
    insert into "blog_post" ("group_id", "name") select 1, 'post' from generate_series(1, ${raw(String(FLAT_POSTS))}) as s;
    insert into "blog_comment" ("post_id", "body") select 1, 'comment' from generate_series(1, ${raw(String(FLAT_POSTS))}) as s;
    insert into "api_key" ("group_id") select 1 from generate_series(1, ${raw(String(FLAT_POSTS))}) as s;
    insert into "assignment_edge" ("resource_id", "role_id", "permission") values (1, 1, ${bits("1011")}), (2, 2, ${bits("1111")}), (3, 3, ${bits("0011")});`;
  const aPostOf = (group: number) => sql`(select "id" from "blog_post" where "group_id" = ${raw(String(group))} limit 1)`;
  const flatWrites = (postOfRoot: number): Array<[string, SQL, boolean]> => [
    ["add a post to the root", sql`insert into "blog_post" ("group_id", "name") values (1, 'new')`, false],
    ["add a post to a group", sql`insert into "blog_post" ("group_id", "name") values (4, 'new')`, false],
    ["add a group", sql`insert into "resource_group" ("id", "parent_id") values (5, 1)`, false],
    ["move a post to a group", sql`update "blog_post" set "group_id" = 4 where "id" = ${aPostOf(1)}`, false],
    ["move a group", sql`update "resource_group" set "parent_id" = 2 where "id" = 4`, false],
    ["delete a post", sql`delete from "blog_post" where "id" = ${aPostOf(1)}`, false],
    ["link a post to a group", sql`insert into "resource_edge" values (4, ${raw(String(postOfRoot))}, ${bits("1111")})`, true],
  ];

  // Comments are leaves: the 20000 of the first post are not nodes, so writing them reads no graph table at all
  const ownerCommentWrites: Array<[string, SQL]> = [
    ["add a comment", sql`insert into "blog_comment" ("post_id", "body") values (1, 'new')`],
    ["add 1000 comments", sql`insert into "blog_comment" ("post_id", "body") select 1, 'new' from generate_series(1, 1000)`],
    ["move a comment", sql`update "blog_comment" set "post_id" = 2 where "id" = 1`],
    ["delete a comment", sql`delete from "blog_comment" where "id" = 1`],
  ];

  // Role 1 may select, update and delete in the root, which holds every post. Policies check one row by its ancestors,
  // rather than listing the 20000 posts the role can see.
  const userRowStatements: Array<[string, SQL]> = [
    ["read a post", sql`select "id" from "blog_post" where "id" = 5`],
    ["rename a post", sql`update "blog_post" set "name" = 'renamed' where "id" = 5 returning "id"`],
    ["move a post", sql`update "blog_post" set "group_id" = 1 where "id" = 5 returning "id"`],
    ["delete a post", sql`delete from "blog_post" where "id" = 5 returning "id"`],
    ["read a comment", sql`select "id" from "blog_comment" where "id" = 5`],
    ["edit a comment", sql`update "blog_comment" set "body" = 'edited' where "id" = 5 returning "id"`],
    ["move a comment", sql`update "blog_comment" set "post_id" = 2 where "id" = 5 returning "id"`],
    ["delete a comment", sql`delete from "blog_comment" where "id" = 5 returning "id"`],
  ];

  for (const combineAssignmentsWith of combineModes) {
    test(`combineAssignmentsWith ${combineAssignmentsWith}`, async () => {
      await load(combineAssignmentsWith, deepGraph);
      const scans: Record<string, Record<string, number>> = {};
      for (const [name, statement, asWriter] of leafWrites) {
        const tables = await seqScans(statement, asWriter);
        if (Object.keys(tables).length > 0) scans[name] = tables;
      }
      expect(scans).toEqual({});
    }, { timeout: 60000 });

    // Neither a sequential scan nor an index whose key matches most of the rows
    test(`in a flat graph, combineAssignmentsWith ${combineAssignmentsWith}`, async () => {
      await load(combineAssignmentsWith, flatGraph);
      const [[{ id }]] = await context.exec(sql`select "child_id" as "id" from "resource_edge" where "parent_id" = 1 and "child_id" > 4 limit 1`);
      const reads: Record<string, Record<string, number>> = {};
      for (const [name, statement, asWriter] of flatWrites(id)) {
        const tables = Object.fromEntries(Object.entries(await rowsRead(statement, asWriter)).filter(([, n]) => n > MAX_ROWS_READ));
        if (Object.keys(tables).length > 0) reads[name] = tables;
      }
      expect(reads).toEqual({});

      const ownerReads: Record<string, Record<string, number>> = {};
      for (const [name, statement] of ownerCommentWrites) {
        const tables = await rowsRead(statement, false);
        if (Object.keys(tables).length > 0) ownerReads[name] = tables;
      }
      expect(ownerReads).toEqual({});

      // As role 1, and as one of its api keys, which has the same permissions
      const [[{ role_id: keyRoleId }]] = await context.exec(sql`select "role_id" from "api_key" where "group_id" = 1 order by "id" desc limit 1`);
      const userReads: Record<string, Record<string, number>> = {};
      for (const currentRoleId of ["1", String(keyRoleId)]) {
        for (const [name, statement] of userRowStatements) {
          const asUser = sql`set local role ${identifier(context.database_user_username)}; select set_config('jwt.claims.role_id', ${literal(currentRoleId)}, true); ${statement}; reset role`;
          const tables = Object.fromEntries(Object.entries(await userRowsRead(asUser, false)).filter(([, n]) => n > MAX_ROWS_READ));
          if (Object.keys(tables).length > 0) userReads[`${name} as ${currentRoleId}`] = tables;
          const [, , , rows] = await context.runTestQuery(sql`begin; ${asUser}; rollback;`);
          expect({ name, currentRoleId, rows: rows.length }).toEqual({ name, currentRoleId, rows: 1 });
        }
      }
      expect(userReads).toEqual({});
    }, { timeout: 60000 });
  }
});
