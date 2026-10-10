import { maybeRow, rows, supabase, type Access } from "./db.ts";

// Who may do what, as the app decides it before p9s: from the shares of projects with the teams of the user, and the
// shares of documents with the user

export type Bit = "read" | "write" | "delete";

export const bitsOf: Record<Access, Bit[]> = { viewer: ["read"], editor: ["read", "write"], owner: ["read", "write", "delete"] };

const teamsOf = async (userId: number) =>
  (await rows(supabase.from("team_members").select("team_id").eq("user_id", userId))).map(member => member.team_id);

const sharesOf = async (userId: number) =>
  rows(supabase.from("project_shares").select("project_id, access").in("team_id", await teamsOf(userId)));

export const projectBits = async (userId: number, projectId: number) =>
  new Set((await sharesOf(userId)).filter(share => share.project_id === projectId).flatMap(share => bitsOf[share.access]));

// The bits of the user on the document, or undefined when there is no such document
export const documentBits = async (userId: number, documentId: number) => {
  const document = await maybeRow(supabase.from("documents").select("project_id").eq("id", documentId).maybeSingle());
  if (!document) return undefined;
  const share = await maybeRow(supabase.from("document_shares").select("access").eq("document_id", documentId).eq("user_id", userId).maybeSingle());
  return new Set([...await projectBits(userId, document.project_id), ...(share ? bitsOf[share.access] : [])]);
};

export const hasBits = (bits: Set<Bit>, needed: Bit[]) => needed.every(bit => bits.has(bit));

// Every share gives read, so a user reads the projects shared with their teams, and the documents of those projects
// or shared with them
const readableProjectIds = async (userId: number) => [...new Set((await sharesOf(userId)).map(share => share.project_id))];

export const readableProjects = async (userId: number) =>
  rows(supabase.from("projects").select("id, name").in("id", await readableProjectIds(userId)).order("id"));

export const readableDocuments = async (userId: number) => {
  const shared = await rows(supabase.from("document_shares").select("document_id").eq("user_id", userId));
  const projects = await readableProjectIds(userId);
  return rows(supabase.from("documents").select("id, project_id, title")
    .or(`project_id.in.(${projects.join(",")}),id.in.(${shared.map(share => share.document_id).join(",")})`)
    .order("id"));
};
