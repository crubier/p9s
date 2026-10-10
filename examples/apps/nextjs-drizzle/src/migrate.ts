import { migrate as migrateDrizzle } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./db";

// The Drizzle migrations create the tables, roles and functions the p9s migration expects, then p9s binds the
// tables to the permission graph, and the audit triggers attach to its edge tables. All are safe to run again.
export const migrate = async () => {
  const migrations = new URL("../migrations/", import.meta.url).pathname;
  await migrateDrizzle(db, { migrationsFolder: migrations });
  const client = await pool.connect();
  try {
    await client.query("set client_min_messages = warning");
    await client.query(await Bun.file(`${migrations}p9s.sql`).text());
    await client.query(await Bun.file(`${migrations}audit.sql`).text());
  } finally {
    client.release();
  }
};

if (import.meta.main) {
  await migrate();
  console.log("Database migrated");
  await pool.end();
}
