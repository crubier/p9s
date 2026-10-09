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
const versionModule = path.resolve(import.meta.dir, "..", "packages", "postgres", "version.ts");
const source = await Bun.file(versionModule).text();
await Bun.write(versionModule, source.replace(/export const version = ".*";/, `export const version = ${JSON.stringify(version)};`));
const pyproject = path.resolve(import.meta.dir, "..", "packages", "python", "pyproject.toml");
const project = await Bun.file(pyproject).text();
await Bun.write(pyproject, project.replace(/^version = ".*"$/m, `version = ${JSON.stringify(version)}`));
console.log(`p9s (PyPI) ${version}`);
const gemVersion = path.resolve(import.meta.dir, "..", "packages", "ruby", "lib", "p9s", "version.rb");
const gem = await Bun.file(gemVersion).text();
await Bun.write(gemVersion, gem.replace(/VERSION = ".*"/, `VERSION = ${JSON.stringify(version)}`));
console.log(`p9s (RubyGems) ${version}`);
const crate = path.resolve(import.meta.dir, "..", "packages", "rust", "Cargo.toml");
const manifest = await Bun.file(crate).text();
await Bun.write(crate, manifest.replace(/^version = ".*"$/m, `version = ${JSON.stringify(version)}`));
console.log(`p9s (crates.io) ${version}`);
const mix = path.resolve(import.meta.dir, "..", "packages", "elixir", "mix.exs");
const mixProject = await Bun.file(mix).text();
await Bun.write(mix, mixProject.replace(/@version ".*"/, `@version ${JSON.stringify(version)}`));
console.log(`p9s (Hex) ${version}`);
