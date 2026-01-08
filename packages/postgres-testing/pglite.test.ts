import { expect, describe, test } from 'bun:test'
import { compile, query as sql } from "pg-sql2";
import { PGlite } from '@electric-sql/pglite'
import { type PostgresTestContext } from './pglite';
import { setupTests } from './pglite';





describe('pglite testing', async () => {
  const context = {} as PostgresTestContext;

  setupTests(context);

  test('sql basics', async () => {
    const { client } = context;
    const result = (await client.query(compile(sql`select 1 as one;`).text)).rows;
    expect(result).toMatchInlineSnapshot(`
      [
        {
          "one": 1,
        },
      ]
    `)
  });
});




describe('pglite validation playground', async () => {

  test('pglite simple', async () => {
    const db = new PGlite()
    await db.exec(compile(sql`
  CREATE TABLE IF NOT EXISTS todo (
    id SERIAL PRIMARY KEY,
    task TEXT,
    done BOOLEAN DEFAULT false
  );
  INSERT INTO todo (task, done) VALUES ('Install PGlite from NPM', true);
  INSERT INTO todo (task, done) VALUES ('Load PGlite', true);
  INSERT INTO todo (task) VALUES ('Update a task');
`).text);
    const { rows } = await db.query(compile(sql`SELECT * FROM todo`).text);
    expect(rows).toMatchInlineSnapshot(`
  [
    {
      "done": true,
      "id": 1,
      "task": "Install PGlite from NPM",
    },
    {
      "done": true,
      "id": 2,
      "task": "Load PGlite",
    },
    {
      "done": false,
      "id": 3,
      "task": "Update a task",
    },
  ]
`);
  });



  test('pglite introspection', async () => {
    const db = new PGlite()
    await db.exec(compile(sql`
  CREATE TABLE IF NOT EXISTS todo (
    id SERIAL PRIMARY KEY,
    task TEXT,
    done BOOLEAN DEFAULT false
  );
  INSERT INTO todo (task, done) VALUES ('Install PGlite from NPM', true);
  INSERT INTO todo (task, done) VALUES ('Load PGlite', true);
  INSERT INTO todo (task) VALUES ('Update a task');
`).text);
    const { rows } = await db.query(compile(sql`select rolname from pg_roles`).text);
    expect(rows).toMatchInlineSnapshot(`
    [
      {
        "rolname": "pg_database_owner",
      },
      {
        "rolname": "pg_read_all_data",
      },
      {
        "rolname": "pg_write_all_data",
      },
      {
        "rolname": "pg_monitor",
      },
      {
        "rolname": "pg_read_all_settings",
      },
      {
        "rolname": "pg_read_all_stats",
      },
      {
        "rolname": "pg_stat_scan_tables",
      },
      {
        "rolname": "pg_read_server_files",
      },
      {
        "rolname": "pg_write_server_files",
      },
      {
        "rolname": "pg_execute_server_program",
      },
      {
        "rolname": "pg_signal_backend",
      },
      {
        "rolname": "pg_checkpoint",
      },
      {
        "rolname": "pg_maintain",
      },
      {
        "rolname": "pg_use_reserved_connections",
      },
      {
        "rolname": "pg_create_subscription",
      },
      {
        "rolname": "postgres",
      },
    ]
  `);
  });

});