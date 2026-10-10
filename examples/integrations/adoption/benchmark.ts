// The benchmark of the examples: the app before p9s and the app after p9s, each on its own database with the rows of
// benchmark-seed.sql, answer the same requests of the same users, in rounds that switch which app goes first. Writes
// the median, the 95th percentile and the requests per second of each request in examples/integrations/<name>/benchmark.json,
// or with --compare, compares how much slower the app after is than the app before with what benchmark.json says.
//
//   P9S_ADOPTION_DATABASE_URL=postgresql://postgres@localhost:5432/postgres bun run bench:integrations [names...]
//     [--requests 200] [--warmup 20] [--rounds 3] [--concurrency 4] [--users 20]
//     [--compare] [--threshold 1] [--min-ms 2] [--fail] [--out folder] [--keep]
import { existsSync } from "node:fs";
import { appendFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import pg from "pg";
import { adoptCopy, admin, applyPatch, cli, copyApp, prepareDatabase, readDescriptor, repository, run, serveApp, type Descriptor } from "./harness.ts";

export interface Stats { median: number; p95: number; rps: number }
export interface Result { request: string; method: string; path: string; before: Stats; after: Stats }
export interface Benchmark {
  example: string;
  date: string;
  machine: { cpu: string; cores: number; memory: string; os: string };
  versions: Record<string, string>;
  settings: { requests: number; warmup: number; rounds: number; concurrency: number; users: number };
  results: Result[];
}

// What each user of the benchmark may do in the database, before any request
interface Plan { user: number; readable: number[]; writable: number[]; projects: number[]; shareable: [number, number][] }

const integrations = path.resolve(import.meta.dir, "..");
const seed = path.join(import.meta.dir, "benchmark-seed.sql");
const users = 1000;

const pick = <T>(items: T[], index: number) => items[index % items.length]!;
const spread = <T>(items: T[], count: number) => items.length <= count ? items : Array.from({ length: count }, (_, i) => items[Math.floor(i * items.length / count)]!);

const requests: { request: string; method: string; path: string; status: number; make: (plan: Plan, index: number) => { path: string; body?: unknown } }[] = [
  { request: "List projects", method: "GET", path: "/projects", status: 200, make: () => ({ path: "/projects" }) },
  { request: "List documents", method: "GET", path: "/documents", status: 200, make: () => ({ path: "/documents" }) },
  { request: "Read a document", method: "GET", path: "/documents/:id", status: 200, make: (plan, i) => ({ path: `/documents/${pick(plan.readable, i)}` }) },
  {
    request: "Create a document", method: "POST", path: "/documents", status: 201,
    make: (plan, i) => ({ path: "/documents", body: { project_id: pick(plan.projects, i), title: `benchmark ${i}`, body: "Written by the benchmark" } }),
  },
  { request: "Update a document", method: "PATCH", path: "/documents/:id", status: 200, make: (plan, i) => ({ path: `/documents/${pick(plan.writable, i)}`, body: { title: `updated ${i}` } }) },
  {
    request: "Share a document", method: "PUT", path: "/documents/:id/shares/:user_id", status: 204,
    make: (plan, i) => { const [document, user] = pick(plan.shareable, i); return { path: `/documents/${document}/shares/${user}`, body: { access: "viewer" } }; },
  },
];

const query = async <T extends pg.QueryResultRow>(url: string, text: string, values: unknown[] = []) => {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try { return (await client.query<T>(text, values)).rows; } finally { await client.end(); }
};

// The documents each user reads and writes, the projects where they create, and documents they share as viewer with
// the next user, who has no share of them yet: sharing it again then needs read, which they keep
const plans = async (url: string, count: number): Promise<Plan[]> => {
  const levels = "case access when 'viewer' then 1 when 'editor' then 2 else 3 end";
  return Promise.all(Array.from({ length: count }, async (_, k) => {
    const user = 1 + k * Math.floor(users / count);
    const projects = await query<{ id: number; level: number }>(url, `
      select project_id as id, max(${levels}) as level from project_shares
      where team_id in (select team_id from team_members where user_id = $1) group by project_id order by project_id`, [user]);
    const documents = await query<{ id: number; level: number; shared: boolean }>(url, `
      with projects as (
        select project_id, max(${levels}) as level from project_shares
        where team_id in (select team_id from team_members where user_id = $1) group by project_id
      )
      select d.id, greatest(coalesce(p.level, 0), coalesce(s.level, 0)) as level,
        exists (select 1 from document_shares t where t.document_id = d.id and t.user_id = $2) as shared
      from documents d
      left join projects p on p.project_id = d.project_id
      left join (select document_id, ${levels} as level from document_shares where user_id = $1) s on s.document_id = d.id
      where p.project_id is not null or s.document_id is not null
      order by d.id`, [user, user + 1]);
    for (const row of [...projects, ...documents]) Object.assign(row, { id: Number(row.id), level: Number(row.level) });
    const plan = {
      user,
      readable: spread(documents.map(d => d.id), 100),
      writable: spread(documents.filter(d => d.level >= 2).map(d => d.id), 100),
      projects: projects.filter(p => p.level >= 2).map(p => p.id),
      shareable: spread(documents.filter(d => !d.shared).map(d => [d.id, user + 1] as [number, number]), 100),
    };
    if (!plan.readable.length || !plan.writable.length || !plan.projects.length || !plan.shareable.length) throw new Error(`User ${user} cannot do each request of the benchmark`);
    return plan;
  }));
};

// Sends count requests, concurrency at a time, request i as the user of plan i % plans.length
const measure = async (base: string, request: (typeof requests)[number], all: Plan[], start: number, count: number, concurrency: number) => {
  const latencies: number[] = [];
  const failures: string[] = [];
  let next = 0;
  const begin = performance.now();
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < count) {
      const i = start + next++;
      const plan = all[i % all.length]!;
      const { path: target, body } = request.make(plan, Math.floor(i / all.length));
      const sent = performance.now();
      const response = await fetch(`${base}${target}`, {
        method: request.method,
        headers: { "x-user-id": String(plan.user), ...(body ? { "content-type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await response.text();
      latencies.push(performance.now() - sent);
      if (response.status !== request.status) failures.push(`${request.method} ${target} as user ${plan.user}: ${response.status} ${text.slice(0, 200)}`);
    }
  }));
  return { latencies, seconds: (performance.now() - begin) / 1000, failures };
};

const quantile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
const round = (value: number) => Math.round(value * 100) / 100;
const stats = (latencies: number[], seconds: number): Stats => {
  const sorted = [...latencies].sort((a, b) => a - b);
  return { median: round(quantile(sorted, 0.5)), p95: round(quantile(sorted, 0.95)), rps: Math.round(latencies.length / seconds) };
};

// The descriptor with what its benchmark changes
const forBenchmark = (descriptor: Descriptor): Descriptor => ({
  ...descriptor,
  setup: [...descriptor.setup ?? [], ...descriptor.benchmark?.setup ?? []],
  start: descriptor.benchmark?.start ?? descriptor.start,
  env: { ...descriptor.env, ...descriptor.benchmark?.env },
});

const machine = () => {
  const cpus = os.cpus();
  return {
    cpu: cpus[0]?.model.trim() ?? os.arch(),
    cores: cpus.length,
    memory: `${Math.round(os.totalmem() / 2 ** 30)} GiB`,
    os: `${os.type()} ${os.release()} ${os.arch()}`,
  };
};

export const benchmarkExample = async (name: string, base: string, settings: Benchmark["settings"], keep = false): Promise<Benchmark> => {
  const example = path.join(integrations, name);
  const descriptor = forBenchmark(await readDescriptor(example));
  const work = path.join(example, ".adoption-benchmark");
  const apps = { before: path.join(example, ".adoption-benchmark-before"), after: path.join(example, ".adoption-benchmark-after") };
  const databases = { before: `p9s_benchmark_${name.replace(/\W/g, "_")}_before`, after: `p9s_benchmark_${name.replace(/\W/g, "_")}_after` };
  const stops: (() => Promise<void>)[] = [];
  try {
    await mkdir(work, { recursive: true });
    await copyApp(path.join(example, "before"), apps.before);
    await adoptCopy(example, apps.after);
    await applyPatch(path.join(example, "after.patch"), apps.after);
    for (const app of ["before", "after"] as const) {
      for (const command of descriptor.setup ?? []) await run(command, apps[app], descriptor.env);
    }
    const urls = {
      before: await prepareDatabase(base, databases.before, apps.before, descriptor, seed),
      after: await prepareDatabase(base, databases.after, apps.after, descriptor, seed),
    };
    await run(`"${process.execPath}" "${cli}" postgres migrate --config p9s.config.json`, apps.after, { DATABASE_URL: urls.after });
    for (const url of Object.values(urls)) await query(url, "vacuum analyze");
    const all = await plans(urls.before, settings.users);
    const servers = {
      before: await serveApp(apps.before, descriptor, urls.before, work, "before"),
      after: await serveApp(apps.after, descriptor, urls.after, work, "after"),
    };
    stops.push(servers.before.stop, servers.after.stop);

    const results: Result[] = [];
    for (const request of requests) {
      const runs = { before: { latencies: [] as number[], seconds: 0 }, after: { latencies: [] as number[], seconds: 0 } };
      let start = 0;
      for (let r = 0; r < settings.rounds; r++) {
        for (const app of r % 2 ? ["after", "before"] as const : ["before", "after"] as const) {
          const warmup = await measure(servers[app].base, request, all, start, settings.warmup, settings.concurrency);
          const measured = await measure(servers[app].base, request, all, start + settings.warmup, settings.requests, settings.concurrency);
          const failures = [...warmup.failures, ...measured.failures];
          if (failures.length) throw new Error(`The app ${app} p9s of ${name} answered ${failures.length} requests wrong:\n${failures.slice(0, 5).join("\n")}`);
          runs[app].latencies.push(...measured.latencies);
          runs[app].seconds += measured.seconds;
        }
        start += settings.warmup + settings.requests;
      }
      const result = { request: request.request, method: request.method, path: request.path, before: stats(runs.before.latencies, runs.before.seconds), after: stats(runs.after.latencies, runs.after.seconds) };
      console.log(`${name}: ${result.request}, median ${result.before.median} ms before and ${result.after.median} ms after`);
      results.push(result);
    }

    const [{ version: postgres }] = await query<{ version: string }>(urls.before, "select current_setting('server_version') as version") as [{ version: string }];
    const p9s = JSON.parse(await readFile(path.join(repository, "packages/cli/package.json"), "utf8")).version as string;
    const runtime = descriptor.version
      ? await run(descriptor.version, apps.after, descriptor.env).then(output => output.trim().split("\n")[0]!, () => "unknown")
      : `Bun ${Bun.version}`;
    return {
      example: name,
      date: new Date().toISOString().slice(0, 10),
      machine: machine(),
      versions: { app: runtime, PostgreSQL: postgres.split(" ")[0]!, p9s, benchmark: `Bun ${Bun.version}` },
      settings,
      results,
    };
  } finally {
    for (const stop of stops) await stop();
    if (!keep) {
      for (const database of Object.values(databases)) await admin(base, `drop database if exists ${database} with (force)`);
      for (const directory of [work, apps.before, apps.after]) await rm(directory, { recursive: true, force: true });
    }
  }
};

// How many times slower the app after p9s is than the app before
export const slowdown = (result: Result) => result.after.median / result.before.median;

// The requests where the app after p9s got slower against the app before than benchmark.json says: by more than threshold
// times the slowdown it says, and by more than min milliseconds
export const regressions = (current: Benchmark, committed: Benchmark, threshold: number, min: number) =>
  current.results.flatMap(result => {
    const then = committed.results.find(r => r.request === result.request);
    if (!then) return [];
    const expected = result.before.median * slowdown(then);
    const growth = slowdown(result) / slowdown(then) - 1;
    return growth > threshold && result.after.median - expected > min ? [{ request: result.request, then: slowdown(then), now: slowdown(result), growth }] : [];
  });

const times = (value: number) => `${value.toFixed(2)}×`;

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    allowPositionals: true,
    options: {
      requests: { type: "string", default: "200" },
      warmup: { type: "string", default: "20" },
      rounds: { type: "string", default: "3" },
      concurrency: { type: "string", default: "4" },
      users: { type: "string", default: "20" },
      compare: { type: "boolean", default: false },
      threshold: { type: "string", default: "1" },
      "min-ms": { type: "string", default: "2" },
      fail: { type: "boolean", default: false },
      out: { type: "string" },
      keep: { type: "boolean", default: false },
    },
  });
  const base = process.env.P9S_ADOPTION_DATABASE_URL;
  if (!base) {
    console.error("Set P9S_ADOPTION_DATABASE_URL to a server where the benchmark can create databases");
    process.exit(2);
  }
  const names = positionals.length ? positionals : (await readdir(integrations)).filter(name => existsSync(path.join(integrations, name, "adoption.json"))).sort();
  const settings = { requests: Number(values.requests), warmup: Number(values.warmup), rounds: Number(values.rounds), concurrency: Number(values.concurrency), users: Number(values.users) };
  let failed = false;
  let broken = false;
  for (const name of names) {
    let benchmark: Benchmark;
    try {
      benchmark = await benchmarkExample(name, base, settings, values.keep);
    } catch (error) {
      console.error(`The benchmark of ${name} failed:`, error);
      broken = true;
      continue;
    }
    if (values.out) {
      await mkdir(values.out, { recursive: true });
      await writeFile(path.join(values.out, `${name}.json`), `${JSON.stringify(benchmark, null, 2)}\n`);
    }
    if (!values.compare) {
      await writeFile(path.join(integrations, name, "benchmark.json"), `${JSON.stringify(benchmark, null, 2)}\n`);
      continue;
    }
    const committed: Benchmark = JSON.parse(await readFile(path.join(integrations, name, "benchmark.json"), "utf8"));
    const found = regressions(benchmark, committed, Number(values.threshold), Number(values["min-ms"]));
    const lines = [
      `### ${name}`,
      "",
      "| Request | Median before | Median after | After / before | In benchmark.json |",
      "|---|---:|---:|---:|---:|",
      ...benchmark.results.map(result => {
        const then = committed.results.find(r => r.request === result.request);
        const flag = found.some(f => f.request === result.request) ? " ⚠️" : "";
        return `| ${result.request} | ${result.before.median} ms | ${result.after.median} ms | ${times(slowdown(result))}${flag} | ${then ? times(slowdown(then)) : "-"} |`;
      }),
      "",
    ];
    console.log(lines.join("\n"));
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
    for (const regression of found) {
      console.log(`::warning title=${name} got slower with p9s::${regression.request}: ${times(regression.now)} the time before p9s, against ${times(regression.then)} in benchmark.json`);
      failed = true;
    }
  }
  if (broken || (failed && values.fail)) process.exit(1);
}
