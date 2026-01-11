const [{ result: pgliteResult }, { result: pgResult }] = await Promise.all([
  import("./pglite"),
  import("./pg"),
]);

console.table([{ Name: "PGLite", result: pgliteResult }, { Name: "PG", result: pgResult }])