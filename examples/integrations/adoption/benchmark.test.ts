import { expect, test } from "bun:test";
import { regressions, type Benchmark } from "./benchmark.ts";
import { withSection } from "./benchmark-docs.ts";

const benchmark = (before: number, after: number): Benchmark => ({
  example: "kysely",
  date: "2026-01-01",
  machine: { cpu: "cpu", cores: 1, memory: "1 GiB", os: "os" },
  versions: {},
  settings: { requests: 1, warmup: 0, rounds: 1, concurrency: 1, users: 1 },
  results: [{ request: "List projects", method: "GET", path: "/projects", before: { median: before, p95: before, rps: 1 }, after: { median: after, p95: after, rps: 1 } }],
});

test("a request is flagged when the app after got slower against the app before than benchmark.json says", () => {
  const committed = benchmark(1, 2);
  // Both apps twice as slow, on a slower machine: the same slowdown
  expect(regressions(benchmark(2, 4), committed, 1, 2)).toEqual([]);
  // More than twice the slowdown, and 4 ms slower than expected
  expect(regressions(benchmark(1, 6.5), committed, 1, 2)).toEqual([{ request: "List projects", then: 2, now: 6.5, growth: 2.25 }]);
  // More than twice the slowdown, but less than 2 ms slower than expected
  expect(regressions(benchmark(0.1, 0.5), committed, 1, 2)).toEqual([]);
});

test("the Benchmark section of a page is replaced, or added at its end", () => {
  const section = "## Benchmark\n\nnew\n";
  expect(withSection("# Page\n\n## Install\n\ntext\n", section)).toBe("# Page\n\n## Install\n\ntext\n\n## Benchmark\n\nnew\n");
  expect(withSection("# Page\n\n## Benchmark\n\nold\n", section)).toBe("# Page\n\n## Benchmark\n\nnew\n");
  expect(withSection("# Page\n\n## Benchmark\n\nold\n\n## Next\n\nmore\n", section)).toBe("# Page\n\n## Benchmark\n\nnew\n\n## Next\n\nmore\n");
});
