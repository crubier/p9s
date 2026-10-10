
// To get syntax highlighting in VSCode with the qufiwefefwoyn.inline-sql-syntax extension
import { type SQL, query as sql, join, literal, identifier, compile, raw } from "pg-sql2";
import { getCompleteConfig, getCompleteNamingConfig, getNaming, linkIssues, parentsOf } from "@p9s/core";
import type { Bits, CompleteConfig, Naming, Config, LinkEnd } from "@p9s/core";
import { version } from "./version.ts";

type Kind = "resource" | "role";

export const createMigration = <User extends string>(config: Config<User>) => {
  const completeConfig = getCompleteConfig(config);
  const body = createMigrationBody(completeConfig);
  return sql`${body}
${createMigrationRecord(completeConfig, recordOf(body))}`;
};

const createMigrationBody = <User extends string>(completeConfig: CompleteConfig<User>) => {
  const naming = getNaming(completeConfig);

  return sql`
  ${createMigrationPreamble(naming, completeConfig)}

  ${createMigrationTriggerNames(completeConfig)}

  ${createMigrationExtensions(naming, completeConfig)}${createMigrationAuthentication(naming, completeConfig)}

  ${createMigrationAggregates(naming, completeConfig)}

  ${createMigrationGraphTables("resource", naming, completeConfig)}

  ${createMigrationGraphTables("role", naming, completeConfig)}

  ${createMigrationAssignmentTable(naming, completeConfig)}

  ${createMigrationDataModelBindings(naming, completeConfig)}

  ${createMigrationViews("resource", naming, completeConfig)}

  ${createMigrationViews("role", naming, completeConfig)}

  ${createMigrationLegacyUpgrade("resource", naming, completeConfig)}

  ${createMigrationLegacyUpgrade("role", naming, completeConfig)}

  ${createMigrationResourceOrRole("resource", naming, completeConfig)}

  ${createMigrationResourceOrRole("role", naming, completeConfig)}

  ${createMigrationAssignments(naming, completeConfig)}

  ${createMigrationCurrentUserViews(naming, completeConfig)}

  ${createMigrationDataModelPolicies(naming, completeConfig)}

  ${createMigrationPermissionFlags(naming, completeConfig)}

  ${createMigrationSharing(naming, completeConfig)}

  ${createMigrationSoftDelete(naming, completeConfig)}

  ${createMigrationNodeViews(naming, completeConfig)}


  ${createMigrationCleanup(naming, completeConfig)}

  ${createMigrationLeaves(naming, completeConfig)}

  ${createMigrationBootstrap(naming, completeConfig)}

  ${createMigrationLinks(naming, completeConfig)}${createMigrationPrivileges(naming, completeConfig)}
  `;
};

type Operation = "select" | "insert" | "update" | "delete";
const operations: Operation[] = ["select", "insert", "update", "delete"];

// What users may run on the tables of the app: what their permissions name with grantPrivileges, and the privileges of
// links. Only grants, so that grants of the app stay.
const createMigrationPrivileges = <User extends string>(naming: Naming<User>, config: CompleteConfig<User>) => {
  const grants: Array<{ schema: SQL, table: SQL, user: string, operations: Operation[] }> = [];
  if (config.engine.grantPrivileges) {
    for (const table of config.tables) {
      const tableNaming = naming.tables[table.name]!;
      for (const [user, bits] of Object.entries(table.permission ?? {})) {
        const granted = operations.filter(operation => (bits as Partial<Record<Operation, unknown>>)[operation] != null);
        if (granted.length > 0) grants.push({ schema: tableNaming.schema, table: sql`${tableNaming.schema}.${tableNaming.name}`, user, operations: granted });
      }
    }
  }
  for (const link of config.links) {
    const linkNaming = naming.links[link.name]!;
    for (const [user, granted] of Object.entries(link.privileges ?? {})) {
      if (granted.length > 0) grants.push({ schema: linkNaming.schema, table: sql`${linkNaming.schema}.${linkNaming.name}`, user, operations: operations.filter(operation => granted.includes(operation)) });
    }
  }
  if (grants.length === 0) return sql``;
  const schemas = new Map(grants.map(grant => [`${compile(grant.schema).text} ${grant.user}`, grant]));
  return sql`

-----------------------------------------------------------------------------------------------------------------------
-- Privileges of the users on the tables of the app
-----------------------------------------------------------------------------------------------------------------------
${join([...schemas.values()].map(({ schema, user }) => sql`
grant usage on schema ${schema} to ${identifier(user)};`), ``)}
${join(grants.map(({ table, user, operations: granted }) => sql`
grant ${raw(granted.join(", "))} on table ${table} to ${identifier(user)};${granted.includes("insert") ? sql`
do $$
declare
  "the_sequence" text;
begin
  for "the_sequence" in
    select pg_get_serial_sequence(${textLiteral(compile(table).text)}, "attname") from pg_attribute
    where "attrelid" = ${textLiteral(compile(table).text)}::regclass and "attnum" > 0 and not "attisdropped"
    and pg_get_serial_sequence(${textLiteral(compile(table).text)}, "attname") is not null
  loop
    execute format('grant usage on sequence %s to %I', "the_sequence", ${textLiteral(user)});
  end loop;
end
$$;` : sql``}`), ``)}
`;
};

// What a database that ran the migration of a config returns from its record function
export interface MigrationRecord { version: string; hash: string }

const recordOf = (body: SQL): MigrationRecord => ({ version, hash: migrationHash(compile(body).text) });

// The record the migration of a config makes, to compare with what a database returns
export const expectedMigrationRecord = <User extends string>(config: Config<User>) =>
  recordOf(createMigrationBody(getCompleteConfig(config)));

// A hash to tell whether a database ran this migration, not a cryptographic one, as migrations are also generated in
// browsers. 64 bits, from two lanes of 32.
const migrationHash = (text: string) => {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
};

// The function the migration creates last, so that it only exists once everything before it ran
export const migrationRecordFunction = <User extends string>(config: Config<User>) => `${getCompleteNamingConfig(getCompleteConfig(config)).prefix}p9s_migration`;

const createMigrationRecord = (config: CompleteConfig<any>, record: MigrationRecord) => {
  return sql`
-----------------------------------------------------------------------------------------------------------------------
-- What ran: the version of p9s and a hash of the migration, which p9s postgres status compares to the config
-----------------------------------------------------------------------------------------------------------------------
create or replace function ${identifier(migrationRecordFunction(config))} () returns jsonb
  as $$ select ${textLiteral(JSON.stringify(record))}::jsonb $$
  language sql immutable;
${grantExecute(sql`${identifier(migrationRecordFunction(config))} ()`, getRoles(config).everyone)}
`;
};


const getIdType = (config: CompleteConfig<any>) => {
  return {
    "uuid": {
      type: sql`uuid`,
      extension: sql`create extension if not exists "uuid-ossp";`,
    },
    "integer": {
      type: sql`integer`,
      extension: sql``,
    },
  }[config.engine.id.mode];
}

// The users with a share bit on some table, who write assignments through the policies of the assignment table
const sharers = (config: CompleteConfig<any>): string[] => config.engine.users.filter((user: string) =>
  config.tables.some(table => table.isResource && !table.resourceLeaf && table.permission?.[user]?.share != null));

const getRoles = (config: CompleteConfig<any>) => {
  const users: string[] = config.engine.users;
  const writers: string[] = config.engine.graphWriters;
  return { users, writers, everyone: [...new Set([...users, ...writers])] };
}

// pg-sql2's literal() turns most strings into bind parameters, which a multi-statement migration script cannot use
const textLiteral = (value: string) => raw(`'${value.replace(/'/g, "''")}'`);

// The name behind an identifier, as stored in the catalogs
const nameOf = (name: SQL) => compile(name).text.slice(1, -1).replace(/""/g, '"');

const roleArray = (roles: string[]) => sql`array[${join(roles.map(textLiteral), ", ")}]::text[]`;

// Tables are passed as a regclass literal so the helper can look up their owner and serial sequences
// Other roles lose every privilege on the table, for roles that had some in earlier versions
const setPrivileges = (target: SQL, readRoles: string[], writeRoles: string[], otherRoles: string[] = []) =>
  sql`select pg_temp.p9s_set_privileges(${textLiteral(compile(target).text)}::regclass, ${roleArray(readRoles)}, ${roleArray(writeRoles)}, ${roleArray(otherRoles)});`;

const grantExecute = (fn: SQL, roles: string[]) => {
  const signature = compile(fn).text;
  const name = signature.match(/"((?:[^"]|"")+)"\s*\(/)![1]!.replaceAll('""', '"');
  return sql`
select pg_temp.p9s_revoke_execute(${textLiteral(signature)}, ${textLiteral(name)});
${join(roles.map(role => sql`grant execute on function ${fn} to ${identifier(role)};`), `\n`)}`;
};

const definer = (naming: Naming<any>) => sql`security definer set search_path = ${naming.schema}, pg_temp`;

const ones = (config: CompleteConfig<any>) => sql`~ b'0'::bit(${literal(config.engine.permission.bitmap.size)})`;

// Ids of new rows: one sequence per tree in integer mode, so that ids are unique across all the bound tables
const idDefault = (kind: Kind, naming: Naming<any>, config: CompleteConfig<any>) => config.engine.id.mode === "uuid"
  ? sql`uuid_generate_v4()`
  : sql`nextval(${textLiteral(compile(naming[kind].idSequence).text)}::regclass)`;

// Graph writes are serialized so that, under READ COMMITTED, each trigger statement sees edges committed by
// concurrent writers. Under REPEATABLE READ / SERIALIZABLE the trigger snapshot would predate those commits.
const lockKey = (config: CompleteConfig<any>) => textLiteral(`p9s:${config.engine.schema}:${config.engine.naming.prefix ?? ""}`);

const lockGraph = (config: CompleteConfig<any>) => sql`
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'p9s: permission graph writes must run in READ COMMITTED isolation, not %', current_setting('transaction_isolation');
  end if;
  perform pg_advisory_xact_lock(hashtext(${lockKey(config)}));`;

const lockGraphStatement = (config: CompleteConfig<any>) =>
  sql`perform pg_advisory_xact_lock(hashtext(${lockKey(config)}));`;

// Kept as a hashed subplan. A plain `in` in a where clause becomes a semi-join, and with hash joins disabled that
// rescans the whole subquery for every outer row.
const isIn = (value: SQL, subquery: SQL) => sql`(${value} in (${subquery})) is true`;

// The planner has no estimate for recursive queries and assumes many affected nodes, so it hashes the whole edge
// and cache tables when a few index lookups would do. Index lookups stay proportional to the rows actually touched.
const indexLookupsOnly = sql`
set enable_hashjoin = off
set enable_mergejoin = off`;

type TriggerEvent = "insert" | "update" | "delete";

// Statement triggers see the changed rows as "p9s_old_rows" and "p9s_new_rows". A trigger with transition tables
// can only have one event.
const attachStatementTrigger = (functionName: SQL, triggerName: SQL, table: SQL, event: TriggerEvent) => sql`
drop trigger if exists ${triggerName} on ${table};
create trigger ${triggerName}
after ${{ insert: sql`insert`, update: sql`update`, delete: sql`delete` }[event]} on ${table}
referencing ${{ insert: sql`new table as "p9s_new_rows"`, update: sql`old table as "p9s_old_rows" new table as "p9s_new_rows"`, delete: sql`old table as "p9s_old_rows"` }[event]}
for each statement execute function ${functionName}();
`;

const triggerFunction = (naming: Naming<any>, functionName: SQL, body: SQL, settings = sql``) => sql`
create or replace function ${functionName}()
returns trigger as $$
begin
${body}
  return null;
end;
$$ language plpgsql ${definer(naming)}${settings};

${grantExecute(sql`${functionName} ()`, [])}
`;

// Statement triggers also fire when no row changed, for example on a cascade with nothing to cascade to, which must
// not take the lock or check isolation. `skip` lets a trigger return early on changes that cannot affect the graph.
const statementTrigger = (naming: Naming<any>, config: CompleteConfig<any>, functionName: SQL, triggerName: SQL, table: SQL, event: TriggerEvent, body: SQL, settings = sql``, skip?: SQL) => sql`
${triggerFunction(naming, functionName, sql`
  if not exists (select from ${event === "delete" ? sql`"p9s_old_rows"` : sql`"p9s_new_rows"`}) then
    return null;
  end if;
  ${skip ? sql`if ${skip} then
    return null;
  end if;` : sql``}
  ${lockGraph(config)}
${body}`, settings)}
${attachStatementTrigger(functionName, triggerName, table, event)}`;


interface Parent {
  column: SQL;
  // Present when the parent column holds a key of the parent table rather than its id
  lookup?: { table: SQL, key: SQL, id: SQL, tableName: string };
  function: SQL;
}

// A bound table: each of its rows is a node of the resource (or role) tree, identified by its id column
interface Binding {
  table: SQL;
  tableName: string;
  id: SQL;
  triggerFunction: SQL;
  triggers: Record<TriggerEvent, SQL>;
  // The parent of a row is in the first of these columns that it sets
  parents: Parent[];
  // A row whose column of this name is not null is soft deleted
  softDelete?: SQL;
  // On leaf tables: the column holding the resource (or role) id of the parent when the parent column holds a key, and
  // the trigger that keeps it
  leaf: { parentId: SQL, triggerFunction: SQL, trigger: SQL };
}

const isOfKind = (kind: Kind, table: CompleteConfig<any>["tables"][number]) => kind === "resource" ? table.isResource : table.isRole;
const isLeafOfKind = (kind: Kind, table: CompleteConfig<any>["tables"][number]) => kind === "resource" ? table.resourceLeaf : table.roleLeaf;

const getBindings = (kind: Kind, naming: Naming<any>, config: CompleteConfig<any>): Binding[] =>
  config.tables.filter(table => isOfKind(kind, table) && !isLeafOfKind(kind, table)).map(table => toBinding(kind, naming, config, table));

// Leaf tables are described like bound tables, but their rows are not nodes: only their parent is used
const getLeaves = (kind: Kind, naming: Naming<any>, config: CompleteConfig<any>): Binding[] =>
  config.tables.filter(table => isOfKind(kind, table) && isLeafOfKind(kind, table)).map(table => toBinding(kind, naming, config, table));

// Tables whose rows have an id of the tree. Rows of role leaf tables keep one, that tells who the current user is, so
// it is unique across the role nodes as well.
const getIdBindings = (kind: Kind, naming: Naming<any>, config: CompleteConfig<any>): Binding[] =>
  [...getBindings(kind, naming, config), ...(kind === "role" ? getLeaves(kind, naming, config) : [])];

const toBinding = (kind: Kind, naming: Naming<any>, config: CompleteConfig<any>, table: CompleteConfig<any>["tables"][number]): Binding => {
  const tableNaming = naming.tables[table.name];
  if (!tableNaming) {
    throw new Error(`Table naming config not found for table: ${table.name}`);
  }
  const id = kind === "resource" ? tableNaming.resourceId : tableNaming.roleId;
  const parentConfigs = parentsOf(kind === "resource" ? table.resourceParent : table.roleParent);
  const parentFunction = kind === "resource" ? tableNaming.resourceParentFunction : tableNaming.roleParentFunction;
  const binding: Binding = {
    table: sql`${tableNaming.schema}.${tableNaming.name}`,
    tableName: table.name,
    id,
    triggerFunction: kind === "resource" ? tableNaming.resourceTriggerFunction : tableNaming.roleTriggerFunction,
    triggers: kind === "resource"
      ? { insert: tableNaming.resourceInsertTrigger, update: tableNaming.resourceUpdateTrigger, delete: tableNaming.resourceDeleteTrigger }
      : { insert: tableNaming.roleInsertTrigger, update: tableNaming.roleUpdateTrigger, delete: tableNaming.roleDeleteTrigger },
    leaf: kind === "resource"
      ? { parentId: tableNaming.resourceParentId, triggerFunction: tableNaming.resourceLeafTriggerFunction, trigger: tableNaming.resourceLeafTrigger }
      : { parentId: tableNaming.roleParentId, triggerFunction: tableNaming.roleLeafTriggerFunction, trigger: tableNaming.roleLeafTrigger },
    softDelete: table.softDelete === undefined ? undefined : identifier(table.softDelete),
    parents: parentConfigs.map((parentConfig, index): Parent => {
      const parentTable = parentConfig.table === undefined ? undefined : config.tables.find(other => other.name === parentConfig.table);
      if (parentConfig.table !== undefined && !parentTable) {
        throw new Error(`Parent table ${parentConfig.table} of table ${table.name} is not in the config`);
      }
      const parentNaming = parentTable && naming.tables[parentTable.name]!;
      const parentId = parentNaming && (kind === "resource" ? parentNaming.resourceId : parentNaming.roleId);
      const key = parentConfig.key !== undefined ? identifier(parentConfig.key) : parentId;
      return {
        column: identifier(parentConfig.column),
        lookup: parentNaming && parentId && key && compile(key).text !== compile(parentId).text
          ? { table: sql`${parentNaming.schema}.${parentNaming.name}`, key, id: parentId, tableName: parentTable!.name }
          : undefined,
        function: index === 0 ? parentFunction : identifier(`${nameOf(parentFunction)}_${parentConfig.column}`),
      };
    }),
  };
  return binding;
};

const hasParent = (binding: Binding) => binding.parents.length > 0;

// Soft deleted rows of node tables leave the graph: their edges and assignments wait in tables of their own
const softDeleteBindings = (kind: Kind, naming: Naming<any>, config: CompleteConfig<any>) =>
  getBindings(kind, naming, config).filter(binding => binding.softDelete);
const usesSoftDelete = (kind: Kind, naming: Naming<any>, config: CompleteConfig<any>) => softDeleteBindings(kind, naming, config).length > 0;
const usesAnySoftDelete = (naming: Naming<any>, config: CompleteConfig<any>) =>
  usesSoftDelete("resource", naming, config) || usesSoftDelete("role", naming, config);
// The ids of every soft deleted row of a tree
const deletedIds = (kind: Kind, naming: Naming<any>, config: CompleteConfig<any>) =>
  join(softDeleteBindings(kind, naming, config).map(binding => sql`select "the_deleted".${binding.id} from ${binding.table} as "the_deleted" where "the_deleted".${binding.softDelete!} is not null`), `\n    union all\n    `);
// Whether a node is a soft deleted row, by an index lookup in each table that soft deletes
const isDeletedNode = (kind: Kind, naming: Naming<any>, config: CompleteConfig<any>, value: SQL) => {
  const tables = softDeleteBindings(kind, naming, config);
  return tables.length === 0 ? sql`false` : sql`(${join(tables.map(binding => sql`exists (select from ${binding.table} as "the_deleted" where "the_deleted".${binding.id} = ${value} and "the_deleted".${binding.softDelete!} is not null)`), " or ")})`;
};
const coalesce = (values: SQL[]) => values.length === 1 ? values[0]! : sql`coalesce(${join(values, ", ")})`;
// Whether a row sets one of its parent columns
const setsParent = (binding: Binding, row: SQL) => sql`(${join(binding.parents.map(({ column }) => sql`${row}.${column} is not null`), " or ")})`;
// A leaf row whose parent is a key keeps the id of its parent in a column
const keepsParentId = (binding: Binding) => binding.parents.some(parent => parent.lookup);

// The parent id of a row, as the table owner (in triggers) or through the security definer lookup (in policies)
const parentIdOf = ({ column, lookup }: Parent, row: SQL) => lookup
  ? sql`(select "the_parent".${lookup.id} from ${lookup.table} as "the_parent" where "the_parent".${lookup.key} = ${row}.${column})`
  : sql`${row}.${column}`;
const parentOf = (binding: Binding, row: SQL) => coalesce(binding.parents.map(parent => parentIdOf(parent, row)));
const parentOfInPolicy = (binding: Binding, row: SQL) => coalesce(binding.parents.map(({ column, lookup, function: lookupFunction }) =>
  lookup ? sql`${lookupFunction}(${row}.${column})` : sql`${row}.${column}`));
// A leaf row keeps the id of its parent, so that policies read a column rather than call the lookup for every row
const parentOfLeaf = (binding: Binding, row: SQL) => keepsParentId(binding)
  ? sql`${row}.${binding.leaf.parentId}`
  : coalesce(binding.parents.map(({ column }) => sql`${row}.${column}`));

// A parent key that matches no row of the parent table would silently give no home edge
const checkParentsFound = (binding: Binding, rows: SQL) => join(binding.parents.filter(parent => parent.lookup).map(parent => sql`
  if exists (select from ${rows} as "the_row" where "the_row".${parent.column} is not null and ${parentIdOf(parent, sql`"the_row"`)} is null) then
    raise exception 'p9s: % rows have a % that matches no row of %', ${textLiteral(binding.tableName)}, ${textLiteral(nameOf(parent.column))}, ${textLiteral(parent.lookup!.tableName)}
      using errcode = 'foreign_key_violation';
  end if;`), ``);

const idsOf = (bindings: Binding[], config: CompleteConfig<any>) => bindings.length === 0
  ? sql`select null::${getIdType(config).type} where false`
  : join(bindings.map(({ table, id }) => sql`select ${id} from ${table}`), ` union all `);

// The ids of every bound row: the nodes of the tree
const boundIds = (kind: Kind, naming: Naming<any>, config: CompleteConfig<any>) => idsOf(getBindings(kind, naming, config), config);

// The ids of the nodes and of the role leaf rows, which must not collide either
const allIds = (kind: Kind, naming: Naming<any>, config: CompleteConfig<any>) => idsOf(getIdBindings(kind, naming, config), config);


// Integer ids of a tree come from one sequence shared by its tables, so that they are unique across tables. A bound
// column with ids of its own, like a serial primary key, would collide with the other tables, so the migration stops
// before changing anything.
const ownIdDefaultsCheck = <User extends string>(naming: Naming<User>, config: CompleteConfig<User>) => {
  const columns = (["resource", "role"] as const).flatMap(kind => getIdBindings(kind, naming, config).map(binding => sql`
    (${textLiteral(compile(binding.table).text)}, ${textLiteral(nameOf(binding.id))}, ${textLiteral(compile(naming[kind].idSequence).text)}, ${textLiteral(kind)})`));
  if (columns.length === 0) {
    return sql``;
  }
  return sql`
do $$
declare
  "the_columns" text := (
    select string_agg(format('%s.%I', "the_binding"."table_name", "the_binding"."column_name"), ', ' order by "the_binding"."table_name")
    from (values ${join(columns, `,`)}) as "the_binding" ("table_name", "column_name", "sequence_name", "kind")
    join pg_attribute as "the_column"
      on "the_column"."attrelid" = to_regclass("the_binding"."table_name")
      and "the_column"."attname" = "the_binding"."column_name"
      and not "the_column"."attisdropped"
    where "the_column"."attidentity" <> ''
    or "the_column"."attgenerated" <> ''
    or ("the_column"."atthasdef" and not exists (
      select from pg_attrdef as "the_default"
      join pg_depend as "the_dependency"
        on "the_dependency"."classid" = 'pg_attrdef'::regclass
        and "the_dependency"."objid" = "the_default"."oid"
        and "the_dependency"."refobjid" = to_regclass("the_binding"."sequence_name")
      where "the_default"."adrelid" = "the_column"."attrelid" and "the_default"."adnum" = "the_column"."attnum"
    ))
  );
begin
  if "the_columns" is not null then
    raise exception 'p9s: % already generate their own ids. In integer mode, p9s gives every row of a tree an id from one shared sequence, and ids from another sequence would collide with the other tables. Bind a separate column for p9s instead, for example resourceId: "resource_id" or roleId: "role_id".', "the_columns"
      using errcode = 'invalid_table_definition';
  end if;
end
$$;
`;
}

// Every name of a naming config, with the key that holds it
const namesIn = (value: unknown, key = ""): Array<[string, string]> =>
  typeof value === "string" ? [[key, value]]
    : value && typeof value === "object" ? Object.entries(value).flatMap(([entryKey, entry]) => namesIn(entry, entryKey))
      : [];

// Triggers fire in the order of their names. When the trigger prefix changes, the p9s triggers of the previous prefix
// get the new names, so that the migration replaces them instead of adding triggers that fire next to them. A p9s
// trigger calls a p9s function, and its name ends with the name it has without prefix.
// The migration as text, to write to a file or run with any client
export const createMigrationSql = <User extends string>(config: Config<User>) => compile(createMigration(config)).text;

