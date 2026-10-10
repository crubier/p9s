import { lines, sortedIndex } from "./app.js";
import { packagePath, type Stack } from "./stack.js";

export const axum: Stack = {
  name: "axum",
  title: "Rust, with axum and sqlx",
  guide: "rust",
  install: "cargo build",
  left: [
    "Make the state of the router P9s::new(pool, Identity::from_file(\"p9s.config.json\")), and put the CurrentUser of each request in its extensions, from the middleware that authenticates it",
    "Take a UserTx in the handlers, run their queries on it and commit it, and answer 403 when p9s::is_refused(&error), or a write changes no row",
    "Delete the permission checks of the handlers: the policies hide the rows the user does not read, and refuse the writes",
  ],
  detect: async app => (await app.read("Cargo.toml")) !== undefined,

  async adopt(app, options) {
    await app.edit("Cargo.toml", toml => {
      const all = lines(toml);
      const section = all.findIndex(line => line.trim() === "[dependencies]");
      if (section === -1) throw new Error("No [dependencies] in Cargo.toml");
      let end = all.findIndex((line, index) => index > section && /^\[/.test(line));
      if (end === -1) end = all.length;
      const items = Array.from({ length: end - section - 1 }, (_, offset) => section + 1 + offset).filter(index => /^[\w-]+\s*=/.test(all[index]!));
      if (items.some(index => /^p9s\s*=/.test(all[index]!))) return toml;
      const features = items.some(index => /^axum\s*=/.test(all[index]!)) ? `, features = ["axum"]` : "";
      const source = options.packages ? `path = "${packagePath(app, options, "rust")}"` : `version = "${options.version}"`;
      const at = sortedIndex(items, index => /^([\w-]+)/.exec(all[index]!)![1]!, "p9s");
      all.splice(at < items.length ? items[at]! : items.at(-1)! + 1, 0, `p9s = { ${source}${features} }`);
      return all.join("\n");
    });
  },
};
