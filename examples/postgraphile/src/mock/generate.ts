import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { hashPassword } from "better-auth/crypto";
import { ACCESS_LEVELS, type AccessLevel } from "../../lib/permissions";
import { pool } from "../db";
import { fromApiKey, hashApiKey, memberIdentity, type Identity } from "../identity";
import { api } from "../seed";
import { DOCUMENTS_PER_MEMBER, MOCK_PASSWORD, mockEmail, mockMember, mockName, mockOrganizations, type MockMember, type MockOrganization } from "./people";

// Mock organizations, the same on every run: thousands of members in teams, spaces with nested folders, documents,
// comments, shares and API keys, then a month of activity.
//
// The bulk of it is inserted as the owner of the tables, in large statements: p9s triggers run once per statement, so
// this takes seconds, and the audit triggers stay quiet. The month of activity is then played through the GraphQL API,
// each request made by a member, so that RLS checks it and the audit log records it as in production.

export interface MockOptions {
  users: number;
  // Documents in each organization, for each of its members
  documentsPerMember?: number;
  // Requests made through the API after the bulk insert, in each organization
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

// Rows into a table, in one statement, with the columns of the first row: the others get their default
const insert = async (client: PoolClient | typeof pool, table: string, rows: Record<string, unknown>[], chunk = 2000) => {
  if (!rows.length) return;
  const columns = Object.keys(rows[0]!).map((column) => `"${column}"`).join(", ");
  await inChunks(rows, chunk, (part) =>
    client.query(`insert into "${table}" (${columns}) select ${columns} from json_populate_recordset(null::"${table}", $1) on conflict do nothing`, [
      JSON.stringify(part),
    ]),
  );
};

const select = async <T>(text: string, values: unknown[]) => (await pool.query(text, values)).rows as T[];

// Edges of the permission graph, written by the graph writer
const writeGraph = async (table: "role_edge" | "assignment_edge", rows: Record<string, unknown>[]) => {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('role', 'app_backend', true)");
    await insert(client, table, rows, 5000);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
};

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
  documents: { id: string; resourceId?: string; folderId: string; title: string; content: string }[];
}

