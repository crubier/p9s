import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, primaryKey, serial, text } from "drizzle-orm/pg-core";

export type Access = "viewer" | "editor" | "owner";

export const users = pgTable("users", {
  id: serial().primaryKey(),
  name: text().notNull().unique(),
});

export const teams = pgTable("teams", {
  id: serial().primaryKey(),
  name: text().notNull().unique(),
});

export const teamMembers = pgTable("team_members", {
  teamId: integer("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
}, table => [primaryKey({ columns: [table.teamId, table.userId] })]);

export const projects = pgTable("projects", {
  id: serial().primaryKey(),
  name: text().notNull(),
});

export const projectShares = pgTable("project_shares", {
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  teamId: integer("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  access: text().$type<Access>().notNull(),
}, table => [
  primaryKey({ columns: [table.projectId, table.teamId] }),
  check("project_shares_access_check", sql`${table.access} in ('viewer', 'editor', 'owner')`),
]);

export const documents = pgTable("documents", {
  id: serial().primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  title: text().notNull(),
  body: text().notNull().default(""),
}, table => [index("documents_project_id_idx").on(table.projectId)]);

export const documentShares = pgTable("document_shares", {
  documentId: integer("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  access: text().$type<Exclude<Access, "owner">>().notNull(),
}, table => [
  primaryKey({ columns: [table.documentId, table.userId] }),
  check("document_shares_access_check", sql`${table.access} in ('viewer', 'editor')`),
]);
