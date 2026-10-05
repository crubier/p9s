import { $ } from 'bun';
import { parseArgs } from 'node:util';
import { mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { query as sql } from 'pg-sql2';
import { setupTests as setupPgTests } from '@p9s/postgres-testing/pg';
import { setupTests as setupPgliteTests } from '@p9s/postgres-testing/pglite';
import { runPostgresBenchmark, type BenchmarkResult, type CombineMode, type CommentMode, type Context, type IdMode, type KeyMode } from './generator';

const usage = `
Usage: bun run.ts [options]

  --db <pg|pglite>        Database engine (default: pg)
  --url <url>             Use an existing Postgres server instead of starting compose.yaml
  --sizes <n,...>         Tree fan-out factors to sweep (default: 5)
  --ids <integer,uuid>    Id modes (default: integer,uuid)
  --combine <none,role,resource>
                          Assignment combination modes (default: none,role)
  --reps <n>              Timed repetitions per read and write scenario (default: 30)
  --warmup <n>            Untimed repetitions before each scenario (default: 3)
  --no-baseline           Skip the no-cache baseline reads
  --concurrency <n>       Connections in the concurrent scenarios, 0 to skip them (default: 4, pg only)
  --concurrency-seconds <s>
                          Duration of each concurrent scenario (default: 3)
  --comments <leaf|node>  Whether comments on posts are rows of a leaf table or nodes of the graph (default: leaf)
  --comments-per-post <n> Comments on each post (default: 4 times the size)
  --keys <leaf|node>      Whether the api keys of users are rows of a role leaf table or nodes of the graph (default: leaf)
  --keys-per-user <n>     Api keys of each user (default: 2)
  --out <dir>             Where to write the JSON results (default: ./results)
`;

const { values: args } = parseArgs({
  options: {
    db: { type: 'string', default: 'pg' },
    url: { type: 'string' },
    sizes: { type: 'string', default: '5' },
    ids: { type: 'string', default: 'integer,uuid' },
    combine: { type: 'string', default: 'none,role' },
    reps: { type: 'string', default: '30' },
    warmup: { type: 'string', default: '3' },
    'no-baseline': { type: 'boolean', default: false },
    concurrency: { type: 'string', default: '4' },
    'concurrency-seconds': { type: 'string', default: '3' },
    comments: { type: 'string', default: 'leaf' },
    'comments-per-post': { type: 'string' },
    keys: { type: 'string', default: 'leaf' },
    'keys-per-user': { type: 'string' },
    out: { type: 'string', default: path.join(import.meta.dir, 'results') },
    help: { type: 'boolean', default: false },
  },
});

if (args.help) {
  console.log(usage);
  process.exit(0);
}

const list = (value: string) => value.split(',').map(v => v.trim()).filter(Boolean);
const sizes = list(args.sizes!).map(Number);
const ids = list(args.ids!) as IdMode[];
const combines = list(args.combine!) as CombineMode[];
const reps = Number(args.reps);
const warmup = Number(args.warmup);
const db = args.db as 'pg' | 'pglite';
const concurrency = db === 'pg' ? Number(args.concurrency) : 0;
const concurrencySeconds = Number(args['concurrency-seconds']);
const comments = args.comments as CommentMode;
const commentsPerPost = args['comments-per-post'] === undefined ? undefined : Number(args['comments-per-post']);
const keys = args.keys as KeyMode;
const keysPerUser = args['keys-per-user'] === undefined ? undefined : Number(args['keys-per-user']);

const composeDir = import.meta.dir;
const composeUrl = 'postgresql://postgres:postgres@localhost:54321/postgres';
const useCompose = db === 'pg' && !args.url;
const databaseUrl = args.url ?? composeUrl;

const setupTests = () => db === 'pg' ? setupPgTests(databaseUrl) : setupPgliteTests();

const readServerInfo = async (context: Context) => {
  const [[{ version }]] = await context.exec(sql`select version()`);
  const [settings] = await context.exec(sql`
    select "name", "setting", "unit" from pg_settings
    where "name" in ('shared_buffers', 'work_mem', 'maintenance_work_mem', 'effective_cache_size', 'jit', 'max_parallel_workers_per_gather', 'random_page_cost', 'synchronous_commit', 'max_wal_size')
    order by "name"
  `);
  return {
    version,
    settings: Object.fromEntries(settings.map(({ name, setting, unit }: { name: string, setting: string, unit: string | null }) => [name, unit ? `${setting} ${unit}` : setting])),
  };
};

const gitInfo = async () => {
  const sha = (await $`git rev-parse HEAD`.quiet().nothrow()).stdout.toString().trim();
  const dirty = (await $`git status --porcelain`.quiet().nothrow()).stdout.toString().trim().length > 0;
  return { sha, dirty };
};

if (useCompose) {
  await $`docker compose up -d --wait`.cwd(composeDir);
}

const runs: BenchmarkResult[] = [];
let server: Awaited<ReturnType<typeof readServerInfo>> | undefined;

try {
  for (const benchmarkSizeFactor of sizes) {
    for (const idMode of ids) {
      for (const combineAssignmentsWith of combines) {
        console.log(`\n▶ ${db} size=${benchmarkSizeFactor} id=${idMode} combine=${combineAssignmentsWith} comments=${comments} keys=${keys}`);
        const { context, setup, teardown } = setupTests();
        await setup();
        try {
          server ??= await readServerInfo(context);
          const result = await runPostgresBenchmark(context, {
            benchmarkSizeFactor,
            idMode,
            combineAssignmentsWith,
            reps,
            warmup,
            baseline: !args['no-baseline'],
            concurrency,
            concurrencySeconds,
            comments,
            commentsPerPost,
            keys,
            keysPerUser,
          });
          runs.push(result);
          console.log(`  loaded ${result.dataset.resourceNodes} resources, ${result.dataset.roleNodes} roles in ${result.load.insert.toFixed(1)}s`);
        } finally {
          await teardown();
        }
      }
    }
  }
} finally {
  if (useCompose) {
    await $`docker compose down`.cwd(composeDir);
  }
}

const label = ({ options }: BenchmarkResult) => `${options.benchmarkSizeFactor}/${options.idMode}/${options.combineAssignmentsWith}`;
const ms = (value: number) => value < 10 ? value.toFixed(2) : value.toFixed(0);
const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);

