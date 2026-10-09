import { getCompleteConfig, type Config, type ParentConfig } from "@p9s/core";
import { createMigrationSql } from "./generation.ts";
import type { Queryable } from "./identity.ts";

// What p9s init reads of a table: its columns, its primary key, and its foreign keys of one column
export interface TableShape {
  name: string;
  columns: { name: string; type: string; notNull: boolean }[];
  primaryKey: string[];
  foreignKeys: { column: string; schema: string; table: string; key: string }[];
}

export const readTables = async (client: Queryable, schema = "public"): Promise<TableShape[]> => {
  const { rows } = await client.query<TableShape>(`
    select c.relname as "name",
      coalesce((select json_agg(json_build_object('name', a.attname, 'type', format_type(a.atttypid, a.atttypmod), 'notNull', a.attnotnull) order by a.attnum)
        from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped), '[]') as "columns",
      coalesce((select json_agg(a.attname order by k.ord)
        from pg_constraint p, unnest(p.conkey) with ordinality as k(attnum, ord), pg_attribute a
        where p.conrelid = c.oid and p.contype = 'p' and a.attrelid = c.oid and a.attnum = k.attnum), '[]') as "primaryKey",
      coalesce((select json_agg(json_build_object('column', a.attname, 'schema', rn.nspname, 'table', r.relname, 'key', ra.attname) order by a.attnum)
        from pg_constraint f
        join pg_class r on r.oid = f.confrelid
        join pg_namespace rn on rn.oid = r.relnamespace
        join pg_attribute a on a.attrelid = c.oid and a.attnum = f.conkey[1]
        join pg_attribute ra on ra.attrelid = r.oid and ra.attnum = f.confkey[1]
        where f.conrelid = c.oid and f.contype = 'f' and cardinality(f.conkey) = 1), '[]') as "foreignKeys"
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = $1 and c.relkind in ('r', 'p') and not c.relispartition
    order by c.relname`, [schema]);
  return rows;
};

export interface ProposeOptions<User extends string> {
  users?: User[];
  schema?: string;
}

export interface Proposal<User extends string> {
  config: Config<User>;
  // What was guessed and what was left out, for a person to check
  notes: string[];
}

const singular = (name: string) => {
  const lower = name.toLowerCase();
  return lower.endsWith("ies") ? `${lower.slice(0, -3)}y` : lower.endsWith("s") && !lower.endsWith("ss") ? lower.slice(0, -1) : lower;
};

// Tables of a tenant, which are both the top of the resource tree and a role that holds everyone in it
const TENANTS = new Set(["organization", "organisation", "org", "workspace", "tenant", "company", "team_space"]);
// Tables of people and groups of them
const ROLES = new Set(["user", "member", "membership", "team", "group", "role"]);
const MIGRATIONS = /^(__drizzle_migrations|_prisma_migrations|schema_migrations|ar_internal_metadata|knex_migrations(_lock)?|django_migrations|goose_db_version|flyway_schema_history|kysely_migration(_lock)?|typeorm_metadata|migrations)$/;
const SESSIONS = new Set(["session", "verification", "verification_token", "passkey", "two_factor", "jwk", "authenticator"]);

