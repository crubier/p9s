import { getDocument, updateDocument } from "@/src/service";
import { withApiKey } from "../../api";

type Context = { params: Promise<{ id: string }> };

export const GET = async (request: Request, { params }: Context) => {
  const { id } = await params;
  return withApiKey(request, async (actor) => {
    const { document, comments } = await getDocument(actor, id);
    return { ...document, comments };
  });
};

// Updates the title or the content: `{ "title": "...", "content": "..." }`
export const PATCH = async (request: Request, { params }: Context) => {
  const { id } = await params;
  return withApiKey(request, async (actor) => {
    const { title, content } = (await request.json()) as { title?: string; content?: string };
    await updateDocument(actor, id, { title, content });
    return (await getDocument(actor, id)).document;
  });
};
