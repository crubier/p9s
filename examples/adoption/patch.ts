// bun examples/adoption/patch.ts edit <example>: writes before/ with after.patch applied to <example>/.adoption-edit
// bun examples/adoption/patch.ts save <example>: writes after.patch again, from the changes of <example>/.adoption-edit
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyPatch, copyApp } from "./harness.ts";

const [action, name] = process.argv.slice(2);
if (!name || (action !== "edit" && action !== "save")) {
  console.error("Usage: bun examples/adoption/patch.ts edit|save <example>");
  process.exit(1);
}
const example = path.resolve(import.meta.dir, "..", name);
const edit = path.join(example, ".adoption-edit");
const patch = path.join(example, "after.patch");

if (action === "edit") {
  await copyApp(path.join(example, "before"), edit);
  await applyPatch(patch, edit);
  // As the adoption adds it, for the app to read, and the patch leaves it out
  await cp(path.join(example, "p9s.config.json"), path.join(edit, "p9s.config.json"));
  console.log(`Change ${path.relative(process.cwd(), edit)}, then run: bun examples/adoption/patch.ts save ${name}`);
} else {
  // git diff of two copies named a and b, so that the paths of the patch are a/... and b/..., without dates
  const scratch = await mkdtemp(path.join(os.tmpdir(), "p9s-patch-"));
  try {
    await copyApp(path.join(example, "before"), path.join(scratch, "a"));
    await copyApp(edit, path.join(scratch, "b"));
    await rm(path.join(scratch, "b", "p9s.config.json"), { force: true });
    const diff = Bun.spawnSync(["git", "diff", "--no-index", "--no-prefix", "--no-color", "a", "b"], { cwd: scratch });
    if (diff.exitCode > 1) throw new Error(diff.stderr.toString());
    await writeFile(patch, diff.stdout.toString());
    console.log(`Wrote ${path.relative(process.cwd(), patch)}`);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
