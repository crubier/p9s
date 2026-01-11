import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Command } from "commander";
import { compile } from "pg-sql2";
import { createMigration } from "@p9s/postgres";
import { getCompleteConfig } from "@p9s/core";
import { loadConfig } from "../config.js";

export const postgres = new Command()
  .name("postgres")
  .description("PostgreSQL related commands");

postgres
  .command("generate")
  .description("Generate PostgreSQL migration SQL")
  .option(
    "-c, --config <path>",
    "path to config file"
  )
  .option(
    "-o, --output <path>",
    "output file path (default: from config or p9s-migration.sql)"
  )
  .action(async (opts) => {
    console.log("Loading configuration...");

    const config = await loadConfig({ configPath: opts.config });
    const completeConfig = getCompleteConfig(config);

    const outputPath: string = opts.output ?? completeConfig.migration?.output?.sql ?? "p9s-migration.sql";

    console.log("Generating PostgreSQL migration...");

    const migration = createMigration(config);
    const sql = compile(migration).text;

    const outputDir = path.dirname(outputPath);
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(outputPath, sql, "utf-8");

    console.log(`Migration written to: ${outputPath}`);
  });
