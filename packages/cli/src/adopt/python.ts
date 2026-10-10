import { closing, insertLines, lines, sortedIndex, type App } from "./app.js";
import { packagePath, type Options } from "./stack.js";

// Adds p9s with an extra to the dependencies of the [project] of pyproject.toml, and with packages, takes it from the
// repository with uv
export const addDependency = async (app: App, options: Options, extra: string) => {
  if (!(await app.exists("pyproject.toml"))) {
    app.notes.push(`Add p9s[${extra}] to the dependencies of the app`);
    return;
  }
  await app.edit("pyproject.toml", toml => {
    let result = toml;
    const start = /^dependencies\s*=\s*\[/m.exec(result);
    if (!start) throw new Error("No dependencies = [...] in pyproject.toml");
    const open = start.index + start[0].length - 1;
    const close = closing(result, open);
    const body = result.slice(open + 1, close);
    if (!/["']p9s[\s[<>=~!"']/.test(body)) {
      const requirement = `"p9s[${extra}]>=${options.version}"`;
      const items = [...body.matchAll(/["']([^"']+)["']/g)].map(match => match[1]!);
      const nameOf = (item: string) => /^[\w.-]+/.exec(item)?.[0] ?? item;
      const at = sortedIndex(items, nameOf, "p9s");
      if (body.includes("\n")) {
        const bodyLines = lines(body);
        const itemLines = bodyLines.flatMap((line, index) => /^\s*["']/.test(line) ? [index] : []);
        const indent = /^\s*/.exec(bodyLines[itemLines[0] ?? 0] ?? "")![0] || "  ";
        const index = at < itemLines.length ? itemLines[at]! : (itemLines.at(-1) ?? 0) + 1;
        if (at >= itemLines.length && itemLines.length > 0 && !bodyLines[itemLines.at(-1)!]!.trimEnd().endsWith(",")) {
          bodyLines[itemLines.at(-1)!] = `${bodyLines[itemLines.at(-1)!]!.trimEnd()},`;
        }
        bodyLines.splice(index, 0, `${indent}${requirement},`);
        result = `${result.slice(0, open + 1)}${bodyLines.join("\n")}${result.slice(close)}`;
      } else {
        const quoted = [...body.matchAll(/["'][^"']+["']/g)].map(match => match[0]);
        quoted.splice(at, 0, requirement);
        result = `${result.slice(0, open + 1)}${quoted.join(", ")}${result.slice(close)}`;
      }
    }
    if (options.packages && !/^\s*p9s\s*=/m.test(result.slice(result.indexOf("[tool.uv.sources]")))) {
      const source = `p9s = { path = "${packagePath(app, options, "python")}", editable = true }`;
      result = result.includes("[tool.uv.sources]")
        ? result.replace("[tool.uv.sources]", `[tool.uv.sources]\n${source}`)
        : `${result.trimEnd()}\n\n[tool.uv.sources]\n${source}\n`;
    }
    return result;
  });
};

const standard = new Set(["abc", "asyncio", "collections", "contextlib", "dataclasses", "datetime", "decimal", "enum", "functools", "json", "itertools", "logging", "math", "os", "pathlib", "re", "sys", "typing", "urllib", "uuid", "__future__"]);

const moduleOf = (line: string) => /^(?:from|import)\s+([\w.]+)/.exec(line)?.[1] ?? "";

// Adds from module import names to a Python file: to the import of the module if there is one, or as a new import in
// the group of imports of its kind, the standard library, other packages, or the app, sorted
export const addImport = (code: string, module: string, names: string[]) => {
  const all = lines(code);
  const existing = all.findIndex(line => line.startsWith(`from ${module} import `));
  if (existing !== -1 && !all[existing]!.includes("(")) {
    const present = all[existing]!.slice(`from ${module} import `.length).split(",").map(name => name.trim()).filter(Boolean);
    const merged = [...new Set([...present, ...names])].sort();
    all[existing] = `from ${module} import ${merged.join(", ")}`;
    return all.join("\n");
  }
  if (existing !== -1) {
    const end = all.findIndex((line, index) => index > existing && line.includes(")"));
    const present = all.slice(existing + 1, end).map(line => line.trim().replace(/,$/, ""));
    const added = names.filter(name => !present.includes(name));
    all.splice(end, 0, ...added.map(name => `    ${name},`));
    return all.join("\n");
  }
  // The imports at the top of the file, in groups separated by blank lines
  const groups: number[][] = [];
  for (let index = 0; index < all.length; index++) {
    const line = all[index]!;
    if (/^(from|import)\s/.test(line)) {
      if (index > 0 && /^(from|import)\s/.test(all[index - 1]!)) groups.at(-1)!.push(index);
      else groups.push([index]);
    } else if (line.trim() !== "" && !line.startsWith("#") && !line.startsWith('"""') && groups.length > 0) {
      break;
    }
  }
  const kind = (name: string) => name.startsWith(".") ? 2 : standard.has(name.split(".")[0]!) ? 0 : 1;
  const wanted = kind(module);
  const statement = `from ${module} import ${[...names].sort().join(", ")}`;
  const group = groups.find(indexes => kind(moduleOf(all[indexes[0]!]!)) === wanted);
  if (group) {
    const froms = group.filter(index => all[index]!.startsWith("from "));
    const at = sortedIndex(froms, index => moduleOf(all[index]!), module);
    const index = at < froms.length ? froms[at]! : group.at(-1)! + 1;
    all.splice(index, 0, statement);
    return all.join("\n");
  }
  // A new group, after the groups of the kinds before it
  const before = groups.filter(indexes => kind(moduleOf(all[indexes[0]!]!)) < wanted);
  if (before.length > 0) return insertLines(all.join("\n"), before.at(-1)!.at(-1)! + 1, ["", statement]);
  if (groups.length > 0) return insertLines(all.join("\n"), groups[0]![0]!, [statement, ""]);
  return `${statement}\n\n${code}`;
};
