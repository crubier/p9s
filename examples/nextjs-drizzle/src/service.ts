import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import { ACCESS_LEVELS, ADMINS, BIT, CONTENT_BITS, EVERYONE_IN_ORGANIZATION, can, includes, levelOf, type AccessLevel } from "../lib/permissions";
import { ForbiddenError, NotFoundError, asRole, db, readGraph, rows, switchToGraphWriter, type Identity, type Tx } from "./db";
import { apiKey, auditEvent, comment, document, folder, member, organization, team, user } from "./schema";

// Everything a request does in an organization, it does as an actor: a member, or an API key of a member.
// Reads and writes go through RLS as `roleId`, so the functions below only check what RLS cannot know, like which
// organization the request is about: a user is a member of each of their organizations, with other permissions.
export interface Actor extends Identity {
  userId: string;
  memberId: string;
  name: string;
  // The role id of the member, or of the API key the request was made with
  roleId: string;
  org: { id: string; name: string; slug: string; resourceId: string; roleId: string };
  // The admin viewing or acting as this member
  impersonator?: { memberId: string; name: string; readOnly: boolean };
}

export interface Page { query?: string; offset?: number; limit?: number }

const ALL_BITS = "11111111";

const uuids = (ids: string[]) => {
  for (const id of ids) if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error(`Not a uuid: ${id}`);
  return sql`${`{${ids.join(",")}}`}::uuid[]`;
};

const like = (query: string | undefined) => `%${(query ?? "").trim().replace(/[\\%_]/g, (character) => `\\${character}`)}%`;

const permissionOf = async (tx: Tx, resourceId: string) =>
  (await rows<{ permission: string | null }>(tx, sql`select resource_permission(${resourceId})::text as permission`))[0]?.permission ?? null;

const affected = (result: { rowCount: number | null }, message = "You don't have permission to do that.") => {
  if (!result.rowCount) throw new ForbiddenError(message);
};

// Organizations and members, looked up as the owner of the tables

export const listMemberships = (userId: string) =>
  db
    .select({ id: organization.id, name: organization.name, slug: organization.slug })
    .from(member)
    .innerJoin(organization, eq(member.orgId, organization.id))
    .where(eq(member.userId, userId))
    .orderBy(asc(organization.name));

const findActor = async (where: SQL): Promise<Actor | undefined> => {
  const [found] = await db
    .select({ userId: member.userId, memberId: member.id, roleId: member.roleId, name: user.name, org: organization })
    .from(member)
    .innerJoin(organization, eq(member.orgId, organization.id))
    .innerJoin(user, eq(user.id, member.userId))
    .where(where);
  if (!found) return undefined;
  const { id, name, slug, resourceId, roleId } = found.org;
  return { userId: found.userId, memberId: found.memberId, name: found.name, roleId: found.roleId!, org: { id, name, slug, resourceId: resourceId!, roleId: roleId! } };
};

export const getActor = (userId: string, orgSlug: string) => findActor(and(eq(member.userId, userId), eq(organization.slug, orgSlug))!);

const slugify = (name: string) =>
  name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "org";

// An organization has nothing above it in the graph, so RLS has nothing to check its creation against: the server
// creates it as the owner, with its first member, an Admins team, and a General space everyone can edit
export const createOrganization = (userId: string, name: string) =>
  db.transaction(async (tx) => {
    const base = slugify(name);
    const taken = new Set(
      (await rows<{ slug: string }>(tx, sql`select slug from organization where slug = ${base} or slug like ${`${base}-%`}`)).map((row) => row.slug),
    );
    let slug = base;
    for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;

    const [org] = await tx.insert(organization).values({ name, slug }).returning();
    const [admins] = await tx.insert(team).values({ orgId: org!.id, name: "Admins" }).returning();
    const [creator] = await tx.insert(member).values({ orgId: org!.id, userId }).returning();
    const [general] = await tx.insert(folder).values({ orgId: org!.id, name: "General" }).returning();
    const [creatorUser] = await tx.select({ name: user.name }).from(user).where(eq(user.id, userId));
    await tx.insert(auditEvent).values({
      orgId: org!.id, actorMemberId: creator!.id, actorName: creatorUser!.name, action: "created", subjectKind: "organization", subjectId: org!.id, subjectName: name,
    });

    await switchToGraphWriter(tx);
    await tx.execute(sql`insert into role_edge (parent_id, child_id, permission) values (${admins!.roleId}, ${creator!.roleId}, ${ALL_BITS}::bit(8))`);
    await tx.execute(sql`
      insert into assignment_edge (resource_id, role_id, permission) values
        (${org!.resourceId}, ${admins!.roleId}, ${ADMINS}::bit(8)),
        (${org!.resourceId}, ${org!.roleId}, ${EVERYONE_IN_ORGANIZATION}::bit(8)),
        (${general!.resourceId}, ${org!.roleId}, ${ACCESS_LEVELS.editor.permission}::bit(8))`);
    return org!;
  });

