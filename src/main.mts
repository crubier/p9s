import { compile } from "pg-sql2";
import { createMigration } from '../packages/postgres/generation'
import { writeFile, rm } from "fs/promises";
import path from "path";
import process from "process";

const main = async () => {
  const configFile = await import(path.resolve(process.cwd(), "./p9s.config.mts"));
  const config = configFile.default ?? configFile;
  const sqlText = compile(createMigration(config)).text;
  const cleanedSqlText = sqlText.replaceAll(/(\n\s*)(\n\s*)+/g, '\n\n');
  await rm("migrations/current.sql", { force: true });
  await writeFile("migrations/current.sql", cleanedSqlText);
}

main()