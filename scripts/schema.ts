// Writes the JSON Schema of the config of p9s, to @p9s/core and to the website, which serves it at its $id:
// bun scripts/schema.ts
import path from "node:path";
import { configJsonSchema } from "../packages/core/json-schema.ts";

const root = path.resolve(import.meta.dir, "..");
const text = `${JSON.stringify(configJsonSchema(), null, 2)}\n`;
for (const file of ["packages/core/p9s.config.schema.json", "website/static/p9s.config.schema.json"]) {
  await Bun.write(path.join(root, file), text);
  console.log(`Wrote ${file}`);
}
