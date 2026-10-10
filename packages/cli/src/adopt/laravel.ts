import { closing, insertLines, lines, sortedIndex, tableOfModel } from "./app.js";
import { packagePath, tablesOf, type Stack } from "./stack.js";

// Adds use statements to a PHP file, sorted with the others
const addUses = (code: string, names: string[]) => {
  let result = code;
  for (const name of names) {
    if (new RegExp(`^use ${name.replaceAll("\\", "\\\\")};`, "m").test(result)) continue;
    const all = lines(result);
    const uses = all.flatMap((line, index) => /^use\s+[\w\\]+;/.test(line) ? [index] : []);
    if (uses.length === 0) {
      const after = all.findIndex(line => /^(namespace\s|<\?php)/.test(line));
      all.splice(after + 1, 0, "", `use ${name};`);
    } else {
      const at = sortedIndex(uses, index => /^use\s+([\w\\]+);/.exec(all[index]!)![1]!, name);
      all.splice(at < uses.length ? uses[at]! : uses.at(-1)! + 1, 0, `use ${name};`);
    }
    result = all.join("\n");
  }
  return result;
};

export const laravel: Stack = {
  name: "laravel",
  title: "Laravel",
  guide: "laravel",
  install: "composer update p9s/laravel",
  left: [
    "Delete the permission checks of the controllers, and read and write as the user: the policies hide the rows the user does not read, and refuse the writes",
    "Answer 404 for a row the user does not read, and 403 when a write changes no row",
  ],
  detect: async app => /"laravel\/framework"/.test((await app.read("composer.json")) ?? ""),

  async adopt(app, options) {
    await app.edit("composer.json", text => {
      const composer = JSON.parse(text) as { require?: Record<string, string>; repositories?: unknown[] };
      if (composer.require?.["p9s/laravel"]) return text;
      const require = Object.entries(composer.require ?? {});
      const platform = require.filter(([name]) => !name.includes("/"));
      const packages = require.filter(([name]) => name.includes("/"));
      packages.splice(sortedIndex(packages, ([name]) => name, "p9s/laravel"), 0, ["p9s/laravel", `^${options.version}`]);
      composer.require = Object.fromEntries([...platform, ...packages]);
      if (options.packages) {
        composer.repositories = [
          ...(composer.repositories ?? []),
          { type: "path", url: packagePath(app, options, "php"), options: { versions: { "p9s/laravel": `${options.version}.0` } } },
        ];
      }
      const indent = /\n(\s+)"/.exec(text)?.[1] ?? "    ";
      return `${JSON.stringify(composer, null, indent)}\n`;
    });

    await app.edit("bootstrap/app.php", code => {
      if (code.includes("P9s::isRefused")) return code;
      let result = addUses(code, ["Illuminate\\Database\\QueryException", "P9s\\P9s", ...(options.userId ? ["Illuminate\\Http\\Request"] : [])]);
      const exceptions = /->withExceptions\(function \(Exceptions \$(\w+)\)(?:: void)? \{/.exec(result);
      if (!exceptions) throw new Error("No ->withExceptions(function (Exceptions $exceptions) {...}) in bootstrap/app.php");
      const open = exceptions.index + exceptions[0].length - 1;
      const close = closing(result, open);
      const body = result.slice(open + 1, close);
      const indent = /\n(\s*)\S/.exec(body)?.[1] ?? "        ";
      const render = [
        `${indent}// A write the policies of p9s do not let through`,
        `${indent}$${exceptions[1]}->render(fn (QueryException $error) => P9s::isRefused($error)`,
        `${indent}    ? response()->json(['message' => 'Forbidden'], 403)`,
        `${indent}    : null);`,
      ].join("\n");
      const kept = body.trim() === "//" ? "" : body.replace(/\s*$/, "");
      result = `${result.slice(0, open + 1)}${kept}\n${render}\n${indent.slice(4)}${result.slice(close)}`;
      if (options.userId) {
        const create = result.lastIndexOf("->create();");
        const lineStart = result.lastIndexOf("\n", create) + 1;
        const outer = result.slice(lineStart, create);
        result = `${result.slice(0, lineStart)}${outer}->booted(function () {\n${outer}    P9s::resolveUserIdUsing(fn (Request $request) => ${options.userId});\n${outer}})\n${result.slice(lineStart)}`;
      }
      return result;
    });

    await app.edit("routes/api.php", code => {
      if (code.includes("AsUser::class")) return code;
      let found = false;
      const result = code.replace(/Route::middleware\((\[[^\]]*\]|'[^']*'|"[^"]*")\)/g, (match, list: string) => {
        const names = list.startsWith("[") ? list.slice(1, -1).split(",").map(name => name.trim()).filter(Boolean) : [list];
        if (!names.some(name => /^['"]auth/.test(name))) return match;
        found = true;
        return `Route::middleware([${[...names, "AsUser::class"].join(", ")}])`;
      });
      if (!found) {
        app.notes.push("Add the middleware P9s\\AsUser to the routes of signed in users, after the middleware that authenticates them");
        return code;
      }
      return addUses(result, ["P9s\\AsUser"]);
    });

    const { columns } = tablesOf(options.config);
    for (const file of await app.list("app/Models", [".php"])) {
      await app.edit(file, code => {
        const declaration = /^(\s*)(?:final\s+)?class\s+(\w+)\s+extends\s+(?:Model|Authenticatable|Pivot)\b[^{]*\{/m.exec(code);
        if (!declaration) return code;
        const table = /protected\s+\$table\s*=\s*['"](\w+)['"]/.exec(code)?.[1] ?? tableOfModel(declaration[2]!);
        const hidden = (columns.get(table) ?? []).filter(column => !new RegExp(`\\$hidden[^;]*['"]${column}['"]`).test(code));
        if (hidden.length === 0) return code;
        const quoted = hidden.map(column => `'${column}'`);
        const existing = /protected\s+\$hidden\s*=\s*\[([^\]]*)\]/.exec(code);
        if (existing) {
          const items = existing[1]!.trim() ? `${existing[1]!.trim().replace(/,$/, "")}, ${quoted.join(", ")}` : quoted.join(", ");
          return code.replace(existing[0], `protected $hidden = [${items}]`);
        }
        const all = lines(code);
        const open = lines(code.slice(0, declaration.index + declaration[0].length)).length;
        const timestamps = all.findIndex(line => /^\s*public\s+\$timestamps\b/.test(line));
        const at = timestamps === -1 ? open : timestamps + 1;
        return insertLines(code, at, [
          ...(timestamps === -1 ? [] : [""]),
          "    /** The columns of p9s, which the API does not show */",
          `    protected $hidden = [${quoted.join(", ")}];`,
          ...(timestamps === -1 ? [""] : []),
        ]);
      });
    }
  },
};
