import * as path from "node:path";
import { closing, insertLines, lines, type App } from "./app.js";
import { addDependency, addImport } from "./python.js";
import type { Stack } from "./stack.js";

// The module that makes the FastAPI app, and the name of the app
const appModule = async (app: App) => {
  for (const file of await app.list(".", [".py"])) {
    const name = /^(\w+)\s*=\s*FastAPI\(/m.exec((await app.read(file))!)?.[1];
    if (name) return { file, name };
  }
  return undefined;
};

// The env.py of the migrations of alembic, from the script_location of alembic.ini
const alembicEnv = async (app: App) => {
  const ini = await app.read("alembic.ini");
  if (ini === undefined) return undefined;
  const location = /^script_location\s*=\s*(.+)$/m.exec(ini)?.[1]?.trim().replace(/^%\(here\)s\/?/, "") ?? "alembic";
  return path.join(location, "env.py");
};

export const fastapi: Stack = {
  name: "fastapi",
  title: "FastAPI and SQLAlchemy",
  guide: "sqlalchemy",
  install: "uv sync",
  left: [
    "Run the queries of each request in a session as its user, with as_user or as_user_async of p9s.sqlalchemy, in a dependency like Depends(writing)",
    "Delete the permission checks of the routes: the policies hide the rows the user does not read, and refuse the writes",
    "Answer 404 for a row the user does not read, and 403 when a write changes no row",
  ],
  detect: async app => /["']fastapi[\s[<>=~!"']/i.test((await app.read("pyproject.toml")) ?? (await app.read("requirements.txt")) ?? ""),

  async adopt(app, options) {
    await addDependency(app, options, "sqlalchemy");
    const main = await appModule(app);
    if (!main) throw new Error("No module makes an app with FastAPI()");
    await app.edit(main.file, code => {
      if (code.includes("is_refused")) return code;
      let result = code;
      for (const [module, names] of [["fastapi", ["Request"]], ["fastapi.responses", ["JSONResponse"]], ["p9s", ["Identity", "is_refused"]], ["sqlalchemy.exc", ["DBAPIError"]]] as const) {
        result = addImport(result, module, [...names]);
      }
      const declaration = new RegExp(`^${main.name}\\s*=\\s*FastAPI\\(`, "m").exec(result)!;
      const end = lines(result.slice(0, closing(result, declaration.index + declaration[0].length - 1))).length;
      return insertLines(result, end, [
        "",
        "# Every query of a request runs in a transaction as its user, and the policies of p9s decide what it reads and writes",
        `users = Identity.from_file("${options.configFile}")`,
        "",
        "",
        "# A write the policies do not let through",
        `@${main.name}.exception_handler(DBAPIError)`,
        "async def refused(request: Request, error: DBAPIError):",
        "    if is_refused(error):",
        '        return JSONResponse({"detail": "Forbidden"}, status_code=403)',
        "    raise error",
        "",
      ]);
    });

    const env = await alembicEnv(app);
    if (env && (await app.read(env)) !== undefined) {
      await app.edit(env, code => {
        if (code.includes("include_object")) return code;
        const firstFunction = lines(code).findIndex(line => /^def\s/.test(line));
        let result = insertLines(code, firstFunction === -1 ? lines(code).length : firstFunction, [
          "# p9s adds tables, columns and constraints the models do not know: autogenerate leaves what only the database has",
          "def include_object(object, name, type_, reflected, compare_to) -> bool:",
          "    return not (reflected and compare_to is None)",
          "",
          "",
        ]);
        for (let at = result.indexOf("context.configure("); at !== -1; at = result.indexOf("context.configure(", at + 1)) {
          const close = closing(result, at + "context.configure".length);
          const args = result.slice(at + "context.configure(".length, close);
          const added = args.includes("\n")
            ? `${args.trimEnd().replace(/,?$/, ",")}\n${/\n(\s*)\S/.exec(args)?.[1] ?? "    "}include_object=include_object,\n${/\n(\s*)$/.exec(args)?.[1] ?? ""}`
            : `${args.trim() ? `${args.trim().replace(/,$/, "")}, ` : ""}include_object=include_object`;
          result = `${result.slice(0, at + "context.configure(".length)}${added}${result.slice(close)}`;
        }
        return result;
      });
    }
  },
};
