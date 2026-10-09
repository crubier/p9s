import { expect, describe, test, beforeEach, afterEach } from 'bun:test'
import { query as sql, raw } from "pg-sql2";
import { getCompleteConfig, validateConfig } from "@p9s/core";
import { setupTests, testDatabaseUrl } from '@p9s/postgres-testing';
import { createMigration } from '../generation';
import { createIdentity, type PoolLike, type Queryable } from '../identity';
import { proposeConfig, readTables } from '../introspection';

const saas = sql`
  create table "organization" ("id" uuid primary key default gen_random_uuid(), "name" text not null);
  create table "user" ("id" uuid primary key default gen_random_uuid(), "email" text not null);
  create table "member" ("id" uuid primary key default gen_random_uuid(), "org_id" uuid not null references "organization", "user_id" uuid not null references "user");
  create table "folder" ("id" uuid primary key default gen_random_uuid(), "org_id" uuid not null references "organization", "parent_id" uuid references "folder", "name" text not null);
  create table "document" ("id" uuid primary key default gen_random_uuid(), "folder_id" uuid not null references "folder", "author_id" uuid references "user", "title" text not null);
  create table "session" ("id" text primary key, "user_id" uuid references "user");
  create table "account" ("id" text primary key, "user_id" uuid references "user", "provider_id" text);
  create table "_prisma_migrations" ("id" text primary key);
  create table "folder_tag" ("folder_id" uuid references "folder", "tag" text, primary key ("folder_id", "tag"));`;

describe('p9s init', () => {
  const { setup, teardown, context } = setupTests();
  beforeEach(setup);
  afterEach(teardown);

  const withClient = async <T>(fn: (client: Queryable) => Promise<T>) => {
    if (!testDatabaseUrl) return fn((context as any).client);
    const client = await (context as any).connect();
    try { return await fn(client); } finally { await client.end(); }
  };
  const pool: PoolLike<Queryable> = {
    connect: async () => {
      if (!testDatabaseUrl) {
        const client = (context as any).client;
        return { query: (text: string, values?: unknown[]) => client.query(text, values), release: () => {} };
      }
      const client = await (context as any).connect();
      return Object.assign(client, { release: () => { void client.end(); } });
    },
  };

  test('reads tables, keys and foreign keys', async () => {
    await context.exec(saas);
    const tables = await withClient(client => readTables(client));
    const folder = tables.find(table => table.name === "folder")!;
    expect(folder.primaryKey).toEqual(["id"]);
    expect(folder.columns.map(column => column.name)).toEqual(["id", "org_id", "parent_id", "name"]);
    expect(folder.foreignKeys).toEqual([
      { column: "org_id", schema: "public", table: "organization", key: "id" },
      { column: "parent_id", schema: "public", table: "folder", key: "id" },
    ]);
    expect(tables.find(table => table.name === "folder_tag")!.primaryKey).toEqual(["folder_id", "tag"]);
  });

  test('proposes a config whose migration runs, and lets a user read what is shared with them', async () => {
    await context.exec(saas);
    const users = [context.database_user_username];
    const { config, notes } = proposeConfig(await withClient(client => readTables(client)), { users });
    expect(validateConfig(config).success).toBe(true);
    expect(config.engine!.id).toEqual({ mode: "uuid" });
    const byName = Object.fromEntries((config.tables as any[]).map(table => [table.name, table]));
    expect(Object.keys(byName).sort()).toEqual(["document", "folder", "member", "organization", "user"]);
    expect(byName.organization).toMatchObject({ isResource: true, isRole: true });
    expect(byName.organization.resourceParent).toBeUndefined();
    // A folder in a folder, or else at the top of its organization
    expect(byName.folder.resourceParent).toEqual([
      { column: "parent_id", table: "folder", key: "id" },
      { column: "org_id", table: "organization", key: "id" },
    ]);
    // The author is a person, not a parent
    expect(byName.document.resourceParent).toEqual({ column: "folder_id", table: "folder", key: "id" });
    expect(byName.member).toEqual({ name: "member", isRole: true, roleParent: { column: "org_id", table: "organization", key: "id" } });
    expect(byName.user).toEqual({ name: "user", isRole: true });
    expect(notes.join("\n")).toContain("folder_tag: left out");
    expect(notes.join("\n")).toContain("session: left out");
    expect(notes.join("\n")).toContain("account: left out");

    await context.exec(createMigration(config));
    await context.exec(sql`grant select, insert, update, delete on "organization", "folder", "document" to ${raw(`"${users[0]}"`)}`);
    const size = getCompleteConfig(config).engine.permission.bitmap.size;
    await context.exec(sql`
      insert into "organization" ("id", "name") values ('00000000-0000-0000-0000-000000000001', 'Acme');
      insert into "user" ("id", "email") values ('00000000-0000-0000-0000-00000000000a', 'ann@acme.test'), ('00000000-0000-0000-0000-00000000000b', 'bob@acme.test');
      insert into "folder" ("id", "org_id", "name") values ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Specs');
      insert into "document" ("folder_id", "title") values ('00000000-0000-0000-0000-000000000002', 'Roadmap');
      insert into "assignment_edge" ("resource_id", "role_id", "permission")
        select "organization"."resource_id", "user"."role_id", repeat('1', ${raw(String(size))})::bit(${raw(String(size))})
        from "organization", "user" where "user"."email" = 'ann@acme.test';`);
    const [roles] = await context.runTestQuery(sql`select "email", "role_id" from "user"`);
    const roleOf = (email: string) => roles.find((row: { email: string }) => row.email === email).role_id;
    const identity = createIdentity(config);
    const titles = (roleId: string) => identity.run(pool, roleId, async client => (await client.query<{ title: string }>(`select "title" from "document"`)).rows.map(row => row.title));
    expect(await titles(roleOf("ann@acme.test"))).toEqual(["Roadmap"]);
    expect(await titles(roleOf("bob@acme.test"))).toEqual([]);
  });

  test('leaves out the tables of p9s, of a database that ran a migration', async () => {
    await context.exec(saas);
    const users = [context.database_user_username];
    await context.exec(createMigration(proposeConfig(await withClient(client => readTables(client)), { users }).config));
    const { config } = proposeConfig(await withClient(client => readTables(client)), { users });
    expect((config.tables as any[]).map(table => table.name).sort()).toEqual(["document", "folder", "member", "organization", "user"]);
  });
});
