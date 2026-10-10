import { db, type Access } from "./db.ts";

// Who may do what, as the app decides it before p9s: from the shares of projects with the teams of the user, and the
// shares of documents with the user

export type Bit = "read" | "write" | "delete";

export const bitsOf: Record<Access, Bit[]> = { viewer: ["read"], editor: ["read", "write"], owner: ["read", "write", "delete"] };

export const projectBits = async (userId: number, projectId: number) => {
  const shares = await db.selectFrom("project_shares")
    .innerJoin("team_members", "team_members.team_id", "project_shares.team_id")
    .select("project_shares.access")
    .where("team_members.user_id", "=", userId)
    .where("project_shares.project_id", "=", projectId)
    .execute();
  return new Set(shares.flatMap(share => bitsOf[share.access]));
};

// The bits of the user on the document, or undefined when there is no such document
export const documentBits = async (userId: number, documentId: number) => {
  const document = await db.selectFrom("documents").select("project_id").where("id", "=", documentId).executeTakeFirst();
  if (!document) return undefined;
  const share = await db.selectFrom("document_shares").select("access")
    .where("document_id", "=", documentId).where("user_id", "=", userId).executeTakeFirst();
  return new Set([...await projectBits(userId, document.project_id), ...(share ? bitsOf[share.access] : [])]);
};

export const hasBits = (bits: Set<Bit>, needed: Bit[]) => needed.every(bit => bits.has(bit));

// Every share gives read, so a user reads the projects shared with their teams, and the documents of those projects
// or shared with them
export const readableProjects = (userId: number) => db.selectFrom("projects")
  .select(["id", "name"])
  .where(eb => eb.exists(eb.selectFrom("project_shares")
    .innerJoin("team_members", "team_members.team_id", "project_shares.team_id")
    .whereRef("project_shares.project_id", "=", "projects.id")
    .where("team_members.user_id", "=", userId)
    .select(eb.lit(1).as("one"))))
  .orderBy("id")
  .execute();

export const readableDocuments = (userId: number) => db.selectFrom("documents")
  .select(["id", "project_id", "title"])
  .where(eb => eb.or([
    eb.exists(eb.selectFrom("project_shares")
      .innerJoin("team_members", "team_members.team_id", "project_shares.team_id")
      .whereRef("project_shares.project_id", "=", "documents.project_id")
      .where("team_members.user_id", "=", userId)
      .select(eb.lit(1).as("one"))),
    eb.exists(eb.selectFrom("document_shares")
      .whereRef("document_shares.document_id", "=", "documents.id")
      .where("document_shares.user_id", "=", userId)
      .select(eb.lit(1).as("one"))),
  ]))
  .orderBy("id")
  .execute();
