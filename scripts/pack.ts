// Packs the published packages into ./packed, then installs the tarballs with npm in an empty project, as a user
// would, and checks that Node imports them, that TypeScript resolves their types with nodenext, and that the CLI runs.
import { $ } from "bun";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { published } from "./published.ts";

const root = path.resolve(import.meta.dir, "..");
const out = path.join(root, "packed");
await rm(out, { recursive: true, force: true });
await mkdir(out);
await $`bun run build`.cwd(root).quiet();

for (const name of published) {
  await $`bun pm pack --destination ${out} --quiet`.cwd(path.join(root, "packages", name));
}
const tarballs = (await readdir(out)).filter(file => file.endsWith(".tgz")).map(file => path.join(out, file));
for (const tarball of tarballs) {
  const manifest = await $`tar -xOf ${tarball} package/package.json`.text();
  if (manifest.includes("workspace:")) throw new Error(`${path.basename(tarball)} still depends on workspace: versions`);
  const files = (await $`tar -tf ${tarball}`.text()).trim().split("\n");
  if (files.some(file => /\.test\.|\/test\//.test(file))) throw new Error(`${path.basename(tarball)} ships tests`);
  console.log(`${path.basename(tarball)}: ${files.length} files`);
}

const project = await mkdtemp(path.join(os.tmpdir(), "p9s-pack-"));
try {
  await Bun.write(path.join(project, "package.json"), JSON.stringify({ name: "p9s-pack-check", private: true, type: "module" }));
  await $`npm install --no-audit --no-fund --loglevel=error ${tarballs} kysely typescript@5 @types/node`.cwd(project).quiet();

  const config = {
    engine: { users: ["app_user"], authentication: { getCurrentUserId: "current_role_id", setting: "app.role_id" } },
    tables: [
      { name: "folder", isResource: true, resourceId: "resource_id", resourceParent: { column: "parent_id", table: "folder", key: "id" }, permission: { app_user: { select: 0, insert: 1, update: 2, delete: 3 } } },
      { name: "member", isRole: true, roleId: "role_id" },
    ],
  };
  await Bun.write(path.join(project, "p9s.config.json"), JSON.stringify(config));
  await Bun.write(path.join(project, "check.mjs"), `
import { readFileSync } from "node:fs";
import { createIdentity, createMigrationSql, expectedMigrationRecord, migrationStatus } from "@p9s/postgres";
import { validateConfig } from "@p9s/core";
import { withUser } from "@p9s/drizzle";
import { withUser as withKyselyUser } from "@p9s/kysely";
import { userClient, withUser as withPrismaUser } from "@p9s/prisma";
const config = JSON.parse(readFileSync("p9s.config.json", "utf8"));
if (!validateConfig(config).success) throw new Error("config rejected");
const sql = createMigrationSql(config);
if (!sql.includes("create policy")) throw new Error("no policies in the migration");
if (!sql.includes("current_setting('app.role_id', true)")) throw new Error("no current user function in the migration");
const { text } = createIdentity(config).statement("r1");
if (!text.startsWith("select set_config(") || typeof withUser !== "function") throw new Error("no identity helpers");
if (typeof userClient !== "function" || typeof withPrismaUser !== "function") throw new Error("no Prisma helpers");
if (typeof withKyselyUser !== "function") throw new Error("no Kysely helpers");
if (typeof migrationStatus !== "function" || !sql.includes(expectedMigrationRecord(config).hash)) throw new Error("no migration record");
console.log("node: migration of " + sql.length + " characters");
`);
  await $`node check.mjs`.cwd(project);

  await Bun.write(path.join(project, "tsconfig.json"), JSON.stringify({
    compilerOptions: { module: "nodenext", moduleResolution: "nodenext", target: "es2022", strict: true, noEmit: true, skipLibCheck: true, types: ["node"] },
    include: ["check.ts"],
  }));
  await Bun.write(path.join(project, "check.ts"), `
import { createMigrationSql } from "@p9s/postgres";
import { getCompleteConfig, type Config } from "@p9s/core";
import { generateConfigurationFromDrizzleSchema } from "@p9s/drizzle";
import { userClient } from "@p9s/prisma";
import { withUser as withKyselyUser } from "@p9s/kysely";
const config: Config<"app_user"> = { engine: { users: ["app_user"] }, tables: [] };
const sql: string = createMigrationSql(config);
// Each of these fails to compile only if the types resolved
// @ts-expect-error
createMigrationSql(42);
// @ts-expect-error
getCompleteConfig(config).engine.nope;
// @ts-expect-error
generateConfigurationFromDrizzleSchema();
// @ts-expect-error
userClient({});
// @ts-expect-error
withKyselyUser();
`);
  await $`npx tsc -p .`.cwd(project);
  console.log("typescript: types resolve with nodenext");

  const version = (await $`npx p9s --version`.cwd(project).text()).trim();
  const expected = (await Bun.file(path.join(root, "packages", "cli", "package.json")).json()).version;
  if (version !== expected) throw new Error(`p9s --version printed ${version}, expected ${expected}`);
  await $`npx p9s postgres generate --config p9s.config.json --output migration.sql`.cwd(project).quiet();
  if (!(await Bun.file(path.join(project, "migration.sql")).text()).includes("create policy")) throw new Error("the CLI wrote no policies");
  if (!(await $`npx p9s postgres doctor --help`.cwd(project).text()).includes("--sample")) throw new Error("no doctor command");
  if (!(await $`npx p9s init --help`.cwd(project).text()).includes("--users")) throw new Error("no init command");
  if (!(await $`npx p9s postgres status --help`.cwd(project).text()).includes("--database-url")) throw new Error("no status command");
  console.log(`cli: p9s ${version} generates the migration`);
} finally {
  await rm(project, { recursive: true, force: true });
}
console.log(`\nPacked in ${path.relative(process.cwd(), out)}`);
