import { expect, describe, test, beforeEach, afterEach } from 'bun:test'
import { compile } from "pg-sql2";
import { setupTests, testDatabaseUrl } from '@p9s/postgres-testing';
import { createMigration, expectedMigrationRecord, migrationRecordFunction } from '../generation';
import { migrationStatus } from '../status';
import type { Queryable } from '../identity';
import { version } from '../version';
import { blogMigrationConfig, setupBlogTables } from './helpers';
import packageJson from '../package.json';

describe('migration status', () => {
  const { setup, teardown, context } = setupTests();
  beforeEach(setup);
  afterEach(teardown);

  const withClient = async <T>(fn: (client: Queryable) => Promise<T>) => {
    if (!testDatabaseUrl) return fn((context as any).client);
    const client = await (context as any).connect();
    try { return await fn(client); } finally { await client.end(); }
  };

  test('missing before the migration, current after it, outdated for another config', async () => {
    const config = blogMigrationConfig(context);
    const other = { ...config, engine: { ...config.engine, resourceCache: "assigned" as const } };
    await setupBlogTables(context);
    expect((await withClient(client => migrationStatus(client, config))).state).toBe("missing");

    await context.exec(createMigration(config));
    const status = await withClient(client => migrationStatus(client, config));
    expect(status).toEqual({ state: "current", expected: expectedMigrationRecord(config), installed: expectedMigrationRecord(config) });
    expect(status.installed!.version).toBe(version);

    const outdated = await withClient(client => migrationStatus(client, other));
    expect(outdated.state).toBe("outdated");
    expect(outdated.installed).toEqual(expectedMigrationRecord(config));
  });

  test('the record is the last statement, and only changes with the migration', () => {
    const config = blogMigrationConfig(context);
    const text = compile(createMigration(config)).text.trimEnd();
    expect(text.endsWith("language sql immutable;")).toBe(true);
    expect(text.slice(text.lastIndexOf("create or replace function"))).toContain(`"${migrationRecordFunction(config)}"`);
    expect(expectedMigrationRecord(config)).toEqual(expectedMigrationRecord(blogMigrationConfig(context)));
    expect(expectedMigrationRecord(config).hash).toMatch(/^[0-9a-f]{16}$/);
    expect(migrationRecordFunction({ ...config, engine: { ...config.engine, naming: { prefix: "blog_" } } })).toBe("blog_p9s_migration");
  });

  test('the version is that of the package', () => {
    expect(version).toBe(packageJson.version);
  });
});
