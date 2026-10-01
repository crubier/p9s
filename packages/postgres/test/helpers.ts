import { query as sql, identifier, raw, type SQL } from "pg-sql2";
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

export interface BlogOptions {
  combineAssignmentsWith?: CombineMode;
  idMode?: IdMode;
}

export const blogMigrationConfig = (ctx: TestContext, { combineAssignmentsWith = "none", idMode = "integer" }: BlogOptions = {}) => ({
  engine: {
    permission: { bitmap: { size: BITMAP_SIZE }, maxDepth: { resource: 32, role: 32 } },
    authentication: { getCurrentUserId: "current_role_id" },
    combineAssignmentsWith,
    id: { mode: idMode },
    users: [ctx.database_user_username],
    graphWriters: [ctx.database_writer_username],
  },
  tables: [{
    name: "blog_post",
    isResource: true,
    resourceId: "resource_id",
    permission: { [ctx.database_user_username]: { ...OPERATION_BITS } },
  }],
});

// A business table with RLS, the current role id function, and the p9s migration on top
export const setupBlog = async (ctx: TestContext, options: BlogOptions = {}) => {
  const idType = options.idMode === "uuid" ? sql`uuid` : sql`integer`;
  const user = identifier(ctx.database_user_username);
  await ctx.exec(sql`
    create extension if not exists "uuid-ossp";
    create table "blog_post" ("id" serial primary key, "name" text not null default '');
    grant select, insert, update, delete on table "blog_post" to ${user};
    grant usage on sequence "blog_post_id_seq" to ${user};
    create function "current_role_id"() returns ${idType} as $$
      select nullif(current_setting('jwt.claims.role_id', true), '')::${idType}
    $$ language sql stable;
  `);
  await ctx.exec(createMigration(blogMigrationConfig(ctx, options)));
};

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


export interface Edge { parent: number; child: number; bits: string }
export interface Assignment { resource: number; role: number; bits: string }

export interface Graph {
  size: { resource: number; role: number };
  edges: { resource: Map<string, Edge>; role: Map<string, Edge> };
  assignments: Map<string, Assignment>;
}

export const emptyGraph = (resources: number, roles: number): Graph => ({
  size: { resource: resources, role: roles },
  edges: { resource: new Map(), role: new Map() },
  assignments: new Map(),
});

const edgeKey = (parent: number, child: number) => `${parent}:${child}`;

// Applies every graph change to both the database (as the graph writer role) and an in-memory mirror
export const createGraphDriver = (ctx: TestContext, idMode: IdMode, graph: Graph) => {
  const id = (n: number) => nodeId(idMode, n);
  const writer = (statement: SQL) => as(ctx, ctx.database_writer_username, statement);

  const edgeTable = (kind: Kind) => identifier(`${kind}_edge`);
  const nodeTable = (kind: Kind) => identifier(`${kind}_node`);

  return {
    graph,
    createNodes: async () => {
      for (const kind of ["resource", "role"] as const) {
        for (let n = 1; n <= graph.size[kind]; n++) {
          await writer(sql`insert into ${nodeTable(kind)} ("id") values (${id(n)})`);
        }
      }
    },
    insertEdge: async (kind: Kind, parent: number, child: number, value: string) => {
      if (graph.edges[kind].has(edgeKey(parent, child))) return;
      await writer(sql`insert into ${edgeTable(kind)} ("parent_id", "child_id", "permission") values (${id(parent)}, ${id(child)}, ${bits(value)})`);
      graph.edges[kind].set(edgeKey(parent, child), { parent, child, bits: value });
    },
    deleteEdge: async (kind: Kind, edge: Edge) => {
      await writer(sql`delete from ${edgeTable(kind)} where "parent_id" = ${id(edge.parent)} and "child_id" = ${id(edge.child)}`);
      graph.edges[kind].delete(edgeKey(edge.parent, edge.child));
    },
    updateEdgeBits: async (kind: Kind, edge: Edge, value: string) => {
      await writer(sql`update ${edgeTable(kind)} set "permission" = ${bits(value)} where "parent_id" = ${id(edge.parent)} and "child_id" = ${id(edge.child)}`);
      graph.edges[kind].set(edgeKey(edge.parent, edge.child), { ...edge, bits: value });
    },
    moveEdge: async (kind: Kind, edge: Edge, parent: number) => {
      if (graph.edges[kind].has(edgeKey(parent, edge.child))) return;
      await writer(sql`update ${edgeTable(kind)} set "parent_id" = ${id(parent)} where "parent_id" = ${id(edge.parent)} and "child_id" = ${id(edge.child)}`);
      graph.edges[kind].delete(edgeKey(edge.parent, edge.child));
      graph.edges[kind].set(edgeKey(parent, edge.child), { ...edge, parent });
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
    // Deleting a node cascades to its edges and assignments, it is then recreated empty
    resetNode: async (kind: Kind, n: number) => {
      await writer(sql`delete from ${nodeTable(kind)} where "id" = ${id(n)}`);
      await writer(sql`insert into ${nodeTable(kind)} ("id") values (${id(n)})`);
      for (const [key, edge] of graph.edges[kind]) {
        if (edge.parent === n || edge.child === n) graph.edges[kind].delete(key);
      }
      for (const [key, assignment] of graph.assignments) {
        if (assignment[kind] === n) graph.assignments.delete(key);
      }
    },
  };
};
export type GraphDriver = ReturnType<typeof createGraphDriver>;

// Edges always point from a lower to a higher id, which keeps the graph acyclic
export const randomOperation = async (driver: GraphDriver, random: Random, { allowNodeReset = true } = {}): Promise<string> => {
  const { graph } = driver;
  const kind: Kind = random.next() < 0.5 ? "resource" : "role";
  const size = graph.size[kind];
  const edges = [...graph.edges[kind].values()];
  const assignments = [...graph.assignments.values()];
  const roll = random.next();

  if (roll < 0.4 || edges.length === 0) {
    const a = random.int(1, size), b = random.int(1, size);
    if (a === b) return "noop";
    const [parent, child] = a < b ? [a, b] : [b, a];
    const value = random.bits();
    await driver.insertEdge(kind, parent, child, value);
    return `insert ${kind} edge ${parent}->${child} ${value}`;
  }
  if (roll < 0.47) {
    const edge = random.pick(edges)!;
    await driver.deleteEdge(kind, edge);
    return `delete ${kind} edge ${edge.parent}->${edge.child}`;
  }
  if (roll < 0.55) {
    const edge = random.pick(edges)!;
    const value = random.bits();
    await driver.updateEdgeBits(kind, edge, value);
    return `update ${kind} edge ${edge.parent}->${edge.child} ${value}`;
  }
  if (roll < 0.63) {
    const edge = random.pick(edges)!;
    if (edge.child <= 1) return "noop";
    const parent = random.int(1, edge.child - 1);
    await driver.moveEdge(kind, edge, parent);
    return `move ${kind} edge ${edge.parent}->${edge.child} to parent ${parent}`;
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
