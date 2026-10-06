import { query as sql, identifier, join, raw, type SQL } from "pg-sql2";
import { generateUuidFromInteger } from "@p9s/core-testing";
import { createMigration } from "../generation";

export type CombineMode = "none" | "role" | "resource";
export type IdMode = "integer" | "uuid";
export type Kind = "resource" | "role";

export const combineModes: CombineMode[] = ["none", "role", "resource"];
export const idModes: IdMode[] = ["integer", "uuid"];

export const BITMAP_SIZE = 4;
export const OPERATION_BITS = { select: 0, insert: 1, update: 2, delete: 3 } as const;

export interface TestContext {
  runTestQuery: (query: SQL) => Promise<any[]>;
  exec: (query: SQL) => Promise<any[]>;
  database_admin_username: string;
  database_user_username: string;
  database_writer_username: string;
}

export type ResourceCacheMode = "full" | "assigned";
export const resourceCacheModes: ResourceCacheMode[] = ["full", "assigned"];
// Runs the suites that do not set it with another resource cache
export const defaultResourceCache = (process.env.P9S_TEST_RESOURCE_CACHE ?? "full") as ResourceCacheMode;

export interface BlogOptions {
  combineAssignmentsWith?: CombineMode;
  idMode?: IdMode;
  resourceCache?: ResourceCacheMode;
}

// Groups are the nodes the graph tests wire together. Posts live in a resource group, through their group_id column.
export const blogMigrationConfig = (ctx: TestContext, { combineAssignmentsWith = "none", idMode = "integer", resourceCache = defaultResourceCache }: BlogOptions = {}) => ({
  engine: {
    permission: { bitmap: { size: BITMAP_SIZE }, maxDepth: { resource: 32, role: 32 } },
    authentication: { getCurrentUserId: "current_role_id" },
    combineAssignmentsWith,
    resourceCache,
    id: { mode: idMode },
    users: [ctx.database_user_username],
    graphWriters: [ctx.database_writer_username],
  },
  tables: [{
    name: "resource_group",
    isResource: true,
    resourceId: "id",
    resourceParent: { column: "parent_id" },
  }, {
    name: "role_group",
    isRole: true,
    roleId: "id",
    roleParent: { column: "parent_id" },
  }, {
    name: "blog_post",
    isResource: true,
    resourceId: "resource_id",
    resourceParent: { column: "group_id" },
    permission: { [ctx.database_user_username]: { ...OPERATION_BITS } },
  }, {
    // Comments are leaves: they have the permissions of their post, and are not nodes themselves
    name: "blog_comment",
    isResource: true,
    resourceLeaf: true,
    resourceParent: { column: "post_id", table: "blog_post", key: "id" },
    permission: { [ctx.database_user_username]: { ...OPERATION_BITS } },
  }, {
    // API keys are role leaves: a key acts with the permissions of its group, and is not a node itself
    name: "api_key",
    isRole: true,
    roleId: "role_id",
    roleLeaf: true,
    roleParent: { column: "group_id" },
  }],
});

// Explicit group ids in tests stay below the ids p9s gives to new rows
export const FIRST_GENERATED_ID = 1000000;

export const setupBlogTables = async (ctx: TestContext, { idMode = "integer" }: BlogOptions = {}) => {
  const idType = idMode === "uuid" ? sql`uuid` : sql`integer`;
  const user = identifier(ctx.database_user_username);
  await ctx.exec(sql`
    create extension if not exists "uuid-ossp";
    create table "resource_group" ("id" ${idType} primary key, "parent_id" ${idType} references "resource_group" ("id") on delete set null);
    create table "role_group" ("id" ${idType} primary key, "parent_id" ${idType} references "role_group" ("id") on delete set null);
    create table "blog_post" ("id" serial primary key, "name" text not null default '', "group_id" ${idType} references "resource_group" ("id") on delete cascade);
    create index on "resource_group" ("parent_id");
    create index on "role_group" ("parent_id");
    create table "blog_comment" ("id" serial primary key, "body" text not null default '', "post_id" integer references "blog_post" ("id") on delete cascade);
    create index on "blog_post" ("group_id");
    create index on "blog_comment" ("post_id");
    create table "api_key" ("id" serial primary key, "group_id" ${idType} references "role_group" ("id") on delete cascade);
    grant select, insert, update, delete on table "blog_post", "blog_comment" to ${user};
    grant usage on sequence "blog_post_id_seq", "blog_comment_id_seq" to ${user};
    create function "current_role_id"() returns ${idType} as $$
      select nullif(current_setting('jwt.claims.role_id', true), '')::${idType}
    $$ language sql stable;
  `);
};

