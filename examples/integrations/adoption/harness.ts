import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { createIdentity } from "@p9s/postgres";
import { scenario, users, type Step, type UserName } from "./scenario.ts";
import { prepareSupabase, startSupabase } from "./supabase.ts";

// The adoption test of an example, see the README of this folder

const repository = path.resolve(import.meta.dir, "../../..");
const cli = path.join(repository, "packages/cli/src/index.ts");
const seed = path.join(import.meta.dir, "seed.sql");
const timeout = 15 * 60_000;

// What an example tells the harness, in its adoption.json. Commands run in the copy of the app, with DATABASE_URL, and
// PORT for start.
export interface Descriptor {
  // Commands that prepare a copy of the app, like installing its dependencies or building it
  setup?: string[];
  // The migrations of the app
  migrate: string;
  // Starts the app on PORT, in the foreground
  start: string;
  env?: Record<string, string>;
  // What the platform of the app gives it. With "supabase": its roles, auth schema and grants in each database, and
  // PostgREST under /rest/v1 of SUPABASE_URL, with SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_JWT_SECRET
  stack?: "supabase";
  // The migration tool of the app, for p9s postgres generate --format, with the options it needs, like --previous
  format?: { name: string; options?: string };
  // The options of p9s adopt for the app, like ["--user-id", "@user_id"]
  adopt?: string[];
}

// Folders of a copy that its setup makes, and that copies leave out
export const generated = new Set(["node_modules", ".adoption", ".adoption-before", ".adoption-after", ".adoption-edit", ".adoption-adopt", ".adoption-expected", "generated", ".venv", "target", "_build", "deps", "vendor", "__pycache__", "tmp", "log"]);

export const copyApp = async (from: string, to: string) => {
  await rm(to, { recursive: true, force: true });
  await cp(from, to, { recursive: true, filter: source => !generated.has(path.basename(source)) || source === from });
};

export const applyPatch = async (patch: string, directory: string) => {
  if (await Bun.file(patch).exists()) await run(`patch -p1 -E --forward --quiet < "${patch}"`, directory);
};

export const readDescriptor = async (example: string): Promise<Descriptor> => JSON.parse(await readFile(path.join(example, "adoption.json"), "utf8"));

