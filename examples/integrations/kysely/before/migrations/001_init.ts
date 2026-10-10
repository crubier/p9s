import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>) {
  await db.schema.createTable("users")
    .addColumn("id", "serial", col => col.primaryKey())
    .addColumn("name", "text", col => col.notNull().unique())
    .execute();
  await db.schema.createTable("teams")
    .addColumn("id", "serial", col => col.primaryKey())
    .addColumn("name", "text", col => col.notNull().unique())
    .execute();
  await db.schema.createTable("team_members")
    .addColumn("team_id", "integer", col => col.notNull().references("teams.id").onDelete("cascade"))
    .addColumn("user_id", "integer", col => col.notNull().references("users.id").onDelete("cascade"))
    .addPrimaryKeyConstraint("team_members_pkey", ["team_id", "user_id"])
    .execute();
  await db.schema.createTable("projects")
    .addColumn("id", "serial", col => col.primaryKey())
    .addColumn("name", "text", col => col.notNull())
    .execute();
  await db.schema.createTable("project_shares")
    .addColumn("project_id", "integer", col => col.notNull().references("projects.id").onDelete("cascade"))
    .addColumn("team_id", "integer", col => col.notNull().references("teams.id").onDelete("cascade"))
    .addColumn("access", "text", col => col.notNull().check(sql`access in ('viewer', 'editor', 'owner')`))
    .addPrimaryKeyConstraint("project_shares_pkey", ["project_id", "team_id"])
    .execute();
  await db.schema.createTable("documents")
    .addColumn("id", "serial", col => col.primaryKey())
    .addColumn("project_id", "integer", col => col.notNull().references("projects.id").onDelete("cascade"))
    .addColumn("title", "text", col => col.notNull())
    .addColumn("body", "text", col => col.notNull().defaultTo(""))
    .execute();
  await db.schema.createIndex("documents_project_id_idx").on("documents").column("project_id").execute();
  await db.schema.createTable("document_shares")
    .addColumn("document_id", "integer", col => col.notNull().references("documents.id").onDelete("cascade"))
    .addColumn("user_id", "integer", col => col.notNull().references("users.id").onDelete("cascade"))
    .addColumn("access", "text", col => col.notNull().check(sql`access in ('viewer', 'editor')`))
    .addPrimaryKeyConstraint("document_shares_pkey", ["document_id", "user_id"])
    .execute();
}

export async function down(db: Kysely<unknown>) {
  for (const table of ["document_shares", "documents", "project_shares", "projects", "team_members", "teams", "users"]) {
    await db.schema.dropTable(table).execute();
  }
}
