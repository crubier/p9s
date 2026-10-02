import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { setupTests } from '@p9s/postgres-testing/pglite'
import { runPostgresBenchmark, type CombineMode, type CommentMode } from './generator';

// Keeps the benchmark runnable, the numbers themselves come from `bun run bench`
describe('postgres benchmark smoke test', () => {
  const { context, setup, teardown } = setupTests();

  beforeEach(setup)
  afterEach(teardown)

  const runs: Array<{ combineAssignmentsWith: CombineMode, comments: CommentMode }> = [
    { combineAssignmentsWith: "none", comments: "leaf" },
    { combineAssignmentsWith: "role", comments: "leaf" },
    { combineAssignmentsWith: "none", comments: "node" },
  ];
  for (const { combineAssignmentsWith, comments } of runs) {
    test(`runs every scenario with combine=${combineAssignmentsWith}, comments as ${comments}s`, async () => {
      const result = await runPostgresBenchmark(context, { benchmarkSizeFactor: 3, idMode: "integer", combineAssignmentsWith, comments, reps: 2, warmup: 0 })

      const resourceCache = result.cache.find(({ table }) => table === "resource_edge_cache")!.rows;
      expect(resourceCache).toBeGreaterThan(result.dataset.resourceEdges);
      // A row per node and ancestor or self. As nodes, comments add theirs: themselves, their post and its 4 ancestors.
      const treeCache = [3, 9, 27, 81, 243].reduce((total, nodes, depth) => total + nodes * (depth + 1), 0);
      expect(resourceCache).toBe(treeCache + (comments === "node" ? 6 * result.dataset.comments : 0));
      expect(result.cache.some(({ table }) => table === "assignment_edge_cache")).toBe(combineAssignmentsWith !== "none");
      expect(result.dataset.comments).toBeGreaterThan(0);
      expect(result.reads.filter(({ policy }) => policy === "p9s")).toHaveLength(8);
      expect(result.reads.filter(({ policy }) => policy === "baseline")).toHaveLength(4);
      expect(result.writes.length).toBeGreaterThan(20);
      expect(result.writes.filter(({ name }) => name.startsWith("comment: "))).toHaveLength(6);
      expect(result.writes.every(({ stats }) => stats.n === 2 && stats.p50 >= 0)).toBe(true);

      expect(result.reads.find(read => read.policy === "p9s" && read.name === "count visible (folder)")!.meanVisibleRows).toBeGreaterThan(0);
      expect(result.reads.find(read => read.policy === "p9s" && read.name === "count visible (comment)")!.meanVisibleRows).toBeGreaterThan(0);
      expect(result.baselineMatches).toBe(true);
    }, { timeout: 180000 })
  }
});
