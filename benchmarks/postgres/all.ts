const [{ result: pgliteResult }, { result: pgResult }] = await Promise.all([
  import("./pglite"),
  import("./pg"),
]);

console.table([
  { Name: "PGLite", Duration: (pgliteResult / 1000).toFixed(3) },
  { Name: "PG", Duration: (pgResult / 1000).toFixed(3) }
])