// Business tables with RLS, the current role id function, and the p9s migration on top
export const setupBlog = async (ctx: TestContext, options: BlogOptions = {}) => {
  await setupBlogTables(ctx, options);
  await ctx.exec(createMigration(blogMigrationConfig(ctx, options)));
  if (options.idMode !== "uuid") {
    await ctx.exec(sql`
      select setval('resource_id_seq', ${raw(String(FIRST_GENERATED_ID))});
      select setval('role_id_seq', ${raw(String(FIRST_GENERATED_ID))});`);
  }
};

export const groupTable = (kind: Kind) => identifier(`${kind}_group`);

export const nodeId = (idMode: IdMode, n: number): SQL =>
  idMode === "uuid" ? raw(`'${generateUuidFromInteger(n)}'::uuid`) : raw(String(n));

export const fromNodeId = (value: number | string): number =>
  typeof value === "number" ? value : parseInt(value.replace(/-/g, ""), 16);

export const bits = (value: string): SQL => raw(`b'${value}'::bit(${BITMAP_SIZE})`);

// Runs statements as the given role in a single transaction, with the given p9s role id as the current user
export const as = (ctx: TestContext, role: string, statement: SQL, currentRoleId?: SQL) =>
  ctx.runTestQuery(sql`set local role ${identifier(role)}; ${currentRoleId ? sql`select set_config('jwt.claims.role_id', (${currentRoleId})::text, true);` : sql``} ${statement}`)
    .then(results => results.at(-1) as any[]);

export const createRandom = (seed: number) => {
  let state = seed >>> 0;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    bits: (probabilityOfOne = 0.7) => Array.from({ length: BITMAP_SIZE }, () => (next() < probabilityOfOne ? "1" : "0")).join(""),
    pick: <T>(items: T[]): T | undefined => items[Math.floor(next() * items.length)],
  };
};
export type Random = ReturnType<typeof createRandom>;


// Home edges are the ones p9s keeps in sync with the parent column of their child
export interface Edge { parent: number; child: number; bits: string; home?: boolean }
export interface Assignment { resource: number; role: number; bits: string }

export interface Graph {
  size: { resource: number; role: number };
  edges: { resource: Map<string, Edge>; role: Map<string, Edge> };
  parents: { resource: Map<number, number>; role: Map<number, number> };
  assignments: Map<string, Assignment>;
}

export const emptyGraph = (resources: number, roles: number): Graph => ({
  size: { resource: resources, role: roles },
  edges: { resource: new Map(), role: new Map() },
  parents: { resource: new Map(), role: new Map() },
  assignments: new Map(),
});

const edgeKey = (parent: number, child: number) => `${parent}:${child}`;
const ONES = "1".repeat(BITMAP_SIZE);

