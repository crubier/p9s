import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { Client } from "pg";
import type { ExecutionResult } from "postgraphile/graphql";
import { ADMIN, COMMENTER, EDITOR, MANAGER, MEMBER, VIEWER } from "../src/p9s";
import type { Person } from "../src/seed";

setDefaultTimeout(60_000);

// Migrates and seeds a new database, then asks the GraphQL API as each person. The views of all nodes need Postgres 15.
const rootUrl = process.env.P9S_TEST_DATABASE_URL;
const databaseName = `p9s_postgraphile_${Math.random().toString(36).slice(2, 8)}`;

const admin = async (query: string) => {
  const client = new Client({ connectionString: rootUrl });
  await client.connect();
  try {
    return (await client.query(query)).rows;
  } finally {
    await client.end();
  }
};

const version = rootUrl ? Number((await admin(`select current_setting('server_version_num') as v`))[0].v) : 0;

describe.skipIf(!rootUrl || version < 150000)("postgraphile example", () => {
  let seeded: Awaited<ReturnType<typeof import("../src/seed").seed>>;
  let run: (person: Person | null, source: string, variableValues?: Record<string, unknown>) => Promise<ExecutionResult<any>>;
  let release: () => Promise<void>;

  beforeAll(async () => {
    await admin(`create database ${databaseName}`);
    const url = new URL(rootUrl!);
    url.pathname = `/${databaseName}`;
    process.env.DATABASE_URL = url.toString();
    const { pool } = await import("../src/db");
    await (await import("../src/migrate")).migrate();
    seeded = await (await import("../src/seed")).seed();
    const { postgraphile } = await import("postgraphile");
    const { grafast } = await import("postgraphile/grafast");
    const { preset } = await import("../src/graphile.config");
    const { signToken } = await import("../src/auth");
    const pgl = postgraphile(preset);
    const { schema, resolvedPreset } = await pgl.getSchemaResult();
    run = async (person, source, variableValues) => {
      const authorization = person ? `Bearer ${await signToken(seeded.people[person].roleId)}` : undefined;
      const requestContext = { http: { getHeader: (name: string) => (name === "authorization" ? authorization : undefined) } };
      return (await grafast({ schema, source, variableValues, resolvedPreset, requestContext: requestContext as any })) as ExecutionResult<any>;
    };
    release = async () => {
      await pgl.release();
      for (const service of preset.pgServices ?? []) await service.release?.();
      await pool.end();
    };
  });

  afterAll(async () => {
    await release?.();
    await admin(`drop database if exists ${databaseName} with (force)`);
  });

  const data = async (person: Person | null, source: string, variableValues?: Record<string, unknown>) => {
    const result = await run(person, source, variableValues);
    expect(result.errors).toBeUndefined();
    return result.data;
  };
  const errorOf = async (person: Person | null, source: string, variableValues?: Record<string, unknown>) =>
    (await run(person, source, variableValues)).errors?.[0]?.message;
  // Everyone at Acme has the directory bit of members, down to every project and task
  const withMember = (permission: string) => [...permission].map((bit, i) => (bit === "1" || MEMBER[i] === "1" ? "1" : "0")).join("");
  const projects = async (person: Person | null) =>
    (await data(person, `{ allProjects { nodes { name permission } } }`)).allProjects.nodes
      .sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name));

  test("each person reads the projects RLS lets through, with what they can do on each", async () => {
    expect(await projects("alice")).toEqual([
      { name: "Brand", permission: ADMIN }, { name: "Hiring", permission: ADMIN }, { name: "Website", permission: ADMIN }]);
    expect(await projects("bob")).toEqual([{ name: "Website", permission: withMember(EDITOR) }]);
    expect(await projects("carol")).toEqual([{ name: "Brand", permission: withMember(MANAGER) }, { name: "Website", permission: withMember(COMMENTER) }]);
    expect(await projects("dave")).toEqual([]);
    expect(await projects(null)).toEqual([]);
    // Dave only reads the task shared with him, and its comment
    expect((await data("dave", `{ allTasks { nodes { title permission commentsByTaskId { nodes { body } } } } }`)).allTasks.nodes).toEqual([
      { title: "Fix the login bug", permission: withMember(COMMENTER), commentsByTaskId: { nodes: [{ body: "Reproduced on Safari" }] } }]);
  });

  test("the node views serve every node a person sees, with the row of its table", async () => {
    const nodes = (await data("dave", `{ allResourceNodes { nodes { tableName permission task { title } person { name } } } }`)).allResourceNodes.nodes;
    const counts = Object.fromEntries(["organization", "person", "team", "task", "project"].map((table) => [table, nodes.filter((node: any) => node.tableName === table).length]));
    // Everyone at Acme sees its people and teams
    expect(counts).toEqual({ organization: 1, person: 4, team: 2, task: 1, project: 0 });
    expect(nodes.find((node: any) => node.tableName === "task")).toEqual({ tableName: "task", permission: withMember(COMMENTER), task: { title: "Fix the login bug" }, person: null });

    // What was shared with Dave, and the teams Bob is in
    expect((await data("dave", `{ allCurrentAssignments { nodes { permission resource { task { title } } } } }`)).allCurrentAssignments.nodes)
      .toEqual([{ permission: MEMBER, resource: { task: null } }, { permission: COMMENTER, resource: { task: { title: "Fix the login bug" } } }]);
    const roles = (await data("bob", `{ allCurrentRoles { nodes { role { tableName team { name } person { name } } } } }`)).allCurrentRoles.nodes;
    expect(roles.map((row: any) => row.role.team?.name ?? row.role.person?.name ?? row.role.tableName).sort()).toEqual(["Bob", "Engineering", "organization"]);
  });

  test("whoever reads a task sees who has access to it, and from where", async () => {
    const access = async (person: Person) => (await data(person, `query ($id: UUID!) {
      allResourceAccesses(condition: { resourceId: $id }) { nodes { permission role { person { name } team { name } organization { name } } assignedResource { tableName } } }
    }`, { id: seeded.tasks.login.resource_id })).allResourceAccesses.nodes
      .map((row: any) => [row.role.person?.name ?? row.role.team?.name ?? `Everyone at ${row.role.organization.name}`, row.assignedResource?.tableName ?? "hidden", row.permission])
      .sort((a: string[], b: string[]) => a[0]!.localeCompare(b[0]!));
    const expected = [
      ["Alice", "organization", ADMIN], ["Dave", "task", COMMENTER], ["Design", "project", COMMENTER], ["Engineering", "project", EDITOR],
      ["Everyone at Acme", "organization", MEMBER],
    ];
    expect(await access("bob")).toEqual(expected);
    // Dave sees that teams have access through the project, which RLS hides from him
    expect(await access("dave")).toEqual(expected.map(([role, from, permission]) => [role, from === "project" ? "hidden" : from, permission]));
    // Hiring is out of Bob's reach
    expect((await data("bob", `query ($id: UUID!) { allResourceAccesses(condition: { resourceId: $id }) { totalCount } }`, { id: seeded.projects.hiring.resource_id }))
      .allResourceAccesses.totalCount).toBe(0);
  });

  test("people share what they have the share bit on, with bits they have", async () => {
    const share = `mutation ($resource: UUID!, $role: UUID!, $permission: BitString!) {
      resourceShare(input: { theResourceId: $resource, theRoleId: $role, thePermission: $permission }) { clientMutationId }
    }`;
    const brand = seeded.projects.brand.resource_id;
    // Carol manages Brand: she gives Dave read access, not more than she has
    await data("carol", share, { resource: brand, role: seeded.people.dave.roleId, permission: VIEWER });
    expect(await projects("dave")).toEqual([{ name: "Brand", permission: withMember(VIEWER) }]);
    expect(await errorOf("carol", share, { resource: brand, role: seeded.people.dave.roleId, permission: "11111111" })).toMatch(/row-level security/);
    // Bob edits Website, but cannot share it
    expect(await errorOf("bob", share, { resource: seeded.projects.website.resource_id, role: seeded.people.dave.roleId, permission: VIEWER })).toMatch(/row-level security/);
    await data("carol", `mutation ($resource: UUID!, $role: UUID!) { resourceUnshare(input: { theResourceId: $resource, theRoleId: $role }) { result } }`,
      { resource: brand, role: seeded.people.dave.roleId });
    expect(await projects("dave")).toEqual([]);
  });

  test("projects and tasks are created through functions, comments and updates through the generated mutations", async () => {
    const created = await data("alice", `mutation ($org: UUID!) { createProject(input: { orgId: $org, name: "Mobile" }) { project { name permission } } }`, { org: seeded.org.id });
    expect(created.createProject.project).toEqual({ name: "Mobile", permission: ADMIN });
    expect(await errorOf("bob", `mutation ($org: UUID!) { createProject(input: { orgId: $org, name: "Bob's" }) { project { name } } }`, { org: seeded.org.id }))
      .toMatch(/row-level security/);

    const task = await data("bob", `mutation ($project: UUID!) { createTask(input: { projectId: $project, title: "Dark mode" }) { task { rowId title permission } } }`,
      { project: seeded.projects.website.id });
    expect(task.createTask.task).toMatchObject({ title: "Dark mode", permission: withMember(EDITOR) });
    const comment = await data("dave", `mutation ($task: UUID!) { createComment(input: { comment: { taskId: $task, body: "Fixed for me" } }) { comment { body personByAuthorId { name } } } }`,
      { task: seeded.tasks.login.id });
    expect(comment.createComment.comment).toEqual({ body: "Fixed for me", personByAuthorId: { name: "Dave" } });
    // Dave can comment on the task, not edit it: RLS leaves him nothing to update
    expect((await data("dave", `mutation ($task: UUID!) { updateTaskByRowId(input: { rowId: $task, taskPatch: { done: true } }) { task { done } } }`,
      { task: seeded.tasks.login.id })).updateTaskByRowId).toEqual({ task: null });
    const done = await data("bob", `mutation ($task: UUID!) { updateTaskByRowId(input: { rowId: $task, taskPatch: { done: true } }) { task { done } } }`, { task: seeded.tasks.login.id });
    expect(done.updateTaskByRowId.task).toEqual({ done: true });
  });

  test("admins manage teams through a function that checks them", async () => {
    const membership = `mutation ($team: UUID!, $person: UUID!, $member: Boolean!) {
      setTeamMembership(input: { teamId: $team, personId: $person, member: $member }) { result }
    }`;
    const engineering = (await data("alice", `{ allTeams { nodes { rowId name } } }`)).allTeams.nodes.find((team: { name: string }) => team.name === "Engineering").rowId;
    expect(await errorOf("bob", membership, { team: engineering, person: seeded.people.dave.id, member: true })).toMatch(/Only admins/);
    await data("alice", membership, { team: engineering, person: seeded.people.dave.id, member: true });
    expect((await projects("dave")).map((project: any) => project.name)).toEqual(["Website"]);
    await data("alice", membership, { team: engineering, person: seeded.people.dave.id, member: false });
    expect(await projects("dave")).toEqual([]);
  });

  test("the schema has no internal object of p9s", async () => {
    const { __schema } = await data(null, `{ __schema { queryType { fields { name } } mutationType { fields { name } } } }`);
    const fields = [...__schema.queryType.fields, ...__schema.mutationType.fields].map((field: { name: string }) => field.name);
    expect(fields.filter((name: string) => /Cache|Compute|Backfill|Trigger|Edge(?!s\b)|Check|NodeInsert|NodeDelete|OrBitmap/.test(name) && !/CurrentResourceEdge/.test(name))).toEqual([]);
    expect(fields).toContain("resourceShare");
    expect(fields).not.toContain("createCurrentAssignment");
  });
});
