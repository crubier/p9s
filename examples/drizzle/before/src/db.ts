import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.ts";

export * from "./schema.ts";

export const db = drizzle(new pg.Pool({ connectionString: process.env.DATABASE_URL }), { schema });

// The columns of a document in the API
export const documentColumns = {
  id: schema.documents.id,
  project_id: schema.documents.projectId,
  title: schema.documents.title,
  body: schema.documents.body,
};