// Runs the CLI of this repository in a folder, with the arguments as they are, without a shell
export const runCli = async (args: string[], cwd: string, env: Record<string, string> = {}) => {
  const child = Bun.spawn([process.execPath, cli, ...args], { cwd, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code !== 0) throw new Error(`p9s ${args.join(" ")} exited with ${code} in ${cwd}\n${stdout}\n${stderr}`);
  return stdout;
};

// A copy of before/ with its config, which p9s adopt changes, with the packages of this repository
export const adoptCopy = async (example: string, directory: string) => {
  await copyApp(path.join(example, "before"), directory);
  await cp(path.join(example, "p9s.config.json"), path.join(directory, "p9s.config.json"));
  const { adopt = [] } = await readDescriptor(example);
  return runCli(["adopt", "--config", "p9s.config.json", "--packages", repository, ...adopt], directory);
};

// What p9s adopt must write: a copy of before/ with its config and adopt.patch
export const expectedCopy = async (example: string, directory: string) => {
  await copyApp(path.join(example, "before"), directory);
  await cp(path.join(example, "p9s.config.json"), path.join(directory, "p9s.config.json"));
  await applyPatch(path.join(example, "adopt.patch"), directory);
};

// git diff of two folders, without their generated folders, as a patch whose paths are a/... and b/...
export const diffApps = async (from: string, to: string, leave: string[] = []) => {
  const scratch = await mkdtemp(path.join(os.tmpdir(), "p9s-diff-"));
  try {
    await copyApp(from, path.join(scratch, "a"));
    await copyApp(to, path.join(scratch, "b"));
    for (const file of leave) for (const side of ["a", "b"]) await rm(path.join(scratch, side, file), { force: true });
    const diff = Bun.spawnSync(["git", "diff", "--no-index", "--no-prefix", "--no-color", "a", "b"], { cwd: scratch });
    if (diff.exitCode > 1) throw new Error(diff.stderr.toString());
    return diff.stdout.toString();
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
};

// A command that hangs fails on its own, rather than the test that runs it
export const run = async (command: string, cwd: string, env: Record<string, string> = {}) => {
  const child = Bun.spawn(["sh", "-c", command], { cwd, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe", timeout: 10 * 60_000 });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code !== 0) throw new Error(`${command} ${child.signalCode ? `was killed with ${child.signalCode}` : `exited with ${code}`} in ${cwd}\n${stdout}\n${stderr}`);
  return stdout;
};

const databaseUrl = (base: string, name: string) => {
  const url = new URL(base);
  url.pathname = `/${name}`;
  return url.toString();
};

const freePort = () => {
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() });
  const { port } = server;
  server.stop(true);
  return port;
};

// The app in the foreground of its own process group, so that stopping it stops what its command started
const startApp = async (directory: string, descriptor: Descriptor, url: string, log: string, stackEnv: Record<string, string> = {}) => {
  const port = freePort();
  const output = Bun.file(log);
  const child = Bun.spawn(["sh", "-c", `exec ${descriptor.start}`], {
    cwd: directory,
    env: { ...process.env, ...descriptor.env, ...stackEnv, DATABASE_URL: url, PORT: String(port) },
    stdin: "ignore",
    stdout: output,
    stderr: output,
    detached: true,
  });
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 180_000;
  while (true) {
    const state = await Promise.race([child.exited.then(code => ({ code })), Bun.sleep(250).then(() => undefined)]);
    if (state) throw new Error(`${descriptor.start} exited with ${state.code}:\n${await readFile(log, "utf8")}`);
    const healthy = await fetch(`${base}/health`, { signal: AbortSignal.timeout(2000) }).then(response => response.ok, () => false);
    if (healthy) break;
    if (Date.now() > deadline) throw new Error(`${descriptor.start} did not answer on ${base}/health:\n${await readFile(log, "utf8")}`);
  }
  return { base, stop: () => stopApp(child) };
};

const stopApp = async (child: Bun.Subprocess) => {
  if (child.exitCode !== null) return;
  try { process.kill(-child.pid, "SIGTERM"); } catch { return; }
  const stopped = await Promise.race([child.exited.then(() => true), Bun.sleep(10_000).then(() => false)]);
  if (!stopped) try { process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ }
};

export interface Answer { request: string; status: number; body: unknown }

// Ids of the documents the scenario created become their names, as the app after p9s may take other ids from the
// sequence, which refused inserts use up
const normalize = (value: unknown, names: Map<number, string>): unknown => {
  if (Array.isArray(value)) return value.map(item => normalize(item, names));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) =>
      [key, (key === "id" || key === "document_id") && typeof item === "number" && names.has(item) ? `:${names.get(item)}` : normalize(item, names)]));
  }
  return value;
};

const describeStep = (step: Step) => `${step.as ?? "nobody"} ${step.method} ${step.path}${step.body ? ` ${JSON.stringify(step.body)}` : ""}`;

export const runScenario = async (base: string) => {
  const created = new Map<string, number>();
  const answers: Answer[] = [];
  for (const step of scenario) {
    const target = step.path.replace(/:([a-z]+)/g, (_, name: string) => String(created.get(name) ?? `unknown-${name}`));
    const response = await fetch(`${base}${target}`, {
      method: step.method,
      headers: { "content-type": "application/json", ...(step.as ? { "x-user-id": String(users[step.as]) } : {}) },
      body: step.body ? JSON.stringify(step.body) : undefined,
    });
    const text = await response.text();
    let body: unknown = text;
    try { body = text ? JSON.parse(text) : null; } catch { /* not JSON, kept as text */ }
    if (step.creates && response.status === 201) created.set(step.creates, (body as { id: number }).id);
    answers.push({ request: describeStep(step), status: response.status, body });
  }
  const names = new Map([...created].map(([name, id]) => [id, name]));
  return { answers: answers.map(answer => ({ ...answer, body: normalize(answer.body, names) })), names };
};

const wrongStatuses = (answers: Answer[]) => scenario.flatMap((step, index) =>
  step.status !== undefined && answers[index]!.status !== step.status ? [`${answers[index]!.request}: ${answers[index]!.status} instead of ${step.status}`] : []);

// The last answers to the reads of each user, by user
type Reads = Record<string, { projects: Array<number | string>, documents: Array<number | string> }>;

const lastReads = (answers: Answer[]): Reads => Object.fromEntries((Object.keys(users) as UserName[]).map(name => {
  const last = (target: string) => answers.findLast(answer => answer.request === `${name} GET ${target}`)!.body as Array<{ id: number | string }>;
  return [name, { projects: last("/projects").map(row => row.id), documents: last("/documents").map(row => row.id) }];
}));

const readsIn = (access: Record<string, UserAccess>, names: Map<number, string>): Reads =>
  Object.fromEntries(Object.entries(access).map(([user, { projects, documents }]) =>
    [user, { projects, documents: documents.map(id => names.has(id) ? `:${names.get(id)}` : id) }]));

