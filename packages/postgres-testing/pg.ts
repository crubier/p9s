import { beforeEach, afterEach } from 'bun:test'
import { type QueryResult } from "pg";
import { compile, query as sql, literal, identifier } from "pg-sql2";
import type { SQL } from "pg-sql2";
import { Client } from 'pg';
import { generateRandomString, orderByIdChildParent } from '@p9s/core-testing';



export const createRunTestQuery = (client: Client) => async (sqlquery: SQL): Promise<any[]> => {
  let results: any;
  try {
    results = await client.query(compile(sqlquery));
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
  client: Client,
  runTestQuery: (sql: SQL) => Promise<any[]>,
  database_admin_username: string,
  database_admin_password: string,
  database_user_username: string,
  database_user_password: string,
  database_name: string,
}

// Export the setup functions
export const setupTests = (context: Partial<PostgresTestContext>) => {
  beforeEach(async () => {
    // Create the testing database and user
    context.database_admin_username = `admin_${generateRandomString(4)}`;
    context.database_admin_password = `admin_${generateRandomString(4)}`;
    context.database_user_username = `user_${generateRandomString(4)}`;
    context.database_user_password = `user_${generateRandomString(4)}`;
    context.database_name = `test_database_${generateRandomString(4)}`;
    const { database_admin_username, database_admin_password, database_user_username, database_user_password, database_name } = context;

    // console.log(`Opening ${database_name}`);
    const rootClient = new Client({
      connectionString: process.env.ROOT_DATABASE_URL,
    });
    await rootClient.connect();
    if ((await rootClient.query(compile(sql`select rolname from pg_roles where rolname = ${literal(database_admin_username)}`))).rowCount ?? 0 <= 0) {
      await rootClient.query(compile(sql`create user ${identifier(database_admin_username)} with login password ${literal(database_admin_password)}`));
    }
    if ((await rootClient.query(compile(sql`select rolname from pg_roles where rolname = ${literal(database_user_username)}`))).rowCount ?? 0 <= 0) {
      await rootClient.query(compile(sql`create user ${identifier(database_user_username)} with login password ${literal(database_user_password)}`));
    }
    if ((await rootClient.query(compile(sql`select datname from pg_database where datname = ${literal(database_name)}`))).rowCount ?? 0 <= 0) {
      await rootClient.query(compile(sql`create database ${identifier(database_name)} owner ${identifier(database_admin_username)}`));
    }
    await rootClient.query(compile(sql`grant connect on database ${identifier(database_name)} to ${identifier(database_user_username)}`));
    await rootClient.query(compile(sql`GRANT ${identifier(database_user_username)} TO ${identifier(database_admin_username)};`));
    await rootClient.end();

    // Create the testing client
    const { hostname, port } = new URL(process.env.ROOT_DATABASE_URL!);
    const client = new Client({
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
  })


  afterEach(async () => {
    const { client, database_admin_username, database_user_username, database_name } = context as PostgresTestContext;

    // console.log(`Closing ${database_name}`);

    // End the testing client
    await client.end();

    // Drop the testing database and user
    const rootClient = new Client({
      connectionString: process.env.ROOT_DATABASE_URL,
    });
    await rootClient.connect();
    if ((await rootClient.query(compile(sql`select datname from pg_database where datname = ${literal(database_name)}`))).rowCount ?? 0 > 0) {
      await rootClient.query(compile(sql`drop database ${identifier(database_name)}`));
    }
    if ((await rootClient.query(compile(sql`select rolname from pg_roles where rolname = ${literal(database_admin_username)}`))).rowCount ?? 0 > 0) {
      await rootClient.query(compile(sql`drop role ${identifier(database_admin_username)}`));
    }
    await rootClient.end();
    // console.log(`Closed ${database_name}`);
  })
};
