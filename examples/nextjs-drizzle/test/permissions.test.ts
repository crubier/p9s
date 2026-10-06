import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { Client } from "pg";
import { ACCESS_LEVELS } from "../lib/permissions";
import { MOCK_PASSWORD, mockEmail, mockMember, mockOrganizations } from "../src/mock/people";

setDefaultTimeout(60_000);

// Runs the seed on a new database, with a small version of the mock organizations, then checks what each person can
// do, through the functions the app uses
const MOCK_USERS = 150;
const rootUrl = process.env.P9S_TEST_DATABASE_URL;
const databaseName = `p9s_example_${Math.random().toString(36).slice(2, 8)}`;

const admin = async (query: string) => {
  const client = new Client({ connectionString: rootUrl });
  await client.connect();
  try {
    await client.query(query);
  } finally {
    await client.end();
  }
};

describe.skipIf(!rootUrl)("example app", () => {
  let service: typeof import("../src/service");
  let db: typeof import("../src/db");
  let seeded: Awaited<ReturnType<typeof import("../src/seed").seed>>;

  beforeAll(async () => {
    await admin(`create database ${databaseName}`);
    const url = new URL(rootUrl!);
    url.pathname = `/${databaseName}`;
    process.env.DATABASE_URL = url.toString();
    db = await import("../src/db");
    service = await import("../src/service");
    await (await import("../src/migrate")).migrate();
    seeded = await (await import("../src/seed")).seed({ mockUsers: MOCK_USERS });
  });

  afterAll(async () => {
    await db?.pool.end();
    await admin(`drop database if exists ${databaseName} with (force)`);
  });

  const names = (rows: { name: string }[]) => rows.map((row) => row.name).sort();
  const titles = (rows: { title: string }[]) => rows.map((row) => row.title).sort();
  const spaceNamed = async (name: string) => (await service.listSpaces(seeded.actors.alice)).find((space) => space.name === name)!;
  const folderNamed = async (name: string) => (await service.listFolders(seeded.actors.alice)).find((folder) => folder.name === name)!;
  const documentTitled = async (title: string) => (await service.listDocuments(seeded.actors.alice)).find((row) => row.title === title)!;

  test("each person sees the spaces assigned to them, their teams, or everyone", async () => {
    const { alice, bob, carol, dave, erin } = seeded.actors;
    expect(names(await service.listSpaces(alice))).toEqual(["Design", "Engineering", "General", "Leadership"]);
    expect(names(await service.listSpaces(bob))).toEqual(["Design", "Engineering", "General"]);
    expect(names(await service.listSpaces(carol))).toEqual(["Design", "Engineering", "General"]);
    expect(names(await service.listSpaces(dave))).toEqual(["General"]);
    expect(names(await service.listSpaces(erin))).toEqual(["General"]);
  });

  test("what is shared inside a hidden space shows up on its own", async () => {
    const { bob, erin } = seeded.actors;
    const forBob = await service.listShared(bob);
    expect(titles(forBob.documents)).toEqual(["Engineering hiring plan"]);
    expect(forBob.folders).toEqual([]);
    const forErin = await service.listShared(erin);
    expect(names(forErin.folders)).toEqual(["Runbooks"]);
    expect(await service.getFolder(bob, (await spaceNamed("Leadership")).id).catch((error) => error)).toBeInstanceOf(db.NotFoundError);
    // The breadcrumbs stop at the first folder Erin cannot see
    expect(names((await service.getFolder(erin, (await folderNamed("Runbooks")).id)).path)).toEqual(["Runbooks"]);
  });

  test("the access level decides what RLS lets through", async () => {
    const { bob, carol } = seeded.actors;
    const hiring = await documentTitled("Engineering hiring plan");
    // Bob can comment on the hiring plan, not edit it
    expect((await service.getDocument(bob, hiring.id)).document.permission).toBe("10001000");
    await service.addComment(bob, hiring.id, "One more thing");
    await expect(service.updateDocument(bob, hiring.id, { content: "Hire Bob's friends" })).rejects.toThrow(db.ForbiddenError);
    // Carol comments in Engineering, but cannot write there
    const rfcs = await folderNamed("RFCs");
    await expect(service.createDocument(carol, rfcs.id, "Carol's RFC")).rejects.toThrow(db.DENIED);
    await service.addComment(carol, (await documentTitled("RFC 12: Permissions in Postgres")).id, "Approved from Design");
    // Bob writes in Engineering
    const created = await service.createDocument(bob, rfcs.id, "RFC 13: Soft delete");
    expect((await service.getDocument(bob, created)).document.permission).toBe(ACCESS_LEVELS.editor.permission);
  });

  test("only admins create spaces, invite members and manage teams", async () => {
    const { alice, dave, bob } = seeded.actors;
    await expect(service.createFolder(dave, null, "Dave's space")).rejects.toThrow(db.DENIED);
    const { auth } = await import("../src/auth");
    await auth.api.signUpEmail({ body: { name: "Frank New", email: "frank@acme.test", password: "password1234" } });
    await expect(service.inviteMember(dave, "frank@acme.test")).rejects.toThrow(db.DENIED);
    await expect(service.inviteMember(alice, "nobody@acme.test")).rejects.toThrow("Nobody has signed up");
    await service.inviteMember(alice, "frank@acme.test");
    expect(names((await service.listMembers(dave)).members)).toContain("Frank New");
    await expect(service.createTeam(dave, "Sales")).rejects.toThrow(db.DENIED);
    const engineering = (await service.listTeams(alice)).find((team) => team.name === "Engineering")!;
    await expect(service.setTeamMembership(bob, engineering.id, dave.memberId, true)).rejects.toThrow("Only admins");

    // Joining a team gives its access, leaving takes it away
    await service.setTeamMembership(alice, engineering.id, dave.memberId, true);
    expect(names(await service.listSpaces(dave))).toEqual(["Design", "Engineering", "General"]);
    await service.setTeamMembership(alice, engineering.id, dave.memberId, false);
    expect(names(await service.listSpaces(dave))).toEqual(["General"]);

    const admins = (await service.listTeams(alice)).find((team) => team.name === "Admins")!;
    await expect(service.deleteTeam(alice, admins.id)).rejects.toThrow("administers");
    await expect(service.setTeamMembership(alice, admins.id, alice.memberId, false)).rejects.toThrow("cannot remove yourself");
  });

  test("sharing needs the share bit, and never gives more than the sharer has", async () => {
    const { alice, bob, erin, dave } = seeded.actors;
    const runbooks = await folderNamed("Runbooks");
    // Bob edits Engineering, but cannot share it
    await expect(service.share(bob, runbooks.resourceId, dave.roleId, "viewer")).rejects.toThrow("cannot share");
    // p9s refuses too, without the checks of the server
    await expect(db.asRole(bob.roleId, (tx) => tx.execute(`select resource_share('${runbooks.resourceId}', '${dave.roleId}', b'10000000')`))).rejects.toThrow(db.DENIED);
    // Erin, given full access to the runbooks, can share them, up to what she has
    await service.share(alice, runbooks.resourceId, erin.roleId, "manager");
    await service.share(erin, runbooks.resourceId, dave.roleId, "commenter");
    expect(names((await service.listShared(dave)).folders)).toEqual(["Runbooks"]);
    // She cannot remove access she does not have, like the admins'
    const engineering = await spaceNamed("Engineering");
    const access = await service.listAccess(erin, runbooks.resourceId);
    // Direct access first, then what comes from above. Everyone at Acme only has the directory bit there, so it is
    // not listed, and RLS hides the name of the Engineering space from Erin
    expect(access.map((row) => [row.name, row.level, row.direct ? "direct" : row.from])).toEqual([
      ["Dave Sales", "commenter", "direct"],
      ["Erin Contractor", "manager", "direct"],
      ["Admins", "manager", "Acme"],
      ["Design", "commenter", null],
      ["Engineering", "editor", null],
    ]);
    const inherited = (await service.listAccess(alice, runbooks.resourceId)).find((row) => row.name === "Engineering")!;
    expect([inherited.from, inherited.fromFolderId]).toEqual(["Engineering", engineering.id]);
    expect(access.find((row) => row.name === "Admins")!.fromFolderId).toBeNull();
    // Sharing again changes the access given, down as well as up
    await service.share(erin, runbooks.resourceId, dave.roleId, "viewer");
    expect((await service.listAccess(erin, runbooks.resourceId)).find((row) => row.name === "Dave Sales")!.level).toBe("viewer");
    const engineeringTeam = (await service.listTeams(alice)).find((team) => team.name === "Engineering")!;
    await expect(service.unshare(erin, engineering.resourceId, engineeringTeam.roleId)).rejects.toThrow("cannot change");
    await service.unshare(erin, runbooks.resourceId, dave.roleId);
    expect((await service.listShared(dave)).folders).toEqual([]);
  });

  test("moves check both the moved row and its new parent", async () => {
    const { alice, bob } = seeded.actors;
    const overview = await documentTitled("System overview");
    await expect(service.moveDocument(bob, overview.id, (await folderNamed("Brand")).id)).rejects.toThrow(db.DENIED);
    await service.moveDocument(bob, overview.id, (await folderNamed("Runbooks")).id);
    expect(titles((await service.getFolder(bob, (await folderNamed("Runbooks")).id)).documents)).toContain("System overview");
    const architecture = await folderNamed("Architecture");
    await expect(service.moveFolder(alice, architecture.id, (await folderNamed("RFCs")).id)).rejects.toThrow("into itself");
  });

  test("an API key acts as its member, in its member's organization only", async () => {
    const { bob } = seeded.actors;
    const viaKey = (await service.actorFromApiKey(seeded.apiKey))!;
    expect(viaKey.memberId).toBe(bob.memberId);
    expect(viaKey.roleId).not.toBe(bob.roleId);
    expect(titles(await service.listDocuments(viaKey))).toEqual(titles(await service.listDocuments(bob)));
    // Bob's side project is another organization, where Bob is another member: nothing of it is visible at Acme
    const everything = await db.asRole(bob.roleId, async (tx) => (await tx.execute("select title from document")).rows as { title: string }[]);
    expect(titles(everything)).not.toContain("Ideas");
    const [key] = await service.listApiKeys(bob);
    await service.revokeApiKey(bob, key!.id);
    expect(await service.actorFromApiKey(seeded.apiKey)).toBeUndefined();
  });

  test("admins see what everyone can do in every space", async () => {
    const { alice, bob } = seeded.actors;
    await expect(service.accessMatrix(bob)).rejects.toThrow("Only admins");
    const matrix = await service.accessMatrix(alice);
    const cell = (person: string, space: string) =>
      matrix.members.find((row) => row.name === person)!.permissions[matrix.spaces.findIndex((row) => row.name === space)];
    expect(cell("Bob Builder", "Engineering")).toBe("11111000");
    expect(cell("Bob Builder", "Design")).toBe("10000000");
    expect(cell("Dave Sales", "Leadership")).toBeNull();
    expect(cell("Alice Admin", "Leadership")).toBe("11111100");
  });

  test("an admin viewing as a member sees what they see, and cannot change anything", async () => {
    const { alice, bob } = seeded.actors;
    const asBob = (await service.impersonated(alice, bob.memberId, "view"))!;
    expect(asBob.impersonator).toEqual({ memberId: alice.memberId, name: "Alice Admin", readOnly: true });
    expect(names(await service.listSpaces(asBob))).toEqual(names(await service.listSpaces(bob)));
    expect(titles((await service.listShared(asBob)).documents)).toEqual(["Engineering hiring plan"]);
    // Bob could write in RFCs, but the transaction is read only
    await expect(service.createDocument(asBob, (await folderNamed("RFCs")).id, "Not written")).rejects.toThrow(db.READ_ONLY);
    await expect(service.share(asBob, (await folderNamed("RFCs")).resourceId, alice.roleId, "viewer")).rejects.toThrow();
    // Only admins impersonate, and only while they are admins
    expect(await service.impersonated(bob, alice.memberId, "view")).toBeUndefined();
    await expect(service.startImpersonation(bob, alice.memberId, "view")).rejects.toThrow("Only admins");
    await expect(service.startImpersonation(alice, alice.memberId, "view")).rejects.toThrow("That is you");
  });

  test("an admin acting as a member has their permissions, and the audit log says who did it", async () => {
    const { alice, bob } = seeded.actors;
    await service.startImpersonation(alice, bob.memberId, "act");
    const asBob = (await service.impersonated(alice, bob.memberId, "act"))!;
    const id = await service.createDocument(asBob, (await folderNamed("RFCs")).id, "RFC 14: Written for Bob");
    // Bob's permissions, not Alice's
    await expect(service.createTeam(asBob, "Bob's team")).rejects.toThrow(db.DENIED);
    await expect(service.getFolder(asBob, (await spaceNamed("Leadership")).id)).rejects.toThrow(db.NotFoundError);
    // Keys are for their owner only
    await expect(service.createApiKey(asBob, "Sneaky")).rejects.toThrow("owner");
    await service.stopImpersonation(asBob);

    const events = await service.listAuditEvents(alice, { category: "impersonation" });
    const created = events.find((event) => event.subjectId === id)!;
    expect([created.actorName, created.impersonatorName, created.action]).toEqual(["Bob Builder", "Alice Admin", "created"]);
    expect(events.map((event) => event.action)).toContain("started acting as");
    expect(events.map((event) => event.action)).toContain("stopped acting as");
  });

  test("triggers record changes, shares and team memberships, and only admins read the log", async () => {
    const { alice, bob, carol } = seeded.actors;
    const runbooks = await folderNamed("Runbooks");
    const sharing = await service.listAuditEvents(alice, { category: "sharing" });
    const erinOnRunbooks = sharing.filter((event) => event.subjectName === "Runbooks" && event.detail === "Erin Contractor").reverse();
    expect(erinOnRunbooks[0]).toMatchObject({ actorName: "Alice Admin", action: "shared", subjectKind: "folder", permission: ACCESS_LEVELS.editor.permission });
    expect(erinOnRunbooks.slice(1).map((event) => event.action)).toContain("changed access to");
    const people = await service.listAuditEvents(alice, { category: "people" });
    expect(people.find((event) => event.action === "added to" && event.subjectName === "Design")).toMatchObject({ detail: "Carol Designer" });

    // Bob's own changes, with his key too
    const token = await service.createApiKey(bob, "Script");
    const viaKey = (await service.actorFromApiKey(token))!;
    await service.renameFolder(viaKey, runbooks.id, "Runbooks 2");
    const [renamed] = await service.listAuditEvents(alice, { memberId: bob.memberId, category: "content" });
    expect(renamed).toMatchObject({ action: "renamed", subjectName: "Runbooks 2", detail: "Runbooks", apiKeyName: "Script" });
    await service.renameFolder(bob, runbooks.id, "Runbooks");

    // A folder's documents are deleted with it: the log records the deletion of the folder only
    const research = await folderNamed("Research");
    await service.createDocument(carol, research.id, "Survey results");
    await service.deleteFolder(carol, research.id);
    const [deleted, survey] = await service.listAuditEvents(alice, { memberId: carol.memberId, category: "content" });
    expect([deleted!.action, deleted!.subjectName, survey!.action, survey!.subjectName]).toEqual(["deleted", "Research", "created", "Survey results"]);

    // RLS: the log is a leaf of the organization, and only admins have the bit its policy checks
    expect(await service.listAuditEvents(bob)).toEqual([]);
    const count = await db.asRole(bob.roleId, async (tx) => (await tx.execute("select count(*)::int as count from audit_event")).rows[0]!.count);
    expect(count).toBe(0);
    await expect(db.asRole(bob.roleId, (tx) => tx.execute(`insert into audit_event (org_id, action, subject_kind) values ('${bob.org.id}', 'forged', 'document')`))).rejects.toThrow(db.DENIED);
    // Nothing is recorded for the seed's bulk inserts, made as the owner
    expect((await db.db.execute("select count(*)::int as count from audit_event where actor_member_id is null")).rows[0]!.count).toBe(0);
  });

  test("mock users sign in with a predictable password, and get what their number says", async () => {
    const { auth } = await import("../src/auth");
    const signedIn = await auth.api.signInEmail({ body: { email: mockEmail(13), password: MOCK_PASSWORD } });
    expect(signedIn.user.email).toBe("user0013@example.test");

    const [globex] = mockOrganizations(MOCK_USERS);
    const actorOf = async (n: number) => (await service.getActor(`mock-${String(n).padStart(4, "0")}`, "globex"))!;
    // user0013 is the 12th member of Globex: in Design, whose team can also view Product
    expect(mockMember(globex!, 13)).toMatchObject({ department: "Design", admin: false, lead: false, guest: false });
    const designer = await actorOf(13);
    const spaces = await service.listSpaces(designer);
    expect(spaces.find((space) => space.name === "Design")!.permission).toBe(ACCESS_LEVELS.editor.permission);
    expect(spaces.find((space) => space.name === "Product")!.permission).toBe(ACCESS_LEVELS.viewer.permission);
    expect(names(spaces)).not.toContain("Leadership");
    expect(names(spaces)).not.toContain("Engineering");
    // user0006 leads Customer Success: full access there, and a seat in Leadership
    const lead = await service.listSpaces(await actorOf(6));
    expect(lead.find((space) => space.name === "Customer Success")!.permission).toBe(ACCESS_LEVELS.manager.permission);
    expect(lead.find((space) => space.name === "Leadership")!.permission).toBe(ACCESS_LEVELS.editor.permission);
    // user0025 is a guest: no team, only what everyone sees and what was shared with them
    const guest = await actorOf(25);
    expect((await service.listMembers(guest, { query: "user0025" })).members[0]!.teamIds).toEqual([]);
    expect(names(await service.listSpaces(guest)).filter((name) => !name.startsWith("Project "))).toEqual(["Company", "General"]);
    const shared = await service.listShared(guest);
    expect(shared.folders.length + shared.documents.length).toBeGreaterThan(0);

    // The admin's API key is as predictable as their password, and the played activity is in the audit log
    expect((await service.actorFromApiKey("p9s_globex_user0001"))!.memberId).toBe((await actorOf(1)).memberId);
    expect((await service.listAuditEvents(await actorOf(1))).length).toBeGreaterThan(0);
    expect(await service.listAuditEvents(designer)).toEqual([]);
  });

  test("removing a member removes their access", async () => {
    const { alice, erin } = seeded.actors;
    await service.removeMember(alice, erin.memberId);
    expect(await service.getActor(erin.userId, seeded.org.slug)).toBeUndefined();
    const assignments = await db.db.execute(`select count(*)::int as count from assignment_edge where role_id = '${erin.roleId}'`);
    expect(assignments.rows[0]!.count).toBe(0);
    // One event: the shares that went with Erin are not recorded on their own
    const [removed, before] = await service.listAuditEvents(alice);
    expect([removed!.action, removed!.subjectName]).toEqual(["removed", "Erin Contractor"]);
    expect(before!.action).not.toBe("removed access to");
  });
});
