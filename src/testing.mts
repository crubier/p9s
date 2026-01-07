import { beforeEach, afterEach } from 'bun:test'
import { type QueryResult, type Client } from "pg";
import { compile, SQL, query as sql, literal, identifier } from "pg-sql2";
import { native as pgNative } from 'pg';
import type pg from 'pg';

export const generateRandomString = (length: number): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * chars.length);
    result += chars[randomIndex];
  }
  return result;
};

export const orderByIdChildParent = <ID extends any, T extends { id?: ID, child_id?: ID, parent_id?: ID, resource_id?: ID, role_id?: ID }>(a: T, b: T): -1 | 0 | 1 => {
  // First sort by id
  if (a.id != null && b.id != null) {
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
  }

  // Then sort by child_id
  if (a.child_id != null && b.child_id != null) {
    if (a.child_id < b.child_id) return -1;
    if (a.child_id > b.child_id) return 1;
  }

  // Then sort by parent_id
  if (a.parent_id != null && b.parent_id != null) {
    if (a.parent_id < b.parent_id) return -1;
    if (a.parent_id > b.parent_id) return 1;
  }

  // Then sort by role_id
  if (a.role_id != null && b.role_id != null) {
    if (a.role_id < b.role_id) return -1;
    if (a.role_id > b.role_id) return 1;
  }

  // Then sort by resource_id
  if (a.resource_id != null && b.resource_id != null) {
    if (a.resource_id < b.resource_id) return -1;
    if (a.resource_id > b.resource_id) return 1;
  }

  // If both child_id and parent_id are the same, return 0
  return 0;
};

export const generateUuidFromInteger = (num: number): string => {
  // Convert the number to a hexadecimal string
  // Ensure the hex string is 32 characters long (128 bits)
  const hexString = num.toString(16).padStart(32, '0');
  // Insert hyphens to format as a UUID (8-4-4-4-12)
  return `${hexString.substring(0, 8)}-${hexString.substring(8, 12)}-${hexString.substring(12, 16)}-${hexString.substring(16, 20)}-${hexString.substring(20)}`;
}


export type Node = {
  id: number;
};

export type Edge = {
  parent: number;
  child: number;
};

export const enumerateTreeNodesAndEdgesBreadthFirst = (levels: number[]): { nodes: Node[], edges: Edge[] } => {
  let nodes: Node[] = [];
  let edges: Edge[] = [];

  let nextID = 0;
  let parentQueue: (number | null)[] = [null]; // Start with a null parent for the root level.

  for (const count of levels) {
    const newParents: number[] = [];

    for (const parent of parentQueue) {
      for (let i = 0; i < count; i++) {
        const node: Node = { id: nextID };
        nodes.push(node);

        if (parent !== null) {
          edges.push({ parent, child: nextID });
        }

        newParents.push(nextID);
        nextID++;
      }
    }

    parentQueue = newParents;
  }

  return { nodes, edges };
};

class LinearCongruentialGenerator {
  private seed: number;
  private a: number = 1664525;
  private c: number = 1013904223;
  private m: number = Math.pow(2, 32);

  constructor(seed: number) {
    this.seed = seed;
  }

  next(): number {
    this.seed = (this.a * this.seed + this.c) % this.m;
    return this.seed / this.m;
  }
}

export const generateRandomBitmap = (length: number, probabilityOfOne: number, seed: number): string => {
  let result = '';
  const lcg = new LinearCongruentialGenerator(seed);
  for (let i = 0; i < length; i++) {
    const randomValue = lcg.next();
    result += (randomValue < probabilityOfOne) ? '1' : '0';
  }
  return result;
}

export type Pair = { left: number, right: number };

export const generateRandomPairsInRanges = (numberOfPairs: number, leftRange: { start: number, end: number }, rightRange: { start: number, end: number }, seed: number): Pair[] => {
  const lcg = new LinearCongruentialGenerator(seed);
  const pairs = [];
  for (let i = 0; i < numberOfPairs; i++) {
    const left = Math.floor(leftRange.start + lcg.next() * (leftRange.end - leftRange.start));
    const right = Math.floor(rightRange.start + lcg.next() * (rightRange.end - rightRange.start));
    pairs.push({ left, right });
  }
  return pairs;
}

export const generateRegularPairsInRanges = (numberOfPairs: number, leftRange: { start: number, end: number }, rightRange: { start: number, end: number }): Pair[] => {
  const pairs = [];
  for (let i = 0; i < numberOfPairs; i++) {
    const left = Math.floor(leftRange.start + (i / numberOfPairs) * (leftRange.end - leftRange.start));
    const right = Math.floor(rightRange.start + (i / numberOfPairs) * (rightRange.end - rightRange.start));
    pairs.push({ left, right });
  }
  return pairs;
}

export const computeProduct = (array: Array<number>) => {
  return array.reduce((a, b) => a * b, 1);
}

