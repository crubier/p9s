import { describe, test, expect } from "bun:test";
import { extractTablesFromDrizzleSchema } from "../generate-config";
import * as schema1 from "./sample/schema1";

describe("extractTablesFromDrizzleSchema", () => {
  test("extracts all tables from schema", () => {
    const tables = extractTablesFromDrizzleSchema(schema1);
    expect(tables).toHaveLength(3);
  });

  test("ignores non-table exports", () => {
    const schemaWithExtras = {
      ...schema1,
      someFunction: () => { },
      someConstant: "hello",
      someObject: { foo: "bar" },
    };
    const tables = extractTablesFromDrizzleSchema(schemaWithExtras);
    expect(tables).toHaveLength(3);
  });
});
