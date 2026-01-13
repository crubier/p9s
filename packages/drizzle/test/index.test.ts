import { describe, test, expect } from "bun:test";
import { generateConfigurationFromDrizzleSchema, extractTablesFromDrizzleSchema } from "../generate-config";
import * as schema1 from "./sample/schema1";
import * as schema2 from "./sample/schema2";

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

describe("generateConfigurationFromDrizzleSchema", () => {
  test("generates basic config from drizzle schema", () => {
    const config = generateConfigurationFromDrizzleSchema(schema1, {
      users: ["owner", "viewer"],
      tables: {},
    });

    expect(config).toMatchSnapshot();
  });

  test("sets default permissions to 0 for all users", () => {
    const config = generateConfigurationFromDrizzleSchema(schema1, {
      users: ["owner", "viewer"],
      tables: {},
    });

    expect(config).toMatchSnapshot();
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

    expect(config).toMatchSnapshot();
  });

  test("marks tables as resource or role", () => {
    const config = generateConfigurationFromDrizzleSchema(schema1, {
      users: ["owner"],
      tables: {
        folder: { isResource: true },
        user: { isRole: true },
      },
    });

    expect(config).toMatchSnapshot();
  });

  test("uses custom schema name", () => {
    const config = generateConfigurationFromDrizzleSchema(schema1, {
      users: ["owner"],
      schema: "custom_schema",
      tables: {},
    });

    expect(config).toMatchSnapshot();
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

    expect(config).toMatchSnapshot();
  });
});

describe("isResource and isRole inference", () => {
  test("infers isRole for role-like table names (case insensitive)", () => {
    const config = generateConfigurationFromDrizzleSchema(schema2, {
      users: ["admin"],
      tables: {},
    });

    expect(config).toMatchSnapshot();
  });

  test("User table (capitalized) is inferred as role", () => {
    const config = generateConfigurationFromDrizzleSchema(schema2, {
      users: ["admin"],
      tables: {},
    });

    const userTable = config.tables?.find((t) => t.name === "User");
    expect(userTable?.isRole).toBe(true);
    expect(userTable?.isResource).toBe(true);
  });

  test("GROUP table (uppercase) is inferred as role", () => {
    const config = generateConfigurationFromDrizzleSchema(schema2, {
      users: ["admin"],
      tables: {},
    });

    const groupTable = config.tables?.find((t) => t.name === "GROUP");
    expect(groupTable?.isRole).toBe(true);
    expect(groupTable?.isResource).toBe(true);
  });

  test("Teams table (mixed case plural) is inferred as role", () => {
    const config = generateConfigurationFromDrizzleSchema(schema2, {
      users: ["admin"],
      tables: {},
    });

    const teamsTable = config.tables?.find((t) => t.name === "Teams");
    expect(teamsTable?.isRole).toBe(true);
    expect(teamsTable?.isResource).toBe(true);
  });

  test("members table (lowercase plural) is inferred as role", () => {
    const config = generateConfigurationFromDrizzleSchema(schema2, {
      users: ["admin"],
      tables: {},
    });

    const membersTable = config.tables?.find((t) => t.name === "members");
    expect(membersTable?.isRole).toBe(true);
    expect(membersTable?.isResource).toBe(true);
  });

  test("ACCOUNTS table (uppercase plural) is inferred as role", () => {
    const config = generateConfigurationFromDrizzleSchema(schema2, {
      users: ["admin"],
      tables: {},
    });

    const accountsTable = config.tables?.find((t) => t.name === "ACCOUNTS");
    expect(accountsTable?.isRole).toBe(true);
    expect(accountsTable?.isResource).toBe(true);
  });

  test("tokens table is inferred as role", () => {
    const config = generateConfigurationFromDrizzleSchema(schema2, {
      users: ["admin"],
      tables: {},
    });

    const tokensTable = config.tables?.find((t) => t.name === "tokens");
    expect(tokensTable?.isRole).toBe(true);
    expect(tokensTable?.isResource).toBe(true);
  });

  test("Role table is inferred as role", () => {
    const config = generateConfigurationFromDrizzleSchema(schema2, {
      users: ["admin"],
      tables: {},
    });

    const roleTable = config.tables?.find((t) => t.name === "Role");
    expect(roleTable?.isRole).toBe(true);
    expect(roleTable?.isResource).toBe(true);
  });

  test("document table is inferred as resource only", () => {
    const config = generateConfigurationFromDrizzleSchema(schema2, {
      users: ["admin"],
      tables: {},
    });

    const documentTable = config.tables?.find((t) => t.name === "document");
    expect(documentTable?.isResource).toBe(true);
    expect(documentTable?.isRole).toBeUndefined();
  });

  test("Project table is inferred as resource only", () => {
    const config = generateConfigurationFromDrizzleSchema(schema2, {
      users: ["admin"],
      tables: {},
    });

    const projectTable = config.tables?.find((t) => t.name === "Project");
    expect(projectTable?.isResource).toBe(true);
    expect(projectTable?.isRole).toBeUndefined();
  });

  test("settings table is inferred as resource only", () => {
    const config = generateConfigurationFromDrizzleSchema(schema2, {
      users: ["admin"],
      tables: {},
    });

    const settingsTable = config.tables?.find((t) => t.name === "settings");
    expect(settingsTable?.isResource).toBe(true);
    expect(settingsTable?.isRole).toBeUndefined();
  });

  test("explicit isResource=false overrides inference", () => {
    const config = generateConfigurationFromDrizzleSchema(schema2, {
      users: ["admin"],
      tables: {
        document: { isResource: false },
      },
    });

    const documentTable = config.tables?.find((t) => t.name === "document");
    expect(documentTable?.isResource).toBeUndefined();
    expect(documentTable?.isRole).toBeUndefined();
  });

  test("explicit isRole=true overrides inference for non-role table", () => {
    const config = generateConfigurationFromDrizzleSchema(schema2, {
      users: ["admin"],
      tables: {
        document: { isRole: true },
      },
    });

    const documentTable = config.tables?.find((t) => t.name === "document");
    expect(documentTable?.isResource).toBe(true);
    expect(documentTable?.isRole).toBe(true);
  });

  test("explicit isResource=true overrides inference for role table", () => {
    const config = generateConfigurationFromDrizzleSchema(schema2, {
      users: ["admin"],
      tables: {
        User: { isResource: true },
      },
    });

    const userTable = config.tables?.find((t) => t.name === "User");
    expect(userTable?.isResource).toBe(true);
    expect(userTable?.isRole).toBe(true);
  });
});