// Applies every graph change to both the database and an in-memory mirror. Edges and assignments are written by the
// graph writer role, groups by their owner.
export const createGraphDriver = (ctx: TestContext, idMode: IdMode, graph: Graph) => {
  const id = (n: number) => nodeId(idMode, n);
  const writer = (statement: SQL) => as(ctx, ctx.database_writer_username, statement);

  const edgeTable = (kind: Kind) => identifier(`${kind}_edge`);
  const edgeWhere = (edge: Edge) => sql`"parent_id" = ${id(edge.parent)} and "child_id" = ${id(edge.child)}`;
  // Any client change to a home edge makes it a regular edge
  const claimed = (edge: Edge): Edge => ({ ...edge, home: false });

  return {
    graph,
    createNodes: async () => {
      for (const kind of ["resource", "role"] as const) {
        const ids = join(Array.from({ length: graph.size[kind] }, (_, i) => sql`(${id(i + 1)})`), ", ");
        await ctx.exec(sql`insert into ${groupTable(kind)} ("id") values ${ids}`);
      }
    },
    insertEdge: async (kind: Kind, parent: number, child: number, value: string) => {
      if (graph.edges[kind].has(edgeKey(parent, child))) return;
      await writer(sql`insert into ${edgeTable(kind)} ("parent_id", "child_id", "permission") values (${id(parent)}, ${id(child)}, ${bits(value)})`);
      graph.edges[kind].set(edgeKey(parent, child), { parent, child, bits: value });
    },
    // A home edge has to be claimed before it can be deleted
    deleteEdge: async (kind: Kind, edge: Edge) => {
      await writer(sql`${edge.home ? sql`update ${edgeTable(kind)} set "home" = false where ${edgeWhere(edge)};` : sql``}
        delete from ${edgeTable(kind)} where ${edgeWhere(edge)}`);
      graph.edges[kind].delete(edgeKey(edge.parent, edge.child));
    },
    claimEdge: async (kind: Kind, edge: Edge) => {
      await writer(sql`update ${edgeTable(kind)} set "home" = false where ${edgeWhere(edge)}`);
      graph.edges[kind].set(edgeKey(edge.parent, edge.child), claimed(edge));
    },
    updateEdgeBits: async (kind: Kind, edge: Edge, value: string) => {
      await writer(sql`update ${edgeTable(kind)} set "permission" = ${bits(value)} where ${edgeWhere(edge)}`);
      graph.edges[kind].set(edgeKey(edge.parent, edge.child), { ...claimed(edge), bits: value });
    },
    // Batches change several edges in a single statement, so the triggers see them all at once
    insertEdges: async (kind: Kind, edges: Edge[]) => {
      const fresh = [...new Map(edges.map(edge => [edgeKey(edge.parent, edge.child), edge])).values()]
        .filter(edge => !graph.edges[kind].has(edgeKey(edge.parent, edge.child)));
      if (fresh.length === 0) return;
      const rows = join(fresh.map(edge => sql`(${id(edge.parent)}, ${id(edge.child)}, ${bits(edge.bits)})`), ", ");
      await writer(sql`insert into ${edgeTable(kind)} ("parent_id", "child_id", "permission") values ${rows}`);
      for (const edge of fresh) graph.edges[kind].set(edgeKey(edge.parent, edge.child), edge);
    },
    deleteEdges: async (kind: Kind, edges: Edge[]) => {
      const keys = join(edges.map(edge => sql`(${id(edge.parent)}, ${id(edge.child)})`), ", ");
      await writer(sql`
        update ${edgeTable(kind)} set "home" = false where "home" and ("parent_id", "child_id") in (${keys});
        delete from ${edgeTable(kind)} where ("parent_id", "child_id") in (${keys})`);
      for (const edge of edges) graph.edges[kind].delete(edgeKey(edge.parent, edge.child));
    },
    updateEdgesBits: async (kind: Kind, edges: Edge[]) => {
      const rows = join(edges.map(edge => sql`(${id(edge.parent)}, ${id(edge.child)}, ${bits(edge.bits)})`), ", ");
      await writer(sql`
        update ${edgeTable(kind)} as "the_edge" set "permission" = "the_value"."permission"
        from (values ${rows}) as "the_value" ("parent_id", "child_id", "permission")
        where "the_edge"."parent_id" = "the_value"."parent_id" and "the_edge"."child_id" = "the_value"."child_id"`);
      for (const edge of edges) graph.edges[kind].set(edgeKey(edge.parent, edge.child), claimed(edge));
    },
    moveEdge: async (kind: Kind, edge: Edge, parent: number) => {
      if (graph.edges[kind].has(edgeKey(parent, edge.child))) return;
      await writer(sql`update ${edgeTable(kind)} set "parent_id" = ${id(parent)} where ${edgeWhere(edge)}`);
      graph.edges[kind].delete(edgeKey(edge.parent, edge.child));
      graph.edges[kind].set(edgeKey(parent, edge.child), { ...claimed(edge), parent });
    },
    // The home edge follows the column. An existing edge from the new parent is kept as it is instead.
    setParent: async (kind: Kind, child: number, parent: number | undefined) => {
      if (graph.parents[kind].get(child) === parent) return;
      await ctx.exec(sql`update ${groupTable(kind)} set "parent_id" = ${parent === undefined ? sql`null` : id(parent)} where "id" = ${id(child)}`);
      setParentInMirror(graph, kind, child, parent);
    },
    insertAssignment: async (resource: number, role: number, value: string) => {
      if (graph.assignments.has(edgeKey(resource, role))) return;
      await writer(sql`insert into "assignment_edge" ("resource_id", "role_id", "permission") values (${id(resource)}, ${id(role)}, ${bits(value)})`);
      graph.assignments.set(edgeKey(resource, role), { resource, role, bits: value });
    },
    deleteAssignment: async (assignment: Assignment) => {
      await writer(sql`delete from "assignment_edge" where "resource_id" = ${id(assignment.resource)} and "role_id" = ${id(assignment.role)}`);
      graph.assignments.delete(edgeKey(assignment.resource, assignment.role));
    },
    updateAssignmentBits: async (assignment: Assignment, value: string) => {
      await writer(sql`update "assignment_edge" set "permission" = ${bits(value)} where "resource_id" = ${id(assignment.resource)} and "role_id" = ${id(assignment.role)}`);
      graph.assignments.set(edgeKey(assignment.resource, assignment.role), { ...assignment, bits: value });
    },
    // Deleting a group removes its edges and assignments, and orphans its children. It is then recreated empty.
    resetNode: async (kind: Kind, n: number) => {
      await ctx.exec(sql`delete from ${groupTable(kind)} where "id" = ${id(n)}`);
      await ctx.exec(sql`insert into ${groupTable(kind)} ("id") values (${id(n)})`);
      for (const [key, edge] of graph.edges[kind]) {
        if (edge.parent === n || edge.child === n) graph.edges[kind].delete(key);
      }
      for (const [child, parent] of graph.parents[kind]) {
        if (child === n || parent === n) graph.parents[kind].delete(child);
      }
      for (const [key, assignment] of graph.assignments) {
        if (assignment[kind] === n) graph.assignments.delete(key);
      }
    },
  };
};
export type GraphDriver = ReturnType<typeof createGraphDriver>;

