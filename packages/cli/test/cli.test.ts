import { expect, describe, test, beforeAll, afterAll } from "bun:test";
import { $ } from "bun";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const testDir = import.meta.dir;
const sampleDir = path.resolve(testDir, "sample");
const cliPath = path.resolve(testDir, "../src/index.ts");
const configPath = path.resolve(sampleDir, "p9s.config.ts");
const outputPath = path.resolve(testDir, "output.sql");

describe("p9s CLI", () => {
  afterAll(() => {
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }
  });

  test("shows help with --help flag", async () => {
    const result = await $`bun run ${cliPath} --help`.text();

    expect(result).toContain("p9s");
    expect(result).toContain("Permission Tree CLI");
    expect(result).toContain("postgres");
    expect(result).toContain("--version");
    expect(result).toContain("--help");
  });

  test("shows version with --version flag", async () => {
    const result = await $`bun run ${cliPath} --version`.text();

    expect(result.trim()).toBe((await Bun.file(path.resolve(testDir, "../package.json")).json()).version);
  });

  test("shows postgres subcommand help", async () => {
    const result = await $`bun run ${cliPath} postgres --help`.text();

    expect(result).toContain("postgres");
    expect(result).toContain("generate");
    expect(result).toContain("PostgreSQL");
  });

  test("shows postgres generate help", async () => {
    const result = await $`bun run ${cliPath} postgres generate --help`.text();

    expect(result).toContain("Generate PostgreSQL migration SQL");
    expect(result).toContain("--config");
    expect(result).toContain("--output");
  });

  test("generates SQL migration from config file", async () => {
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }

    const result = await $`bun run ${cliPath} postgres generate --config ${configPath} --output ${outputPath}`.text();

    expect(result).toContain("Loading configuration");
    expect(result).toContain("Generating PostgreSQL migration");
    expect(result).toContain("Migration written to");

    expect(fs.existsSync(outputPath)).toBe(true);

    const sql = fs.readFileSync(outputPath, "utf-8");

    expect(sql).toContain("resource_node");
    expect(sql).toContain("role_node");
    expect(sql).toContain("assignment_edge");
    expect(sql).toContain("app_user");
    expect(sql).toContain("folder");
    expect(sql).toContain("bit(64)");
  });

  test("generates a migration in the format of the tool of each stack", async () => {
    const directory = fs.mkdtempSync(path.join(testDir, "formats-"));
    try {
      const formats = {
        alembic: [/^\d{14}_p9s_[0-9a-f]{8}\.py$/, /down_revision = "0001"/, /cursor\.execute\(SQL\)/],
        django: [/^0002_p9s_[0-9a-f]{8}\.py$/, /dependencies = \[\("documents", "0001_initial"\)\]/, /RunSQL\(\[SQL\]/],
        rails: [/^\d{14}_p9s_[0-9a-f]{8}\.rb$/, /class P9s[0-9A-F][0-9a-f]{7} < ActiveRecord::Migration\[7\.0\]/, /execute <<-'P9S_SQL'/],
        goose: [/^\d{14}_p9s_[0-9a-f]{8}\.sql$/, /-- \+goose Up\n-- \+goose StatementBegin\n/, /-- \+goose StatementEnd\n/],
        sqlx: [/^\d{14}_p9s_[0-9a-f]{8}\.sql$/, /^-- The migration of p9s/],
        ecto: [/^\d{14}_p9s_[0-9a-f]{8}\.exs$/, /defmodule MyApp\.Repo\.Migrations\.P9s[0-9A-F][0-9a-f]{7} do/, /query_type: :text/],
        laravel: [/^\d{4}_\d{2}_\d{2}_\d{6}_p9s_[0-9a-f]{8}\.php$/, /DB::unprepared\(<<<'P9S_SQL'/, /^P9S_SQL\);$/m],
      } as const;
      const options = { alembic: "--previous 0001", django: "--previous documents.0001_initial", ecto: "--module MyApp.Repo.Migrations" } as Record<string, string>;
      for (const [format, [fileName, ...contents]] of Object.entries(formats)) {
        const output = path.join(directory, format);
        const args = [...(options[format]?.split(" ") ?? [])];
        await $`bun run ${cliPath} postgres generate --config ${configPath} --format ${format} --output ${output} ${args}`.quiet();
        const [file] = fs.readdirSync(output);
        expect(file).toMatch(fileName);
        const content = fs.readFileSync(path.join(output, file!), "utf-8");
        for (const pattern of contents) expect(content).toMatch(pattern);
        expect(content).toContain(`create role "app_user" nologin`);
        expect(content).toContain("p9s_migration");
      }
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("a format that needs the previous migration says so", async () => {
    const result = await $`bun run ${cliPath} postgres generate --config ${configPath} --format alembic --output ${testDir}/unused`.nothrow().quiet();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("--previous");
    expect(fs.existsSync(path.join(testDir, "unused"))).toBe(false);
  });

  test("configures graph writers from a Drizzle schema", async () => {
    const drizzleSchemaPath = path.resolve(testDir, "../../drizzle/test/sample/schema1.ts");
    const drizzleOutputPath = path.resolve(testDir, "drizzle-output.json");
    try {
      await $`bun run ${cliPath} drizzle configure --schema ${drizzleSchemaPath} --output ${drizzleOutputPath} --users app_user --graph-writers app_backend,migrator`.text();
      const config = JSON.parse(fs.readFileSync(drizzleOutputPath, "utf-8"));

      expect(config.engine.users).toEqual(["app_user"]);
      expect(config.engine.graphWriters).toEqual(["app_backend", "migrator"]);
    } finally {
      fs.rmSync(drizzleOutputPath, { force: true });
    }
  });

  test.skipIf(!process.env.P9S_TEST_DATABASE_URL)("tells whether the database ran the migration of the config", async () => {
    const rootUrl = process.env.P9S_TEST_DATABASE_URL!;
    const databaseName = `p9s_cli_${Date.now()}`;
    const url = new URL(rootUrl);
    url.pathname = `/${databaseName}`;
    const statusConfigPath = path.resolve(testDir, "status.config.json");
    const statusOutputPath = path.resolve(testDir, "status.sql");
    const config = (bits: number) => ({
      engine: { users: ["app_user"], permission: { bitmap: { size: bits } }, authentication: { getCurrentUserId: "get_current_user_id", setting: "app.user_id" }, id: { mode: "integer" } },
      tables: [{ name: "folder", isResource: true, permission: { app_user: { select: 0, insert: 1, update: 2, delete: 3 } } }],
    });
    const status = () => $`bun run ${cliPath} postgres status --config ${statusConfigPath} --database-url ${url.toString()}`.nothrow().quiet();
    const pg = (await import("pg")).default;
    const run = async (connectionString: string, text: string) => {
      const client = new pg.Client({ connectionString });
      await client.connect();
      try { await client.query(text); } finally { await client.end(); }
    };
    await run(rootUrl, `create database ${databaseName}`);
    try {
      await run(url.toString(), `
        do $$ begin create role app_user; exception when duplicate_object then null; end $$;
        create table folder (id integer primary key generated by default as identity);`);
      fs.writeFileSync(statusConfigPath, JSON.stringify(config(64)));

      const missing = await status();
      expect(missing.exitCode).toBe(1);
      expect(missing.stdout.toString()).toContain("No p9s migration");

      await $`bun run ${cliPath} postgres generate --config ${statusConfigPath} --output ${statusOutputPath}`.quiet();
      await run(url.toString(), fs.readFileSync(statusOutputPath, "utf-8"));
      const current = await status();
      expect(current.exitCode).toBe(0);
      expect(current.stdout.toString()).toContain("Up to date");
      const doctor = await $`bun run ${cliPath} postgres doctor --config ${statusConfigPath} --database-url ${url.toString()}`.nothrow().quiet();
      expect(doctor.exitCode).toBe(0);
      expect(doctor.stdout.toString()).toContain("ok    rls: Row level security is on for the 1 resource tables");
      expect(doctor.stdout.toString()).toContain("warn  grants: app_user may not read");

      fs.writeFileSync(statusConfigPath, JSON.stringify(config(32)));
      const outdated = await status();
      expect(outdated.exitCode).toBe(1);
      expect(outdated.stdout.toString()).toContain("Outdated");
    } finally {
      fs.rmSync(statusConfigPath, { force: true });
      fs.rmSync(statusOutputPath, { force: true });
      await run(rootUrl, `drop database if exists ${databaseName} with (force)`);
    }
  });

  test.skipIf(!process.env.P9S_TEST_DATABASE_URL)("migrate runs the migration of a JSON config in one command, then finds the database up to date", async () => {
    const rootUrl = process.env.P9S_TEST_DATABASE_URL!;
    const stamp = Date.now();
    const databaseName = `p9s_cli_migrate_${stamp}`;
    const user = `app_user_${stamp}`;
    const url = new URL(rootUrl);
    url.pathname = `/${databaseName}`;
    const migrateConfigPath = path.resolve(testDir, "migrate.config.json");
    const pg = (await import("pg")).default;
    const run = async (connectionString: string, text: string) => {
      const client = new pg.Client({ connectionString });
      await client.connect();
      try { return await client.query(text); } finally { await client.end(); }
    };
    await run(rootUrl, `create database ${databaseName}`);
    try {
      await run(url.toString(), `create table folder (id integer primary key generated by default as identity, name text)`);
      fs.writeFileSync(migrateConfigPath, JSON.stringify({
        engine: { users: [user], authentication: { getCurrentUserId: "current_user_id", setting: "app.user_id" } },
        tables: [{ name: "folder", isResource: true, resourceId: "resource_id", permission: { [user]: { select: 0 } } }],
      }));
      const migrateCommand = () => $`bun run ${cliPath} postgres migrate --config ${migrateConfigPath} --database-url ${url.toString()}`.nothrow().quiet();

      const first = await migrateCommand();
      expect(first.exitCode).toBe(0);
      expect(first.stdout.toString()).toContain(`Created roles: ${user}`);
      expect(first.stdout.toString()).toContain("Migrated: p9s");
      const { rows } = await run(url.toString(), `select to_regclass('resource_edge') is not null as migrated`);
      expect(rows[0].migrated).toBe(true);

      const second = await migrateCommand();
      expect(second.exitCode).toBe(0);
      expect(second.stdout.toString()).toContain("Up to date: p9s");
      const status = await $`bun run ${cliPath} postgres status --config ${migrateConfigPath} --database-url ${url.toString()}`.nothrow().quiet();
      expect(status.exitCode).toBe(0);
    } finally {
      fs.rmSync(migrateConfigPath, { force: true });
      await run(rootUrl, `drop database if exists ${databaseName} with (force)`);
      await run(rootUrl, `drop role if exists ${user}`);
    }
  });

  test.skipIf(!process.env.P9S_TEST_DATABASE_URL)("init proposes a config from a database, which generates a migration that runs", async () => {
    const rootUrl = process.env.P9S_TEST_DATABASE_URL!;
    const databaseName = `p9s_cli_init_${Date.now()}`;
    const url = new URL(rootUrl);
    url.pathname = `/${databaseName}`;
    const initConfigPath = path.resolve(testDir, "init.config.ts");
    const initOutputPath = path.resolve(testDir, "init.sql");
    const pg = (await import("pg")).default;
    const run = async (connectionString: string, text: string) => {
      const client = new pg.Client({ connectionString });
      await client.connect();
      try { await client.query(text); } finally { await client.end(); }
    };
    await run(rootUrl, `create database ${databaseName}`);
    try {
      await run(url.toString(), `
        do $$ begin create role app_user; exception when duplicate_object then null; end $$;
        create table organization (id bigint primary key generated always as identity, name text);
        create table project (id bigint primary key generated always as identity, org_id bigint not null references organization);
        create table task (id bigint primary key generated always as identity, project_id bigint not null references project, parent_id bigint references task);`);

      const output = await $`bun run ${cliPath} init --database-url ${url.toString()} --output ${initConfigPath}`.text();
      expect(output).toContain("task: a resource under task (task.parent_id), or else project (task.project_id)");
      const written = fs.readFileSync(initConfigPath, "utf-8");
      expect(written).toContain(`const config: Config<"app_user"> = {`);
      expect(written).toContain("// - organization: a resource at the top of the tree, and a role");

      const again = await $`bun run ${cliPath} init --database-url ${url.toString()} --output ${initConfigPath}`.nothrow().quiet();
      expect(again.exitCode).toBe(1);
      expect(again.stderr.toString()).toContain("--force");

      await $`bun run ${cliPath} postgres generate --config ${initConfigPath} --output ${initOutputPath}`.quiet();
      await run(url.toString(), fs.readFileSync(initOutputPath, "utf-8"));
      const status = await $`bun run ${cliPath} postgres status --config ${initConfigPath} --database-url ${url.toString()}`.nothrow().quiet();
      expect(status.stdout.toString()).toContain("Up to date");
    } finally {
      fs.rmSync(initConfigPath, { force: true });
      fs.rmSync(initOutputPath, { force: true });
      await run(rootUrl, `drop database if exists ${databaseName} with (force)`);
    }
  });

  test("fails gracefully when no config file found", async () => {
    const fakeConfig = path.resolve(testDir, "nonexistent.config.ts");

    try {
      await $`bun run ${cliPath} postgres generate --config ${fakeConfig}`.text();
      expect(true).toBe(false);
    } catch (error: any) {
      expect(error.stderr.toString()).toContain("ENOENT");
    }
  });

  test("shows validate subcommand help", async () => {
    const result = await $`bun run ${cliPath} validate --help`.text();

    expect(result).toContain("validate");
    expect(result).toContain("config");
    expect(result).toContain("Validate configuration file");
  });

  test("shows validate config help", async () => {
    const result = await $`bun run ${cliPath} validate config --help`.text();

    expect(result).toContain("Validate the p9s configuration file");
    expect(result).toContain("--config");
    expect(result).toContain("--strict");
  });

  test("validates config file", async () => {
    const result = await $`bun run ${cliPath} validate config --config ${configPath}`.text();

    expect(result).toContain("Loading configuration");
    expect(result).toContain("Validating configuration");
  });

  test("validate fails gracefully when no config file found", async () => {
    const fakeConfig = path.resolve(testDir, "nonexistent.config.ts");

    try {
      await $`bun run ${cliPath} validate config --config ${fakeConfig}`.text();
      expect(true).toBe(false);
    } catch (error: any) {
      expect(error.stderr.toString()).toContain("ENOENT");
    }
  });

  // What adopt writes for each stack is in the adopt.patch of each example of the repository, which their tests check
  describe("adopt", () => {
    const rails = path.resolve(testDir, "../../../examples/integrations/rails");
    let app: string;
    beforeAll(() => {
      app = fs.mkdtempSync(path.join(os.tmpdir(), "p9s-adopt-"));
    });
    afterAll(() => fs.rmSync(app, { recursive: true, force: true }));

    test("shows adopt help", async () => {
      const result = await $`bun run ${cliPath} adopt --help`.text();

      expect(result).toContain("--stack");
      expect(result).toContain("--user-id");
      expect(result).toContain("--dry-run");
    });

    test("says which stacks it knows when it finds none", async () => {
      fs.copyFileSync(path.join(rails, "p9s.config.json"), path.join(app, "p9s.config.json"));
      const result = await $`bun run ${cliPath} adopt`.cwd(app).nothrow();

      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("Found no stack p9s adopt knows");
      expect(result.stderr.toString()).toContain("rails, django, fastapi");
    });

    test("lists the files it would change with --dry-run, and changes none", async () => {
      fs.cpSync(path.join(rails, "before"), app, { recursive: true });
      const gemfile = fs.readFileSync(path.join(app, "Gemfile"), "utf-8");
      const result = await $`bun run ${cliPath} adopt --dry-run`.cwd(app).text();

      expect(result).toContain("Would change, for Rails:\n  Gemfile\n  app/controllers/application_controller.rb");
      expect(result).toContain("Then run: bundle install");
      expect(result).toContain("https://p9s.vercel.app/docs/integrations/rails");
      expect(fs.readFileSync(path.join(app, "Gemfile"), "utf-8")).toBe(gemfile);
    });
  });
});
