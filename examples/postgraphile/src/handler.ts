import type { IncomingMessage, ServerResponse } from "node:http";
import { toNodeHandler } from "better-auth/node";
import { grafserv } from "postgraphile/grafserv/node";
import { auth } from "./auth.js";
import { pgl } from "./graphql.js";

const graphql = pgl.createServ(grafserv).createHandler();
const signIn = toNodeHandler(auth);

// PostGraphile builds the schema once, and keeps a build that failed. On Vercel, an instance sleeps between requests,
// so the build runs within one; if it failed, as when the database dropped the connection, the instance quits and
// another one takes the next request
const schemaReady = Promise.resolve(pgl.getSchemaResult()).then(
  () => true,
  (error: unknown) => {
    console.error("Could not build the GraphQL schema", error);
    return false;
  },
);

const SERVER_PATHS = /^\/(graphql|graphiql|ruru-static\/.*|api\/auth\/.*)$/;

export const servesPath = (url = "/") => SERVER_PATHS.test(url.split("?")[0]!);

// Sign-in, GraphQL and GraphiQL: everything but the pages of the app, which are static
export const handle = async (req: IncomingMessage, res: ServerResponse) => {
  if (!(await schemaReady)) {
    res.statusCode = 503;
    res.end("The server is starting again, try in a moment.", () => process.exit(1));
    return;
  }
  // Vercel calls the function at /api, with the path that was asked for in `route`, see vercel.json
  const url = new URL(req.url ?? "/", "http://localhost");
  const route = url.searchParams.get("route");
  if (url.pathname === "/api" && route !== null) {
    url.searchParams.delete("route");
    req.url = `/${route}${url.search}`;
  }
  if (req.url?.startsWith("/api/auth/")) return signIn(req, res);
  return graphql(req, res);
};
