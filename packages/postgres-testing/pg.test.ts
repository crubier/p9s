import { expect, describe, test, beforeEach, afterEach } from 'bun:test'
import { compile, query as sql } from "pg-sql2";
import { setupTests } from './pg';


describe.skip('pg testing', async () => {

  const { setup, teardown, context } = setupTests(process.env.ROOT_DATABASE_URL!);
  beforeEach(setup)
  afterEach(teardown)

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