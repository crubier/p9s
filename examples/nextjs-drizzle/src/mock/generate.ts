import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { sql } from "drizzle-orm";
import { ACCESS_LEVELS, type AccessLevel } from "../../lib/permissions";
import { db, rows, switchToGraphWriter } from "../db";
import { account, apiKey, comment, document, folder, member, team, user } from "../schema";
import * as service from "../service";
import { MOCK_PASSWORD, mockEmail, mockMember, mockName, mockOrganizations, type MockMember, type MockOrganization } from "./people";

// Mock organizations, the same on every run: thousands of members in teams, spaces with nested folders, documents,
// comments, shares and API keys, then a month of activity.
//
// The bulk of it is inserted as the owner of the tables, in large statements: p9s triggers run once per statement, so
// this takes seconds, and the audit triggers stay quiet. The month of activity is then played through the functions
// of the app, each one acting as a member, so that RLS checks it and the audit log records it as in production.

export interface MockOptions {
  users: number;
  // Documents in each organization, for each of its members
  documentsPerMember?: number;
  // Actions played through the app after the bulk insert, in each organization
  actions?: number;
  log?: (message: string) => void;
}

// mulberry32: a small deterministic random generator
const createRandom = (seed: number) => {
  let state = seed;
  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  const pick = <T>(items: readonly T[]) => items[Math.floor(next() * items.length)]!;
  const sample = <T>(items: readonly T[], count: number) => {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    }
    return copy.slice(0, count);
  };
  return { next, int, pick, sample, chance: (probability: number) => next() < probability };
};

type Random = ReturnType<typeof createRandom>;

const range = (first: number, last: number) => Array.from({ length: Math.max(0, last - first + 1) }, (_, index) => first + index);

const inChunks = async <T>(items: T[], size: number, fn: (chunk: T[]) => Promise<unknown>) => {
  for (let index = 0; index < items.length; index += size) await fn(items.slice(index, index + size));
};

const array = (values: string[], type: "uuid" | "text") => sql`${`{${values.join(",")}}`}::${sql.raw(type)}[]`;

export const mockUserId = (n: number) => `mock-${String(n).padStart(4, "0")}`;

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY);
const sometime = (random: Random, minDays: number, maxDays: number) => daysAgo(minDays + random.next() * (maxDays - minDays));

// Text

const THEMES: Record<string, string[]> = {
  Engineering: ["Architecture", "RFCs", "Runbooks", "Postmortems", "Onboarding", "Services", "Security", "Platform"],
  Product: ["Roadmap", "Specs", "Research", "Launches", "Metrics", "Feedback"],
  Design: ["Brand", "Design system", "Research", "Explorations", "Illustrations", "Reviews"],
  Sales: ["Playbooks", "Accounts", "Proposals", "Pricing", "Enablement", "Forecasts"],
  Marketing: ["Campaigns", "Content", "Events", "Brand", "Analytics", "Press"],
  "Customer Success": ["Playbooks", "Accounts", "Escalations", "Training", "Feedback"],
  Support: ["Macros", "Escalations", "Known issues", "Training", "Feedback"],
  Finance: ["Budgets", "Reports", "Invoices", "Policies", "Audits", "Forecasts"],
  People: ["Policies", "Hiring", "Onboarding", "Benefits", "Reviews", "Culture"],
  Legal: ["Contracts", "Policies", "Compliance", "Templates", "Trademarks"],
  Operations: ["Vendors", "Facilities", "Processes", "Travel", "IT", "Security"],
  General: ["Handbook", "Announcements", "Events", "Social", "Ideas"],
  Company: ["Policies", "Benefits", "All hands", "Strategy", "Offices"],
  Leadership: ["Board", "Strategy", "Hiring plans", "Budgets", "Offsites"],
  Project: ["Specs", "Meeting notes", "Retrospectives", "Research", "Launch"],
};
const SUBFOLDERS = ["2024", "2025", "2026", "Q1", "Q2", "Q3", "Q4", "Archive", "Drafts", "Templates", "Team notes", "Reviews", "EMEA", "Americas", "APAC", "Internal", "Partners"];
const SUBJECTS = [
  "onboarding", "hiring", "budget", "launch", "migration", "pricing", "renewals", "Q1 goals", "Q2 goals", "offsite", "vendor selection", "security review",
  "customer interviews", "partnership", "rebrand", "data retention", "incident response", "business review", "OKRs", "tooling", "on-call", "performance",
  "accessibility", "localization", "compliance", "travel policy", "expense policy", "roadmap", "churn", "pipeline", "release", "pilot",
];
const KINDS = [
  "overview", "plan", "notes", "checklist", "proposal", "review", "retrospective", "guide", "FAQ", "template", "report", "decision log", "brief", "spec",
  "summary", "meeting notes", "playbook", "draft", "postmortem", "timeline",
];
const SENTENCES = [
  "This page covers the {subject} for {team}.",
  "{person} owns the next steps and will report back by {date}.",
  "We expect about {number}% of the work to be done this quarter.",
  "Open questions are listed at the end, add yours in the comments.",
  "Decisions are final once two leads approve them.",
  "See the other pages of this folder for background.",
  "Budget impact: about ${number}k, already approved.",
  "Feedback from the last review has been folded in.",
  "The main risk is timing: the {subject} depends on other teams.",
  "Status: on track.",
  "Status: at risk, {person} is looking into it.",
  "Next review: {date}.",
  "{team} agreed to keep the scope small and ship early.",
  "Numbers are from the dashboard, as of {date}.",
  "Ask {person} before changing this page.",
];
const COMMENTS = [
  "Looks good to me.", "Can we add the numbers for last quarter?", "+1", "I left a few suggestions.", "Who owns this?", "Let's discuss it in the next sync.",
  "Approved.", "This needs a legal review first.", "Great work!", "Updated with the latest figures.", "Is this still current?", "Shared it with my team.",
  "Can we move this to the archive?", "Thanks, this is very clear.", "I disagree with the second point.", "Adding this to the agenda.",
];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export const DOCUMENTS_PER_MEMBER = 55;
const DOCUMENTS_PER_FOLDER = 30;
const MAX_CHILDREN = 12;
const MAX_DEPTH = 5;

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const FOLDER_NAMES = [...new Set([...SUBFOLDERS, ...MONTHS, ...SUBJECTS.map(capitalize)])];

