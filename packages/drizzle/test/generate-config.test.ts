import { describe, test, expect } from "bun:test";
import { generateConfigurationFromDrizzleSchema } from "../generate-config";
import * as schema1 from "./sample/schema1";

describe("generateConfigurationFromDrizzleSchema", () => {
  test("generates basic config from drizzle schema", () => {
    const config = generateConfigurationFromDrizzleSchema(schema1, {
      users: ["owner", "viewer"],
      tables: {},
    });

    expect(config).toMatchInlineSnapshot(`
{
  "engine": {
    "users": [
      "owner",
      "viewer",
    ],
  },
  "tables": [
    {
      "isResource": true,
      "name": "folder",
    },
    {
      "isResource": true,
      "name": "image",
    },
    {
      "isResource": true,
      "isRole": true,
      "name": "user",
    },
  ],
}
`);
  });

  test("applies custom permissions from options", () => {
    const config = generateConfigurationFromDrizzleSchema(schema1, {
      users: ["owner", "viewer"],
      tables: {
        folder: {
          isResource: true,
          permission: {
            owner: { select: 1, insert: 1, update: 1, delete: 1 },
            viewer: { select: 1 },
          },
        },
      },
    });

    expect(config).toMatchInlineSnapshot(`
{
  "engine": {
    "users": [
      "owner",
      "viewer",
    ],
  },
  "tables": [
    {
      "isResource": true,
      "name": "folder",
      "permission": {
        "owner": {
          "delete": 1,
          "insert": 1,
          "select": 1,
          "update": 1,
        },
        "viewer": {
          "select": 1,
        },
      },
    },
    {
      "isResource": true,
      "name": "image",
    },
    {
      "isResource": true,
      "isRole": true,
      "name": "user",
    },
  ],
}
`);
  });

  test("uses custom schema name", () => {
    const config = generateConfigurationFromDrizzleSchema(schema1, {
      users: ["owner"],
      schema: "custom_schema",
      tables: {},
    });

    expect(config).toMatchInlineSnapshot(`
{
  "engine": {
    "schema": "custom_schema",
    "users": [
      "owner",
    ],
  },
  "tables": [
    {
      "isResource": true,
      "name": "folder",
    },
    {
      "isResource": true,
      "name": "image",
    },
    {
      "isResource": true,
      "isRole": true,
      "name": "user",
    },
  ],
}
`);
  });

  test("passes through engine and migration options", () => {
    const config = generateConfigurationFromDrizzleSchema(schema1, {
      users: ["owner"],
      tables: {},
      engine: {
        permission: {
          bitmap: { size: 256 },
        },
      },
      migration: {
        output: { sql: "custom-migration.sql" },
      },
    });

    expect(config).toMatchInlineSnapshot(`
{
  "engine": {
    "permission": {
      "bitmap": {
        "size": 256,
      },
    },
    "users": [
      "owner",
    ],
  },
  "migration": {
    "output": {
      "sql": "custom-migration.sql",
    },
  },
  "tables": [
    {
      "isResource": true,
      "name": "folder",
    },
    {
      "isResource": true,
      "name": "image",
    },
    {
      "isResource": true,
      "isRole": true,
      "name": "user",
    },
  ],
}
`);
  });
});