console.log('\nLoad (seconds) and dataset, per size/id/combine');
console.table(Object.fromEntries(runs.map(run => [label(run), {
  resources: run.dataset.resourceNodes,
  roles: run.dataset.roleNodes,
  assignments: run.dataset.assignmentPairs,
  comments: `${run.dataset.comments} ${run.options.comments}`,
  keys: `${run.dataset.apiKeys} ${run.options.keys}`,
  'rows+edges': (run.load.resourceRows + run.load.resourceEdge + run.load.roleRows + run.load.roleEdge).toFixed(2),
  assignments_s: run.load.assignmentEdge.toFixed(2),
  'cache backfill': run.load.enableTriggers.toFixed(2),
}])));

console.log('\nCache size, rows and MB');
console.table(Object.fromEntries(runs.map(run => [label(run), Object.fromEntries(run.cache.map(({ table, rows, bytes }) => [table, `${rows} / ${mb(bytes)}`]))])));

const scenarioTable = (entries: (run: BenchmarkResult) => Array<{ key: string, p50: number, p95: number }>) => {
  const rows: Record<string, Record<string, string>> = {};
  for (const run of runs) {
    for (const { key, p50, p95 } of entries(run)) {
      (rows[key] ??= {})[label(run)] = `${ms(p50)} / ${ms(p95)}`;
    }
  }
  console.table(rows);
};

console.log('\nRLS reads as the application role, p50 / p95 ms');
scenarioTable(run => run.reads.map(({ name, policy, stats }) => ({ key: `${policy}: ${name}`, p50: stats.p50, p95: stats.p95 })));

console.log('\nIncremental writes with triggers on, p50 / p95 ms');
scenarioTable(run => run.writes.map(({ name, stats }) => ({ key: name, p50: stats.p50, p95: stats.p95 })));

if (runs.some(run => run.concurrency.length > 0)) {
  console.log(`\nConcurrent transactions over ${concurrency} connections, per second / p50 / p99 ms`);
  const rows: Record<string, Record<string, string>> = {};
  for (const run of runs) {
    for (const { name, throughput, errors, stats } of run.concurrency) {
      (rows[name] ??= {})[label(run)] = `${throughput.toFixed(0)} / ${ms(stats.p50)} / ${ms(stats.p99)}${errors > 0 ? ` (${errors} errors)` : ''}`;
    }
  }
  console.table(rows);
}

const git = await gitInfo();
const output = {
  createdAt: new Date().toISOString(),
  git,
  db,
  server,
  machine: {
    platform: `${os.platform()} ${os.release()} ${os.arch()}`,
    cpu: `${os.cpus()[0]?.model} x${os.cpus().length}`,
    memoryGb: Math.round(os.totalmem() / 1024 ** 3),
    bun: Bun.version,
  },
  args: { sizes, ids, combines, reps, warmup, baseline: !args['no-baseline'], concurrency, concurrencySeconds, comments, commentsPerPost, keys, keysPerUser },
  runs,
};

await mkdir(args.out!, { recursive: true });
const file = path.join(args.out!, `${output.createdAt.replace(/[:.]/g, '-')}-${db}-${git.sha.slice(0, 8) || 'nogit'}${git.dirty ? '-dirty' : ''}.json`);
await Bun.write(file, JSON.stringify(output, null, 2));
console.log(`\nResults written to ${path.relative(process.cwd(), file)}`);
