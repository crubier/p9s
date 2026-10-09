import { getCompleteConfig, getCompleteNamingConfig, parentsOf, type Config } from "@p9s/core";
import type { Queryable } from "./identity.ts";
import { migrationStatus } from "./status.ts";

export interface Finding {
  check: "migration" | "roles" | "rls" | "grants" | "indexes" | "jit" | "cache";
  level: "ok" | "warn" | "error";
  message: string;
}

export interface DoctorOptions {
  // How many rows of each tree to compare with a recompute of their cache, 200 by default
  sample?: number;
}

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

// Checks a database against a config: that it ran the migration, that RLS applies to the users, that they may use the
// tables, that parent columns are indexed, that JIT is off for them, and that caches match a recompute of a sample
export const diagnose = async <User extends string>(client: Queryable, config: Config<User>, options: DoctorOptions = {}): Promise<Finding[]> => {
  const complete = getCompleteConfig(config);
  const naming = getCompleteNamingConfig(complete);
  const { users, graphWriters } = complete.engine;
  const findings: Finding[] = [];
  const add = (check: Finding["check"], level: Finding["level"], message: string) => findings.push({ check, level, message });
  const tableName = (table: { name: string }) => `${quote(naming.tables[table.name]!.schema)}.${quote(table.name)}`;
  // The policies are on the resource tables
  const tables = complete.tables.filter(table => table.isResource);

  const status = await migrationStatus(client, config);
  if (status.state === "missing") {
    add("migration", "error", "No p9s migration in this database: generate it with p9s postgres generate, run it, then check again");
    return findings;
  }
  add("migration", status.state === "current" ? "ok" : "warn", status.state === "current"
    ? `The database ran the migration of the config (p9s ${status.installed!.version})`
    : `The database ran another migration (p9s ${status.installed!.version}, ${status.installed!.hash}) than that of the config (${status.expected.hash}): run the new one`);

  // RLS does not apply to superusers, to roles with bypassrls, or to the owner of a table without force row level security
  const { rows: roles } = await client.query<{ name: string; exists: boolean; bypass: boolean; owns: string[] | null }>(`
    select "the_user" as "name", "r"."oid" is not null as "exists", coalesce("r"."rolsuper" or "r"."rolbypassrls", false) as "bypass",
      (select array_agg("c"."relname"::text order by "c"."relname") from pg_class "c" where "c"."relowner" = "r"."oid" and "c"."oid" = any($2::regclass[]) and not "c"."relforcerowsecurity") as "owns"
    from unnest($1::text[]) as "the_user" left join pg_roles "r" on "r"."rolname" = "the_user"`, [users, tables.map(tableName)]);
  for (const role of roles) {
    if (!role.exists) add("roles", "error", `The role ${role.name} does not exist`);
    else if (role.bypass) add("roles", "error", `${role.name} is a superuser or has bypassrls: the policies do not apply to it`);
    else if (role.owns?.length) add("roles", "error", `${role.name} owns ${role.owns.join(", ")}: the policies do not apply to the owner of a table`);
  }
  if (roles.every(role => role.exists && !role.bypass && !role.owns?.length)) add("roles", "ok", `The policies apply to ${users.join(", ")}`);

  const { rows: rls } = await client.query<{ name: string; enabled: boolean }>(`
    select "c"."relname" as "name", "c"."relrowsecurity" as "enabled" from pg_class "c" where "c"."oid" = any($1::regclass[]) order by 1`, [tables.map(tableName)]);
  const disabled = rls.filter(table => !table.enabled).map(table => table.name);
  add("rls", disabled.length ? "error" : "ok", disabled.length
    ? `Row level security is off on ${disabled.join(", ")}: run the migration again, or alter table ... enable row level security`
    : `Row level security is on for the ${rls.length} resource tables`);

  const { rows: missing } = await client.query<{ user: string; table: string }>(`
    select "the_user" as "user", "the_table"::regclass::text as "table"
    from unnest($1::text[]) as "the_user", unnest($2::text[]) as "the_table"
    where exists (select from pg_roles where rolname = "the_user") and not has_table_privilege("the_user", "the_table", 'select')
    order by 1, 2`, [users, tables.map(tableName)]);
  if (missing.length) {
    for (const user of new Set(missing.map(row => row.user))) {
      add("grants", "warn", `${user} may not read ${missing.filter(row => row.user === user).map(row => row.table).join(", ")}: grant select (and insert, update, delete) on them to ${user}`);
    }
  } else add("grants", "ok", "The users may read the resource tables");

  // A parent column without an index makes every change of a parent look for its children through the whole table
  const parentColumns = complete.tables.flatMap(table => [...parentsOf(table.resourceParent), ...parentsOf(table.roleParent)].map(parent => ({ table, column: parent.column })));
  const { rows: unindexed } = await client.query<{ table: string; column: string }>(`
    select "the_column"."table", "the_column"."column"
    from json_to_recordset($1::json) as "the_column" ("table" text, "column" text)
    where not exists (
      select from pg_index "i" join pg_attribute "a" on "a"."attrelid" = "i"."indrelid" and "a"."attnum" = "i"."indkey"[0]
      where "i"."indrelid" = "the_column"."table"::regclass and "a"."attname" = "the_column"."column")`,
    [JSON.stringify(parentColumns.map(({ table, column }) => ({ table: tableName(table), column })))]);
  for (const { table, column } of unindexed) {
    add("indexes", "warn", `${table}.${column} holds parents and has no index: create index on ${table} (${quote(column)})`);
  }
  if (!unindexed.length) add("indexes", "ok", `The ${parentColumns.length} parent columns have indexes`);

  // Policies are estimated at the cost of what they may read, and with JIT Postgres compiles queries that run in less
  // time than that takes
  // Settings of the role in this database first, then of the role, then of the database, then of the server
  const { rows: jit } = await client.query<{ user: string; jit: string }>(`
    select "the_user" as "user", coalesce(
      (select split_part("s"."setting", '=', 2) from pg_db_role_setting "d", unnest("d"."setconfig") as "s" ("setting")
        where "d"."setrole" in (0, (select oid from pg_roles where rolname = "the_user"))
        and "d"."setdatabase" in (0, (select oid from pg_database where datname = current_database()))
        and "s"."setting" like 'jit=%'
        order by "d"."setrole" <> 0 desc, "d"."setdatabase" <> 0 desc limit 1),
      (select "reset_val" from pg_settings where "name" = 'jit')) as "jit"
    from unnest($1::text[]) as "the_user"`, [users]);
  const jitOn = jit.filter(row => row.jit === "on").map(row => row.user);
  if (jitOn.length) add("jit", "warn", `JIT is on for ${jitOn.join(", ")}: unless the server sets jit = off for each transaction, alter role ${jitOn.join(", ")} set jit = off`);
  else add("jit", "ok", "JIT is off for the users");

  // The cache of a sample of nodes against a recompute from the edges, as the policies read the cache
  const sample = options.sample ?? 200;
  for (const kind of ["resource", "role"] as const) {
    const names = naming[kind];
    const bound = complete.tables.filter(table => kind === "resource" ? table.isResource && !table.resourceLeaf : table.isRole && !table.roleLeaf);
    if (!bound.length || sample <= 0) continue;
    const ids = bound.map(table => `select ${quote(kind === "resource" ? naming.tables[table.name]!.resourceId : naming.tables[table.name]!.roleId)} as "id" from ${tableName(table)}`).join(" union all ");
    // With resourceCache "assigned", the cache only keeps the ancestors of a node that have assignments
    const kept = kind === "resource" && complete.engine.resourceCache === "assigned"
      ? `where "the_closure"."parent_id" = "the_closure"."child_id" or exists (select from ${quote(naming.assignment.edge)} "the_assignment" where "the_assignment"."resource_id" = "the_closure"."parent_id")`
      : "";
    const { rows: [result] } = await client.query<{ checked: number; wrong: number; example: string | null }>(`
      with "the_node" as (select "id" from (${ids}) as "the_id" where "id" is not null order by random() limit ${Math.floor(sample)}),
      "the_diff" as (
        select "the_node"."id" from "the_node" where exists (
          (select "parent_id", "permission" from ${quote(names.edgeCache)} where "child_id" = "the_node"."id"
            except all
            select "the_closure"."parent_id", "the_closure"."permission" from ${quote(names.edgeCacheParentCompute)} ("the_node"."id") as "the_closure" ${kept})
          union all
          (select "the_closure"."parent_id", "the_closure"."permission" from ${quote(names.edgeCacheParentCompute)} ("the_node"."id") as "the_closure" ${kept}
            except all
            select "parent_id", "permission" from ${quote(names.edgeCache)} where "child_id" = "the_node"."id")))
      select (select count(*)::int from "the_node") as "checked", count(*)::int as "wrong", min("id"::text) as "example" from "the_diff"`);
    add("cache", result!.wrong ? "error" : "ok", result!.wrong
      ? `The ${kind} cache of ${result!.wrong} of ${result!.checked} sampled nodes differs from a recompute, like ${result!.example}: rebuild it with select ${quote(names.edgeCacheBackfill)}()`
      : `The ${kind} cache of ${result!.checked} sampled nodes matches a recompute`);
  }
  return findings;
};