export const organizationPermission = (actor: Actor) => asRole(actor, (tx) => permissionOf(tx, actor.org.resourceId));

export interface MemberRow { id: string; roleId: string; userId: string; name: string; email: string; teamIds: string[] }

// RLS shows the members of the organization and its teams to everyone in it, through the directory bit. Which
// teams they are in is read from the graph
const listMembersIn = async (tx: Tx, actor: Actor, { query, offset = 0, limit = 1000 }: Page = {}) => {
  const matching = sql`member m join "user" u on u.id = m.user_id
    where m.org_id = ${actor.org.id} and (u.name ilike ${like(query)} or u.email ilike ${like(query)})`;
  const found = await rows<Omit<MemberRow, "teamIds">>(tx, sql`
    select m.id, m.role_id as "roleId", u.id as "userId", u.name, u.email
    from ${matching}
    order by u.name, u.email
    offset ${offset} limit ${limit}`);
  const [counted] = await rows<{ total: number }>(tx, sql`select count(*)::int as total from ${matching}`);
  const teams = await rows<{ id: string; roleId: string }>(tx, sql`select id, role_id as "roleId" from team where org_id = ${actor.org.id} order by name`);
  const edges = found.length && teams.length
    ? await readGraph<{ teamRoleId: string; memberRoleId: string }>(tx, sql`
        select parent_id as "teamRoleId", child_id as "memberRoleId" from role_edge
        where parent_id = any(${uuids(teams.map((row) => row.roleId))}) and child_id = any(${uuids(found.map((row) => row.roleId))})`)
    : [];
  const members = found.map((row) => {
    const roles = new Set(edges.filter((edge) => edge.memberRoleId === row.roleId).map((edge) => edge.teamRoleId));
    return { ...row, teamIds: teams.filter((team) => roles.has(team.roleId)).map((team) => team.id) };
  });
  return { members, total: counted?.total ?? 0 };
};

export const listMembers = (actor: Actor, page?: Page) => asRole(actor, (tx) => listMembersIn(tx, actor, page));

// Members are resources in their organization: inserting one needs the admin bit there, RLS checks it
export const inviteMember = async (actor: Actor, email: string) => {
  const [invited] = await db.select({ id: user.id }).from(user).where(eq(user.email, email.trim().toLowerCase()));
  if (!invited) throw new NotFoundError("Nobody has signed up with that email yet.");
  await asRole(actor, async (tx) => {
    const [existing] = await tx.select({ id: member.id }).from(member).where(and(eq(member.orgId, actor.org.id), eq(member.userId, invited.id)));
    if (existing) throw new ForbiddenError("Already a member.");
    await tx.insert(member).values({ orgId: actor.org.id, userId: invited.id });
  });
};

export const removeMember = (actor: Actor, memberId: string) =>
  asRole(actor, async (tx) => {
    if (memberId === actor.memberId) throw new ForbiddenError("You cannot remove yourself.");
    affected(await tx.delete(member).where(and(eq(member.id, memberId), eq(member.orgId, actor.org.id))));
  });

// Teams

export interface TeamRow { id: string; name: string; roleId: string; resourceId: string; members: number; administers: boolean }

// A team administers the organization when it is assigned the admin bit on it, like the Admins team. The size of the
// teams and what they are assigned is read from the graph
const listTeamsIn = async (tx: Tx, actor: Actor): Promise<TeamRow[]> => {
  const teams = await rows<Omit<TeamRow, "members" | "administers">>(tx, sql`
    select t.id, t.name, t.role_id as "roleId", t.resource_id as "resourceId" from team t where t.org_id = ${actor.org.id} order by t.name`);
  if (!teams.length) return [];
  const graph = new Map((await readGraph<{ roleId: string; members: number; administers: boolean }>(tx, sql`
    select r as "roleId",
      (select count(*)::int from role_edge e where e.parent_id = r) as members,
      exists (
        select 1 from assignment_edge a
        where a.resource_id = ${actor.org.resourceId} and a.role_id = r and substring(a.permission::text, ${BIT.admin + 1}, 1) = '1'
      ) as administers
    from unnest(${uuids(teams.map((row) => row.roleId))}) r`)).map((row) => [row.roleId, row]));
  return teams.map((row) => ({ ...row, members: graph.get(row.roleId)?.members ?? 0, administers: graph.get(row.roleId)?.administers ?? false }));
};

