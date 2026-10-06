import type { IncomingMessage, ServerResponse } from "node:http";
import { handle } from "../src/handler";

// The Vercel function: sign-in, GraphQL and GraphiQL. The pages are the static files of dist
export default function handler(req: IncomingMessage, res: ServerResponse) {
  return handle(req, res);
}
