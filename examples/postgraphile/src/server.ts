import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { handle, servesPath } from "./handler";

// One server for the app, GraphQL and GraphiQL. In development Vite serves the pages, and reloads them; otherwise
// they are the files `vite build` wrote to dist
const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT ?? 3200);
const dist = new URL("../dist/", import.meta.url).pathname;

const vite = dev
  ? await (await import("vite")).createServer({ server: { middlewareMode: true }, appType: "spa" })
  : undefined;

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
};

const serveFile = async (url: string, res: import("node:http").ServerResponse) => {
  const path = normalize(join(dist, decodeURIComponent(url.split("?")[0]!)));
  const file = path.startsWith(dist) && (await stat(path).catch(() => undefined))?.isFile() ? path : join(dist, "index.html");
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
};

createServer((req, res) => {
  if (servesPath(req.url)) return void handle(req, res);
  if (vite) return vite.middlewares(req, res);
  void serveFile(req.url ?? "/", res);
}).listen(port, () => console.log(`App on http://localhost:${port}, GraphiQL on http://localhost:${port}/graphiql`));
