// bun packages/conformance/prepare.ts: creates the database of P9S_CONFORMANCE_DATABASE_URL again, with the tables and
// rows of schema.sql, and runs the p9s migration of p9s.config.json on it, as `p9s postgres migrate` does
import path from "node:path";
import pg from "pg";

const url = process.env.P9S_CONFORMANCE_DATABASE_URL;
if (!url) {
  console.error("Set P9S_CONFORMANCE_DATABASE_URL to the database to create, like postgresql://postgres@localhost:5432/p9s_conformance");
  process.exit(1);
}

const name = decodeURIComponent(new URL(url).pathname.slice(1));
if (!name || name === "postgres") throw new Error("P9S_CONFORMANCE_DATABASE_URL names a database of its own, which this script drops");
const quoted = `"${name.replaceAll('"', '""')}"`;
const server = new URL(url);
server.pathname = "/postgres";

const admin = new pg.Client({ connectionString: server.toString() });
await admin.connect();
await admin.query(`drop database if exists ${quoted} with (force)`);
await admin.query(`create database ${quoted}`);
await admin.end();

const database = new pg.Client({ connectionString: url });
await database.connect();
await database.query(await Bun.file(path.join(import.meta.dir, "schema.sql")).text());
await database.end();

const cli = path.join(import.meta.dir, "..", "cli", "src", "index.ts");
const migrate = Bun.spawnSync([process.execPath, cli, "postgres", "migrate", "--config", "p9s.config.json"], {
  cwd: import.meta.dir,
  env: { ...process.env, DATABASE_URL: url },
});
if (migrate.exitCode !== 0) throw new Error(`p9s postgres migrate failed\n${migrate.stdout}\n${migrate.stderr}`);
console.log(`Prepared ${name}`);
