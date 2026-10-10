import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Glob } from "bun";
import Ajv2020 from "ajv/dist/2020";
import { configJsonSchema, configJsonSchemaUrl } from "./json-schema.ts";

const root = path.resolve(import.meta.dir, "../..");
const schema = configJsonSchema();
const validate = new Ajv2020({ strict: false, allErrors: true }).compile(schema);

describe("the JSON Schema of the config", () => {
  test("the files of @p9s/core and of the website are up to date, see scripts/schema.ts", () => {
    for (const file of ["packages/core/p9s.config.schema.json", "website/static/p9s.config.schema.json"]) {
      expect(JSON.parse(readFileSync(path.join(root, file), "utf8"))).toEqual(JSON.parse(JSON.stringify(schema)));
    }
    expect(schema.$id).toBe(configJsonSchemaUrl);
  });

  test("every JSON config of the repository is valid", () => {
    const files = ["examples/*/*/p9s.config.json", "packages/*/p9s.config.json"].flatMap(pattern => [...new Glob(pattern).scanSync({ cwd: root })]);
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      const valid = validate(JSON.parse(readFileSync(path.join(root, file), "utf8")));
      expect({ file, errors: valid ? [] : validate.errors }).toEqual({ file, errors: [] });
    }
  });

  test("a key the config does not have is an error, but $schema", () => {
    const config = { $schema: configJsonSchemaUrl, engine: { users: ["app_user"] }, tables: [{ name: "folder", isResource: true }] };
    expect(validate(config)).toBe(true);
    expect(validate({ ...config, tables: [{ name: "folder", isResouce: true }] })).toBe(false);
    expect(validate({ ...config, engine: { user: ["app_user"] } })).toBe(false);
  });
});