export const listTeams = (actor: Actor) => asRole(actor, (tx) => listTeamsIn(tx, actor));

export const createTeam = (actor: Actor, name: string) =>
  asRole(actor, async (tx) => {
    await tx.insert(team).values({ orgId: actor.org.id, name });
  });

export const deleteTeam = (actor: Actor, teamId: string) =>
  asRole(actor, async (tx) => {
    if ((await listTeamsIn(tx, actor)).some((row) => row.id === teamId && row.administers)) {
      throw new ForbiddenError("This team administers the organization, it cannot be deleted.");
    }
    affected(await tx.delete(team).where(and(eq(team.id, teamId), eq(team.orgId, actor.org.id))));
  });

// A team membership is a role edge from the team to the member, a graph write: the server checks that the actor
// may manage the team, then writes the edge as the graph writer
export const setTeamMembership = (actor: Actor, teamId: string, memberId: string, isMember: boolean) =>
  asRole(actor, async (tx) => {
    const [found] = await rows<{ roleId: string; permission: string | null }>(tx, sql`
      select role_id as "roleId", resource_permission(resource_id)::text as permission from team where id = ${teamId} and org_id = ${actor.org.id}`);
    if (!found) throw new NotFoundError("No such team.");
    if (!can(found.permission, "admin")) throw new ForbiddenError("Only admins can change teams.");
    const [target] = await tx.select({ roleId: member.roleId }).from(member).where(and(eq(member.id, memberId), eq(member.orgId, actor.org.id)));
    if (!target) throw new NotFoundError("No such member.");
    if (!isMember && memberId === actor.memberId && (await listTeamsIn(tx, actor)).some((row) => row.id === teamId && row.administers)) {
      throw new ForbiddenError("You cannot remove yourself from a team that administers the organization.");
    }
    await switchToGraphWriter(tx);
    if (isMember) {
      await tx.execute(sql`
        insert into role_edge (parent_id, child_id, permission) values (${found.roleId}, ${target.roleId}, ${ALL_BITS}::bit(8))
        on conflict do nothing`);
    } else {
      await tx.execute(sql`delete from role_edge where parent_id = ${found.roleId} and child_id = ${target.roleId} and not home`);
    }
  });

// Folders and documents

export interface FolderRow { id: string; name: string; parentId: string | null; resourceId: string; permission: string | null }
export interface DocumentRow { id: string; title: string; folderId: string; resourceId: string; updatedAt: string; permission: string | null }

// Everyone's directory bit on the organization reaches its folders too: drop the bits folders don't use
const contentPermission = (permission: SQL) => sql`nullif(${permission} & ${CONTENT_BITS}::bit(8), b'00000000')::text`;
const folderColumns = sql`f.id, f.name, f.parent_id as "parentId", f.resource_id as "resourceId", ${contentPermission(sql`resource_permission(f.resource_id)`)} as permission`;
const documentColumns = sql`d.id, d.title, d.folder_id as "folderId", d.resource_id as "resourceId", d.updated_at as "updatedAt", ${contentPermission(sql`resource_permission(d.resource_id)`)} as permission`;

// A user can be given access in several organizations: requests made in one only touch the resources below it.
// Folders and documents hold their organization, even a document whose folder RLS hides
const documentInOrganization = (actor: Actor) => eq(document.orgId, actor.org.id);
const folderInOrganization = (actor: Actor, folderId: string) => sql`exists (select 1 from folder where id = ${folderId} and org_id = ${actor.org.id})`;

// Any resource the actor reaches, by its id. The views of the current user list their rows before joining them, so
// they are only asked about given ids, which Postgres looks up in the index
const assertResourceInOrganization = async (tx: Tx, actor: Actor, resourceId: string) => {
  const [found] = await rows<{ found: boolean }>(tx, sql`
    select ${resourceId}::uuid = ${actor.org.resourceId}
      or exists (select 1 from current_resource_edge c where c.parent_id = ${actor.org.resourceId} and c.child_id = ${resourceId}::uuid) as found`);
  if (!found?.found) throw new NotFoundError("This does not exist, or you don't have access to it.");
};

// The spaces the actor can see
export const listSpaces = (actor: Actor) =>
  asRole(actor, (tx) => rows<FolderRow>(tx, sql`select ${folderColumns} from folder f where f.org_id = ${actor.org.id} and f.parent_id is null order by f.name`));

// What was shared with the actor inside spaces they cannot see. Access given on a folder reaches what is inside, so
// a folder or document whose parent RLS hides was shared on its own: only look among what is assigned to the actor,
// their teams and the organization, rather than through everything they can read
const assignedToActor = sql`select resource_id from current_assignment`;

