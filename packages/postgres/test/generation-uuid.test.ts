import { expect, test } from 'bun:test'
import { compile } from "pg-sql2";
import { createMigration } from '../generation'

// Behaviour is covered by the database tests, these only pin what is specific to uuid mode
const migration = compile(createMigration({
  engine: {
    permission: { bitmap: { size: 4 } },
    users: ["user1"],
    id: { mode: 'uuid' }
  },
  tables: [{
    name: "blog_post",
    isResource: true,
    resourceId: "resource_id",
    permission: { user1: { select: 0, insert: 1, update: 1, delete: 1 } }
  }]
})).text;

test('uuid mode installs uuid-ossp and uses uuid ids everywhere', () => {
  expect(migration).toContain(`create extension if not exists "uuid-ossp";`);
  expect(migration).toContain(`alter table "public"."blog_post" alter column "resource_id" set default uuid_generate_v4();`);
  expect(migration).toContain(`"parent_id" uuid not null`);
  expect(migration).not.toContain(`create sequence`);
  expect(migration).toContain(`array[]::uuid[]`);
  expect(migration).toContain(`alter table "public"."blog_post" add column if not exists "resource_id" uuid unique;`);
  expect(migration).not.toMatch(/\binteger\b|\bserial\b/);
});