type Bit = "read" | "write" | "delete";

// What a user reads, and the documents and projects where the database lets them write
interface UserAccess { projects: number[]; documents: number[]; update: number[]; delete: number[]; insert: number[]; share: number[] }
const bitsOf: Record<string, Bit[]> = { viewer: ["read"], editor: ["read", "write"], owner: ["read", "write", "delete"] };

// What the rules of the README give each user, from the tables as they are
const expectedAccess = async (client: pg.Client) => {
  const rows = async <T>(text: string) => (await client.query<T & pg.QueryResultRow>(text)).rows as T[];
  const members = await rows<{ team_id: number, user_id: number }>("select team_id, user_id from team_members");
  const projectShares = await rows<{ project_id: number, team_id: number, access: string }>("select project_id, team_id, access from project_shares");
  const documentShares = await rows<{ document_id: number, user_id: number, access: string }>("select document_id, user_id, access from document_shares");
  const projects = (await rows<{ id: number }>("select id from projects order by id")).map(row => row.id);
  const documents = await rows<{ id: number, project_id: number }>("select id, project_id from documents order by id");
  const onProject = (user: number, project: number) => new Set(projectShares
    .filter(share => share.project_id === project && members.some(member => member.team_id === share.team_id && member.user_id === user))
    .flatMap(share => bitsOf[share.access]!));
  const shareOf = (document: number, user: number) => documentShares.find(share => share.document_id === document && share.user_id === user);
  const onDocument = (user: number, document: { id: number, project_id: number }) =>
    new Set([...onProject(user, document.project_id), ...bitsOf[shareOf(document.id, user)?.access ?? ""] ?? []]);
  const has = (bits: Set<Bit>, needed: Bit[]) => needed.every(bit => bits.has(bit));
  return { projects, documents, expected: (user: number, target: number): UserAccess => ({
    projects: projects.filter(project => onProject(user, project).has("read")),
    documents: documents.filter(document => onDocument(user, document).has("read")).map(document => document.id),
    update: documents.filter(document => onDocument(user, document).has("write")).map(document => document.id),
    delete: documents.filter(document => onDocument(user, document).has("delete")).map(document => document.id),
    insert: projects.filter(project => onProject(user, project).has("write")),
    share: documents.filter(document => {
      const bits = onDocument(user, document);
      return has(bits, ["read"]) && has(bits, bitsOf[shareOf(document.id, target)?.access ?? "viewer"]!);
    }).map(document => document.id),
  }) };
};

// What each user reads, and which writes the database lets through, each write rolled back
export const checkDatabase = async (url: string, config: unknown) => {
  const identity = createIdentity(config as Parameters<typeof createIdentity>[0]);
  // Ids are bigint in some stacks, like Rails, and the seed keeps them small
  const types = { getTypeParser: ((oid: number, format?: "text" | "binary") => oid === pg.types.builtins.INT8 ? Number : pg.types.getTypeParser(oid, format as "text")) as typeof pg.types.getTypeParser };
  const client = new pg.Client({ connectionString: url, types });
  await client.connect();
  try {
    const { projects, documents, expected } = await expectedAccess(client);
    const actual: Record<string, UserAccess> = {};
    const wanted: Record<string, UserAccess> = {};
    for (const [name, id] of Object.entries(users)) {
      // Shares go to erin, or to dave from erin herself
      const target = name === "erin" ? users.dave : users.erin;
      wanted[name] = expected(id, target);
      await client.query("begin");
      try {
        const { text, values } = identity.statement(id);
        await client.query(text, values);
        const ids = async (query: string) => (await client.query<{ id: number }>(query)).rows.map(row => row.id);
        const lets = async (query: string, values: unknown[]) => {
          await client.query("savepoint probe");
          try {
            return (await client.query(query, values)).rowCount === 1;
          } catch (error) {
            if ((error as { code?: string }).code === "42501") return false;
            throw error;
          } finally {
            await client.query("rollback to savepoint probe");
          }
        };
        const filter = async <T>(items: T[], query: string, values: (item: T) => unknown[]) => {
          const result: T[] = [];
          for (const item of items) if (await lets(query, values(item))) result.push(item);
          return result;
        };
        const documentIds = documents.map(document => document.id);
        actual[name] = {
          projects: await ids("select id from projects order by id"),
          documents: await ids("select id from documents order by id"),
          update: await filter(documentIds, "update documents set title = title where id = $1 returning id", id => [id]),
          delete: await filter(documentIds, "delete from documents where id = $1 returning id", id => [id]),
          insert: await filter(projects, "insert into documents (project_id, title) values ($1, 'probe') returning id", id => [id]),
          share: await filter(documentIds, "insert into document_shares (document_id, user_id, access) values ($1, $2, 'viewer') on conflict (document_id, user_id) do update set access = excluded.access returning document_id", id => [id, target]),
        };
      } finally {
        await client.query("rollback");
      }
    }
    return { actual, wanted };
  } finally {
    await client.end();
  }
};

