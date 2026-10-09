import { expect, describe, test, beforeEach, afterEach } from 'bun:test'
import { query as sql, raw } from "pg-sql2";
import { setupTests, testDatabaseUrl } from '@p9s/postgres-testing';
import { createMigration } from '../generation';
import { createIdentity, isRefused, type PoolLike, type Queryable } from '../identity';
import { FIRST_GENERATED_ID, bits, blogMigrationConfig, setupBlogTables, type TestContext } from './helpers';

const identityConfig = (context: TestContext) => {
  const config = blogMigrationConfig(context);
  return { ...config, engine: { ...config.engine, authentication: { getCurrentUserId: "app_user_id", setting: "app.user_id" } } };
};

// Connections like a pool gives: on Postgres, one more connection per transaction; on PGlite, its only connection,
// which shows that nothing of a transaction stays on the connection after it
const poolOf = (context: TestContext): PoolLike<Queryable> => ({
  connect: async () => {
    if (testDatabaseUrl) {
      const client = await (context as any).connect();
      return Object.assign(client, { release: () => { void client.end(); } });
    }
    const client = (context as any).client;
    return { query: (text: string, values?: unknown[]) => client.query(text, values), release: () => {} };
  },
});

const rowsOf = (result: unknown) => (result as { rows: any[] }).rows;

describe('identity of the transactions of a user', () => {
  const { setup, teardown, context } = setupTests();
  beforeEach(setup);
  afterEach(teardown);

  const load = async () => {
    await setupBlogTables(context);
    await context.exec(createMigration(identityConfig(context)));
    await context.exec(sql`
      select setval('resource_id_seq', ${raw(String(FIRST_GENERATED_ID))});
      select setval('role_id_seq', ${raw(String(FIRST_GENERATED_ID))});
      insert into "resource_group" ("id", "parent_id") values (1, null), (2, null);
      insert into "role_group" ("id", "parent_id") values (1, null), (2, null);
      insert into "blog_post" ("group_id", "name") values (1, 'first'), (1, 'second'), (2, 'other');
      insert into "assignment_edge" ("resource_id", "role_id", "permission") values (1, 1, ${bits("1111")}), (2, 2, ${bits("1000")});`);
  };

  test('the migration reads the current user from the setting', async () => {
    await load();
    const [[{ empty }], [{ set }]] = await context.runTestQuery(sql`
      select app_user_id() as "empty";
      select set_config('app.user_id', '2', true), app_user_id() as "set";`);
    expect(empty).toBeNull();
    expect(set).toBe(2);
  });

  test('run reads as the user through RLS, and leaves nothing on the connection', async () => {
    await load();
    const identity = createIdentity(identityConfig(context));
    const pool = poolOf(context);
    const names = await identity.run(pool, 1, async client => rowsOf(await client.query(`select "name" from "blog_post" order by "name"`)).map(row => row.name));
    expect(names).toEqual(["first", "second"]);
    expect(await identity.run(pool, 2, async client => rowsOf(await client.query(`select count(*)::int as "n" from "blog_post"`))[0].n)).toBe(1);
    // No user reads nothing
    expect(await identity.run(pool, null, async client => rowsOf(await client.query(`select count(*)::int as "n" from "blog_post"`))[0].n)).toBe(0);
    const [[after]] = await context.runTestQuery(sql`select current_user = session_user as "same", coalesce(current_setting('app.user_id', true), '') as "setting"`);
    expect(after).toEqual({ same: true, setting: "" });
  });

  test('run commits, rolls back what throws, and refuses writes when read only', async () => {
    await load();
    const identity = createIdentity(identityConfig(context));
    const pool = poolOf(context);
    await identity.run(pool, 1, client => client.query(`insert into "blog_post" ("group_id", "name") values (1, 'kept')`));
    await expect(identity.run(pool, 1, async client => {
      await client.query(`insert into "blog_post" ("group_id", "name") values (1, 'dropped')`);
      throw new Error("the request failed");
    })).rejects.toThrow("the request failed");
    // RLS refuses a post in a group the user cannot write
    await expect(identity.run(pool, 2, client => client.query(`insert into "blog_post" ("group_id", "name") values (2, 'refused')`))).rejects.toThrow();
    await expect(identity.run(pool, 1, client => client.query(`insert into "blog_post" ("group_id", "name") values (1, 'read only')`), { readOnly: true }))
      .rejects.toThrow(/read-only/);
    const [rows] = await context.runTestQuery(sql`select "name" from "blog_post" order by "name"`);
    expect(rows.map(({ name }: { name: string }) => name)).toEqual(["first", "kept", "other", "second"]);
  });

  test('statement sets the role, the user and other settings, for any client', async () => {
    await load();
    const identity = createIdentity(identityConfig(context));
    expect(identity.role).toBe(context.database_user_username);
    expect(identity.statement(7)).toEqual({
      text: "select set_config($1, $2, true), set_config($3, $4, true)",
      values: ["role", context.database_user_username, "app.user_id", "7"],
    });
    const { text, values } = identity.statement(1, { role: context.database_writer_username, settings: { "app.request_id": "abc", "app.none": null } });
    expect(values).toEqual(["role", context.database_writer_username, "app.user_id", "1", "app.request_id", "abc", "app.none", ""]);
    const seen = await identity.run(poolOf(context), 1, async client => {
      await client.query(text, values);
      return rowsOf(await client.query(`select current_user::text as "role", current_setting('app.request_id') as "request"`))[0];
    });
    expect(seen).toEqual({ role: context.database_writer_username, request: "abc" });
    expect(() => identity.statement(1, { role: "postgres" })).toThrow(/not a role/);
    expect(identity.pgSettings(3, { readOnly: true, settings: { jit: "off" } })).toEqual({
      role: context.database_user_username, "app.user_id": "3", jit: "off", transaction_read_only: "on",
    });
  });

  test('a config without a setting has no identity helpers', async () => {
    expect(() => createIdentity(blogMigrationConfig(context))).toThrow(/engine.authentication.setting/);
  });

  test('isRefused tells insufficient_privilege, as clients wrap it', () => {
    const postgres = Object.assign(new Error("new row violates row-level security policy"), { code: "42501" });
    expect(isRefused(postgres)).toBe(true);
    expect(isRefused(Object.assign(new Error("Failed query"), { cause: postgres }))).toBe(true);
    expect(isRefused({ code: "P2039", meta: { driverAdapterError: { cause: { code: "42501" } } } })).toBe(true);
    expect(isRefused(Object.assign(new Error("duplicate key"), { code: "23505" }))).toBe(false);
    expect(isRefused(undefined)).toBe(false);
  });
});
