import { prisma, type Access } from "./db.ts";

// Who may do what, as the app decides it before p9s: from the shares of projects with the teams of the user, and the
// shares of documents with the user

export type Bit = "read" | "write" | "delete";

export const bitsOf: Record<Access, Bit[]> = { viewer: ["read"], editor: ["read", "write"], owner: ["read", "write", "delete"] };

const inTeamOf = (userId: number) => ({ team: { members: { some: { userId } } } });

export const projectBits = async (userId: number, projectId: number) => {
  const shares = await prisma.projectShare.findMany({ where: { projectId, ...inTeamOf(userId) }, select: { access: true } });
  return new Set(shares.flatMap(share => bitsOf[share.access as Access]));
};

// The bits of the user on the document, or undefined when there is no such document
export const documentBits = async (userId: number, documentId: number) => {
  const document = await prisma.document.findUnique({ where: { id: documentId }, select: { projectId: true } });
  if (!document) return undefined;
  const share = await prisma.documentShare.findUnique({ where: { documentId_userId: { documentId, userId } }, select: { access: true } });
  return new Set([...await projectBits(userId, document.projectId), ...(share ? bitsOf[share.access as Access] : [])]);
};

export const hasBits = (bits: Set<Bit>, needed: Bit[]) => needed.every(bit => bits.has(bit));

// Every share gives read, so a user reads the projects shared with their teams, and the documents of those projects
// or shared with them
export const readableProjects = (userId: number) => prisma.project.findMany({
  where: { shares: { some: inTeamOf(userId) } },
  select: { id: true, name: true },
  orderBy: { id: "asc" },
});

export const readableDocuments = (userId: number) => prisma.document.findMany({
  where: { OR: [{ project: { shares: { some: inTeamOf(userId) } } }, { shares: { some: { userId } } }] },
  select: { id: true, projectId: true, title: true },
  orderBy: { id: "asc" },
});
