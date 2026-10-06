import { printSchema } from "postgraphile/graphql";
import { pool } from "./db.js";
import { pgl } from "./graphql.js";

// Writes the GraphQL schema PostGraphile builds from the database, to review what it exposes, and for the types of
// the operations of the app
const { schema } = await pgl.getSchemaResult();
await Bun.write(new URL("../schema.graphql", import.meta.url), printSchema(schema));
await pgl.release();
await pool.end();
console.log("Wrote schema.graphql");
