import { Pool } from "pg";

// Connects as the owner of the tables. PostGraphile switches to app_user for every request; Better Auth, finding who a
// request is from and the bulk of the seed work as the owner
export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// The database closes connections that stay idle, as those of a Vercel function that sleeps between requests: the
// pool drops them and opens new ones
pool.on("error", (error) => console.warn(`Idle database connection closed: ${error.message}`));
