import { expect, describe, test } from 'bun:test'
import { compile, query as sql } from "pg-sql2";
import { type PostgresTestContext } from './pg';
import { setupTests } from './pg';


describe.skip('pg testing', async () => {
  const context = {} as PostgresTestContext;

  setupTests(context);

  test('sql basics', async () => {
    const { client } = context;
    const result = (await client.query(compile(sql`select 1 as one;`))).rows;
    expect(result).toMatchInlineSnapshot(`
    [
      {
        "one": 1,
      },
    ]
  `)
  });
});