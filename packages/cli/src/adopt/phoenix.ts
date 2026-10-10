import { closing, lines, sortedIndex, type App } from "./app.js";
import { packagePath, type Stack } from "./stack.js";

// The module of the Ecto repo of the app, like MyApp.Repo
const repoModule = async (app: App) => {
  for (const file of await app.list("lib", [".ex"])) {
    const code = (await app.read(file))!;
    if (code.includes("use Ecto.Repo")) return /defmodule\s+([\w.]+)\s+do/.exec(code)?.[1];
  }
  return undefined;
};

export const phoenix: Stack = {
  name: "phoenix",
  title: "Phoenix and Ecto",
  guide: "elixir",
  install: "mix deps.get",
  left: [
    "Delete the permission checks of the controllers, and read and write as the user: the policies hide the rows the user does not read, and refuse the writes",
    "Answer 404 for a row the user does not read, and 403 when a write changes no row, or override p9s_refused/2 for the answer to a refused write",
  ],
  detect: async app => /\{:phoenix,/.test((await app.read("mix.exs")) ?? ""),

  async adopt(app, options) {
    await app.edit("mix.exs", mix => {
      if (/\{:p9s,/.test(mix)) return mix;
      const start = /defp deps do\s*\[/.exec(mix);
      if (!start) throw new Error("No defp deps do [...] in mix.exs");
      const open = start.index + start[0].length - 1;
      const close = closing(mix, open);
      const bodyLines = lines(mix.slice(open + 1, close));
      const items = bodyLines.flatMap((line, index) => /^\s*\{:\w+/.test(line) ? [index] : []);
      const at = sortedIndex(items, index => /\{:(\w+)/.exec(bodyLines[index]!)![1]!, "p9s");
      const indent = /^\s*/.exec(bodyLines[items[0] ?? 0] ?? "")![0] || "      ";
      const source = options.packages ? `path: "${packagePath(app, options, "elixir")}"` : `"~> ${options.version}"`;
      if (at < items.length) {
        bodyLines.splice(items[at]!, 0, `${indent}{:p9s, ${source}},`);
      } else {
        bodyLines[items.at(-1)!] = `${bodyLines[items.at(-1)!]!.trimEnd()},`;
        bodyLines.splice(items.at(-1)! + 1, 0, `${indent}{:p9s, ${source}}`);
      }
      return `${mix.slice(0, open + 1)}${bodyLines.join("\n")}${mix.slice(close)}`;
    });

    const repo = await repoModule(app);
    if (!repo) throw new Error("No module of lib uses Ecto.Repo");
    const web = (await app.list("lib", [".ex"])).find(file => /^lib\/\w+_web\.ex$/.test(file));
    if (!web) throw new Error("No lib/<app>_web.ex, where Phoenix apps define what their controllers use");
    await app.edit(web, code => {
      if (code.includes("P9s.Controller")) return code;
      const all = lines(code);
      const controller = all.findIndex(line => /^\s*def controller do/.test(line));
      const use = all.findIndex((line, index) => index > controller && /^\s*use Phoenix\.Controller\b/.test(line));
      if (controller === -1 || use === -1) throw new Error(`No def controller with use Phoenix.Controller in ${web}`);
      const indent = /^\s*/.exec(all[use]!)![0];
      all.splice(use + 1, 0,
        `${indent}# Every action runs in a transaction as its user, where the policies of p9s decide what it reads and writes`,
        `${indent}use P9s.Controller, repo: ${repo}`);
      if (options.userId) {
        // Before the end of the quote block of def controller
        const quoteIndent = indent.slice(2);
        const end = all.findIndex((line, index) => index > use && line === `${quoteIndent}end`);
        all.splice(end, 0, "", `${indent}def p9s_user_id(conn), do: ${options.userId}`);
      }
      return all.join("\n");
    });
  },
};
