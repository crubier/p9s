import { describe, test, expect } from "bun:test";
import { generateConfigurationFromDrizzleSchema } from "../generate-config";
import * as schema2 from "./sample/schema2";

describe("isResource and isRole inference", () => {
  test("infers isRole for role-like table names (case insensitive)", () => {
    const config = generateConfigurationFromDrizzleSchema(schema2, {
      users: ["admin"],
      tables: {},
    });

    expect(config).toMatchInlineSnapshot(`
{
  "engine": {
    "users": [
      "admin",
    ],
  },
  "tables": [
    {
      "isResource": true,
      "isRole": true,
      "name": "ACCOUNTS",
    },
    {
      "isResource": true,
      "isRole": true,
      "name": "GROUP",
    },
    {
      "isResource": true,
      "name": "Project",
    },
    {
      "isResource": true,
      "isRole": true,
      "name": "Role",
    },
    {
      "isResource": true,
      "isRole": true,
      "name": "Teams",
    },
    {
      "isResource": true,
      "isRole": true,
      "name": "User",
    },
    {
      "isResource": true,
      "name": "document",
    },
    {
      "isResource": true,
      "isRole": true,
      "name": "members",
    },
    {
      "isResource": true,
      "name": "settings",
    },
    {
      "isResource": true,
      "isRole": true,
      "name": "tokens",
    },
  ],
}
`);
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
