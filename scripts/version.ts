// Sets the version of every published package, which move together: bun scripts/version.ts 0.2.0
import path from "node:path";
import { published } from "./published.ts";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("Usage: bun scripts/version.ts <major.minor.patch>");
  process.exit(1);
}
for (const name of published) {
  const file = path.resolve(import.meta.dir, "..", "packages", name, "package.json");
  const manifest = await Bun.file(file).json();
  manifest.version = version;
  await Bun.write(file, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`@p9s/${name} ${version}`);
}
