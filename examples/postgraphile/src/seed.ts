import type { AccessLevel } from "../lib/permissions.js";
import { auth } from "./auth.js";
import { pool } from "./db.js";
import { graphql, pgl } from "./graphql.js";
import { memberIdentity, type Identity } from "./identity.js";
import { seedMock } from "./mock/generate.js";
import { DEFAULT_MOCK_USERS, MOCK_PASSWORD, mockEmail, mockExamples } from "./mock/people.js";

export const PASSWORD = "password1234";

export const PEOPLE = {
  alice: { name: "Alice Admin", email: "alice@acme.test" },
  bob: { name: "Bob Builder", email: "bob@acme.test" },
  carol: { name: "Carol Designer", email: "carol@acme.test" },
  dave: { name: "Dave Sales", email: "dave@acme.test" },
  erin: { name: "Erin Contractor", email: "erin@acme.test" },
} as const;

export type Person = keyof typeof PEOPLE;

type Org = { rowId: string; name: string; slug: string; roleId: string };
type Node = { rowId: string; resourceId: string };

// The operations of the seed, each one made on behalf of someone, through the GraphQL API
export const api = {
  createOrganization: async (as: Identity, name: string) =>
    (await graphql<{ createOrganization: { organization: Org } }>(as, `mutation ($name: String!) {
      createOrganization(input: { name: $name }) { organization { rowId name slug roleId } }
    }`, { name })).createOrganization.organization,
  inviteMember: async (as: Identity, orgId: string, email: string) =>
    (await graphql<{ inviteMember: { member: { rowId: string; roleId: string } } }>(as, `mutation ($orgId: UUID!, $email: String!) {
      inviteMember(input: { orgId: $orgId, email: $email }) { member { rowId roleId } }
    }`, { orgId, email })).inviteMember.member,
  createTeam: async (as: Identity, orgId: string, name: string) =>
    (await graphql<{ createTeam: { team: { rowId: string; roleId: string } } }>(as, `mutation ($orgId: UUID!, $name: String!) {
      createTeam(input: { orgId: $orgId, name: $name }) { team { rowId roleId } }
    }`, { orgId, name })).createTeam.team,
  setTeamMembership: (as: Identity, teamId: string, memberId: string, isMember: boolean) =>
    graphql(as, `mutation ($teamId: UUID!, $memberId: UUID!, $isMember: Boolean!) {
      setTeamMembership(input: { teamId: $teamId, memberId: $memberId, isMember: $isMember }) { result }
    }`, { teamId, memberId, isMember }),
  spaces: async (as: Identity, slug: string) =>
    (await graphql<{ organizationBySlug: { spaces: { nodes: (Node & { name: string })[] } } }>(as, `query ($slug: String!) {
      organizationBySlug(slug: $slug) { spaces { nodes { rowId resourceId name } } }
    }`, { slug })).organizationBySlug.spaces.nodes,
  createFolder: async (as: Identity, orgId: string, parentId: string | null, name: string) =>
    (await graphql<{ createFolder: { folder: Node } }>(as, `mutation ($orgId: UUID!, $parentId: UUID, $name: String!) {
      createFolder(input: { orgId: $orgId, parentId: $parentId, name: $name }) { folder { rowId resourceId } }
    }`, { orgId, parentId, name })).createFolder.folder,
  createDocument: async (as: Identity, folderId: string, title: string, content: string) =>
    (await graphql<{ createDocument: { document: Node } }>(as, `mutation ($folderId: UUID!, $title: String!, $content: String!) {
      createDocument(input: { folderId: $folderId, title: $title, content: $content }) { document { rowId resourceId } }
    }`, { folderId, title, content })).createDocument.document,
  updateDocument: (as: Identity, rowId: string, patch: { title?: string; content?: string; folderId?: string }) =>
    graphql(as, `mutation ($rowId: UUID!, $patch: DocumentPatch!) {
      updateDocumentByRowId(input: { rowId: $rowId, documentPatch: $patch }) { document { rowId } }
    }`, { rowId, patch }),
  readDocument: (as: Identity, rowId: string) =>
    graphql<{ documentByRowId: { title: string } | null }>(as, `query ($rowId: UUID!) { documentByRowId(rowId: $rowId) { title } }`, { rowId }),
  share: (as: Identity, resourceId: string, roleId: string, level: AccessLevel) =>
    graphql(as, `mutation ($resourceId: UUID!, $roleId: UUID!, $level: String!) {
      shareResource(input: { resourceId: $resourceId, roleId: $roleId, level: $level }) { result }
    }`, { resourceId, roleId, level }),
  comment: (as: Identity, documentId: string, body: string) =>
    graphql(as, `mutation ($documentId: UUID!, $body: String!) {
      createComment(input: { comment: { documentId: $documentId, body: $body } }) { comment { rowId } }
    }`, { documentId, body }),
  startImpersonation: (as: Identity, memberId: string, mode: "view" | "act") =>
    graphql(as, `mutation ($memberId: UUID!, $mode: String!) { startImpersonation(input: { memberId: $memberId, mode: $mode }) { member { rowId } } }`, { memberId, mode }),
  stopImpersonation: (as: Identity, memberId: string, mode: "view" | "act") =>
    graphql(as, `mutation ($memberId: UUID!, $mode: String!) { stopImpersonation(input: { memberId: $memberId, mode: $mode }) { member { rowId } } }`, { memberId, mode }),
  createApiKey: async (as: Identity, name: string) =>
    (await graphql<{ createApiKey: { token: string } }>(as, `mutation ($name: String!) { createApiKey(input: { name: $name }) { token } }`, { name })).createApiKey.token,
};

