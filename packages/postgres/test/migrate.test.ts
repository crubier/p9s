import { expect, describe, test, beforeEach, afterEach } from 'bun:test'
import { setupTests, testDatabaseUrl } from '@p9s/postgres-testing';
import { generateRandomString } from '@p9s/core-testing';
import { Client } from 'pg';
import { migrate } from '../migrate';
import { migrationStatus } from '../status';
import type { Queryable } from '../identity';
import { blogMigrationConfig, setupBlogTables } from './helpers';

describe('migrate', () => {
  const { setup, teardown, context } = setupTests();
  beforeEach(setup);
  afterEach(teardown);

  // PGlite runs a script of several statements with exec, Postgres with a query without parameters
  const withClient = async <T>(fn: (client: Queryable) => Promise<T>) => {
    if (!testDatabaseUrl) {
      const pglite = (context as any).client;
      return fn({ query: async (text: string, values?: any[]) => values ? pglite.query(text, values) : (await pglite.exec(text)).at(-1) });
    }
    const client = await (context as any).connect();
    try { return await fn(client); } finally { await client.end(); }
  };
  // A role that can create roles, which the test admin cannot
  const withSuperuser = async <T>(fn: (client: Queryable) => Promise<T>) => {
    const url = new URL(testDatabaseUrl!);
    url.pathname = `/${context.database_name}`;
    const client = new Client({ connectionString: url.toString() });
    await client.connect();
    try { return await fn(client); } finally { await client.end(); }
  };

  test('runs the migration once, then finds the database up to date', async () => {
    const config = blogMigrationConfig(context);
    await setupBlogTables(context);
    await withClient(async client => {
      const first = await migrate(client, config);
      expect(first.ran).toBe(true);
      expect(first.before.state).toBe("missing");
      expect((await migrationStatus(client, config)).state).toBe("current");

      const second = await migrate(client, config);
      expect(second).toEqual({ ran: false, createdRoles: [], before: expect.objectContaining({ state: "current" }) });

      expect((await migrate(client, config, { force: true })).ran).toBe(true);
      expect((await migrationStatus(client, config)).state).toBe("current");
    });
  });

  test.skipIf(!testDatabaseUrl)('creates the roles of the config that do not exist, and grants them to the role that migrates', async () => {
    const config = blogMigrationConfig(context);
    const newUser = `user_${generateRandomString(6).toLowerCase()}`;
    const newWriter = `writer_${generateRandomString(6).toLowerCase()}`;
    const withNewRoles = { ...config, engine: { ...config.engine, users: [...config.engine.users, newUser], graphWriters: [newWriter] } };
    await setupBlogTables(context);
    try {
      await withSuperuser(async client => {
        const result = await migrate(client, withNewRoles);
        expect(result.createdRoles.sort()).toEqual([newUser, newWriter].sort());
        const { rows } = await client.query<{ rolname: string, rolcanlogin: boolean, member: boolean }>(
          `select rolname, rolcanlogin, pg_has_role(current_user, oid, 'member') as member from pg_roles where rolname = any ($1::text[]) order by rolname`,
          [[newUser, newWriter]]);
        expect(rows.map(row => [row.rolcanlogin, row.member])).toEqual([[false, true], [false, true]]);
        await client.query(`begin; set local role ${newUser}; rollback;`);
      });
    } finally {
      await withSuperuser(async client => {
        for (const role of [newUser, newWriter]) {
          await client.query(`do $$ begin if exists (select from pg_roles where rolname = '${role}') then execute 'drop owned by ${role}'; execute 'drop role ${role}'; end if; end $$`);
        }
      });
    }
  });

  test('a migration that fails leaves the database as it was', async () => {
    const config = blogMigrationConfig(context);
    const broken = { ...config, tables: [...config.tables, { name: "missing_table", isResource: true, resourceId: "resource_id" }] };
    await setupBlogTables(context);
    await withClient(async client => {
      await expect(migrate(client, broken)).rejects.toThrow(/missing_table/);
      expect((await migrationStatus(client, broken)).state).toBe("missing");
      const { rows: [row] } = await client.query<{ edge: string | null, column: boolean }>(
        `select to_regclass('resource_edge')::text as edge, exists (select from information_schema.columns where table_name = 'blog_post' and column_name = 'resource_id') as column`);
      expect(row).toEqual({ edge: null, column: false });
    });
  });
});
