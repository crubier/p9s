import { parseArgs } from 'node:util';
import { format, metrics, runKey as key, type ResultFile } from './metrics';

const usage = `
Usage: bun compare.ts <before.json> <after.json> [options]

Compares two result files of run.ts, run by run (same size, id mode and combine mode) and scenario by scenario.

  --threshold <ratio>     Relative change reported as slower or faster (default: 0.2)
  --min-ms <ms>           Ignore latency changes smaller than this, they are noise (default: 0.05)
  --all                   Also print the scenarios that did not change
  --fail                  Exit with code 1 when something got slower
`;

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    threshold: { type: 'string', default: '0.2' },
    'min-ms': { type: 'string', default: '0.05' },
    all: { type: 'boolean', default: false },
    fail: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
});

if (args.help || positionals.length !== 2) {
  console.log(usage);
  process.exit(args.help ? 0 : 1);
}

const [before, after] = await Promise.all(positionals.map(file => Bun.file(file).json() as Promise<ResultFile>)) as [ResultFile, ResultFile];
const threshold = Number(args.threshold);
const minMs = Number(args['min-ms']);

console.log(`Before: ${positionals[0]} (${before.git.sha.slice(0, 8)}${before.git.dirty ? ' dirty' : ''}, ${before.createdAt})`);
console.log(`After:  ${positionals[1]} (${after.git.sha.slice(0, 8)}${after.git.dirty ? ' dirty' : ''}, ${after.createdAt})`);

let slower = 0;
for (const run of after.runs) {
  const previous = before.runs.find(candidate => key(candidate) === key(run));
  if (!previous) {
    console.log(`\n${key(run)}: no matching run before`);
    continue;
  }
  const old = new Map(metrics(previous).map(metric => [metric.name, metric]));
  const current = new Map(metrics(run).map(metric => [metric.name, metric]));
  const rows: Record<string, Record<string, string>> = {};
  for (const metric of current.values()) {
    const previousMetric = old.get(metric.name);
    if (!previousMetric) {
      rows[metric.name] = { before: '', after: `${format(metric.value)} ${metric.unit}`, ratio: '', change: 'new' };
      continue;
    }
    const ratio = previousMetric.value === 0 ? 1 : metric.value / previousMetric.value;
    const negligible = metric.unit === 'ms' && Math.abs(metric.value - previousMetric.value) < minMs;
    const worse = metric.higherIsBetter ? ratio < 1 - threshold : ratio > 1 + threshold;
    const better = metric.higherIsBetter ? ratio > 1 + threshold : ratio < 1 - threshold;
    const change = negligible ? '' : worse ? 'SLOWER' : better ? 'faster' : '';
    if (change === 'SLOWER') slower++;
    if (change || args.all) {
      rows[metric.name] = { before: `${format(previousMetric.value)} ${metric.unit}`, after: `${format(metric.value)} ${metric.unit}`, ratio: `${ratio.toFixed(2)}x`, change };
    }
  }
  for (const metric of old.values()) {
    if (!current.has(metric.name)) {
      rows[metric.name] = { before: `${format(metric.value)} ${metric.unit}`, after: '', ratio: '', change: 'gone' };
    }
  }
  console.log(`\n${key(run)}`);
  if (Object.keys(rows).length > 0) {
    console.table(rows);
  } else {
    console.log('  no change beyond the threshold');
  }
}

console.log(`\n${slower} metric(s) slower by more than ${Math.round(threshold * 100)}%`);
if (args.fail && slower > 0) {
  process.exit(1);
}
