import { expect, describe, test, beforeEach, afterEach } from 'bun:test'
import { query as sql, raw } from "pg-sql2";
import { setupTests, testDatabaseUrl } from '@p9s/postgres-testing';
import { diagnose, type Finding } from '../doctor';
import type { Queryable } from '../identity';
import { bits, blogMigrationConfig, setupBlog, setupBlogTables } from './helpers';

describe('doctor', () => {
  const { setup, teardown, context } = setupTests();
  beforeEach(setup);
  afterEach(teardown);

  const withClient = async <T>(fn: (client: Queryable) => Promise<T>) => {
    if (!testDatabaseUrl) return fn((context as any).client);
    const client = await (context as any).connect();
    try { return await fn(client); } finally { await client.end(); }
  };
  const run = () => withClient(client => diagnose(client, blogMigrationConfig(context)));
  const levelOf = (findings: Finding[], check: Finding["check"]) => findings.filter(finding => finding.check === check).map(finding => finding.level);
  const load = async () => {
    await setupBlog(context);
    await context.exec(sql`
      insert into "resource_group" ("id", "parent_id") values (1, null), (2, 1), (3, 2);
      insert into "role_group" ("id", "parent_id") values (1, null), (2, 1);
      insert into "blog_post" ("group_id", "name") values (3, 'deep'), (1, 'top');
      insert into "assignment_edge" ("resource_id", "role_id", "permission") values (1, 2, ${bits("1111")});`);
  };

  test('says when the database has no p9s migration, and nothing else', async () => {
    await setupBlogTables(context);
    const findings = await run();
    expect(findings).toEqual([{ check: "migration", level: "error", message: expect.stringContaining("No p9s migration") }]);
  });

  test('finds nothing wrong in a database that ran the migration', async () => {
    await load();
    await context.exec(sql`create index on "api_key" ("group_id")`);
    const findings = await run();
    expect(findings.filter(finding => finding.level === "error")).toEqual([]);
    expect(levelOf(findings, "migration")).toEqual(["ok"]);
    expect(levelOf(findings, "roles")).toEqual(["ok"]);
    expect(levelOf(findings, "rls")).toEqual(["ok"]);
    expect(levelOf(findings, "indexes")).toEqual(["ok"]);
    expect(findings.filter(finding => finding.check === "cache").map(finding => finding.message)).toEqual([
      expect.stringMatching(/^The resource cache of \d+ sampled nodes matches a recompute$/),
      expect.stringMatching(/^The role cache of \d+ sampled nodes matches a recompute$/),
    ]);
    // resource_group is a resource the test user was not granted
    expect(findings.find(finding => finding.check === "grants")!.message).toContain("resource_group");
  });

  test('finds a wrong cache, RLS turned off, a missing index, JIT and a user that owns a table', async () => {
    await load();
    await context.exec(sql`
      delete from "resource_edge_cache" where "parent_id" <> "child_id";
      alter table "blog_post" disable row level security;
      drop index "blog_post_group_id_idx";
      alter database ${raw(`"${context.database_name}"`)} set jit = on;`);
    const findings = await run();
    expect(levelOf(findings, "cache")).toEqual(["error", "ok"]);
    expect(findings.find(finding => finding.check === "cache")!.message).toContain(`select "resource_edge_cache_backfill"()`);
    expect(findings.find(finding => finding.check === "rls")).toMatchObject({ level: "error", message: expect.stringContaining("blog_post") });
    expect(findings.filter(finding => finding.check === "indexes")).toContainEqual({ check: "indexes", level: "warn", message: expect.stringContaining(`"public"."blog_post".group_id`) });
    expect(findings.find(finding => finding.check === "jit")).toMatchObject({ level: "warn", message: expect.stringContaining(`set jit = off`) });

    const user = raw(`"${context.database_user_username}"`);
    await context.exec(sql`grant create on schema "public" to ${user}; alter table "blog_comment" owner to ${user};`);
    const owner = await run();
    expect(owner.find(finding => finding.check === "roles")).toMatchObject({ level: "error", message: expect.stringContaining("owns blog_comment") });
  });
});
