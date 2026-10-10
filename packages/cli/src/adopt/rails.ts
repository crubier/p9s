import { insertLines, lastIndex, lines, sortedIndex, tableOfModel, type App } from "./app.js";
import { packagePath, tablesOf, type Stack } from "./stack.js";

const controller = "app/controllers/application_controller.rb";

export const rails: Stack = {
  name: "rails",
  title: "Rails",
  guide: "rails",
  install: "bundle install",
  left: [
    "Delete the permission checks of the app, and read and write as the user: the policies hide the rows the user does not read, and refuse the writes",
    "Answer 404 for a row the user does not read, and 403 when a write changes no row",
  ],
  detect: async app => /^\s*gem\s+["'](rails|railties)["']/m.test((await app.read("Gemfile")) ?? "") && (await app.exists(controller)),

  async adopt(app, options) {
    await app.edit("Gemfile", gemfile => {
      if (/^\s*gem\s+["']p9s["']/m.test(gemfile)) return gemfile;
      const all = lines(gemfile);
      const gems = all.flatMap((line, index) => /^gem\s+["']([^"']+)["']/.exec(line) ? [{ index, name: /^gem\s+["']([^"']+)["']/.exec(line)![1]! }] : []);
      const source = options.packages ? `path: "${packagePath(app, options, "ruby")}"` : `"~> ${options.version}"`;
      const at = sortedIndex(gems, gem => gem.name, "p9s");
      const index = gems.length === 0 ? all.length : at < gems.length ? gems[at]!.index : gems.at(-1)!.index + 1;
      return insertLines(gemfile, index, [`gem "p9s", ${source}`]);
    });

    await app.edit(controller, code => {
      if (code.includes("P9s::Controller")) return code;
      const all = lines(code);
      const declaration = all.findIndex(line => /^\s*class\s+ApplicationController\b/.test(line));
      if (declaration === -1) throw new Error(`No class ApplicationController in ${controller}`);
      // After the callbacks the class declares first, like before_action :authenticate, so that p9s comes after them
      let header = declaration + 1;
      while (header < all.length && /^\s+(?!def\b|private\b|protected\b|public\b|#)\S/.test(all[header]!)) header++;
      const block = [
        "  # Every action runs in a transaction as its user, where the policies of p9s decide what it reads and writes",
        "  include P9s::Controller",
        "",
        "  # A write the policies do not let through, after its transaction rolled back",
        "  rescue_from ActiveRecord::StatementInvalid do |error|",
        "    raise error unless P9s.refused?(error)",
        "",
        "    head :forbidden",
        "  end",
      ];
      all.splice(header, 0, ...(header === declaration + 1 ? [...block, ""] : ["", ...block]));
      const end = lastIndex(all, line => /^end\s*$/.test(line));
      const methods = [
        ...(all.some(line => /^\s+private\s*$/.test(line)) ? [] : ["", "  private"]),
        "",
        "  # Read only transactions for the requests that read",
        "  def p9s_read_only?",
        "    request.get? || request.head?",
        "  end",
        ...(options.userId ? ["", "  def p9s_user_id", `    ${options.userId}`, "  end"] : []),
      ];
      all.splice(end, 0, ...methods);
      return all.join("\n");
    });

    const { columns, written } = tablesOf(options.config);
    for (const file of await app.list("app/models", [".rb"])) {
      await app.edit(file, code => {
        const declaration = /^([ \t]*)class\s+(\w+)\s*<\s*(ApplicationRecord|ActiveRecord::Base)\b.*$/m.exec(code);
        if (!declaration) return code;
        const table = /self\.table_name\s*=\s*["'](\w+)["']/.exec(code)?.[1] ?? tableOfModel(declaration[2]!);
        const indent = `${declaration[1]}  `;
        let result = code;
        const ignored = (columns.get(table) ?? []).filter(column => !new RegExp(`ignored_columns.*["']${column}["']`).test(code));
        if (ignored.length > 0) {
          const at = lines(result.slice(0, declaration.index)).length;
          result = insertLines(result, at, [
            `${indent}# The columns of p9s, which the app neither reads nor writes`,
            `${indent}self.ignored_columns += [${ignored.map(column => `"${column}"`).join(", ")}]`,
          ]);
        }
        if (written.has(table)) {
          const all = lines(result);
          const required = all.flatMap((line, index) => /^\s*belongs_to\s+:\w+\s*$/.test(line) ? [index] : []);
          for (const index of required) all[index] = `${all[index]!.trimEnd()}, optional: true`;
          if (required.length > 0) {
            all.splice(required[0]!, 0,
              `${indent}# The database checks the foreign keys, and the policies of p9s what the user writes. A required belongs_to`,
              `${indent}# would read the row it points to as the user, who may not read it.`);
          }
          result = all.join("\n");
        }
        return result;
      });
    }
  },
};