export const listShared = (actor: Actor) =>
  asRole(actor, async (tx) => ({
    folders: await rows<FolderRow>(tx, sql`
      select ${folderColumns} from folder f
      where f.resource_id in (${assignedToActor}) and f.org_id = ${actor.org.id} and f.parent_id is not null
        and not exists (select 1 from folder p where p.id = f.parent_id)
      order by f.name`),
    // The folder of these documents is hidden by RLS
    documents: await rows<DocumentRow>(tx, sql`
      select ${documentColumns} from document d
      where d.resource_id in (${assignedToActor}) and not exists (select 1 from folder p where p.id = d.folder_id)
        and d.org_id = ${actor.org.id}
      order by d.title`),
  }));

// Ancestors the actor can see, from the top: RLS stops the walk at the first folder they cannot see
const breadcrumbs = (tx: Tx, folderId: string) =>
  rows<{ id: string; name: string }>(tx, sql`
    with recursive up as (
      select id, name, parent_id, 0 as depth from folder where id = ${folderId}
      union all
      select f.id, f.name, f.parent_id, up.depth + 1 from folder f join up on f.id = up.parent_id
    )
    select id, name from up order by depth desc`);

export const getFolder = (actor: Actor, folderId: string) =>
  asRole(actor, async (tx) => {
    const [found] = await rows<FolderRow>(tx, sql`select ${folderColumns} from folder f where f.id = ${folderId} and f.org_id = ${actor.org.id}`);
    if (!found) throw new NotFoundError("This folder does not exist, or you don't have access to it.");
    return {
      folder: found,
      path: await breadcrumbs(tx, folderId),
      folders: await rows<FolderRow>(tx, sql`select ${folderColumns} from folder f where f.parent_id = ${folderId} order by f.name`),
      documents: await rows<DocumentRow>(tx, sql`select ${documentColumns} from document d where d.folder_id = ${folderId} order by d.title`),
    };
  });

// Every folder the actor can see, to pick where to move something
export const listFolders = (actor: Actor) =>
  asRole(actor, (tx) => rows<FolderRow>(tx, sql`select ${folderColumns} from folder f where f.org_id = ${actor.org.id} order by f.name`));

// With no parent, the folder is a space: RLS checks the create bit on the organization, only admins have it
export const createFolder = async (actor: Actor, parentId: string | null, name: string) => {
  const id = randomUUID();
  await asRole(actor, async (tx) => {
    if (parentId) await assertFolderInOrganization(tx, actor, parentId);
    await tx.insert(folder).values({ id, orgId: actor.org.id, parentId, name });
  });
  return id;
};

const assertFolderInOrganization = async (tx: Tx, actor: Actor, folderId: string) => {
  const [found] = await rows<{ found: boolean }>(tx, sql`select ${folderInOrganization(actor, folderId)} as found`);
  if (!found?.found) throw new NotFoundError("This folder does not exist, or you don't have access to it.");
};

export const renameFolder = (actor: Actor, folderId: string, name: string) =>
  asRole(actor, async (tx) => affected(await tx.update(folder).set({ name }).where(and(eq(folder.id, folderId), eq(folder.orgId, actor.org.id)))));

// RLS checks the edit bit on the folder and the create bit on its new parent
export const moveFolder = (actor: Actor, folderId: string, parentId: string) =>
  asRole(actor, async (tx) => {
    await assertFolderInOrganization(tx, actor, parentId);
    const [inside] = await rows<{ inside: boolean }>(tx, sql`
      select exists (
        select 1 from current_resource_edge c
        where c.parent_id = (select resource_id from folder where id = ${folderId}) and c.child_id = (select resource_id from folder where id = ${parentId})
      ) as inside`);
    if (inside?.inside) throw new ForbiddenError("A folder cannot be moved into itself.");
    affected(await tx.update(folder).set({ parentId }).where(and(eq(folder.id, folderId), eq(folder.orgId, actor.org.id))));
  });

export const deleteFolder = (actor: Actor, folderId: string) =>
  asRole(actor, async (tx) => affected(await tx.delete(folder).where(and(eq(folder.id, folderId), eq(folder.orgId, actor.org.id)))));

export interface CommentRow { id: string; body: string; createdAt: string; author: string | null; memberId: string | null }

