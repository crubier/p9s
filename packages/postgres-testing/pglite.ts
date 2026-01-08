import { beforeEach, afterEach } from 'bun:test'
import { compile, query as sql, literal, identifier } from "pg-sql2";
import type { SQL } from "pg-sql2";
import { generateRandomString, orderByIdChildParent } from '@p9s/core-testing';
import { PGlite, type Results } from '@electric-sql/pglite'
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';




export const createRunTestQuery = (client: PGlite) => async (sqlquery: SQL): Promise<any[]> => {
  let results: Results | Results[];
  try {
    const compiled = compile(sqlquery);
    results = await client.query(compiled.text, compiled.values);
  } catch (e) {
    console.log("errr");
    console.log(e);
    throw e;
    // return [];
  }
  if (!Array.isArray(results)) {
    // If the sql contains a single statement, put the result in an array, to match
    // what happens when the sql contains multiple statements
    results = [results] as Results[];
  }
  return results.map((result: Results) => result.rows.sort(orderByIdChildParent));
};

export const createExec = (client: PGlite) => async (sqlquery: SQL): Promise<any[]> => {
  let results: Results | Results[];
  try {
    const compiled = compile(sqlquery);
    results = await client.exec(compiled.text);
  } catch (e) {
    console.log("errr");
    console.log(e);
    throw e;
    // return [];
  }
  if (!Array.isArray(results)) {
    // If the sql contains a single statement, put the result in an array, to match
    // what happens when the sql contains multiple statements
    results = [results] as Results[];
  }
  return results.map((result: Results) => result.rows.sort(orderByIdChildParent));
};



export interface PostgresTestContext {
  client: PGlite,
  runTestQuery: (sql: SQL) => Promise<any[]>,
  exec: (sql: SQL) => Promise<any[]>,
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

    const rootClient = await PGlite.create({
      extensions: { uuid_ossp }
    });

    if ((await rootClient.query(compile(sql`select rolname from pg_roles where rolname = ${literal(database_admin_username)}`).text)).rows.length <= 0) {
      await rootClient.query(compile(sql`create user ${identifier(database_admin_username)} with login password ${literal(database_admin_password)}`).text);
    }
    if ((await rootClient.query(compile(sql`select rolname from pg_roles where rolname = ${literal(database_user_username)}`).text)).rows.length <= 0) {
      await rootClient.query(compile(sql`create user ${identifier(database_user_username)} with login password ${literal(database_user_password)}`).text);
    }
    if ((await rootClient.query(compile(sql`select datname from pg_database where datname = ${literal(database_name)}`).text)).rows.length <= 0) {
      await rootClient.query(compile(sql`create database ${identifier(database_name)} owner ${identifier(database_admin_username)}`).text);
    }
    await rootClient.query(compile(sql`grant connect on database ${identifier(database_name)} to ${identifier(database_user_username)}`).text);
    await rootClient.query(compile(sql`GRANT ${identifier(database_user_username)} TO ${identifier(database_admin_username)}`).text);


    const dataDirDump = await rootClient.dumpDataDir();
    await rootClient.close()

    // Create the testing client
    const client = await PGlite.create({
      loadDataDir: dataDirDump,
      username: database_admin_username,
      database: database_name,
      extensions: { uuid_ossp }

    });

    // Disable notice messages
    client.query(compile(sql`SET client_min_messages = 'WARNING'`).text);
    context.client = client;
    context.runTestQuery = createRunTestQuery(client);
    context.exec = createExec(client);
  })


  afterEach(async () => {
    const { client, database_admin_username, database_user_username, database_name } = context as PostgresTestContext;

    const dataDirDump = await client.dumpDataDir();
    await client.close()

    // Drop the testing database and user
    const rootClient = await PGlite.create({
      loadDataDir: dataDirDump,
      extensions: { uuid_ossp }
    });

    if ((await rootClient.query(compile(sql`select datname from pg_database where datname = ${literal(database_name)}`).text)).rows.length > 0) {
      await rootClient.query(compile(sql`drop database ${identifier(database_name)}`).text);
    }
    if ((await rootClient.query(compile(sql`select rolname from pg_roles where rolname = ${literal(database_admin_username)}`).text)).rows.length > 0) {
      await rootClient.query(compile(sql`drop role ${identifier(database_admin_username)}`).text);
    }


  })
};
