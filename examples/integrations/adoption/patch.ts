// bun examples/integrations/adoption/patch.ts edit <example>: writes before/ with what p9s adopt changes and after.patch to
// <example>/.adoption-edit
// bun examples/integrations/adoption/patch.ts save <example>: writes adopt.patch again from what p9s adopt changes, and after.patch
// from the changes of <example>/.adoption-edit after p9s adopt
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { adoptCopy, applyPatch, diffApps } from "./harness.ts";

const [action, name] = process.argv.slice(2);
if (!name || (action !== "edit" && action !== "save")) {
  console.error("Usage: bun examples/integrations/adoption/patch.ts edit|save <example>");
  process.exit(1);
}
const example = path.resolve(import.meta.dir, "..", name);
const edit = path.join(example, ".adoption-edit");
const adopted = path.join(example, ".adoption-adopt");

if (action === "edit") {
  await adoptCopy(example, edit);
  await applyPatch(path.join(example, "after.patch"), edit);
  console.log(`Change ${path.relative(process.cwd(), edit)}, then run: bun examples/integrations/adoption/patch.ts save ${name}`);
} else {
  // Next to before/, so that the paths from the app to the packages of this repository are those of the copies
  try {
    await adoptCopy(example, adopted);
    for (const [file, patch] of [["adopt.patch", await diffApps(path.join(example, "before"), adopted, ["p9s.config.json"])], ["after.patch", await diffApps(adopted, edit)]]) {
      await writeFile(path.join(example, file!), patch!);
      console.log(`Wrote ${path.relative(process.cwd(), path.join(example, file!))}`);
    }
  } finally {
    await rm(adopted, { recursive: true, force: true });
  }
}
