import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { AddressInfo } from "node:net";
import { Client } from "pg";
import { ACCESS_LEVELS, BIT, CONTENT_BITS, capabilities, levelOf, type Flags } from "../lib/permissions";
import type { Identity } from "../src/identity";
import { MOCK_PASSWORD, mockEmail, mockMember, mockOrganizations } from "../src/mock/people";

setDefaultTimeout(60_000);

// Migrates and seeds a new database, with a small version of the mock organizations, then asks the GraphQL API what
// each person can do: in the process as the seed does, and over HTTP as the app and GraphiQL do. The node views of
// PostGraphile need Postgres 15
const MOCK_USERS = 150;
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
  let gql: typeof import("../src/graphql");
  let identity: typeof import("../src/identity");
  let db: typeof import("../src/db");
  let seeded: Awaited<ReturnType<typeof import("../src/seed").seed>>;
  let people: Record<"alice" | "bob" | "carol" | "dave" | "erin", Identity>;

  beforeAll(async () => {
    await admin(`create database ${databaseName}`);
    const url = new URL(rootUrl!);
    url.pathname = `/${databaseName}`;
    process.env.DATABASE_URL = url.toString();
    process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret";
    db = await import("../src/db");
    // PostGraphile reads the schema of the database once, when it is first imported
    await (await import("../src/migrate")).migrate();
    gql = await import("../src/graphql");
    identity = await import("../src/identity");
    seeded = await (await import("../src/seed")).seed({ mockUsers: MOCK_USERS });
    people = seeded.people;
  });

  afterAll(async () => {
    await gql?.pgl.release();
    await db?.pool.end();
    await admin(`drop database if exists ${databaseName} with (force)`);
  });

  // The permission fields have a boolean per bit, and the bitmap
  const FLAGS = "{ bitmap read create edit delete comment share directory admin }";
  // What a permission allows on the content: everyone also has the directory bit, from the organization
  const content = (permission: Flags | null) => capabilities(permission).filter((capability) => CONTENT_BITS[BIT[capability]] === "1");
  const ask = <T = any,>(as: Identity, source: string, variables?: Record<string, unknown>) => gql.graphql<T>(as, source, variables);
  // The message of the error a request fails with
  const refused = (request: Promise<unknown>) =>
    request.then(
      () => "succeeded",
      (error: Error) => error.message,
    );
  const sorted = (values: string[]) => [...values].sort();
  const slug = () => seeded.org.slug;

  const spaces = async (as: Identity) =>
    (await ask(as, `query ($slug: String!) { organizationBySlug(slug: $slug) { spaces { nodes { rowId resourceId name permission ${FLAGS} } } } }`, { slug: slug() }))
      .organizationBySlug.spaces.nodes as { rowId: string; resourceId: string; name: string; permission: Flags }[];
  const shared = async (as: Identity) => {
    const { organizationBySlug } = await ask(as, `query ($slug: String!) { organizationBySlug(slug: $slug) {
      sharedFolders { nodes { name } } sharedDocuments { nodes { title } } } }`, { slug: slug() });
    return {
      folders: sorted(organizationBySlug.sharedFolders.nodes.map((row: { name: string }) => row.name)),
      documents: sorted(organizationBySlug.sharedDocuments.nodes.map((row: { title: string }) => row.title)),
    };
  };
  const folderNamed = async (name: string) =>
    (await ask(people.alice, `query ($slug: String!, $name: String!) { organizationBySlug(slug: $slug) {
      folders(condition: { name: $name }) { nodes { rowId resourceId } } } }`, { slug: slug(), name })).organizationBySlug.folders.nodes[0] as {
      rowId: string;
      resourceId: string;
    };
  const documentTitled = async (title: string) =>
    (await ask(people.alice, `query ($slug: String!, $title: String!) { organizationBySlug(slug: $slug) {
      documents(condition: { title: $title }) { nodes { rowId resourceId } } } }`, { slug: slug(), title })).organizationBySlug.documents.nodes[0] as {
      rowId: string;
      resourceId: string;
    };
  const team = async (name: string) =>
    ((await ask(people.alice, `query ($slug: String!) { organizationBySlug(slug: $slug) { teams { nodes { rowId roleId name } } } }`, { slug: slug() }))
      .organizationBySlug.teams.nodes as { rowId: string; roleId: string; name: string }[]).find((row) => row.name === name)!;
  const memberOf = (as: Identity) => ask<{ currentMember: { rowId: string; roleId: string } }>(as, `{ currentMember { rowId roleId } }`).then((data) => data.currentMember);
  const createDocument = (as: Identity, folderId: string, title: string) =>
    ask(as, `mutation ($folderId: UUID!, $title: String!) { createDocument(input: { folderId: $folderId, title: $title }) { document { rowId } } }`, { folderId, title })
      .then((data) => data.createDocument.document.rowId as string);
  const share = (as: Identity, resourceId: string, roleId: string, level: string) =>
    ask(as, `mutation ($resourceId: UUID!, $roleId: UUID!, $level: String!) { shareResource(input: { resourceId: $resourceId, roleId: $roleId, level: $level }) { result } }`, {
      resourceId,
      roleId,
      level,
    });
  const auditEvents = async (as: Identity, filter: { category?: string; memberId?: string } = {}) =>
    (await ask(as, `query ($slug: String!, $category: String, $memberId: UUID) { organizationBySlug(slug: $slug) {
      auditEvents(category: $category, memberId: $memberId) { nodes { actorName impersonatorName apiKeyName action subjectKind subjectId subjectName detail granted ${FLAGS} } } } }`, {
      slug: slug(),
      ...filter,
    })).organizationBySlug.auditEvents.nodes as Record<string, unknown>[];

  test("each person sees the spaces assigned to them, their teams, or everyone", async () => {
    const { alice, bob, carol, dave, erin } = people;
    const names = async (as: Identity) => sorted((await spaces(as)).map((space) => space.name));
    expect(await names(alice)).toEqual(["Design", "Engineering", "General", "Leadership"]);
    expect(await names(bob)).toEqual(["Design", "Engineering", "General"]);
    expect(await names(carol)).toEqual(["Design", "Engineering", "General"]);
    expect(await names(dave)).toEqual(["General"]);
    expect(await names(erin)).toEqual(["General"]);
  });

  test("what is shared inside a hidden space shows up on its own, and the rest of the space does not exist", async () => {
    const { bob, erin } = people;
    expect(await shared(bob)).toEqual({ folders: [], documents: ["Engineering hiring plan"] });
    expect((await shared(erin)).folders).toEqual(["Runbooks"]);
    const leadership = (await spaces(people.alice)).find((space) => space.name === "Leadership")!;
    expect((await ask(bob, `query ($id: UUID!) { folderByRowId(rowId: $id) { name } }`, { id: leadership.rowId })).folderByRowId).toBeNull();
    // The breadcrumbs stop at the first folder Erin cannot see
    const runbooks = await folderNamed("Runbooks");
    const path = await ask(erin, `query ($id: UUID!) { folderByRowId(rowId: $id) { path { nodes { name } } } }`, { id: runbooks.rowId });
    expect(path.folderByRowId.path.nodes.map((row: { name: string }) => row.name)).toEqual(["Runbooks"]);
  });

  test("the access level decides what RLS lets through", async () => {
    const { bob, carol } = people;
    const hiring = await documentTitled("Engineering hiring plan");
    // Bob can comment on the hiring plan, not edit it
    expect(content((await ask(bob, `query ($id: UUID!) { documentByRowId(rowId: $id) { permission ${FLAGS} } }`, { id: hiring.rowId })).documentByRowId.permission)).toEqual(ACCESS_LEVELS.commenter.capabilities);
    await ask(bob, `mutation ($id: UUID!) { createComment(input: { comment: { documentId: $id, body: "One more thing" } }) { comment { rowId } } }`, { id: hiring.rowId });
    expect(
      await refused(ask(bob, `mutation ($id: UUID!) { updateDocumentByRowId(input: { rowId: $id, documentPatch: { content: "Hire Bob's friends" } }) { document { rowId } } }`, { id: hiring.rowId })),
    ).toBe("You don't have permission to do that.");
    // Carol comments in Engineering, but cannot write there
    const rfcs = await folderNamed("RFCs");
    expect(await refused(createDocument(carol, rfcs.rowId, "Carol's RFC"))).toBe("You don't have permission to do that.");
    // Bob writes in Engineering
    const created = await createDocument(bob, rfcs.rowId, "RFC 13: Soft delete");
    expect(content((await ask(bob, `query ($id: UUID!) { documentByRowId(rowId: $id) { permission ${FLAGS} } }`, { id: created })).documentByRowId.permission)).toEqual(ACCESS_LEVELS.editor.capabilities);
  });

  test("only admins create spaces, invite members and manage teams", async () => {
    const { alice, bob, dave } = people;
    const orgId = seeded.org.rowId;
    expect(await refused(ask(dave, `mutation ($orgId: UUID!) { createFolder(input: { orgId: $orgId, name: "Dave's space" }) { folder { rowId } } }`, { orgId }))).toBe(
      "You don't have permission to do that.",
    );
    const { auth } = await import("../src/auth");
    await auth.api.signUpEmail({ body: { name: "Frank New", email: "frank@acme.test", password: "password1234" } });
    const invite = (as: Identity, email: string) => ask(as, `mutation ($orgId: UUID!, $email: String!) { inviteMember(input: { orgId: $orgId, email: $email }) { member { rowId } } }`, { orgId, email });
    expect(await refused(invite(dave, "frank@acme.test"))).toBe("You don't have permission to do that.");
    expect(await refused(invite(alice, "nobody@acme.test"))).toBe("Nobody has signed up with that email yet.");
    await invite(alice, "frank@acme.test");
    const members = await ask(dave, `query ($slug: String!) { organizationBySlug(slug: $slug) { members(query: "Frank") { nodes { name } } } }`, { slug: slug() });
    expect(members.organizationBySlug.members.nodes).toEqual([{ name: "Frank New" }]);
    expect(await refused(ask(dave, `mutation ($orgId: UUID!) { createTeam(input: { orgId: $orgId, name: "Sales" }) { team { rowId } } }`, { orgId }))).toBe(
      "You don't have permission to do that.",
    );

    // Joining a team gives its access, leaving takes it away
    const engineering = await team("Engineering");
    const daveMember = await memberOf(dave);
    const membership = (as: Identity, teamId: string, memberId: string, isMember: boolean) =>
      ask(as, `mutation ($teamId: UUID!, $memberId: UUID!, $isMember: Boolean!) { setTeamMembership(input: { teamId: $teamId, memberId: $memberId, isMember: $isMember }) { result } }`, {
        teamId,
        memberId,
        isMember,
      });
    expect(await refused(membership(bob, engineering.rowId, daveMember.rowId, true))).toBe("Only admins can change teams.");
    await membership(alice, engineering.rowId, daveMember.rowId, true);
    expect(sorted((await spaces(dave)).map((space) => space.name))).toEqual(["Design", "Engineering", "General"]);
    await membership(alice, engineering.rowId, daveMember.rowId, false);
    expect((await spaces(dave)).map((space) => space.name)).toEqual(["General"]);

    const admins = await team("Admins");
    expect(await refused(ask(alice, `mutation ($teamId: UUID!) { deleteTeam(input: { teamId: $teamId }) { result } }`, { teamId: admins.rowId }))).toContain("administers");
    expect(await refused(membership(alice, admins.rowId, (await memberOf(alice)).rowId, false))).toContain("cannot remove yourself");
  });

  test("sharing needs the share bit, and never gives more than the sharer has", async () => {
    const { alice, bob, erin, dave } = people;
    const runbooks = await folderNamed("Runbooks");
    const [daveMember, erinMember] = [await memberOf(dave), await memberOf(erin)];
    // Bob edits Engineering, but cannot share it
    expect(await refused(share(bob, runbooks.resourceId, daveMember.roleId, "viewer"))).toBe("You cannot share this.");
    // Erin, given full access to the runbooks, can share them, up to what she has
    await share(alice, runbooks.resourceId, erinMember.roleId, "manager");
    await share(erin, runbooks.resourceId, daveMember.roleId, "commenter");
    expect((await shared(dave)).folders).toEqual(["Runbooks"]);

    // Who has access, direct first, then from above. Everyone at Acme only has the directory bit there, so it is not
    // listed, and RLS hides the name of the Engineering space from Erin
    const access = async (as: Identity) =>
      (await ask(as, `query ($id: UUID!) { folderByRowId(rowId: $id) { access { nodes { name permission ${FLAGS} direct fromName fromFolderId } } } }`, { id: runbooks.rowId }))
        .folderByRowId.access.nodes as { name: string; permission: Flags; direct: boolean; fromName: string | null; fromFolderId: string | null }[];
    expect((await access(erin)).map((row) => [row.name, levelOf(row.permission), row.direct ? "direct" : row.fromName])).toEqual([
      ["Dave Sales", "commenter", "direct"],
      ["Erin Contractor", "manager", "direct"],
      ["Admins", "manager", "Acme"],
      ["Design", "commenter", null],
      ["Engineering", "editor", null],
    ]);
    const engineering = (await spaces(alice)).find((space) => space.name === "Engineering")!;
    const inherited = (await access(alice)).find((row) => row.name === "Engineering")!;
    expect([inherited.fromName, inherited.fromFolderId]).toEqual(["Engineering", engineering.rowId]);

    // Sharing again changes the access given, down as well as up
    await share(erin, runbooks.resourceId, daveMember.roleId, "viewer");
    expect(content((await access(erin)).find((row) => row.name === "Dave Sales")!.permission)).toEqual(ACCESS_LEVELS.viewer.capabilities);
    const unshare = (as: Identity, resourceId: string, roleId: string) =>
      ask(as, `mutation ($resourceId: UUID!, $roleId: UUID!) { unshareResource(input: { resourceId: $resourceId, roleId: $roleId }) { result } }`, { resourceId, roleId });
    expect(await refused(unshare(erin, engineering.resourceId, (await team("Engineering")).roleId))).toBe("You cannot change who has access to this.");
    await unshare(erin, runbooks.resourceId, daveMember.roleId);
    expect((await shared(dave)).folders).toEqual([]);
  });

  test("moves check both the moved row and its new parent", async () => {
    const { alice, bob } = people;
    const overview = await documentTitled("System overview");
    const move = (folderId: string) =>
      ask(bob, `mutation ($id: UUID!, $folderId: UUID!) { updateDocumentByRowId(input: { rowId: $id, documentPatch: { folderId: $folderId } }) { document { rowId } } }`, {
        id: overview.rowId,
        folderId,
      });
    expect(await refused(move((await folderNamed("Brand")).rowId))).toBe("You don't have permission to do that.");
    await move((await folderNamed("Runbooks")).rowId);
    const architecture = await folderNamed("Architecture");
    expect(
      await refused(ask(alice, `mutation ($id: UUID!, $parentId: UUID!) { moveFolder(input: { folderId: $id, parentId: $parentId }) { folder { rowId } } }`, {
        id: architecture.rowId,
        parentId: (await folderNamed("RFCs")).rowId,
      })),
    ).toBe("A folder cannot be moved into itself.");
  });

  test("an API key acts as its member, in its member's organization only", async () => {
    const viaKey = await identity.fromApiKey(seeded.apiKey);
    const bob = await memberOf(people.bob);
    expect(viaKey.roleId).not.toBe(bob.roleId);
    expect((await memberOf(viaKey)).rowId).toBe(bob.rowId);
    const read = async (as: Identity) =>
      sorted((await ask(as, `query ($slug: String!) { organizationBySlug(slug: $slug) { documents { nodes { title } } } }`, { slug: slug() })).organizationBySlug.documents.nodes.map((row: any) => row.title));
    expect(await read(viaKey)).toEqual(await read(people.bob));
    // Bob's side project is another organization, where Bob is another member: nothing of it is visible at Acme. A key
    // has no user, so it does not list Bob's organizations either
    expect(await read(people.bob)).not.toContain("Ideas");
    expect((await ask(viaKey, `{ myOrganizations { nodes { slug } } }`)).myOrganizations.nodes).toEqual([]);

    const keys = (await ask(people.bob, `{ myApiKeys { nodes { rowId name } } }`)).myApiKeys.nodes as { rowId: string; name: string }[];
    await ask(people.bob, `mutation ($id: UUID!) { revokeApiKey(input: { id: $id }) { result } }`, { id: keys.find((key) => key.name === "CI")!.rowId });
    expect((await identity.fromApiKey(seeded.apiKey)).roleId).toBeUndefined();
  });

  test("search finds the names, titles and contents each person can read", async () => {
    const { alice, bob, dave } = people;
    const found = async (as: Identity, query: string) => {
      const { organizationBySlug } = await ask(as, `query ($slug: String!, $query: String!) { organizationBySlug(slug: $slug) {
        searchFolders(query: $query) { nodes { name } } searchDocuments(query: $query) { nodes { title } } } }`, { slug: slug(), query });
      return {
        folders: sorted(organizationBySlug.searchFolders.nodes.map((row: { name: string }) => row.name)),
        documents: sorted(organizationBySlug.searchDocuments.nodes.map((row: { title: string }) => row.title)),
      };
    };
    expect((await found(alice, "board")).folders).toEqual(["Board"]);
    expect(await found(alice, "board deck")).toEqual({ folders: [], documents: ["Q3 board deck"] });
    expect(await found(alice, "burn is down")).toEqual({ folders: [], documents: ["Q3 board deck"] });
    expect(await found(bob, "board deck")).toEqual({ folders: [], documents: [] });
    // Bob was given the hiring plan on its own, not the folder it is in
    expect(await found(bob, "HIRING")).toEqual({ folders: [], documents: ["Engineering hiring plan"] });
    expect(await found(dave, "hiring")).toEqual({ folders: [], documents: [] });
    expect((await found(dave, "expense")).documents).toEqual(["Expense policy"]);
  });

  test("admins see what everyone can do in every space, and nobody else does", async () => {
    const { alice, bob } = people;
    const matrix = async (as: Identity) => {
      const { organizationBySlug } = await ask(as, `query ($slug: String!) { organizationBySlug(slug: $slug) {
        spaces { nodes { name } } members(query: "") { nodes { name spacePermissions ${FLAGS} } } } }`, { slug: slug() });
      const names = organizationBySlug.spaces.nodes.map((row: { name: string }) => row.name);
      return (person: string, space: string) =>
        organizationBySlug.members.nodes.find((row: { name: string }) => row.name === person)!.spacePermissions?.[names.indexOf(space)] ?? null;
    };
    const cell = await matrix(alice);
    expect(capabilities(cell("Bob Builder", "Engineering"))).toEqual(ACCESS_LEVELS.editor.capabilities);
    expect(cell("Bob Builder", "Design")).toMatchObject({ bitmap: "10000000", read: true, comment: false });
    expect(cell("Dave Sales", "Leadership")).toBeNull();
    expect(capabilities(cell("Alice Admin", "Leadership"))).toEqual(ACCESS_LEVELS.manager.capabilities);
    expect((await matrix(bob))("Alice Admin", "General")).toBeNull();
  });

  test("an admin viewing as a member sees what they see, and cannot change anything", async () => {
    const [alice, bob] = [await memberOf(people.alice), await memberOf(people.bob)];
    const asBob = await identity.memberIdentity(seeded.userIds.alice, slug(), { memberId: bob.rowId, mode: "view" });
    expect(asBob).toMatchObject({ roleId: bob.roleId, impersonatorMemberId: alice.rowId, readOnly: true });
    expect(await spaces(asBob)).toEqual(await spaces(people.bob));
    expect((await ask(asBob, `{ currentImpersonation { adminName readOnly } }`)).currentImpersonation).toEqual({ adminName: "Alice Admin", readOnly: true });
    // Bob could write in RFCs, but the transaction is read only
    expect(await refused(createDocument(asBob, (await folderNamed("RFCs")).rowId, "Not written"))).toBe("You are viewing as someone else: act as them to change anything.");
    // Only admins impersonate, and only while they are admins
    expect(await identity.memberIdentity(seeded.userIds.bob, slug(), { memberId: alice.rowId, mode: "view" })).toEqual(people.bob);
    const start = (as: Identity, memberId: string) =>
      ask(as, `mutation ($memberId: UUID!) { startImpersonation(input: { memberId: $memberId, mode: "view" }) { member { rowId } } }`, { memberId });
    expect(await refused(start(people.bob, alice.rowId))).toBe("Only admins can view the organization as someone else.");
    expect(await refused(start(people.alice, alice.rowId))).toBe("That is you.");
  });

  test("an admin acting as a member has their permissions, and the audit log says who did it", async () => {
    const bob = await memberOf(people.bob);
    const mode = { memberId: bob.rowId, mode: "act" as const };
    await ask(people.alice, `mutation ($memberId: UUID!, $mode: String!) { startImpersonation(input: { memberId: $memberId, mode: $mode }) { member { rowId } } }`, mode);
    const asBob = await identity.memberIdentity(seeded.userIds.alice, slug(), mode);
    const id = await createDocument(asBob, (await folderNamed("RFCs")).rowId, "RFC 14: Written for Bob");
    // Bob's permissions, not Alice's
    expect(await refused(ask(asBob, `mutation ($orgId: UUID!) { createTeam(input: { orgId: $orgId, name: "Bob's team" }) { team { rowId } } }`, { orgId: seeded.org.rowId }))).toBe(
      "You don't have permission to do that.",
    );
    expect(await refused(ask(asBob, `mutation { createApiKey(input: { name: "Sneaky" }) { token } }`))).toBe("API keys can only be managed by their owner.");
    await ask(people.alice, `mutation ($memberId: UUID!, $mode: String!) { stopImpersonation(input: { memberId: $memberId, mode: $mode }) { member { rowId } } }`, mode);

    const events = await auditEvents(people.alice, { category: "impersonation" });
    const created = events.find((event) => event.subjectId === id)!;
    expect([created.actorName, created.impersonatorName, created.action]).toEqual(["Bob Builder", "Alice Admin", "created"]);
    expect(events.map((event) => event.action)).toContain("started acting as");
    expect(events.map((event) => event.action)).toContain("stopped acting as");
  });

  test("triggers record changes, shares and team memberships, and only admins read the log", async () => {
    const { alice, bob, carol } = people;
    const sharing = await auditEvents(alice, { category: "sharing" });
    const erinOnRunbooks = sharing.filter((event) => event.subjectName === "Runbooks" && event.detail === "Erin Contractor").reverse();
    expect(erinOnRunbooks[0]).toMatchObject({ actorName: "Alice Admin", action: "shared", subjectKind: "folder", granted: { bitmap: ACCESS_LEVELS.editor.permission, edit: true, share: false } });
    expect(erinOnRunbooks.slice(1).map((event) => event.action)).toContain("changed access to");
    const peopleEvents = await auditEvents(alice, { category: "people" });
    expect(peopleEvents.find((event) => event.action === "added to" && event.subjectName === "Design")).toMatchObject({ detail: "Carol Designer" });

    // Bob's own changes, with a key too
    const token = (await ask(bob, `mutation { createApiKey(input: { name: "Script" }) { token } }`)).createApiKey.token as string;
    const runbooks = await folderNamed("Runbooks");
    const rename = (as: Identity, name: string) =>
      ask(as, `mutation ($id: UUID!, $name: String!) { updateFolderByRowId(input: { rowId: $id, folderPatch: { name: $name } }) { folder { rowId } } }`, { id: runbooks.rowId, name });
    await rename(await identity.fromApiKey(token), "Runbooks 2");
    const [renamed] = await auditEvents(alice, { memberId: (await memberOf(bob)).rowId, category: "content" });
    expect(renamed).toMatchObject({ action: "renamed", subjectName: "Runbooks 2", detail: "Runbooks", apiKeyName: "Script" });
    await rename(bob, "Runbooks");

    // A folder's documents are deleted with it: the log records the deletion of the folder only
    const research = await folderNamed("Research");
    await createDocument(carol, research.rowId, "Survey results");
    await ask(carol, `mutation ($id: UUID!) { deleteFolderByRowId(input: { rowId: $id }) { deletedFolderId } }`, { id: research.rowId });
    const [deleted, survey] = await auditEvents(alice, { memberId: (await memberOf(carol)).rowId, category: "content" });
    expect([deleted!.action, deleted!.subjectName, survey!.action, survey!.subjectName]).toEqual(["deleted", "Research", "created", "Survey results"]);

    // RLS: the log is a leaf of the organization, and only admins have the bit its policy checks
    expect(await auditEvents(bob)).toEqual([]);
    // Nothing is recorded for the seed's bulk inserts, made as the owner
    expect((await db.pool.query("select count(*)::int as count from audit_event where actor_member_id is null")).rows[0].count).toBe(0);
  });

  test("GraphQL serves none of the functions that write the graph or the log", async () => {
    const { schema } = await gql.pgl.getSchemaResult();
    const fields = [...Object.keys(schema.getQueryType()!.getFields()), ...Object.keys(schema.getMutationType()!.getFields())];
    for (const hidden of [/^audit(?!Event)/i, /resourceParent/, /^recordImpersonation/, /^apiKeyHash/, /^folderSearch|^documentSearch/]) {
      expect(fields.filter((field) => hidden.test(field))).toEqual([]);
    }
    // What the app needs is there
    for (const field of ["organizationBySlug", "createFolder", "createDocument", "shareResource", "startImpersonation", "createApiKey", "updateDocumentByRowId"]) {
      expect(fields).toContain(field);
    }
  });

  test("mock users sign in with a predictable password, and get what their number says", async () => {
    const { auth } = await import("../src/auth");
    const signedIn = await auth.api.signInEmail({ body: { email: mockEmail(13), password: MOCK_PASSWORD } });
    expect(signedIn.user.email).toBe("user0013@example.test");

    const [globex] = mockOrganizations(MOCK_USERS);
    const member = (n: number) => identity.memberIdentity(`mock-${String(n).padStart(4, "0")}`, "globex");
    const spacesOf = async (as: Identity) =>
      (await ask(as, `{ organizationBySlug(slug: "globex") { spaces { nodes { name permission ${FLAGS} } } } }`)).organizationBySlug.spaces.nodes as { name: string; permission: Flags }[];
    // user0013 is the 12th member of Globex: in Design, whose team can also view Product
    expect(mockMember(globex!, 13)).toMatchObject({ department: "Design", admin: false, lead: false, guest: false });
    const designer = await member(13);
    const designerSpaces = await spacesOf(designer);
    expect(content(designerSpaces.find((space) => space.name === "Design")!.permission)).toEqual(ACCESS_LEVELS.editor.capabilities);
    expect(content(designerSpaces.find((space) => space.name === "Product")!.permission)).toEqual(ACCESS_LEVELS.viewer.capabilities);
    expect(designerSpaces.map((space) => space.name)).not.toContain("Leadership");
    // user0025 is a guest: only what everyone sees and what was shared with them
    const guest = await spacesOf(await member(25));
    expect(sorted(guest.map((space) => space.name).filter((name) => !name.startsWith("Project ")))).toEqual(["Company", "General"]);

    // The admin's API key is as predictable as their password, and the played activity is in the audit log
    expect((await memberOf(await identity.fromApiKey("p9s_globex_user0001"))).rowId).toBe((await memberOf(await member(1))).rowId);
    const globexEvents = async (as: Identity) => (await ask(as, `{ organizationBySlug(slug: "globex") { auditEvents(first: 5) { totalCount } } }`)).organizationBySlug.auditEvents.totalCount;
    expect(await globexEvents(await member(1))).toBeGreaterThan(0);
    expect(await globexEvents(designer)).toBe(0);
  });

  test("removing a member removes their access", async () => {
    const erin = await memberOf(people.erin);
    await ask(people.alice, `mutation ($id: UUID!) { removeMember(input: { memberId: $id }) { result } }`, { id: erin.rowId });
    expect((await identity.memberIdentity(seeded.userIds.erin, slug())).roleId).toBeUndefined();
    expect((await db.pool.query(`select count(*)::int as count from assignment_edge where role_id = $1`, [erin.roleId])).rows[0].count).toBe(0);
    const [removed, before] = await auditEvents(people.alice);
    expect([removed!.action, removed!.subjectName]).toEqual(["removed", "Erin Contractor"]);
    expect(before!.action).not.toBe("removed access to");
  });

  describe("over HTTP", () => {
    let origin: string;
    let close: () => void;

    beforeAll(async () => {
      const { createServer } = await import("node:http");
      const { handle } = await import("../src/handler");
      const server = createServer((req, res) => void handle(req, res));
      await new Promise<void>((resolve) => server.listen(0, resolve));
      origin = `http://localhost:${(server.address() as AddressInfo).port}`;
      close = () => server.close();
    });

    afterAll(() => close?.());

    const signIn = async (email: string) => {
      const response = await fetch(`${origin}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify({ email, password: MOCK_PASSWORD }),
      });
      expect(response.status).toBe(200);
      return response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
    };
    const post = async (query: string, headers: Record<string, string> = {}, variables?: object) =>
      (await fetch(`${origin}/graphql`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ query, variables }) })).json() as Promise<{
        data?: any;
        errors?: { message: string; extensions?: { code?: string } }[];
      }>;

    test("the session gives the user, and the organization header the member", async () => {
      const cookie = await signIn("bob@acme.test");
      const query = `{ viewer { email } currentMember { name } myOrganizations { nodes { slug } } }`;
      const anywhere = await post(query, { cookie });
      expect(anywhere.data.viewer.email).toBe("bob@acme.test");
      expect(anywhere.data.currentMember).toBeNull();
      expect(anywhere.data.myOrganizations.nodes.length).toBe(2);
      expect((await post(query, { cookie, "x-p9s-org": "acme" })).data.currentMember.name).toBe("Bob Builder");
      expect((await post(query)).data).toMatchObject({ viewer: null, currentMember: null });
    });

    test("an API key is a bearer token", async () => {
      const result = await post(`{ currentMember { name } }`, { authorization: "Bearer p9s_globex_user0001" });
      expect(result.data.currentMember.name).toBe((await ask(await identity.memberIdentity("mock-0001", "globex"), `{ currentMember { name } }`)).currentMember.name);
      expect((await post(`{ currentMember { name } }`, { authorization: "Bearer p9s_nothing" })).data.currentMember).toBeNull();
    });

    test("the impersonation cookie is only followed for admins", async () => {
      const bob = await memberOf(people.bob);
      const alice = await memberOf(people.alice);
      const impersonate = (memberId: string, mode: string) => `p9s-impersonation=${encodeURIComponent(`${seeded.org.rowId}:${memberId}:${mode}`)}`;
      const asAlice = await signIn("alice@acme.test");
      const viewing = await post(`{ currentMember { name } currentImpersonation { adminName readOnly } }`, {
        cookie: `${asAlice}; ${impersonate(bob.rowId, "view")}`,
        "x-p9s-org": "acme",
      });
      expect(viewing.data).toEqual({ currentMember: { name: "Bob Builder" }, currentImpersonation: { adminName: "Alice Admin", readOnly: true } });
      const write = await post(`mutation ($orgId: UUID!) { createTeam(input: { orgId: $orgId, name: "Never" }) { team { rowId } } }`, {
        cookie: `${asAlice}; ${impersonate(bob.rowId, "act")}`,
        "x-p9s-org": "acme",
      }, { orgId: seeded.org.rowId });
      expect(write.errors?.[0]?.message).toBe("You don't have permission to do that.");
      // Bob is no admin: the cookie changes nothing for him
      const asBob = await signIn("bob@acme.test");
      const ignored = await post(`{ currentMember { name } currentImpersonation { adminName } }`, { cookie: `${asBob}; ${impersonate(alice.rowId, "act")}`, "x-p9s-org": "acme" });
      expect(ignored.data).toEqual({ currentMember: { name: "Bob Builder" }, currentImpersonation: null });
    });

    test("errors say what went wrong, with the Postgres code, and nothing of the schema", async () => {
      const cookie = await signIn("dave@acme.test");
      const result = await post(`mutation ($orgId: UUID!) { createFolder(input: { orgId: $orgId, name: "Dave's space" }) { folder { rowId } } }`, { cookie, "x-p9s-org": "acme" }, {
        orgId: seeded.org.rowId,
      });
      expect(result.errors).toEqual([expect.objectContaining({ message: "You don't have permission to do that.", extensions: { code: "42501" } })]);
    });

    test("GraphiQL opens with the query and the organization of the link", async () => {
      const html = await (await fetch(`${origin}/graphiql?${new URLSearchParams({ query: "{ currentMember { name } }", org: "acme" })}`)).text();
      expect(html).toContain("RURU_CONFIG");
      expect(html).toContain("initialHeaders");
    });
  });
});