export const getDocument = (actor: Actor, documentId: string) =>
  asRole(actor, async (tx) => {
    const [found] = await rows<DocumentRow & { content: string; author: string | null }>(tx, sql`
      select ${documentColumns}, d.content, u.name as author
      from document d
      left join member m on m.id = d.created_by
      left join "user" u on u.id = m.user_id
      where d.id = ${documentId} and d.org_id = ${actor.org.id}`);
    if (!found) throw new NotFoundError("This document does not exist, or you don't have access to it.");
    return {
      document: found,
      path: await breadcrumbs(tx, found.folderId),
      comments: await rows<CommentRow>(tx, sql`
        select c.id, c.body, c.created_at as "createdAt", u.name as author, c.member_id as "memberId"
        from comment c
        left join member m on m.id = c.member_id
        left join "user" u on u.id = m.user_id
        where c.document_id = ${documentId}
        order by c.created_at`),
    };
  });

// The documents the actor can read, last updated first. Pages start after a cursor rather than at an offset: walking
// the index from the cursor, RLS checks the rows of the page and not every row before it
export const listDocuments = (actor: Actor, { limit = 50, after }: { limit?: number; after?: string } = {}) =>
  asRole(actor, (tx) => {
    const [updatedAt, id] = after ? after.split("|") : [];
    const start = updatedAt && id ? sql`and (d.updated_at, d.id) < (${updatedAt}::timestamp, ${id}::uuid)` : sql``;
    return rows<DocumentRow & { cursor: string }>(tx, sql`
      select ${documentColumns}, d.updated_at::text || '|' || d.id as cursor
      from document d where d.org_id = ${actor.org.id} ${start}
      order by d.updated_at desc, d.id desc limit ${limit}`);
  });

// How much the actor can read in the organization. Comparing ids is leakproof, so RLS checks the readable documents
// in one join, planned for the documents of the organization
export const countReadable = (actor: Actor) =>
  asRole(actor, async (tx) => {
    const [counted] = await rows<{ folders: number; documents: number }>(tx, sql`
      select
        (select count(*)::int from folder where org_id = ${actor.org.id}) as folders,
        (select count(*)::int from document where org_id = ${actor.org.id}) as documents`);
    return counted!;
  });

// Folders and documents whose name matches, among those RLS shows the actor.
// Postgres checks RLS before any filter that is not leakproof, like ilike, planned for the few matches ilike guesses:
// row by row. `offset 0` keeps the readable documents of the organization a subquery of their own, which it checks
// in one join, then it filters
export const search = (actor: Actor, query: string, limit = 50) =>
  asRole(actor, async (tx) => ({
    folders: await rows<FolderRow>(tx, sql`
      select ${folderColumns} from folder f where f.org_id = ${actor.org.id} and f.name ilike ${like(query)} order by f.name limit ${limit}`),
    documents: await rows<DocumentRow>(tx, sql`
      select ${documentColumns}
      from (select id, title, content, folder_id, resource_id, updated_at from document where org_id = ${actor.org.id} offset 0) d
      where d.title ilike ${like(query)} or d.content ilike ${like(query)}
      order by d.title ilike ${like(query)} desc, d.updated_at desc limit ${limit}`),
  }));

export const createDocument = async (actor: Actor, folderId: string, title: string, content = "") => {
  const id = randomUUID();
  await asRole(actor, async (tx) => {
    await assertFolderInOrganization(tx, actor, folderId);
    await tx.insert(document).values({ id, orgId: actor.org.id, folderId, title, content, createdBy: actor.memberId });
  });
  return id;
};

export const updateDocument = (actor: Actor, documentId: string, values: { title?: string; content?: string }) =>
  asRole(actor, async (tx) => affected(await tx.update(document).set(values).where(and(eq(document.id, documentId), documentInOrganization(actor)))));

export const moveDocument = (actor: Actor, documentId: string, folderId: string) =>
  asRole(actor, async (tx) => {
    await assertFolderInOrganization(tx, actor, folderId);
    affected(await tx.update(document).set({ folderId }).where(and(eq(document.id, documentId), documentInOrganization(actor))));
  });

export const deleteDocument = (actor: Actor, documentId: string) =>
  asRole(actor, async (tx) => affected(await tx.delete(document).where(and(eq(document.id, documentId), documentInOrganization(actor)))));

// Comments are leaf rows: RLS checks the comment bit on their document
export const addComment = (actor: Actor, documentId: string, body: string) =>
  asRole(actor, async (tx) => {
    const [found] = await rows<{ id: string }>(tx, sql`select id from document d where d.id = ${documentId} and d.org_id = ${actor.org.id}`);
    if (!found) throw new NotFoundError("This document does not exist, or you don't have access to it.");
    await tx.insert(comment).values({ documentId, memberId: actor.memberId, body });
  });

export const deleteComment = (actor: Actor, commentId: string) =>
  asRole(actor, async (tx) =>
    affected(
      await tx.delete(comment).where(and(
        eq(comment.id, commentId),
        sql`exists (select 1 from document d where d.id = ${comment.documentId} and d.org_id = ${actor.org.id})`,
      )),
    ),
  );

