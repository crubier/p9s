import { postgraphile } from "postgraphile";
import { printSchema } from "postgraphile/graphql";
import { pool } from "./db";
import { preset } from "./graphile.config";

// Writes the GraphQL schema PostGraphile builds from the database, to review what it exposes
const pgl = postgraphile(preset);
const { schema } = await pgl.getSchemaResult();
await Bun.write(new URL("../schema.graphql", import.meta.url), printSchema(schema));
await pgl.release();
await pool.end();
console.log("Wrote schema.graphql");
