import { expect, describe, test, beforeAll, afterAll } from "bun:test";
import { $ } from "bun";
import * as fs from "node:fs";
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

    expect(result).toContain("0.0.1");
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
});