export const createMigrationTriggerNames = <User extends string>(config: CompleteConfig<User>) => {
  const namingConfig = getCompleteNamingConfig(config);
  const names = namesIn(namingConfig);
  const triggers = [...new Set(names.filter(([key]) => key.endsWith("Trigger")).map(([, name]) => name))];
  const functions = [...new Set(names.map(([, name]) => name))];
  const unprefixed = triggers.map(name => name.slice(namingConfig.triggerPrefix.length));
  const textArray = (values: string[]) => sql`array[${join(values.map(textLiteral), ", ")}]::text[]`;
  return sql`
do $$
declare
  "the_trigger" record;
begin
  for "the_trigger" in
    select "t"."tgrelid"::regclass::text as "table", "t"."tgname"::text as "name", "the_name"."name" as "expected",
      exists (select from pg_trigger as "o" where "o"."tgrelid" = "t"."tgrelid" and "o"."tgname" = "the_name"."name") as "replaced"
    from pg_trigger as "t"
    join pg_proc as "p" on "p"."oid" = "t"."tgfoid"
    join unnest(${textArray(triggers)}, ${textArray(unprefixed)}) as "the_name" ("name", "unprefixed")
      on right("t"."tgname", length("the_name"."unprefixed")) = "the_name"."unprefixed"
    where not "t"."tgisinternal"
    and "t"."tgname" <> all (${textArray(triggers)})
    and "p"."pronamespace" = ${textLiteral(config.engine.schema)}::regnamespace
    and "p"."proname" = any (${textArray(functions)})
  loop
    if "the_trigger"."replaced" then
      execute format('drop trigger %I on %s', "the_trigger"."name", "the_trigger"."table");
    else
      execute format('alter trigger %I on %s rename to %I', "the_trigger"."name", "the_trigger"."table", "the_trigger"."expected");
    end if;
  end loop;
end
$$;
`;
};

export const createMigrationPreamble = <User extends string>(naming: Naming<User>, config: CompleteConfig<User>) => {
  return sql`
-----------------------------------------------------------------------------------------------------------------------
-- Preamble
-----------------------------------------------------------------------------------------------------------------------
-- p9s objects are created unqualified, and security definer functions pin search_path to the configured schema
do $$
begin
  if current_schema() is distinct from ${textLiteral(config.engine.schema)} then
    raise exception 'p9s: run this migration with % as the current schema, got %', ${textLiteral(config.engine.schema)}, current_schema();
  end if;
end
$$;
${config.engine.id.mode === "integer" ? ownIdDefaultsCheck(naming, config) : sql``}

-- Session-local helpers. They never touch the owner's privileges, revoking those would lock the migration role out.
-- Every other role loses what it has on p9s objects, like the privileges that default privileges give to every new
-- table and function, as Supabase does for anon and authenticated, and then gets what the config says.
create or replace function pg_temp.p9s_revoke_relation(target regclass)
returns void as $$
declare
  the_kind text := case (select relkind from pg_class where oid = target) when 'S' then 'sequence' else 'table' end;
  the_role text;
begin
  execute format('revoke all on %s %s from public', the_kind, target);
  for the_role in
    select distinct pg_get_userbyid("the_acl".grantee) from pg_class, aclexplode(relacl) as "the_acl"
    where pg_class.oid = target and "the_acl".grantee not in (0, relowner)
  loop
    execute format('revoke all on %s %s from %I', the_kind, target, the_role);
  end loop;
end;
$$ language plpgsql;

create or replace function pg_temp.p9s_set_privileges(target regclass, read_roles text[], write_roles text[], other_roles text[])
returns void as $$
declare
  owner_role name := (select pg_get_userbyid(relowner) from pg_class where oid = target);
  the_role text;
  the_sequence text;
begin
  perform pg_temp.p9s_revoke_relation(target);
  foreach the_role in array read_roles loop
    continue when the_role = owner_role;
    execute format('grant select on table %s to %I', target, the_role);
  end loop;
  foreach the_role in array write_roles loop
    continue when the_role = owner_role;
    execute format('grant select, insert, update, delete on table %s to %I', target, the_role);
    for the_sequence in
      select pg_get_serial_sequence(target::text, attname) from pg_attribute
      where attrelid = target and attnum > 0 and not attisdropped and pg_get_serial_sequence(target::text, attname) is not null
    loop
      execute format('grant usage, select on sequence %s to %I', the_sequence, the_role);
    end loop;
  end loop;
end;
$$ language plpgsql;

-- The signature of a function can name the type of a column, which regprocedure cannot read: the roles to revoke
-- from are those of the functions of that name
create or replace function pg_temp.p9s_revoke_execute(target text, function_name text)
returns void as $$
declare
  the_role text;
begin
  execute format('revoke execute on function %s from public', target);
  for the_role in
    select distinct pg_get_userbyid("the_acl".grantee) from pg_proc, aclexplode(proacl) as "the_acl"
    where proname = function_name and pronamespace = current_schema()::regnamespace and "the_acl".grantee not in (0, proowner)
  loop
    execute format('revoke execute on function %s from %I', target, the_role);
  end loop;
end;
$$ language plpgsql;
`;
}


export const createMigrationExtensions = <User extends string>(naming: Naming<User>, config: CompleteConfig<User>) => {
  return getIdType(config).extension;
}


// The function that returns the role id of the current user, which may be in another schema, like auth.uid
const currentUserIdFunction = (config: CompleteConfig<any>) => identifier(...config.engine.authentication.getCurrentUserId.split("."));

// With a setting, the current user is the role id the server sets it to for the transaction, none when it is empty
export const createMigrationAuthentication = <User extends string>(naming: Naming<User>, config: CompleteConfig<User>) => {
  const { setting, key, claim } = config.engine.authentication;
  if (key && !setting) throw new Error("engine.authentication.key needs a setting, which holds the key of the current user");
  if (claim && !setting) throw new Error("engine.authentication.claim needs a setting, which holds the claims");
  if (key && !config.tables.some(table => table.name === key.table && table.isRole)) {
    throw new Error(`Table "${key.table}" of engine.authentication.key is not a role table of the config`);
  }
  if (!setting) return sql``;
  const fn = currentUserIdFunction(config);
  const value = claim
    ? sql`nullif(nullif(current_setting(${textLiteral(setting)}, true), '')::jsonb ->> ${textLiteral(claim)}, '')`
    : sql`nullif(current_setting(${textLiteral(setting)}, true), '')`;
  const { type: idType } = getIdType(config);
  const keyTable = key && naming.tables[key.table];
  // With a key, the role id of the row that has it. In plpgsql, whose %type reads the type of the key when it first
  // runs, after the migration added the role id column, and as the owner, whom the policies of the table let through.
  const create = keyTable ? sql`
create or replace function ${fn} () returns ${idType}
  as $$
declare
  "the_key" ${keyTable.schema}.${keyTable.name}.${identifier(key!.column)}%type := ${value};
begin
  return (select ${keyTable.roleId} from ${keyTable.schema}.${keyTable.name} where ${identifier(key!.column)} = "the_key");
end
$$ language plpgsql stable ${definer(naming)};` : sql`
create or replace function ${fn} () returns ${idType}
  as $$ select (${value})::${idType} $$
  language sql stable;`;
  return sql`

-----------------------------------------------------------------------------------------------------------------------
-- Current user
-----------------------------------------------------------------------------------------------------------------------${create}
${grantExecute(sql`${fn} ()`, getRoles(config).everyone)}
`;
};

export const createMigrationAggregates = <User extends string>(naming: Naming<User>, config: CompleteConfig<User>) => {
  const { orBitmap, truncateGuardFunction } = naming;
  const { everyone } = getRoles(config);

  const size = config.engine.permission.bitmap.size;

  return sql`
-----------------------------------------------------------------------------------------------------------------------
-- Special functions
-----------------------------------------------------------------------------------------------------------------------
create or replace aggregate ${orBitmap} (bit) (
  sfunc = bitor,
  stype = bit,
  initcond = ${literal(`0`.repeat(size))}
);

${grantExecute(sql`${orBitmap} (bit)`, everyone)}

-- Truncate skips row and statement triggers, it would leave the graph pointing at rows that no longer exist
create or replace function ${truncateGuardFunction}()
returns trigger as $$
begin
  raise exception 'p9s: % cannot be truncated while p9s triggers are enabled, delete its rows instead, or disable the triggers and enable them again afterwards', tg_table_name;
end;
$$ language plpgsql;

${grantExecute(sql`${truncateGuardFunction} ()`, [])}
`;
}


// Edge and cache tables, and the functions computing the cache from the edges
export const createMigrationGraphTables = <User extends string>(kind: Kind, naming: Naming<User>, config: CompleteConfig<User>) => {
  const { idSequence, edge, parentId, childId, permission, home, edgePkey, edgeParentIdIndex, edgeChildIdIndex,
    edgeCache, edgeCachePkey, edgeCacheParentIdIndex, edgeCacheChildIdIndex, edgeCacheParentCompute, edgeCacheChildCompute,
    varParentId, varChildId } = naming[kind];
  const size = config.engine.permission.bitmap.size;
  const maxDepth = config.engine.permission.maxDepth[kind];
  const { type: idType } = getIdType(config);
  const { orBitmap } = naming;
  const { users, writers, everyone } = getRoles(config);
  const pkeyColumns = kind === "resource" ? [childId, parentId] : [parentId, childId];

  return sql`
-----------------------------------------------------------------------------------------------------------------------
-- ${literal(kind)} ids
-----------------------------------------------------------------------------------------------------------------------
${config.engine.id.mode === "integer" ? sql`
create sequence if not exists ${idSequence} as integer;
select pg_temp.p9s_revoke_relation(${textLiteral(compile(idSequence).text)}::regclass);
${join(everyone.map(user => sql`grant usage, select on sequence ${idSequence} to ${identifier(user)};`), `\n`)}
` : sql``}

-----------------------------------------------------------------------------------------------------------------------
-- ${literal(kind)} edge table
-----------------------------------------------------------------------------------------------------------------------
-- Endpoints are ids of bound rows, checked by the triggers below. Home edges are the ones p9s keeps in sync with the
-- parent column of their child row.
create table if not exists ${edge} (
  ${parentId} ${idType} not null,
  ${childId} ${idType} not null,
  ${permission} bit(${literal(size)}),
  ${home} boolean not null default false,
  constraint ${edgePkey} primary key (${parentId}, ${childId})
);

alter table ${edge} add column if not exists ${home} boolean not null default false;

-- The triggers look up the children of nodes that mostly have none. Postgres estimates such a lookup as the edges per
-- distinct parent, so when a few nodes hold most of the rows, it would scan the whole table for a node without
-- children. Count every node instead: a node has about one child on average.
alter table ${edge} alter column ${parentId} set (n_distinct = -1);

create index if not exists ${edgeParentIdIndex} on ${edge} (${parentId});

create index if not exists ${edgeChildIdIndex} on ${edge} (${childId});

${setPrivileges(edge, [], writers, users)}

-----------------------------------------------------------------------------------------------------------------------
-- ${literal(kind)} transitive edge cache table
-----------------------------------------------------------------------------------------------------------------------
-- Every bound row has a self row (id, id, all bits), which also makes the cache the registry of ids in use
create table if not exists ${edgeCache} (
  ${parentId} ${idType} not null,
  ${childId} ${idType} not null,
  ${permission} bit(${literal(size)}),
  constraint ${edgeCachePkey} primary key (${join(pkeyColumns, ", ")})
);
${kind === "resource" ? sql`
-- The ancestors of a resource are looked up by the primary key, its descendants by the parent index. With the parent
-- first, Postgres 18 could look ancestors up with a skip scan of the primary key, which it expects to take one search
-- per distinct parent, a single one with the estimate below, and which takes one per parent.
do $$
begin
  if (select "the_column"."attname" from pg_index as "the_index"
    join pg_attribute as "the_column" on "the_column"."attrelid" = "the_index"."indrelid" and "the_column"."attnum" = "the_index"."indkey"[0]
    where "the_index"."indexrelid" = ${textLiteral(compile(edgeCachePkey).text)}::regclass) <> ${textLiteral(nameOf(childId))} then
    alter table ${edgeCache} drop constraint ${edgeCachePkey}, add constraint ${edgeCachePkey} primary key (${join(pkeyColumns, ", ")});
  end if;
end
$$;

create index if not exists ${edgeCacheParentIdIndex} on ${edgeCache} (${parentId});

drop index if exists ${edgeCacheChildIdIndex};` : sql`
create index if not exists ${edgeCacheParentIdIndex} on ${edgeCache} (${parentId});

create index if not exists ${edgeCacheChildIdIndex} on ${edgeCache} (${childId});`}
${kind === "resource" ? sql`
-- Policies either check the ancestors of each row, or list once every resource the user can see, from the ones
-- assigned to them. Postgres estimates the descendants of an assigned resource as the cache rows per distinct parent,
-- a few rows, while assignments are mostly high in the tree, over large subtrees. It would then list every visible
-- resource to check a single row. Estimate the descendants of a resource as those of the largest subtree instead.
alter table ${edgeCache} alter column ${parentId} set (n_distinct = 1);
` : sql``}
-- Only p9s triggers write to the cache. Users see their own part of the graph through the views of the current user.
${setPrivileges(edgeCache, writers, [], users)}
${usesSoftDelete(kind, naming, config) ? sql`
-- The edges of soft deleted rows, in either direction, until both their rows are restored
create table if not exists ${naming[kind].edgeDeleted} (
  ${parentId} ${idType} not null,
  ${childId} ${idType} not null,
  ${permission} bit(${literal(size)}),
  ${home} boolean not null default false,
  constraint ${naming[kind].edgeDeletedPkey} primary key (${parentId}, ${childId})
);

create index if not exists ${identifier(`${nameOf(naming[kind].edgeDeleted)}_${nameOf(childId)}_index`)} on ${naming[kind].edgeDeleted} (${childId});

${setPrivileges(naming[kind].edgeDeleted, writers, [], users)}
` : sql``}
-----------------------------------------------------------------------------------------------------------------------
-- ${literal(kind)} compute recursive permissions, towards parent
-----------------------------------------------------------------------------------------------------------------------
create or replace function ${edgeCacheParentCompute} (${varChildId} ${idType})
  returns setof ${edgeCache}
  as $$
  with recursive "search_graph" (${parentId}, ${childId}, ${permission}, "depth", "path") 
  as (
    (values (${varChildId}, ${varChildId}, ~  b'0'::bit(${literal(size)}), 0, array[]::${idType}[])) -- seed
    union all
    select -- recursive query
      "the_edge".${parentId} as ${parentId},
      "the_search_graph".${childId} as ${childId},
      ("the_search_graph".${permission}::bit(${literal(size)}) & "the_edge".${permission}::bit(${literal(size)}))::bit(${literal(size)}) as ${permission}, -- bitwise "and" on permission along a path
      "the_search_graph"."depth" + 1 as "depth", -- increment depth
      "the_search_graph"."path" || "the_edge".${childId} as "path" -- append node id to path
    from ${edge} as "the_edge"
    join "search_graph" as "the_search_graph" 
    on "the_edge".${childId} = "the_search_graph".${parentId}
    where ("the_edge".${childId} <> all ("the_search_graph"."path")) -- prevent from cycling
    and "the_search_graph"."depth" <= ${literal(maxDepth)} -- max search depth
  )
    select
      "the_search_graph".${parentId},
      "the_search_graph".${childId},
      ${orBitmap} ("the_search_graph".${permission}) -- bitwise "or" on permissions between various paths
    from "search_graph" as "the_search_graph"
    group by ("the_search_graph".${parentId}, "the_search_graph".${childId});

-- query a recursive table. you can add limit output or use a cursor
$$
language sql
stable;

${grantExecute(sql`${edgeCacheParentCompute} (${varChildId} ${idType})`, writers)}

-----------------------------------------------------------------------------------------------------------------------
-- ${literal(kind)} compute recursive permissions, towards child
-----------------------------------------------------------------------------------------------------------------------
create or replace function ${edgeCacheChildCompute} (${varParentId} ${idType})
  returns setof ${edgeCache}
  as $$
  with recursive "search_graph" (${parentId}, ${childId}, ${permission}, "depth", "path") 
  as (
    (values (${varParentId}, ${varParentId}, ~  b'0'::bit(${literal(size)}), 0, array[]::${idType}[])) -- seed
    union all
    select -- recursive query
      "the_search_graph".${parentId} as ${parentId},
      "the_edge".${childId} as ${childId},
      ("the_search_graph".${permission}::bit(${literal(size)}) & "the_edge".${permission}::bit(${literal(size)}))::bit(${literal(size)}) as ${permission}, -- bitwise "and" on permission along a path
      "the_search_graph"."depth" + 1 as "depth", -- increment depth
      "the_search_graph"."path" || "the_edge".${parentId} as "path" -- append node id to path
    from ${edge} as "the_edge"
    join "search_graph" as "the_search_graph" 
    on "the_search_graph".${childId} = "the_edge".${parentId}
    where ("the_edge".${parentId} <> all ("the_search_graph"."path")) -- prevent from cycling
    and "the_search_graph"."depth" <= ${literal(maxDepth)} -- max search depth
  )
    select
      "the_search_graph".${parentId},
      "the_search_graph".${childId},
      ${orBitmap} ("the_search_graph".${permission}) -- bitwise "or" on permissions between various paths
    from "search_graph" as "the_search_graph"
    group by ("the_search_graph".${parentId}, "the_search_graph".${childId});

-- query a recursive table. you can add limit output or use a cursor
$$
language sql
stable;

${grantExecute(sql`${edgeCacheChildCompute} (${varParentId} ${idType})`, writers)}
`;
}


export const createMigrationAssignmentTable = <User extends string>(naming: Naming<User>, config: CompleteConfig<User>) => {
  const { edge, resourceId, roleId, permission, edgePkey, edgeResourceIdIndex, edgeRoleIdIndex } = naming.assignment;
  const size = config.engine.permission.bitmap.size;
  const { type: idType } = getIdType(config);
  const { users, writers } = getRoles(config);
  return sql`
-----------------------------------------------------------------------------------------------------------------------
-- Assignment from role to resource
-----------------------------------------------------------------------------------------------------------------------
create table if not exists ${edge} (
  ${resourceId} ${idType} not null,
  ${roleId} ${idType} not null,
  ${permission} bit(${literal(size)}),
  constraint ${edgePkey} primary key (${resourceId}, ${roleId})
);

create index if not exists ${edgeResourceIdIndex} on ${edge} (${resourceId});

create index if not exists ${edgeRoleIdIndex} on ${edge} (${roleId});

-- Users who can share write it too, through its policies
${setPrivileges(edge, [], [...writers, ...sharers(config)], users)}
${usesAnySoftDelete(naming, config) ? sql`
-- The assignments of soft deleted rows, until both their rows are restored
create table if not exists ${naming.assignment.edgeDeleted} (
  ${resourceId} ${idType} not null,
  ${roleId} ${idType} not null,
  ${permission} bit(${literal(size)}),
  constraint ${naming.assignment.edgeDeletedPkey} primary key (${resourceId}, ${roleId})
);

create index if not exists ${identifier(`${nameOf(naming.assignment.edgeDeleted)}_${nameOf(roleId)}_index`)} on ${naming.assignment.edgeDeleted} (${roleId});

${setPrivileges(naming.assignment.edgeDeleted, writers, [], users)}
` : sql``}`;
}


export const createMigrationDataModelBindings = <User extends string>(naming: Naming<User>, config: CompleteConfig<User>) => {
  const { type: idType } = getIdType(config);
  const kinds = ["resource", "role"] as const;

  const addColumn = ({ table, id }: Binding) => sql`
alter table ${table} add column if not exists ${id} ${idType} unique;`;

  // New ids must not collide with ids already in bound columns, like explicit ids or the nodes of older p9s versions
  const advanceSequence = (kind: Kind) => {
    const { idSequence } = naming[kind];
    return sql`
do $$
declare
  "the_max" integer := (select max("the_id"."id") from (${allIds(kind, naming, config)}) as "the_id" ("id"));
begin
  if "the_max" >= (select case when "is_called" then "last_value" + 1 else "last_value" end from ${idSequence}) then
    perform setval(${textLiteral(compile(idSequence).text)}::regclass, "the_max");
  end if;
end
$$;`;
  };

  // Existing rows get a fresh id each. A column that already has a default, like a uuid primary key, keeps it.
  const bindColumn = (kind: Kind, { table, id }: Binding) => sql`
do $$
begin
  if not (select "atthasdef" from pg_attribute where "attrelid" = ${textLiteral(compile(table).text)}::regclass and "attname" = ${textLiteral(nameOf(id))}) then
    alter table ${table} alter column ${id} set default ${idDefault(kind, naming, config)};
  end if;
  -- Only rows of a table bound for the first time have no id. Statement triggers fire even when no row changes, and
  -- the triggers of a table already bound are those of the previous migration, until they are replaced below: they
  -- can read a parent column that is gone.
  if exists (select from ${table} where ${id} is null) then
    update ${table} set ${id} = default where ${id} is null;
  end if;
end
$$;
alter table ${table} alter column ${id} set not null;
`;

  return sql`
-----------------------------------------------------------------------------------------------------------------------
-- Table bindings
-----------------------------------------------------------------------------------------------------------------------
${join(kinds.flatMap(kind => getIdBindings(kind, naming, config).map(addColumn)), `\n`)}
${join(kinds.flatMap(kind => getLeaves(kind, naming, config)).filter(keepsParentId).map(({ table, leaf }) => sql`
alter table ${table} add column if not exists ${leaf.parentId} ${idType};`), `\n`)}
${config.engine.id.mode === "integer" ? join(kinds.map(advanceSequence), `\n`) : sql``}
${join(kinds.flatMap(kind => getIdBindings(kind, naming, config).map(binding => bindColumn(kind, binding))), `\n`)}
`;
}


export const createMigrationViews = <User extends string>(kind: Kind, naming: Naming<User>, config: CompleteConfig<User>) => {
  const { parentId, childId, permission, edgeCacheParentCompute, edgeCacheChildCompute, edgeCacheView } = naming[kind];
  const { users, writers } = getRoles(config);
  const { assignment } = naming;
  if (kind === "resource" && config.engine.resourceCache === "assigned") {
    return sql`
-----------------------------------------------------------------------------------------------------------------------
-- ${literal(kind)} view of the cached transitive edges, computed from scratch
-----------------------------------------------------------------------------------------------------------------------
-- A self row for every resource, and the rows below each resource that has assignments
create or replace view ${edgeCacheView} as
select "the_node"."id" as ${parentId}, "the_node"."id" as ${childId}, (${ones(config)})::bit(${literal(config.engine.permission.bitmap.size)}) as ${permission}
from (${boundIds(kind, naming, config)}) as "the_node" ("id")
union all
select "child_permissions".${parentId}, "child_permissions".${childId}, "child_permissions".${permission}
from (select distinct "the_assignment".${assignment.resourceId} as "id" from ${assignment.edge} as "the_assignment") as "the_assigned",
  lateral ${edgeCacheChildCompute} ("the_assigned"."id") as "child_permissions"
where "child_permissions".${childId} <> "child_permissions".${parentId};

${setPrivileges(edgeCacheView, writers, [], users)}
`;
  }
  return sql`
-----------------------------------------------------------------------------------------------------------------------
-- ${literal(kind)} view of all transitive edges, computed from scratch
-----------------------------------------------------------------------------------------------------------------------
-- This direction is easy, since we have less parents than children in general
create or replace view ${edgeCacheView} as
select
  "parent_permissions".${parentId} as ${parentId},
  "parent_permissions".${childId} as ${childId},
  "parent_permissions".${permission} as ${permission}
from
  (${boundIds(kind, naming, config)}) as "the_node" ("id"),
  lateral ${edgeCacheParentCompute} ("the_node"."id") as "parent_permissions";

${setPrivileges(edgeCacheView, writers, [], users)}
`;
}


