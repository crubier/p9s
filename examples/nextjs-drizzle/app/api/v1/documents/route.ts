import { capabilities } from "@/lib/permissions";
import { createDocument, getDocument, listDocuments } from "@/src/service";
import { withApiKey } from "../api";

// The documents the key's member can read, last updated first, and what they can do with each: `?limit=50&offset=0`
export const GET = (request: Request) =>
  withApiKey(request, async (actor) => {
    const params = new URL(request.url).searchParams;
    const limit = Math.min(200, Math.max(1, Number(params.get("limit")) || 50));
    const offset = Math.max(0, Number(params.get("offset")) || 0);
    return {
    organization: actor.org.slug,
    limit,
    offset,
    documents: (await listDocuments(actor, { limit, offset })).map(({ id, title, folderId, updatedAt, permission }) => ({
      id,
      title,
      folderId,
      updatedAt,
      permission,
      can: capabilities(permission),
    })),
    };
  });

// Creates a document: `{ "folderId": "...", "title": "...", "content": "..." }`. RLS rejects it without the create bit
export const POST = (request: Request) =>
  withApiKey(request, async (actor) => {
    const body = (await request.json()) as { folderId?: string; title?: string; content?: string };
    if (!body.folderId || !body.title) throw new Error("folderId and title are required");
    const id = await createDocument(actor, body.folderId, body.title, body.content ?? "");
    return (await getDocument(actor, id)).document;
  });
