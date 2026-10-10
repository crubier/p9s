import { ForbiddenError, NotFoundError, describeError } from "@/src/db";
import { actorFromApiKey, type Actor } from "@/src/service";

// Runs a request of the API as the member of its API key, and turns errors into JSON responses
export const withApiKey = async (request: Request, handle: (actor: Actor) => Promise<unknown>) => {
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  const actor = token ? await actorFromApiKey(token) : undefined;
  if (!actor) return Response.json({ error: "Pass a valid API key as `Authorization: Bearer <key>`" }, { status: 401 });
  try {
    return Response.json(await handle(actor));
  } catch (error) {
    const status = error instanceof ForbiddenError ? 403 : error instanceof NotFoundError ? 404 : 400;
    return Response.json({ error: describeError(error) }, { status });
  }
};