// Databases created when p9s had node tables. Every node must be a bound row, then the node table and everything
// that referenced it go away. Without cascade, so objects the user built on top of them stop the migration.
export const createMigrationLegacyUpgrade = <User extends string>(kind: Kind, naming: Naming<User>, config: CompleteConfig<User>) => {
  const { node, id, edge, parentId, childId, home, parentFkey, childFkey, edgeCache, edgeCacheParentFkey, edgeCacheChildFkey,
    edgeInsertTrigger, edgeUpdateTrigger, edgeDeleteTrigger, nodeInsertTriggerFunction, nodeUpdateTriggerFunction, nodeDeleteTriggerFunction } = naming[kind];
  const { assignment } = naming;
  const bindings = getBindings(kind, naming, config);
  const notBound = (value: SQL) => bindings.length === 0
    ? sql`true`
    : join(bindings.map(binding => sql`not exists (select from ${binding.table} as "the_row" where "the_row".${binding.id} = ${value})`), ` and `);
  const tableFkeys = config.tables.filter(table => kind === "resource" ? table.isResource : table.isRole).map(table => {
    const tableNaming = naming.tables[table.name]!;
    return sql`alter table ${tableNaming.schema}.${tableNaming.name} drop constraint if exists ${kind === "resource" ? tableNaming.resourceFkey : tableNaming.roleFkey};`;
  });
  return sql`
-----------------------------------------------------------------------------------------------------------------------
-- Upgrade from node tables: ${literal(kind)}
-----------------------------------------------------------------------------------------------------------------------
do $$
declare
  "the_count" bigint;
begin
  -- A table: the views of all nodes have the same name
  if exists (select from pg_class where "oid" = to_regclass(${textLiteral(nameOf(node))}) and "relkind" = 'r') then
    select count(*) into "the_count" from ${node} as "the_node" where ${notBound(sql`"the_node".${id}`)};
    if "the_count" > 0 then
      raise exception 'p9s: % % nodes are not a row of a bound table. Bind a table that holds them (a table with only an id column is enough) or delete them, then run the migration again.', "the_count", ${textLiteral(kind)};
    end if;
    alter table ${edge} drop constraint if exists ${parentFkey};
    alter table ${edge} drop constraint if exists ${childFkey};
    alter table ${edgeCache} drop constraint if exists ${edgeCacheParentFkey};
    alter table ${edgeCache} drop constraint if exists ${edgeCacheChildFkey};
    alter table ${assignment.edge} drop constraint if exists ${kind === "resource" ? assignment.resourceFkey : assignment.roleFkey};
    alter table if exists ${assignment.edgeCache} drop constraint if exists ${kind === "resource" ? assignment.edgeCacheResourceFkey : assignment.edgeCacheRoleFkey};
    ${join(tableFkeys, `\n    `)}
    -- Recreated below. The bootstrap rebuilds the cache, there is no need to refresh it edge by edge here.
    drop trigger if exists ${edgeInsertTrigger} on ${edge};
    drop trigger if exists ${edgeUpdateTrigger} on ${edge};
    drop trigger if exists ${edgeDeleteTrigger} on ${edge};
    -- Edges that match a parent column become the home edges of their rows
    ${join(bindings.filter(hasParent).map(binding => sql`
    update ${edge} as "the_edge" set ${home} = true
    from ${binding.table} as "the_row"
    where "the_edge".${childId} = "the_row".${binding.id} and "the_edge".${parentId} = ${parentOf(binding, sql`"the_row"`)};`), `\n`)}
    drop table ${node};
    drop function if exists ${nodeInsertTriggerFunction}();
    drop function if exists ${nodeUpdateTriggerFunction}();
    drop function if exists ${nodeDeleteTriggerFunction}();
  end if;
end
$$;
`;
}


export const createMigrationResourceOrRole = <User extends string>(kind: Kind, naming: Naming<User>, config: CompleteConfig<User>) => {
  const { edge, parentId, childId, permission, home, edgePkey, edgeCache, edgeCachePkey, edgeCacheView, edgeCacheBackfill,
    edgeInsertTriggerFunction, edgeInsertTrigger, edgeUpdateTriggerFunction, edgeUpdateTrigger, edgeDeleteTriggerFunction, edgeDeleteTrigger,
    edgeGuardTriggerFunction, edgeGuardInsertTrigger, edgeGuardUpdateTrigger, edgeGuardDeleteTrigger,
    enableTriggerFunction, disableTriggerFunction
  } = naming[kind];
  const { assignment, truncateGuardTrigger } = naming;
  const size = config.engine.permission.bitmap.size;
  const maxDepth = config.engine.permission.maxDepth[kind];
  const { orBitmap } = naming;
  const { users, writers } = getRoles(config);
  const { type: idType } = getIdType(config);
  const bindings = getBindings(kind, naming, config);
  const assignmentId = kind === "resource" ? assignment.resourceId : assignment.roleId;
  const allBits = ones(config);
  const assignedOnly = kind === "resource" && config.engine.resourceCache === "assigned";
  // With an assigned-only cache, the rows ending at an unaffected node are those of its assigned ancestors, which are
  // the only ones the affected nodes need too. The assigned upstream nodes are looked up once: compared row by row,
  // Postgres would hash every assignment.
  const kept = (parent: SQL, child: SQL) => assignedOnly ? sql`
      and (${parent} = ${child} or ${isIn(parent, sql`select ${parentId} from "assigned"`)})` : sql``;

  // A cache row (ancestor, descendant) can only change when a changed edge parent -> child lies on one of its paths,
  // before or after the change. Its descendant is then the child or below it, an "affected" node. Its ancestor reaches
  // the parent of the first changed edge on that path through unchanged edges, so it is an "upstream" node: a changed
  // parent or one of their ancestors after the change. The rows ending at a node outside the affected set are the same
  // before and after the change, so the walk from an affected node towards its ancestors stops at the first node
  // outside the affected set and reuses that node's cache rows. Only rows whose value differs are written: unchanged
  // rows would still be locked by the upsert, and the combined assignment cache triggers recompute everything written.
  // A self row is recomputed as all ones, so it is left as it is.
  const refreshAffected = ({ parents, children }: { parents: SQL, children: SQL }) => sql`
  with recursive "affected" (${parentId}) as (
    (${children})
    union
    select "the_edge".${childId}
    from ${edge} as "the_edge"
    join "affected" on "the_edge".${parentId} = "affected".${parentId}
  ),
  "upstream" (${parentId}) as (
    (${parents})
    union
    select "the_edge".${parentId}
    from ${edge} as "the_edge"
    join "upstream" on "the_edge".${childId} = "upstream".${parentId}
  ),${assignedOnly ? sql`
  "assigned" (${parentId}) as (
    select "upstream".${parentId} from "upstream"
    where exists (select from ${assignment.edge} as "the_assignment" where "the_assignment".${assignment.resourceId} = "upstream".${parentId})
  ),` : sql``}
  "walk" (${parentId}, ${childId}, ${permission}, "inside", "depth", "path") as (
    select "affected".${parentId}, "affected".${parentId}, ${allBits}, true, 0, array["affected".${parentId}]
    from "affected"
    union all
    select
      "the_edge".${parentId},
      "walk".${childId},
      ("walk".${permission} & "the_edge".${permission})::bit(${literal(size)}), -- bitwise "and" on permission along a path
      "the_edge".${parentId} in (select ${parentId} from "affected"),
      "walk"."depth" + 1,
      "walk"."path" || "the_edge".${parentId}
    from "walk"
    join ${edge} as "the_edge" on "the_edge".${childId} = "walk".${parentId}
    where "walk"."inside"
    and "the_edge".${parentId} <> all ("walk"."path") -- prevent from cycling
    and "walk"."depth" <= ${literal(maxDepth)} -- max search depth
  ),
  "fresh" as (
    select "the_path".${parentId}, "the_path".${childId}, ${orBitmap} ("the_path".${permission}) as ${permission} -- bitwise "or" on permissions between various paths
    from (
      select "walk".${parentId}, "walk".${childId}, "walk".${permission}
      from "walk"
      where "walk"."inside"
      and ${isIn(sql`"walk".${parentId}`, sql`select ${parentId} from "upstream"`)}${kept(sql`"walk".${parentId}`, sql`"walk".${childId}`)}
      union all
      -- Filtered after the join: on the cache lookup, Postgres would count building the hash of "upstream" once per
      -- walked node, and prefer comparing every walked node with the whole cache.
      select "the_ancestor".${parentId}, "the_ancestor".${childId}, "the_ancestor".${permission}
      from (
        select "the_edge_cache".${parentId}, "walk".${childId}, ("the_edge_cache".${permission} & "walk".${permission})::bit(${literal(size)}) as ${permission}
        from "walk"
        join ${edgeCache} as "the_edge_cache" on "the_edge_cache".${childId} = "walk".${parentId}
        where not "walk"."inside"
        offset 0
      ) as "the_ancestor"
      where ${isIn(sql`"the_ancestor".${parentId}`, sql`select ${parentId} from "upstream"`)}${kept(sql`"the_ancestor".${parentId}`, sql`"the_ancestor".${childId}`)}
    ) as "the_path"
    group by ("the_path".${parentId}, "the_path".${childId})
  ),
  -- An array is computed once and drives a single index scan. As a join, the planner can prefer a whole table scan
  -- when it overestimates the rows of "fresh".
  "stale" as (
    delete from ${edgeCache}
    where ${edgeCache}.${childId} = any (array (select ${parentId} from "affected"))
    and ${isIn(sql`${edgeCache}.${parentId}`, sql`select ${parentId} from "upstream"`)}
    and (${edgeCache}.${parentId}, ${edgeCache}.${childId}) not in (select "fresh".${parentId}, "fresh".${childId} from "fresh")
  )
  insert into ${edgeCache} (${parentId}, ${childId}, ${permission})
  select "fresh".${parentId}, "fresh".${childId}, "fresh".${permission}
  from "fresh"
  where not exists (
    select 1 from ${edgeCache} as "the_edge_cache"
    where "the_edge_cache".${parentId} = "fresh".${parentId}
    and "the_edge_cache".${childId} = "fresh".${childId}
    and "the_edge_cache".${permission} = "fresh".${permission}
  )
  on conflict on constraint ${edgeCachePkey}
  do update set ${permission} = excluded.${permission};`;

  const changed = {
    insert: { parents: sql`select ${parentId} from "p9s_new_rows"`, children: sql`select ${childId} from "p9s_new_rows"` },
    update: {
      parents: sql`select ${parentId} from "p9s_old_rows" union select ${parentId} from "p9s_new_rows"`,
      children: sql`select ${childId} from "p9s_old_rows" union select ${childId} from "p9s_new_rows"`,
    },
    delete: { parents: sql`select ${parentId} from "p9s_old_rows"`, children: sql`select ${childId} from "p9s_old_rows"` },
  };

  // Self rows are the registry of the ids of bound rows. Joins on the cache key stay index lookups, an `exists` could
  // be planned as a hashed subplan over the whole cache.
  const selfRow = (alias: string, value: SQL) =>
    sql`left join ${edgeCache} as ${identifier(alias)} on ${identifier(alias)}.${parentId} = ${value} and ${identifier(alias)}.${childId} = ${value}`;
  const invalidEdges = sql`from "p9s_new_rows" as "the_edge"
    ${selfRow("the_parent_self", sql`"the_edge".${parentId}`)}
    ${selfRow("the_child_self", sql`"the_edge".${childId}`)}
    where "the_parent_self".${parentId} is null or "the_child_self".${parentId} is null`;
  const softDeletes = usesSoftDelete(kind, naming, config);
  const deletedEdges = sql`from "p9s_new_rows" as "the_edge"
    where ${isDeletedNode(kind, naming, config, sql`"the_edge".${parentId}`)} or ${isDeletedNode(kind, naming, config, sql`"the_edge".${childId}`)}`;
  const validateEdges = sql`
  if exists (select ${invalidEdges}) then
    raise exception 'p9s: the % edge % does not connect two rows of bound tables', ${textLiteral(kind)},
      (select format('%s -> %s', "the_edge".${parentId}, "the_edge".${childId}) ${invalidEdges} limit 1)
      using errcode = 'foreign_key_violation';
  end if;${softDeletes ? sql`
  if exists (select ${deletedEdges}) then
    raise exception 'p9s: the % edge % links a soft deleted row, which has to be restored first', ${textLiteral(kind)},
      (select format('%s -> %s', "the_edge".${parentId}, "the_edge".${childId}) ${deletedEdges} limit 1)
      using errcode = 'foreign_key_violation';
  end if;` : sql``}`;

  // The caches only follow paths of up to maxDepth edges. A path longer than that only exists if it goes through a new
  // edge: an edge with a path of length "above" its parent and one "below" its child, that share no node, makes a
  // path of above + 1 + below edges. Walks stop at maxDepth, which is enough to tell that a path is longer.
  const tooDeep = sql`from (
    with recursive "the_new" as (select distinct ${parentId}, ${childId} from "p9s_new_rows"),
    "above" ("start", "node", "depth", "path") as (
      select "the_start"."id", "the_start"."id", 0, array["the_start"."id"] from (select distinct ${parentId} as "id" from "the_new") as "the_start"
      union all
      select "above"."start", "the_edge".${parentId}, "above"."depth" + 1, "above"."path" || "the_edge".${parentId}
      from "above" join ${edge} as "the_edge" on "the_edge".${childId} = "above"."node"
      where "the_edge".${parentId} <> all ("above"."path") and "above"."depth" < ${literal(maxDepth)}
    ),
    "below" ("start", "node", "depth", "path") as (
      select "the_start"."id", "the_start"."id", 0, array["the_start"."id"] from (select distinct ${childId} as "id" from "the_new") as "the_start"
      union all
      select "below"."start", "the_edge".${childId}, "below"."depth" + 1, "below"."path" || "the_edge".${childId}
      from "below" join ${edge} as "the_edge" on "the_edge".${parentId} = "below"."node"
      where "the_edge".${childId} <> all ("below"."path") and "below"."depth" < ${literal(maxDepth)}
    )
    select "the_new".${parentId}, "the_new".${childId}
    from "the_new"
    join "above" on "above"."start" = "the_new".${parentId}
    join "below" on "below"."start" = "the_new".${childId}
    where "above"."depth" + 1 + "below"."depth" > ${literal(maxDepth)}
    and not ("above"."path" && "below"."path")
  ) as "the_edge"`;
  // Without a cycle through a new edge, the nodes above it and below it are distinct, so the longest path below each
  // child leaves a budget for the paths above its parent, and one walk up per parent tells. Only when a path above
  // goes over that budget, which a cycle can cause without a long path, are the paths compared pairwise.
  const mayBeTooDeep = sql`
    with recursive "the_new" as (select distinct ${parentId}, ${childId} from "p9s_new_rows"),
    "below" ("parent", "node", "depth", "path") as (
      select "the_new".${parentId}, "the_new".${childId}, 0, array["the_new".${childId}] from "the_new"
      union all
      select "below"."parent", "the_edge".${childId}, "below"."depth" + 1, "below"."path" || "the_edge".${childId}
      from "below" join ${edge} as "the_edge" on "the_edge".${parentId} = "below"."node"
      where "the_edge".${childId} <> all ("below"."path") and "below"."depth" < ${literal(maxDepth)}
    ),
    "above" ("node", "depth", "path", "budget") as (
      select "below"."parent", 0, array["below"."parent"], ${literal(maxDepth - 1)} - max("below"."depth") from "below" group by "below"."parent"
      union all
      select "the_edge".${parentId}, "above"."depth" + 1, "above"."path" || "the_edge".${parentId}, "above"."budget"
      from "above" join ${edge} as "the_edge" on "the_edge".${childId} = "above"."node"
      where "the_edge".${parentId} <> all ("above"."path") and "above"."depth" <= "above"."budget"
    )
    select from "above" where "above"."depth" > "above"."budget"`;
  const checkDepth = sql`
  if exists (${mayBeTooDeep}) and exists (select ${tooDeep}) then
    raise exception 'p9s: the % edge % makes a path of more than % edges, the maxDepth of the % tree', ${textLiteral(kind)},
      (select format('%s -> %s', "the_edge".${parentId}, "the_edge".${childId}) ${tooDeep} limit 1), ${literal(maxDepth)}, ${textLiteral(kind)}
      using errcode = 'program_limit_exceeded';
  end if;`;

  // New edges to nodes without children, like a new row under its parent, only add paths that end at their child, each
  // through one new edge: the rows of the parent with the bits of the edge. Ored into the rows the child already has,
  // they are what the refresh would compute, without planning it in every new session.
  const refreshLeaves = sql`
  insert into ${edgeCache} as "the_cache" (${parentId}, ${childId}, ${permission})
  select "the_ancestor".${parentId}, "the_new".${childId}, ${orBitmap} (("the_ancestor".${permission} & "the_new".${permission})::bit(${literal(size)}))
  from "p9s_new_rows" as "the_new"
  join ${edgeCache} as "the_ancestor" on "the_ancestor".${childId} = "the_new".${parentId}${assignedOnly ? sql`
  where exists (select from ${assignment.edge} as "the_assignment" where "the_assignment".${assignment.resourceId} = "the_ancestor".${parentId})` : sql``}
  group by "the_ancestor".${parentId}, "the_new".${childId}
  on conflict on constraint ${edgeCachePkey}
  do update set ${permission} = coalesce("the_cache".${permission}, b'0'::bit(${literal(size)})) | excluded.${permission}
  where coalesce("the_cache".${permission}, b'0'::bit(${literal(size)})) | excluded.${permission} is distinct from "the_cache".${permission};`;
  const refresh = (event: TriggerEvent) => event !== "insert" ? refreshAffected(changed[event]) : sql`
  if not exists (select from "p9s_new_rows" as "the_new" join ${edge} as "the_edge" on "the_edge".${parentId} = "the_new".${childId}) then${refreshLeaves}
  else
${refreshAffected(changed[event])}
  end if;`;

  const edgeTrigger = (functionName: SQL, triggerName: SQL, event: TriggerEvent) =>
    statementTrigger(naming, config, functionName, triggerName, edge, event,
      sql`${event === "delete" ? sql`` : sql`${validateEdges}${checkDepth}`}
${refresh(event)}`, indexLookupsOnly);

  // What bound rows do to the graph, shared by the tables of this tree. Each takes the ids of the rows a statement
  // changed, and for inserts and parent changes, the parent id of each row (null for none). Only the bound-table
  // triggers call them, so they run as the owner with its search path. With array arguments, plpgsql would plan each
  // statement again on every call; every lookup is by key, so the generic plan is as good.
  const nodeFunction = (functionName: SQL, args: SQL, body: SQL) => sql`
create or replace function ${functionName} (${args})
returns void as $$
begin
${body}
end;
$$ language plpgsql set plan_cache_mode = force_generic_plan;

${grantExecute(sql`${functionName} (${args})`, [])}
`;
  const idsArgument = sql`"the_ids" ${idType}[]`;
  const idsAndParentsArguments = sql`"the_ids" ${idType}[], "the_parents" ${idType}[]`;
  const rows = sql`unnest("the_ids", coalesce("the_parents", '{}')) as "the_row" ("id", "parent")`;
  // Rows of role leaf tables keep a role id without being nodes
  const usedIds = join([
    sql`select "the_row"."id" from unnest("the_ids") as "the_row" ("id")
    join ${edgeCache} as "the_self" on "the_self".${parentId} = "the_row"."id" and "the_self".${childId} = "the_row"."id"`,
    ...(kind === "role" ? getLeaves(kind, naming, config) : []).map(leaf => sql`select "the_row"."id" from unnest("the_ids") as "the_row" ("id")
    join ${leaf.table} as "the_leaf" on "the_leaf".${leaf.id} = "the_row"."id"`),
  ], `\n    union all\n    `);

  const { edgeDeleted, edgeDeletedPkey } = naming[kind];
  const isDeleted = (value: SQL) => isDeletedNode(kind, naming, config, value);
  const deletedRow = sql`(${isDeleted(sql`"the_row"."parent"`)} or ${isDeleted(sql`"the_row"."id"`)})`;
  // The home edge of a soft deleted row, or of a row under one, waits with the other edges of that row
  const insertHomeEdges = softDeletes ? sql`
    insert into ${edge} (${parentId}, ${childId}, ${permission}, ${home})
    select "the_row"."parent", "the_row"."id", ${allBits}, true
    from ${rows}
    where "the_row"."parent" is not null and not ${deletedRow}
    on conflict on constraint ${edgePkey} do nothing;
    insert into ${edgeDeleted} (${parentId}, ${childId}, ${permission}, ${home})
    select "the_row"."parent", "the_row"."id", ${allBits}, true
    from ${rows}
    where "the_row"."parent" is not null and ${deletedRow}
    on conflict on constraint ${edgeDeletedPkey} do nothing;` : sql`
    insert into ${edge} (${parentId}, ${childId}, ${permission}, ${home})
    select "the_row"."parent", "the_row"."id", ${allBits}, true
    from ${rows}
    where "the_row"."parent" is not null
    on conflict on constraint ${edgePkey} do nothing;`;
  const assignmentsDeleted = usesAnySoftDelete(naming, config);
  // The triggers of the assignment table go with the resource tree, see triggersByTable
  const reconcilesAssignments = assignmentsDeleted && kind === "resource";
  const otherKind: Kind = kind === "resource" ? "role" : "resource";
  const otherAssignmentId = kind === "resource" ? assignment.roleId : assignment.resourceId;
  const edgeColumns = sql`${parentId}, ${childId}, ${permission}, ${home}`;
  const assignmentColumns = sql`${assignment.resourceId}, ${assignment.roleId}, ${assignment.permission}`;
  // A soft deleted row leaves the graph with its edges and assignments, which the triggers of the graph tables take
  // out of the caches. They come back when both their ends are restored.
  const softDeleteFunctions = softDeletes ? sql`
${nodeFunction(naming[kind].nodeSoftDeleteFunction, idsArgument, sql`
  ${lockGraph(config)}
  with "the_moved" as (
    delete from ${edge} as "the_edge"
    where "the_edge".${parentId} = any ("the_ids") or "the_edge".${childId} = any ("the_ids")
    returning ${edgeColumns}
  )
  insert into ${edgeDeleted} (${edgeColumns}) select ${edgeColumns} from "the_moved"
  on conflict on constraint ${edgeDeletedPkey} do nothing;
  with "the_moved" as (
    delete from ${assignment.edge} as "the_assignment"
    where "the_assignment".${assignmentId} = any ("the_ids")
    returning ${assignmentColumns}
  )
  insert into ${assignment.edgeDeleted} (${assignmentColumns}) select ${assignmentColumns} from "the_moved"
  on conflict on constraint ${assignment.edgeDeletedPkey} do nothing;`)}
${nodeFunction(naming[kind].nodeRestoreFunction, idsArgument, sql`
  ${lockGraph(config)}
  with "the_moved" as (
    delete from ${edgeDeleted} as "the_edge"
    where ("the_edge".${parentId} = any ("the_ids") or "the_edge".${childId} = any ("the_ids"))
    and not ${isDeleted(sql`"the_edge".${parentId}`)} and not ${isDeleted(sql`"the_edge".${childId}`)}
    returning ${edgeColumns}
  )
  insert into ${edge} (${edgeColumns}) select ${edgeColumns} from "the_moved"
  on conflict on constraint ${edgePkey} do nothing;
  with "the_moved" as (
    delete from ${assignment.edgeDeleted} as "the_assignment"
    where "the_assignment".${assignmentId} = any ("the_ids")
    and not ${isDeletedNode(otherKind, naming, config, sql`"the_assignment".${otherAssignmentId}`)}
    returning ${assignmentColumns}
  )
  insert into ${assignment.edge} (${assignmentColumns}) select ${assignmentColumns} from "the_moved"
  on conflict on constraint ${assignment.edgePkey} do nothing;`)}` : sql``;

  const nodeFunctions = sql`
${nodeFunction(naming[kind].nodeInsertFunction, idsAndParentsArguments, sql`
  if exists (${usedIds}) then
    raise exception 'p9s: the % id % is already used by another row', ${textLiteral(kind)},
      (select "the_used"."id" from (${usedIds}) as "the_used" limit 1)
      using errcode = 'unique_violation';
  end if;
  -- A new row cannot be referenced by others yet, so its self row needs no lock
  insert into ${edgeCache} (${parentId}, ${childId}, ${permission})
  select "the_row"."id", "the_row"."id", ${allBits} from unnest("the_ids") as "the_row" ("id");
  if exists (select from unnest("the_parents") as "the_parent" ("id") where "the_parent"."id" is not null) then
    ${lockGraph(config)}${insertHomeEdges}
  end if;`)}
-- The home edge follows the parent column. It moves when nothing else links the new parent to the row, otherwise it
-- gives way to that edge and the edge keeps its bits.
${nodeFunction(naming[kind].nodeUpdateFunction, idsAndParentsArguments, sql`
  ${lockGraph(config)}${softDeletes ? sql`
  delete from ${edgeDeleted} as "the_edge"
  using ${rows}
  where "the_edge".${childId} = "the_row"."id" and "the_edge".${home}
  and "the_edge".${parentId} is distinct from "the_row"."parent";
` : sql``}
  update ${edge} as "the_edge" set ${parentId} = "the_row"."parent"
  from ${rows}
  where "the_edge".${childId} = "the_row"."id" and "the_edge".${home}
  and "the_row"."parent" is not null and "the_edge".${parentId} <> "the_row"."parent"${softDeletes ? sql` and not ${deletedRow}` : sql``}
  and not exists (select from ${edge} as "the_other" where "the_other".${parentId} = "the_row"."parent" and "the_other".${childId} = "the_row"."id");

  delete from ${edge} as "the_edge"
  using ${rows}
  where "the_edge".${childId} = "the_row"."id" and "the_edge".${home}
  and "the_edge".${parentId} is distinct from "the_row"."parent";
${insertHomeEdges}`)}
-- The lock comes first: an edge to these rows committed while they are deleted must be seen by the deletes below
${nodeFunction(naming[kind].nodeDeleteFunction, idsArgument, sql`
  ${lockGraph(config)}
  delete from ${assignment.edge} as "the_assignment"
  where "the_assignment".${assignmentId} = any ("the_ids");
  delete from ${edge} as "the_edge"
  where "the_edge".${parentId} = any ("the_ids") or "the_edge".${childId} = any ("the_ids");${assignmentsDeleted ? sql`
  delete from ${assignment.edgeDeleted} as "the_assignment"
  where "the_assignment".${assignmentId} = any ("the_ids");` : sql``}${softDeletes ? sql`
  delete from ${edgeDeleted} as "the_edge"
  where "the_edge".${parentId} = any ("the_ids") or "the_edge".${childId} = any ("the_ids");` : sql``}
  delete from ${edgeCache} as "the_self"
  using unnest("the_ids") as "the_row" ("id")
  where "the_self".${parentId} = "the_row"."id" and "the_self".${childId} = "the_row"."id";`)}
${softDeleteFunctions}`;

  // The bound row is the node: its triggers hand the ids and parents of the changed rows to the node functions. One
  // function serves the three triggers, plpgsql plans its statements separately for each. `having` skips statements
  // that changed no row.
  const boundTriggers = (binding: Binding) => {
    const { table, id, triggerFunction: functionName, triggers, parents } = binding;
    const parentIds = hasParent(binding) ? sql`array_agg(${parentOf(binding, sql`"the_row"`)})` : sql`null`;
    const moved = hasParent(binding) && sql`from "p9s_new_rows" as "the_row" join "p9s_old_rows" as "the_old_row" using (${id})
      where ${join(parents.map(({ column }) => sql`"the_row".${column} is distinct from "the_old_row".${column}`), " or ")}`;
    return sql`
-- ${literal(binding.tableName)} rows are ${literal(kind)} nodes
create or replace function ${functionName}()
returns trigger as $$
begin
  if tg_op = 'INSERT' then${checkParentsFound(binding, sql`"p9s_new_rows"`)}
    perform ${naming[kind].nodeInsertFunction}(array_agg("the_row".${id}), ${parentIds}) from "p9s_new_rows" as "the_row" having count(*) > 0;
  elsif tg_op = 'UPDATE' then
    if exists (select ${id} from "p9s_old_rows" except select ${id} from "p9s_new_rows") then
      raise exception 'p9s: the % id of a % row cannot change', ${textLiteral(kind)}, ${textLiteral(binding.tableName)} using errcode = 'integrity_constraint_violation';
    end if;${moved ? sql`
    -- Transition tables have no index: an exists would be planned to stop early, comparing every new row with every
    -- old row when no parent changed. Counting them is planned as a join of both
    if (select count(*) ${moved}) > 0 then${checkParentsFound(binding, sql`"p9s_new_rows"`)}
      perform ${naming[kind].nodeUpdateFunction}(array_agg("the_row".${id}), ${parentIds})
      ${moved};
    end if;` : sql``}${binding.softDelete ? sql`
    perform ${naming[kind].nodeSoftDeleteFunction}(array_agg("the_row".${id}))
    from "p9s_new_rows" as "the_row" join "p9s_old_rows" as "the_old_row" using (${id})
    where "the_row".${binding.softDelete} is not null and "the_old_row".${binding.softDelete} is null
    having count(*) > 0;
    perform ${naming[kind].nodeRestoreFunction}(array_agg("the_row".${id}))
    from "p9s_new_rows" as "the_row" join "p9s_old_rows" as "the_old_row" using (${id})
    where "the_row".${binding.softDelete} is null and "the_old_row".${binding.softDelete} is not null
    having count(*) > 0;` : sql``}
  else
    perform ${naming[kind].nodeDeleteFunction}(array_agg("the_row".${id})) from "p9s_old_rows" as "the_row" having count(*) > 0;
  end if;
  return null;
end;
$$ language plpgsql ${definer(naming)};
${grantExecute(sql`${functionName} ()`, [])}
${join((["insert", "update", "delete"] as const).map(event => attachStatementTrigger(functionName, triggers[event], table, event)), ``)}
drop trigger if exists ${truncateGuardTrigger} on ${table};
create trigger ${truncateGuardTrigger} before truncate on ${table} for each statement execute function ${naming.truncateGuardFunction}();
`;
  };

  // Enable and disable cover every p9s trigger of this tree. Assignments are validated against both trees, their
  // triggers go with the resource tree.
  const triggersByTable: Array<[SQL, SQL[]]> = [
    [edge, [edgeInsertTrigger, edgeUpdateTrigger, edgeDeleteTrigger, edgeGuardInsertTrigger, edgeGuardUpdateTrigger, edgeGuardDeleteTrigger, truncateGuardTrigger]],
    ...bindings.map(({ table, triggers }): [SQL, SQL[]] => [table, [triggers.insert, triggers.update, triggers.delete, truncateGuardTrigger]]),
    ...(kind === "resource" ? [[assignment.edge, [assignment.edgeValidateInsertTrigger, assignment.edgeValidateUpdateTrigger, truncateGuardTrigger,
      ...(assignedOnly ? [assignment.resourceCacheInsertTrigger, assignment.resourceCacheUpdateTrigger, assignment.resourceCacheDeleteTrigger] : [])]] as [SQL, SQL[]]] : []),
  ];
  const toggleTriggers = (action: SQL) => join(triggersByTable.flatMap(([table, triggers]) =>
    triggers.map(trigger => sql`alter table ${table} ${action} trigger ${trigger};`)), `\n  `);

  // With an assigned-only cache, a resource gets the rows of its descendants with its first assignment, and loses them
  // with its last one. An assigned resource has a row for each of its descendants, so one row other than its self row
  // tells that it has them. These triggers run before those of the combined assignment cache, which reads these rows.
  const unassignedResources = sql`select distinct "the_old".${assignment.resourceId} as "id" from "p9s_old_rows" as "the_old"
    where not exists (select from ${assignment.edge} as "the_assignment" where "the_assignment".${assignment.resourceId} = "the_old".${assignment.resourceId})`;
  const newlyAssignedResources = sql`select distinct "the_new".${assignment.resourceId} as "id" from "p9s_new_rows" as "the_new"
    where not exists (select from ${edgeCache} as "the_edge_cache"
      where "the_edge_cache".${parentId} = "the_new".${assignment.resourceId} and "the_edge_cache".${childId} <> "the_new".${assignment.resourceId})`;
  const dropDescendants = sql`
  delete from ${edgeCache} as "the_edge_cache"
  using (${unassignedResources}) as "the_resource"
  where "the_edge_cache".${parentId} = "the_resource"."id" and "the_edge_cache".${childId} <> "the_resource"."id";`;
  const addDescendants = sql`
  insert into ${edgeCache} (${parentId}, ${childId}, ${permission})
  select "the_descendant".${parentId}, "the_descendant".${childId}, "the_descendant".${permission}
  from (${newlyAssignedResources}) as "the_resource",
    lateral ${naming[kind].edgeCacheChildCompute} ("the_resource"."id") as "the_descendant"
  where "the_descendant".${childId} <> "the_descendant".${parentId}
  on conflict on constraint ${edgeCachePkey} do nothing;`;
  const assignmentTrigger = (functionName: SQL, triggerName: SQL, event: TriggerEvent, body: SQL) =>
    statementTrigger(naming, config, functionName, triggerName, assignment.edge, event, body, indexLookupsOnly);
  const assignedCacheTriggers = sql`
drop trigger if exists ${assignment.resourceCacheInsertTrigger} on ${assignment.edge};
drop trigger if exists ${assignment.resourceCacheUpdateTrigger} on ${assignment.edge};
drop trigger if exists ${assignment.resourceCacheDeleteTrigger} on ${assignment.edge};${assignedOnly ? sql`
${assignmentTrigger(assignment.resourceCacheInsertTriggerFunction, assignment.resourceCacheInsertTrigger, "insert", addDescendants)}
${assignmentTrigger(assignment.resourceCacheUpdateTriggerFunction, assignment.resourceCacheUpdateTrigger, "update", sql`${dropDescendants}${addDescendants}`)}
${assignmentTrigger(assignment.resourceCacheDeleteTriggerFunction, assignment.resourceCacheDeleteTrigger, "delete", dropDescendants)}` : sql`
drop function if exists ${assignment.resourceCacheInsertTriggerFunction} ();
drop function if exists ${assignment.resourceCacheUpdateTriggerFunction} ();
drop function if exists ${assignment.resourceCacheDeleteTriggerFunction} ();`}`;

  // Rows written while the triggers were disabled get their home edges, and home edges follow their parent column
  const homeEdgeFixups = join(bindings.map(binding => hasParent(binding) ? sql`
  ${checkParentsFound(binding, binding.table)}
  delete from ${edge} as "the_edge"
  using ${binding.table} as "the_row"
  where "the_edge".${childId} = "the_row".${binding.id} and "the_edge".${home}
  and "the_edge".${parentId} is distinct from ${parentOf(binding, sql`"the_row"`)};
  insert into ${edge} (${parentId}, ${childId}, ${permission}, ${home})
  select ${parentOf(binding, sql`"the_row"`)}, "the_row".${binding.id}, ${allBits}, true
  from ${binding.table} as "the_row"
  where ${setsParent(binding, sql`"the_row"`)}
  on conflict on constraint ${edgePkey} do nothing;` : sql`
  -- No parent column: the home edges of these rows become regular edges
  update ${edge} as "the_edge" set ${home} = false
  from ${binding.table} as "the_row"
  where "the_edge".${childId} = "the_row".${binding.id} and "the_edge".${home};`), `\n`);

  const ids = boundIds(kind, naming, config);
  const everyId = allIds(kind, naming, config);
  const notBound = (id: SQL) => sql`not exists (select from (${ids}) as "the_id" ("id") where "the_id"."id" = ${id})`;
  // Rows loaded while the triggers were disabled skipped the depth check of the edge triggers
  const longPath = sql`from (
    with recursive "walk" ("node", "depth", "path") as (
      select distinct "the_edge".${childId}, 0, array["the_edge".${childId}] from ${edge} as "the_edge"
      union all
      select "the_edge".${parentId}, "walk"."depth" + 1, "the_edge".${parentId} || "walk"."path"
      from "walk" join ${edge} as "the_edge" on "the_edge".${childId} = "walk"."node"
      where "the_edge".${parentId} <> all ("walk"."path") and "walk"."depth" <= ${literal(maxDepth)}
    )
    select "walk"."path" from "walk" where "walk"."depth" > ${literal(maxDepth)}
  ) as "the_path"`;

  return sql`
-----------------------------------------------------------------------------------------------------------------------
-- ${literal(kind)} function to rebuild the cache from scratch
-----------------------------------------------------------------------------------------------------------------------
create or replace function ${edgeCacheBackfill} ()
  returns setof ${edgeCache}
  as $$
begin
  ${lockGraphStatement(config)}
  if exists (select from (${everyId}) as "the_id" ("id") group by "the_id"."id" having count(*) > 1) then
    raise exception 'p9s: the % id % is used by more than one bound row', ${textLiteral(kind)},
      (select "the_id"."id" from (${everyId}) as "the_id" ("id") group by "the_id"."id" having count(*) > 1 limit 1)
      using errcode = 'unique_violation';
  end if;
  -- Anti joins rather than not in: Postgres only hashes a not in that it expects to fit in work_mem, and otherwise
  -- scans the ids again for every edge
  if exists (select from ${edge} as "the_edge" where ${notBound(sql`"the_edge".${parentId}`)})
    or exists (select from ${edge} as "the_edge" where ${notBound(sql`"the_edge".${childId}`)}) then
    raise exception 'p9s: % edges connect ids that are not rows of bound tables', ${textLiteral(kind)} using errcode = 'foreign_key_violation';
  end if;
  if exists (select from ${assignment.edge} as "the_assignment" where ${notBound(sql`"the_assignment".${assignmentId}`)}) then
    raise exception 'p9s: assignments reference % ids that are not rows of bound tables', ${textLiteral(kind)} using errcode = 'foreign_key_violation';
  end if;
  -- Backfills usually follow a bulk load, before autovacuum has gathered statistics. Without them the planner can
  -- seq scan the edge table at every step of the recursive walk, which is quadratic in the number of edges.
  -- This has to be plpgsql: a sql function plans every statement before running the first one.
  analyze ${edge};
  if exists (select ${longPath}) then
    raise exception 'p9s: the % path % has more than % edges, the maxDepth of the % tree', ${textLiteral(kind)},
      (select array_to_string("the_path"."path", ' -> ') ${longPath} limit 1), ${literal(maxDepth)}, ${textLiteral(kind)}
      using errcode = 'program_limit_exceeded';
  end if;
  delete from ${edgeCache};
  return query
  insert into ${edgeCache} (${parentId}, ${childId}, ${permission})
  select ${parentId}, ${childId}, ${permission}
  from
    ${edgeCacheView}
    returning
      *;
end;
$$
language plpgsql
volatile
${definer(naming)};

${grantExecute(sql`${edgeCacheBackfill} ()`, writers)}

-----------------------------------------------------------------------------------------------------------------------
-- ${literal(kind)} Update cache when edges change
-----------------------------------------------------------------------------------------------------------------------
${edgeTrigger(edgeInsertTriggerFunction, edgeInsertTrigger, "insert")}
${edgeTrigger(edgeUpdateTriggerFunction, edgeUpdateTrigger, "update")}
${edgeTrigger(edgeDeleteTriggerFunction, edgeDeleteTrigger, "delete")}
${kind === "resource" ? assignedCacheTriggers : sql``}
drop trigger if exists ${truncateGuardTrigger} on ${edge};
create trigger ${truncateGuardTrigger} before truncate on ${edge} for each statement execute function ${naming.truncateGuardFunction}();

-----------------------------------------------------------------------------------------------------------------------
-- ${literal(kind)} home edges are written by p9s only
-----------------------------------------------------------------------------------------------------------------------
-- p9s writes them from the triggers of bound tables, one level deeper than a statement sent by a client
create or replace function ${edgeGuardTriggerFunction}()
returns trigger as $$
begin
  if pg_trigger_depth() > 1 then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'INSERT' then
    raise exception 'p9s: home edges are created by p9s from the parent column of their row'
      using errcode = 'insufficient_privilege';
  elsif tg_op = 'UPDATE' then
    if new.${home} and not old.${home} then
      raise exception 'p9s: an edge cannot be made a home edge, home edges follow the parent column of their row'
        using errcode = 'insufficient_privilege';
    end if;
    -- Changing a home edge makes it a regular edge, which moving or deleting its row leaves alone
    new.${home} := false;
    return new;
  end if;
  raise exception 'p9s: home edges are removed by moving or deleting their row. To delete one apart from its row, first make it a regular edge with update ... set home = false'
    using errcode = 'insufficient_privilege';
end;
$$ language plpgsql;

${grantExecute(sql`${edgeGuardTriggerFunction} ()`, [])}

drop trigger if exists ${edgeGuardInsertTrigger} on ${edge};
create trigger ${edgeGuardInsertTrigger} before insert on ${edge} for each row when (new.${home}) execute function ${edgeGuardTriggerFunction}();
drop trigger if exists ${edgeGuardUpdateTrigger} on ${edge};
create trigger ${edgeGuardUpdateTrigger} before update on ${edge} for each row when (old.${home} or new.${home}) execute function ${edgeGuardTriggerFunction}();
drop trigger if exists ${edgeGuardDeleteTrigger} on ${edge};
create trigger ${edgeGuardDeleteTrigger} before delete on ${edge} for each row when (old.${home}) execute function ${edgeGuardTriggerFunction}();

-----------------------------------------------------------------------------------------------------------------------
-- ${literal(kind)} rows of bound tables
-----------------------------------------------------------------------------------------------------------------------
${nodeFunctions}
${join(bindings.map(boundTriggers), `\n`)}

-----------------------------------------------------------------------------------------------------------------------
-- ${literal(kind)} functions to enable / disable triggers
-----------------------------------------------------------------------------------------------------------------------
create or replace function ${disableTriggerFunction}()
returns void as $$
begin
  ${toggleTriggers(sql`disable`)}
end;
$$ language plpgsql ${definer(naming)};

${grantExecute(sql`${disableTriggerFunction} ()`, writers)}

-- Also brings the graph up to date with rows written while the triggers were disabled
create or replace function ${enableTriggerFunction}()
returns void as $$
begin
  ${lockGraphStatement(config)}
  ${toggleTriggers(sql`disable`)}${softDeletes ? sql`
  insert into ${edge} (${edgeColumns}) select ${edgeColumns} from ${edgeDeleted}
  on conflict on constraint ${edgePkey} do nothing;
  delete from ${edgeDeleted};` : sql``}${reconcilesAssignments ? sql`
  insert into ${assignment.edge} (${assignmentColumns}) select ${assignmentColumns} from ${assignment.edgeDeleted}
  on conflict on constraint ${assignment.edgePkey} do nothing;
  delete from ${assignment.edgeDeleted};` : sql``}
  ${homeEdgeFixups}${softDeletes ? sql`
  -- Soft deleted rows, including those written while the triggers were disabled, leave the graph again
  with "the_moved" as (
    delete from ${edge} as "the_edge"
    where ${isIn(sql`"the_edge".${parentId}`, deletedIds(kind, naming, config))} or ${isIn(sql`"the_edge".${childId}`, deletedIds(kind, naming, config))}
    returning ${edgeColumns}
  )
  insert into ${edgeDeleted} (${edgeColumns}) select ${edgeColumns} from "the_moved"
  on conflict on constraint ${edgeDeletedPkey} do nothing;` : sql``}${reconcilesAssignments ? sql`
  with "the_moved" as (
    delete from ${assignment.edge} as "the_assignment"
    where ${join([
      ...(usesSoftDelete("resource", naming, config) ? [isIn(sql`"the_assignment".${assignment.resourceId}`, deletedIds("resource", naming, config))] : []),
      ...(usesSoftDelete("role", naming, config) ? [isIn(sql`"the_assignment".${assignment.roleId}`, deletedIds("role", naming, config))] : []),
    ], " or ")}
    returning ${assignmentColumns}
  )
  insert into ${assignment.edgeDeleted} (${assignmentColumns}) select ${assignmentColumns} from "the_moved"
  on conflict on constraint ${assignment.edgeDeletedPkey} do nothing;` : sql``}
  ${toggleTriggers(sql`enable`)}
  perform ${edgeCacheBackfill}();
end;
$$ language plpgsql ${definer(naming)};

${grantExecute(sql`${enableTriggerFunction} ()`, writers)}
`;
}