// A demo organization, built through the API, each step made by the person who would do it, then, with `mockUsers`,
// the larger mock organizations of src/mock
export const seed = async ({ mockUsers = 0, documentsPerMember, log }: { mockUsers?: number; documentsPerMember?: number; log?: (message: string) => void } = {}) => {
  const userIds = {} as Record<Person, string>;
  for (const [key, person] of Object.entries(PEOPLE) as [Person, (typeof PEOPLE)[Person]][]) {
    const { user } = await auth.api.signUpEmail({ body: { ...person, password: PASSWORD } });
    userIds[key] = user.id;
  }

  const org = await api.createOrganization({ userId: userIds.alice }, "Acme");
  const identities = async () =>
    Object.fromEntries(await Promise.all((Object.keys(PEOPLE) as Person[]).map(async (person) => [person, await memberIdentity(userIds[person], org.slug)]))) as Record<Person, Identity>;
  let { alice } = await identities();

  const members = {} as Record<Exclude<Person, "alice">, { rowId: string; roleId: string }>;
  for (const person of ["bob", "carol", "dave", "erin"] as const) members[person] = await api.inviteMember(alice!, org.rowId, PEOPLE[person].email);
  const people = await identities();
  alice = people.alice;
  const { bob, carol, dave, erin } = people;

  const engineeringTeam = await api.createTeam(alice, org.rowId, "Engineering");
  const designTeam = await api.createTeam(alice, org.rowId, "Design");
  await api.setTeamMembership(alice, engineeringTeam.rowId, members.bob.rowId, true);
  await api.setTeamMembership(alice, designTeam.rowId, members.carol.rowId, true);

  const [general] = await api.spaces(alice, org.slug);
  const engineering = await api.createFolder(alice, org.rowId, null, "Engineering");
  const design = await api.createFolder(alice, org.rowId, null, "Design");
  const leadership = await api.createFolder(alice, org.rowId, null, "Leadership");
  await api.share(alice, engineering.resourceId, engineeringTeam.roleId, "editor");
  await api.share(alice, engineering.resourceId, designTeam.roleId, "commenter");
  await api.share(alice, design.resourceId, designTeam.roleId, "editor");
  await api.share(alice, design.resourceId, engineeringTeam.roleId, "viewer");

  // Content is written by the people who can: Bob in Engineering, Carol in Design, Alice everywhere
  const handbook = await api.createFolder(alice, org.rowId, general!.rowId, "Handbook");
  await api.createDocument(alice, handbook.rowId, "Welcome to Acme", "Start here. Everyone at Acme can read and edit this space.");
  await api.createDocument(dave, handbook.rowId, "Expense policy", "Keep receipts. Anything above $500 needs a manager's approval.");

  const architecture = await api.createFolder(bob, org.rowId, engineering.rowId, "Architecture");
  const rfcs = await api.createFolder(bob, org.rowId, architecture.rowId, "RFCs");
  const rfc = await api.createDocument(bob, rfcs.rowId, "RFC 12: Permissions in Postgres", "Move access control into the database with p9s, so that every query is checked by RLS.");
  await api.createDocument(bob, architecture.rowId, "System overview", "A React app in front, PostGraphile in the middle, Postgres behind it with the permissions.");
  const runbooks = await api.createFolder(bob, org.rowId, engineering.rowId, "Runbooks");
  await api.createDocument(bob, runbooks.rowId, "On-call checklist", "1. Check the dashboards\n2. Check the queues\n3. Write down what you did");

  const brand = await api.createFolder(carol, org.rowId, design.rowId, "Brand");
  const guidelines = await api.createDocument(carol, brand.rowId, "Brand guidelines", "Our logo is a tree. Keep space around it.");
  await api.createFolder(carol, org.rowId, design.rowId, "Research");

  const board = await api.createFolder(alice, org.rowId, leadership.rowId, "Board");
  await api.createDocument(alice, board.rowId, "Q3 board deck", "Revenue is up, burn is down.");
  const hiring = await api.createDocument(alice, leadership.rowId, "Engineering hiring plan", "Two backend engineers and one designer next quarter.");

  // Bob may comment on the hiring plan, without seeing anything else of Leadership
  await api.share(alice, hiring.resourceId, members.bob.roleId, "commenter");
  // Erin, a contractor in no team, edits the runbooks and nothing else of Engineering
  await api.share(alice, runbooks.resourceId, members.erin.roleId, "editor");

  await api.comment(carol, rfc.rowId, "Can the share dialog show where access comes from?");
  await api.comment(bob, rfc.rowId, "Yes: it lists the assignments on the document and on every folder above it.");
  await api.comment(alice, guidelines.rowId, "Looks great. Can we get the logo as SVG?");
  await api.comment(bob, hiring.rowId, "Happy to help with interviews.");

  // Bob also has an organization of his own, that nobody at Acme can see
  const sideProject = await api.createOrganization({ userId: userIds.bob }, "Bob's side project");
  const bobAlone = await memberIdentity(userIds.bob, sideProject.slug);
  await api.createDocument(bobAlone, (await api.spaces(bobAlone, sideProject.slug))[0]!.rowId, "Ideas", "A to-do app, but with permissions.");

  const apiKey = await api.createApiKey(bob, "CI");
  const mock = mockUsers > 0 ? await seedMock({ users: mockUsers, documentsPerMember, log }) : [];
  return { org, apiKey, userIds, members, people, mock };
};

