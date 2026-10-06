import { pool } from "./db.js";

// The tables, the p9s migration that binds them to the permission graph, the functions of the API, then the audit
// triggers, which attach to the edge tables of p9s. All are safe to run again.
const files = ["../sql/schema.sql", "../sql/p9s.sql", "../sql/app.sql", "../sql/audit.sql"];

export const migrate = async () => {
  const client = await pool.connect();
  try {
    await client.query("set client_min_messages = warning");
    for (const file of files) await client.query(await Bun.file(new URL(file, import.meta.url)).text());
  } finally {
    client.release();
  }
};

if (import.meta.main) {
  await migrate();
  await pool.end();
  console.log("Database migrated");
}
