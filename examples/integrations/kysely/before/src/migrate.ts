import { FileMigrationProvider, Migrator } from "kysely/migration";
import { promises as fs } from "node:fs";
import path from "node:path";
import { db } from "./db.ts";

const migrator = new Migrator({
  db,
  provider: new FileMigrationProvider({ fs, path, migrationFolder: path.join(import.meta.dir, "../migrations") }),
});

const { error, results } = await migrator.migrateToLatest();
for (const result of results ?? []) console.log(`${result.migrationName}: ${result.status}`);
await db.destroy();
if (error) {
  console.error(error);
  process.exit(1);
}
