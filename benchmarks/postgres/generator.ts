import { query as sql, join, identifier, literal, raw, type SQL } from "pg-sql2";
import { createMigration } from '@p9s/postgres'
import { computeIndexRange, generateRandomBitmap, generateRandomPairsInRanges, generateRegularPairsInRanges, generateUuidFromInteger } from '@p9s/core-testing'

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

export const nullConsole = {
  ...console,
  log: () => { },
  time: () => { },
  timeEnd: () => { },
  table: () => { },
};

export interface Context {
  database_admin_username: string;
  database_user_username: string;
  runTestQuery: (query: SQL) => Promise<any>;
  exec: (query: SQL) => Promise<any>;
}

export type IdMode = "integer" | "uuid";
export type CombineMode = "none" | "role" | "resource";

export interface BenchmarkOptions {
  benchmarkSizeFactor?: number;
  idMode?: IdMode;
  combineAssignmentsWith?: CombineMode;
  // Timed repetitions per read or write scenario, run after `warmup` untimed ones
  reps?: number;
  warmup?: number;
  // Also measure reads through policies that recompute permissions at query time, without any cache
  baseline?: boolean;
  logger?: typeof console;
}

export interface Stats {
  n: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
}

export interface BenchmarkResult {
  options: Required<Omit<BenchmarkOptions, "logger">>;
  dataset: Record<"resourceNodes" | "resourceEdges" | "roleNodes" | "roleEdges" | "assignmentPairs" | "businessRows", number>;
  // Seconds
  load: Record<"schema" | "dataGen" | "insert" | "disableTriggers" | "resourceNode" | "resourceEdge" | "roleNode" | "roleEdge" | "assignmentEdge" | "businessRows" | "enableTriggers" | "analyze", number>;
  cache: Array<{ table: string, rows: number, bytes: number }>;
  // Milliseconds
  reads: Array<{ name: string, policy: "p9s" | "baseline", stats: Stats, meanVisibleRows?: number }>;
  // Whether the no-cache baseline shows every sampled user exactly the rows the p9s caches show, null when skipped
  baselineMatches: boolean | null;
  writes: Array<{ name: string, stats: Stats }>;
  plans: Record<string, string>;
}

interface TreeLevelInfo {
  start: number;
  size: number;
  fanOut: number;
}

function computeTreeLevelInfo(levels: number[]): { levelInfo: TreeLevelInfo[], totalNodes: number, totalEdges: number } {
  const levelInfo: TreeLevelInfo[] = [];
  let start = 0;
  let size = 1;
  for (let d = 0; d < levels.length; d++) {
    size *= levels[d]!;
    levelInfo.push({ start, size, fanOut: levels[d]! });
    start += size;
  }
  return { levelInfo, totalNodes: start, totalEdges: start - levels[0]! };
}

export const computeStats = (samples: number[]): Stats => {
  const sorted = [...samples].sort((a, b) => a - b);
  const quantile = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
  return {
    n: sorted.length,
    mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
    p50: quantile(0.5),
    p95: quantile(0.95),
    p99: quantile(0.99),
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
  };
};

const createRandom = (seed: number) => {
  let state = seed >>> 0;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  return { int: (n: number) => Math.floor(next() * n) };
};

const NODE_BATCH_SIZE = 500000;
const EDGE_BATCH_SIZE = 50000;
const ASSIGNMENT_BATCH_SIZE = 50000;

const resourceLevelNames = ["org", "workspace", "folder", "project", "object"];
const roleLevelNames = ["org", "team", "user"];