const fill = (random: Random, template: string, context: { team: string; people: Person[] }) =>
  template
    .replace("{subject}", random.pick(SUBJECTS))
    .replace("{team}", context.team)
    .replace("{person}", context.people.length ? random.pick(context.people).name : "someone")
    .replace("{date}", `${random.pick(MONTHS)} ${random.int(1, 28)}`)
    .replace("{number}", String(random.int(5, 95)));

const title = (random: Random) => capitalize(`${random.pick(SUBJECTS)} ${random.pick(KINDS)}`);

const content = (random: Random, context: { team: string; people: Person[] }) =>
  Array.from({ length: random.int(1, 4) }, () => Array.from({ length: random.int(2, 4) }, () => fill(random, random.pick(SENTENCES), context)).join(" ")).join("\n\n");

// The organization being generated

interface Person extends MockMember {
  userId: string;
  name: string;
  memberId: string;
  roleId: string;
  apiToken?: string;
}

interface Space {
  name: string;
  folderId: string;
  theme: string;
  // Who can write in the space, to author its documents and comments
  writers: Person[];
  folders: { id: string; name: string; parentId: string | null; depth: number }[];
  documents: { id: string; folderId: string; title: string; content: string }[];
}

export const seedMock = async ({ users, documentsPerMember = DOCUMENTS_PER_MEMBER, actions = Math.round(users / 15), log = () => {} }: MockOptions) => {
  const started = Date.now();
  const random = createRandom(42);
  const password = await hashPassword(MOCK_PASSWORD);
  const userRows = range(1, users).map((n) => ({
    id: mockUserId(n), name: mockName(n), email: mockEmail(n), emailVerified: true, createdAt: daysAgo(400 - (n % 30)), updatedAt: daysAgo(400 - (n % 30)),
  }));
  await inChunks(userRows, 1000, (chunk) => db.insert(user).values(chunk));
  await inChunks(userRows, 1000, (chunk) =>
    db.insert(account).values(chunk.map((row) => ({ id: `${row.id}-credential`, accountId: row.id, providerId: "credential", userId: row.id, password, createdAt: row.createdAt, updatedAt: row.createdAt }))),
  );
  log(`${users} users`);

  const organizations = [];
  for (const org of mockOrganizations(users)) organizations.push(await seedOrganization(org, random, { documentsPerMember, actions, log }));
  log(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  return organizations;
};

const seedOrganization = async (
  definition: MockOrganization,
  random: Random,
  { documentsPerMember, actions, log }: { documentsPerMember: number; actions: number; log: (message: string) => void },
) => {
  const started = Date.now();
  const created = await service.createOrganization(mockUserId(definition.first), definition.name);
  const orgInfo = { id: created.id, name: created.name, slug: created.slug, resourceId: created.resourceId!, roleId: created.roleId! };

  // Members
  const numbers = range(definition.first, definition.last);
  await inChunks(numbers.slice(1), 1000, (chunk) =>
    db.insert(member).values(chunk.map((n) => ({ orgId: created.id, userId: mockUserId(n), createdAt: sometime(random, 31, 390) }))),
  );
  const memberRows = new Map(
    (await rows<{ id: string; roleId: string; userId: string }>(db, sql`select id, role_id as "roleId", user_id as "userId" from member where org_id = ${created.id}`))
      .map((row) => [row.userId, row]),
  );
  const people: Person[] = numbers.map((n) => {
    const row = memberRows.get(mockUserId(n))!;
    return { ...mockMember(definition, n), userId: mockUserId(n), name: mockName(n), memberId: row.id, roleId: row.roleId };
  });
  const regulars = people.filter((person) => !person.guest);
  const actorOf = (person: Person): service.Actor => ({ userId: person.userId, memberId: person.memberId, name: person.name, roleId: person.roleId, org: orgInfo });

  // Teams: one per department, and squads of people from several departments
  const squadNames = definition.squads.map((name) => `${name} squad`);
  await db.insert(team).values([...definition.departments, ...squadNames].map((name) => ({ orgId: created.id, name, createdAt: daysAgo(395) })));
  const teams = new Map(
    (await rows<{ id: string; name: string; roleId: string }>(db, sql`select id, name, role_id as "roleId" from team where org_id = ${created.id}`)).map((row) => [row.name, row]),
  );
  const squads = new Map(squadNames.map((name) => [name, random.sample(regulars, random.int(6, 16))]));
  const edges: [string, string][] = [
    ...people.filter((person) => person.admin && person.index > 0).map((person): [string, string] => [teams.get("Admins")!.roleId, person.roleId]),
    ...regulars.map((person): [string, string] => [teams.get(person.department!)!.roleId, person.roleId]),
    ...[...squads].flatMap(([name, squad]) => squad.map((person): [string, string] => [teams.get(name)!.roleId, person.roleId])),
  ];
  await db.transaction(async (tx) => {
    await switchToGraphWriter(tx);
    await inChunks(edges, 5000, (chunk) =>
      tx.execute(sql`
        insert into role_edge (parent_id, child_id, permission)
        select parent, child, b'11111111' from unnest(${array(chunk.map((edge) => edge[0]), "uuid")}, ${array(chunk.map((edge) => edge[1]), "uuid")}) as t(parent, child)
        on conflict do nothing`),
    );
  });

  // Spaces, with who writes in them
  const byDepartment = (department: string) => regulars.filter((person) => person.department === department);
  const admins = people.filter((person) => person.admin);
  const [general] = await rows<{ id: string }>(db, sql`select id from folder where org_id = ${created.id} and parent_id is null`);
  const spaces: Space[] = [
    { name: "General", folderId: general!.id, theme: "General", writers: regulars, folders: [], documents: [] },
    { name: "Company", folderId: randomUUID(), theme: "Company", writers: [...admins, ...byDepartment("People")], folders: [], documents: [] },
    { name: "Leadership", folderId: randomUUID(), theme: "Leadership", writers: people.filter((person) => person.admin || (person.lead && person.index < definition.departments.length)), folders: [], documents: [] },
    ...definition.departments.map((department) => ({ name: department, folderId: randomUUID(), theme: department, writers: byDepartment(department), folders: [], documents: [] })),
    ...definition.squads.map((name) => ({ name: `Project ${name}`, folderId: randomUUID(), theme: "Project", writers: squads.get(`${name} squad`)!, folders: [], documents: [] })),
  ];

  // How many documents each space gets: most are in the spaces everyone reads, a wiki that grew over the years
  const budget = people.length * documentsPerMember;
  const shareOf = (space: Space) =>
    ({ General: 0.6, Company: 0.15, Leadership: 0.02 })[space.name] ??
    (space.theme === "Project" ? 0.08 / definition.squads.length : 0.15 / definition.departments.length);
  const documentCount = new Map(spaces.map((space) => [space, Math.max(5, Math.round(budget * shareOf(space)))]));

  // Folders, about one for every DOCUMENTS_PER_FOLDER documents, a few levels deep. They are inserted level by level
  // since a folder's parent must exist
  for (const space of spaces) {
    space.folders.push({ id: space.folderId, name: space.name, parentId: null, depth: 0 });
    const wanted = Math.max(4, Math.round(documentCount.get(space)! / DOCUMENTS_PER_FOLDER));
    // Folders that can still get children, with the names their children have
    const open: { id: string; depth: number; names: Set<string> }[] = [];
    for (const name of random.sample(THEMES[space.theme] ?? THEMES.Project!, random.int(4, 8))) {
      const top = { id: randomUUID(), name, parentId: space.folderId, depth: 1 };
      space.folders.push(top);
      open.push({ ...top, names: new Set() });
    }
    while (space.folders.length <= wanted && open.length) {
      const index = Math.floor(random.next() * open.length);
      const parent = open[index]!;
      const name = random.pick(FOLDER_NAMES);
      if (parent.names.has(name)) continue;
      parent.names.add(name);
      if (parent.names.size >= MAX_CHILDREN) open.splice(index, 1);
      const child = { id: randomUUID(), name, parentId: parent.id, depth: parent.depth + 1 };
      space.folders.push(child);
      if (child.depth < MAX_DEPTH) open.push({ ...child, names: new Set() });
    }
  }
  const allFolders = spaces.flatMap((space) => space.folders);
  for (const depth of range(0, MAX_DEPTH)) {
    const level = allFolders.filter((row) => row.depth === depth && row.id !== general!.id);
    await inChunks(level, 1000, (chunk) =>
      db.insert(folder).values(chunk.map((row) => ({ id: row.id, orgId: created.id, parentId: row.parentId, name: row.name, createdAt: sometime(random, 200, 390) }))),
    );
  }

  // Documents and comments, written by the people who can write in each space
  const documentRows: (typeof document.$inferInsert)[] = [];
  const commentRows: (typeof comment.$inferInsert)[] = [];
  for (const space of spaces) {
    if (!space.writers.length) continue;
    const context = { team: space.name, people: space.writers };
    // A few documents at the top of the space, the others anywhere in its folders
    const inside = space.folders.slice(1);
    for (let count = documentCount.get(space)!, top = random.int(1, 4); count > 0; count--, top--) {
      const id = randomUUID();
      const createdAt = 35 + random.next() * 345;
      const row = { id, folderId: top > 0 ? space.folderId : random.pick(inside).id, title: title(random), content: content(random, context) };
      space.documents.push(row);
      documentRows.push({ ...row, createdBy: random.pick(space.writers).memberId, createdAt: daysAgo(createdAt), updatedAt: sometime(random, 31, createdAt) });
      for (let comments = Math.floor(random.next() ** 3 * 4); comments > 0; comments--) {
        commentRows.push({ documentId: id, memberId: random.pick(space.writers).memberId, body: random.pick(COMMENTS), createdAt: sometime(random, 31, createdAt) });
      }
    }
  }
  await inChunks(documentRows, 2000, (chunk) => db.insert(document).values(chunk));
  await inChunks(commentRows, 2000, (chunk) => db.insert(comment).values(chunk));

  // Shares
  const resourceIds = new Map(
    (await rows<{ id: string; resourceId: string }>(db, sql`
      select id, resource_id as "resourceId" from folder where org_id = ${created.id}
      union all
      select d.id, d.resource_id from document d join folder f on f.id = d.folder_id where f.org_id = ${created.id}`)).map((row) => [row.id, row.resourceId]),
  );
  const assignments = new Map<string, { resourceId: string; roleId: string; level: AccessLevel }>();
  const assign = (id: string, roleId: string, level: AccessLevel) => {
    const resourceId = resourceIds.get(id)!;
    assignments.set(`${resourceId}:${roleId}`, { resourceId, roleId, level });
  };
  const spaceNamed = (name: string) => spaces.find((space) => space.name === name)!;
  assign(spaceNamed("Company").folderId, orgInfo.roleId, "viewer");
  if (teams.has("People")) assign(spaceNamed("Company").folderId, teams.get("People")!.roleId, "editor");
  for (const person of spaceNamed("Leadership").writers) if (!person.admin) assign(spaceNamed("Leadership").folderId, person.roleId, "editor");
  definition.departments.forEach((department, index) => {
    const space = spaceNamed(department);
    assign(space.folderId, teams.get(department)!.roleId, "editor");
    assign(space.folderId, teams.get(definition.departments[(index + 1) % definition.departments.length]!)!.roleId, "viewer");
    for (const lead of byDepartment(department).filter((person) => person.lead)) assign(space.folderId, lead.roleId, "manager");
  });
  definition.squads.forEach((name, index) => {
    const space = spaceNamed(`Project ${name}`);
    assign(space.folderId, teams.get(`${name} squad`)!.roleId, "editor");
    if (index % 2 === 0) assign(space.folderId, orgInfo.roleId, "viewer");
  });
  // Single folders and documents shared with people outside the space
  const items = (space: Space) => [...space.folders.filter((row) => row.depth > 0).map((row) => row.id), ...space.documents.map((row) => row.id)];
  for (const space of spaces.filter((space) => space.name !== "General")) {
    for (const id of random.sample(items(space), 15)) assign(id, random.pick(regulars).roleId, random.pick(["viewer", "commenter", "editor"] as const));
  }
  const departmentSpaces = definition.departments.map(spaceNamed);
  for (const guest of people.filter((person) => person.guest)) {
    for (let count = random.int(1, 3); count > 0; count--) assign(random.pick(items(random.pick(departmentSpaces))), guest.roleId, random.pick(["commenter", "editor"] as const));
  }
  const assignmentList = [...assignments.values()];
  await db.transaction(async (tx) => {
    await switchToGraphWriter(tx);
    await inChunks(assignmentList, 2000, (chunk) =>
      tx.execute(sql`
        insert into assignment_edge (resource_id, role_id, permission)
        select r, ro, p::bit(8) from unnest(${array(chunk.map((row) => row.resourceId), "uuid")}, ${array(chunk.map((row) => row.roleId), "uuid")},
          ${array(chunk.map((row) => ACCESS_LEVELS[row.level].permission), "text")}) as t(r, ro, p)
        on conflict do nothing`),
    );
  });

  // Every 20th member has an API key, with a token as predictable as their password
  const withKeys = people.filter((person) => person.index % 20 === 0);
  for (const person of withKeys) person.apiToken = `p9s_${created.slug}_${mockEmail(person.n).split("@")[0]}`;
  await db.insert(apiKey).values(withKeys.map((person) => ({
    memberId: person.memberId, name: "Laptop", tokenHash: service.hashToken(person.apiToken!), tokenStart: person.apiToken!.slice(0, 12), createdAt: daysAgo(60),
  })));

  log(
    `${definition.name}: ${people.length} members, ${teams.size} teams, ${spaces.length} spaces, ${allFolders.length} folders, ` +
      `${documentRows.length} documents, ${commentRows.length} comments, ${assignmentList.length} shares, ${withKeys.length} API keys ` +
      `in ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );

  const failures = await playActivity({ random, actions, people, spaces, teams, actorOf });
  log(`${definition.name}: ${actions} actions through the app${failures ? `, ${failures} refused` : ""}`);
  await spreadOverLastMonth(created.id);
  return { org: created, people, spaces };
};

// A month of activity, played through the functions of the app as the members who would do it
const playActivity = async ({ random, actions, people, spaces, teams, actorOf }: {
  random: Random;
  actions: number;
  people: Person[];
  spaces: Space[];
  teams: Map<string, { id: string; roleId: string }>;
  actorOf: (person: Person) => service.Actor;
}) => {
  const owner = actorOf(people[0]!);
  const active = spaces.filter((space) => space.writers.length && space.documents.length);
  const projects = spaces.filter((space) => space.theme === "Project");
  const regulars = people.filter((person) => !person.guest);
  const admins = people.filter((person) => person.admin);
  // Who joined a squad during the month, and may leave it again
  const joined = new Map<Space, Person[]>();
  let failures = 0;
  const kinds = [
    ["edit", 30], ["comment", 25], ["create", 12], ["rename", 5], ["move", 5], ["share", 8], ["team", 5], ["impersonate", 5], ["api", 5],
  ] as const;
  const total = kinds.reduce((sum, [, weight]) => sum + weight, 0);
  for (let count = 0; count < actions; count++) {
    let roll = random.next() * total;
    const kind = kinds.find(([, weight]) => (roll -= weight) < 0)![0];
    const space = random.pick(active);
    const writer = random.pick(space.writers);
    const doc = random.pick(space.documents);
    const context = { team: space.name, people: space.writers };
    try {
      switch (kind) {
        case "edit":
          doc.content = `${doc.content}\n\n${fill(random, random.pick(SENTENCES), context)}`;
          await service.updateDocument(actorOf(writer), doc.id, { content: doc.content });
          break;
        case "comment":
          await service.addComment(actorOf(writer), doc.id, random.pick(COMMENTS));
          break;
        case "create": {
          const into = random.pick(space.folders);
          const row = { id: "", folderId: into.id, title: title(random), content: content(random, context) };
          row.id = await service.createDocument(actorOf(writer), into.id, row.title, row.content);
          space.documents.push(row);
          break;
        }
        case "rename":
          doc.title = title(random);
          await service.updateDocument(actorOf(writer), doc.id, { title: doc.title });
          break;
        case "move":
          doc.folderId = random.pick(space.folders).id;
          await service.moveDocument(actorOf(writer), doc.id, doc.folderId);
          break;
        case "share": {
          // Leads have full access to their department's space, admins everywhere
          const lead = people.find((person) => person.lead && person.department === space.name);
          const sharer = lead ? actorOf(lead) : owner;
          const target = random.pick(regulars);
          const resourceId = (await service.getDocument(sharer, doc.id)).document.resourceId;
          await service.share(sharer, resourceId, target.roleId, random.pick(["viewer", "commenter"] as const));
          break;
        }
        case "team": {
          const project = random.pick(projects);
          const squad = teams.get(`${project.name.replace(/^Project /, "")} squad`)!;
          const newcomers = joined.get(project) ?? [];
          if (newcomers.length && random.chance(0.3)) {
            const leaving = newcomers.pop()!;
            await service.setTeamMembership(actorOf(random.pick(admins)), squad.id, leaving.memberId, false);
            project.writers = project.writers.filter((person) => person !== leaving);
          } else {
            const joining = random.pick(regulars.filter((person) => !project.writers.includes(person)));
            await service.setTeamMembership(actorOf(random.pick(admins)), squad.id, joining.memberId, true);
            project.writers.push(joining);
            joined.set(project, [...newcomers, joining]);
          }
          break;
        }
        case "impersonate": {
          // An admin checks what a member sees, or fixes something on their behalf
          if (writer.admin) break;
          const admin = actorOf(random.pick(admins));
          const mode = random.chance(0.5) ? "view" : "act";
          await service.startImpersonation(admin, writer.memberId, mode);
          const as = (await service.impersonated(admin, writer.memberId, mode))!;
          await service.getDocument(as, doc.id);
          if (mode === "act") await service.updateDocument(as, doc.id, { content: (doc.content = `${doc.content}\n\nFixed a typo.`) });
          await service.stopImpersonation(as);
          break;
        }
        case "api": {
          const holder = people.find((person) => person.apiToken && space.writers.includes(person));
          if (!holder) break;
          const viaKey = (await service.actorFromApiKey(holder.apiToken!))!;
          const into = random.pick(space.folders);
          const row = { id: "", folderId: into.id, title: `Imported: ${title(random).toLowerCase()}`, content: content(random, context) };
          row.id = await service.createDocument(viaKey, into.id, row.title, row.content);
          space.documents.push(row);
          break;
        }
      }
    } catch {
      failures++;
    }
  }
  return failures;
};

// The actions were all played now: spread them over the last month, in the same order, and date what they changed
const spreadOverLastMonth = async (orgId: string) => {
  await db.execute(sql`
    with ordered as (
      select id, row_number() over (order by created_at, id) as position, count(*) over () as total
      from audit_event where org_id = ${orgId} and subject_kind <> 'organization'
    )
    update audit_event e set created_at = now() - interval '30 days' * (1 - (ordered.position - random() * 0.9)::float / ordered.total)
    from ordered where e.id = ordered.id`);
  await db.execute(sql`update audit_event set created_at = now() - interval '400 days' where org_id = ${orgId} and subject_kind = 'organization'`);
  await db.execute(sql`
    update document d set updated_at = e.at, created_at = least(d.created_at, e.at)
    from (
      select subject_id, max(created_at) as at from audit_event
      where org_id = ${orgId} and subject_kind = 'document' and action in ('created', 'edited', 'renamed', 'moved')
      group by subject_id
    ) e
    where d.id = e.subject_id`);
  await db.execute(sql`
    update comment c set created_at = now() - random() * interval '30 days'
    from document d join folder f on f.id = d.folder_id
    where c.document_id = d.id and f.org_id = ${orgId} and c.created_at > now() - interval '1 day'`);
};
