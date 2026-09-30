import { type QueryResult } from "pg";
import { compile, query as sql, literal, identifier } from "pg-sql2";
import type { SQL } from "pg-sql2";
import { Client } from 'pg';
import { generateRandomString, orderByIdChildParent } from '@p9s/core-testing';

export type { Client };


export const createRunTestQuery = (client: Client) => async (sqlquery: SQL): Promise<any[]> => {
  let results: any = await client.query(compile(sqlquery));
  if (!Array.isArray(results)) {
    // If the sql contains a single statement, put the result in an array, to match
    // what happens when the sql contains multiple statements
    results = [results] as any;
  }
  return results.map((result: QueryResult<any>) => result.rows.sort(orderByIdChildParent));
};


export const createExec = createRunTestQuery;



export interface PostgresTestContext {
  client: Client,
  runTestQuery: (sql: SQL) => Promise<any[]>,
  exec: (sql: SQL) => Promise<any[]>,
  // Opens an extra connection to the test database as the admin user, the caller must end it
  connect: () => Promise<Client>,
  database_admin_username: string,
  database_admin_password: string,
  database_user_username: string,
  database_user_password: string,
  database_writer_username: string,
  database_name: string,
}

// Export the setup functions
export const setupTests = (databaseUrl: string) => {

  const context = {} as Partial<PostgresTestContext>;

  const roleExists = async (client: Client, role: string) =>
    ((await client.query(compile(sql`select rolname from pg_roles where rolname = ${literal(role)}`))).rowCount ?? 0) > 0;

  const setup = async () => {
    // Create the testing database and user
    context.database_admin_username = `admin_${generateRandomString(4)}`;
    context.database_admin_password = `admin_${generateRandomString(4)}`;
    context.database_user_username = `user_${generateRandomString(4)}`;
    context.database_user_password = `user_${generateRandomString(4)}`;
    context.database_writer_username = `writer_${generateRandomString(4)}`;
    context.database_name = `test_database_${generateRandomString(4)}`;
    const { database_admin_username, database_admin_password, database_user_username, database_user_password, database_writer_username, database_name } = context;

    const rootClient = new Client({
      connectionString: databaseUrl,
    });
    await rootClient.connect();
    if (!await roleExists(rootClient, database_admin_username!)) {
      await rootClient.query(compile(sql`create user ${identifier(database_admin_username!)} with login password ${literal(database_admin_password!)}`));
    }
    if (!await roleExists(rootClient, database_user_username!)) {
      await rootClient.query(compile(sql`create user ${identifier(database_user_username!)} with login password ${literal(database_user_password!)}`));
    }
    if (!await roleExists(rootClient, database_writer_username!)) {
      await rootClient.query(compile(sql`create role ${identifier(database_writer_username!)} nologin`));
    }
    if (((await rootClient.query(compile(sql`select datname from pg_database where datname = ${literal(database_name!)}`))).rowCount ?? 0) <= 0) {
      await rootClient.query(compile(sql`create database ${identifier(database_name!)} owner ${identifier(database_admin_username!)}`));
    }
    await rootClient.query(compile(sql`grant connect on database ${identifier(database_name!)} to ${identifier(database_user_username!)}`));
    await rootClient.query(compile(sql`GRANT ${identifier(database_user_username!)} TO ${identifier(database_admin_username!)};`));
    await rootClient.query(compile(sql`GRANT ${identifier(database_writer_username!)} TO ${identifier(database_admin_username!)};`));
    await rootClient.end();

    const { hostname, port } = new URL(databaseUrl);
    const connect = async () => {
      const extraClient = new Client({
        host: hostname,
        port: parseInt(port),
        user: database_admin_username,
        password: database_admin_password,
        database: database_name
      });
      await extraClient.connect();
      await extraClient.query(`SET client_min_messages = 'WARNING'`);
      return extraClient;
    };

    const client = await connect();
    context.client = client;
    context.connect = connect;
    context.runTestQuery = createRunTestQuery(client);
    context.exec = createExec(client);
  }


  const teardown = async () => {
    const { client, database_admin_username, database_user_username, database_writer_username, database_name } = context as PostgresTestContext;

    await client.end();

    // Drop the testing database and roles
    const rootClient = new Client({
      connectionString: databaseUrl,
    });
    await rootClient.connect();
    if (((await rootClient.query(compile(sql`select datname from pg_database where datname = ${literal(database_name)}`))).rowCount ?? 0) > 0) {
      await rootClient.query(compile(sql`drop database ${identifier(database_name)} with (force)`));
    }
    for (const role of [database_admin_username, database_user_username, database_writer_username]) {
      if (await roleExists(rootClient, role)) {
        await rootClient.query(compile(sql`drop role ${identifier(role)}`));
      }
    }
    await rootClient.end();
  }

  return {
    context: context as PostgresTestContext,
    setup,
    teardown
  }
};
