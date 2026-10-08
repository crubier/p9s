import type { BenchmarkResult } from './generator';

// Lower is better for every metric except throughput
export interface Metric { name: string, value: number, unit: 'ms' | 's' | 'MB' | 'tx/s', higherIsBetter?: boolean }

export interface ResultFile { git: { sha: string, dirty: boolean }, createdAt: string, runs: BenchmarkResult[] }

export const metrics = (run: BenchmarkResult): Metric[] => [
  { name: 'load: cache backfill', value: run.load.enableTriggers, unit: 's' },
  { name: 'cache: total size', value: run.cache.reduce((total, { bytes }) => total + bytes, 0) / 1024 / 1024, unit: 'MB' },
  ...run.reads.flatMap(({ name, policy, stats }) => [
    { name: `read ${policy}: ${name} p50`, value: stats.p50, unit: 'ms' as const },
    { name: `read ${policy}: ${name} p95`, value: stats.p95, unit: 'ms' as const },
  ]),
  ...run.writes.flatMap(({ name, stats }) => [
    { name: `write ${name} p50`, value: stats.p50, unit: 'ms' as const },
    { name: `write ${name} p95`, value: stats.p95, unit: 'ms' as const },
  ]),
  ...(run.concurrency ?? []).flatMap(({ name, throughput, stats }) => [
    { name: `concurrent ${name} throughput`, value: throughput, unit: 'tx/s' as const, higherIsBetter: true },
    { name: `concurrent ${name} p99`, value: stats.p99, unit: 'ms' as const },
  ]),
];

export const runKey = ({ options }: BenchmarkResult) => `${options.benchmarkSizeFactor}/${options.idMode}/${options.combineAssignmentsWith}${options.resourceCache === "assigned" ? "/assigned" : ""}`;

export const format = (value: number) => value < 10 ? value.toFixed(2) : value.toFixed(0);
