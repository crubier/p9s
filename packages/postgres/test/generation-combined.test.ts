import { expect, test } from 'bun:test'
import { compile } from "pg-sql2";
import { createMigration } from '../generation'

// Behaviour is covered by the database tests, these only pin what is specific to combined assignment caches
const migrationFor = (combineAssignmentsWith: "none" | "role" | "resource") => compile(createMigration({
  engine: {
    permission: { bitmap: { size: 4 } },
    users: ["user1"],
    combineAssignmentsWith
  },
  tables: [{
    name: "blog_post",
    isResource: true,
    resourceId: "resource_id",
    permission: { user1: { select: 0, insert: 1, update: 1, delete: 1 } }
  }]
})).text;

const policyFor = (migration: string) => migration.slice(migration.indexOf(`create policy "blog_post_user1_select_policy"`)).split(";")[0]!;
// Policies read the graph through a view of the resources the current user has their bit on, which functions check
// and list
const accessFor = (migration: string) => {
  expect(policyFor(migration)).toContain(`"current_resource_access_0_check"("blog_post"."resource_id")`);
  expect(policyFor(migration)).toContain(`"blog_post"."resource_id" in (select "current_resource_access_0_list"())`);
  expect(migration).toContain(`return exists (select from "current_resource_access_0" as "var_access"`);
  expect(migration).toContain(`return query select "var_access"."resource_id" from "current_resource_access_0" as "var_access"`);
  return migration.slice(migration.indexOf(`create or replace view "current_resource_access_0"`)).split(";")[0]!;
};

test('role mode keeps assignment_edge_cache in sync with triggers and reads it in policies', () => {
  const migration = migrationFor("role");
  for (const event of ["insert", "update", "delete"]) {
    expect(migration).toContain(`create trigger "10_assignment_edge_${event}_trigger"\nafter ${event} on "assignment_edge"`);
    expect(migration).toContain(`create trigger "20_assignment_edge_role_${event}_trigger"\nafter ${event} on "role_edge_cache"`);
  }
  expect(accessFor(migration)).toContain(`"assignment_edge_cache" as "the_assignment_edge"`);
  expect(accessFor(migration)).not.toContain(`"role_edge_cache"`);
});

test('resource mode keeps assignment_edge_cache in sync with triggers and reads it in policies', () => {
  const migration = migrationFor("resource");
  for (const event of ["insert", "update", "delete"]) {
    expect(migration).toContain(`create trigger "20_assignment_edge_resource_${event}_trigger"\nafter ${event} on "resource_edge_cache"`);
  }
  expect(accessFor(migration)).toContain(`"assignment_edge_cache" as "the_assignment_edge"`);
  expect(accessFor(migration)).not.toContain(`"resource_edge_cache"`);
});

test('none mode reads the three graph tables and removes any previous combined cache', () => {
  const migration = migrationFor("none");
  expect(accessFor(migration)).toContain(`"resource_edge_cache" as "the_resource_edge"`);
  expect(accessFor(migration)).toContain(`"assignment_edge" as "the_assignment_edge"`);
  expect(accessFor(migration)).toContain(`"role_edge_cache" as "the_role_edge"`);
  expect(migration).toContain(`drop table if exists "assignment_edge_cache";`);
  expect(migration).not.toContain(`create trigger "10_assignment_edge_insert_trigger"`);
});