export const createMigrationAssignments = <User extends string>(naming: Naming<User>, config: CompleteConfig<User>) => {
  const { resource, role, permission, orBitmap, truncateGuardTrigger } = naming;
  const size = config.engine.permission.bitmap.size;
  const {
    edge, resourceId, roleId,
    edgeCacheView, edgeCacheBackfill, edgeCache, edgeCachePkey,
    edgeCacheResourceIdIndex,
    edgeCacheRoleIdIndex, enableTriggerFunction, disableTriggerFunction,
    edgeInsertTriggerFunction,
    edgeInsertTrigger,
    edgeUpdateTriggerFunction,
    edgeUpdateTrigger,
    edgeDeleteTriggerFunction,
    edgeDeleteTrigger,
    edgeValidateTriggerFunction,
    edgeValidateInsertTrigger,
    edgeValidateUpdateTrigger,
    combinedEdgeInsertTriggerFunction,
    combinedEdgeInsertTrigger,
    combinedEdgeUpdateTriggerFunction,
    combinedEdgeUpdateTrigger,
    combinedEdgeDeleteTriggerFunction,
    combinedEdgeDeleteTrigger
  } = naming.assignment;
  const { type: idType } = getIdType(config);
  const { users, writers, everyone } = getRoles(config);
  const combineAssignmentsWith = config.engine.combineAssignmentsWith;

  // Triggers from every mode are dropped first, so switching combineAssignmentsWith leaves no stale ones behind
  const namingForMode = (mode: "role" | "resource") =>
    getNaming({ ...config, engine: { ...config.engine, combineAssignmentsWith: mode } }).assignment;
  const dropAllTriggers = sql`
drop trigger if exists ${edgeInsertTrigger} on ${edge};
drop trigger if exists ${edgeUpdateTrigger} on ${edge};
drop trigger if exists ${edgeDeleteTrigger} on ${edge};
${join((["role", "resource"] as const).map(mode => {
    const modeNaming = namingForMode(mode);
    const cache = naming[mode].edgeCache;
    return sql`
drop trigger if exists ${modeNaming.combinedEdgeInsertTrigger} on ${cache};
drop trigger if exists ${modeNaming.combinedEdgeUpdateTrigger} on ${cache};
drop trigger if exists ${modeNaming.combinedEdgeDeleteTrigger} on ${cache};`;
  }), `\n`)}
`;

  const selfRow = (kind: Kind, alias: string, value: SQL) => {
    const { edgeCache: cache, parentId, childId } = naming[kind];
    return sql`left join ${cache} as ${identifier(alias)} on ${identifier(alias)}.${parentId} = ${value} and ${identifier(alias)}.${childId} = ${value}`;
  };
  const invalidAssignments = sql`from "p9s_new_rows" as "the_assignment"
    ${selfRow("resource", "the_resource_self", sql`"the_assignment".${resourceId}`)}
    ${selfRow("role", "the_role_self", sql`"the_assignment".${roleId}`)}
    where "the_resource_self".${resource.parentId} is null or "the_role_self".${role.parentId} is null`;
  const deletedAssignments = sql`from "p9s_new_rows" as "the_assignment"
    where ${isDeletedNode("resource", naming, config, sql`"the_assignment".${resourceId}`)} or ${isDeletedNode("role", naming, config, sql`"the_assignment".${roleId}`)}`;
  const validateBody = sql`
  if exists (select ${invalidAssignments}) then
    raise exception 'p9s: the assignment of resource % to role % does not reference rows of bound tables',
      (select "the_assignment".${resourceId} ${invalidAssignments} limit 1), (select "the_assignment".${roleId} ${invalidAssignments} limit 1)
      using errcode = 'foreign_key_violation';
  end if;${usesAnySoftDelete(naming, config) ? sql`
  if exists (select ${deletedAssignments}) then
    raise exception 'p9s: the assignment of resource % to role % links a soft deleted row, which has to be restored first',
      (select "the_assignment".${resourceId} ${deletedAssignments} limit 1), (select "the_assignment".${roleId} ${deletedAssignments} limit 1)
      using errcode = 'foreign_key_violation';
  end if;` : sql``}`;

  const getCombinedCacheBlock = (resourceOrRole: "role" | "resource") => {
    const thingCombinedWith = naming[resourceOrRole];
    const thingCombinedWithId = { role: roleId, resource: resourceId }[resourceOrRole];
    const thingNotCombinedWithId = { role: resourceId, resource: roleId }[resourceOrRole];
    // The cache layout is the same in both modes, so switching modes keeps the table and its dependents
    const combinedColumn = sql`"the_edge_cache".${thingCombinedWith.childId}`;
    const notCombinedColumn = sql`"the_assignment".${thingNotCombinedWithId}`;
    const [roleColumn, resourceColumn] = resourceOrRole === "role" ? [combinedColumn, notCombinedColumn] : [notCombinedColumn, combinedColumn];

    const selectCombined = (filter: SQL) => sql`
    select
      ${roleColumn} as ${roleId},
      ${resourceColumn} as ${resourceId},
      ${orBitmap} ("the_assignment".${permission} & "the_edge_cache".${permission}) as ${permission} -- bitwise "or" on permissions between various paths
    from
      ${edge} as "the_assignment"
    join
      ${thingCombinedWith.edgeCache} as "the_edge_cache"
    on
      "the_assignment".${thingCombinedWithId} = "the_edge_cache".${thingCombinedWith.parentId}
    where ${filter}
    group by ("the_assignment".${thingNotCombinedWithId}, "the_edge_cache".${thingCombinedWith.childId})`;

    // Recomputes every cache row sharing a key with the changed rows: a changed assignment affects all rows of its
    // resource (resp. role), a changed transitive edge affects all rows of its child
    const recompute = (cacheColumn: SQL, sourceFilter: (keys: SQL) => SQL, keys: SQL) => sql`
  delete from ${edgeCache} where ${cacheColumn} in (${keys});
  insert into ${edgeCache} (${roleId}, ${resourceId}, ${permission})
  ${selectCombined(sourceFilter(keys))};`;

    const byAssignment = (keys: SQL) => recompute(thingNotCombinedWithId, k => sql`"the_assignment".${thingNotCombinedWithId} in (${k})`, keys);
    const byEdgeCache = (keys: SQL) => recompute(thingCombinedWithId, k => sql`"the_edge_cache".${thingCombinedWith.childId} in (${k})`, keys);

    const newAssignments = sql`select ${thingNotCombinedWithId} from "p9s_new_rows"`;
    const oldAssignments = sql`select ${thingNotCombinedWithId} from "p9s_old_rows"`;
    const newEdgeCaches = sql`select ${thingCombinedWith.childId} from "p9s_new_rows"`;
    const oldEdgeCaches = sql`select ${thingCombinedWith.childId} from "p9s_old_rows"`;

    // The self row of a new bound row has no assignment yet and nothing can assign it before it commits. The assignments
    // are a join, so they are looked up by index: a correlated exists planned for a bulk write would hash them all.
    const onlyUnassignedSelfRows = sql`not exists (
    select from "p9s_new_rows" as "the_edge_cache"
    where "the_edge_cache".${thingCombinedWith.parentId} <> "the_edge_cache".${thingCombinedWith.childId}
  ) and not exists (
    select from "p9s_new_rows" as "the_edge_cache"
    join ${edge} as "the_assignment" on "the_assignment".${thingCombinedWithId} = "the_edge_cache".${thingCombinedWith.parentId}
  )`;

    const trigger = (functionName: SQL, triggerName: SQL, table: SQL, event: TriggerEvent, body: SQL, skip?: SQL) =>
      statementTrigger(naming, config, functionName, triggerName, table, event, body, sql``, skip);

    return sql`

-----------------------------------------------------------------------------------------------------------------------
-- Assignment transitive edge cache table
-----------------------------------------------------------------------------------------------------------------------
create table if not exists ${edgeCache} (
  ${roleId} ${idType} not null,
  ${resourceId} ${idType} not null,
  ${permission} bit(${literal(size)}),
  constraint ${edgeCachePkey} primary key (${roleId}, ${resourceId})
);

create index if not exists ${edgeCacheRoleIdIndex} on ${edgeCache} (${roleId});

create index if not exists ${edgeCacheResourceIdIndex} on ${edgeCache} (${resourceId});

-- With resources, a role has a row for every resource below its assignments, mostly high in the tree. As for the
-- resource cache, estimate the rows of a role as those of the largest, so that checking a few rows does not list them.
alter table ${edgeCache} alter column ${roleId} ${resourceOrRole === "resource" ? sql`set (n_distinct = 1)` : sql`reset (n_distinct)`};

-- Only p9s triggers write to the cache. Users see their own part of the graph through the views of the current user.
${setPrivileges(edgeCache, writers, [], users)}


-----------------------------------------------------------------------------------------------------------------------
-- View of all transitive assignment with cache edges
-----------------------------------------------------------------------------------------------------------------------
create or replace view ${edgeCacheView} as
${selectCombined(sql`true`)};

${setPrivileges(edgeCacheView, writers, [], users)}

-----------------------------------------------------------------------------------------------------------------------
-- Assignment function to rebuild the cache from scratch
-----------------------------------------------------------------------------------------------------------------------
create or replace function ${edgeCacheBackfill} ()
  returns setof ${edgeCache}
  as $$
begin
  ${lockGraphStatement(config)}
  -- Same as the edge cache backfills, the join plan needs statistics on freshly loaded tables
  analyze ${edge};
  analyze ${thingCombinedWith.edgeCache};
  delete from ${edgeCache};
  -- Policies read the rows of a role together. In this order they fill few pages, whatever plan the view takes.
  return query
  insert into ${edgeCache} (${roleId}, ${resourceId}, ${permission})
  select ${roleId}, ${resourceId}, ${permission}
  from
    ${edgeCacheView}
  order by
    ${roleId}, ${resourceId}
    returning
      *;
end;
$$
language plpgsql
volatile
${definer(naming)};

${grantExecute(sql`${edgeCacheBackfill} ()`, writers)}

-----------------------------------------------------------------------------------------------------------------------
-- Update cache when assignments change
-----------------------------------------------------------------------------------------------------------------------
${trigger(edgeInsertTriggerFunction, edgeInsertTrigger, edge, "insert", byAssignment(newAssignments))}
${trigger(edgeUpdateTriggerFunction, edgeUpdateTrigger, edge, "update", byAssignment(sql`${oldAssignments} union ${newAssignments}`))}
${trigger(edgeDeleteTriggerFunction, edgeDeleteTrigger, edge, "delete", byAssignment(oldAssignments))}

-----------------------------------------------------------------------------------------------------------------------
-- Update cache when the ${literal(resourceOrRole)} transitive edge cache changes
-----------------------------------------------------------------------------------------------------------------------
${trigger(combinedEdgeInsertTriggerFunction, combinedEdgeInsertTrigger, thingCombinedWith.edgeCache, "insert", byEdgeCache(newEdgeCaches), onlyUnassignedSelfRows)}
${trigger(combinedEdgeUpdateTriggerFunction, combinedEdgeUpdateTrigger, thingCombinedWith.edgeCache, "update", byEdgeCache(sql`${oldEdgeCaches} union ${newEdgeCaches}`))}
${trigger(combinedEdgeDeleteTriggerFunction, combinedEdgeDeleteTrigger, thingCombinedWith.edgeCache, "delete", byEdgeCache(oldEdgeCaches))}

-----------------------------------------------------------------------------------------------------------------------
-- Assignment functions to enable / disable triggers
-----------------------------------------------------------------------------------------------------------------------
create or replace function ${enableTriggerFunction}()
returns void as $$
  alter table ${edge} enable trigger ${edgeInsertTrigger};
  alter table ${edge} enable trigger ${edgeUpdateTrigger};
  alter table ${edge} enable trigger ${edgeDeleteTrigger};
  alter table ${thingCombinedWith.edgeCache} enable trigger ${combinedEdgeInsertTrigger};
  alter table ${thingCombinedWith.edgeCache} enable trigger ${combinedEdgeUpdateTrigger};
  alter table ${thingCombinedWith.edgeCache} enable trigger ${combinedEdgeDeleteTrigger};
  -- Backfill cache
  select 1 from ${edgeCacheBackfill}();
$$ language sql ${definer(naming)};

${grantExecute(sql`${enableTriggerFunction} ()`, writers)}

create or replace function ${disableTriggerFunction}()
returns void as $$
  alter table ${edge} disable trigger ${edgeInsertTrigger};
  alter table ${edge} disable trigger ${edgeUpdateTrigger};
  alter table ${edge} disable trigger ${edgeDeleteTrigger};
  alter table ${thingCombinedWith.edgeCache} disable trigger ${combinedEdgeInsertTrigger};
  alter table ${thingCombinedWith.edgeCache} disable trigger ${combinedEdgeUpdateTrigger};
  alter table ${thingCombinedWith.edgeCache} disable trigger ${combinedEdgeDeleteTrigger};
$$ language sql ${definer(naming)};

${grantExecute(sql`${disableTriggerFunction} ()`, writers)}

  `;
  }

  const combinedCacheBlock = (combineAssignmentsWith === "resource" || combineAssignmentsWith === "role") ? getCombinedCacheBlock(combineAssignmentsWith) : sql``;

  return sql`
-----------------------------------------------------------------------------------------------------------------------
-- Assignments connect rows of bound tables
-----------------------------------------------------------------------------------------------------------------------
${triggerFunction(naming, edgeValidateTriggerFunction, sql`
  if not exists (select from "p9s_new_rows") then
    return null;
  end if;
  ${lockGraph(config)}
${validateBody}`, indexLookupsOnly)}
${attachStatementTrigger(edgeValidateTriggerFunction, edgeValidateInsertTrigger, edge, "insert")}
${attachStatementTrigger(edgeValidateTriggerFunction, edgeValidateUpdateTrigger, edge, "update")}

drop trigger if exists ${truncateGuardTrigger} on ${edge};
create trigger ${truncateGuardTrigger} before truncate on ${edge} for each statement execute function ${naming.truncateGuardFunction}();

${dropAllTriggers}

${combinedCacheBlock}
`;
}