// A hash of every row of every table of the public schema, by table
const fingerprint = async (url: string) => {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const tables = (await client.query<{ name: string }>("select quote_ident(table_name) as name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1")).rows;
    const hashes: Record<string, string> = {};
    for (const { name } of tables) {
      hashes[name] = (await client.query<{ hash: string }>(`select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) as hash from ${name} as t`)).rows[0]!.hash;
    }
    return hashes;
  } finally {
    await client.end();
  }
};

export const describeAdoption = (example: string) => {
  const base = process.env.P9S_ADOPTION_DATABASE_URL;
  const name = path.basename(example);
  const keep = process.env.P9S_ADOPTION_KEEP === "1";
  // Logs in .adoption, and the copies next to before/, so that the paths of before/ to the packages of this repository
  // hold in them
  const work = path.join(example, ".adoption");
  const apps = { before: path.join(example, ".adoption-before"), after: path.join(example, ".adoption-after") };
  const databases = Object.fromEntries((["before", "after", "format"] as const).map(app => [app, `p9s_adoption_${name.replace(/\W/g, "_")}_${app}`])) as Record<"before" | "after" | "format", string>;
  const urls = Object.fromEntries(Object.entries(databases).map(([app, database]) => [app, base ? databaseUrl(base, database) : ""])) as typeof databases;
  const format = (JSON.parse(readFileSync(path.join(example, "adoption.json"), "utf8")) as Descriptor).format;
  const stops: Array<() => Promise<unknown>> = [];
  let descriptor: Descriptor;
  let config: unknown;
  let before: Answer[] = [];
  let created = new Map<number, string>();

  const admin = async (statement: string) => {
    const client = new pg.Client({ connectionString: base });
    await client.connect();
    try { await client.query(statement); } finally { await client.end(); }
  };
  const p9s = (args: string, app: string, url: string) => run(`"${process.execPath}" "${cli}" ${args}`, app, { DATABASE_URL: url });
  const seedDatabase = async (url: string) => {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try { await client.query(await readFile(seed, "utf8")); } finally { await client.end(); }
  };
  const prepare = async (app: "before" | "after") => {
    await admin(`drop database if exists ${databases[app]} with (force)`);
    await admin(`create database ${databases[app]}`);
    if (descriptor.stack === "supabase") await prepareSupabase(urls[app]);
    await run(descriptor.migrate, apps[app], { ...descriptor.env, DATABASE_URL: urls[app] });
    await seedDatabase(urls[app]);
  };
  const serve = async (app: "before" | "after") => {
    const stack = descriptor.stack === "supabase" ? await startSupabase(urls[app], path.join(work, `${app}.supabase.log`)) : undefined;
    if (stack) stops.push(stack.stop);
    const server = await startApp(apps[app], descriptor, urls[app], path.join(work, `${app}.log`), stack?.env);
    stops.push(server.stop);
    return { base: server.base, leaks: stack?.leaks ?? (async () => []), stop: async () => { await server.stop(); await stack?.stop(); } };
  };

  // Without a database: what p9s adopt changes in before/ is adopt.patch, running it again changes nothing, and the
  // change left to the person, after.patch, applies on it
  describe(`p9s adopt on ${name}`, () => {
    const adopted = path.join(example, ".adoption-adopt");
    const expected = path.join(example, ".adoption-expected");
    afterAll(async () => {
      for (const directory of [adopted, expected]) await rm(directory, { recursive: true, force: true });
    });

    test("npx @p9s/cli adopt writes what adopt.patch holds, once, and after.patch applies on it", async () => {
      expect(await adoptCopy(example, adopted)).toMatch(/^Changed, for /);
      await expectedCopy(example, expected);
      expect(await diffApps(expected, adopted)).toBe("");
      const { adopt = [] } = await readDescriptor(example);
      expect(await runCli(["adopt", "--config", "p9s.config.json", "--packages", repository, ...adopt], adopted)).toMatch(/^Nothing to change/);
      await applyPatch(path.join(example, "after.patch"), adopted);
    }, timeout);
  });

  describe.skipIf(!base)(`adoption of ${name}`, () => {
    afterAll(async () => {
      for (const stop of stops) await stop();
      if (!keep && base) {
        for (const database of Object.values(databases)) await admin(`drop database if exists ${database} with (force)`);
        for (const directory of [work, apps.before, apps.after]) await rm(directory, { recursive: true, force: true });
      }
    });

    test("the app before p9s answers each user as the rules say", async () => {
      descriptor = JSON.parse(await readFile(path.join(example, "adoption.json"), "utf8"));
      config = JSON.parse(await readFile(path.join(example, "p9s.config.json"), "utf8"));
      await mkdir(work, { recursive: true });
      await copyApp(path.join(example, "before"), apps.before);
      await cp(path.join(example, "p9s.config.json"), path.join(apps.before, "p9s.config.json"));
      await adoptCopy(example, apps.after);
      await applyPatch(path.join(example, "after.patch"), apps.after);
      for (const app of ["before", "after"] as const) {
        for (const command of descriptor.setup ?? []) await run(command, apps[app], descriptor.env);
      }
      await prepare("before");
      const server = await serve("before");
      ({ answers: before, names: created } = await runScenario(server.base));
      await server.stop();
      expect(wrongStatuses(before)).toEqual([]);
    }, timeout);

    test("npx @p9s/cli postgres migrate --config p9s.config.json", async () => {
      expect(await p9s("postgres migrate --config p9s.config.json", apps.before, urls.before)).toMatch(/Migrated/);
    }, timeout);

    test("in the database, each user reads what the app read, and writes what the rules let them", async () => {
      const { actual, wanted } = await checkDatabase(urls.before, config);
      expect(actual).toEqual(wanted);
      expect(readsIn(actual, created)).toEqual(lastReads(before));
    }, timeout);

    // But JIT, which a role made before the migration may still have on
    test("p9s postgres doctor finds nothing wrong", async () => {
      const report = await p9s("postgres doctor --config p9s.config.json", apps.before, urls.before);
      expect(report.split("\n").filter(line => /^(warn|error)\s/.test(line) && !/^warn\s+jit:/.test(line))).toEqual([]);
    }, timeout);

    test("the app after p9s answers the same", async () => {
      await prepare("after");
      expect(await p9s("postgres migrate --config p9s.config.json", apps.after, urls.after)).toMatch(/Migrated/);
      const server = await serve("after");
      const { answers: after } = await runScenario(server.base);
      const leaks = await server.leaks();
      await server.stop();
      expect(after).toEqual(before);
      expect(leaks).toEqual([]);
      const { actual, wanted } = await checkDatabase(urls.after, config);
      expect(actual).toEqual(wanted);
    }, timeout);

    test("running the migration again changes nothing", async () => {
      for (const app of ["before", "after"] as const) {
        expect(await p9s("postgres migrate --config p9s.config.json", apps[app], urls[app])).toMatch(/Up to date/);
        const rows = await fingerprint(urls[app]);
        await p9s("postgres migrate --config p9s.config.json --force", apps[app], urls[app]);
        expect(await fingerprint(urls[app])).toEqual(rows);
      }
    }, timeout);

    // The app after p9s, with the migration of p9s in its own migrations: its migrate command makes a database where
    // each user reads and writes as the rules say, with the rows of the seed inserted after p9s
    test.skipIf(!format)(`p9s postgres generate --format ${format?.name} writes a migration that the app runs with its own`, async () => {
      expect(await p9s(`postgres generate --config p9s.config.json --format ${format!.name} ${format!.options ?? ""}`, apps.after, "")).toMatch(/Migration written/);
      for (const command of descriptor.setup ?? []) await run(command, apps.after, descriptor.env);
      await admin(`drop database if exists ${databases.format} with (force)`);
      await admin(`create database ${databases.format}`);
      await run(descriptor.migrate, apps.after, { ...descriptor.env, DATABASE_URL: urls.format });
      await seedDatabase(urls.format);
      expect(await p9s("postgres status --config p9s.config.json", apps.after, urls.format)).toMatch(/Up to date/);
      const { actual, wanted } = await checkDatabase(urls.format, config);
      expect(actual).toEqual(wanted);
      const report = await p9s("postgres doctor --config p9s.config.json", apps.after, urls.format);
      expect(report.split("\n").filter(line => /^(warn|error)\s/.test(line) && !/^warn\s+jit:/.test(line))).toEqual([]);
    }, timeout);
  });
};
