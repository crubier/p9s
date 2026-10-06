import { createMigration } from "@p9s/postgres";
import { compile } from "pg-sql2";
import { BIT, BITMAP_SIZE } from "../lib/permissions.js";

// Whoever can read a folder or a document sees who else has access to it, like in the "Share" dialog, and whoever
// has the share bit gives access to it, with bits they have
const content = { app_user: { select: BIT.read, insert: BIT.create, update: BIT.edit, delete: BIT.delete, manageAccess: BIT.read, share: BIT.share } };
const directory = { app_user: { select: BIT.directory, insert: BIT.admin, update: BIT.admin, delete: BIT.admin } };
const organization = { column: "org_id", table: "organization", key: "id" };

export const p9sConfig = {
  engine: {
    // The database role PostGraphile switches to for every request
    users: ["app_user"],
    // The role the functions of sql/app.sql switch to for shares and team memberships, which change the graph
    graphWriters: ["app_backend"],
    authentication: { getCurrentUserId: "current_role_id" },
    id: { mode: "uuid" as const },
    combineAssignmentsWith: "role" as const,
    // Only shared resources have the rows of what is below them
    resourceCache: "assigned" as const,
    // Named bits give permission_flags, a boolean per bit, which the permission fields of GraphQL return
    permission: { bitmap: { size: BITMAP_SIZE, names: BIT }, maxDepth: { resource: 16, role: 8 } },
    // Keys of the node views and of the views of p9s, internal objects hidden from GraphQL, and a permission field on
    // every resource table
    postgraphile: true,
  },
  tables: [
    // Root of both trees. Organizations are created by the server, there is nothing above them to check
    {
      name: "organization", isResource: true, resourceId: "resource_id", isRole: true, roleId: "role_id",
      permission: { app_user: { select: BIT.directory, update: BIT.admin, delete: BIT.admin } },
    },
    // Teams and members are resources too, so that RLS decides who manages them
    { name: "team", isResource: true, resourceId: "resource_id", resourceParent: organization, isRole: true, roleId: "role_id", permission: directory },
    {
      name: "member", isResource: true, resourceId: "resource_id", resourceParent: organization,
      isRole: true, roleId: "role_id", roleParent: organization, permission: directory,
    },
    // Keys act with the permissions of their member
    { name: "api_key", isRole: true, roleId: "role_id", roleLeaf: true, roleParent: { column: "member_id", table: "member", key: "id" } },
    // In its parent folder, or else at the top of the organization. folder_search and document_search match names,
    // titles and contents through their trigram indexes
    {
      name: "folder", isResource: true, resourceId: "resource_id", resourceParent: [{ column: "parent_id", table: "folder", key: "id" }, organization],
      permission: content, search: { search: { columns: ["name"], operator: "ilike" as const } },
    },
    {
      name: "document", isResource: true, resourceId: "resource_id", resourceParent: { column: "folder_id", table: "folder", key: "id" },
      permission: content, search: { search: { columns: ["title", "content"], operator: "ilike" as const } },
    },
    {
      name: "comment", isResource: true, resourceLeaf: true, resourceParent: { column: "document_id", table: "document", key: "id" },
      permission: { app_user: { select: BIT.read, insert: BIT.comment, update: BIT.edit, delete: BIT.delete } },
    },
    // Only admins read the audit log. Triggers write it, nobody changes it
    {
      name: "audit_event", isResource: true, resourceLeaf: true, resourceParent: organization,
      permission: { app_user: { select: BIT.admin, insert: BIT.admin, update: BIT.admin, delete: BIT.admin } },
    },
  ],
};

// `bun run db:p9s` writes the migration, `bun run db:migrate` applies it after sql/schema.sql
if (import.meta.main) {
  const { text } = compile(createMigration(p9sConfig));
  await Bun.write(new URL("../sql/p9s.sql", import.meta.url), text);
  console.log("Wrote sql/p9s.sql");
}
