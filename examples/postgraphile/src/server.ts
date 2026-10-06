import { createServer } from "node:http";
import { postgraphile } from "postgraphile";
import { grafserv } from "postgraphile/grafserv/node";
import { signToken } from "./auth";
import { pool } from "./db";
import { preset } from "./graphile.config";

const pgl = postgraphile(preset);
const serv = pgl.createServ(grafserv);

// For trying the API only: anyone can get the token of anyone by their email. A real app signs people in first.
const login = async (body: string) => {
  const { email } = JSON.parse(body) as { email?: string };
  const { rows } = await pool.query<{ role_id: string }>(`select role_id from person where email = $1`, [email]);
  return rows[0] ? { token: await signToken(rows[0].role_id) } : undefined;
};

const graphql = serv.createHandler();

const server = createServer((req, res) => {
  if (req.method === "POST" && req.url === "/login") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      const result = await login(body).catch(() => undefined);
      res.writeHead(result ? 200 : 401, { "content-type": "application/json" });
      res.end(JSON.stringify(result ?? { error: "Unknown email" }));
    });
    return;
  }
  graphql(req, res);
});

const port = preset.grafserv?.port ?? 5678;
server.listen(port, () => console.log(`GraphQL and GraphiQL on http://localhost:${port}/graphql`));
