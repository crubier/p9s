import { createMigration } from "@p9s/postgres";
import { compile } from "pg-sql2";

// Positions in the 8 bit permission bitmap, counted from the left
export const BIT = {
  read: 0,
  create: 1,
  edit: 2,
  delete: 3,
  comment: 4,
  share: 5,
  // Read the organization, its people and teams
  directory: 6,
  // Manage people and teams
  admin: 7,
} as const;

export type Capability = keyof typeof BIT;

export const bitmap = (...capabilities: Capability[]) => {
  const bits = Array<string>(8).fill("0");
  for (const capability of capabilities) bits[BIT[capability]] = "1";
  return bits.join("");
};

export const VIEWER = bitmap("read");
export const COMMENTER = bitmap("read", "comment");
export const EDITOR = bitmap("read", "create", "edit", "delete", "comment");
export const MANAGER = bitmap("read", "create", "edit", "delete", "comment", "share");
export const MEMBER = bitmap("directory");
export const ADMIN = bitmap("read", "create", "edit", "delete", "comment", "share", "directory", "admin");

// Whoever reads a project or a task sees who has access to it, and whoever has the share bit shares it
const content = { app_user: { select: BIT.read, insert: BIT.create, update: BIT.edit, delete: BIT.delete, manageAccess: BIT.read, share: BIT.share } };
const directory = { app_user: { select: BIT.directory, insert: BIT.admin, update: BIT.admin, delete: BIT.admin } };
const organization = { column: "org_id", table: "organization", key: "id" };

export const p9sConfig = {
  engine: {
    users: ["app_user"],
    graphWriters: ["app_backend"],
    authentication: { getCurrentUserId: "current_role_id" },
    id: { mode: "uuid" as const },
    combineAssignmentsWith: "role" as const,
    permission: { bitmap: { size: 8 }, maxDepth: { resource: 8, role: 8 } },
    // Keys of the node views and of the views of p9s, internal objects hidden from GraphQL, and a permission field on
    // projects, tasks, people, teams and organizations
    postgraphile: true,
  },
  tables: [
    { name: "organization", isResource: true, resourceId: "resource_id", isRole: true, roleId: "role_id", permission: { app_user: { select: BIT.directory } } },
    // People and teams are resources too, so that RLS decides who sees them
    {
      name: "person", isResource: true, resourceId: "resource_id", resourceParent: organization,
      isRole: true, roleId: "role_id", roleParent: organization, permission: directory,
    },
    { name: "team", isResource: true, resourceId: "resource_id", resourceParent: organization, isRole: true, roleId: "role_id", permission: directory },
    { name: "project", isResource: true, resourceId: "resource_id", resourceParent: organization, permission: content },
    { name: "task", isResource: true, resourceId: "resource_id", resourceParent: { column: "project_id", table: "project", key: "id" }, permission: content },
    {
      name: "comment", isResource: true, resourceLeaf: true, resourceParent: { column: "task_id", table: "task", key: "id" },
      permission: { app_user: { select: BIT.read, insert: BIT.comment, update: BIT.edit, delete: BIT.delete } },
    },
  ],
};

// `bun run db:p9s` writes the migration, `bun run db:migrate` applies it after sql/schema.sql
if (import.meta.main) {
  const { text } = compile(createMigration(p9sConfig));
  await Bun.write(new URL("../sql/p9s.sql", import.meta.url), text);
  console.log("Wrote sql/p9s.sql");
}
