import { pool } from "./db";

// The business tables, the p9s migration that binds them to the permission graph, then what the API adds on top
const files = ["../sql/schema.sql", "../sql/p9s.sql", "../sql/app.sql"];

export const migrate = async () => {
  const client = await pool.connect();
  try {
    await client.query("set client_min_messages = warning");
    for (const file of files) {
      await client.query(await Bun.file(new URL(file, import.meta.url)).text());
    }
  } finally {
    client.release();
  }
};

if (import.meta.main) {
  await migrate();
  await pool.end();
  console.log("Migrated");
}