const setParentInMirror = (graph: Graph, kind: Kind, child: number, parent: number | undefined) => {
  const edges = graph.edges[kind];
  for (const [key, edge] of edges) {
    if (edge.child === child && edge.home && edge.parent !== parent) edges.delete(key);
  }
  if (parent !== undefined && !edges.has(edgeKey(parent, child))) {
    edges.set(edgeKey(parent, child), { parent, child, bits: ONES, home: true });
  }
  if (parent === undefined) graph.parents[kind].delete(child);
  else graph.parents[kind].set(child, parent);
};

// Edges always point from a lower to a higher id, which keeps the graph acyclic
export const randomOperation = async (driver: GraphDriver, random: Random, { allowNodeReset = true } = {}): Promise<string> => {
  const { graph } = driver;
  const kind: Kind = random.next() < 0.5 ? "resource" : "role";
  const size = graph.size[kind];
  const edges = [...graph.edges[kind].values()];
  const assignments = [...graph.assignments.values()];
  const roll = random.next();

  if (roll < 0.32 || edges.length === 0) {
    const a = random.int(1, size), b = random.int(1, size);
    if (a === b) return "noop";
    const [parent, child] = a < b ? [a, b] : [b, a];
    const value = random.bits();
    await driver.insertEdge(kind, parent, child, value);
    return `insert ${kind} edge ${parent}->${child} ${value}`;
  }
  if (roll < 0.4) {
    const child = random.int(2, size);
    const parent = random.next() < 0.2 ? undefined : random.int(1, child - 1);
    await driver.setParent(kind, child, parent);
    return `set ${kind} ${child} parent to ${parent ?? "null"}`;
  }
  if (roll < 0.47) {
    const edge = random.pick(edges)!;
    await driver.deleteEdge(kind, edge);
    return `delete ${kind} edge ${edge.parent}->${edge.child}`;
  }
  if (roll < 0.53) {
    const edge = random.pick(edges)!;
    const value = random.bits();
    await driver.updateEdgeBits(kind, edge, value);
    return `update ${kind} edge ${edge.parent}->${edge.child} ${value}`;
  }
  if (roll < 0.6) {
    const edge = random.pick(edges)!;
    if (edge.child <= 1) return "noop";
    const parent = random.int(1, edge.child - 1);
    await driver.moveEdge(kind, edge, parent);
    return `move ${kind} edge ${edge.parent}->${edge.child} to parent ${parent}`;
  }
  if (roll < 0.63) {
    const edge = random.pick(edges.filter(edge => edge.home));
    if (!edge) return "noop";
    await driver.claimEdge(kind, edge);
    return `claim ${kind} edge ${edge.parent}->${edge.child}`;
  }
  if (roll < 0.8 || assignments.length === 0) {
    const resource = random.int(1, graph.size.resource), role = random.int(1, graph.size.role);
    const value = random.bits(0.8);
    await driver.insertAssignment(resource, role, value);
    return `insert assignment resource ${resource} role ${role} ${value}`;
  }
  if (roll < 0.86) {
    const assignment = random.pick(assignments)!;
    await driver.deleteAssignment(assignment);
    return `delete assignment resource ${assignment.resource} role ${assignment.role}`;
  }
  if (roll < 0.97 || !allowNodeReset) {
    const assignment = random.pick(assignments)!;
    const value = random.bits(0.8);
    await driver.updateAssignmentBits(assignment, value);
    return `update assignment resource ${assignment.resource} role ${assignment.role} ${value}`;
  }
  const n = random.int(1, size);
  await driver.resetNode(kind, n);
  return `reset ${kind} node ${n}`;
};


