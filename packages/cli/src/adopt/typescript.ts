import * as path from "node:path";
import { lastIndex, lines, sortedIndex, type App } from "./app.js";
import type { Options, Stack } from "./stack.js";

const sources = [".ts", ".tsx", ".mts", ".js", ".mjs"];

// Whether the app depends on one of the packages, in its package.json or in the imports of its code
const uses = async (app: App, packages: string[]) => {
  const manifest = JSON.parse((await app.read("package.json")) ?? "{}") as Record<string, Record<string, string> | undefined>;
  if (packages.some(name => manifest.dependencies?.[name] ?? manifest.devDependencies?.[name])) return true;
  for (const file of await app.list(".", sources)) {
    const code = (await app.read(file))!;
    if (packages.some(name => code.includes(`from "${name}`) || code.includes(`from '${name}`))) return true;
  }
  return false;
};

// Adds the packages of p9s to the dependencies of package.json, sorted, when the app has one
const addDependencies = async (app: App, options: Options, packages: string[]) => {
  if (!(await app.exists("package.json"))) {
    app.notes.push(`Add ${packages.join(" and ")} to the dependencies of the app`);
    return;
  }
  await app.edit("package.json", text => {
    const manifest = JSON.parse(text) as { dependencies?: Record<string, string> };
    const missing = packages.filter(name => !manifest.dependencies?.[name]);
    if (missing.length === 0) return text;
    const entries = Object.entries(manifest.dependencies ?? {});
    for (const name of missing) {
      const version = options.packages ? `file:${path.relative(app.root, path.join(options.packages, "packages", name.replace("@p9s/", "")))}` : `^${options.version}.0`;
      entries.splice(sortedIndex(entries, ([entry]) => entry, name), 0, [name, version]);
    }
    manifest.dependencies = Object.fromEntries(entries);
    const indent = /\n(\s+)"/.exec(text)?.[1] ?? "  ";
    return `${JSON.stringify(manifest, null, indent)}\n`;
  });
};

// The folder of the code of the app, src when it has one
const codeFolder = async (app: App) => (await app.list("src", sources)).length > 0 ? "src" : ".";

// Adds import { names } from module to a module, to its import of the module if there is one, or after its imports
const addImport = (code: string, module: string, names: string[]) => {
  const all = lines(code);
  const existing = all.findIndex(line => new RegExp(`^import \\{[^}]*\\} from ["']${module.replace("/", "\\/")}["'];?$`).test(line));
  if (existing !== -1) {
    const present = /\{([^}]*)\}/.exec(all[existing]!)![1]!.split(",").map(name => name.trim()).filter(Boolean);
    const merged = [...new Set([...present, ...names])].sort((a, b) => a.localeCompare(b));
    all[existing] = all[existing]!.replace(/\{[^}]*\}/, `{ ${merged.join(", ")} }`);
    return all.join("\n");
  }
  const last = lastIndex(all, line => /^import\s.*from\s+["'][^"']+["'];?$/.test(line) || /^import\s+["'][^"']+["'];?$/.test(line));
  all.splice(last + 1, 0, `import { ${names.join(", ")} } from "${module}";`);
  return all.join("\n");
};

// The identity of the config, in a module of its own that the code of the app imports
const addIdentity = async (app: App, options: Options) => {
  const folder = await codeFolder(app);
  const config = path.relative(folder, options.configFile);
  await app.create(path.join(folder, "p9s.ts"), `import { createIdentity } from "@p9s/postgres";
import config from "${config.startsWith(".") ? config : `./${config}`}";

// How a transaction acts as the user of a request: the role and the setting of the config of p9s, whose policies decide
// what it reads and writes
export const users = createIdentity(config);
`);
};

// A Hono app answers 403 to a write the policies refuse, unless it handles errors already
const addRefusedHandler = async (app: App) => {
  for (const file of await app.list(".", sources)) {
    const code = (await app.read(file))!;
    const declaration = /^const (\w+) = new Hono\b.*;$/m.exec(code);
    if (!declaration) continue;
    const name = declaration[1]!;
    if (code.includes("isRefused")) return;
    if (code.includes(`${name}.onError(`)) {
      app.notes.push(`${file} handles errors with ${name}.onError already: answer 403 there when isRefused(error) of @p9s/postgres`);
      return;
    }
    await app.edit(file, text => {
      const withImport = addImport(text, "@p9s/postgres", ["isRefused"]);
      const at = lines(withImport).findIndex(line => line === declaration[0]);
      const all = lines(withImport);
      all.splice(at + 1, 0,
        "",
        "// A write the policies of p9s do not let through",
        `${name}.onError((error, c) => {`,
        '  if (isRefused(error)) return c.json({ error: "forbidden" }, 403);',
        "  throw error;",
        "});");
      return all.join("\n");
    });
    return;
  }
  app.notes.push("Answer 403 to a write the policies refuse: the error is isRefused(error) of @p9s/postgres");
};

const left = (withUser: string) => [
  `Run the queries of each request in a transaction as its user, with ${withUser} and the identity users of p9s.ts`,
  "Delete the permission checks of the routes: the policies hide the rows the user does not read, and refuse the writes",
  "Answer 404 for a row the user does not read, and 403 when a write changes no row",
];

const orm = (name: string, title: string, packages: string[], withUser: string): Stack => ({
  name,
  title,
  guide: name,
  install: "npm install",
  left: left(withUser),
  detect: app => uses(app, packages),
  async adopt(app, options) {
    await addDependencies(app, options, ["@p9s/postgres", `@p9s/${name}`]);
    await addIdentity(app, options);
    await addRefusedHandler(app);
  },
});

export const drizzle = orm("drizzle", "Drizzle", ["drizzle-orm"], "withUser(db, users, userId, tx => ...) of @p9s/drizzle");
export const kysely = orm("kysely", "Kysely", ["kysely"], "withUser(db, users, userId, trx => ...) of @p9s/kysely");
export const prisma = orm("prisma", "Prisma", ["@prisma/client", "@prisma/adapter-pg"], "withUser(prisma, users, userId, tx => ...) of @p9s/prisma");

export const postgraphile: Stack = {
  name: "postgraphile",
  title: "PostGraphile",
  guide: "postgraphile",
  install: "npm install",
  left: [
    "Give PostGraphile the settings of the user of each request: grafast.context returns { pgSettings: users.pgSettings(userId) }, with the identity users of p9s.ts",
    "Drop the policies the app wrote, in a migration of the app, and answer 403 to the errors of the writes that isRefused(error) recognizes",
  ],
  detect: app => uses(app, ["postgraphile"]),
  async adopt(app, options) {
    await addDependencies(app, options, ["@p9s/postgres"]);
    await addIdentity(app, options);
    await addRefusedHandler(app);
  },
};

export const supabase: Stack = {
  name: "supabase",
  title: "Supabase",
  guide: "supabase",
  install: "npm install",
  left: [
    "Make the requests of each user with a client of their own, whose JWT p9s reads the user from, rather than with the service role key",
    "Revoke from anon and authenticated the privileges Supabase grants them on every table, in a migration, so that they keep only those of the config",
    "Delete the permission checks of the routes, and answer 404 for a row the user does not read, and 403 when a write changes no row",
  ],
  detect: app => uses(app, ["@supabase/supabase-js"]),
  async adopt(app, options) {
    await addDependencies(app, options, ["@p9s/postgres"]);
    await addRefusedHandler(app);
  },
};