// Without a combined cache, removes the p9s objects a previous mode may have created. This runs after policies are
// replaced, since old ones may read the combined cache. No cascade, so objects created by the user on top of them
// make the migration fail instead of being dropped silently.
export const createMigrationCleanup = <User extends string>(naming: Naming<User>, config: CompleteConfig<User>) => {
  if (config.engine.combineAssignmentsWith !== "none") {
    return sql``;
  }
  const { enableTriggerFunction, disableTriggerFunction, edgeCacheBackfill, edgeCacheView, edgeCache,
    edgeInsertTriggerFunction, edgeUpdateTriggerFunction, edgeDeleteTriggerFunction } = naming.assignment;
  const combinedTriggerFunctions = (["role", "resource"] as const).flatMap(mode => {
    const modeNaming = getNaming({ ...config, engine: { ...config.engine, combineAssignmentsWith: mode } }).assignment;
    return [modeNaming.combinedEdgeInsertTriggerFunction, modeNaming.combinedEdgeUpdateTriggerFunction, modeNaming.combinedEdgeDeleteTriggerFunction];
  });
  return sql`
-----------------------------------------------------------------------------------------------------------------------
-- Cleanup of a previous combined assignment cache
-----------------------------------------------------------------------------------------------------------------------
${join([enableTriggerFunction, disableTriggerFunction, edgeCacheBackfill, edgeInsertTriggerFunction, edgeUpdateTriggerFunction, edgeDeleteTriggerFunction, ...combinedTriggerFunctions]
    .map(fn => sql`drop function if exists ${fn} ();`), `\n`)}
drop view if exists ${edgeCacheView};
drop table if exists ${edgeCache};
`;
}


// A table that becomes a leaf table still has the triggers that made its rows nodes. Its rows leave the graph: their
// edges and assignments go away, and the bootstrap below rebuilds the caches without them. Rows with children would
// leave those children without their parent, so they stop the migration.
export const createMigrationLeaves = <User extends string>(naming: Naming<User>, config: CompleteConfig<User>) => {
  const { assignment, truncateGuardTrigger } = naming;

  const leavesOf = (kind: Kind) => {
    const { edge, edgeCache, parentId, childId, disableTriggerFunction } = naming[kind];
    const other: Kind = kind === "resource" ? "role" : "resource";
    const leaves = getLeaves(kind, naming, config);
    // Role leaf rows keep an id, which their trigger guards. Resource leaf rows only need one to follow a parent key.
    const triggerLeaves = kind === "role" ? leaves : leaves.filter(keepsParentId);
    const others = [...getBindings(kind, naming, config), ...leaves.filter(leaf => !triggerLeaves.includes(leaf))];
    const otherLeaves = (binding: Binding) => leaves.filter(leaf => leaf !== binding);
    // The truncate guard trigger is shared by both trees
    const isNodeOfOther = (tableName: string) => getBindings(other, naming, config).some(binding => binding.tableName === tableName);

    // Ids never change, so the parent id of a leaf row only changes with its parent column. Set from the parent table
    // whatever the client writes, which needs the trigger to bypass the policies of the parent table.
    const leafTrigger = (binding: Binding) => {
      const { table, tableName, id, leaf, parents } = binding;
      const keeps = keepsParentId(binding);
      const columns = [...(kind === "role" ? [id] : []), ...(keeps ? [...parents.map(parent => parent.column), leaf.parentId] : [])];
      return sql`
create or replace function ${leaf.triggerFunction}()
returns trigger as $$
begin${kind === "role" ? sql`
  if tg_op = 'UPDATE' then
    if new.${id} is distinct from old.${id} then
      raise exception 'p9s: the role id of a % row cannot change', ${textLiteral(tableName)} using errcode = 'integrity_constraint_violation';
    end if;
  elsif exists (select from ${edgeCache} as "the_self" where "the_self".${parentId} = new.${id} and "the_self".${childId} = new.${id})${join(otherLeaves(binding).map(other => sql`
    or exists (select from ${other.table} as "the_leaf" where "the_leaf".${other.id} = new.${id})`), ``)} then
    raise exception 'p9s: the role id % is already used by another row', new.${id} using errcode = 'unique_violation';
  end if;` : sql``}${keeps ? sql`
  new.${leaf.parentId} := ${parentOf(binding, sql`new`)};${join(parents.filter(parent => parent.lookup).map(parent => sql`
  if new.${parent.column} is not null and ${parentIdOf(parent, sql`new`)} is null then
    raise exception 'p9s: % rows have a % that matches no row of %', ${textLiteral(tableName)}, ${textLiteral(nameOf(parent.column))}, ${textLiteral(parent.lookup!.tableName)}
      using errcode = 'foreign_key_violation';
  end if;`), ``)}` : sql``}
  return new;
end;
$$ language plpgsql ${definer(naming)};
${grantExecute(sql`${leaf.triggerFunction} ()`, [])}
drop trigger if exists ${leaf.trigger} on ${table};
create trigger ${leaf.trigger} before insert or update of ${join(columns, `, `)} on ${table} for each row execute function ${leaf.triggerFunction}();${!keeps ? sql`` : parents.length === 1 ? sql`
update ${table} as "the_row" set ${leaf.parentId} = "the_parent".${parents[0]!.lookup!.id}
from ${parents[0]!.lookup!.table} as "the_parent"
where "the_parent".${parents[0]!.lookup!.key} = "the_row".${parents[0]!.column} and "the_row".${leaf.parentId} is distinct from "the_parent".${parents[0]!.lookup!.id};` : sql`
update ${table} as "the_row" set ${leaf.parentId} = ${parentOf(binding, sql`"the_row"`)}
where "the_row".${leaf.parentId} is distinct from ${parentOf(binding, sql`"the_row"`)};`}`;
    };

    return sql`
${join(others.map(({ table, leaf }) => sql`drop trigger if exists ${leaf.trigger} on ${table};`), `\n`)}
${join(leaves.map(({ table, tableName, id, triggerFunction, triggers }) => sql`
do $$
begin
  if exists (select from pg_trigger where "tgrelid" = ${textLiteral(compile(table).text)}::regclass and "tgname" = ${textLiteral(nameOf(triggers.insert))}) then
    ${lockGraphStatement(config)}
    if exists (select from ${edge} as "the_edge" join ${table} as "the_row" on "the_edge".${parentId} = "the_row".${id}) then
      raise exception 'p9s: rows of % are parents of other ${raw(kind)}s, so % cannot become a ${raw(kind)} leaf table. Move their children first.', ${textLiteral(tableName)}, ${textLiteral(tableName)}
        using errcode = 'dependent_objects_still_exist';
    end if;
    drop trigger ${triggers.insert} on ${table};
    drop trigger if exists ${triggers.update} on ${table};
    drop trigger if exists ${triggers.delete} on ${table};${isNodeOfOther(tableName) ? sql`` : sql`
    drop trigger if exists ${truncateGuardTrigger} on ${table};`}
    drop function if exists ${triggerFunction} ();
    -- Home edges can only be deleted with the triggers off. The bootstrap turns them back on.
    perform ${disableTriggerFunction}();
    delete from ${assignment.edge} as "the_assignment" using ${table} as "the_row" where "the_assignment".${kind === "resource" ? assignment.resourceId : assignment.roleId} = "the_row".${id};
    delete from ${edge} as "the_edge" using ${table} as "the_row" where "the_edge".${childId} = "the_row".${id};${usesSoftDelete(kind, naming, config) ? sql`
    delete from ${naming[kind].edgeDeleted} as "the_edge" using ${table} as "the_row" where "the_edge".${childId} = "the_row".${id};` : sql``}${usesAnySoftDelete(naming, config) ? sql`
    delete from ${assignment.edgeDeleted} as "the_assignment" using ${table} as "the_row" where "the_assignment".${kind === "resource" ? assignment.resourceId : assignment.roleId} = "the_row".${id};` : sql``}
  end if;
end
$$;`), `\n`)}
${join(triggerLeaves.map(leafTrigger), `\n`)}`;
  };

  return sql`
-----------------------------------------------------------------------------------------------------------------------
-- Leaf tables
-----------------------------------------------------------------------------------------------------------------------
${leavesOf("resource")}
${leavesOf("role")}
`;
}


// Brings every cache up to date with the bound rows, edges and assignments, which also makes the migration re-runnable
export const createMigrationBootstrap = <User extends string>(naming: Naming<User>, config: CompleteConfig<User>) => {
  const combined = config.engine.combineAssignmentsWith !== "none";
  return sql`
-----------------------------------------------------------------------------------------------------------------------
-- Bootstrap caches
-----------------------------------------------------------------------------------------------------------------------
${combined ? sql`select ${naming.assignment.disableTriggerFunction}();` : sql``}
select ${naming.resource.enableTriggerFunction}();
select ${naming.role.enableTriggerFunction}();
${combined ? sql`select ${naming.assignment.enableTriggerFunction}();` : sql``}
`;
}


type LinkKind = Kind | "assignment";

// Hides link functions from PostGraphile, and tells the migration which functions it made for links
const linkFunctionComment = textLiteral("@behavior -*\np9s link function");

// A column of a link table, and the bound table whose rows it holds by their key
interface LinkEndBinding {
  column: SQL;
  table: SQL;
  key: SQL;
  id: SQL;
  // Whether the column holds a key of the table rather than its resource (or role) id
  lookup: boolean;
}

interface LinkBinding {
  kind: LinkKind;
  name: string;
  table: SQL;
  // The parent and the child of an edge, the resource and the role of an assignment
  first: LinkEndBinding;
  second: LinkEndBinding;
  // The bits a row gives, null for none
  bits: (row: SQL) => SQL;
  naming: Naming<any>["links"][string];
}

// The edges, or the assignments, that links of a kind keep
const linkTarget = (kind: LinkKind, naming: Naming<any>) => kind === "assignment"
  ? { edge: naming.assignment.edge, first: naming.assignment.resourceId, second: naming.assignment.roleId, permission: naming.assignment.permission, pkey: naming.assignment.edgePkey, linked: naming.assignment.linked, refresh: naming.assignment.linkRefreshFunction, home: undefined }
  : { edge: naming[kind].edge, first: naming[kind].parentId, second: naming[kind].childId, permission: naming[kind].permission, pkey: naming[kind].edgePkey, linked: naming[kind].linked, refresh: naming[kind].linkRefreshFunction, home: naming[kind].home };

const bitmapOf = (bits: Bits, config: CompleteConfig<any>) => {
  const size = config.engine.permission.bitmap.size;
  const names = config.engine.permission.bitmap.names ?? {};
  const positions = new Set(bits.map(bit => typeof bit === "string" ? names[bit]! : bit));
  return raw(`B'${Array.from({ length: size }, (_, position) => positions.has(position) ? "1" : "0").join("")}'`);
};

const getLinks = (naming: Naming<any>, config: CompleteConfig<any>): LinkBinding[] => (config.links ?? []).map(link => {
  const issues = linkIssues(link, config);
  if (issues.length > 0) {
    throw new Error(`Link ${link.name}: ${issues.map(issue => issue.message).join(", ")}`);
  }
  const linkNaming = naming.links[link.name]!;
  const endOf = (end: LinkEnd, kind: Kind): LinkEndBinding => {
    const tableNaming = naming.tables[end.table]!;
    const id = kind === "resource" ? tableNaming.resourceId : tableNaming.roleId;
    const key = end.key === undefined ? id : identifier(end.key);
    return { column: identifier(end.column), table: sql`${tableNaming.schema}.${tableNaming.name}`, key, id, lookup: compile(key).text !== compile(id).text };
  };
  const [first, second] = link.kind === "assignment"
    ? [endOf(link.resource!, "resource"), endOf(link.role!, "role")]
    : [endOf(link.parent!, link.kind), endOf(link.child!, link.kind)];
  const permission = link.permission;
  const bits = (row: SQL) => permission === undefined
    ? ones(config)
    : Array.isArray(permission)
      ? bitmapOf(permission, config)
      : sql`(case ${row}.${identifier(permission.column)}::text ${join(Object.entries(permission.values).map(([value, valueBits]) =>
        sql`when ${textLiteral(value)} then ${bitmapOf(valueBits, config)}`), " ")} end)`;
  return { kind: link.kind, name: link.name, table: sql`${linkNaming.schema}.${linkNaming.name}`, first, second, bits, naming: linkNaming };
});

// The resource (or role) id a row of a link table holds, as the owner
const linkIdOf = (end: LinkEndBinding, row: SQL) => end.lookup
  ? sql`(select "the_end".${end.id} from ${end.table} as "the_end" where "the_end".${end.key} = ${row}.${end.column})`
  : sql`${row}.${end.column}`;

