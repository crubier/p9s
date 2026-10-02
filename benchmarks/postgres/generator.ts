import { query as sql, join, identifier, literal, raw, compile, type SQL } from "pg-sql2";
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

export interface Connection {
  query: (query: { text: string, values?: any[] }) => Promise<any>;
  end: () => Promise<void>;
}

export interface Context {
  database_admin_username: string;
  database_user_username: string;
  runTestQuery: (query: SQL) => Promise<any>;
  exec: (query: SQL) => Promise<any>;
  // Extra connections as the admin user, for the concurrent scenarios. Absent on PGlite.
  connect?: () => Promise<Connection>;
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
  // Connections creating objects at the same time in the concurrent scenarios, 0 to skip them
  concurrency?: number;
  concurrencySeconds?: number;
  // Comments on each post, rows of a leaf table that take the permissions of their post, or nodes of the graph
  commentsPerPost?: number;
  comments?: CommentMode;
  logger?: typeof console;
}

export type CommentMode = "leaf" | "node";

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
  dataset: Record<"resourceNodes" | "resourceEdges" | "roleNodes" | "roleEdges" | "assignmentPairs" | "businessRows" | "comments", number>;
  // Seconds
  // Rows are the business rows of both trees, inserted with triggers disabled like edges and assignments
  load: Record<"schema" | "dataGen" | "insert" | "disableTriggers" | "resourceRows" | "resourceEdge" | "roleRows" | "roleEdge" | "assignmentEdge" | "commentRows" | "enableTriggers" | "analyze", number>;
  cache: Array<{ table: string, rows: number, bytes: number }>;
  // Milliseconds
  reads: Array<{ name: string, policy: "p9s" | "baseline", stats: Stats, meanVisibleRows?: number }>;
  // Whether the no-cache baseline shows every sampled user exactly the rows the p9s caches show, null when skipped
  baselineMatches: boolean | null;
  writes: Array<{ name: string, stats: Stats }>;
  // Committed transactions from several connections at once, latency in milliseconds per transaction
  concurrency: Array<{ name: string, clients: number, seconds: number, transactions: number, errors: number, throughput: number, stats: Stats, backgroundTransactions?: number }>;
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
  concurrency = 0,
  concurrencySeconds = 3,
  commentsPerPost = 4 * benchmarkSizeFactor,
  comments = "leaf",
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

  // Every node of both trees is a row of a business table, which points to its parent row through "parent_id"
  const idType = idMode === "uuid" ? sql`uuid` : sql`integer`;
  const groupTable = (name: string, parent: boolean, extra = sql``) => sql`
    drop table if exists ${identifier(name)} cascade;
    create table ${identifier(name)} (
      "id" uuid default uuid_generate_v4() primary key,
      "created_at" timestamptz default current_timestamp,
      "updated_at" timestamptz default current_timestamp,
      ${parent ? sql`"parent_id" ${idType},` : sql``}
      ${extra}
      "name" varchar(1024) not null
    );
    grant select, insert, update, delete on table ${identifier(name)} to ${identifier(database_user_username)};`;

  // Setup a simple datamodel
  await exec(sql`
    create extension if not exists "uuid-ossp";    

    ${groupTable("company", false)}
    ${groupTable("team", true)}
    ${groupTable("human_user", true, sql`"email" varchar(1024) unique not null,`)}
    ${groupTable("org", false)}
    ${groupTable("workspace", true)}
    ${groupTable("folder", true)}
    ${groupTable("project", true)}

    ${join(resourceTables.map(resourceTable => sql`
      drop table if exists ${identifier(resourceTable)} cascade;
      create table ${identifier(resourceTable)} (
        "id" uuid default uuid_generate_v4() primary key,
        "created_at" timestamptz default current_timestamp,
        "updated_at" timestamptz default current_timestamp,
        "parent_id" ${idType},
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

    drop table if exists "comment" cascade;
    create table "comment" (
      "id" uuid default uuid_generate_v4() primary key,
      "created_at" timestamptz default current_timestamp,
      "post_id" uuid references "post" ("id") on delete cascade,
      "author" uuid references "human_user"("id"),
      "body" varchar(1024) not null
    );
    create index on "comment" ("post_id");
    grant select, insert, update, delete on table "comment" to ${identifier(database_user_username)};
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
    tables: [
      { name: "company", isRole: true, roleId: "role_id" },
      { name: "team", isRole: true, roleId: "role_id", roleParent: { column: "parent_id" } },
      { name: "human_user", isRole: true, roleId: "role_id", roleParent: { column: "parent_id" } },
      { name: "org", isResource: true, resourceId: "resource_id" },
      { name: "workspace", isResource: true, resourceId: "resource_id", resourceParent: { column: "parent_id" } },
      { name: "project", isResource: true, resourceId: "resource_id", resourceParent: { column: "parent_id" } },
    {
      name: "folder",
      isResource: true,
      resourceId: "resource_id",
      resourceParent: { column: "parent_id" },
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
      resourceParent: { column: "parent_id" },
      permission: {
        [database_user_username]: {
          select: 12 + 4 * index,
          insert: 13 + 4 * index,
          update: 14 + 4 * index,
          delete: 15 + 4 * index
        }
      }
    })),
    {
      // With the bits of posts, so that a comment is visible exactly when its post is
      name: "comment",
      isResource: true,
      resourceId: "resource_id",
      resourceParent: { column: "post_id", table: "post", key: "id" },
      ...(comments === "leaf" ? { resourceLeaf: true } : {}),
      permission: {
        [database_user_username]: { select: 12, insert: 13, update: 14, delete: 15 }
      }
    }]
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
      "result_human_user" "human_user";
    begin
      insert into "human_user" ("email", "name") 
      values ("human_user_email", "human_user_email")
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
      "result_human_user" "human_user";
    begin
      insert into "human_user" ("email", "name") 
      values ("human_user_email", "human_user_email")
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

  // The rows of a tree level, or every step-th of them from an offset, each pointing to its parent row
  const insertLevelRows = async (table: string, idColumn: string, tree: ReturnType<typeof computeTreeLevelInfo>, depth: number, { offset = 0, step = 1, extra }: { offset?: number, step?: number, extra?: [SQL, SQL] } = {}) => {
    const level = tree.levelInfo[depth]!;
    const parentLevel = depth > 0 ? tree.levelInfo[depth - 1]! : null;
    const parent = parentLevel && nodeIdFromSeries(sql`(${raw(String(parentLevel.start))} + (s - ${raw(String(level.start))}) / ${raw(String(level.fanOut))})`);
    for (let batchStart = level.start + offset; batchStart < level.start + level.size; batchStart += NODE_BATCH_SIZE * step) {
      const batchEnd = Math.min(batchStart + NODE_BATCH_SIZE * step - 1, level.start + level.size - 1);
      await exec(sql`
        insert into ${identifier(table)} ("name", ${identifier(idColumn)}${parent ? sql`, "parent_id"` : sql``}${extra ? sql`, ${extra[0]}` : sql``})
        select ${literal(`${table} `)} || s, ${nodeIdFromSeries(sql`s`)}${parent ? sql`, ${parent}` : sql``}${extra ? sql`, ${extra[1]}` : sql``}
        from generate_series(${raw(String(batchStart))}, ${raw(String(batchEnd))}, ${raw(String(step))}) as s`);
    }
  };

  // Objects are spread round-robin over the resource tables
  tick("resource_rows_start");
  for (const [depth, table] of ["org", "workspace", "folder", "project"].entries()) {
    await insertLevelRows(table, "resource_id", resourceTree, depth);
  }
  for (const [index, table] of resourceTables.entries()) {
    await insertLevelRows(table, "resource_id", resourceTree, 4, { offset: index, step: resourceTables.length });
  }
  tick("resource_rows_end");

  tick("resource_edge_start");
  for (let d = 1; d < resourceTree.levelInfo.length; d++) {
    const level = resourceTree.levelInfo[d]!;
    const parentLevel = resourceTree.levelInfo[d - 1]!;
    for (let batchOffset = 0; batchOffset < level.size; batchOffset += EDGE_BATCH_SIZE) {
      const batchEnd = Math.min(batchOffset + EDGE_BATCH_SIZE, level.size);
      await exec(sql`
        INSERT INTO "resource_edge" ("parent_id", "child_id", "permission", "home") VALUES
        ${join(Array.from({ length: batchEnd - batchOffset }, (_, i) => {
          const k = batchOffset + i;
          const childId = level.start + k;
          const parentId = parentLevel.start + Math.floor(k / level.fanOut);
          return sql`(${nodeId(parentId)}, ${nodeId(childId)}, ${bitmap(0.8, -parentId)}, true)`
        }), ",")}
      `);
    }
  }
  tick("resource_edge_end");

  tick("role_rows_start");
  await insertLevelRows("company", "role_id", roleTree, 0);
  await insertLevelRows("team", "role_id", roleTree, 1);
  await insertLevelRows("human_user", "role_id", roleTree, 2, { extra: [sql`"email"`, sql`'user' || s || '@example.com'`] });
  tick("role_rows_end");

  tick("role_edge_start");
  for (let d = 1; d < roleTree.levelInfo.length; d++) {
    const level = roleTree.levelInfo[d]!;
    const parentLevel = roleTree.levelInfo[d - 1]!;
    for (let batchOffset = 0; batchOffset < level.size; batchOffset += EDGE_BATCH_SIZE) {
      const batchEnd = Math.min(batchOffset + EDGE_BATCH_SIZE, level.size);
      await exec(sql`
        INSERT INTO "role_edge" ("parent_id", "child_id", "permission", "home") VALUES
        ${join(Array.from({ length: batchEnd - batchOffset }, (_, i) => {
          const k = batchOffset + i;
          const childId = level.start + k;
          const parentId = parentLevel.start + Math.floor(k / level.fanOut);
          return sql`(${nodeId(parentId)}, ${nodeId(childId)}, ${bitmap(0.8, parentId)}, true)`
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

  const objects = resourceTree.levelInfo[4]!;
  const folders = resourceTree.levelInfo[2]!;

  // Rows created later take their ids from the p9s sequences, past the ones loaded here
  if (idMode === "integer") {
    await exec(sql`
      select setval('resource_id_seq', ${raw(String(resourceTree.totalNodes + 100000))});
      select setval('role_id_seq', ${raw(String(roleTree.totalNodes + 100000))});`);
  }

  // As nodes, comments get their home edge and cache rows when the triggers are enabled below
  tick("comment_rows_start");
  await exec(sql`
    insert into "comment" ("post_id", "body")
    select "post"."id", 'comment ' || s from "post", generate_series(1, ${raw(String(commentsPerPost))}) as s`);
  const [[{ count: commentCount }]] = await exec(sql`select count(*)::integer as "count" from "comment"`);
  tick("comment_rows_end");

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
    resourceRows: elapsed("resource_rows_start", "resource_rows_end"),
    resourceEdge: elapsed("resource_edge_start", "resource_edge_end"),
    roleRows: elapsed("role_rows_start", "role_rows_end"),
    roleEdge: elapsed("role_edge_start", "role_edge_end"),
    assignmentEdge: elapsed("assignment_edge_start", "assignment_edge_end"),
    commentRows: elapsed("comment_rows_start", "comment_rows_end"),
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

  const [sampledComments]: [Array<{ id: string, post_id: string }>] = await exec(sql`
    select "id", "post_id" from "comment" order by md5("id"::text) limit 1000`);
  // A random sequence of their own, so that the other scenarios pick the same nodes as without comments
  const commentRandom = createRandom(777);
  const pickComment = () => sampledComments[commentRandom.int(sampledComments.length)]!;
  const uuid = (value: string) => sql`${literal(value)}::uuid`;

  // Reads, as the application database role going through RLS. The baseline replaces the policies of node tables only.
  const readScenarios: Array<{ name: string, table: string, statement: () => SQL, counts?: boolean, baseline?: false }> = [
    {
      name: "point lookup (object)",
      table: "post",
      statement: () => sql`select "id" from "post" where "resource_id" = ${nodeId(objects.start + resourceTables.length * random.int(Math.ceil(objects.size / resourceTables.length)))}`
    },
    { name: "first page of 50 (object)", table: "post", statement: () => sql`select "id", "name" from "post" order by "id" limit 50` },
    { name: "count visible (object)", table: "post", statement: () => sql`select count(*)::integer as "count" from "post"`, counts: true },
    { name: "count visible (folder)", table: "folder", statement: () => sql`select count(*)::integer as "count" from "folder"`, counts: true },
    ...(sampledComments.length === 0 ? [] : [
      { name: "point lookup (comment)", table: "comment", statement: () => sql`select "id" from "comment" where "id" = ${uuid(pickComment().id)}`, baseline: false as const },
      { name: "comments of a post", table: "comment", statement: () => sql`select "id", "body" from "comment" where "post_id" = ${uuid(pickComment().post_id)} order by "created_at"`, baseline: false as const },
      { name: "first page of 50 (comment)", table: "comment", statement: () => sql`select "id", "body" from "comment" order by "id" limit 50`, baseline: false as const },
      { name: "count visible (comment)", table: "comment", statement: () => sql`select count(*)::integer as "count" from "comment"`, counts: true, baseline: false as const },
    ]),
  ];

  const asUser = async (userId: number) => {
    await exec(sql`select set_config('jwt.claims.role_id', ${literal(idMode === "uuid" ? generateUuidFromInteger(userId) : String(userId))}, false)`);
    await exec(sql`set role ${identifier(database_user_username)}`);
  };
  const resetUser = () => exec(sql`reset role`);

  const reads: BenchmarkResult["reads"] = [];
  const plans: Record<string, string> = {};

  const measureReads = async (policy: "p9s" | "baseline", scenarioReps: number) => {
    for (const scenario of readScenarios.filter(scenario => policy === "p9s" || scenario.baseline !== false)) {
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
    const baselineTables = [...new Set(readScenarios.filter(s => s.baseline !== false).map(s => s.table))];
    const selectPolicy = (table: string) => identifier(`${table}_${database_user_username}_select_policy`);
    const [p9sPolicies]: [Array<{ tablename: string, qual: string }>] = await exec(sql`
      select "tablename", "qual" from pg_policies
      where "policyname" in (${join(baselineTables.map(table => literal(`${table}_${database_user_username}_select_policy`)), ", ")})
    `);
    await exec(sql`
      ${join(baselineTables.map(table => sql`
        drop policy ${selectPolicy(table)} on ${identifier(table)};
        create policy ${selectPolicy(table)} on ${identifier(table)}
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
    // Updates and deletes also go through the select policies, so the writes below need the p9s ones back
    await exec(sql`
      ${join(p9sPolicies.map(({ tablename, qual }) => sql`
        drop policy ${selectPolicy(tablename)} on ${identifier(tablename)};
        create policy ${selectPolicy(tablename)} on ${identifier(tablename)}
        as permissive for select to ${identifier(database_user_username)}
        using (${raw(qual)});
      `), "\n")}
    `);
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

  // The table holding a node, and a write of its parent column, which p9s follows with the home edge
  const resourceTableOf = (depth: number, node: number) => depth < 4
    ? ["org", "workspace", "folder", "project"][depth]!
    : resourceTables[(node - resourceTree.levelInfo[4]!.start) % resourceTables.length]!;
  const roleTableOf = (depth: number) => ["company", "team", "human_user"][depth]!;
  const setParent = (table: string, idColumn: string, node: number, parent: number | null) =>
    sql`update ${identifier(table)} set "parent_id" = ${parent === null ? sql`null` : nodeId(parent)} where ${identifier(idColumn)} = ${nodeId(node)}`;

  const writeScenarios: Array<{ name: string, statement: (i: number) => SQL }> = [];
  for (let d = 1; d < resourceTree.levelInfo.length; d++) {
    const level = resourceTree.levelInfo[d]!;
    const parentLevel = resourceTree.levelInfo[d - 1]!;
    const name = resourceLevelNames[d];
    writeScenarios.push(
      {
        name: `resource: add ${name}`,
        statement: () => sql`
          insert into ${identifier(resourceTableOf(d, level.start))} ("name", "resource_id", "parent_id") values ('new', ${newNodeId(resourceTree)}, ${nodeId(pick(parentLevel))})`
      },
      {
        name: `resource: move ${name}`,
        statement: () => {
          const child = pick(level);
          return setParent(resourceTableOf(d, child), "resource_id", child, pickOtherParent(level, parentLevel, child));
        }
      },
      {
        name: `resource: detach ${name}`,
        statement: () => {
          const child = pick(level);
          return setParent(resourceTableOf(d, child), "resource_id", child, null);
        }
      },
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
        insert into "human_user" ("name", "email", "role_id", "parent_id") values ('new', 'new@example.com', ${newNodeId(roleTree)}, ${nodeId(pick(roleTree.levelInfo[1]!))})`
    },
    { name: "role: remove user from team", statement: () => setParent(roleTableOf(2), "role_id", pick(users), null) },
    {
      name: "role: move user to other team",
      statement: () => {
        const child = pick(users);
        return setParent(roleTableOf(2), "role_id", child, pickOtherParent(users, roleTree.levelInfo[1]!, child));
      }
    },
    {
      name: "role: move team to other org",
      statement: () => {
        const teams = roleTree.levelInfo[1]!;
        const child = pick(teams);
        return setParent(roleTableOf(1), "role_id", child, pickOtherParent(teams, roleTree.levelInfo[0]!, child));
      }
    },
  );

  const writes: BenchmarkResult["writes"] = [];
  // A scenario can prepare rows untimed in the same transaction, before its timed statement
  const measureWrites = async (scenarios: Array<{ name: string, statement: (i: number) => SQL | { setup: SQL, statement: SQL } }>) => {
    for (const scenario of scenarios) {
      const samples: number[] = [];
      for (let i = 0; i < warmup + reps; i++) {
        const prepared = scenario.statement(i);
        const { setup, statement } = "setup" in prepared ? prepared : { setup: null, statement: prepared };
        await exec(sql`begin`);
        if (setup) await exec(setup);
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
  };
  await measureWrites(writeScenarios);

  // Business-row writes, the way an application creates, moves and deletes its rows. The application user acts as a
  // role assigned all bits on a few projects and folders spread over the tree, which it can then write. Objects are
  // created untimed under those projects for the scenarios that move or delete one. The role has only a few
  // assignments because the policies of updates and deletes enumerate every resource the user can see.
  const ones = raw(`~b'0'::bit(${bitmapSize})`);
  const orgs = resourceTree.levelInfo[0]!;
  const workspaces = resourceTree.levelInfo[1]!;
  const projects = resourceTree.levelInfo[3]!;
  const appRole = roleTree.totalNodes + 2000;
  const spread = (level: TreeLevelInfo, count: number) =>
    [...new Set(Array.from({ length: Math.min(count, level.size) }, (_, k) => level.start + Math.floor(k * level.size / Math.min(count, level.size))))];
  const writableProjects = spread(projects, 32);
  const writableFolders = spread(folders, 4);
  await exec(sql`
    insert into "human_user" ("name", "email", "role_id") values ('app', 'app@example.com', ${nodeId(appRole)});
    insert into "assignment_edge" ("role_id", "resource_id", "permission") values
    ${join([...writableProjects, ...writableFolders].map(resource => sql`(${nodeId(appRole)}, ${nodeId(resource)}, ${ones})`), ", ")};
  `);

  const pickFrom = (items: number[]) => items[random.int(items.length)]!;
  let nextObject = resourceTree.totalNodes + 10000;
  const freshObject = () => nextObject++;
  const asApp = sql`
    set local role ${identifier(database_user_username)};
    select set_config('jwt.claims.role_id', ${raw(`'${idMode === "uuid" ? generateUuidFromInteger(appRole) : appRole}'`)}, true);`;
  const ids = (items: number[]) => join(items.map(nodeId), ", ");

  // How each business-row write reaches the permission graph: the application user writes the row, and p9s keeps
  // its node and home edge in sync
  const rowWrites = {
    createObjects: (rows: Array<{ parent: number, object: number }>) => sql`
      ${asApp}
      insert into "post" ("name", "resource_id", "parent_id") values ${join(rows.map(({ parent, object }) => sql`('new object', ${nodeId(object)}, ${nodeId(parent)})`), ", ")};
      reset role;`,
    // As the backend: the application user has no permission on a row without parent
    createParentlessObject: (object: number) => sql`
      insert into "post" ("name", "resource_id") values ('new object', ${nodeId(object)});`,
    moveObject: (object: number, parent: number) => sql`${setParent("post", "resource_id", object, parent)};`,
    moveObjectAsApp: (object: number, parent: number) => sql`
      ${asApp}
      ${setParent("post", "resource_id", object, parent)};
      reset role;`,
    renameObject: (object: number) => sql`
      ${asApp}
      update "post" set "name" = 'renamed object' where "resource_id" = ${nodeId(object)};
      reset role;`,
    deleteRows: (table: string, rows: number[]) => sql`
      ${asApp}
      delete from ${identifier(table)} where "resource_id" in (${ids(rows)});
      reset role;`,
    moveWorkspace: (workspace: number, org: number) => sql`${setParent("workspace", "resource_id", workspace, org)};`,
  };

  // Row level security filters rows out silently, so each write is first checked to change what it claims to
  const verify = async (label: string, setup: SQL, statement: SQL, check: SQL) => {
    await exec(sql`begin`);
    try {
      await exec(setup);
      await exec(statement);
      const [[{ ok }]] = await exec(sql`select (${check}) as "ok"`);
      if (!ok) throw new Error(`Benchmark scenario "${label}" did not change the rows it should`);
    } finally {
      await exec(sql`rollback`);
    }
  };
  const cached = (parent: number, child: number) => sql`exists (select 1 from "resource_edge_cache" where "parent_id" = ${nodeId(parent)} and "child_id" = ${nodeId(child)})`;
  const postExists = (object: number) => sql`exists (select 1 from "post" where "resource_id" = ${nodeId(object)})`;
  const BULK_ROWS = 1000;
  const freshObjects = (count: number) => Array.from({ length: count }, () => ({ parent: pickFrom(writableProjects), object: freshObject() }));
  const otherProject = (parent: number) => writableProjects[(writableProjects.indexOf(parent) + 1) % writableProjects.length]!;
  {
    const [created] = freshObjects(1);
    const { parent, object } = created!;
    const target = otherProject(parent);
    await verify("create object", sql``, rowWrites.createObjects([created!]), sql`${postExists(object)} and ${cached(parent, object)}`);
    await verify("move object", rowWrites.createObjects([created!]), rowWrites.moveObject(object, target), sql`${cached(target, object)} and not ${cached(parent, object)}`);
    await verify("move object as app", rowWrites.createObjects([created!]), rowWrites.moveObjectAsApp(object, target), sql`${cached(target, object)} and not ${cached(parent, object)}`);
    await verify("rename object", rowWrites.createObjects([created!]), rowWrites.renameObject(object), sql`(select "name" from "post" where "resource_id" = ${nodeId(object)}) = 'renamed object'`);
    await verify("delete object", rowWrites.createObjects([created!]), rowWrites.deleteRows("post", [object]), sql`not ${postExists(object)} and not ${cached(object, object)}`);
    const parentless = freshObject();
    await verify("create parentless object", sql``, rowWrites.createParentlessObject(parentless), sql`${postExists(parentless)} and ${cached(parentless, parentless)}`);
    const folder = writableFolders[0]!;
    await verify("delete folder", sql``, rowWrites.deleteRows("folder", [folder]),
      sql`not exists (select 1 from "folder" where "resource_id" = ${nodeId(folder)}) and not exists (select 1 from "resource_edge_cache" where "parent_id" = ${nodeId(folder)})`);
  }

  const withObjects = (count: number, statement: (rows: Array<{ parent: number, object: number }>) => SQL) => () => {
    const rows = freshObjects(count);
    return { setup: rowWrites.createObjects(rows), statement: statement(rows) };
  };
  await measureWrites([
    { name: "row: create object in project", statement: () => rowWrites.createObjects(freshObjects(1)) },
    { name: `row: create ${BULK_ROWS} objects in one statement`, statement: () => rowWrites.createObjects(freshObjects(BULK_ROWS)) },
    { name: "row: create parentless object", statement: () => rowWrites.createParentlessObject(freshObject()) },
    { name: "row: move object to other project", statement: withObjects(1, ([row]) => rowWrites.moveObject(row!.object, otherProject(row!.parent))) },
    { name: "row: move object to other project as app user", statement: withObjects(1, ([row]) => rowWrites.moveObjectAsApp(row!.object, otherProject(row!.parent))) },
    { name: "row: update object without graph change", statement: withObjects(1, ([row]) => rowWrites.renameObject(row!.object)) },
    { name: "row: delete object", statement: withObjects(1, ([row]) => rowWrites.deleteRows("post", [row!.object])) },
    { name: `row: delete ${BULK_ROWS} objects in one statement`, statement: withObjects(BULK_ROWS, rows => rowWrites.deleteRows("post", rows.map(({ object }) => object))) },
    { name: "row: delete folder", statement: () => rowWrites.deleteRows("folder", [pickFrom(writableFolders)]) },
  ]);

  // Comments on the posts the application user can write: the loaded edges have random bits, so only some posts of its
  // projects keep every post bit. As leaves, writing a comment never touches the graph.
  const [writablePosts]: [Array<{ id: string }>] = await exec(sql`
    select "post"."id" from "post"
    join "resource_edge_cache" on "resource_edge_cache"."child_id" = "post"."resource_id"
    where "resource_edge_cache"."parent_id" in (${ids(writableProjects)})
    and ("resource_edge_cache"."permission" << 12)::bit(4) = b'1111'
    order by "post"."id"`);
  const [writableComments]: [Array<{ id: string, post_id: string }>] = writablePosts.length < 2 ? [[]] : await exec(sql`
    select "id", "post_id" from "comment" where "post_id" in (${join(writablePosts.map(({ id }) => uuid(id)), ", ")})
    order by md5("id"::text) limit ${raw(String(warmup + reps))}`);
  const commentWrites = {
    create: (post: string) => sql`
      ${asApp}
      insert into "comment" ("post_id", "body") values (${uuid(post)}, 'new comment');
      reset role;`,
    createMany: (post: string) => sql`
      insert into "comment" ("post_id", "body") select ${uuid(post)}, 'new comment' from generate_series(1, ${raw(String(BULK_ROWS))});`,
    edit: (comment: string) => sql`
      ${asApp}
      update "comment" set "body" = 'edited comment' where "id" = ${uuid(comment)};
      reset role;`,
    move: (comment: string, post: string) => sql`
      ${asApp}
      update "comment" set "post_id" = ${uuid(post)} where "id" = ${uuid(comment)};
      reset role;`,
    delete: (comment: string) => sql`
      ${asApp}
      delete from "comment" where "id" = ${uuid(comment)};
      reset role;`,
    deletePost: (post: string) => sql`delete from "post" where "id" = ${uuid(post)};`,
  };
  const otherPost = (post: string) => writablePosts[(writablePosts.findIndex(({ id }) => id === post) + 1) % writablePosts.length]!.id;
  if (writableComments.length > 0) {
    const [{ id: comment, post_id: post }] = writableComments as [{ id: string, post_id: string }];
    const commentWhere = (condition: SQL) => sql`exists (select 1 from "comment" where "id" = ${uuid(comment)} and ${condition})`;
    await verify("create comment", sql``, commentWrites.create(post), sql`(select count(*) from "comment" where "body" = 'new comment') = 1`);
    await verify("edit comment", sql``, commentWrites.edit(comment), commentWhere(sql`"body" = 'edited comment'`));
    await verify("move comment", sql``, commentWrites.move(comment, otherPost(post)), commentWhere(sql`"post_id" = ${uuid(otherPost(post))}`));
    await verify("delete comment", sql``, commentWrites.delete(comment), sql`not exists (select 1 from "comment" where "id" = ${uuid(comment)})`);
    const sampled = (i: number) => writableComments[i % writableComments.length]!;
    await measureWrites([
      { name: "comment: create comment on post", statement: (i) => commentWrites.create(sampled(i).post_id) },
      { name: `comment: create ${BULK_ROWS} comments in one statement`, statement: (i) => commentWrites.createMany(sampled(i).post_id) },
      { name: "comment: edit comment", statement: (i) => commentWrites.edit(sampled(i).id) },
      { name: "comment: move comment to other post", statement: (i) => commentWrites.move(sampled(i).id, otherPost(sampled(i).post_id)) },
      { name: "comment: delete comment", statement: (i) => commentWrites.delete(sampled(i).id) },
      { name: `comment: delete post with its ${commentsPerPost} comments`, statement: (i) => commentWrites.deletePost(sampled(i).post_id) },
    ]);
  }

  logger.table(writes.map(({ name, stats }) => ({ name, p50: stats.p50, p95: stats.p95 })));

  // Several connections committing at once. Graph writes wait on each other, so this measures throughput under the
  // graph lock, with and without a long graph write competing for it.
  const concurrent: BenchmarkResult["concurrency"] = [];
  if (concurrency > 0 && context.connect && writableProjects.length > 1) {
    const run = async (name: string, transaction: () => SQL, background?: (i: number) => SQL) => {
      const connections = await Promise.all(Array.from({ length: concurrency + (background ? 1 : 0) }, () => context.connect!()));
      const deadline = performance.now() + concurrencySeconds * 1000;
      const samples: number[] = [];
      let errors = 0;
      let backgroundTransactions = 0;
      const loop = async (connection: Connection, statement: (i: number) => SQL, record: boolean) => {
        for (let i = 0; performance.now() < deadline; i++) {
          const start = performance.now();
          try {
            await connection.query(compile(sql`begin; ${statement(i)} commit;`));
            if (record) samples.push(performance.now() - start); else backgroundTransactions++;
          } catch (error) {
            if (errors++ === 0) console.warn(`${name}: ${(error as Error).message}`);
            await connection.query({ text: "rollback", values: [] });
          }
        }
      };
      try {
        await Promise.all(connections.map((connection, index) => index < concurrency
          ? loop(connection, transaction, true)
          : loop(connection, background!, false)));
      } finally {
        await Promise.all(connections.map(connection => connection.end()));
      }
      concurrent.push({
        name,
        clients: concurrency,
        seconds: concurrencySeconds,
        transactions: samples.length,
        errors,
        throughput: samples.length / concurrencySeconds,
        stats: computeStats(samples.length > 0 ? samples : [0]),
        ...(background ? { backgroundTransactions } : {}),
      });
    };
    const createInProject = () => rowWrites.createObjects([{ parent: pickFrom(writableProjects), object: freshObject() }]);
    await run("create object in project", createInProject);
    await run("create parentless object", () => rowWrites.createParentlessObject(freshObject()));
    await run("create object in project, while a graph writer moves a workspace", createInProject,
      i => rowWrites.moveWorkspace(workspaces.start, orgs.start + (i % 2 === 0 ? 1 : 0)));
    if (writableComments.length > 0) {
      const createComment = () => commentWrites.create(writablePosts[random.int(writablePosts.length)]!.id);
      await run("create comment on post", createComment);
      await run("create comment on post, while a graph writer moves a workspace", createComment,
        i => rowWrites.moveWorkspace(workspaces.start, orgs.start + (i % 2 === 0 ? 1 : 0)));
    }
    logger.table(concurrent.map(({ name, transactions, errors, throughput, stats }) => ({ name, transactions, errors, throughput, p50: stats.p50, p99: stats.p99 })));
  }

  logger.log("Total time (seconds):", (performance.now() - startTime) / 1000);

  return {
    options: { benchmarkSizeFactor, idMode, combineAssignmentsWith, reps, warmup, baseline, concurrency, concurrencySeconds, commentsPerPost, comments },
    dataset: {
      resourceNodes: resourceTree.totalNodes,
      resourceEdges: resourceTree.totalEdges,
      roleNodes: roleTree.totalNodes,
      roleEdges: roleTree.totalEdges,
      assignmentPairs: totalAssignmentPairs,
      businessRows: resourceTree.totalNodes + roleTree.totalNodes + commentCount,
      comments: commentCount,
    },
    load,
    cache,
    reads,
    baselineMatches,
    writes,
    concurrency: concurrent,
    plans,
  };
}