// A config to start from, guessed from tables and foreign keys: tenants are resources and roles, people and groups
// are roles, every other table with a key of one column is a resource, under the tables its foreign keys point to
export const proposeConfig = <User extends string = "app_user">(tables: TableShape[], options: ProposeOptions<User> = {}): Proposal<User> => {
  const users = options.users ?? (["app_user"] as User[]);
  const schema = options.schema ?? "public";
  const notes: string[] = [];
  // The tables of a p9s migration, when the database already ran one
  const own = new Set([...createMigrationSql({ engine: { users }, tables: [] }).matchAll(/create table if not exists "([^"]+)"/g)].map(match => match[1]));

  const isAuthAccount = (table: TableShape) =>
    singular(table.name) === "account" && table.columns.some(({ name }) => /^provider(_?id)?$|^providerId$/.test(name));
  const kept = tables.filter(table => {
    if (own.has(table.name)) return false;
    if (MIGRATIONS.test(table.name) || SESSIONS.has(singular(table.name)) || isAuthAccount(table)) {
      notes.push(`${table.name}: left out, it belongs to migrations or authentication`);
      return false;
    }
    if (table.primaryKey.length !== 1) {
      notes.push(`${table.name}: left out, it has no primary key of one column. A join table, like team members, can become graph edges later`);
      return false;
    }
    return true;
  });

  const kind = (table: TableShape) => {
    const name = singular(table.name);
    return TENANTS.has(name) ? "tenant" : ROLES.has(name) ? "role" : "resource";
  };
  const byName = new Map(kept.map(table => [table.name, table]));
  const isResource = (table: TableShape) => kind(table) !== "role";
  const isRole = (table: TableShape) => kind(table) !== "resource";

  // Parents in the order a row takes them: its own table first, as a folder in a folder, then the others
  const parents = (table: TableShape, accepts: (target: TableShape) => boolean): ParentConfig[] => table.foreignKeys
    .filter(fk => fk.schema === schema && byName.has(fk.table) && byName.get(fk.table)!.primaryKey[0] === fk.key && accepts(byName.get(fk.table)!))
    .sort((a, b) => Number(b.table === table.name) - Number(a.table === table.name))
    .map(fk => ({ column: fk.column, table: fk.table, key: fk.key }));

  const permission = { select: 0, insert: 1, update: 2, delete: 3, manageAccess: 0, share: 4 };
  const configTables = kept.map(table => {
    const entry: Record<string, unknown> = { name: table.name };
    const said: string[] = [];
    if (isResource(table)) {
      entry.isResource = true;
      const resourceParent = parents(table, isResource);
      if (resourceParent.length > 0) entry.resourceParent = resourceParent.length === 1 ? resourceParent[0] : resourceParent;
      said.push(`a resource ${resourceParent.length ? `under ${resourceParent.map(p => `${p.table} (${table.name}.${p.column})`).join(", or else ")}` : "at the top of the tree"}`);
    }
    if (isRole(table)) {
      entry.isRole = true;
      // A person is in tenants and groups, not under another person
      const roleParent = parents(table, target => isRole(target) && singular(target.name) !== "user");
      if (roleParent.length > 0) entry.roleParent = roleParent.length === 1 ? roleParent[0] : roleParent;
      said.push(`a role${roleParent.length ? ` in ${roleParent.map(p => p.table).join(", or else ")}` : ""}`);
    }
    if (isResource(table)) entry.permission = Object.fromEntries(users.map(user => [user, permission]));
    else said.push("no policies on it, so grant what users may do on it, or make it a resource");
    notes.push(`${table.name}: ${said.join(", and ")}`);
    return entry;
  });

  const resources = kept.filter(isResource).map(table => table.name);
  if (resources.length > 0) {
    notes.push(`The policies decide which rows users see and change, once they may use the tables: grant select, insert, update, delete on ${resources.join(", ")} to ${users.join(", ")}`);
  }
  const defaults = getCompleteConfig({ engine: { users } }).engine;
  const uuid = kept.length > 0 && kept.every(table => table.columns.find(({ name }) => name === table.primaryKey[0])?.type === "uuid");
  const config = {
    engine: {
      users,
      ...(schema !== "public" ? { schema } : {}),
      // The server sets app.role_id to the role id of the user for each transaction, with createIdentity or withUser
      authentication: { getCurrentUserId: "current_role_id", setting: "app.role_id" },
      ...(uuid ? { id: { mode: "uuid" as const } } : {}),
      permission: { ...defaults.permission, bitmap: { ...defaults.permission.bitmap, names: { read: 0, create: 1, edit: 2, delete: 3, share: 4 } } },
    },
    tables: configTables,
  } as Config<User>;
  return { config, notes };
};