// bun run db:seed [--users 3000] [--documents-per-member 55]
if (import.meta.main) {
  const option = (name: string) => {
    const flag = process.argv.indexOf(name);
    return flag >= 0 ? Number(process.argv[flag + 1]) : undefined;
  };
  const mockUsers = option("--users") ?? DEFAULT_MOCK_USERS;
  const documentsPerMember = option("--documents-per-member");
  const { rows } = await pool.query(`select 1 from "user" where email = $1`, [PEOPLE.alice.email]);
  if (rows.length) {
    console.log("Already seeded. Drop and recreate the database to start again.");
  } else {
    const { org, apiKey, mock } = await seed({ mockUsers, documentsPerMember, log: (message) => console.log(`  ${message}`) });
    console.log(`\nSeeded the ${org.name} organization. Sign in as any of these, with the password ${PASSWORD}:`);
    for (const person of Object.values(PEOPLE)) console.log(`  ${person.email.padEnd(20)} ${person.name}`);
    console.log(`\nAPI key of Bob: ${apiKey}`);
    console.log(`  curl -H "Authorization: Bearer ${apiKey}" -H "content-type: application/json" \\`);
    console.log(`    -d '{"query": "{ currentMember { name } }"}' http://localhost:3200/graphql`);
    if (mock.length) {
      console.log(`\nMock users, all with the password ${MOCK_PASSWORD}:`);
      for (const example of mockExamples(mockUsers)) {
        console.log(`  ${example.name}: ${mockEmail(example.first)} to ${mockEmail(example.last)}`);
        for (const account of example.accounts) console.log(`    ${account.email.padEnd(24)} ${account.who}`);
      }
      const [globex] = mock;
      console.log(`\nEvery 20th member has an API key, like ${globex!.people[0]!.apiToken} for ${mockEmail(globex!.people[0]!.n)} at ${globex!.org.name}`);
    }
  }
  await pgl.release();
  await pool.end();
}