// Sharing

export interface Principal { roleId: string; kind: "everyone" | "team" | "member"; name: string; detail: string | null }

// Who a resource can be shared with: everyone in the organization, its teams and its members
const principals = (actor: Actor, where: SQL) => sql`
  select * from (
    select role_id as "roleId", 'everyone' as kind, 'Everyone at ' || name as name, null as detail, 0 as rank from organization where id = ${actor.org.id}
    union all
    select role_id, 'team', name, null, 1 from team where org_id = ${actor.org.id}
    union all
    select m.role_id, 'member', u.name, u.email, 2 from member m join "user" u on u.id = m.user_id where m.org_id = ${actor.org.id}
  ) principals
  where ${where}`;

export const searchPrincipals = (actor: Actor, query: string, limit = 20) =>
  asRole(actor, (tx) =>
    rows<Principal>(tx, sql`${principals(actor, sql`name ilike ${like(query)} or detail ilike ${like(query)}`)} order by rank, name limit ${limit}`),
  );

const principalsWithRoles = (tx: Tx, actor: Actor, roleIds: string[]) =>
  rows<Principal>(tx, principals(actor, sql`"roleId" = any(${uuids(roleIds)})`));

export interface AccessRow extends Principal {
  permission: string;
  level: AccessLevel | undefined;
  direct: boolean;
  // Where inherited access is given: a folder above, or the organization when `fromFolderId` is null
  from: string | null;
  fromFolderId: string | null;
}

// The assignments that give access to a resource: on the resource itself, or on a folder or organization above it.
// Anyone who can see the resource can see who else has access, read from the graph
export const listAccess = (actor: Actor, resourceId: string) =>
  asRole(actor, async (tx) => {
    await assertResourceInOrganization(tx, actor, resourceId);
    const assignments = await rows<{ roleId: string; permission: string; resourceId: string }>(tx, sql`
      select role_id as "roleId", permission::text, assigned_resource_id as "resourceId" from resource_access
      where resource_id = ${resourceId} and (permission & ${CONTENT_BITS}::bit(8)) <> b'00000000'`);
    if (!assignments.length) return [];
    const found = new Map((await principalsWithRoles(tx, actor, assignments.map((row) => row.roleId))).map((principal) => [principal.roleId, principal]));
    const sources = new Map(
      (await rows<{ resourceId: string; name: string; folderId: string | null }>(tx, sql`
        select resource_id as "resourceId", name, id as "folderId" from folder where resource_id = any(${uuids(assignments.map((row) => row.resourceId))})
        union all
        select resource_id, name, null from organization where id = ${actor.org.id}`)).map((row) => [row.resourceId, row]),
    );
    const kinds = { member: 0, team: 1, everyone: 2 };
    return assignments
      .flatMap((row): AccessRow[] => {
        const principal = found.get(row.roleId);
        if (!principal) return [];
        const direct = row.resourceId === resourceId;
        const source = direct ? undefined : sources.get(row.resourceId);
        return [{ ...principal, permission: row.permission, level: levelOf(row.permission), direct, from: source?.name ?? null, fromFolderId: source?.folderId ?? null }];
      })
      .sort((a, b) => Number(b.direct) - Number(a.direct) || kinds[a.kind] - kinds[b.kind] || a.name.localeCompare(b.name));
  });

// The assignment of a role on a resource. Members see the assignments of what they can share
const assignmentOf = async (tx: Tx, resourceId: string, roleId: string) =>
  (await rows<{ permission: string }>(tx, sql`
    select permission::text from assignment_edge where resource_id = ${resourceId} and role_id = ${roleId}`))[0];

// p9s lets a member share a resource if they have the share bit on it, and only give bits they have themselves. The
// server checks the same first, to tell why it refuses
export const share = (actor: Actor, resourceId: string, roleId: string, level: AccessLevel) =>
  asRole(actor, async (tx) => {
    await assertResourceInOrganization(tx, actor, resourceId);
    const granted = await permissionOf(tx, resourceId);
    if (!can(granted, "share")) throw new ForbiddenError("You cannot share this.");
    const requested = ACCESS_LEVELS[level].permission;
    if (!includes(granted, requested)) throw new ForbiddenError("You can only give access you have yourself.");
    if (!(await principalsWithRoles(tx, actor, [roleId])).length) throw new NotFoundError("No such member or team.");
    const existing = await assignmentOf(tx, resourceId, roleId);
    if (existing && !includes(granted, existing.permission)) throw new ForbiddenError("You cannot change access you don't have yourself.");
    await tx.execute(sql`select resource_share(${resourceId}, ${roleId}, ${requested}::bit(8))`);
  });