// Changes several edges in one statement. Edges go in any direction, so the graph gets cycles.
export const randomBatchOperation = async (driver: GraphDriver, random: Random): Promise<string> => {
  const { graph } = driver;
  const kind: Kind = random.next() < 0.5 ? "resource" : "role";
  const size = graph.size[kind];
  const edges = [...graph.edges[kind].values()];
  const count = random.int(2, 5);
  const describe = (batch: Edge[]) => batch.map(edge => `${edge.parent}->${edge.child} ${edge.bits}`).join(", ");
  const roll = random.next();

  // On a dense graph with cycles the number of paths explodes, and so does the from-scratch recompute of the check
  if ((roll < 0.5 && edges.length < 2 * size) || edges.length < count) {
    const batch: Edge[] = [];
    for (let i = 0; i < count; i++) {
      const parent = random.int(1, size), child = random.int(1, size);
      if (parent !== child) batch.push({ parent, child, bits: random.bits() });
    }
    await driver.insertEdges(kind, batch);
    return `insert ${kind} edges ${describe(batch)}`;
  }
  const batch: Edge[] = [];
  const remaining = [...edges];
  for (let i = 0; i < count; i++) {
    batch.push(...remaining.splice(random.int(0, remaining.length - 1), 1));
  }
  if (roll < 0.75) {
    await driver.deleteEdges(kind, batch);
    return `delete ${kind} edges ${describe(batch)}`;
  }
  const updated = batch.map(edge => ({ ...edge, bits: random.bits() }));
  await driver.updateEdgesBits(kind, updated);
  return `update ${kind} edges ${describe(updated)}`;
};


// Reference model: a role has a bit on a resource iff some path
// resource ancestor -> assignment -> role ancestor has that bit set on every edge
export const createPermissionModel = (graph: Graph) => {
  const descendantsOrSelf = (edges: Iterable<Edge>, size: number, bit: number) => {
    const children = new Map<number, number[]>();
    for (const edge of edges) {
      if (edge.bits[bit] !== "1") continue;
      children.set(edge.parent, [...(children.get(edge.parent) ?? []), edge.child]);
    }
    const result = new Map<number, Set<number>>();
    for (let start = 1; start <= size; start++) {
      const seen = new Set([start]);
      const stack = [start];
      while (stack.length > 0) {
        for (const child of children.get(stack.pop()!) ?? []) {
          if (!seen.has(child)) { seen.add(child); stack.push(child); }
        }
      }
      result.set(start, seen);
    }
    return result;
  };

  const perBit = Array.from({ length: BITMAP_SIZE }, (_, bit) => ({
    resource: descendantsOrSelf(graph.edges.resource.values(), graph.size.resource, bit),
    role: descendantsOrSelf(graph.edges.role.values(), graph.size.role, bit),
  }));

  return {
    allowed: (role: number, resource: number, bit: number) => {
      const closure = perBit[bit]!;
      for (const assignment of graph.assignments.values()) {
        if (assignment.bits[bit] !== "1") continue;
        if (closure.resource.get(assignment.resource)!.has(resource) && closure.role.get(assignment.role)!.has(role)) return true;
      }
      return false;
    },
  };
};


