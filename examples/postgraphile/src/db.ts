import { Pool } from "pg";

// Connects as the owner of the tables. PostGraphile switches to app_user for every request; Better Auth, finding who a
// request is from and the bulk of the seed work as the owner
export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