// Removing access needs the share bit too, and cannot take away more than the actor has
export const unshare = (actor: Actor, resourceId: string, roleId: string) =>
  asRole(actor, async (tx) => {
    await assertResourceInOrganization(tx, actor, resourceId);
    const granted = await permissionOf(tx, resourceId);
    if (!can(granted, "share")) throw new ForbiddenError("You cannot change who has access to this.");
    const existing = await assignmentOf(tx, resourceId, roleId);
    if (!existing) throw new NotFoundError("That access is not given here.");
    if (!includes(granted, existing.permission)) throw new ForbiddenError("You cannot remove access you don't have yourself.");
    await tx.execute(sql`select resource_unshare(${resourceId}, ${roleId})`);
  });

const assertAdmin = async (tx: Tx, actor: Actor, message: string) => {
  if (!can(await permissionOf(tx, actor.org.resourceId), "admin")) throw new ForbiddenError(message);
};

// What members can do in every space. Admins read every space, so they can ask what any role can do in it
export const accessMatrix = (actor: Actor, page: Page = {}) =>
  asRole(actor, async (tx) => {
    await assertAdmin(tx, actor, "Only admins can see everyone's access.");
    const { members, total } = await listMembersIn(tx, actor, { limit: 25, ...page });
    const spaces = await rows<{ id: string; name: string; resourceId: string }>(tx, sql`
      select id, name, resource_id as "resourceId" from folder where org_id = ${actor.org.id} and parent_id is null order by name`);
    const cells = members.length
      ? await rows<{ resourceId: string; roleId: string; permission: string | null }>(tx, sql`
          select r as "resourceId", m as "roleId", ${contentPermission(sql`resource_permission(r, m)`)} as permission
          from unnest(${uuids(spaces.map((space) => space.resourceId))}) r, unnest(${uuids(members.map((row) => row.roleId))}) m`)
      : [];
    const permissions = new Map(cells.map((cell) => [`${cell.resourceId}:${cell.roleId}`, cell.permission]));
    return {
      spaces,
      total,
      members: members.map((row) => ({ ...row, permissions: spaces.map((space) => permissions.get(`${space.resourceId}:${row.roleId}`) ?? null) })),
    };
  });

// The audit log. Triggers write what members change, the server what it does on its own, as the owner

const recordEvent = (actor: Actor, event: { action: string; subjectKind: string; subjectId?: string; subjectName?: string; detail?: string }) =>
  db.insert(auditEvent).values({
    orgId: actor.org.id,
    actorMemberId: actor.memberId,
    actorName: actor.name,
    impersonatorMemberId: actor.impersonator?.memberId,
    impersonatorName: actor.impersonator?.name,
    ...event,
  });

export const AUDIT_CATEGORIES = {
  content: "Content",
  sharing: "Sharing",
  people: "Members and teams",
  impersonation: "Impersonation",
  api: "API",
} as const;

export type AuditCategory = keyof typeof AUDIT_CATEGORIES;

const texts = (values: string[]) => sql`${`{${values.map((value) => `"${value}"`).join(",")}}`}::text[]`;
const SHARING_ACTIONS = texts(["shared", "changed access to", "removed access to"]);
const IMPERSONATION_ACTIONS = texts(["started viewing as", "started acting as", "stopped viewing as", "stopped acting as"]);

const auditCategory = (category: AuditCategory | undefined) => {
  switch (category) {
    case "content": return sql`subject_kind in ('space', 'folder', 'document') and action <> all(${SHARING_ACTIONS})`;
    case "sharing": return sql`action = any(${SHARING_ACTIONS})`;
    case "people": return sql`subject_kind in ('member', 'team') and action <> all(${IMPERSONATION_ACTIONS})`;
    case "impersonation": return sql`impersonator_member_id is not null or action = any(${IMPERSONATION_ACTIONS})`;
    case "api": return sql`api_key_name is not null or subject_kind = 'api_key'`;
    default: return sql`true`;
  }
};

export interface AuditRow {
  id: string;
  createdAt: string;
  actorMemberId: string | null;
  actorName: string | null;
  apiKeyName: string | null;
  impersonatorName: string | null;
  action: string;
  subjectKind: string;
  subjectId: string | null;
  subjectName: string | null;
  detail: string | null;
  permission: string | null;
}

