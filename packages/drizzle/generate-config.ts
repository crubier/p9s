import type { Table } from "drizzle-orm";
import type { Config, TableConfig } from "@p9s/core";

type DrizzleTable = Table<any>;

type DrizzleSchema = Record<string, DrizzleTable | unknown>;

export interface DrizzleP9sOptions<User extends string> {
  users: User[];
  schema?: string;
  tables: {
    [tableName: string]: {
      isResource?: boolean;
      isRole?: boolean;
      resourceId?: string;
      resourceFkey?: string;
      roleId?: string;
      roleFkey?: string;
      permission?: { [user in User]?: Partial<{ select: number; insert: number; update: number; delete: number }> };
    };
  };
  engine?: Partial<Config<User>["engine"]>;
  migration?: Partial<Config<User>["migration"]>;
}

function getTableName(table: DrizzleTable): string {
  return (table as any)[Symbol.for("drizzle:Name")] as string;
}

function getTableSchema(table: DrizzleTable): string {
  return ((table as any)[Symbol.for("drizzle:Schema")] as string) ?? "public";
}

function isPgTable(value: unknown): value is DrizzleTable {
  return (
    typeof value === "object" &&
    value !== null &&
    Symbol.for("drizzle:Name") in value &&
    Symbol.for("drizzle:Columns") in value
  );
}

const ROLE_TABLE_NAMES = new Set(["user", "users", "group", "groups", "team", "teams", "token", "tokens", "member", "members", "account", "accounts", "role", "roles"]);

function isLikelyRoleTable(tableName: string): boolean {
  return ROLE_TABLE_NAMES.has(tableName.toLowerCase());
}

export function extractTablesFromDrizzleSchema(drizzleSchema: DrizzleSchema): DrizzleTable[] {
  const tables: DrizzleTable[] = [];

  for (const [key, value] of Object.entries(drizzleSchema)) {
    if (isPgTable(value)) {
      tables.push(value);
    }
  }

  return tables;
}

export function generateConfigurationFromDrizzleSchema<User extends string>(
  drizzleSchema: DrizzleSchema,
  options: DrizzleP9sOptions<User>
): Config<User> {
  const tables = extractTablesFromDrizzleSchema(drizzleSchema);

  const tableConfigs: Array<Partial<TableConfig<User>>> = tables.map((table) => {
    const tableName = getTableName(table);
    const tableSchema = getTableSchema(table);
    const tableOptions = options.tables[tableName] ?? {};

    const tableConfig: Partial<TableConfig<User>> = {
      name: tableName,
    };

    if (tableSchema !== "public") {
      tableConfig.schema = tableSchema;
    }

    const inferredIsRole = isLikelyRoleTable(tableName);
    const isResource = tableOptions.isResource ?? true;
    const isRole = tableOptions.isRole ?? inferredIsRole;

    if (isResource) {
      tableConfig.isResource = true;
    }
    if (isRole) {
      tableConfig.isRole = true;
    }
    if (tableOptions.resourceId) {
      tableConfig.resourceId = tableOptions.resourceId;
    }
    if (tableOptions.resourceFkey) {
      tableConfig.resourceFkey = tableOptions.resourceFkey;
    }
    if (tableOptions.roleId) {
      tableConfig.roleId = tableOptions.roleId;
    }
    if (tableOptions.roleFkey) {
      tableConfig.roleFkey = tableOptions.roleFkey;
    }

    if (tableOptions.permission) {
      const permission: Partial<{ [user in User]: Partial<{ select: number; insert: number; update: number; delete: number }> }> = {};
      for (const user of options.users) {
        if (tableOptions.permission[user]) {
          const userPerm = tableOptions.permission[user]!;
          const filteredPerm: Partial<{ select: number; insert: number; update: number; delete: number }> = {};
          if (userPerm.select !== undefined && userPerm.select !== 0) filteredPerm.select = userPerm.select;
          if (userPerm.insert !== undefined && userPerm.insert !== 0) filteredPerm.insert = userPerm.insert;
          if (userPerm.update !== undefined && userPerm.update !== 0) filteredPerm.update = userPerm.update;
          if (userPerm.delete !== undefined && userPerm.delete !== 0) filteredPerm.delete = userPerm.delete;
          if (Object.keys(filteredPerm).length > 0) {
            permission[user] = filteredPerm;
          }
        }
      }
      if (Object.keys(permission).length > 0) {
        tableConfig.permission = permission as any;
      }
    }

    return tableConfig;
  });

  const config: Config<User> = {
    tables: tableConfigs as any,
  };

  if (options.users.length > 0 || options.schema || options.engine) {
    config.engine = {};
    if (options.users.length > 0) {
      config.engine.users = options.users as any;
    }
    if (options.schema && options.schema !== "public") {
      config.engine.schema = options.schema;
    }
    if (options.engine) {
      config.engine = { ...config.engine, ...options.engine };
    }
  }

  if (options.migration) {
    config.migration = options.migration;
  }

  return config;
}

export { type Config, type TableConfig } from "@p9s/core";