export async function runPostgresBenchmark(context: Context, {
  benchmarkSizeFactor = 5,
  idMode = "uuid",
  combineAssignmentsWith = "none",
  reps = 30,
  warmup = 3,
  baseline = true,
  logger = nullConsole
}: BenchmarkOptions): Promise<BenchmarkResult> {
  const startTime = performance.now();

  const { database_admin_username, database_user_username, runTestQuery, exec } = context;

  const resourceTables = ["post", "image", "article", "drone", "mission", "site", "structure", "alert", "dock", "vps", "model", "compressor", "encabulator", "memristor", "processor", "rotator", "translator", "mercator"]
  const bitmapSize = 4 * resourceTables.length + 12;


  const resourceLevels = [benchmarkSizeFactor /* orgs */, benchmarkSizeFactor /* workspaces per org */, benchmarkSizeFactor /* folders per workspace */, benchmarkSizeFactor /* projects per folder */, benchmarkSizeFactor /* objects per project */];
  const roleLevels = [benchmarkSizeFactor /* orgs */, benchmarkSizeFactor /* teams per org */, benchmarkSizeFactor /* users per team */];

  const resourceTree = computeTreeLevelInfo(resourceLevels);
  const roleTree = computeTreeLevelInfo(roleLevels);

  logger.log("Number of resource nodes:", resourceTree.totalNodes);
  logger.log("Number of role nodes:", roleTree.totalNodes);

  const nodeId = (n: number): SQL => idMode === "uuid" ? sql`${literal(generateUuidFromInteger(n))}::uuid` : raw(String(n));
  const nodeIdFromSeries = (column: SQL): SQL => idMode === "uuid"
    ? sql`(select (substr(h, 1, 8) || '-' || substr(h, 9, 4) || '-' || substr(h, 13, 4) || '-' || substr(h, 17, 4) || '-' || substr(h, 21, 12))::uuid from lpad(to_hex(${column}::bigint), 32, '0') as h)`
    : column;
  const bitmap = (probability: number, seed: number): SQL => raw(`b'${generateRandomBitmap(bitmapSize, probability, seed)}'::bit(${bitmapSize})`);

  const t: Record<string, number> = {};
  const tick = (label: string) => { t[label] = performance.now(); };

  tick("schema_start");

  // Setup a simple datamodel
  await exec(sql`
    create extension if not exists "uuid-ossp";    
    
    drop table if exists "human_user" cascade;
    create table "human_user" (
      "id" uuid default uuid_generate_v4() primary key,
      "created_at" timestamptz default current_timestamp,
      "updated_at" timestamptz default current_timestamp,
      "email" varchar(1024) unique not null
    );
    grant select, insert, update, delete on table "human_user" to ${identifier(database_user_username)};

    drop table if exists "team" cascade;
    create table "team" (
      "id" uuid default uuid_generate_v4() primary key,
      "created_at" timestamptz default current_timestamp,
      "updated_at" timestamptz default current_timestamp,
      "name" varchar(1024) not null
    );
    grant select, insert, update, delete on table "team" to ${identifier(database_user_username)};

    drop table if exists "folder" cascade;
    create table "folder" (
      "id" uuid default uuid_generate_v4() primary key,
      "created_at" timestamptz default current_timestamp,
      "updated_at" timestamptz default current_timestamp,
      "name" varchar(1024) not null
    );
    grant select, insert, update, delete on table "folder" to ${identifier(database_user_username)};

    ${join(resourceTables.map(resourceTable => sql`
      drop table if exists ${identifier(resourceTable)} cascade;
      create table ${identifier(resourceTable)} (
        "id" uuid default uuid_generate_v4() primary key,
        "created_at" timestamptz default current_timestamp,
        "updated_at" timestamptz default current_timestamp,
        "name" varchar(1024) not null,
        "author" uuid references "human_user"("id"),
        "foo" uuid default uuid_generate_v4(),
        "bar" uuid default uuid_generate_v4(),
        "baz" uuid default uuid_generate_v4(),
        "qux" uuid default uuid_generate_v4(),
        "corge" uuid default uuid_generate_v4(),
        "grault" uuid default uuid_generate_v4(),
        "garply" uuid default uuid_generate_v4(),
        "waldo" uuid default uuid_generate_v4(),
        "fred" uuid default uuid_generate_v4(),
        "plugh" uuid default uuid_generate_v4(),
        "xyzzy" uuid default uuid_generate_v4(),
        "thud" uuid default uuid_generate_v4()
      );
      grant select, insert, update, delete on table ${identifier(resourceTable)} to ${identifier(database_user_username)};
    `), "\n")}
    
  `);

  await exec(idMode === "uuid" ? sql`
    -- See https://postgraphile.org/postgraphile/next/postgresql-schema-design
    create function "current_role_id"() returns uuid as $$
      select nullif(current_setting('jwt.claims.role_id', true), ${literal(NIL_UUID)})::uuid
    $$ language sql stable;
  ` : sql`
    -- See https://postgraphile.org/postgraphile/next/postgresql-schema-design
    create function "current_role_id"() returns integer as $$
      select nullif(current_setting('jwt.claims.role_id', true), '-1')::integer
    $$ language sql stable;
  `);




  // Run a p9s migration on top of the datamodel
  await exec(createMigration({
    engine: {
      permission: {
        bitmap: {
          size: bitmapSize
        }
      },
      authentication: {
        getCurrentUserId: "current_role_id",
      },
      users: [
        database_admin_username,
        database_user_username
      ],
      id: {
        mode: idMode
      },
      combineAssignmentsWith
    },
    tables: [{
      name: "human_user",
      isRole: true,
      roleId: "role_id"
    }, {
      name: "team",
      isRole: true,
      roleId: "role_id"
    }, {
      name: "folder",
      isResource: true,
      resourceId: "resource_id",
      permission: {
        [database_user_username]: {
          select: 8,
          insert: 9,
          update: 10,
          delete: 11
        }
      }
    },
    ...resourceTables.map((resourceTable, index) => ({
      name: resourceTable,
      isResource: true,
      resourceId: "resource_id",
      permission: {
        [database_user_username]: {
          select: 12 + 4 * index,
          insert: 13 + 4 * index,
          update: 14 + 4 * index,
          delete: 15 + 4 * index
        }
      }
    }))]
  }));

  await exec(idMode === "uuid" ? sql`
    -- See https://postgraphile.org/postgraphile/next/postgresql-schema-design
    create type "jwt_token" as (
      role_id uuid,
      exp bigint
    );

    -- See https://postgraphile.org/postgraphile/next/postgresql-schema-design
    create function "register_human_user"(
      "human_user_email" varchar(1024)
    ) returns "human_user" as $$
    declare
      "result_role_node" "role_node";
      "result_human_user" "human_user";
    begin
      insert into "role_node" 
      default values
      returning * into "result_role_node";

      insert into "human_user" ("email", "role_id") 
      values ("human_user_email", "result_role_node"."id")
      returning * into "result_human_user";

      return "result_human_user";
    end;
    $$ language plpgsql strict security definer;

    -- See https://postgraphile.org/postgraphile/next/postgresql-schema-design
    create function "authenticate_human_user"(
      "human_user_email" varchar(1024)
    ) returns "jwt_token" as $$
    declare
      "result_human_user" "human_user";
    begin
      select * into "result_human_user"
      from "human_user"
      where "email" = "human_user_email";

      return ("result_human_user"."role_id", extract(epoch from (now() + interval '2 days')))::jwt_token;
    end;
    $$ language plpgsql strict security definer;
  ` : sql`
    -- See https://postgraphile.org/postgraphile/next/postgresql-schema-design
    create extension if not exists "uuid-ossp";

    -- See https://postgraphile.org/postgraphile/next/postgresql-schema-design
    create type "jwt_token" as (
      role_id integer,
      exp bigint
    );

    -- See https://postgraphile.org/postgraphile/next/postgresql-schema-design
    create function "register_human_user"(
      "human_user_email" varchar(1024)
    ) returns "human_user" as $$
    declare
      "result_role_node" "role_node";
      "result_human_user" "human_user";
    begin
      insert into "role_node" 
      default values
      returning * into "result_role_node";

      insert into "human_user" ("email", "role_id") 
      values ("human_user_email", "result_role_node"."id")
      returning * into "result_human_user";

      return "result_human_user";
    end;
    $$ language plpgsql strict security definer;

    -- See https://postgraphile.org/postgraphile/next/postgresql-schema-design
    create function "authenticate_human_user"(
      "human_user_email" varchar(1024)
    ) returns "jwt_token" as $$
    declare
      "result_human_user" "human_user";
    begin
      select * into "result_human_user"
      from "human_user"
      where "email" = "human_user_email";

      return ("result_human_user"."role_id", extract(epoch from (now() + interval '2 days')))::jwt_token;
    end;
    $$ language plpgsql strict security definer;
  `);

  tick("schema_end");

  tick("data_gen_start");

  // Regular assignments from resources to roles
  const assignmentRegularOrgOrgPairs = generateRegularPairsInRanges(computeIndexRange(roleLevels, 0).size * 2.0, computeIndexRange(roleLevels, 0), computeIndexRange(resourceLevels, 0));
  const assignmentRegularTeamWorkspacePairs = generateRegularPairsInRanges(computeIndexRange(roleLevels, 1).size * 2.0, computeIndexRange(roleLevels, 1), computeIndexRange(resourceLevels, 1));
  const assignmentRegularUserFolderPairs = generateRegularPairsInRanges(computeIndexRange(roleLevels, 2).size * 2.0, computeIndexRange(roleLevels, 2), computeIndexRange(resourceLevels, 2));

  // Random assignments from resources to roles at the org role level
  const assignmentRandomOrgOrgPairs = generateRandomPairsInRanges(computeIndexRange(roleLevels, 0).size * 0.2, computeIndexRange(roleLevels, 0), computeIndexRange(resourceLevels, 0), 91828);
  const assignmentRandomOrgWorkspacePairs = generateRandomPairsInRanges(computeIndexRange(roleLevels, 0).size * 2.0, computeIndexRange(roleLevels, 0), computeIndexRange(resourceLevels, 1), 726);
  const assignmentRandomOrgFolderPairs = generateRandomPairsInRanges(computeIndexRange(roleLevels, 0).size * 2.0, computeIndexRange(roleLevels, 0), computeIndexRange(resourceLevels, 2), 983349);
  const assignmentRandomOrgProjectPairs = generateRandomPairsInRanges(computeIndexRange(roleLevels, 0).size * 2.0, computeIndexRange(roleLevels, 0), computeIndexRange(resourceLevels, 3), 928);

  // Random assignments from resources to roles at the team role level
  const assignmentRandomTeamOrgPairs = generateRandomPairsInRanges(computeIndexRange(roleLevels, 1).size * 0.01, computeIndexRange(roleLevels, 1), computeIndexRange(resourceLevels, 0), 344);
  const assignmentRandomTeamWorkspacePairs = generateRandomPairsInRanges(computeIndexRange(roleLevels, 1).size * 1.0, computeIndexRange(roleLevels, 1), computeIndexRange(resourceLevels, 1), 6612);
  const assignmentRandomTeamFolderPairs = generateRandomPairsInRanges(computeIndexRange(roleLevels, 1).size * 5.0, computeIndexRange(roleLevels, 1), computeIndexRange(resourceLevels, 2), 87221);
  const assignmentRandomTeamProjectPairs = generateRandomPairsInRanges(computeIndexRange(roleLevels, 1).size * 5.0, computeIndexRange(roleLevels, 1), computeIndexRange(resourceLevels, 3), 1237);

  // Random assignments from resources to roles at the user role level
  const assignmentRandomUserOrgPairs = generateRandomPairsInRanges(computeIndexRange(roleLevels, 2).size * 0.01, computeIndexRange(roleLevels, 2), computeIndexRange(resourceLevels, 0), 1736);
  const assignmentRandomUserWorkspacePairs = generateRandomPairsInRanges(computeIndexRange(roleLevels, 2).size * 2.0, computeIndexRange(roleLevels, 2), computeIndexRange(resourceLevels, 1), 37628);
  const assignmentRandomUserFolderPairs = generateRandomPairsInRanges(computeIndexRange(roleLevels, 2).size * 5.0, computeIndexRange(roleLevels, 2), computeIndexRange(resourceLevels, 2), 3727267);
  const assignmentRandomUserProjectPairs = generateRandomPairsInRanges(computeIndexRange(roleLevels, 2).size * 5.0, computeIndexRange(roleLevels, 2), computeIndexRange(resourceLevels, 3), 218288);

  const assignmentSets: Array<{ pairs: Array<{ left: number, right: number }>, probability: number, seed: number }> = [
    { pairs: assignmentRegularOrgOrgPairs, probability: 0.3, seed: 27367181 },
    { pairs: assignmentRegularTeamWorkspacePairs, probability: 0.5, seed: 8374 },
    { pairs: assignmentRegularUserFolderPairs, probability: 0.7, seed: 15553 },
    { pairs: assignmentRandomOrgOrgPairs, probability: 0.3, seed: 43627829 },
    { pairs: assignmentRandomOrgWorkspacePairs, probability: 0.4, seed: 828734 },
    { pairs: assignmentRandomOrgFolderPairs, probability: 0.4, seed: 22651 },
    { pairs: assignmentRandomOrgProjectPairs, probability: 0.3, seed: 127647 },
    { pairs: assignmentRandomTeamOrgPairs, probability: 0.3, seed: 987394 },
    { pairs: assignmentRandomTeamWorkspacePairs, probability: 0.4, seed: 42123 },
    { pairs: assignmentRandomTeamFolderPairs, probability: 0.4, seed: 212131 },
    { pairs: assignmentRandomTeamProjectPairs, probability: 0.3, seed: 556455 },
    { pairs: assignmentRandomUserOrgPairs, probability: 0.5, seed: 8787867 },
    { pairs: assignmentRandomUserWorkspacePairs, probability: 0.4, seed: 7373737 },
    { pairs: assignmentRandomUserFolderPairs, probability: 0.4, seed: 3472497 },
    { pairs: assignmentRandomUserProjectPairs, probability: 0.4, seed: 4294797 },
  ];
  const totalAssignmentPairs = assignmentSets.reduce((total, { pairs }) => total + pairs.length, 0);

  logger.log("resourceNodes:", resourceTree.totalNodes);
  logger.log("resourceEdges:", resourceTree.totalEdges);
  logger.log("roleNodes:", roleTree.totalNodes);
  logger.log("roleEdges:", roleTree.totalEdges);
  logger.log("assignmentPairs:", totalAssignmentPairs);

  tick("data_gen_end");

  tick("insert_start");

  tick("disable_triggers_start");
  await exec(sql`
    select resource_trigger_disable();
    select role_trigger_disable();
    ${combineAssignmentsWith !== "none" ? sql`select assignment_trigger_disable();` : sql``}
  `);
  tick("disable_triggers_end");

  tick("resource_node_start");
  for (let batchStart = 0; batchStart < resourceTree.totalNodes; batchStart += NODE_BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + NODE_BATCH_SIZE - 1, resourceTree.totalNodes - 1);
    await exec(sql`INSERT INTO "resource_node" ("id") SELECT ${nodeIdFromSeries(sql`s`)} FROM generate_series(${literal(batchStart)}, ${literal(batchEnd)}) AS s`);
  }
  tick("resource_node_end");

  tick("resource_edge_start");
  for (let d = 1; d < resourceTree.levelInfo.length; d++) {
    const level = resourceTree.levelInfo[d]!;
    const parentLevel = resourceTree.levelInfo[d - 1]!;
    for (let batchOffset = 0; batchOffset < level.size; batchOffset += EDGE_BATCH_SIZE) {
      const batchEnd = Math.min(batchOffset + EDGE_BATCH_SIZE, level.size);
      await exec(sql`
        INSERT INTO "resource_edge" ("parent_id", "child_id", "permission") VALUES
        ${join(Array.from({ length: batchEnd - batchOffset }, (_, i) => {
          const k = batchOffset + i;
          const childId = level.start + k;
          const parentId = parentLevel.start + Math.floor(k / level.fanOut);
          return sql`(${nodeId(parentId)}, ${nodeId(childId)}, ${bitmap(0.8, -parentId)})`
        }), ",")}
      `);
    }
  }
  tick("resource_edge_end");

  tick("role_node_start");
  for (let batchStart = 0; batchStart < roleTree.totalNodes; batchStart += NODE_BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + NODE_BATCH_SIZE - 1, roleTree.totalNodes - 1);
    await exec(sql`INSERT INTO "role_node" ("id") SELECT ${nodeIdFromSeries(sql`s`)} FROM generate_series(${literal(batchStart)}, ${literal(batchEnd)}) AS s`);
  }
  tick("role_node_end");

  tick("role_edge_start");
  for (let d = 1; d < roleTree.levelInfo.length; d++) {
    const level = roleTree.levelInfo[d]!;
    const parentLevel = roleTree.levelInfo[d - 1]!;
    for (let batchOffset = 0; batchOffset < level.size; batchOffset += EDGE_BATCH_SIZE) {
      const batchEnd = Math.min(batchOffset + EDGE_BATCH_SIZE, level.size);
      await exec(sql`
        INSERT INTO "role_edge" ("parent_id", "child_id", "permission") VALUES
        ${join(Array.from({ length: batchEnd - batchOffset }, (_, i) => {
          const k = batchOffset + i;
          const childId = level.start + k;
          const parentId = parentLevel.start + Math.floor(k / level.fanOut);
          return sql`(${nodeId(parentId)}, ${nodeId(childId)}, ${bitmap(0.8, parentId)})`
        }), ",")}
      `);
    }
  }
  tick("role_edge_end");

  tick("assignment_edge_start");
  for (const { pairs, probability, seed } of assignmentSets) {
    for (let i = 0; i < pairs.length; i += ASSIGNMENT_BATCH_SIZE) {
      const batchEnd = Math.min(i + ASSIGNMENT_BATCH_SIZE, pairs.length);
      const deduped = new Map<string, SQL>();
      for (let j = i; j < batchEnd; j++) {
        const { left, right } = pairs[j]!;
        deduped.set(`${left}:${right}`, sql`(${nodeId(left)}, ${nodeId(right)}, ${bitmap(probability, j * seed)})`);
      }
      if (deduped.size > 0) {
        await exec(sql`
          INSERT INTO "assignment_edge" ("role_id", "resource_id", "permission")
          VALUES ${join(Array.from(deduped.values()), ",")}
          ON CONFLICT ON CONSTRAINT "assignment_edge_pkey"
          DO UPDATE SET "permission" = excluded."permission"
        `);
      }
    }
  }
  tick("assignment_edge_end");

  // Objects are spread round-robin over the resource tables, folders go to the folder table
  tick("business_rows_start");
  const objects = resourceTree.levelInfo[4]!;
  const folders = resourceTree.levelInfo[2]!;
  await exec(sql`
    ${join(resourceTables.map((table, index) => sql`
      insert into ${identifier(table)} ("name", "resource_id")
      select 'object ' || s, ${nodeIdFromSeries(sql`s`)}
      from generate_series(${raw(String(objects.start + index))}, ${raw(String(objects.start + objects.size - 1))}, ${raw(String(resourceTables.length))}) as s;
    `), "\n")}
    insert into "folder" ("name", "resource_id")
    select 'folder ' || s, ${nodeIdFromSeries(sql`s`)}
    from generate_series(${raw(String(folders.start))}, ${raw(String(folders.start + folders.size - 1))}) as s;
  `);
  tick("business_rows_end");

  tick("enable_triggers_start");
  await exec(sql`
    select resource_trigger_enable();
    select role_trigger_enable();
    ${combineAssignmentsWith !== "none" ? sql`select assignment_trigger_enable();` : sql``}
  `);
  tick("enable_triggers_end");

  tick("insert_end");

  tick("analyze_start");
  await exec(sql`analyze`);
  tick("analyze_end");

  const elapsed = (a: string, b: string) => (t[b]! - t[a]!) / 1000;

  const load = {
    schema: elapsed("schema_start", "schema_end"),
    dataGen: elapsed("data_gen_start", "data_gen_end"),
    insert: elapsed("insert_start", "insert_end"),
    disableTriggers: elapsed("disable_triggers_start", "disable_triggers_end"),
    resourceNode: elapsed("resource_node_start", "resource_node_end"),
    resourceEdge: elapsed("resource_edge_start", "resource_edge_end"),
    roleNode: elapsed("role_node_start", "role_node_end"),
    roleEdge: elapsed("role_edge_start", "role_edge_end"),
    assignmentEdge: elapsed("assignment_edge_start", "assignment_edge_end"),
    businessRows: elapsed("business_rows_start", "business_rows_end"),
    enableTriggers: elapsed("enable_triggers_start", "enable_triggers_end"),
    analyze: elapsed("analyze_start", "analyze_end"),
  };

  logger.log("Load timings (seconds):");
  logger.table(load);

  // Cache size
  const graphTables = ["resource_edge", "resource_edge_cache", "role_edge", "role_edge_cache", "assignment_edge", "assignment_edge_cache"];
  const [existingGraphTables] = await exec(sql`
    select "name" from unnest(array[${join(graphTables.map(table => literal(table)), ", ")}]) as "name"
    where to_regclass("name") is not null
  `);
  const cache: BenchmarkResult["cache"] = [];
  for (const table of graphTables.filter(table => existingGraphTables.some((row: { name: string }) => row.name === table))) {
    const [[row]] = await exec(sql`
      select
        (select count(*) from ${identifier(table)})::bigint as "rows",
        pg_total_relation_size(${literal(table)}::regclass)::bigint as "bytes"
    `);
    cache.push({ table, rows: Number(row.rows), bytes: Number(row.bytes) });
  }
  logger.table(cache);

  const random = createRandom(4242);
  const pick = (level: TreeLevelInfo) => level.start + random.int(level.size);
  const users = roleTree.levelInfo[2]!;

  // Reads, as the application database role going through RLS
  const readScenarios: Array<{ name: string, table: string, statement: () => SQL, counts?: boolean }> = [
    {
      name: "point lookup (object)",
      table: "post",
      statement: () => sql`select "id" from "post" where "resource_id" = ${nodeId(objects.start + resourceTables.length * random.int(Math.ceil(objects.size / resourceTables.length)))}`
    },
    { name: "first page of 50 (object)", table: "post", statement: () => sql`select "id", "name" from "post" order by "id" limit 50` },
    { name: "count visible (object)", table: "post", statement: () => sql`select count(*)::integer as "count" from "post"`, counts: true },
    { name: "count visible (folder)", table: "folder", statement: () => sql`select count(*)::integer as "count" from "folder"`, counts: true },
  ];

  const asUser = async (userId: number) => {
    await exec(sql`select set_config('jwt.claims.role_id', ${literal(idMode === "uuid" ? generateUuidFromInteger(userId) : String(userId))}, false)`);
    await exec(sql`set role ${identifier(database_user_username)}`);
  };
  const resetUser = () => exec(sql`reset role`);

  const reads: BenchmarkResult["reads"] = [];
  const plans: Record<string, string> = {};

  const measureReads = async (policy: "p9s" | "baseline", scenarioReps: number) => {
    for (const scenario of readScenarios) {
      const samples: number[] = [];
      let visibleRows = 0;
      for (let i = 0; i < warmup + scenarioReps; i++) {
        await asUser(pick(users));
        const statement = scenario.statement();
        const start = performance.now();
        const [rows] = await exec(statement);
        const duration = performance.now() - start;
        await resetUser();
        if (i >= warmup) {
          samples.push(duration);
          visibleRows += scenario.counts ? rows[0].count : 0;
        }
      }
      reads.push({
        name: scenario.name,
        policy,
        stats: computeStats(samples),
        ...(scenario.counts ? { meanVisibleRows: visibleRows / scenarioReps } : {})
      });
      await asUser(users.start);
      const [plan] = await exec(sql`explain (analyze, buffers) ${scenario.statement()}`);
      await resetUser();
      plans[`${policy}: ${scenario.name}`] = plan.map((row: Record<string, string>) => row["QUERY PLAN"]).join("\n");
    }
  };

  const visibleCounts = async () => {
    const counts: number[] = [];
    for (let k = 0; k < Math.min(users.size, 5); k++) {
      await asUser(users.start + k * Math.floor(users.size / 5));
      for (const table of ["post", "folder"]) {
        const [[{ count }]] = await exec(sql`select count(*)::integer as "count" from ${identifier(table)}`);
        counts.push(count);
      }
      await resetUser();
    }
    return counts;
  };

  await measureReads("p9s", reps);

  let baselineMatches: boolean | null = null;
  if (baseline) {
    const cachedCounts = await visibleCounts();
    // Same access rule as p9s, but walking both trees at query time instead of reading the caches
    const selectBit = (table: string) => table === "folder" ? 8 : 12 + 4 * resourceTables.indexOf(table);
    await exec(sql`
      ${join([...new Set(readScenarios.map(s => s.table))].map(table => sql`
        drop policy ${identifier(`${table}_${database_user_username}_select_policy`)} on ${identifier(table)};
        create policy ${identifier(`${table}_${database_user_username}_select_policy`)} on ${identifier(table)}
        as permissive for select to ${identifier(database_user_username)}
        using (exists (
          select 1
          from resource_edge_cache_parent_compute(${identifier(table)}."resource_id") "resource"
          join "assignment_edge" "assignment" on "assignment"."resource_id" = "resource"."parent_id"
          join role_edge_cache_parent_compute(current_role_id()) "role" on "role"."parent_id" = "assignment"."role_id"
          where ("resource"."permission" << ${raw(String(selectBit(table)))})::bit = b'1'
          and ("assignment"."permission" << ${raw(String(selectBit(table)))})::bit = b'1'
          and ("role"."permission" << ${raw(String(selectBit(table)))})::bit = b'1'
        ));
      `), "\n")}
    `);
    baselineMatches = Bun.deepEquals(cachedCounts, await visibleCounts());
    await measureReads("baseline", Math.max(3, Math.ceil(reps / 3)));
  }

  logger.table(reads.map(({ name, policy, stats, meanVisibleRows }) => ({ name, policy, p50: stats.p50, p95: stats.p95, meanVisibleRows })));

  // Incremental writes with triggers on, each one in a rolled back transaction so the dataset stays the same
  const sampledAssignments: Array<{ role_id: string | number, resource_id: string | number }> = (await exec(sql`
    select "role_id", "resource_id" from "assignment_edge"
    order by md5("role_id"::text || "resource_id"::text)
    limit ${raw(String(warmup + reps))}
  `))[0];
  const existingId = (value: string | number): SQL => idMode === "uuid" ? sql`${literal(String(value))}::uuid` : raw(String(value));
  const newNodeId = (tree: { totalNodes: number }) => nodeId(tree.totalNodes + 1000);

  const pickOtherParent = (level: TreeLevelInfo, parentLevel: TreeLevelInfo, child: number) => {
    const currentParent = parentLevel.start + Math.floor((child - level.start) / level.fanOut);
    const candidate = pick(parentLevel);
    return candidate === currentParent ? parentLevel.start + ((candidate - parentLevel.start + 1) % parentLevel.size) : candidate;
  };

  const writeScenarios: Array<{ name: string, statement: (i: number) => SQL }> = [];
  for (let d = 1; d < resourceTree.levelInfo.length; d++) {
    const level = resourceTree.levelInfo[d]!;
    const parentLevel = resourceTree.levelInfo[d - 1]!;
    const name = resourceLevelNames[d];
    writeScenarios.push(
      {
        name: `resource: add ${name}`,
        statement: () => sql`
          insert into "resource_node" ("id") values (${newNodeId(resourceTree)});
          insert into "resource_edge" ("parent_id", "child_id", "permission") values (${nodeId(pick(parentLevel))}, ${newNodeId(resourceTree)}, ${bitmap(0.8, 1)});
        `
      },
      {
        name: `resource: move ${name}`,
        statement: () => {
          const child = pick(level);
          return sql`update "resource_edge" set "parent_id" = ${nodeId(pickOtherParent(level, parentLevel, child))} where "child_id" = ${nodeId(child)}`;
        }
      },
      { name: `resource: detach ${name}`, statement: () => sql`delete from "resource_edge" where "child_id" = ${nodeId(pick(level))}` },
      { name: `resource: change ${name} edge bits`, statement: () => sql`update "resource_edge" set "permission" = ~"permission" where "child_id" = ${nodeId(pick(level))}` },
    );
  }
  for (let d = 0; d < resourceTree.levelInfo.length - 1; d++) {
    const level = resourceTree.levelInfo[d]!;
    writeScenarios.push({
      name: `assignment: share ${resourceLevelNames[d]} with user`,
      statement: () => sql`
        insert into "assignment_edge" ("role_id", "resource_id", "permission") values (${nodeId(pick(users))}, ${nodeId(pick(level))}, ${bitmap(0.5, 2)})
        on conflict do nothing
      `
    });
  }
  writeScenarios.push(
    {
      name: "assignment: revoke",
      statement: (i) => {
        const { role_id, resource_id } = sampledAssignments[i % sampledAssignments.length]!;
        return sql`delete from "assignment_edge" where "role_id" = ${existingId(role_id)} and "resource_id" = ${existingId(resource_id)}`;
      }
    },
    {
      name: "assignment: change bits",
      statement: (i) => {
        const { role_id, resource_id } = sampledAssignments[i % sampledAssignments.length]!;
        return sql`update "assignment_edge" set "permission" = ~"permission" where "role_id" = ${existingId(role_id)} and "resource_id" = ${existingId(resource_id)}`;
      }
    },
    {
      name: "role: add user to team",
      statement: () => sql`
        insert into "role_node" ("id") values (${newNodeId(roleTree)});
        insert into "role_edge" ("parent_id", "child_id", "permission") values (${nodeId(pick(roleTree.levelInfo[1]!))}, ${newNodeId(roleTree)}, ${bitmap(0.8, 3)});
      `
    },
    { name: "role: remove user from team", statement: () => sql`delete from "role_edge" where "child_id" = ${nodeId(pick(users))}` },
    {
      name: "role: move user to other team",
      statement: () => {
        const child = pick(users);
        return sql`update "role_edge" set "parent_id" = ${nodeId(pickOtherParent(users, roleTree.levelInfo[1]!, child))} where "child_id" = ${nodeId(child)}`;
      }
    },
    {
      name: "role: move team to other org",
      statement: () => {
        const teams = roleTree.levelInfo[1]!;
        const child = pick(teams);
        return sql`update "role_edge" set "parent_id" = ${nodeId(pickOtherParent(teams, roleTree.levelInfo[0]!, child))} where "child_id" = ${nodeId(child)}`;
      }
    },
  );

  const writes: BenchmarkResult["writes"] = [];
  for (const scenario of writeScenarios) {
    const samples: number[] = [];
    for (let i = 0; i < warmup + reps; i++) {
      const statement = scenario.statement(i);
      await exec(sql`begin`);
      const start = performance.now();
      await exec(statement);
      const duration = performance.now() - start;
      await exec(sql`rollback`);
      if (i >= warmup) {
        samples.push(duration);
      }
    }
    writes.push({ name: scenario.name, stats: computeStats(samples) });
  }

  logger.table(writes.map(({ name, stats }) => ({ name, p50: stats.p50, p95: stats.p95 })));

  logger.log("Total time (seconds):", (performance.now() - startTime) / 1000);

  return {
    options: { benchmarkSizeFactor, idMode, combineAssignmentsWith, reps, warmup, baseline },
    dataset: {
      resourceNodes: resourceTree.totalNodes,
      resourceEdges: resourceTree.totalEdges,
      roleNodes: roleTree.totalNodes,
      roleEdges: roleTree.totalEdges,
      assignmentPairs: totalAssignmentPairs,
      businessRows: objects.size + folders.size,
    },
    load,
    cache,
    reads,
    baselineMatches,
    writes,
    plans,
  };
}
