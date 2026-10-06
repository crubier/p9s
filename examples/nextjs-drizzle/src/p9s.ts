import { generateConfigurationFromDrizzleSchema } from "@p9s/drizzle";
import { createMigration } from "@p9s/postgres";
import { compile } from "pg-sql2";
import { BIT, BITMAP_SIZE } from "../lib/permissions";
import * as schema from "./schema";

// Whoever can read a folder or a document sees who else has access to it, like in the "Share" dialog, and whoever
// has the share bit gives access to it, with bits they have
const content = { app_user: { select: BIT.read, insert: BIT.create, update: BIT.edit, delete: BIT.delete, manageAccess: BIT.read, share: BIT.share } };
const directory = { app_user: { select: BIT.directory, insert: BIT.admin, update: BIT.admin, delete: BIT.admin } };
const organization = { column: "org_id", table: "organization", key: "id" };

export const p9sConfig = generateConfigurationFromDrizzleSchema(schema, {
  // Database role the Next.js server switches to for requests made on behalf of a member
  users: ["app_user"],
  tables: {
    user: { isResource: false, isRole: false },
    session: { isResource: false },
    account: { isResource: false, isRole: false },
    verification: { isResource: false },
    // Root of both trees. Organizations are created by the server, there is nothing above them to check
    organization: {
      isResource: true, resourceId: "resource_id", isRole: true, roleId: "role_id",
      permission: { app_user: { select: BIT.directory, update: BIT.admin, delete: BIT.admin } },
    },
    // Teams and members are resources too, so that RLS decides who manages them
    team: { isResource: true, resourceId: "resource_id", resourceParent: organization, isRole: true, roleId: "role_id", permission: directory },
    member: {
      isResource: true, resourceId: "resource_id", resourceParent: organization,
      isRole: true, roleId: "role_id", roleParent: organization,
      permission: directory,
    },
    // Keys act with the permissions of their member
    api_key: { isResource: false, isRole: true, roleId: "role_id", roleLeaf: true, roleParent: { column: "member_id", table: "member", key: "id" } },
    // `parent_resource_id` holds the resource id of the parent folder, or of the organization for a space
    folder: { isResource: true, resourceId: "resource_id", resourceParent: { column: "parent_resource_id" }, permission: content },
    document: { isResource: true, resourceId: "resource_id", resourceParent: { column: "folder_id", table: "folder", key: "id" }, permission: content },
    comment: {
      isResource: true, resourceLeaf: true, resourceParent: { column: "document_id", table: "document", key: "id" },
      permission: { app_user: { select: BIT.read, insert: BIT.comment, update: BIT.edit, delete: BIT.delete } },
    },
    // Only admins read the audit log. app_user is only granted select on it: triggers write it, nobody changes it
    audit_event: {
      isResource: true, resourceLeaf: true, resourceParent: organization,
      permission: { app_user: { select: BIT.admin, insert: BIT.admin, update: BIT.admin, delete: BIT.admin } },
    },
  },
  engine: {
    // Role the server switches to for shares and team memberships, which change the graph
    graphWriters: ["app_backend"],
    authentication: { getCurrentUserId: "current_role_id" },
    id: { mode: "uuid" },
    combineAssignmentsWith: "role",
    permission: { bitmap: { size: BITMAP_SIZE }, maxDepth: { resource: 16, role: 8 } },
  },
  migration: { output: { sql: "migrations/p9s.sql" } },
});

// `bun run db:p9s` writes the migration, `bun run db:migrate` applies it after the Drizzle migrations
if (import.meta.main) {
  const { text } = compile(createMigration(p9sConfig));
  await Bun.write(new URL(`../${p9sConfig.migration!.output!.sql}`, import.meta.url), text);
  console.log(`Wrote ${p9sConfig.migration!.output!.sql}`);
}
