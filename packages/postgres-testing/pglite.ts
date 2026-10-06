import { compile, query as sql, literal, identifier } from "pg-sql2";
import type { SQL } from "pg-sql2";
import { generateRandomString, orderByIdChildParent } from '@p9s/core-testing';
import { PGlite, type Results } from '@electric-sql/pglite'
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';




export const createRunTestQuery = (client: PGlite) => async (sqlquery: SQL): Promise<any[]> => {
  let results: Results | Results[];
  const compiled = compile(sqlquery);
  // Check if query contains multiple statements (has semicolon followed by non-whitespace)
  const hasMultipleStatements = /;[\s]*\S/.test(compiled.text);
  if (hasMultipleStatements) {
    // Use transaction with multiple queries for multi-statement queries
    // This ensures set local statements persist across the transaction
    // Split by semicolon and filter empty statements
    const statements = compiled.text.split(';').map(s => s.trim()).filter(s => s.length > 0);
    results = await client.transaction(async (tx) => {
      const allResults: Results<{ [key: string]: any }>[] = [];
      for (const stmt of statements) {
        const result = await tx.query<{ [key: string]: any }>(stmt, compiled.values);
        allResults.push(result);
      }
      return allResults;
    });
  } else {
    // Use query for single statements
    results = await client.query(compiled.text, compiled.values);
  }
  if (!Array.isArray(results)) {
    // If the sql contains a single statement, put the result in an array, to match
    // what happens when the sql contains multiple statements
    results = [results] as Results[];
  }
  return results.map((result: Results) => result.rows.sort(orderByIdChildParent));
};

export const createExec = (client: PGlite) => async (sqlquery: SQL): Promise<any[]> => {
  const results: Results[] = await client.exec(compile(sqlquery).text);
  return results.map((result: Results) => result.rows.sort(orderByIdChildParent));
};



export interface PostgresTestContext {
  client: PGlite,
  runTestQuery: (sql: SQL) => Promise<any[]>,
  exec: (sql: SQL) => Promise<any[]>,
  // PGlite is single-connection, so concurrency tests need the real Postgres harness
  connect: () => Promise<never>,
  database_admin_username: string,
  database_admin_password: string,
  database_user_username: string,
  database_user_password: string,
  database_writer_username: string,
  database_name: string,
}

// Export the setup functions
export const setupTests = () => {
  const context = {} as Partial<PostgresTestContext>;

  const setup = async () => {
    // Create the testing database and user
    context.database_admin_username = `admin_${generateRandomString(4)}`;
    context.database_admin_password = `admin_${generateRandomString(4)}`;
    context.database_user_username = `user_${generateRandomString(4)}`;
    context.database_user_password = `user_${generateRandomString(4)}`;
    context.database_writer_username = `writer_${generateRandomString(4)}`;
    context.database_name = `test_database_${generateRandomString(4)}`;
    const { database_admin_username, database_admin_password, database_user_username, database_user_password, database_writer_username, database_name } = context;

    const rootClient = await PGlite.create({
      extensions: { uuid_ossp, pg_trgm }
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
    await rootClient.query(compile(sql`create role ${identifier(database_writer_username)} nologin`).text);
    await rootClient.query(compile(sql`grant connect on database ${identifier(database_name)} to ${identifier(database_user_username)}`).text);
    await rootClient.query(compile(sql`GRANT ${identifier(database_user_username)} TO ${identifier(database_admin_username)}`).text);
    await rootClient.query(compile(sql`GRANT ${identifier(database_writer_username)} TO ${identifier(database_admin_username)}`).text);


    const dataDirDump = await rootClient.dumpDataDir();
    await rootClient.close()

    // Create the testing client
    const client = await PGlite.create({
      loadDataDir: dataDirDump,
      username: database_admin_username,
      database: database_name,
      extensions: { uuid_ossp, pg_trgm }

    });

    // Disable notice messages
    client.query(compile(sql`SET client_min_messages = 'WARNING'`).text);
    context.client = client;
    context.runTestQuery = createRunTestQuery(client);
    context.exec = createExec(client);
    context.connect = async () => { throw new Error("PGlite does not support multiple connections"); };
  }


  // The whole cluster lives in memory, closing the client discards it
  const teardown = async () => {
    await (context as PostgresTestContext).client.close();
  }

  return {
    context: context as PostgresTestContext,
    setup,
    teardown
  }
};
