import { lastIndex, lines, sortedIndex, type App } from "./app.js";
import { packagePath, type Stack } from "./stack.js";

const module = "github.com/crubier/p9s/packages/go";

// The package of the Go files at the root of the module, like main
const rootPackage = async (app: App) => {
  for (const file of await app.list(".", [".go"])) {
    if (file.includes("/") || file.endsWith("_test.go")) continue;
    const name = /^package\s+(\w+)/m.exec((await app.read(file))!)?.[1];
    if (name) return name;
  }
  return undefined;
};

export const go: Stack = {
  name: "go",
  title: "Go",
  guide: "go",
  install: "go mod tidy",
  left: [
    "Run each request in a transaction as its user, with p9spgx.AsUser, p9sgorm.AsUser or p9s.AsUser of database/sql, and the identity users of p9s.go",
    "Answer 403 when the error of the transaction is p9s.IsRefused, or a write changes no row, and 404 for a row the user does not read",
    "Delete the permission checks of the handlers: the policies hide the rows the user does not read, and refuse the writes",
  ],
  detect: async app => (await app.read("go.mod")) !== undefined,

  async adopt(app, options) {
    await app.edit("go.mod", mod => {
      if (mod.includes(module)) return mod;
      const all = lines(mod);
      const block = all.findIndex(line => /^require\s*\($/.test(line));
      const requirement = `${module} v${options.version}.0`;
      if (block === -1) {
        const last = lastIndex(all, line => /^(module|go|toolchain|require)\s/.test(line));
        all.splice(last + 1, 0, "", `require ${requirement}`);
      } else {
        const end = all.findIndex((line, index) => index > block && line === ")");
        const items = Array.from({ length: end - block - 1 }, (_, offset) => block + 1 + offset);
        const at = sortedIndex(items, index => all[index]!.trim(), module);
        all.splice(at < items.length ? items[at]! : end, 0, `\t${requirement}`);
      }
      let result = all.join("\n");
      if (options.packages) result = `${result.trimEnd()}\n\nreplace ${module} => ${packagePath(app, options, "go")}\n`;
      return result;
    });
    const name = await rootPackage(app);
    if (!name) {
      app.notes.push("Make the identity of p9s.config.json with p9s.FromFile, in the package that handles the requests");
      return;
    }
    await app.create("p9s.go", `package ${name}

import p9s "${module}"

// How a transaction acts as the user of a request: the role and the setting of the config of p9s, whose policies decide
// what it reads and writes
var users = p9s.Must(p9s.FromFile("${options.configFile}"))
`);
  },
};
