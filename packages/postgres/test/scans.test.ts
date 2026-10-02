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

const graphTables = ["resource_group", "resource_edge", "resource_edge_cache", "role_group", "role_edge", "role_edge_cache", "assignment_edge", "assignment_edge_cache"];

// A write near the leaves must only touch the rows it changes. A sequential scan of a graph or cache table makes it
// cost as much as the whole graph, which is how planner regressions in the triggers have shown up before.
describe.skipIf(!testDatabaseUrl)('writes near the leaves never scan a whole graph table (real Postgres only)', () => {
  const { setup, teardown, context } = setupTests();
  beforeEach(setup);
  afterEach(teardown);

  // Edges and assignments are written by the graph writer, rows of bound tables by their owner
  const seqScans = async (statement: SQL, asWriter: boolean) => {
    // pg_stat_xact_user_tables counts the scans of the current transaction, so this is exact and needs no flush
    const count = sql`select relname::text as "table", seq_scan::int as "n" from pg_stat_xact_user_tables where relname in (${join(graphTables.map(table => literal(table)), ", ")})`;
    const results = await context.runTestQuery(sql`
      begin;
      ${asWriter ? sql`set local role ${identifier(context.database_writer_username)}` : sql`select 1`};
      ${count};
      ${statement};
      ${count};
      rollback;`);
    const counts = (rows: Array<{ table: string, n: number }>) => new Map(rows.map(({ table, n }) => [table, n]));
    const [before, after] = [counts(results[2]), counts(results.at(-2))];
    return Object.fromEntries([...after].map(([table, n]) => [table, n - (before.get(table) ?? 0)]).filter(([, n]) => n !== 0));
  };

  const parentOf = (n: number) => Math.floor((n - 2) / FAN_OUT) + 1;
  const tree = (table: string, size: number) => sql`
    insert into ${identifier(table)} ("id", "parent_id")
    select s, case when s = 1 then null else (s - 2) / ${raw(String(FAN_OUT))} + 1 end from generate_series(1, ${raw(String(size))}) as s;`;
  const loadGraph = async () => {
    await context.exec(sql`
      select resource_trigger_disable();
      select role_trigger_disable();
      ${tree("resource_group", RESOURCES)}
      ${tree("role_group", ROLES)}
      insert into "blog_post" ("group_id", "name") values (${raw(String(LEAF))}, 'post');
      insert into "assignment_edge" ("resource_id", "role_id", "permission")
      select (s * 37) % ${raw(String(RESOURCES))} + 1, s % ${raw(String(ROLES))} + 1, ${bits("1011")} from generate_series(1, 10000) as s
      on conflict do nothing;
      select resource_trigger_enable();
      select role_trigger_enable();
      analyze;
    `);
  };

  const leaf = raw(String(LEAF));
  const leafWrites: Array<[string, SQL, boolean]> = [
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
  ];

  for (const combineAssignmentsWith of combineModes) {
    test(`combineAssignmentsWith ${combineAssignmentsWith}`, async () => {
      await setupBlog(context, { combineAssignmentsWith });
      await loadGraph();
      if (combineAssignmentsWith !== "none") {
        await context.exec(sql`select assignment_trigger_enable(); analyze;`);
      }
      const scans: Record<string, Record<string, number>> = {};
      for (const [name, statement, asWriter] of leafWrites) {
        const tables = await seqScans(statement, asWriter);
        if (Object.keys(tables).length > 0) scans[name] = tables;
      }
      expect(scans).toEqual({});
    }, { timeout: 60000 });
  }
});
