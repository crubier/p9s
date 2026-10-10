import * as fs from "node:fs/promises";
import * as path from "node:path";

// Folders of an app that hold what its tools install or build, which adopt neither reads nor edits
const ignored = new Set([".git", "node_modules", ".venv", "venv", "vendor", "target", "_build", "deps", "__pycache__", "tmp", "log", "dist", "build"]);

// The files of an app as adopt reads and changes them, written only at the end, so that a step that fails leaves the
// app as it was
export class App {
  private readonly files = new Map<string, { original: string | undefined; current: string | undefined }>();
  // What adopt could not do on its own, for the person to do
  readonly notes: string[] = [];

  constructor(readonly root: string) {}

  async read(file: string): Promise<string | undefined> {
    const known = this.files.get(file);
    if (known) return known.current;
    const content = await fs.readFile(path.join(this.root, file), "utf-8").catch(() => undefined);
    this.files.set(file, { original: content, current: content });
    return content;
  }

  async exists(file: string) {
    return (await this.read(file)) !== undefined || (await fs.stat(path.join(this.root, file)).catch(() => undefined)) !== undefined;
  }

  async write(file: string, content: string) {
    await this.read(file);
    this.files.get(file)!.current = content;
  }

  // Changes a file with a function of its content, which returns it unchanged when there is nothing to do
  async edit(file: string, change: (content: string) => string) {
    const content = await this.read(file);
    if (content === undefined) throw new Error(`${file} does not exist`);
    await this.write(file, change(content));
  }

  // Writes a file unless it exists
  async create(file: string, content: string) {
    if ((await this.read(file)) === undefined) await this.write(file, content);
  }

  // The files of the app under a folder, relative to the root, sorted
  async list(folder = ".", extensions: string[] = []): Promise<string[]> {
    const found: string[] = [];
    const walk = async (directory: string) => {
      const entries = await fs.readdir(path.join(this.root, directory), { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (!ignored.has(entry.name) && !entry.name.startsWith(".")) await walk(file);
        } else if (extensions.length === 0 || extensions.some(extension => entry.name.endsWith(extension))) {
          found.push(file);
        }
      }
    };
    await walk(folder);
    return found.sort();
  }

  get changed(): string[] {
    return [...this.files].filter(([, { original, current }]) => original !== current).map(([file]) => file).sort();
  }

  async save() {
    for (const file of this.changed) {
      await fs.mkdir(path.dirname(path.join(this.root, file)), { recursive: true });
      await fs.writeFile(path.join(this.root, file), this.files.get(file)!.current!, "utf-8");
    }
  }
}

export const lines = (text: string) => text.split("\n");

// Array.prototype.findLastIndex is ES2023, after the target of the package
export const lastIndex = <T>(items: T[], test: (item: T) => boolean) => {
  for (let index = items.length - 1; index >= 0; index--) if (test(items[index]!)) return index;
  return -1;
};

// Inserts lines before the line at index
export const insertLines = (text: string, index: number, inserted: string[]) => {
  const all = lines(text);
  all.splice(index, 0, ...inserted);
  return all.join("\n");
};

// The index of the line where a new item goes so that the items stay sorted by key, or after the last one when they are
// not sorted
export const sortedIndex = <T>(items: T[], key: (item: T) => string, added: string) => {
  const keys = items.map(key);
  const sorted = keys.every((value, index) => index === 0 || keys[index - 1]!.toLowerCase() <= value.toLowerCase());
  if (!sorted) return items.length;
  const index = keys.findIndex(value => value.toLowerCase() > added.toLowerCase());
  return index === -1 ? items.length : index;
};

// The index of the bracket that closes the one at index, in code without brackets in strings
export const closing = (text: string, index: number) => {
  const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  const stack: string[] = [];
  for (let at = index; at < text.length; at++) {
    const character = text[at]!;
    if (pairs[character]) stack.push(pairs[character]!);
    else if (character === stack.at(-1)) {
      stack.pop();
      if (stack.length === 0) return at;
    }
  }
  throw new Error(`No closing bracket for the one at ${index}`);
};

// CamelCase to snake_case, and the plural of a snake_case name, as Rails and Laravel name the table of a model
export const snake = (name: string) => name.replace(/([a-z\d])([A-Z])/g, "$1_$2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2").toLowerCase();

export const plural = (name: string) => {
  if (/[^aeiou]y$/.test(name)) return `${name.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/.test(name)) return `${name}es`;
  return `${name}s`;
};

export const tableOfModel = (className: string) => plural(snake(className));
