import { $ } from 'bun';
import { parseArgs } from 'node:util';
import { mkdir, mkdtemp, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { format, metrics, runKey, type Metric, type ResultFile } from './metrics';

const usage = `
Usage: bun ab.ts [options]

Runs the benchmark of a base revision and of the working tree in turns on the same server, base, head, head, base and
so on, so that the machine slowing down or speeding up weighs on both alike. A metric changed when the medians of the
rounds differ by more than the threshold, and a one-sided Mann-Whitney test of the rounds of the two sides is below
alpha: with 6 rounds and alpha 0.01, at most 4 of the 36 pairs of rounds may disagree. A whole run can be 20% off on
some metrics, so fewer rounds flag a few of the hundreds of metrics by chance. Tails, p95 and p99, are reported but only
fail with --tails: with 30 samples they are one or two of them.

  --base <ref>            Revision to compare the working tree with (default: HEAD)
  --rounds <n>            Runs of each side (default: 6)
  --warmup-runs <n>       Runs of the working tree before the rounds, left out (default: 1)
  --run <args>            Options of run.ts for every run
                          (default: --sizes 4 --ids integer --combine none,role --no-baseline --concurrency 0)
  --url <url>             Use an existing Postgres server instead of starting compose.yaml
  --threshold <ratio>     Relative change of the medians reported as slower or faster (default: 0.2)
  --min-ms <ms>           Ignore latency changes smaller than this (default: 0.1)
  --alpha <p>             Significance of the test across rounds (default: 0.01)
  --tails                 Fail on p95 and p99 too
  --all                   Also print the metrics that did not change
  --fail                  Exit with code 1 when something got slower
  --out <dir>             Where to keep the results and logs of every run (default: ./results/ab-<time>)
`;

const { values: args } = parseArgs({
  options: {
    base: { type: 'string', default: 'HEAD' },
    rounds: { type: 'string', default: '6' },
    'warmup-runs': { type: 'string', default: '1' },
    run: { type: 'string', default: '--sizes 4 --ids integer --combine none,role --no-baseline --concurrency 0' },
    url: { type: 'string' },
    threshold: { type: 'string', default: '0.2' },
    'min-ms': { type: 'string', default: '0.1' },
    alpha: { type: 'string', default: '0.01' },
    tails: { type: 'boolean', default: false },
    all: { type: 'boolean', default: false },
    fail: { type: 'boolean', default: false },
    out: { type: 'string' },
    help: { type: 'boolean', default: false },
  },
});

if (args.help) {
  console.log(usage);
  process.exit(0);
}

const rounds = Number(args.rounds);
const threshold = Number(args.threshold);
const minMs = Number(args['min-ms']);
const alpha = Number(args.alpha);
const runArgs = args.run!.split(/\s+/).filter(Boolean);
const outDir = path.resolve(args.out ?? path.join(import.meta.dir, 'results', `ab-${new Date().toISOString().replace(/[:.]/g, '-')}`));
const composeDir = import.meta.dir;
const url = args.url ?? 'postgresql://postgres:postgres@localhost:54321/postgres';

const root = (await $`git rev-parse --show-toplevel`.cwd(import.meta.dir).text()).trim();
const baseSha = (await $`git rev-parse --verify ${`${args.base}^{commit}`}`.cwd(root).text()).trim();
const worktree = await mkdtemp(path.join(os.tmpdir(), 'p9s-bench-base-'));
await mkdir(outDir, { recursive: true });

const results: Record<'base' | 'head', ResultFile[]> = { base: [], head: [] };
try {
  console.log(`Base ${baseSha.slice(0, 8)} in ${worktree}`);
  await $`git worktree add --detach ${worktree} ${baseSha}`.cwd(root).quiet();
  await $`bun install --frozen-lockfile`.cwd(worktree).quiet();
  if (!args.url) {
    await $`docker compose up -d --wait`.cwd(composeDir);
  }
  const dirs = { base: path.join(worktree, 'benchmarks', 'postgres'), head: import.meta.dir };
  const runOnce = async (side: 'base' | 'head', name: string): Promise<ResultFile> => {
    const started = performance.now();
    const log = path.join(outDir, `${name}.log`);
    const run = Bun.spawn(['bun', 'run.ts', '--url', url, '--out', path.join(outDir, name), ...runArgs], {
      cwd: dirs[side],
      stdout: Bun.file(log),
      stderr: 'pipe',
    });
    const [code, stderr] = await Promise.all([run.exited, new Response(run.stderr).text()]);
    if (code !== 0) {
      throw new Error(`${name} failed with code ${code}, see ${log}\n${stderr.slice(-2000)}`);
    }
    const [file] = (await readdir(path.join(outDir, name))).filter(file => file.endsWith('.json'));
    console.log(`  ${name}: ${((performance.now() - started) / 1000).toFixed(0)} s`);
    return Bun.file(path.join(outDir, name, file!)).json();
  };
  for (let run = 0; run < Number(args['warmup-runs']); run++) {
    await runOnce('head', `warmup-${run + 1}`);
  }
  for (let round = 0; round < rounds; round++) {
    for (const side of round % 2 === 0 ? ['base', 'head'] as const : ['head', 'base'] as const) {
      results[side].push(await runOnce(side, `${side}-${round + 1}`));
    }
  }
} finally {
  if (!args.url) {
    await $`docker compose down`.cwd(composeDir).quiet().nothrow();
  }
  await $`git worktree remove --force ${worktree}`.cwd(root).quiet().nothrow();
}

// The share of the ways to split the rounds in two in which the head is worse in at least as many pairs of rounds
const pairsWorse = (base: number[], head: number[]) =>
  head.reduce((total, h) => total + base.reduce((sum, b) => sum + (h > b ? 1 : h === b ? 0.5 : 0), 0), 0);
const pWorse = (base: number[], head: number[]) => {
  const pooled = [...base, ...head];
  const observed = pairsWorse(base, head);
  let total = 0;
  let asWorse = 0;
  const pick = (start: number, chosen: number[]) => {
    if (chosen.length === head.length) {
      const others = pooled.filter((_, i) => !chosen.includes(i));
      total++;
      if (pairsWorse(others, chosen.map(i => pooled[i]!)) >= observed) asWorse++;
      return;
    }
    for (let i = start; i < pooled.length; i++) pick(i + 1, [...chosen, i]);
  };
  pick(0, []);
  return asWorse / total;
};
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

const series = new Map<string, { run: string, metric: Metric, base: number[], head: number[] }>();
for (const side of ['base', 'head'] as const) {
  for (const file of results[side]) {
    for (const run of file.runs) {
      for (const metric of metrics(run)) {
        const key = `${runKey(run)}|${metric.name}`;
        const entry = series.get(key) ?? { run: runKey(run), metric, base: [], head: [] };
        entry[side].push(metric.value);
        series.set(key, entry);
      }
    }
  }
}

let slower = 0;
let faster = 0;
const rows = new Map<string, Record<string, Record<string, string>>>();
const changes: Array<{ run: string, metric: string, base: number, head: number, ratio: number, p: number, change: string }> = [];
for (const { run, metric, base, head } of series.values()) {
  if (base.length !== rounds || head.length !== rounds) continue;
  const [b, h] = [median(base), median(head)];
  const ratio = b === 0 ? 1 : h / b;
  const negate = (values: number[]) => values.map(value => -value);
  const [worseBase, worseHead] = metric.higherIsBetter ? [negate(base), negate(head)] : [base, head];
  const p = Math.min(pWorse(worseBase, worseHead), pWorse(worseHead, worseBase));
  const worse = metric.higherIsBetter ? ratio < 1 - threshold : ratio > 1 + threshold;
  const better = metric.higherIsBetter ? ratio > 1 + threshold : ratio < 1 - threshold;
  const significant = (worse ? pWorse(worseBase, worseHead) : pWorse(worseHead, worseBase)) <= alpha;
  const negligible = metric.unit === 'ms' && Math.abs(h - b) < minMs;
  const tail = / p9[59]$/.test(metric.name) && !args.tails;
  const change = negligible || !significant ? '' : worse ? (tail ? 'slower tail' : 'SLOWER') : better ? 'faster' : '';
  if (change === 'SLOWER') slower++;
  if (change === 'faster') faster++;
  if (change) changes.push({ run, metric: metric.name, base: b, head: h, ratio, p, change });
  if (change || args.all) {
    const spread = (values: number[]) => `${format(Math.min(...values))}–${format(Math.max(...values))}`;
    const table = rows.get(run) ?? {};
    table[metric.name] = {
      base: `${format(b)} ${metric.unit}`,
      head: `${format(h)} ${metric.unit}`,
      ratio: `${ratio.toFixed(2)}x`,
      p: p.toFixed(3),
      'base rounds': spread(base),
      'head rounds': spread(head),
      change,
    };
    rows.set(run, table);
  }
}

console.log(`\nBase ${baseSha.slice(0, 8)} against the working tree, ${rounds} rounds each, medians of the rounds`);
for (const [run, table] of rows) {
  console.log(`\n${run}`);
  console.table(table);
}
await Bun.write(path.join(outDir, 'summary.json'), JSON.stringify({ base: baseSha, rounds, runArgs, threshold, minMs, alpha, changes }, null, 2));
console.log(`\n${slower} metric(s) slower and ${faster} faster by more than ${Math.round(threshold * 100)}% at p <= ${alpha}, of ${series.size}`);
console.log(`Results in ${path.relative(process.cwd(), outDir)}`);
if (args.fail && slower > 0) {
  process.exit(1);
}
