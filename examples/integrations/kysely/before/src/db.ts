import { Kysely, PostgresDialect, type Generated } from "kysely";
import pg from "pg";

export type Access = "viewer" | "editor" | "owner";

export interface Database {
  users: { id: Generated<number>; name: string };
  teams: { id: Generated<number>; name: string };
  team_members: { team_id: number; user_id: number };
  projects: { id: Generated<number>; name: string };
  project_shares: { project_id: number; team_id: number; access: Access };
  documents: { id: Generated<number>; project_id: number; title: string; body: Generated<string> };
  document_shares: { document_id: number; user_id: number; access: Exclude<Access, "owner"> };
}

export const db = new Kysely<Database>({
  dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: process.env.DATABASE_URL }) }),
});