// Tables of the application whose rows are edges or assignments. Each pair of rows they link has an edge (or an
// assignment), with the bits of all its rows, marked as linked. A statement on a link table recomputes the pairs of
// the rows it changed, from every link table of that kind, so the edges always say what the link tables say.
export const createMigrationLinks = <User extends string>(naming: Naming<User>, config: CompleteConfig<User>) => {
  const links = getLinks(naming, config);
  const { type: idType } = getIdType(config);
  const size = config.engine.permission.bitmap.size;
  const zeros = sql`b'0'::bit(${literal(size)})`;
  const { users } = getRoles(config);
  const kinds: LinkKind[] = ["resource", "role", "assignment"];

  const perKind = join(kinds.map(kind => {
    const target = linkTarget(kind, naming);
    const ofKind = links.filter(link => link.kind === kind);
    if (ofKind.length === 0) {
      return sql`
-- No link keeps ${literal(kind)} edges: those they kept go with their column
do $$
begin
  if exists (select from pg_attribute where "attrelid" = ${textLiteral(compile(target.edge).text)}::regclass and "attname" = ${textLiteral(nameOf(target.linked))} and not "attisdropped") then
    delete from ${target.edge} where ${target.linked};
    alter table ${target.edge} drop column ${target.linked};
  end if;
end
$$;
drop function if exists ${target.refresh} (${idType}[], ${idType}[]);
`;
    }
    // The rows of each link table between the given pairs, found through the keys of the pairs, by index
    const sources = join(ofKind.map(link => sql`
      select "the_pair"."first", "the_pair"."second", ${link.bits(sql`"the_link"`)} as "permission"
      from unnest("the_firsts", "the_seconds") as "the_pair" ("first", "second")
      ${link.first.lookup ? sql`join ${link.first.table} as "the_first" on "the_first".${link.first.id} = "the_pair"."first"` : sql``}
      ${link.second.lookup ? sql`join ${link.second.table} as "the_second" on "the_second".${link.second.id} = "the_pair"."second"` : sql``}
      join ${link.table} as "the_link"
        on "the_link".${link.first.column} = ${link.first.lookup ? sql`"the_first".${link.first.key}` : sql`"the_pair"."first"`}
        and "the_link".${link.second.column} = ${link.second.lookup ? sql`"the_second".${link.second.key}` : sql`"the_pair"."second"`}`), `
      union all`);
    const notHome = target.home ? sql` and not "the_edge".${target.home}` : sql``;
    return sql`
alter table ${target.edge} add column if not exists ${target.linked} boolean not null default false;

-- Brings the ${literal(kind)} edges of some pairs up to date with every link table of that kind. Home edges stay as their
-- parent column says. With array arguments, plpgsql would plan each statement again on every call, for about four times
-- the time it runs: every lookup is by key, so the generic plan is as good.
create or replace function ${target.refresh} ("the_firsts" ${idType}[], "the_seconds" ${idType}[])
returns void as $$
declare
  "the_fresh_firsts" ${idType}[];
  "the_fresh_seconds" ${idType}[];
  "the_fresh_permissions" bit(${literal(size)})[];
begin
  ${lockGraph(config)}
  select array_agg("the_source"."first"), array_agg("the_source"."second"), array_agg("the_source"."permission")
  into "the_fresh_firsts", "the_fresh_seconds", "the_fresh_permissions"
  from (
    select "the_row"."first", "the_row"."second", ${naming.orBitmap} ("the_row"."permission")::bit(${literal(size)}) as "permission"
    from (${sources}
    ) as "the_row"
    where "the_row"."permission" is not null
    group by "the_row"."first", "the_row"."second"
    having position(b'1' in ${naming.orBitmap} ("the_row"."permission")) > 0
  ) as "the_source";

  delete from ${target.edge} as "the_edge"
  using unnest("the_firsts", "the_seconds") as "the_pair" ("first", "second")
  where "the_edge".${target.first} = "the_pair"."first" and "the_edge".${target.second} = "the_pair"."second"
  and "the_edge".${target.linked}${notHome}
  and not exists (
    select from unnest("the_fresh_firsts", "the_fresh_seconds") as "the_fresh" ("first", "second")
    where "the_fresh"."first" = "the_pair"."first" and "the_fresh"."second" = "the_pair"."second"
  );

  insert into ${target.edge} as "the_edge" (${target.first}, ${target.second}, ${target.permission}, ${target.linked})
  select "the_fresh"."first", "the_fresh"."second", "the_fresh"."permission", true
  from unnest("the_fresh_firsts", "the_fresh_seconds", "the_fresh_permissions") as "the_fresh" ("first", "second", "permission")
  on conflict on constraint ${target.pkey} do update set ${target.permission} = excluded.${target.permission}, ${target.linked} = true
  where (${target.home ? sql`not "the_edge".${target.home} and ` : sql``}("the_edge".${target.permission} is distinct from excluded.${target.permission} or not "the_edge".${target.linked}));
end
$$ language plpgsql volatile ${definer(naming)} set plan_cache_mode = force_generic_plan;

${grantExecute(sql`${target.refresh} (${idType}[], ${idType}[])`, [])}
`;
  }), `\n`);

  const perLink = join(links.map(link => {
    const target = linkTarget(link.kind, naming);
    const { syncFunction, triggerFunction, insertTrigger, updateTrigger, deleteTrigger } = link.naming;
    const rowsOf = (value: SQL) => sql`jsonb_populate_recordset(null::${link.table}, ${value})`;
    const allRows = rowsOf(sql`coalesce("the_old", '[]'::jsonb) || coalesce("the_new", '[]'::jsonb)`);
    const unmatched = (end: LinkEndBinding) => end.lookup ? [sql`("the_row".${end.column} is not null and ${linkIdOf(end, sql`"the_row"`)} is null)`] : [];
    const unmatchedChecks = [...unmatched(link.first), ...unmatched(link.second)];
    const rowsAsJson = (rows: string) => sql`(select jsonb_agg(to_jsonb("the_row")) from ${identifier(rows)} as "the_row")`;
    return sql`
-----------------------------------------------------------------------------------------------------------------------
-- Link table ${literal(link.name)}: its rows are ${literal(link.kind)} ${link.kind === "assignment" ? sql`assignments` : sql`edges`}
-----------------------------------------------------------------------------------------------------------------------
-- Brings the pairs of some rows up to date: a pure recompute from the link tables, which anyone can run. A user who
-- writes an assignment link can only give, change or take away bits they have on the resource, like when sharing.
create or replace function ${syncFunction} ("the_old" jsonb, "the_new" jsonb, "the_check" boolean)
returns void as $$
declare
  "the_firsts" ${idType}[];
  "the_seconds" ${idType}[];
begin
  ${unmatchedChecks.length > 0 ? sql`if exists (select from ${rowsOf(sql`coalesce("the_new", '[]'::jsonb)`)} as "the_row" where ${join(unmatchedChecks, " or ")}) then
    raise exception 'p9s: % has rows that hold no row of the tables they link', ${textLiteral(link.name)}
      using errcode = 'foreign_key_violation';
  end if;` : sql``}
  ${link.kind === "assignment" ? sql`if "the_check" and exists (
    select from ${allRows} as "the_row"
    where ${link.bits(sql`"the_row"`)} is not null
    -- Rows of a resource that is gone, like those a cascade deletes with it, give nothing
    and exists (select from ${link.first.table} as "the_end" where "the_end".${link.first.key} = "the_row".${link.first.column})
    and (${link.bits(sql`"the_row"`)} & ~ coalesce(${naming.permissionFunction}(${linkIdOf(link.first, sql`"the_row"`)}), ${zeros})) <> ${zeros}
  ) then
    raise exception 'p9s: the rows of % can only give bits the current user has on the resource', ${textLiteral(link.name)}
      using errcode = 'insufficient_privilege';
  end if;` : sql``}
  select array_agg(${linkIdOf(link.first, sql`"the_row"`)}), array_agg(${linkIdOf(link.second, sql`"the_row"`)})
  into "the_firsts", "the_seconds"
  from ${allRows} as "the_row";
  if "the_firsts" is not null then
    perform ${target.refresh}("the_firsts", "the_seconds");
  end if;
end
$$ language plpgsql volatile ${definer(naming)} set plan_cache_mode = force_generic_plan;

select pg_temp.p9s_revoke_execute(${textLiteral(compile(sql`${syncFunction} (jsonb, jsonb, boolean)`).text)}, ${textLiteral(nameOf(syncFunction))});
grant execute on function ${syncFunction} (jsonb, jsonb, boolean) to public;
comment on function ${syncFunction} (jsonb, jsonb, boolean) is ${linkFunctionComment};

-- As the role that changed the table, to tell whether it is a user
create or replace function ${triggerFunction}()
returns trigger as $$
begin
  if tg_op = 'INSERT' then
    perform ${syncFunction}(null, ${rowsAsJson("p9s_new_rows")}, ${users.length > 0 ? sql`current_user = any (${roleArray(users)})` : sql`false`});
  elsif tg_op = 'UPDATE' then
    perform ${syncFunction}(${rowsAsJson("p9s_old_rows")}, ${rowsAsJson("p9s_new_rows")}, ${users.length > 0 ? sql`current_user = any (${roleArray(users)})` : sql`false`});
  else
    perform ${syncFunction}(${rowsAsJson("p9s_old_rows")}, null, ${users.length > 0 ? sql`current_user = any (${roleArray(users)})` : sql`false`});
  end if;
  return null;
end;
$$ language plpgsql security invoker set search_path = ${naming.schema}, pg_temp;

${grantExecute(sql`${triggerFunction} ()`, [])}
comment on function ${triggerFunction} () is ${linkFunctionComment};
${attachStatementTrigger(triggerFunction, insertTrigger, link.table, "insert")}
${attachStatementTrigger(triggerFunction, updateTrigger, link.table, "update")}
${attachStatementTrigger(triggerFunction, deleteTrigger, link.table, "delete")}
drop trigger if exists ${naming.truncateGuardTrigger} on ${link.table};
create trigger ${naming.truncateGuardTrigger} before truncate on ${link.table} for each statement execute function ${naming.truncateGuardFunction}();

-- The rows that were there before the table was linked, or changed while the triggers were not there
do $$
begin
  ${unmatchedChecks.length > 0 ? sql`if exists (select from ${link.table} as "the_row" where ${join(unmatchedChecks, " or ")}) then
    raise exception 'p9s: % has rows that hold no row of the tables they link', ${textLiteral(link.name)}
      using errcode = 'foreign_key_violation';
  end if;` : sql``}
  perform ${target.refresh}(array_agg("the_pair"."first"), array_agg("the_pair"."second"))
  from (
    select ${linkIdOf(link.first, sql`"the_row"`)} as "first", ${linkIdOf(link.second, sql`"the_row"`)} as "second" from ${link.table} as "the_row"
    union
    select "the_edge".${target.first}, "the_edge".${target.second} from ${target.edge} as "the_edge" where "the_edge".${target.linked}
  ) as "the_pair"
  having count(*) > 0;
end
$$;
`;
  }), `\n`);

  // Link tables of an earlier config lose their triggers and functions, which the comment of link functions tells
  const currentFunctions = links.flatMap(link => [nameOf(link.naming.triggerFunction), nameOf(link.naming.syncFunction)]);
  const isLinkFunction = sql`coalesce(obj_description("p"."oid", 'pg_proc'), '') = ${linkFunctionComment}`;
  const boundTables = config.tables.map(table => compile(sql`${naming.tables[table.name]!.schema}.${naming.tables[table.name]!.name}`).text);
  const stale = sql`
do $$
declare
  "the_stale" record;
begin
  for "the_stale" in
    select "t"."tgname"::text as "name", "t"."tgrelid"::regclass::text as "table",
      ("t"."tgrelid" <> all (array[${join(boundTables.map(table => sql`to_regclass(${textLiteral(table)})`), ", ")}]::regclass[])) as "unbound"
    from pg_trigger as "t"
    join pg_proc as "p" on "p"."oid" = "t"."tgfoid"
    where not "t"."tgisinternal"
    and "p"."pronamespace" = ${textLiteral(config.engine.schema)}::regnamespace
    and ${isLinkFunction}
    and "p"."proname" <> all (${roleArray(currentFunctions)})
  loop
    execute format('drop trigger %I on %s', "the_stale"."name", "the_stale"."table");
    if "the_stale"."unbound" then
      execute format('drop trigger if exists %I on %s', ${textLiteral(nameOf(naming.truncateGuardTrigger))}, "the_stale"."table");
    end if;
  end loop;
  for "the_stale" in
    select "p"."oid"::regprocedure::text as "signature"
    from pg_proc as "p"
    where "p"."pronamespace" = ${textLiteral(config.engine.schema)}::regnamespace
    and ${isLinkFunction}
    and "p"."proname" <> all (${roleArray(currentFunctions)})
  loop
    execute format('drop function %s', "the_stale"."signature");
  end loop;
end
$$;`;

  return sql`
-----------------------------------------------------------------------------------------------------------------------
-- Links
-----------------------------------------------------------------------------------------------------------------------
${stale}
${perKind}
${perLink}
`;
};

// The role node whose permissions the current user has. A user that is a role leaf row has the permissions of its
// parent. As a sub-select, the lookup runs once per query.
// A function that reads a table runs once per query, as an init plan, rather than once per row
const currentRoleNodeOf = (naming: Naming<any>, config: CompleteConfig<any>) => getLeaves("role", naming, config).length > 0
  ? sql`(select ${naming.currentRoleNodeFunction}())`
  : config.engine.authentication.key ? sql`(select ${currentUserIdFunction(config)}())` : sql`${currentUserIdFunction(config)}()`;

// The role node of any role id: the parent of a role leaf row, the id itself otherwise
const roleNodeOf = (naming: Naming<any>, config: CompleteConfig<any>, roleId: SQL) => {
  const roleLeaves = getLeaves("role", naming, config);
  return roleLeaves.length === 0 ? roleId : sql`coalesce(${join(roleLeaves.map(leaf => sql`
    (select ${parentOfLeaf(leaf, sql`"the_leaf"`)} from ${leaf.table} as "the_leaf" where "the_leaf".${leaf.id} = ${roleId}${leaf.softDelete ? sql` and "the_leaf".${leaf.softDelete} is null` : sql``}),`), ``)}
    ${roleId}
  )`;
};

// The bits the policies of tables, of the assignment table and the access views check
const policyBits = (config: CompleteConfig<any>) => [...new Set(config.tables.filter(table => table.isResource)
  .flatMap(table => Object.values(table.permission ?? {}).flatMap(bits => (["select", "insert", "update", "delete", "manageAccess", "share"] as const)
    .map(operation => bits?.[operation]).filter((bit): bit is number => bit != null))))].sort((a, b) => a - b);

const currentAccessViewOf = (naming: Naming<any>, bit: number) => identifier(`${nameOf(naming.currentAccessView)}_${bit}`);
const currentAccessCheckOf = (naming: Naming<any>, bit: number) => identifier(`${nameOf(naming.currentAccessView)}_${bit}_check`);
const currentAccessListOf = (naming: Naming<any>, bit: number) => identifier(`${nameOf(naming.currentAccessView)}_${bit}_list`);
const currentAccessFirstOf = (naming: Naming<any>, bit: number) => identifier(`${nameOf(naming.currentAccessView)}_${bit}_first`);
// Reads check their first row, which is all a lookup by id reads, then list this many resources the user has the bit
// on, once per statement: all of them for most users, at the cost of checking about 80 rows one by one. Telling the
// first row from the others reads the count at every row, about 0.1 µs, which listing at the first row would spare to
// statements over many rows, at the cost of a listing in every lookup by id.
export const LISTED_RESOURCES = 3000;
// Then statements check this many rows before listing every resource the user has the bit on. Listing costs about one
// check for every 40 resources, so past the 3000 above, checking 200 rows costs no more than listing 8000 resources: a
// page whose rows are mostly unreadable, or not among the first listed, stays a few milliseconds, and a count of
// 100,000 readable rows takes a few percent more.
export const CHECKED_ROWS = 200;
// Writes have no first listing to go past, and are rarely pages: one that writes many rows lists sooner.
export const CHECKED_WRITTEN_ROWS = 50;

// The part of the graph users can see. They have no privileges on the graph tables: the policies read these views,
// which run as their owner and only return rows of the current user. As security barriers, a filter of the user runs
// after theirs unless it is leakproof, like the comparison of ids, which lets Postgres look up a resource by index or
// list them all once, as it would from the tables.
export const createMigrationCurrentUserViews = <User extends string>(naming: Naming<User>, config: CompleteConfig<User>) => {
  const { resource, role, assignment, currentRoleNodeFunction, currentAccessView, currentAssignmentView, currentResourceEdgeView, currentRoleView, accessView, roleAccessView, orBitmap } = naming;
  const { type: idType } = getIdType(config);
  const { users, everyone } = getRoles(config);
  const size = config.engine.permission.bitmap.size;
  const roleLeaves = getLeaves("role", naming, config);
  const getCurrentUserId = sql`${currentUserIdFunction(config)}()`;
  const me = currentRoleNodeOf(naming, config);

  // As the owner, so that the policies of role leaf tables do not apply. It takes no argument, so that it only ever
  // tells the parent of the current user, not of any key. A parentless leaf row maps to itself, which is not a node and
  // so has no permissions. In plpgsql, which keeps its plan for the session: a sql function that cannot be inlined is
  // planned again by every query.
  const currentRoleNode = roleLeaves.length === 0 ? sql`` : sql`
create or replace function ${currentRoleNodeFunction} ()
  returns ${idType}
  as $$
declare
  "the_user_id" ${idType} := ${getCurrentUserId};
begin
  return ${roleNodeOf(naming, config, sql`"the_user_id"`)};
end
$$ language plpgsql stable ${definer(naming)};

${grantExecute(sql`${currentRoleNodeFunction} ()`, everyone)}
`;

  // A (user, resource) pair has a bit iff some path role -> assignment -> resource has that bit on every edge. Each
  // cache stores the OR over paths of its own segment, so a row per chain of segments, with the AND of their bits, is
  // exact. Not grouped by resource, so that Postgres can look up the chains of one resource by index.
  const bitmap = (...columns: SQL[]) => sql`(${join(columns, " & ")})::bit(${literal(size)})`;
  const hasBit = (column: SQL, bit: number) => sql`(${column} << ${literal(bit)})::bit = b'1'`;
  // With a bit, only the chains that have it, and only their resources
  const access = (bit?: number) => {
    const chain = (resourceColumn: SQL, from: SQL, isMe: SQL, permissions: SQL[]) => sql`
select
  ${resourceColumn} as ${assignment.resourceId}${bit === undefined ? sql`,
  ${bitmap(...permissions)} as ${assignment.permission}` : sql``}
from ${from}
where ${isMe}${bit === undefined ? sql`` : sql` and ${join(permissions.map(permission => hasBit(permission, bit)), " and ")}`}`;
    switch (config.engine.combineAssignmentsWith) {
      case "role": return chain(sql`"the_resource_edge".${resource.childId}`, sql`${resource.edgeCache} as "the_resource_edge"
join ${assignment.edgeCache} as "the_assignment_edge" on "the_assignment_edge".${assignment.resourceId} = "the_resource_edge".${resource.parentId}`,
        sql`"the_assignment_edge".${assignment.roleId} = ${me}`,
        [sql`"the_resource_edge".${resource.permission}`, sql`"the_assignment_edge".${assignment.permission}`]);
      case "resource": return chain(sql`"the_assignment_edge".${assignment.resourceId}`, sql`${assignment.edgeCache} as "the_assignment_edge"
join ${role.edgeCache} as "the_role_edge" on "the_role_edge".${role.parentId} = "the_assignment_edge".${assignment.roleId}`,
        sql`"the_role_edge".${role.childId} = ${me}`,
        [sql`"the_assignment_edge".${assignment.permission}`, sql`"the_role_edge".${role.permission}`]);
      default: return chain(sql`"the_resource_edge".${resource.childId}`, sql`${resource.edgeCache} as "the_resource_edge"
join ${assignment.edge} as "the_assignment_edge" on "the_assignment_edge".${assignment.resourceId} = "the_resource_edge".${resource.parentId}
join ${role.edgeCache} as "the_role_edge" on "the_role_edge".${role.parentId} = "the_assignment_edge".${assignment.roleId}`,
        sql`"the_role_edge".${role.childId} = ${me}`,
        [sql`"the_resource_edge".${resource.permission}`, sql`"the_assignment_edge".${assignment.permission}`, sql`"the_role_edge".${role.permission}`]);
    }
  };

  // The same chains for every role
  const roleAccess = (() => {
    const permissions = (...columns: SQL[]) => sql`${bitmap(...columns)} as ${assignment.permission}`;
    switch (config.engine.combineAssignmentsWith) {
      case "role": return sql`
  select "the_resource_edge".${resource.childId} as ${assignment.resourceId}, "the_assignment_edge".${assignment.roleId},
    ${permissions(sql`"the_resource_edge".${resource.permission}`, sql`"the_assignment_edge".${assignment.permission}`)}
  from ${resource.edgeCache} as "the_resource_edge"
  join ${assignment.edgeCache} as "the_assignment_edge" on "the_assignment_edge".${assignment.resourceId} = "the_resource_edge".${resource.parentId}`;
      case "resource": return sql`
  select "the_assignment_edge".${assignment.resourceId}, "the_role_edge".${role.childId} as ${assignment.roleId},
    ${permissions(sql`"the_assignment_edge".${assignment.permission}`, sql`"the_role_edge".${role.permission}`)}
  from ${assignment.edgeCache} as "the_assignment_edge"
  join ${role.edgeCache} as "the_role_edge" on "the_role_edge".${role.parentId} = "the_assignment_edge".${assignment.roleId}`;
      default: return sql`
  select "the_resource_edge".${resource.childId} as ${assignment.resourceId}, "the_role_edge".${role.childId} as ${assignment.roleId},
    ${permissions(sql`"the_resource_edge".${resource.permission}`, sql`"the_assignment_edge".${assignment.permission}`, sql`"the_role_edge".${role.permission}`)}
  from ${resource.edgeCache} as "the_resource_edge"
  join ${assignment.edge} as "the_assignment_edge" on "the_assignment_edge".${assignment.resourceId} = "the_resource_edge".${resource.parentId}
  join ${role.edgeCache} as "the_role_edge" on "the_role_edge".${role.parentId} = "the_assignment_edge".${assignment.roleId}`;
    }
  })();

  for (const table of config.tables.filter(table => table.resourceLeaf)) {
    if (Object.values(table.permission ?? {}).some(bits => {
      const { manageAccess, share } = (bits ?? {}) as { manageAccess?: number; share?: number };
      return manageAccess != null || share != null;
    })) {
      throw new Error(`Leaf rows have no access of their own: manageAccess and share are checked on resources, and the rows of ${table.name} are not`);
    }
  }
  // Roles that can read the graph tables, graph writers and the owner, see everything. In a view, current_user is
  // the user of the view, so the manageAccess bit of the user role it belongs to applies, on the table of the resource.
  const managed = getBindings("resource", naming, config).flatMap(binding => {
    const permission = config.tables.find(table => table.name === binding.tableName)?.permission ?? {};
    const bits = users.flatMap(user => {
      const bit = (permission as Record<string, { manageAccess?: number } | undefined>)[user]?.manageAccess;
      return bit == null ? [] : [{ user, bit }];
    });
    return bits.length === 0 ? [] : [{ binding, bits }];
  });
  const managesAccess = (target: SQL) => sql`(
  (select has_table_privilege(current_user, ${textLiteral(compile(resource.edgeCache).text)}::regclass, 'select'))${join(managed.map(({ binding, bits }) => sql`
  or (exists (select from ${binding.table} as "the_row" where "the_row".${binding.id} = ${target}) and (${join(bits.map(({ user, bit }) => sql`
    (pg_has_role(current_user, ${textLiteral(user)}, 'member') and exists (select from ${currentAccessViewOf(naming, bit)} as "the_manager" where "the_manager".${assignment.resourceId} = ${target}))`), ` or`)}))`), ``)}
)`;

  // In role mode, the cache has a row per assigned resource for every role below the assignment, merged over paths
  const assignments = config.engine.combineAssignmentsWith === "role" ? sql`
select "the_assignment_edge".${assignment.resourceId}, "the_assignment_edge".${assignment.permission}
from ${assignment.edgeCache} as "the_assignment_edge"
where "the_assignment_edge".${assignment.roleId} = ${me}` : sql`
select "the_assignment_edge".${assignment.resourceId}, ${orBitmap} (${bitmap(sql`"the_assignment_edge".${assignment.permission}`, sql`"the_role_edge".${role.permission}`)})::bit(${literal(size)}) as ${assignment.permission}
from ${assignment.edge} as "the_assignment_edge"
join ${role.edgeCache} as "the_role_edge" on "the_role_edge".${role.parentId} = "the_assignment_edge".${assignment.roleId}
where "the_role_edge".${role.childId} = ${me}
group by "the_assignment_edge".${assignment.resourceId}`;

  return sql`
-----------------------------------------------------------------------------------------------------------------------
-- The graph as the current user sees it
-----------------------------------------------------------------------------------------------------------------------
${currentRoleNode}
-- Every way the current user reaches a resource, with the bits it gives. A resource the user reaches several ways has
-- the OR of their bits.
create or replace view ${currentAccessView} with (security_barrier) as${access()};

${setPrivileges(currentAccessView, everyone, [])}

-- The resources the current user has a bit on, for each bit the policies check. Checking the bit on every segment
-- keeps only the edges that have it: a security barrier would only check it after the joins, as it is not leakproof.
${join(policyBits(config).map(bit => sql`
create or replace view ${currentAccessViewOf(naming, bit)} with (security_barrier) as${access(bit)};

${setPrivileges(currentAccessViewOf(naming, bit), everyone, [])}

-- The same as the policies use it: whether the current user has the bit on one resource, and every resource it has
-- the bit on. In plpgsql, which keeps its plans for the session, and at the cost of one call:
-- checking every row of a large scan would look costly enough to the planner to compile the query with JIT, and
-- listing, which runs once, would count again for every lookup of a nested loop and keep it from using an index.
-- Listing goes through the indexes, from the assignments of the user down. When the statistics say a parent has most
-- of a cache table, the planner would rather scan the whole table, also for a user with few resources, and with a
-- limit, stop at the first rows that match.
create or replace function ${currentAccessCheckOf(naming, bit)} ("the_resource_id" ${idType})
  returns boolean
  as $$
begin
  return exists (select from ${currentAccessViewOf(naming, bit)} as "var_access" where "var_access".${assignment.resourceId} = "the_resource_id");
end
$$ language plpgsql stable cost 1 set search_path = ${naming.schema}, pg_temp;

${grantExecute(sql`${currentAccessCheckOf(naming, bit)} (${idType})`, everyone)}

create or replace function ${currentAccessListOf(naming, bit)} ()
  returns setof ${idType}
  as $$
begin
  return query select "var_access".${assignment.resourceId} from ${currentAccessViewOf(naming, bit)} as "var_access";
end
$$ language plpgsql stable cost 1 rows 1000 set search_path = ${naming.schema}, pg_temp
  set enable_seqscan = off set enable_hashjoin = off set enable_mergejoin = off;

${grantExecute(sql`${currentAccessListOf(naming, bit)} ()`, everyone)}

-- The first of them, and a null when there may be more: a resource that is not among them is then neither in nor out
create or replace function ${currentAccessFirstOf(naming, bit)} ("the_count" bigint)
  returns setof ${idType}
  as $$
declare
  "var_count" bigint;
begin
  return query select "var_access".${assignment.resourceId} from ${currentAccessViewOf(naming, bit)} as "var_access" limit "the_count";
  get diagnostics "var_count" = row_count;
  if "var_count" >= "the_count" then
    return next null;
  end if;
end
$$ language plpgsql stable cost 1 rows 1000 set search_path = ${naming.schema}, pg_temp
  set enable_seqscan = off set enable_bitmapscan = off set enable_hashjoin = off set enable_mergejoin = off;

${grantExecute(sql`${currentAccessFirstOf(naming, bit)} (bigint)`, everyone)}
`), ``)}

-- What was shared with the current user: the resources assigned to it and to the roles above it, with the bits these
-- assignments give, whatever is below these resources
create or replace view ${currentAssignmentView} with (security_barrier) as${assignments};

${setPrivileges(currentAssignmentView, everyone, [])}

-- The edges of the resource cache between two resources the current user reaches, to tell what is below what. The
-- cache has a row for every ancestor, bits or not, so whoever reaches a resource reaches what is below it.${config.engine.resourceCache === "assigned" ? sql`
-- With resourceCache "assigned", only the ancestors that have assignments have rows.` : sql``}
create or replace view ${currentResourceEdgeView} with (security_barrier) as
select "the_edge".${resource.parentId}, "the_edge".${resource.childId}, "the_edge".${resource.permission}
from ${resource.edgeCache} as "the_edge"
where exists (select from ${currentAccessView} as "the_access" where "the_access".${assignment.resourceId} = "the_edge".${resource.parentId});

${setPrivileges(currentResourceEdgeView, everyone, [])}

-- The roles the current user acts as: its role node and the roles above it, with the bits of the way up
create or replace view ${currentRoleView} with (security_barrier) as
select "the_edge".${role.parentId} as ${assignment.roleId}, "the_edge".${role.permission}
from ${role.edgeCache} as "the_edge"
where "the_edge".${role.childId} = ${me};

${setPrivileges(currentRoleView, everyone, [])}

-- Who has access to a resource: every assignment that reaches it, from the resource itself or from above, with the
-- bits that reach it. For users with the manageAccess bit on the resource, and for the roles that can read the graph.
create or replace view ${accessView} with (security_barrier) as
select "the_resource_edge".${resource.childId} as ${assignment.resourceId}, "the_assignment_edge".${assignment.roleId},
  "the_assignment_edge".${assignment.resourceId} as "assigned_resource_id",
  ${bitmap(sql`"the_resource_edge".${resource.permission}`, sql`"the_assignment_edge".${assignment.permission}`)} as ${assignment.permission}
from ${resource.edgeCache} as "the_resource_edge"
join ${assignment.edge} as "the_assignment_edge" on "the_assignment_edge".${assignment.resourceId} = "the_resource_edge".${resource.parentId}
where ${managesAccess(sql`"the_resource_edge".${resource.childId}`)};

${setPrivileges(accessView, everyone, [])}

-- Every way any role reaches a resource, with the bits it gives, as the view of the current user has them for the
-- current user. A role leaf row has the ways of its parent.
create or replace view ${roleAccessView} with (security_barrier) as
select "the_access".${assignment.resourceId}, "the_access".${assignment.roleId}, "the_access".${assignment.permission}
from (${roleAccess}${join(roleLeaves.map(leaf => sql`
  union all
  select "the_node_access".${assignment.resourceId}, "the_leaf".${leaf.id}, "the_node_access".${assignment.permission}
  from (${roleAccess}) as "the_node_access"
  join ${leaf.table} as "the_leaf" on ${parentOfLeaf(leaf, sql`"the_leaf"`)} = "the_node_access".${assignment.roleId}${leaf.softDelete ? sql` and "the_leaf".${leaf.softDelete} is null` : sql``}`), ``)}
) as "the_access"
where ${managesAccess(sql`"the_access".${assignment.resourceId}`)};

${setPrivileges(roleAccessView, everyone, [])}
${usesSoftDelete("resource", naming, config) ? sql`
-- The soft deleted resources of the current user, with the bits it would have on them once restored: from the
-- parents it reaches, and from the assignments of the roles it acts as. A resource under another deleted resource
-- comes back with that one. An edge aside from a parent the user reaches, which is in the graph, is an edge to a
-- deleted resource; an assignment aside can also be of a deleted role.
create or replace view ${naming.currentDeletedView} with (security_barrier) as
select "the_access".${assignment.resourceId}, ${orBitmap} ("the_access".${assignment.permission})::bit(${literal(size)}) as ${assignment.permission}
from (
  select "the_edge".${resource.childId} as ${assignment.resourceId}, ${bitmap(sql`"the_parent".${assignment.permission}`, sql`"the_edge".${resource.permission}`)} as ${assignment.permission}
  from ${resource.edgeDeleted} as "the_edge"
  join ${currentAccessView} as "the_parent" on "the_parent".${assignment.resourceId} = "the_edge".${resource.parentId}
  union all
  select "the_assignment".${assignment.resourceId}, ${bitmap(sql`"the_assignment".${assignment.permission}`, sql`"the_role".${role.permission}`)}
  from ${assignment.edgeDeleted} as "the_assignment"
  join ${currentRoleView} as "the_role" on "the_role".${assignment.roleId} = "the_assignment".${assignment.roleId}
  where ${isDeletedNode("resource", naming, config, sql`"the_assignment".${assignment.resourceId}`)}
) as "the_access"
group by "the_access".${assignment.resourceId}
having position(b'1' in ${orBitmap} ("the_access".${assignment.permission})) > 0;

${setPrivileges(naming.currentDeletedView, everyone, [])}

-- The same for one resource, looking up the bits of each parent rather than listing every resource the user reaches.
-- As the owner, which reads the graph tables, for the current user only like the views. Policies call it for deleted rows only: in plpgsql, so that the planner counts it as one call per row rather than as
-- its whole query, which would make the plans of every query on the table look costly.
create or replace function ${naming.deletedPermissionFunction} ("the_resource_id" ${idType})
  returns bit(${literal(size)})
  as $$
begin
  return (
    select ${orBitmap} ("the_access".${assignment.permission}) from (
      select ${bitmap(sql`${naming.permissionFunction}("the_edge".${resource.parentId})`, sql`"the_edge".${resource.permission}`)} as ${assignment.permission}
      from ${resource.edgeDeleted} as "the_edge"
      where "the_edge".${resource.childId} = "the_resource_id"
      union all
      select ${bitmap(sql`"the_assignment".${assignment.permission}`, sql`"the_role".${role.permission}`)}
      from ${assignment.edgeDeleted} as "the_assignment"
      join ${currentRoleView} as "the_role" on "the_role".${assignment.roleId} = "the_assignment".${assignment.roleId}
      where "the_assignment".${assignment.resourceId} = "the_resource_id"
      and ${isDeletedNode("resource", naming, config, sql`"the_resource_id"`)}
    ) as "the_access"
  )::bit(${literal(size)});
end
$$ language plpgsql stable ${definer(naming)};

${grantExecute(sql`${naming.deletedPermissionFunction} (${idType})`, everyone)}
` : sql``}`;
}

