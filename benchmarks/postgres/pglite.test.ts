import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { setupTests } from '@p9s/postgres-testing/pglite'
import { runPostgresBenchmark, type CombineMode } from './generator';

// Keeps the benchmark runnable, the numbers themselves come from `bun run bench`
describe('postgres benchmark smoke test', () => {
  const { context, setup, teardown } = setupTests();

  beforeEach(setup)
  afterEach(teardown)

  for (const combineAssignmentsWith of ["none", "role"] as CombineMode[]) {
    test(`runs every scenario with combine=${combineAssignmentsWith}`, async () => {
      const result = await runPostgresBenchmark(context, { benchmarkSizeFactor: 3, idMode: "integer", combineAssignmentsWith, reps: 2, warmup: 0 })

      expect(result.cache.find(({ table }) => table === "resource_edge_cache")!.rows).toBeGreaterThan(result.dataset.resourceEdges);
      expect(result.cache.some(({ table }) => table === "assignment_edge_cache")).toBe(combineAssignmentsWith !== "none");
      expect(result.reads.filter(({ policy }) => policy === "p9s")).toHaveLength(4);
      expect(result.reads.filter(({ policy }) => policy === "baseline")).toHaveLength(4);
      expect(result.writes.length).toBeGreaterThan(20);
      expect(result.writes.every(({ stats }) => stats.n === 2 && stats.p50 >= 0)).toBe(true);

      expect(result.reads.find(read => read.policy === "p9s" && read.name === "count visible (folder)")!.meanVisibleRows).toBeGreaterThan(0);
      expect(result.baselineMatches).toBe(true);
    }, { timeout: 180000 })
  }
});
