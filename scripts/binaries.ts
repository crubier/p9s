// Builds the CLI as standalone executables, with the runtime of Bun inside, so that p9s runs without Node:
// bun scripts/binaries.ts [linux-x64 ...], all of them by default, into binaries/ with their SHA256SUMS
import { createHash } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

const targets = ["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64", "windows-x64"];
const root = path.resolve(import.meta.dir, "..");
const output = path.join(root, "binaries");
const chosen = process.argv.slice(2);
for (const target of chosen) {
  if (!targets.includes(target)) throw new Error(`Unknown target ${target}, one of ${targets.join(", ")}`);
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const sums: string[] = [];
for (const target of chosen.length > 0 ? chosen : targets) {
  const file = `p9s-${target}${target.startsWith("windows") ? ".exe" : ""}`;
  const build = Bun.spawnSync([process.execPath, "build", "packages/cli/src/index.ts", "--compile", "--minify", `--target=bun-${target}`, `--outfile=${path.join(output, file)}`], { cwd: root });
  if (build.exitCode !== 0) throw new Error(`The build of ${file} failed\n${build.stdout}\n${build.stderr}`);
  sums.push(`${createHash("sha256").update(await readFile(path.join(output, file))).digest("hex")}  ${file}`);
  console.log(`Built binaries/${file}`);
}
await Bun.write(path.join(output, "SHA256SUMS"), `${sums.join("\n")}\n`);