// RLS shows the audit log to admins only: everyone else gets no rows
export const listAuditEvents = (actor: Actor, { memberId, category, offset = 0, limit = 50 }: { memberId?: string; category?: AuditCategory; offset?: number; limit?: number } = {}) =>
  asRole(actor, (tx) =>
    rows<AuditRow>(tx, sql`
      select id, created_at as "createdAt", actor_member_id as "actorMemberId", actor_name as "actorName", api_key_name as "apiKeyName",
        impersonator_name as "impersonatorName", action, subject_kind as "subjectKind", subject_id as "subjectId", subject_name as "subjectName",
        detail, permission
      from audit_event
      where org_id = ${actor.org.id} and (${memberId ?? null}::uuid is null or actor_member_id = ${memberId ?? null}::uuid) and (${auditCategory(category)})
      order by created_at desc, id
      offset ${offset} limit ${limit}`),
  );

// Impersonation. An admin views the organization as one of its members, with the member's role id: RLS shows
// exactly what the member sees. Viewing is read only, enforced by Postgres. Acting allows changes, which the audit
// log records as made by the member, and by the admin acting as them

export type ImpersonationMode = "view" | "act";

const memberActor = (orgId: string, memberId: string) => findActor(and(eq(member.id, memberId), eq(member.orgId, orgId))!);

// The member as the admin sees them, if the admin may still impersonate them
export const impersonated = async (admin: Actor, memberId: string, mode: ImpersonationMode): Promise<Actor | undefined> => {
  if (memberId === admin.memberId || !can(await organizationPermission(admin), "admin")) return undefined;
  const target = await memberActor(admin.org.id, memberId);
  return target && { ...target, impersonator: { memberId: admin.memberId, name: admin.name, readOnly: mode === "view" } };
};

export const startImpersonation = async (admin: Actor, memberId: string, mode: ImpersonationMode) => {
  if (admin.impersonator) throw new ForbiddenError("Stop acting as someone else first.");
  if (memberId === admin.memberId) throw new ForbiddenError("That is you.");
  if (!can(await organizationPermission(admin), "admin")) throw new ForbiddenError("Only admins can view the organization as someone else.");
  const target = await memberActor(admin.org.id, memberId);
  if (!target) throw new NotFoundError("No such member.");
  await recordEvent(admin, { action: mode === "view" ? "started viewing as" : "started acting as", subjectKind: "member", subjectId: memberId, subjectName: target.name });
};

export const stopImpersonation = async (actor: Actor) => {
  if (!actor.impersonator) return;
  const admin = await memberActor(actor.org.id, actor.impersonator.memberId);
  if (!admin) return;
  await recordEvent(admin, {
    action: actor.impersonator.readOnly ? "stopped viewing as" : "stopped acting as", subjectKind: "member", subjectId: actor.memberId, subjectName: actor.name,
  });
};

// API keys. Role tables have no RLS, so the server only lets members manage their own keys, and admins acting as
// someone cannot get keys in their name

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export const listApiKeys = (actor: Actor) =>
  db
    .select({ id: apiKey.id, name: apiKey.name, tokenStart: apiKey.tokenStart, createdAt: apiKey.createdAt, lastUsedAt: apiKey.lastUsedAt })
    .from(apiKey)
    .where(eq(apiKey.memberId, actor.memberId))
    .orderBy(desc(apiKey.createdAt));

const assertNotImpersonated = (actor: Actor) => {
  if (actor.impersonator) throw new ForbiddenError("API keys can only be managed by their owner.");
};

// Returns the token, which is only stored hashed
export const createApiKey = async (actor: Actor, name: string) => {
  assertNotImpersonated(actor);
  const token = `p9s_${randomBytes(24).toString("base64url")}`;
  await db.insert(apiKey).values({ memberId: actor.memberId, name, tokenHash: hashToken(token), tokenStart: token.slice(0, 8) });
  await recordEvent(actor, { action: "created", subjectKind: "api_key", subjectName: name });
  return token;
};

export const revokeApiKey = async (actor: Actor, keyId: string) => {
  assertNotImpersonated(actor);
  const [revoked] = await db.delete(apiKey).where(and(eq(apiKey.id, keyId), eq(apiKey.memberId, actor.memberId))).returning({ name: apiKey.name });
  if (!revoked) throw new NotFoundError("No such key.");
  await recordEvent(actor, { action: "revoked", subjectKind: "api_key", subjectName: revoked.name });
};

// The actor of a request made with an API key: its member, acting with the role id of the key
export const actorFromApiKey = async (token: string): Promise<Actor | undefined> => {
  const [found] = await db
    .update(apiKey)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKey.tokenHash, hashToken(token)))
    .returning({ roleId: apiKey.roleId, memberId: apiKey.memberId });
  if (!found) return undefined;
  const owner = await findActor(eq(member.id, found.memberId));
  return owner && { ...owner, roleId: found.roleId! };
};
