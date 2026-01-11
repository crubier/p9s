
import { query as sql, join, identifier, literal, type SQL } from "pg-sql2";
import { createMigration } from '@p9s/postgres'
import { computeIndexRange, computeProduct, enumerateTreeNodesAndEdgesBreadthFirst, generateRandomBitmap, generateRandomPairsInRanges, generateRegularPairsInRanges, generateUuidFromInteger } from '@p9s/core-testing'

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

export const nullConsole = {
  ...console,
  log: () => { },
  time: () => { },
  timeEnd: () => { },
};

export interface Context {
  database_admin_username: string;
  database_user_username: string;
  runTestQuery: (query: SQL) => Promise<any>;
  exec: (query: SQL) => Promise<any>;
}

export async function runPostgresBenchmark(context: Context, { benchmarkSizeFactor = 5, idMode = "uuid", logger = nullConsole }: { benchmarkSizeFactor?: number, idMode?: "integer" | "uuid", logger?: typeof console }) {
  const startTime = performance.now();

  const { database_admin_username, database_user_username, runTestQuery, exec } = context;

  const resourceTables = ["post", "image", "article", "drone", "mission", "site", "structure", "alert", "dock", "vps", "model", "compressor", "encabulator", "memristor", "processor", "rotator", "translator", "mercator"]
  const bitmapSize = 4 * resourceTables.length + 12;


  const resourceLevels = [benchmarkSizeFactor /* orgs */, benchmarkSizeFactor /* workspaces per org */, benchmarkSizeFactor /* folders per workspace */, benchmarkSizeFactor /* projects per folder */, benchmarkSizeFactor /* objects per project */];
  const roleLevels = [benchmarkSizeFactor /* orgs */, benchmarkSizeFactor /* teams per org */, benchmarkSizeFactor /* users per team */];

  logger.log("Number of resources: ", computeProduct(resourceLevels));
  logger.log("Number of roles: ", computeProduct(roleLevels));

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
      }
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

  // Regular hierarchy of resources and roles
  const { nodes: resourceNodes, edges: resourceEdges } = enumerateTreeNodesAndEdgesBreadthFirst(resourceLevels);
  const { nodes: roleNodes, edges: roleEdges } = enumerateTreeNodesAndEdgesBreadthFirst(roleLevels);

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


  logger.log("resourceNodes.length", resourceNodes.length);
  logger.log("resourceEdges.length", resourceEdges.length);
  logger.log("roleNodes.length", roleNodes.length);
  logger.log("roleEdges.length", roleEdges.length);
  logger.log("assignmentRegularOrgOrgPairs.length", assignmentRegularOrgOrgPairs.length);
  logger.log("assignmentRegularTeamWorkspacePairs.length", assignmentRegularTeamWorkspacePairs.length);
  logger.log("assignmentRegularUserFolderPairs.length", assignmentRegularUserFolderPairs.length);
  logger.log("assignmentRandomOrgOrgPairs.length", assignmentRandomOrgOrgPairs.length);
  logger.log("assignmentRandomOrgWorkspacePairs.length", assignmentRandomOrgWorkspacePairs.length);
  logger.log("assignmentRandomOrgFolderPairs.length", assignmentRandomOrgFolderPairs.length);
  logger.log("assignmentRandomOrgProjectPairs.length", assignmentRandomOrgProjectPairs.length);
  logger.log("assignmentRandomTeamOrgPairs.length", assignmentRandomTeamOrgPairs.length);
  logger.log("assignmentRandomTeamWorkspacePairs.length", assignmentRandomTeamWorkspacePairs.length);
  logger.log("assignmentRandomTeamFolderPairs.length", assignmentRandomTeamFolderPairs.length);
  logger.log("assignmentRandomTeamProjectPairs.length", assignmentRandomTeamProjectPairs.length);
  logger.log("assignmentRandomUserOrgPairs.length", assignmentRandomUserOrgPairs.length);
  logger.log("assignmentRandomUserWorkspacePairs.length", assignmentRandomUserWorkspacePairs.length);
  logger.log("assignmentRandomUserFolderPairs.length", assignmentRandomUserFolderPairs.length);
  logger.log("assignmentRandomUserProjectPairs.length", assignmentRandomUserProjectPairs.length);
  logger.log("assignmentEdge.length",
    assignmentRegularOrgOrgPairs.length +
    assignmentRegularTeamWorkspacePairs.length +
    assignmentRegularUserFolderPairs.length +
    assignmentRandomOrgOrgPairs.length +
    assignmentRandomOrgWorkspacePairs.length +
    assignmentRandomOrgFolderPairs.length +
    assignmentRandomOrgProjectPairs.length +
    assignmentRandomTeamOrgPairs.length +
    assignmentRandomTeamWorkspacePairs.length +
    assignmentRandomTeamFolderPairs.length +
    assignmentRandomTeamProjectPairs.length +
    assignmentRandomUserOrgPairs.length +
    assignmentRandomUserWorkspacePairs.length +
    assignmentRandomUserFolderPairs.length +
    assignmentRandomUserProjectPairs.length
  );

  logger.time("inserting");

  logger.time("disable triggers");
  await exec(sql`
    select resource_trigger_disable();
    select role_trigger_disable();
  `);
  logger.timeEnd("disable triggers");

  logger.time("resource_node");
  logger.log("resourceNodes.length", resourceNodes.length);
  await exec(sql`
    insert into "resource_node" ("id") values
      ${join(resourceNodes.map((node) => {
    return idMode === "uuid"
      ? sql`(${literal(generateUuidFromInteger(node.id))}::uuid)`
      : sql`(${literal(node.id)})`
  }), ",")};
  `);
  logger.timeEnd("resource_node");

  logger.time("resource_edge");
  logger.log("resourceEdges.length", resourceEdges.length);
  await exec(sql`
  insert into "resource_edge" ("parent_id", "child_id", "permission") values
  ${join(resourceEdges.map((edge) => {
    return idMode === "uuid"
      ? sql`(${literal(generateUuidFromInteger(edge.parent))}::uuid, ${literal(generateUuidFromInteger(edge.child))}::uuid, b${literal(generateRandomBitmap(bitmapSize, 0.8, -edge.parent))}::bit(${literal(bitmapSize)}))`
      : sql`(${literal(edge.parent)}, ${literal(edge.child)}, b${literal(generateRandomBitmap(bitmapSize, 0.8, -edge.parent))}::bit(${literal(bitmapSize)}))`
  }), ",\n")};
`);
  logger.timeEnd("resource_edge");

  logger.time("role_node");
  logger.log("roleNodes.length", roleNodes.length);
  await exec(sql`
    insert into "role_node" ("id") values
      ${join(roleNodes.map((node) => {
    return idMode === "uuid"
      ? sql`(${literal(generateUuidFromInteger(node.id))}::uuid)`
      : sql`(${literal(node.id)})`
  }), ",")};
  `);
  logger.timeEnd("role_node");

  logger.time("role_edge");
  logger.log("roleEdges.length", roleEdges.length);
  await exec(sql`
  insert into "role_edge" ("parent_id", "child_id", "permission") values
  ${join(roleEdges.map((edge) => {
    return idMode === "uuid"
      ? sql`(${literal(generateUuidFromInteger(edge.parent))}::uuid, ${literal(generateUuidFromInteger(edge.child))}::uuid, b${literal(generateRandomBitmap(bitmapSize, 0.8, edge.parent))}::bit(${literal(bitmapSize)}))`
      : sql`(${literal(edge.parent)}, ${literal(edge.child)}, b${literal(generateRandomBitmap(bitmapSize, 0.8, edge.parent))}::bit(${literal(bitmapSize)}))`
  }), ",\n")};
`);
  logger.timeEnd("role_edge");

  logger.time("assignment_edge");
  logger.log("assignment_edge.length",
    assignmentRegularOrgOrgPairs.length +
    assignmentRegularTeamWorkspacePairs.length +
    assignmentRegularUserFolderPairs.length +
    assignmentRandomOrgOrgPairs.length +
    assignmentRandomOrgWorkspacePairs.length +
    assignmentRandomOrgFolderPairs.length +
    assignmentRandomOrgProjectPairs.length +
    assignmentRandomTeamOrgPairs.length +
    assignmentRandomTeamWorkspacePairs.length +
    assignmentRandomTeamFolderPairs.length +
    assignmentRandomTeamProjectPairs.length +
    assignmentRandomUserOrgPairs.length +
    assignmentRandomUserWorkspacePairs.length +
    assignmentRandomUserFolderPairs.length +
    assignmentRandomUserProjectPairs.length
  );

  const makeAssignmentRow = ({ left, right }: { left: number, right: number }, index: number, probability: number, seed: number) => {
    return idMode === "uuid"
      ? sql`(${literal(generateUuidFromInteger(left))}::uuid, ${literal(generateUuidFromInteger(right))}::uuid, b${literal(generateRandomBitmap(bitmapSize, probability, index * seed))}::bit(${literal(bitmapSize)}))`
      : sql`(${literal(left)}, ${literal(right)}, b${literal(generateRandomBitmap(bitmapSize, probability, index * seed))}::bit(${literal(bitmapSize)}))`
  };

  await runTestQuery(sql`
    with "deduped" as (
    select distinct on ("role_id", "resource_id") "role_id", "resource_id", "permission"
    from (values
    ${join(
    [

      ...assignmentRegularOrgOrgPairs.map((pair, index) => makeAssignmentRow(pair, index, 0.3, 27367181)),
      ...assignmentRegularTeamWorkspacePairs.map((pair, index) => makeAssignmentRow(pair, index, 0.5, 8374)),
      ...assignmentRegularUserFolderPairs.map((pair, index) => makeAssignmentRow(pair, index, 0.7, 15553)),

      ...assignmentRandomOrgOrgPairs.map((pair, index) => makeAssignmentRow(pair, index, 0.3, 43627829)),
      ...assignmentRandomOrgWorkspacePairs.map((pair, index) => makeAssignmentRow(pair, index, 0.4, 828734)),
      ...assignmentRandomOrgFolderPairs.map((pair, index) => makeAssignmentRow(pair, index, 0.4, 22651)),
      ...assignmentRandomOrgProjectPairs.map((pair, index) => makeAssignmentRow(pair, index, 0.3, 127647)),

      ...assignmentRandomTeamOrgPairs.map((pair, index) => makeAssignmentRow(pair, index, 0.3, 987394)),
      ...assignmentRandomTeamWorkspacePairs.map((pair, index) => makeAssignmentRow(pair, index, 0.4, 42123)),
      ...assignmentRandomTeamFolderPairs.map((pair, index) => makeAssignmentRow(pair, index, 0.4, 212131)),
      ...assignmentRandomTeamProjectPairs.map((pair, index) => makeAssignmentRow(pair, index, 0.3, 556455)),

      ...assignmentRandomUserOrgPairs.map((pair, index) => makeAssignmentRow(pair, index, 0.5, 8787867)),
      ...assignmentRandomUserWorkspacePairs.map((pair, index) => makeAssignmentRow(pair, index, 0.4, 7373737)),
      ...assignmentRandomUserFolderPairs.map((pair, index) => makeAssignmentRow(pair, index, 0.4, 3472497)),
      ...assignmentRandomUserProjectPairs.map((pair, index) => makeAssignmentRow(pair, index, 0.4, 4294797)),
    ]

    , ",\n")}
    )
    as t("role_id", "resource_id", "permission")
    )
    insert into "assignment_edge" ("role_id", "resource_id", "permission")
    select "role_id", "resource_id", "permission" from deduped
    on conflict on constraint "assignment_edge_pkey"
    do update set "permission" = excluded."permission";
    ;
  `);
  logger.timeEnd("assignment_edge");

  logger.time("enable triggers");
  await exec(sql`
    select resource_trigger_enable();
    select role_trigger_enable();
  `);
  logger.timeEnd("enable triggers");

  logger.timeEnd("inserting");

  logger.log(await runTestQuery(sql`select count(*) from "resource_edge_cache"; `));

  const totalTime = performance.now() - startTime;
  logger.log(`Total benchmark time: ${totalTime.toFixed(2)}ms`);

  return { totalTime };
}