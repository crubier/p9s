import { eq } from "drizzle-orm";
import { auth } from "./auth";
import { db, pool } from "./db";
import { seedMock } from "./mock/generate";
import { DEFAULT_MOCK_USERS, MOCK_PASSWORD, mockEmail, mockExamples } from "./mock/people";
import { user } from "./schema";
import * as service from "./service";
import type { Actor } from "./service";

export const PASSWORD = "password1234";

export const PEOPLE = {
  alice: { name: "Alice Admin", email: "alice@acme.test" },
  bob: { name: "Bob Builder", email: "bob@acme.test" },
  carol: { name: "Carol Designer", email: "carol@acme.test" },
  dave: { name: "Dave Sales", email: "dave@acme.test" },
  erin: { name: "Erin Contractor", email: "erin@acme.test" },
} as const;

type Person = keyof typeof PEOPLE;

// A demo organization, built with the same functions as the app, each one acting as the person who would do it,
// then, with `mockUsers`, the larger mock organizations of src/mock
export const seed = async ({ mockUsers = 0, documentsPerMember, log }: { mockUsers?: number; documentsPerMember?: number; log?: (message: string) => void } = {}) => {
  const userIds = {} as Record<Person, string>;
  for (const [key, person] of Object.entries(PEOPLE) as [Person, (typeof PEOPLE)[Person]][]) {
    const { user: created } = await auth.api.signUpEmail({ body: { ...person, password: PASSWORD } });
    userIds[key] = created.id;
  }

  const org = await service.createOrganization(userIds.alice, "Acme");
  const actor = async (person: Person) => (await service.getActor(userIds[person], org.slug))!;
  const alice = await actor("alice");

  for (const person of ["bob", "carol", "dave", "erin"] as const) await service.inviteMember(alice, PEOPLE[person].email);
  const [bob, carol, dave, erin] = await Promise.all((["bob", "carol", "dave", "erin"] as const).map(actor));

  await service.createTeam(alice, "Engineering");
  await service.createTeam(alice, "Design");
  const teams = Object.fromEntries((await service.listTeams(alice)).map((row) => [row.name, row]));
  await service.setTeamMembership(alice, teams.Engineering!.id, bob!.memberId, true);
  await service.setTeamMembership(alice, teams.Design!.id, carol!.memberId, true);

  const spaces = Object.fromEntries((await service.listSpaces(alice)).map((row) => [row.name, row]));
  const general = spaces.General!;
  const engineering = await service.createFolder(alice, null, "Engineering");
  const design = await service.createFolder(alice, null, "Design");
  const leadership = await service.createFolder(alice, null, "Leadership");
  const resourceOf = async (folderId: string) => (await service.getFolder(alice, folderId)).folder.resourceId;
  await service.share(alice, await resourceOf(engineering), teams.Engineering!.roleId, "editor");
  await service.share(alice, await resourceOf(engineering), teams.Design!.roleId, "commenter");
  await service.share(alice, await resourceOf(design), teams.Design!.roleId, "editor");
  await service.share(alice, await resourceOf(design), teams.Engineering!.roleId, "viewer");

  // Content is written by the people who can: Bob in Engineering, Carol in Design, Alice everywhere
  const handbook = await service.createFolder(alice, general.id, "Handbook");
  await service.createDocument(alice, handbook, "Welcome to Acme", "Start here. Everyone at Acme can read and edit this space.");
  await service.createDocument(dave, handbook, "Expense policy", "Keep receipts. Anything above $500 needs a manager's approval.");

  const architecture = await service.createFolder(bob!, engineering, "Architecture");
  const rfcs = await service.createFolder(bob!, architecture, "RFCs");
  const rfc = await service.createDocument(bob!, rfcs, "RFC 12: Permissions in Postgres", "Move access control into the database with p9s, so that every query is checked by RLS.");
  await service.createDocument(bob!, architecture, "System overview", "Next.js in front, Postgres behind, permissions in between.");
  const runbooks = await service.createFolder(bob!, engineering, "Runbooks");
  await service.createDocument(bob!, runbooks, "On-call checklist", "1. Check the dashboards\n2. Check the queues\n3. Write down what you did");

  const brand = await service.createFolder(carol!, design, "Brand");
  const guidelines = await service.createDocument(carol!, brand, "Brand guidelines", "Our logo is a tree. Keep space around it.");
  await service.createFolder(carol!, design, "Research");

  const board = await service.createFolder(alice, leadership, "Board");
  await service.createDocument(alice, board, "Q3 board deck", "Revenue is up, burn is down.");
  const hiring = await service.createDocument(alice, leadership, "Engineering hiring plan", "Two backend engineers and one designer next quarter.");

  // Bob may comment on the hiring plan, without seeing anything else of Leadership
  const documentResource = async (documentId: string) => (await service.getDocument(alice, documentId)).document.resourceId;
  await service.share(alice, await documentResource(hiring), bob!.roleId, "commenter");
  // Erin, a contractor in no team, edits the runbooks and nothing else of Engineering
  await service.share(alice, await resourceOf(runbooks), erin!.roleId, "editor");

  await service.addComment(carol!, rfc, "Can the share dialog show where access comes from?");
  await service.addComment(bob!, rfc, "Yes: it lists the assignments on the document and on every folder above it.");
  await service.addComment(alice, guidelines, "Looks great. Can we get the logo as SVG?");
  await service.addComment(bob!, hiring, "Happy to help with interviews.");

  // Bob also has an organization of his own, that nobody at Acme can see
  const sideProject = await service.createOrganization(userIds.bob, "Bob's side project");
  const bobAlone = (await service.getActor(userIds.bob, sideProject.slug))!;
  await service.createDocument(bobAlone, (await service.listSpaces(bobAlone))[0]!.id, "Ideas", "A to-do app, but with permissions.");

  const apiKey = await service.createApiKey(bob!, "CI");
  const mock = mockUsers > 0 ? await seedMock({ users: mockUsers, documentsPerMember, log }) : [];
  return { org, apiKey, actors: { alice, bob: bob!, carol: carol!, dave: dave!, erin: erin! } satisfies Record<Person, Actor>, mock };
};

// bun run db:seed [--users 3000] [--documents-per-member 55]
if (import.meta.main) {
  const option = (name: string) => {
    const flag = process.argv.indexOf(name);
    return flag >= 0 ? Number(process.argv[flag + 1]) : undefined;
  };
  const mockUsers = option("--users") ?? DEFAULT_MOCK_USERS;
  const documentsPerMember = option("--documents-per-member");
  const [existing] = await db.select().from(user).where(eq(user.email, PEOPLE.alice.email));
  if (existing) {
    console.log("Already seeded. Drop and recreate the database to start again.");
  } else {
    const { org, apiKey, mock } = await seed({ mockUsers, documentsPerMember, log: (message) => console.log(`  ${message}`) });
    console.log(`\nSeeded the ${org.name} organization. Sign in as any of these, with the password ${PASSWORD}:`);
    for (const person of Object.values(PEOPLE)) console.log(`  ${person.email.padEnd(20)} ${person.name}`);
    console.log(`\nAPI key of Bob: ${apiKey}`);
    console.log(`  curl -H "Authorization: Bearer ${apiKey}" http://localhost:3000/api/v1/documents`);
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
  await pool.end();
}
