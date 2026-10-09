import type { Config } from "@p9s/core";
import { expectedMigrationRecord, migrationRecordFunction, type MigrationRecord } from "./generation.ts";
import type { Queryable } from "./identity.ts";

export interface MigrationStatus {
  // current when the database ran the migration of the config, outdated when it ran another one, of another config or
  // version of p9s, missing when it never ran one
  state: "current" | "outdated" | "missing";
  expected: MigrationRecord;
  installed: MigrationRecord | null;
}

// Whether the database ran the migration of the config, for a deploy to check before it serves requests
export const migrationStatus = async <User extends string>(client: Queryable, config: Config<User>): Promise<MigrationStatus> => {
  const expected = expectedMigrationRecord(config);
  const fn = `"${migrationRecordFunction(config).replaceAll('"', '""')}"`;
  const { rows: [found] } = await client.query<{ exists: boolean }>(`select to_regprocedure($1) is not null as exists`, [`${fn}()`]);
  if (!found?.exists) return { state: "missing", expected, installed: null };
  const { rows: [row] } = await client.query<{ record: MigrationRecord }>(`select ${fn}() as record`);
  const installed = row!.record;
  return { state: installed.hash === expected.hash ? "current" : "outdated", expected, installed };
};
