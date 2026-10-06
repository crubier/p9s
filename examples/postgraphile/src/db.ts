import { Pool } from "pg";

// Connects as the owner of the tables: PostGraphile switches to app_user for every request, the seed and the login
// work on their own behalf
export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
