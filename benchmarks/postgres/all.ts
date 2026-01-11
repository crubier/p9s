const benchmarks = [
  { name: "PGLite", module: "./pglite" },
  { name: "PG", module: "./pg" },
];

const modules = await Promise.all(benchmarks.map(b => import(b.module)));

const results = benchmarks.flatMap((b, i) =>
  Object.entries(modules[i]).map(([idMode, result]) => ({
    DB: b.name,
    "ID Mode": idMode,
    Duration: ((result as { totalTime: number }).totalTime / 1000).toFixed(3),
  }))
);

console.table(results);