export const computeIndexRange = (array: Array<number>, depthStart: number = 0, depthEnd: number = depthStart + 1) => {
  if (depthStart > depthEnd) throw new Error("depthStart must be less than or equal to depthEnd");
  if (depthStart < 0) throw new Error("depthStart must be greater than or equal to 0");
  if (depthEnd > array.length) throw new Error("depthEnd must be less than or equal to the length of the array");

  const start = new Array(depthStart).fill(0).reduce((a, b, currentDepth) => a + array.slice(0, currentDepth + 1).reduce((a, b) => a * b, 1), 0);
  const end = new Array(depthEnd).fill(0).reduce((a, b, currentDepth) => a + array.slice(0, currentDepth + 1).reduce((a, b) => a * b, 1), 0);
  return {
    start,
    end,
    size: end - start,
  };
}


export const createRunTestQuery = (client: Client) => async (sql: SQL): Promise<any[]> => {
  let results: any;
  try {
    results = await client.query(compile(sql));
  } catch (e) {
    console.log("errr");
    console.log(e);
    throw e;
    // return [];
  }
  if (!Array.isArray(results)) {
    // If the sql contains a single statement, put the result in an array, to match
    // what happens when the sql contains multiple statements
    results = [results] as any;
  }
  return results.map((result: QueryResult<any>) => result.rows.sort(orderByIdChildParent));
};



export interface PostgresTestContext {
  client: pg.Client,
  runTestQuery: (sql: SQL) => Promise<any[]>,
  database_admin_username: string,
  database_admin_password: string,
  database_user_username: string,
  database_user_password: string,
  database_name: string,
}


// Export the setup functions
export const setupTests = () => {
  beforeEach<PostgresTestContext>(async (context) => {
    // Create the testing database and user
    context.database_admin_username = `admin_${generateRandomString(4)}`;
    context.database_admin_password = `admin_${generateRandomString(4)}`;
    context.database_user_username = `user_${generateRandomString(4)}`;
    context.database_user_password = `user_${generateRandomString(4)}`;
    context.database_name = `test_database_${generateRandomString(4)}`;
    const { database_admin_username, database_admin_password, database_user_username, database_user_password, database_name } = context;

    // console.log(`Opening ${database_name}`);
    const rootClient = new pgNative!.Client({
      connectionString: process.env.ROOT_DATABASE_URL,
    });
    await rootClient.connect();
    if ((await rootClient.query(compile(sql`select rolname from pg_roles where rolname = ${literal(database_admin_username)}`))).rowCount <= 0) {
      await rootClient.query(compile(sql`create user ${identifier(database_admin_username)} with login password ${literal(database_admin_password)}`));
    }
    if ((await rootClient.query(compile(sql`select rolname from pg_roles where rolname = ${literal(database_user_username)}`))).rowCount <= 0) {
      await rootClient.query(compile(sql`create user ${identifier(database_user_username)} with login password ${literal(database_user_password)}`));
    }
    if ((await rootClient.query(compile(sql`select datname from pg_database where datname = ${literal(database_name)}`))).rowCount <= 0) {
      await rootClient.query(compile(sql`create database ${identifier(database_name)} owner ${identifier(database_admin_username)}`));
    }
    await rootClient.query(compile(sql`grant connect on database ${identifier(database_name)} to ${identifier(database_user_username)}`));
    await rootClient.query(compile(sql`GRANT ${identifier(database_user_username)} TO ${identifier(database_admin_username)};`));
    await rootClient.end();

    // Create the testing client
    const { hostname, port } = new URL(process.env.ROOT_DATABASE_URL!);
    const client = new pgNative!.Client({
      host: hostname,
      port: parseInt(port),
      user: database_admin_username,
      password: database_admin_password,
      database: database_name
    });
    await client.connect();
    // Disable notice messages
    client.query(compile(sql`SET client_min_messages = 'WARNING'`));
    context.client = client;
    context.runTestQuery = createRunTestQuery(client);
    // Wait a tiny bit to make sure the database is ready
    // Without this, tests that do not use the DB fail during `afterEach`
    await new Promise(resolve => setTimeout(resolve, 0));
    // console.log(`Opened ${database_name}`);
  }, 10000)


  afterEach<PostgresTestContext>(async ({ client, database_admin_username, database_user_username, database_name }) => {
    // console.log(`Closing ${database_name}`);

    // End the testing client
    await client.end();

    // Drop the testing database and user
    const rootClient = new pgNative!.Client({
      connectionString: process.env.ROOT_DATABASE_URL,
    });
    await rootClient.connect();
    if ((await rootClient.query(compile(sql`select datname from pg_database where datname = ${literal(database_name)}`))).rowCount > 0) {
      await rootClient.query(compile(sql`drop database ${identifier(database_name)}`));
    }
    if ((await rootClient.query(compile(sql`select rolname from pg_roles where rolname = ${literal(database_admin_username)}`))).rowCount > 0) {
      await rootClient.query(compile(sql`drop role ${identifier(database_admin_username)}`));
    }
    await rootClient.end();
    // console.log(`Closed ${database_name}`);
  }, 10000)
};
