import type { Config } from "@p9s/core";
import { getCompleteConfig } from "@p9s/core";
import { createMigrationSql } from "./generation.ts";
import type { Queryable } from "./identity.ts";
import { migrationStatus, type MigrationStatus } from "./status.ts";

export interface MigrateOptions {
  // Runs the migration even when the database already ran the migration of the config
  force?: boolean;
  // Creates the users and graph writers of the config that do not exist yet, as roles without login, and grants them
  // to the role that runs the migration, so that it can act as them
  createRoles?: boolean;
}

export interface MigrateResult {
  // Whether the migration ran: it does not when the database already ran the migration of the config
  ran: boolean;
  // Roles created for the users and graph writers of the config
  createdRoles: string[];
  before: MigrationStatus;
}

const quoteIdentifier = (name: string) => `"${name.replaceAll('"', '""')}"`;
const quoteLiteral = (value: string) => `'${value.replaceAll("'", "''")}'`;

// Runs the migration of a config in one transaction: it applies completely or not at all. The client must not be in a
// transaction already.
export const migrate = async <User extends string>(client: Queryable, config: Config<User>, options: MigrateOptions = {}): Promise<MigrateResult> => {
  const { force = false, createRoles = true } = options;
  const complete = getCompleteConfig(config);
  const roles = [...new Set([...complete.engine.users, ...complete.engine.graphWriters])];
  await client.query("begin");
  try {
    // Concurrent runs wait for each other, then find the database up to date
    await client.query(`select pg_advisory_xact_lock(hashtext(${quoteLiteral(`p9s:migrate:${complete.engine.schema}`)}))`);
    const before = await migrationStatus(client, config);
    if (before.state === "current" && !force) {
      await client.query("rollback");
      return { ran: false, createdRoles: [], before };
    }
    const createdRoles: string[] = [];
    if (createRoles && roles.length > 0) {
      const { rows } = await client.query<{ rolname: string }>(`select rolname from pg_roles where rolname = any ($1::text[])`, [roles]);
      const existing = new Set(rows.map(row => row.rolname));
      for (const role of roles.filter(role => !existing.has(role))) {
        await client.query(`create role ${quoteIdentifier(role)} nologin`);
        await client.query(`grant ${quoteIdentifier(role)} to current_user`);
        createdRoles.push(role);
      }
    }
    await client.query("set local client_min_messages = warning");
    await client.query(createMigrationSql(config));
    await client.query("commit");
    return { ran: true, createdRoles, before };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  }
};