export const seedMock = async ({ users, documentsPerMember = DOCUMENTS_PER_MEMBER, actions = Math.round(users / 15), log = () => {} }: MockOptions) => {
  const started = Date.now();
  const random = createRandom(42);
  const password = await hashPassword(MOCK_PASSWORD);
  const userRows = range(1, users).map((n) => ({
    id: mockUserId(n), name: mockName(n), email: mockEmail(n), email_verified: true, created_at: daysAgo(400 - (n % 30)), updated_at: daysAgo(400 - (n % 30)),
  }));
  await insert(pool, "user", userRows);
  await insert(pool, "account", userRows.map((row) => ({
    id: `${row.id}-credential`, account_id: row.id, provider_id: "credential", user_id: row.id, password, created_at: row.created_at, updated_at: row.created_at,
  })));
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
  const created = await api.createOrganization({ userId: mockUserId(definition.first) }, definition.name);
  const orgId = created.rowId;

  // Members
  const numbers = range(definition.first, definition.last);
  await insert(pool, "member", numbers.slice(1).map((n) => ({ org_id: orgId, user_id: mockUserId(n), created_at: sometime(random, 31, 390) })), 1000);
  const memberRows = new Map(
    (await select<{ id: string; role_id: string; user_id: string }>(`select id, role_id, user_id from member where org_id = $1`, [orgId])).map((row) => [row.user_id, row]),
  );
  const people: Person[] = numbers.map((n) => {
    const row = memberRows.get(mockUserId(n))!;
    return { ...mockMember(definition, n), userId: mockUserId(n), name: mockName(n), memberId: row.id, roleId: row.role_id };
  });
  const regulars = people.filter((person) => !person.guest);
  const actorOf = (person: Person): Identity => ({ userId: person.userId, roleId: person.roleId });

  // Teams: one per department, and squads of people from several departments
  const squadNames = definition.squads.map((name) => `${name} squad`);
  await insert(pool, "team", [...definition.departments, ...squadNames].map((name) => ({ org_id: orgId, name, created_at: daysAgo(395) })));
  const teams = new Map(
    (await select<{ id: string; name: string; role_id: string }>(`select id, name, role_id from team where org_id = $1`, [orgId])).map((row) => [row.name, row]),
  );
  const squads = new Map(squadNames.map((name) => [name, random.sample(regulars, random.int(6, 16))]));
  const edges: [string, string][] = [
    ...people.filter((person) => person.admin && person.index > 0).map((person): [string, string] => [teams.get("Admins")!.role_id, person.roleId]),
    ...regulars.map((person): [string, string] => [teams.get(person.department!)!.role_id, person.roleId]),
    ...[...squads].flatMap(([name, squad]) => squad.map((person): [string, string] => [teams.get(name)!.role_id, person.roleId])),
  ];
  await writeGraph("role_edge", edges.map(([parent, child]) => ({ parent_id: parent, child_id: child, permission: "11111111" })));

  // Spaces, with who writes in them
  const byDepartment = (department: string) => regulars.filter((person) => person.department === department);
  const admins = people.filter((person) => person.admin);
  const [general] = await select<{ id: string }>(`select id from folder where org_id = $1 and parent_id is null`, [orgId]);
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
    await insert(pool, "folder", level.map((row) => ({ id: row.id, org_id: orgId, parent_id: row.parentId, name: row.name, created_at: sometime(random, 200, 390) })), 1000);
  }

  // Documents and comments, written by the people who can write in each space
  const documentRows: Record<string, unknown>[] = [];
  const commentRows: Record<string, unknown>[] = [];
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
      documentRows.push({
        id, org_id: orgId, folder_id: row.folderId, title: row.title, content: row.content, created_by: random.pick(space.writers).memberId,
        created_at: daysAgo(createdAt), updated_at: sometime(random, 31, createdAt),
      });
      for (let comments = Math.floor(random.next() ** 3 * 4); comments > 0; comments--) {
        commentRows.push({ document_id: id, member_id: random.pick(space.writers).memberId, body: random.pick(COMMENTS), created_at: sometime(random, 31, createdAt) });
      }
    }
  }
  await insert(pool, "document", documentRows);
  await insert(pool, "comment", commentRows);

  // Shares
  const resourceIds = new Map(
    (await select<{ id: string; resource_id: string }>(`select id, resource_id from folder where org_id = $1 union all select id, resource_id from document where org_id = $1`, [orgId]))
      .map((row) => [row.id, row.resource_id]),
  );
  for (const space of spaces) for (const row of space.documents) row.resourceId = resourceIds.get(row.id);
  const assignments = new Map<string, { resource_id: string; role_id: string; permission: string }>();
  const assign = (id: string, roleId: string, level: AccessLevel) => {
    const resourceId = resourceIds.get(id)!;
    assignments.set(`${resourceId}:${roleId}`, { resource_id: resourceId, role_id: roleId, permission: ACCESS_LEVELS[level].permission });
  };
  const spaceNamed = (name: string) => spaces.find((space) => space.name === name)!;
  assign(spaceNamed("Company").folderId, created.roleId, "viewer");
  if (teams.has("People")) assign(spaceNamed("Company").folderId, teams.get("People")!.role_id, "editor");
  for (const person of spaceNamed("Leadership").writers) if (!person.admin) assign(spaceNamed("Leadership").folderId, person.roleId, "editor");
  definition.departments.forEach((department, index) => {
    const space = spaceNamed(department);
    assign(space.folderId, teams.get(department)!.role_id, "editor");
    assign(space.folderId, teams.get(definition.departments[(index + 1) % definition.departments.length]!)!.role_id, "viewer");
    for (const lead of byDepartment(department).filter((person) => person.lead)) assign(space.folderId, lead.roleId, "manager");
  });
  definition.squads.forEach((name, index) => {
    const space = spaceNamed(`Project ${name}`);
    assign(space.folderId, teams.get(`${name} squad`)!.role_id, "editor");
    if (index % 2 === 0) assign(space.folderId, created.roleId, "viewer");
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
  await writeGraph("assignment_edge", assignmentList);

  // Every 20th member has an API key, with a token as predictable as their password
  const withKeys = people.filter((person) => person.index % 20 === 0);
  for (const person of withKeys) person.apiToken = `p9s_${created.slug}_${mockEmail(person.n).split("@")[0]}`;
  await insert(pool, "api_key", withKeys.map((person) => ({
    member_id: person.memberId, name: "Laptop", token_hash: hashApiKey(person.apiToken!), token_start: person.apiToken!.slice(0, 12), created_at: daysAgo(60),
  })));

  log(
    `${definition.name}: ${people.length} members, ${teams.size} teams, ${spaces.length} spaces, ${allFolders.length} folders, ` +
      `${documentRows.length} documents, ${commentRows.length} comments, ${assignmentList.length} shares, ${withKeys.length} API keys ` +
      `in ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );

  const failures = await playActivity({ random, actions, people, spaces, teams, actorOf, slug: created.slug });
  log(`${definition.name}: ${actions} requests through the API${failures ? `, ${failures} refused` : ""}`);
  await spreadOverLastMonth(orgId);
  return { org: created, people, spaces };
};

// A month of activity, played through the GraphQL API by the members who would do it
const playActivity = async ({ random, actions, people, spaces, teams, actorOf, slug }: {
  random: Random;
  actions: number;
  people: Person[];
  spaces: Space[];
  teams: Map<string, { id: string; role_id: string }>;
  actorOf: (person: Person) => Identity;
  slug: string;
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
          await api.updateDocument(actorOf(writer), doc.id, { content: doc.content });
          break;
        case "comment":
          await api.comment(actorOf(writer), doc.id, random.pick(COMMENTS));
          break;
        case "create": {
          const into = random.pick(space.folders);
          const row = { id: "", resourceId: "", folderId: into.id, title: title(random), content: content(random, context) };
          ({ rowId: row.id, resourceId: row.resourceId } = await api.createDocument(actorOf(writer), into.id, row.title, row.content));
          space.documents.push(row);
          break;
        }
        case "rename":
          doc.title = title(random);
          await api.updateDocument(actorOf(writer), doc.id, { title: doc.title });
          break;
        case "move":
          doc.folderId = random.pick(space.folders).id;
          await api.updateDocument(actorOf(writer), doc.id, { folderId: doc.folderId });
          break;
        case "share": {
          // Leads have full access to their department's space, admins everywhere
          const lead = people.find((person) => person.lead && person.department === space.name);
          await api.share(lead ? actorOf(lead) : owner, doc.resourceId!, random.pick(regulars).roleId, random.pick(["viewer", "commenter"] as const));
          break;
        }
        case "team": {
          const project = random.pick(projects);
          const squad = teams.get(`${project.name.replace(/^Project /, "")} squad`)!;
          const newcomers = joined.get(project) ?? [];
          if (newcomers.length && random.chance(0.3)) {
            const leaving = newcomers.pop()!;
            await api.setTeamMembership(actorOf(random.pick(admins)), squad.id, leaving.memberId, false);
            project.writers = project.writers.filter((person) => person !== leaving);
          } else {
            const joining = random.pick(regulars.filter((person) => !project.writers.includes(person)));
            await api.setTeamMembership(actorOf(random.pick(admins)), squad.id, joining.memberId, true);
            project.writers.push(joining);
            joined.set(project, [...newcomers, joining]);
          }
          break;
        }
        case "impersonate": {
          // An admin checks what a member sees, or fixes something on their behalf
          if (writer.admin) break;
          const admin = random.pick(admins);
          const mode = random.chance(0.5) ? "view" : "act";
          await api.startImpersonation(actorOf(admin), writer.memberId, mode);
          const as = await memberIdentity(admin.userId, slug, { memberId: writer.memberId, mode });
          await api.readDocument(as, doc.id);
          if (mode === "act") await api.updateDocument(as, doc.id, { content: (doc.content = `${doc.content}\n\nFixed a typo.`) });
          await api.stopImpersonation(actorOf(admin), writer.memberId, mode);
          break;
        }
        case "api": {
          const holder = people.find((person) => person.apiToken && space.writers.includes(person));
          if (!holder) break;
          const viaKey = await fromApiKey(holder.apiToken!);
          const into = random.pick(space.folders);
          const row = { id: "", resourceId: "", folderId: into.id, title: `Imported: ${title(random).toLowerCase()}`, content: content(random, context) };
          ({ rowId: row.id, resourceId: row.resourceId } = await api.createDocument(viaKey, into.id, row.title, row.content));
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
  await pool.query(`
    with ordered as (
      select id, row_number() over (order by created_at, id) as position, count(*) over () as total
      from audit_event where org_id = $1 and subject_kind <> 'organization'
    )
    update audit_event e set created_at = now() - interval '30 days' * (1 - (ordered.position - random() * 0.9)::float / ordered.total)
    from ordered where e.id = ordered.id`, [orgId]);
  await pool.query(`update audit_event set created_at = now() - interval '400 days' where org_id = $1 and subject_kind = 'organization'`, [orgId]);
  await pool.query(`
    update document d set updated_at = e.at, created_at = least(d.created_at, e.at)
    from (
      select subject_id, max(created_at) as at from audit_event
      where org_id = $1 and subject_kind = 'document' and action in ('created', 'edited', 'renamed', 'moved')
      group by subject_id
    ) e
    where d.id = e.subject_id`, [orgId]);
  await pool.query(`
    update comment c set created_at = now() - random() * interval '30 days'
    from document d where c.document_id = d.id and d.org_id = $1 and c.created_at > now() - interval '1 day'`, [orgId]);
};
