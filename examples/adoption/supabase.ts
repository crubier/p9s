import { createHmac } from "node:crypto";
import { chmod, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

// What a Supabase project gives an app, on any Postgres: its roles, an auth schema, the grants it makes on public, and
// its data API, PostgREST under /rest/v1, with the keys of the project

const postgrestVersion = "v16.4";
const jwtSecret = "p9s-adoption-tests-jwt-secret-of-the-supabase-stack";

// The roles exist once per cluster, the rest once per database. Supabase grants anon, authenticated and service_role
// every privilege on what the migrations create in public.
const bootstrap = `
do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end
$$;

create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.jwt() returns jsonb language sql stable
  as $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb $$;
create function auth.uid() returns uuid language sql stable
  as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

export const prepareSupabase = async (url: string) => {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try { await client.query(bootstrap); } finally { await client.end(); }
};

const base64url = (value: string | Buffer) => Buffer.from(value).toString("base64url");

export const signJwt = (claims: Record<string, unknown>, secret = jwtSecret) => {
  const unsigned = `${base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${base64url(JSON.stringify(claims))}`;
  return `${unsigned}.${createHmac("sha256", secret).update(unsigned).digest("base64url")}`;
};

const platforms: Record<string, string> = {
  "darwin-arm64": "macos-aarch64",
  "darwin-x64": "macos-x86-64",
  "linux-arm64": "linux-static-aarch64",
  "linux-x64": "linux-static-x86-64",
};

// P9S_POSTGREST, postgrest on the PATH, or a release of PostgREST downloaded once
const postgrestBinary = async () => {
  const found = process.env.P9S_POSTGREST ?? Bun.which("postgrest");
  if (found) return found;
  const platform = platforms[`${process.platform}-${process.arch}`];
  if (!platform) throw new Error(`No PostgREST release for ${process.platform}-${process.arch}, set P9S_POSTGREST`);
  const directory = path.join(import.meta.dir, ".adoption", `postgrest-${postgrestVersion}`);
  const binary = path.join(directory, "postgrest");
  if (await Bun.file(binary).exists()) return binary;
  await mkdir(directory, { recursive: true });
  const name = `postgrest-${postgrestVersion}-${platform}.tar.xz`;
  const response = await fetch(`https://github.com/PostgREST/postgrest/releases/download/${postgrestVersion}/${name}`);
  if (!response.ok) throw new Error(`Downloading ${name}: ${response.status}`);
  const archive = path.join(directory, name);
  await Bun.write(archive, response);
  const tar = Bun.spawn(["tar", "-xJf", archive, "-C", directory], { stderr: "pipe" });
  if (await tar.exited !== 0) throw new Error(`Extracting ${name}: ${await new Response(tar.stderr).text()}`);
  await rm(archive);
  await chmod(binary, 0o755);
  return binary;
};

const freePort = () => {
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() });
  const { port } = server;
  server.stop(true);
  return port;
};

// PostgREST on the database, behind /rest/v1 like the API of a project, and the environment of the app
export const startSupabase = async (url: string, log: string) => {
  const [port, adminPort] = [freePort(), freePort()];
  const output = Bun.file(log);
  const postgrest = Bun.spawn([await postgrestBinary()], {
    env: {
      ...process.env,
      PGRST_DB_URI: url,
      PGRST_DB_SCHEMAS: "public",
      PGRST_DB_ANON_ROLE: "anon",
      PGRST_JWT_SECRET: jwtSecret,
      PGRST_SERVER_HOST: "127.0.0.1",
      PGRST_SERVER_PORT: String(port),
      PGRST_ADMIN_SERVER_PORT: String(adminPort),
    },
    stdin: "ignore",
    stdout: output,
    stderr: output,
  });
  const deadline = Date.now() + 60_000;
  while (!await fetch(`http://127.0.0.1:${adminPort}/ready`).then(response => response.ok, () => false)) {
    if (postgrest.exitCode !== null) throw new Error(`PostgREST exited with ${postgrest.exitCode}:\n${await output.text()}`);
    if (Date.now() > deadline) throw new Error(`PostgREST is not ready:\n${await output.text()}`);
    await Bun.sleep(100);
  }
  const proxy = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: request => {
      const { pathname, search } = new URL(request.url);
      if (!pathname.startsWith("/rest/v1")) return new Response("not found", { status: 404 });
      return fetch(`http://127.0.0.1:${port}${pathname.slice("/rest/v1".length) || "/"}${search}`, {
        method: request.method,
        headers: request.headers,
        body: request.body,
      });
    },
  });
  const env = {
    SUPABASE_URL: `http://127.0.0.1:${proxy.port}`,
    SUPABASE_ANON_KEY: signJwt({ iss: "supabase", role: "anon" }),
    SUPABASE_SERVICE_ROLE_KEY: signJwt({ iss: "supabase", role: "service_role" }),
    SUPABASE_JWT_SECRET: jwtSecret,
  };
  // The requests to the API itself that get through: anon reading any table, and a signed in user reading the tables
  // of memberships and shares, joining a team, or giving their team a project
  const leaks = async () => {
    const tables = ["users", "teams", "team_members", "projects", "project_shares", "documents", "document_shares"];
    const dave = signJwt({ sub: "4", role: "authenticated" });
    const requests: Array<[string, string, string, unknown?]> = [
      ...tables.map((table): [string, string, string] => [env.SUPABASE_ANON_KEY, "GET", table]),
      ...["team_members", "project_shares"].map((table): [string, string, string] => [dave, "GET", table]),
      [dave, "POST", "team_members", { team_id: 1, user_id: 4 }],
      [dave, "POST", "project_shares", { project_id: 2, team_id: 1, access: "owner" }],
    ];
    const through: string[] = [];
    for (const [token, method, table, body] of requests) {
      const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, {
        method,
        headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (response.ok) through.push(`${token === dave ? "dave" : "anon"} ${method} ${table}`);
    }
    return through;
  };
  const stop = async () => {
    proxy.stop(true);
    postgrest.kill();
    await postgrest.exited;
  };
  return { env, leaks, stop };
};