export const createMigrationDataModelPolicies = <User extends string>(naming: Naming<User>, config: CompleteConfig<User>) => {
  const { resource, role, assignment, currentRoleNodeFunction, currentAccessView, roleAccessView, permissionFunction, orBitmap } = naming;
  const { type: idType } = getIdType(config);
  const { users, writers, everyone } = getRoles(config);
  const size = config.engine.permission.bitmap.size;
  const roleLeaves = getLeaves("role", naming, config);
  const hasBit = (alias: string, column: SQL, bit: number | SQL) => sql`(${identifier(alias)}.${column} << ${typeof bit === "number" ? literal(bit) : bit})::bit = b'1'`;
  const nodeBindings = getBindings("resource", naming, config);
  const bindings = new Map([...nodeBindings, ...getLeaves("resource", naming, config)].map(binding => [binding.tableName, binding]));

  // A bit known when migrating has its own view, see createMigrationCurrentUserViews
  const accessCheck = (target: SQL, bit: number | SQL) => typeof bit === "number" ? sql`${currentAccessCheckOf(naming, bit)}(${target})` : sql`
  exists (
    select from ${currentAccessView} as "var_access"
    where "var_access".${assignment.resourceId} = ${target} and ${hasBit("var_access", assignment.permission, bit)}
  )`;

  // Users only learn their own permissions: no bits for a resource they have no access to, as for one that does not
  // exist. Users with the manageAccess bit on a resource, and graph writers, can ask for any role, to show who can do
  // what or to check a user before a graph write. A role leaf row, like an API key, has the permissions of its parent.
  const permissionFunctionSql = sql`
create or replace function ${permissionFunction} ("the_resource_id" ${idType})
  returns bit(${literal(size)})
  as $$
begin
  return (
    select ${orBitmap} ("var_access".${assignment.permission}) from ${currentAccessView} as "var_access"
    where "var_access".${assignment.resourceId} = "the_resource_id"
  )::bit(${literal(size)});
end
$$ language plpgsql stable set search_path = ${naming.schema}, pg_temp;

${grantExecute(sql`${permissionFunction} (${idType})`, everyone)}

-- The permissions of any role, for users with the manageAccess bit on the resource and for graph writers
create or replace function ${permissionFunction} ("the_resource_id" ${idType}, "the_role_id" ${idType})
  returns bit(${literal(size)})
  as $$
begin
  return (
    select ${orBitmap} ("var_access".${assignment.permission}) from ${roleAccessView} as "var_access"
    where "var_access".${assignment.resourceId} = "the_resource_id" and "var_access".${assignment.roleId} = "the_role_id"
  )::bit(${literal(size)});
end
$$ language plpgsql stable security invoker set search_path = ${naming.schema}, pg_temp;

${grantExecute(sql`${permissionFunction} (${idType}, ${idType})`, everyone)}
`;

  // Policies read the parent table through this lookup, so that its own policies do not apply. A table whose parent
  // is a row of the same table would otherwise recurse into its own policies.
  const parentFunctions = join(nodeBindings.flatMap(binding => binding.parents.filter(parent => parent.lookup).map(({ column, lookup, function: lookupFunction }) => {
    return sql`
create or replace function ${lookupFunction} ("the_key" ${binding.table}.${column}%type)
  returns ${idType}
  as $$
  select "the_parent".${lookup!.id} from ${lookup!.table} as "the_parent" where "the_parent".${lookup!.key} = $1
$$ language sql stable cost 1 ${definer(naming)};

${grantExecute(sql`${lookupFunction} (${binding.table}.${column}%type)`, users)}
`;
  })), `\n`);

  // Moving a row is inserting it under its new parent, unless that parent already links to it. In plpgsql, so that
  // policies calling it are not planned with its queries on every update. As the owner, to read the edges, which only
  // tells the parents of a row the user has access to.
  const hasParents = nodeBindings.some(hasParent);
  const parentValidate = hasParents ? sql`
create or replace function ${resource.parentValidateFunction} ("the_parent" ${idType}, "the_child" ${idType}, "the_insert_bit" integer)
  returns boolean
  as $$
begin
  return "the_parent" is null
    or (exists (select from ${resource.edge} as "var_edge" where "var_edge".${resource.parentId} = "the_parent" and "var_edge".${resource.childId} = "the_child")
      and exists (select from ${currentAccessView} as "var_access" where "var_access".${assignment.resourceId} = "the_child" and position(b'1' in "var_access".${assignment.permission}) > 0))
    or ("the_insert_bit" is not null and ${accessCheck(sql`"the_parent"`, sql`"the_insert_bit"`)});
end
$$ language plpgsql stable ${definer(naming)};

${grantExecute(sql`${resource.parentValidateFunction} (${idType}, ${idType}, integer)`, users)}
` : sql``;

  const parentOf = (table: CompleteConfig<User>["tables"][number], name: SQL) => {
    const binding = bindings.get(table.name);
    return binding && hasParent(binding) ? (table.resourceLeaf ? parentOfLeaf(binding, name) : parentOfInPolicy(binding, name)) : undefined;
  };

  // What a policy reading rows lets through. Left to the planner, Postgres checks the rows one by one or lists once
  // every resource the user has the bit on, for the rows it expects the scan to return. A filter that runs after the
  // policy, like ilike, which is not leakproof, makes it expect few rows and check every row of the table. So the
  // policy decides as the statement runs, and only reads the state it keeps for the rows it has not decided yet:
  // - Reads check their first row by its ancestors, which is all a lookup by id reads.
  // - Past it, reads list the resources the user has the bit on, all of them for most users.
  // - For a row that is not among them, the policy checks rows one by one, 200 by default, then lists every resource.
  // Writes, which rarely read many rows, only check then list, after 50 rows, and so does the select policy of the
  // statement that writes, which Postgres runs after theirs: they mark the table as written by the statement, known by
  // the time it started. Listing first would read every resource under the parents of the user, and the rows that writes leave
  // there until a vacuum, while a check only reads the ancestors of the row. A statement sent in the same query string
  // after a write is taken for a write too. With p9s.check_rows, statements check that many rows whoever the user is,
  // every row with on, none with off. The count is a setting of the transaction, one per table and operation, that the
  // statement resets first. Every way gives the same rows, they only differ in speed.
  const setting = sql`coalesce(current_setting('p9s.check_rows', true), '')`;
  const checkRowsOr = (rows: number) => sql`(select case when ${setting} = 'on' then '-1' when ${setting} = 'off' then '0'
    when ${setting} ~ '^[0-9]{1,9}$' then (${setting}::bigint)::text else ${textLiteral(String(rows))} end)`;
  const settingName = (table: CompleteConfig<User>["tables"][number]) => table.name.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  const inserting = (table: CompleteConfig<User>["tables"][number]) => textLiteral(`p9s.inserting_${settingName(table)}`);
  const readCheck = (table: CompleteConfig<User>["tables"][number], operation: "select" | "update" | "delete", target: SQL, bit: number, parent?: SQL) => {
    const tableName = settingName(table);
    const counter = textLiteral(`p9s.checked_${tableName}_${operation}`);
    const writing = textLiteral(`p9s.writing_${tableName}`);
    const list = sql`${target} in (select ${currentAccessListOf(naming, bit)}())`;
    const reset = sql`(select set_config(${counter}, '0', true)) is not null`;
    const check = sql`set_config(${counter}, (coalesce(nullif(current_setting(${counter}, true), '')::bigint, 0) + 1)::text, true) is not null
    and ${currentAccessCheckOf(naming, bit)}(${target})`;
    const checkThenList = sql`case current_setting(${counter}, true) when ${checkRowsOr(CHECKED_WRITTEN_ROWS)} then ${list} else ${check} end`;
    if (operation !== "select") {
      return sql`
  case when not (select set_config(${counter}, '0', true) || set_config(${writing}, statement_timestamp()::text, true)) is not null then null
  else ${checkThenList} end`;
    }
    const written = sql`(select current_setting(${writing}, true) = statement_timestamp()::text)`;
    // The rows an insert returns have no permissions of their own until the statement ends: they will have those of
    // their parent, which the insert policy checked
    const inserted = sql`(select current_setting(${inserting(table)}, true) = statement_timestamp()::text)`;
    const auto = sql`(select ${setting} !~ '^(on|off|[0-9]{1,9})$')`;
    const first = (count: number) => sql`case when ${auto} then ${target} in (select ${currentAccessFirstOf(naming, bit)}(${literal(count)})) end`;
    return sql`
  case when not ${reset} then null${parent ? sql`
  when ${inserted} then ${currentAccessCheckOf(naming, bit)}(${parent}) or ${checkThenList}` : sql``}
  when ${written} then ${checkThenList}
  else coalesce(
    case current_setting(${counter}, true) when (select case when ${auto} then '0' end) then ${check} end,
    ${first(LISTED_RESOURCES)},
    case current_setting(${counter}, true) when ${checkRowsOr(CHECKED_ROWS)} then ${list} else ${check} end) end`;
  };

  // What the select policy of a user lets through, for the policy and for the searches
  const selectUsing = (table: CompleteConfig<User>["tables"][number], user: User) => {
    const { name, resourceId } = naming.tables[table.name]!;
    const bit = table.permission[user]!.select;
    const target = table.resourceLeaf ? parentOf(table, name)! : sql`${name}.${resourceId}`;
    const softDelete = bindings.get(table.name)?.softDelete;
    const deletedCheck = softDelete && !table.resourceLeaf && sql`
  or (${name}.${softDelete} is not null and (${naming.deletedPermissionFunction}(${name}.${resourceId}) << ${literal(bit)})::bit = b'1')`;
    return sql`${readCheck(table, "select", target, bit, table.resourceLeaf ? undefined : parentOf(table, name))}${deletedCheck || sql``}`;
  };

  // RLS never runs an operator that is not leakproof, like ilike or @@, before a policy, so the indexes that serve it
  // go unused. A search matches through them as the owner, keeps the rows the select policy of the user lets through,
  // and gives their ctids to the function users call, which reads these rows as the caller, through RLS, so that the
  // other policies and the column privileges of the table apply too.
  const searches = config.tables.flatMap(table => Object.entries(table.search ?? {}).map(([key, search]) => {
    const searchers = config.engine.users.filter(user => table.isResource && table.permission[user]?.select != null);
    const argument = search.operator === "@@" ? sql`tsquery` : sql`text`;
    return { table, searchers, argument, search, fn: identifier(`${table.name}_${key}`), of: (user: string) => identifier(`${table.name}_${key}_${user}`) };
  }));
  // Run with execute, Postgres plans for the value and the rows it gets: listing what the user can read, or checking
  // each row, for as many rows as match, and as many as come back
  const dynamic = (query: SQL) => {
    const { text, values } = compile(query);
    if (values && values.length > 0) {
      throw new Error("p9s: a search query cannot have bind parameters");
    }
    return textLiteral(text);
  };
  const searchSql = join(searches.map(({ table, searchers, argument, search, fn, of }) => {
    const { schema, name } = naming.tables[table.name]!;
    const match = join(search.columns.map(column => sql`${name}.${identifier(column)} ${raw(search.operator)} $1`), " or ");
    return sql`${join(searchers.map(user => sql`
-- The rows of ${raw(table.name)} matching the value that ${raw(user)} can read, by ctid
create or replace function ${of(user)} ("the_value" ${argument})
  returns setof tid
  as $$
begin
  return query execute ${dynamic(sql`
  select ${name}.ctid from ${schema}.${name} as ${name}
  where (${match})
  and (${selectUsing(table, user)})`)} using "the_value";
end
$$ language plpgsql stable ${definer(naming)};

${grantExecute(sql`${of(user)} (${argument})`, [user])}
`), ``)}
-- The rows of ${raw(table.name)} whose ${raw(search.columns.join(", "))} match the value with ${raw(search.operator)}, among those the current user can read
create or replace function ${fn} ("the_value" ${argument})
  returns setof ${schema}.${name}
  as $$
declare
  "the_rows" tid[] := '{}';
begin${join(searchers.map(user => sql`
  if pg_has_role(current_user, ${textLiteral(user)}, 'member') then
    "the_rows" := "the_rows" || array(select ${of(user)}("the_value"));
  end if;`), ``)}
  return query execute ${dynamic(sql`select "the_row".* from ${schema}.${name} as "the_row" where "the_row".ctid = any ($1)`)} using "the_rows";
end
$$ language plpgsql stable security invoker set search_path = ${naming.schema}, pg_temp;

${grantExecute(sql`${fn} (${argument})`, searchers)}
`;
  }), `\n`);
  // Searches of the bound tables that the config has stopped declaring, and their functions for each user
  const searchPatterns = config.tables.flatMap(table => users.map(user => sql`(${textLiteral(`${table.name}_%_${user}`.replace(/_/g, "\\_"))}, ${textLiteral(user)})`));
  const currentSearches = searches.flatMap(({ searchers, argument, fn, of }) => [sql`${fn}(${argument})`, ...searchers.map(user => sql`${of(user)}(${argument})`)]);
  const staleSearches = searchPatterns.length === 0 ? sql`` : sql`
-- Searches the config has stopped declaring
do $$
declare
  "the_search" record;
begin
  for "the_search" in
    select "the_function".oid::regprocedure as "function", left("the_function".proname, length("the_function".proname) - length("the_user") - 1) as "public_name", "the_function".proargtypes[0]::regtype as "argument"
    from pg_proc as "the_function"
    join (values ${join(searchPatterns, ", ")}) as "the_pattern" ("pattern", "the_user") on "the_function".proname like "the_pattern"."pattern"
    where "the_function".pronamespace = current_schema()::regnamespace and "the_function".prosecdef and "the_function".proretset
    and "the_function".prorettype = 'tid'::regtype and "the_function".pronargs = 1
    and not "the_function".oid = any (array[${join(currentSearches.map(signature => sql`${textLiteral(compile(signature).text)}::regprocedure`), ", ")}]::oid[])
  loop
    execute format('drop function %s', "the_search"."function");
    if to_regprocedure(format('%I(%s)', "the_search"."public_name", "the_search"."argument")) is not null
      and not to_regprocedure(format('%I(%s)', "the_search"."public_name", "the_search"."argument")) = any (array[${join(currentSearches.map(signature => sql`${textLiteral(compile(signature).text)}::regprocedure`), ", ")}]::oid[]) then
      execute format('drop function %I(%s)', "the_search"."public_name", "the_search"."argument");
    end if;
  end loop;
end
$$;`;

  return sql`
-----------------------------------------------------------------------------------------------------------------------
-- Table policies
-----------------------------------------------------------------------------------------------------------------------
${permissionFunctionSql}
${parentFunctions}
${parentValidate}

${join(config.tables.flatMap(table => {
    const tableNaming = naming.tables[table.name];
    if (!tableNaming) {
      throw new Error(`Table naming config not found for table: ${table.name}`);
    }
    const binding = bindings.get(table.name);
    return config.engine.users.flatMap(user => {
      return (["select", "insert", "update", "delete"] as const).flatMap(operation => {
        const { schema, name, resourceId, permission } = tableNaming;
        const userBits = table.permission?.[user];
        if (!table.isResource || userBits == null || userBits[operation] == null) {
          return [];
        }
        const policyName = (permission as any)[user][operation];
        const dropPolicy = sql`drop policy if exists ${policyName} on ${schema}.${name};`;
        const bit = userBits[operation];
        const insertBit = userBits.insert;
        const parent = binding && hasParent(binding) ? (table.resourceLeaf ? parentOfLeaf(binding, name) : parentOfInPolicy(binding, name)) : undefined;
        // A leaf row has the permissions of its parent. Moving one needs the bit on both parents, since the new row
        // cannot be told apart from an update that keeps its parent.
        const target = table.resourceLeaf ? parent! : sql`${name}.${resourceId}`;
        const ownCheck = accessCheck(target, bit);
        // A new row has no permissions of its own yet: it gets them from its parent, so only a row with a parent can
        // be inserted, by users allowed to insert under that parent
        if (operation === "insert") {
          if (!parent) {
            return [dropPolicy];
          }
          return [sql`
${dropPolicy}
create policy ${policyName} on ${schema}.${name}
as permissive for insert to ${identifier(user)}
with check ((select set_config(${inserting(table)}, statement_timestamp()::text, true)) is not null and ${accessCheck(parent, bit)}
);
`];
        }
        const moveCheck = parent && !table.resourceLeaf && sql`
  and ${resource.parentValidateFunction}(${parent}, ${name}.${resourceId}, ${insertBit == null ? sql`null` : literal(insertBit)})`;
        // Soft deleting a row needs the delete bit. A soft deleted node has left the graph: users who would have the
        // bit once it is restored can still read it and delete it for good, and restore it through the restore function.
        const softDelete = binding?.softDelete;
        const deleteBit = userBits.delete;
        const softDeleteCheck = softDelete && sql`
  and (${name}.${softDelete} is null${deleteBit == null ? sql`` : sql` or ${accessCheck(table.resourceLeaf ? parent! : sql`${name}.${resourceId}`, deleteBit)}`})`;
        const deletedCheck = softDelete && !table.resourceLeaf && operation === "delete" && sql`
  or (${name}.${softDelete} is not null and (${naming.deletedPermissionFunction}(${name}.${resourceId}) << ${literal(bit)})::bit = b'1')`;
        return [sql`
${dropPolicy}
create policy ${policyName} on ${schema}.${name} 
as permissive for ${join([sql``, sql``], operation) /* Yeah it's hacky I know */} to ${identifier(user)} 
using (${operation === "select" ? selectUsing(table, user as User) : sql`${readCheck(table, operation, target, bit)}${deletedCheck || sql``}`}
)
${operation === "update" ? sql`with check (${ownCheck}${moveCheck || sql``}${softDeleteCheck || sql``}
)` : sql``};
`];
      });
    });
  }),
    `\n`)}
    
-----------------------------------------------------------------------------------------------------------------------
-- Enable RLS on tables
-----------------------------------------------------------------------------------------------------------------------
${join(config.tables.flatMap(table => {
      const tableNaming = naming.tables[table.name];
      if (!tableNaming) {
        throw new Error(`Table naming config not found for table: ${table.name}`);
      }
      const { schema, name } = tableNaming;
      if (!table.isResource) {
        return [];
      }
      return [sql`
  alter table ${schema}.${name} enable row level security;
  `];
    }), `\n`)}
-- Views of bits that policies have stopped checking
do $$
declare
  "the_view" text;
begin
  for "the_view" in
    select "viewname" from pg_views where "schemaname" = current_schema()
    and left("viewname", ${literal(nameOf(naming.currentAccessView).length + 1)}) = ${textLiteral(`${nameOf(naming.currentAccessView)}_`)}
    and substr("viewname", ${literal(nameOf(naming.currentAccessView).length + 2)}) ~ '^[0-9]+$'
    and not "viewname" = any (${roleArray(policyBits(config).map(bit => nameOf(currentAccessViewOf(naming, bit))))})
  loop
    execute format('drop function if exists %I', "the_view" || '_check');
    execute format('drop function if exists %I', "the_view" || '_list');
    execute format('drop function if exists %I', "the_view" || '_first');
    execute format('drop view %I', "the_view");
  end loop;
end
$$;

-- Earlier versions mapped any role id, policies have stopped calling it by now
drop function if exists ${currentRoleNodeFunction} (${idType});
${roleLeaves.length === 0 ? sql`drop function if exists ${currentRoleNodeFunction} ();` : sql``}
${searches.length === 0 ? sql`` : sql`
-----------------------------------------------------------------------------------------------------------------------
-- Searches
-----------------------------------------------------------------------------------------------------------------------
${searchSql}`}
${staleSearches}
    `;
}

