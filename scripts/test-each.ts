// Runs the tests of each workspace in a process of its own, like bun run test does in one: PGlite keeps memory after
// its instances close, and every test file in one process can run out of it
import { Glob } from "bun";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const workspaces = (await Bun.file(path.join(root, "package.json")).json()).workspaces as string[];
const directories = new Set<string>();
for (const pattern of workspaces.filter(pattern => pattern !== "website")) {
  for await (const directory of new Glob(pattern).scan({ cwd: root, onlyFiles: false })) {
    const tests = new Glob("**/*.test.{ts,mts,tsx}").scan({ cwd: path.join(root, directory) });
    for await (const test of tests) {
      if (!test.includes("node_modules")) {
        directories.add(directory);
        break;
      }
    }
  }
}

const failed: string[] = [];
for (const directory of [...directories].sort()) {
  console.log(`\n${directory}`);
  const child = Bun.spawn([process.execPath, "test", `./${directory}/`, ...process.argv.slice(2)], { cwd: root, stdout: "inherit", stderr: "inherit" });
  if (await child.exited !== 0) failed.push(directory);
}
if (failed.length > 0) {
  console.error(`\nTests failed in ${failed.join(", ")}`);
  process.exit(1);
}
