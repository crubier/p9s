import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Command } from "commander";
import { compile } from "pg-sql2";
import { createMigration, createMigrationFile, diagnose, migrate, migrationDirectories, migrationFormats, migrationStatus, type MigrationFormat, type MigrationRecord } from "@p9s/postgres";
import { getCompleteConfig } from "@p9s/core";
import { loadConfig } from "../config.js";
import { connect } from "../database.js";

// The module of the migrations of the Mix project of the current folder, from its app, like :my_app
const ectoModule = async () => {
  const mix = await fs.readFile("mix.exs", "utf-8").catch(() => "");
  const app = /\bapp:\s*:(\w+)/.exec(mix)?.[1];
  if (!app) return undefined;
  const name = app.split("_").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join("");
  return `${name}.Repo.Migrations`;
};

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
    "output file path (default: from config or p9s-migration.sql), or with --format the folder of the migrations of the tool"
  )
  .option("-f, --format <format>", `a migration of the tool of a stack, which runs with the other migrations of the app: ${migrationFormats.join(", ")}`)
  .option("--previous <migration>", "the migration this one comes after: the revision for alembic, app_label.migration_name for django")
  .option("--module <module>", "the module of the migrations for ecto (default: <App>.Repo.Migrations, from mix.exs)")
  .action(async (opts) => {
    console.log("Loading configuration...");

    const config = await loadConfig({ configPath: opts.config });
    const completeConfig = getCompleteConfig(config);

    if (opts.format !== undefined) {
      if (!(migrationFormats as readonly string[]).includes(opts.format)) {
        throw new Error(`Unknown format ${opts.format}, one of ${migrationFormats.join(", ")}`);
      }
      const format = opts.format as MigrationFormat;
      const module = opts.module ?? (format === "ecto" ? await ectoModule() : undefined);
      const { fileName, content } = createMigrationFile(config, format, { previous: opts.previous, module });
      const directory = format === "django" && opts.previous ? path.join(opts.previous.split(".")[0], "migrations") : migrationDirectories[format];
      const file = path.join(opts.output ?? directory, fileName);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, content, "utf-8");
      console.log(`Migration written to: ${file}`);
      return;
    }

    const outputPath: string = opts.output ?? completeConfig.migration?.output?.sql ?? "p9s-migration.sql";

    console.log("Generating PostgreSQL migration...");

    const migration = createMigration(config);
    const sql = compile(migration).text;

    const outputDir = path.dirname(outputPath);
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(outputPath, sql, "utf-8");

    console.log(`Migration written to: ${outputPath}`);
  });

postgres
  .command("migrate")
  .description("Run the migration of the config on a database, in one transaction, unless the database already ran it")
  .option("-c, --config <path>", "path to config file")
  .option("-d, --database-url <url>", "database to migrate (default: DATABASE_URL)")
  .option("--force", "run the migration even when the database already ran it")
  .option("--no-create-roles", "fail instead of creating the users and graph writers of the config that do not exist")
  .action(async (opts) => {
    const config = await loadConfig({ configPath: opts.config });
    const client = await connect(opts.databaseUrl);
    try {
      const { ran, createdRoles, before } = await migrate(client, config, { force: opts.force, createRoles: opts.createRoles });
      const describe = (record: MigrationRecord) => `p9s ${record.version}, migration ${record.hash}`;
      if (createdRoles.length > 0) console.log(`Created roles: ${createdRoles.join(", ")}`);
      console.log(ran ? `Migrated: ${describe(before.expected)}` : `Up to date: ${describe(before.expected)}`);
    } finally {
      await client.end();
    }
  });

postgres
  .command("doctor")
  .description("Check a database against the config: migration, RLS, grants, indexes, JIT and caches, exiting with 1 on an error")
  .option("-c, --config <path>", "path to config file")
  .option("-d, --database-url <url>", "database to check (default: DATABASE_URL)")
  .option("--sample <rows>", "rows of each tree whose cache is compared with a recompute", "200")
  .action(async (opts) => {
    const config = await loadConfig({ configPath: opts.config });
    const client = await connect(opts.databaseUrl);
    try {
      const findings = await diagnose(client, config, { sample: Number(opts.sample) });
      const marks = { ok: "ok   ", warn: "warn ", error: "error" };
      for (const { level, check, message } of findings) console.log(`${marks[level]} ${check}: ${message}`);
      process.exitCode = findings.some(finding => finding.level === "error") ? 1 : 0;
    } finally {
      await client.end();
    }
  });

postgres
  .command("status")
  .description("Tell whether a database ran the migration of the config, exiting with 1 when it did not")
  .option("-c, --config <path>", "path to config file")
  .option("-d, --database-url <url>", "database to check (default: DATABASE_URL)")
  .action(async (opts) => {
    const config = await loadConfig({ configPath: opts.config });
    const client = await connect(opts.databaseUrl);
    try {
      const { state, expected, installed } = await migrationStatus(client, config);
      const describe = (record: MigrationRecord) => `p9s ${record.version}, migration ${record.hash}`;
      if (state === "current") console.log(`Up to date: ${describe(expected)}`);
      if (state === "missing") console.log(`No p9s migration in this database. Run p9s postgres migrate, or generate it with p9s postgres generate and run it: ${describe(expected)}`);
      if (state === "outdated") console.log(`Outdated: the database ran ${describe(installed!)}, the config makes ${describe(expected)}`);
      process.exitCode = state === "current" ? 0 : 1;
    } finally {
      await client.end();
    }
  });