// Number of rows that differ between each cache and the view that recomputes it from scratch
export const cacheMismatches = async (ctx: TestContext, combineAssignmentsWith: CombineMode) => {
  const diff = async (table: string, columns: string[]) => {
    const cols = raw(columns.map(column => `"${column}"`).join(", "));
    const cache = identifier(table), view = identifier(`${table}_view`);
    // The planner estimates the from-scratch views far above the JIT thresholds, and on servers built with LLVM
    // compiling this query every time takes longer than the rest of the test
    const [, rows] = await ctx.runTestQuery(sql`
      set jit = off;
      select count(*)::int as "n" from (
        (select ${cols} from ${cache} except all select ${cols} from ${view})
        union all
        (select ${cols} from ${view} except all select ${cols} from ${cache})
      ) as "the_diff";
      reset jit;`);
    return rows[0].n as number;
  };
  return {
    resource: await diff("resource_edge_cache", ["parent_id", "child_id", "permission"]),
    role: await diff("role_edge_cache", ["parent_id", "child_id", "permission"]),
    assignment: combineAssignmentsWith === "none" ? 0 : await diff("assignment_edge_cache", ["role_id", "resource_id", "permission"]),
  };
};

export const noMismatches = { resource: 0, role: 0, assignment: 0 };

// With resourceCache "assigned", the rows of the full closure whose ancestor is the descendant itself or has assignments
export const assignedCacheMismatches = async (ctx: TestContext) => {
  const [, rows] = await ctx.runTestQuery(sql`
    set jit = off;
    with "expected" as (
      select "the_closure".* from (select "id" from "resource_group" union all select "resource_id" from "blog_post") as "the_node",
        lateral "resource_edge_cache_parent_compute" ("the_node"."id") as "the_closure"
      where "the_closure"."parent_id" = "the_closure"."child_id"
      or exists (select from "assignment_edge" where "assignment_edge"."resource_id" = "the_closure"."parent_id")
    )
    select count(*)::int as "n" from (
      (select "parent_id", "child_id", "permission" from "resource_edge_cache" except all select "parent_id", "child_id", "permission" from "expected")
      union all
      (select "parent_id", "child_id", "permission" from "expected" except all select "parent_id", "child_id", "permission" from "resource_edge_cache")
    ) as "the_diff";
    reset jit;`);
  return rows[0].n as number;
};

// Edges in the database that differ from the mirror, home flag included
export const edgeMismatches = async (ctx: TestContext, graph: Graph) => {
  const describe = (edge: Edge) => `${edge.parent}->${edge.child} ${edge.bits}${edge.home ? " home" : ""}`;
  const result: Record<Kind, string[]> = { resource: [], role: [] };
  for (const kind of ["resource", "role"] as const) {
    const [rows] = await ctx.runTestQuery(sql`select "parent_id", "child_id", "permission", "home" from ${identifier(`${kind}_edge`)}`);
    const actual = new Set<string>(rows.map((row: any) => describe({ parent: fromNodeId(row.parent_id), child: fromNodeId(row.child_id), bits: row.permission, home: row.home })));
    const expected = new Set([...graph.edges[kind].values()].map(describe));
    result[kind] = [...[...actual].filter(edge => !expected.has(edge)).map(edge => `unexpected ${edge}`), ...[...expected].filter(edge => !actual.has(edge)).map(edge => `missing ${edge}`)];
  }
  return result;
};
