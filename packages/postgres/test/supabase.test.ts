import { expect, describe, test, beforeEach, afterEach } from 'bun:test'
import { Client } from "pg";
import { query as sql, raw } from "pg-sql2";
import { supabase, type Config } from "@p9s/core";
import { setupTests, testDatabaseUrl } from '@p9s/postgres-testing';
import { diagnose } from '../doctor';
import { createMigration } from '../generation';
import { createIdentity, type PoolLike, type Queryable } from '../identity';

const ANN = "00000000-0000-0000-0000-00000000000a";
const BOB = "00000000-0000-0000-0000-00000000000b";

// The roles and auth.uid() of Supabase, and its default privileges, which give anon and authenticated every table
const emulateSupabase = async (admin: string) => {
  const root = new Client({ connectionString: testDatabaseUrl });
  await root.connect();
  try {
    for (const role of ["anon", "authenticated", "service_role"]) {
      await root.query(`do $$ begin create role ${role} nologin${role === "service_role" ? " bypassrls" : ""}; exception when duplicate_object then null; end $$`);
      await root.query(`grant ${role} to "${admin}"`);
    }
  } finally {
    await root.end();
  }
};

const config: Config<"authenticated"> = {
  engine: { ...supabase },
  tables: [
    { name: "profiles", isRole: true, roleId: "id" },
    { name: "project", isResource: true, permission: { authenticated: { select: 0, insert: 1, update: 2, delete: 3 } } },
    {
      name: "task", isResource: true, resourceParent: { column: "project_id", table: "project", key: "id" },
      permission: { authenticated: { select: 0, insert: 1, update: 2, delete: 3 } },
    },
  ],
};

describe.skipIf(!testDatabaseUrl)('Supabase (real Postgres only)', () => {
  const { setup, teardown, context } = setupTests();
  beforeEach(setup);
  afterEach(teardown);

  const asRole = async (role: string, claims: object | null, query: string) => {
    const client = await (context as any).connect();
    try {
      await client.query("begin");
      await client.query(`set local role ${role}`);
      if (claims) await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
      const { rows } = await client.query(query);
      await client.query("commit");
      return rows;
    } finally {
      await client.end();
    }
  };

  test('signed in users read what is shared with their profile, anon reads nothing and cannot reach the graph', async () => {
    await emulateSupabase(context.database_admin_username);
    await context.exec(sql`
      create schema "auth";
      create function "auth"."uid"() returns uuid language sql stable as $$
        select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
      $$;
      grant usage on schema "auth" to anon, authenticated, service_role;
      alter default privileges in schema "public" grant all on tables to anon, authenticated, service_role;
      alter default privileges in schema "public" grant all on sequences to anon, authenticated, service_role;
      alter default privileges in schema "public" grant execute on functions to anon, authenticated, service_role;
      create table "profiles" ("id" uuid primary key, "name" text not null);
      create table "project" ("id" uuid primary key default gen_random_uuid(), "name" text not null);
      create table "task" ("id" uuid primary key default gen_random_uuid(), "project_id" uuid not null references "project", "title" text not null);
      create index on "task" ("project_id");`);
    await context.exec(createMigration(config));
    await context.exec(sql`
      insert into "profiles" ("id", "name") values (${raw(`'${ANN}'`)}, 'Ann'), (${raw(`'${BOB}'`)}, 'Bob');
      insert into "project" ("id", "name") values ('00000000-0000-0000-0000-000000000001', 'Launch');
      insert into "task" ("project_id", "title") values ('00000000-0000-0000-0000-000000000001', 'Write the docs');
      insert into "assignment_edge" ("resource_id", "role_id", "permission")
        select "resource_id", ${raw(`'${ANN}'`)}, ~ b'0'::bit(128) from "project";`);

    // As PostgREST runs requests: the role, then the claims of the JWT
    expect(await asRole("authenticated", { sub: ANN, role: "authenticated" }, `select "title" from "task"`)).toEqual([{ title: "Write the docs" }]);
    expect(await asRole("authenticated", { sub: BOB, role: "authenticated" }, `select "title" from "task"`)).toEqual([]);
    expect(await asRole("anon", null, `select "title" from "task"`)).toEqual([]);
    for (const query of [`select * from "resource_edge"`, `select * from "assignment_edge"`, `select "resource_edge_cache_backfill"()`]) {
      await expect(asRole("anon", null, query)).rejects.toThrow(/permission denied/);
    }

    // A server that connects directly sets the claim auth.uid() reads
    const identity = createIdentity(config, { setting: "request.jwt.claim.sub" });
    const pool: PoolLike<Queryable> = {
      connect: async () => {
        const client = await (context as any).connect();
        return Object.assign(client, { release: () => { void client.end(); } });
      },
    };
    expect(await identity.run(pool, ANN, async client => (await client.query<{ title: string }>(`select "title" from "task"`)).rows)).toEqual([{ title: "Write the docs" }]);

    const client = await (context as any).connect();
    try {
      const findings = await diagnose(client, config);
      expect(findings.filter(finding => finding.level === "error")).toEqual([]);
    } finally {
      await client.end();
    }
  });
});