// Users share a resource by writing its assignments, as the policies of the assignment table allow: with the share
// bit of its table on it, and only bits they have on it. The triggers that keep the caches run as the owner, which
// bypasses these policies.
export const createMigrationSharing = <User extends string>(naming: Naming<User>, config: CompleteConfig<User>) => {
  const { assignment, permissionFunction, shareFunction, unshareFunction } = naming;
  const { type: idType } = getIdType(config);
  const { writers } = getRoles(config);
  const size = config.engine.permission.bitmap.size;
  const bindings = getBindings("resource", naming, config);
  const policyOf = (suffix: string) => identifier(`${nameOf(assignment.edgePolicy)}_${suffix}`);
  const policies = [
    ...(writers.length > 0 ? [nameOf(policyOf("writer"))] : []),
    ...sharers(config).flatMap(user => ["select", "insert", "update", "delete"].map(operation => nameOf(policyOf(`${user}_${operation}`)))),
  ];

  const checkOf = (user: string) => identifier(`${nameOf(shareFunction)}_check_${user}`);

  const sharing = join(sharers(config).map(user => {
    const shareable = bindings.flatMap(binding => {
      const bit = (config.tables.find(table => table.name === binding.tableName)?.permission as Record<string, { share?: number }> | undefined)?.[user]?.share;
      return bit == null ? [] : [sql`
    (exists (select from ${binding.table} as "the_row" where "the_row".${binding.id} = "the_resource_id")
      and exists (select from ${currentAccessViewOf(naming, bit)} as "the_sharer" where "the_sharer".${assignment.resourceId} = "the_resource_id"))`];
    });
    const canShare = sql`${checkOf(user)}(${assignment.edge}.${assignment.resourceId})`;
    // Every bit of the assignment is a bit the user has on the resource
    const withinReach = sql`
  and (${assignment.edge}.${assignment.permission} & ~ ${permissionFunction}(${assignment.edge}.${assignment.resourceId})) = b'0'::bit(${literal(size)})`;
    const role = identifier(user);
    return sql`
-- Whether the current user has the share bit on a resource, through the table of the resource. As the owner, so that
-- the policies of that table do not apply: they would check the select bit, and plan the lookup of one row as a list
-- of every readable row
create or replace function ${checkOf(user)} ("the_resource_id" ${idType})
  returns boolean
  as $$
begin
  return ${join(shareable, ` or`)};
end
$$ language plpgsql stable ${definer(naming)};

${grantExecute(sql`${checkOf(user)} (${idType})`, [user])}

create policy ${policyOf(`${user}_select`)} on ${assignment.edge} as permissive for select to ${role}
using (${canShare});
create policy ${policyOf(`${user}_insert`)} on ${assignment.edge} as permissive for insert to ${role}
with check (${canShare}${withinReach});
create policy ${policyOf(`${user}_update`)} on ${assignment.edge} as permissive for update to ${role}
using (${canShare}${withinReach})
with check (${canShare}${withinReach});
create policy ${policyOf(`${user}_delete`)} on ${assignment.edge} as permissive for delete to ${role}
using (${canShare}${withinReach});
`;
  }), `\n`);

  const stale = join(config.engine.users.filter(user => !sharers(config).includes(user)).map(user => sql`
drop function if exists ${checkOf(user)} (${idType});`), ``);

  const functions = sharers(config).length > 0 ? sql`
-- Gives a role access to a resource, or changes the bits of its assignment, as the policies allow
create or replace function ${shareFunction} ("the_resource_id" ${idType}, "the_role_id" ${idType}, "the_permission" bit(${literal(size)}))
  returns void
  as $$
begin
  insert into ${assignment.edge} (${assignment.resourceId}, ${assignment.roleId}, ${assignment.permission})
  values ("the_resource_id", "the_role_id", "the_permission")
  on conflict (${assignment.resourceId}, ${assignment.roleId}) do update set ${assignment.permission} = excluded.${assignment.permission};
end
$$ language plpgsql volatile security invoker set search_path = ${naming.schema}, pg_temp;

${grantExecute(sql`${shareFunction} (${idType}, ${idType}, bit(${literal(size)}))`, sharers(config))}

-- Removes the assignment of a role on a resource, as the policies allow. False when there was none to remove.
create or replace function ${unshareFunction} ("the_resource_id" ${idType}, "the_role_id" ${idType})
  returns boolean
  as $$
begin
  delete from ${assignment.edge} where ${assignment.resourceId} = "the_resource_id" and ${assignment.roleId} = "the_role_id";
  return found;
end
$$ language plpgsql volatile security invoker set search_path = ${naming.schema}, pg_temp;

${grantExecute(sql`${unshareFunction} (${idType}, ${idType})`, sharers(config))}
` : sql`
drop function if exists ${shareFunction} (${idType}, ${idType}, bit(${literal(size)}));
drop function if exists ${unshareFunction} (${idType}, ${idType});
`;

  return sql`
-----------------------------------------------------------------------------------------------------------------------
-- Sharing
-----------------------------------------------------------------------------------------------------------------------
-- The policies are created again from the config, and those of users who can no longer share are dropped
do $$
declare
  "the_policy" text;
begin
  for "the_policy" in
    select "policyname" from pg_policies where "schemaname" = current_schema() and "tablename" = ${textLiteral(nameOf(assignment.edge))}
    and left("policyname", ${literal(nameOf(assignment.edgePolicy).length + 1)}) = ${textLiteral(`${nameOf(assignment.edgePolicy)}_`)}
  loop
    execute format('drop policy %I on %I', "the_policy", ${textLiteral(nameOf(assignment.edge))});
  end loop;
end
$$;
${writers.length > 0 ? sql`
create policy ${policyOf("writer")} on ${assignment.edge} as permissive for all to ${join(writers.map(writer => identifier(writer)), ", ")}
using (true) with check (true);` : sql``}
${sharing}

-- Without users who share, the privileges keep users out, and roles granted the table by hand read it whole
alter table ${assignment.edge} ${sharers(config).length > 0 ? sql`enable` : sql`disable`} row level security;
${stale}
${functions}
`;
};

// Users restore the soft deleted resources they would have the delete bit on, which they cannot update themselves:
// these rows have left the graph, so the policies give them no access. Tables of a config that stops soft deleting
// get their edges and assignments back.
export const createMigrationSoftDelete = <User extends string>(naming: Naming<User>, config: CompleteConfig<User>) => {
  const { assignment, currentDeletedView, restoreFunction } = naming;
  const { type: idType } = getIdType(config);
  const restoreOf = (user: string) => identifier(`${nameOf(restoreFunction)}_${user}`);
  const restorable = (user: string) => softDeleteBindings("resource", naming, config).flatMap(binding => {
    const bit = (config.tables.find(table => table.name === binding.tableName)?.permission as Record<string, { delete?: number }> | undefined)?.[user]?.delete;
    return bit == null ? [] : [{ binding, bit }];
  });
  const restorers = config.engine.users.filter(user => restorable(user).length > 0);

  const restoreFunctions = join(restorers.map(user => sql`
-- Restores a resource of a table the user has the delete bit on, if the user would have that bit once it is restored.
-- As the owner, which sees the row and is not checked by the policies.
create or replace function ${restoreOf(user)} ("the_resource_id" ${idType})
  returns boolean
  as $$
begin${join(restorable(user).map(({ binding, bit }) => sql`
  update ${binding.table} as "the_row" set ${binding.softDelete!} = null
  where "the_row".${binding.id} = "the_resource_id" and "the_row".${binding.softDelete!} is not null
  and (${naming.deletedPermissionFunction}("the_resource_id") << ${literal(bit)})::bit = b'1';
  if found then
    return true;
  end if;`), ``)}
  return false;
end
$$ language plpgsql volatile ${definer(naming)};

${grantExecute(sql`${restoreOf(user)} (${idType})`, [user])}
`), `\n`);

  const stale = join(config.engine.users.filter(user => !restorers.includes(user)).map(user => sql`
drop function if exists ${restoreOf(user)} (${idType});`), ``);

  const dispatch = restorers.length > 0 ? sql`
-- Restores a soft deleted resource as the user roles of the current user allow. False when none does.
create or replace function ${restoreFunction} ("the_resource_id" ${idType})
  returns boolean
  as $$
begin${join(restorers.map(user => sql`
  if pg_has_role(current_user, ${textLiteral(user)}, 'member') then
    if ${restoreOf(user)}("the_resource_id") then
      return true;
    end if;
  end if;`), ``)}
  return false;
end
$$ language plpgsql volatile security invoker set search_path = ${naming.schema}, pg_temp;

${grantExecute(sql`${restoreFunction} (${idType})`, restorers)}
` : sql`
drop function if exists ${restoreFunction} (${idType});`;

  // The disable functions let the home edges back in, the bootstrap enables the triggers again
  const unused = (table: SQL, target: SQL, columns: SQL, disable: SQL) => sql`
do $$
begin
  if to_regclass(${textLiteral(compile(table).text)}) is not null then
    perform ${disable}();
    insert into ${target} (${columns})
    select ${columns} from ${table}
    on conflict do nothing;
    drop table ${table};
  end if;
end
$$;`;
  const kinds = (["resource", "role"] as const);

  return sql`
-----------------------------------------------------------------------------------------------------------------------
-- Soft delete
-----------------------------------------------------------------------------------------------------------------------
${usesSoftDelete("resource", naming, config) ? sql`` : sql`drop function if exists ${naming.deletedPermissionFunction} (${idType});
drop view if exists ${currentDeletedView};`}
${stale}
${restoreFunctions}
${dispatch}
${join(kinds.filter(kind => !usesSoftDelete(kind, naming, config)).map(kind => {
    const { edge, edgeDeleted, parentId, childId, permission, home, nodeSoftDeleteFunction, nodeRestoreFunction, disableTriggerFunction } = naming[kind];
    return sql`
drop function if exists ${nodeSoftDeleteFunction} (${idType}[]);
drop function if exists ${nodeRestoreFunction} (${idType}[]);
${unused(edgeDeleted, edge, sql`${parentId}, ${childId}, ${permission}, ${home}`, disableTriggerFunction)}`;
  }), `\n`)}
${usesAnySoftDelete(naming, config) ? sql`` : unused(assignment.edgeDeleted, assignment.edge, sql`${assignment.resourceId}, ${assignment.roleId}, ${assignment.permission}`, naming.resource.disableTriggerFunction)}
`;
};

// The bit names of the config, in the order of their positions
const bitNames = (config: CompleteConfig<any>) =>
  Object.entries(config.engine.permission.bitmap.names ?? {}).sort(([, a], [, b]) => a - b);

// The functions of p9s that return the permission flags: the conversion, and the permission fields of PostGraphile
const permissionFlagsFunctions = (naming: Naming<any>, config: CompleteConfig<any>) => [
  nameOf(naming.permissionFlags),
  ...getBindings("resource", naming, config).map(binding => `${binding.tableName}_permission`),
  `${nameOf(naming.resource.node)}_permission`,
  ...viewPermissionColumns(naming).map(([view]) => `${nameOf(view)}_permission`),
];

// The views users read, with their bitmap column
const viewPermissionColumns = (naming: Naming<any>): [SQL, SQL][] => [
  [naming.currentAccessView, naming.assignment.permission],
  [naming.currentAssignmentView, naming.assignment.permission],
  [naming.currentResourceEdgeView, naming.resource.permission],
  [naming.currentRoleView, naming.role.permission],
  [naming.accessView, naming.assignment.permission],
  [naming.roleAccessView, naming.assignment.permission],
  [naming.currentDeletedView, naming.assignment.permission],
];

// With bit names, a type with the bitmap and a boolean per name, and the function that converts a bitmap to it. It is
// created again when the names or the size change, after the functions of p9s that return it; objects of the
// application that use it, like a column of that type, stop the migration
export const createMigrationPermissionFlags = <User extends string>(naming: Naming<User>, config: CompleteConfig<User>) => {
  const { everyone } = getRoles(config);
  const size = config.engine.permission.bitmap.size;
  const flags = naming.permissionFlags;
  const names = bitNames(config);
  const typeName = textLiteral(compile(flags).text);
  const dropDependents = sql`
    for "the_function" in select "oid"::regprocedure from pg_proc
      where "prorettype" = to_regtype(${typeName}) and "proname" = any (${roleArray(permissionFlagsFunctions(naming, config))}) loop
      execute format('drop function %s', "the_function");
    end loop;
    drop type ${flags};`;
  if (names.length === 0) return sql`
-----------------------------------------------------------------------------------------------------------------------
-- Permission flags
-----------------------------------------------------------------------------------------------------------------------
do $$
declare
  "the_function" regprocedure;
begin
  if to_regtype(${typeName}) is not null then${dropDependents}
  end if;
end
$$;
`;
  const attributes = [`bitmap bit(${size})`, ...names.map(([name]) => `${name} boolean`)];
  return sql`
-----------------------------------------------------------------------------------------------------------------------
-- Permission flags
-----------------------------------------------------------------------------------------------------------------------
do $$
declare
  "the_function" regprocedure;
begin
  if to_regtype(${typeName}) is not null and (
    select array_agg("attname"::text || ' ' || format_type("atttypid", "atttypmod") order by "attnum") from pg_attribute
    where "attrelid" = (select "typrelid" from pg_type where "oid" = to_regtype(${typeName})) and "attnum" > 0 and not "attisdropped"
  ) is distinct from ${roleArray(attributes)} then${dropDependents}
  end if;
  if to_regtype(${typeName}) is null then
    create type ${flags} as ("bitmap" bit(${literal(size)}), ${join(names.map(([name]) => sql`${identifier(name)} boolean`), ", ")});
  end if;
end
$$;

-- A bitmap with a boolean per bit name: permission_flags(resource_permission(resource_id))
create or replace function ${flags} ("the_bitmap" bit(${literal(size)}))
  returns ${flags}
  as $$
  select "the_bitmap", ${join(names.map(([name, position]) => sql`get_bit("the_bitmap", ${literal(position)}) = 1 as ${identifier(name)}`), ", ")}
$$ language sql immutable strict parallel safe;

${grantExecute(sql`${flags} (bit)`, everyone)}
`;
};

// The views of p9s are for reading
const readOnly = "@behavior -insert -update -delete";

const camelCase = (name: string) => name.replace(/_+([a-z0-9])/g, (_, letter: string) => letter.toUpperCase());

// One view per tree with the id of every node and the table of its row, for tools that serve nodes, like a GraphQL
// schema. They are security invokers, so that the privileges and policies of each table apply to the user of the
// view, which needs Postgres 15.
export const createMigrationNodeViews = <User extends string>(naming: Naming<User>, config: CompleteConfig<User>) => {
  const { everyone } = getRoles(config);
  const smartComments = config.engine.postgraphile === true;
  const nodeView = (kind: Kind) => naming[kind].node;
  const views = (["resource", "role"] as const).map(kind => {
    const bindings = getBindings(kind, naming, config);
    const view = nodeView(kind);
    if (bindings.length === 0) {
      return sql`
    if exists (select from pg_class where "oid" = to_regclass(${textLiteral(nameOf(view))}) and "relkind" = 'v') then
      drop view ${view};
    end if;`;
    }
    const definition = compile(sql`
create or replace view ${view} with (security_invoker = true) as
${join(bindings.map(binding => sql`select "the_row".${binding.id} as "id", ${textLiteral(binding.tableName)}::text as "table_name" from ${binding.table} as "the_row"`), `
union all
`)}`).text;
    return sql`
    execute ${textLiteral(definition)};
    perform pg_temp.p9s_set_privileges(${textLiteral(compile(view).text)}::regclass, ${roleArray(everyone)}, array[]::text[], array[]::text[]);${smartComments ? sql`
    comment on view ${view} is ${textLiteral([`@primaryKey id`, readOnly, ...bindings.map(binding => `@foreignKey (id) references ${nameOf(naming.tables[binding.tableName]!.schema)}.${binding.tableName} (${nameOf(binding.id)})|@fieldName ${camelCase(binding.tableName)}|@foreignFieldName ${camelCase(nameOf(view))}`)].join("\n"))};` : sql``}`;
  });

  // Keys of the views users read, to the node views
  // PostGraphile reads names without quotes
  const nodeViewName = (kind: Kind) => `${nameOf(naming.schema)}.${nameOf(nodeView(kind))}`;
  const resourceKey = (column: string, field: string) => `@foreignKey (${column}) references ${nodeViewName("resource")} (id)|@fieldName ${field}`;
  const roleKey = (column: string, field: string) => `@foreignKey (${column}) references ${nodeViewName("role")} (id)|@fieldName ${field}`;
  const viewKeys: [SQL, string[]][] = ([
    [naming.currentAccessView, [resourceKey("resource_id", "resource")]],
    [naming.currentAssignmentView, [resourceKey("resource_id", "resource")]],
    [naming.currentResourceEdgeView, [resourceKey("parent_id", "parent"), resourceKey("child_id", "child")]],
    [naming.currentRoleView, [roleKey("role_id", "role")]],
    [naming.accessView, [resourceKey("resource_id", "resource"), roleKey("role_id", "role"), resourceKey("assigned_resource_id", "assignedResource")]],
    [naming.roleAccessView, [resourceKey("resource_id", "resource"), roleKey("role_id", "role")]],
    [naming.currentDeletedView, [resourceKey("resource_id", "resource")]],
  ] as [SQL, string[]][]).map(([view, keys]) => [view, [readOnly, ...keys]]);
  // Every table, view and function p9s names is internal, except the views and functions users call
  const visible = new Set([nodeView("resource"), nodeView("role"), ...viewKeys.map(([view]) => view),
    naming.permissionFunction, naming.shareFunction, naming.unshareFunction, naming.restoreFunction].map(nameOf));
  const namesIn = (names: object, skip: string[]) => Object.entries(names)
    .filter(([key, value]) => !skip.includes(key) && (value as { type?: string } | null)?.type === "IDENTIFIER").map(([, value]) => nameOf(value as SQL));
  const internal = [...new Set([
    ...(["resource", "role", "assignment"] as const).flatMap(kind => namesIn(naming[kind], ["name", "id"])),
    ...Object.values(naming.tables).flatMap(table => namesIn(table, ["name", "schema"])),
    // The lookups of the parents after the first, named after their column
    ...(["resource", "role"] as const).flatMap(kind => getBindings(kind, naming, config).flatMap(binding => binding.parents.map(parent => nameOf(parent.function)))),
    nameOf(naming.orBitmap), nameOf(naming.truncateGuardFunction), nameOf(naming.currentRoleNodeFunction), nameOf(naming.deletedPermissionFunction),
    // The conversion of bitmaps, for SQL: the API has its result in the permission fields
    nameOf(naming.permissionFlags),
    ...policyBits(config).flatMap(bit => [currentAccessViewOf, currentAccessCheckOf, currentAccessListOf, currentAccessFirstOf].map(of => nameOf(of(naming, bit)))),
    ...config.engine.users.map(user => `${nameOf(naming.shareFunction)}_check_${user}`),
    ...config.engine.users.map(user => `${nameOf(naming.restoreFunction)}_${user}`),
    ...config.tables.flatMap(table => Object.keys(table.search ?? {}).flatMap(key => config.engine.users.map(user => `${table.name}_${key}_${user}`))),
  ])].filter(name => !visible.has(name));
  // PostGraphile skips overloaded functions, like resource_permission: it reads the permissions of the current user on
  // each row through these, as a permission field of each resource type. With bit names, the field has a boolean per
  // name, and the bitmap
  const size = config.engine.permission.bitmap.size;
  const withFlags = bitNames(config).length > 0;
  const returned = withFlags ? naming.permissionFlags : sql`bit(${literal(size)})`;
  const permissionOf = (id: SQL) => withFlags ? sql`${naming.permissionFlags}(${naming.permissionFunction}(${id}))` : sql`${naming.permissionFunction}(${id})`;
  // A function cannot change its return type, as when bit names are added or removed
  const dropIfReturnsOther = (field: SQL, argument: SQL) => sql`
do $$
begin
  if exists (select from pg_proc where "oid" = to_regprocedure(${textLiteral(`${compile(field).text}(${compile(argument).text})`)}) and "prorettype" <> ${textLiteral(withFlags ? compile(naming.permissionFlags).text : "bit")}::regtype) then
    drop function ${field} (${argument});
  end if;
end
$$;`;
  const permissionFields = getBindings("resource", naming, config).map(binding => {
    const field = identifier(`${binding.tableName}_permission`);
    return smartComments ? sql`${dropIfReturnsOther(field, binding.table)}
create or replace function ${field} ("the_row" ${binding.table})
  returns ${returned}
  as $$
  select ${permissionOf(sql`"the_row".${binding.id}`)}
$$ language sql stable set search_path = ${naming.schema}, pg_temp;

${grantExecute(sql`${field} (${binding.table})`, everyone)}
` : sql`
drop function if exists ${field} (${binding.table});`;
  });
  const nodePermissionField = identifier(`${nameOf(nodeView("resource"))}_permission`);
  const nodePermission = compile(sql`
create or replace function ${nodePermissionField} ("the_row" ${nodeView("resource")})
  returns ${returned}
  as $p9s$
  select ${permissionOf(sql`"the_row"."id"`)}
$p9s$ language sql stable set search_path = ${naming.schema}, pg_temp`).text;
  const nodePermissionSignature = textLiteral(`${compile(nodePermissionField).text}(${compile(nodeView("resource")).text})`);
  // With bit names, the bitmap columns of the views users read are hidden, for a permission field with the flags
  const viewPermissions = viewPermissionColumns(naming).map(([view, column]) => {
    const field = identifier(`${nameOf(view)}_permission`);
    const signature = textLiteral(`${compile(field).text}(${compile(view).text})`);
    const create = compile(sql`
create or replace function ${field} ("the_row" ${view})
  returns ${naming.permissionFlags}
  as $p9s$
  select ${naming.permissionFlags}("the_row".${column})
$p9s$ language sql stable set search_path = ${naming.schema}, pg_temp`).text;
    return sql`
  if to_regclass(${textLiteral(compile(view).text)}) is not null then${smartComments && withFlags ? sql`
    execute ${textLiteral(create)};
    revoke execute on function ${field} (${view}) from public;${join(everyone.map(role => sql`
    grant execute on function ${field} (${view}) to ${identifier(role)};`), ``)}
    comment on column ${view}.${column} is '@behavior -*';` : sql`
    if to_regprocedure(${signature}) is not null then
      execute ${textLiteral(`drop function ${compile(field).text} (${compile(view).text})`)};
    end if;${smartComments ? sql`
    comment on column ${view}.${column} is null;` : sql``}`}
  end if;`;
  });

  const comments = smartComments ? sql`
-- Smart comments for PostGraphile. Internal objects are hidden from the GraphQL schema, whatever their privileges
create or replace function pg_temp.p9s_comment_relation(target text, comment text)
returns void as $$
declare
  "the_kind" "char" := (select "relkind" from pg_class where "oid" = to_regclass(target));
begin
  if "the_kind" in ('r', 'p', 'v') then
    execute format('comment on %s %s is %L', case "the_kind" when 'v' then 'view' else 'table' end, to_regclass(target), comment);
  end if;
end;
$$ language plpgsql;

create or replace function pg_temp.p9s_comment_functions(target text, comment text)
returns void as $$
declare
  "the_function" regprocedure;
begin
  for "the_function" in select "oid"::regprocedure from pg_proc where "proname" = target and "pronamespace" = current_schema()::regnamespace loop
    execute format('comment on %s %s is %L', case when (select "prokind" from pg_proc where "oid" = "the_function") = 'a' then 'aggregate' else 'function' end, "the_function", comment);
  end loop;
end;
$$ language plpgsql;

select pg_temp.p9s_comment_relation(quote_ident("the_name"), '@behavior -*'), pg_temp.p9s_comment_functions("the_name", '@behavior -*')
from unnest(${roleArray(internal)}) as "the_name";
` : sql``;

  return sql`
-----------------------------------------------------------------------------------------------------------------------
-- Views of all nodes
-----------------------------------------------------------------------------------------------------------------------
${comments}
${join(permissionFields, ``)}
do $$
begin
  if current_setting('server_version_num')::int >= 150000 then${join(views, ``)}${smartComments ? sql`${join(viewKeys.map(([view, keys]) => sql`
    perform pg_temp.p9s_comment_relation(${textLiteral(compile(view).text)}, ${textLiteral(keys.join("\n"))});`), ``)}${getBindings("resource", naming, config).length > 0 ? sql`
    if exists (select from pg_proc where "oid" = to_regprocedure(${nodePermissionSignature}) and "prorettype" <> ${textLiteral(withFlags ? compile(naming.permissionFlags).text : "bit")}::regtype) then
      execute ${textLiteral(`drop function ${compile(nodePermissionField).text} (${compile(nodeView("resource")).text})`)};
    end if;
    execute ${textLiteral(nodePermission)};
    revoke execute on function ${nodePermissionField} (${nodeView("resource")}) from public;${join(everyone.map(role => sql`
    grant execute on function ${nodePermissionField} (${nodeView("resource")}) to ${identifier(role)};`), ``)}` : sql``}` : sql`
    if to_regclass(${textLiteral(compile(nodeView("resource")).text)}) is not null then
      drop function if exists ${nodePermissionField} (${nodeView("resource")});
    end if;`}
  end if;${join(viewPermissions, ``)}
end
$$;
`;
};
