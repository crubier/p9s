import { and, asc, eq, exists, or, sql } from "drizzle-orm";
import { db, documents, documentShares, projects, projectShares, teamMembers, type Access } from "./db.ts";

// Who may do what, as the app decides it before p9s: from the shares of projects with the teams of the user, and the
// shares of documents with the user

export type Bit = "read" | "write" | "delete";

export const bitsOf: Record<Access, Bit[]> = { viewer: ["read"], editor: ["read", "write"], owner: ["read", "write", "delete"] };

export const projectBits = async (userId: number, projectId: number) => {
  const shares = await db.select({ access: projectShares.access }).from(projectShares)
    .innerJoin(teamMembers, eq(teamMembers.teamId, projectShares.teamId))
    .where(and(eq(teamMembers.userId, userId), eq(projectShares.projectId, projectId)));
  return new Set(shares.flatMap(share => bitsOf[share.access]));
};

// The bits of the user on the document, or undefined when there is no such document
export const documentBits = async (userId: number, documentId: number) => {
  const [document] = await db.select({ projectId: documents.projectId }).from(documents).where(eq(documents.id, documentId));
  if (!document) return undefined;
  const [share] = await db.select({ access: documentShares.access }).from(documentShares)
    .where(and(eq(documentShares.documentId, documentId), eq(documentShares.userId, userId)));
  return new Set([...await projectBits(userId, document.projectId), ...(share ? bitsOf[share.access] : [])]);
};

export const hasBits = (bits: Set<Bit>, needed: Bit[]) => needed.every(bit => bits.has(bit));

// Every share gives read, so a user reads the projects shared with their teams, and the documents of those projects
// or shared with them
const sharedWithTeams = (userId: number, projectId: typeof projects.id | typeof documents.projectId) =>
  exists(db.select({ one: sql`1` }).from(projectShares)
    .innerJoin(teamMembers, eq(teamMembers.teamId, projectShares.teamId))
    .where(and(eq(projectShares.projectId, projectId), eq(teamMembers.userId, userId))));

export const readableProjects = (userId: number) => db.select({ id: projects.id, name: projects.name }).from(projects)
  .where(sharedWithTeams(userId, projects.id))
  .orderBy(asc(projects.id));

export const readableDocuments = (userId: number) => db
  .select({ id: documents.id, project_id: documents.projectId, title: documents.title }).from(documents)
  .where(or(
    sharedWithTeams(userId, documents.projectId),
    exists(db.select({ one: sql`1` }).from(documentShares)
      .where(and(eq(documentShares.documentId, documents.id), eq(documentShares.userId, userId)))),
  ))
  .orderBy(asc(documents.id));
