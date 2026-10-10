import * as path from "node:path";
import { Command } from "commander";
import { cosmiconfig } from "cosmiconfig";
import packageJson from "../../package.json" with { type: "json" };
import { adopt as adoptApp, stacks } from "../adopt/index.js";
import { loadConfig, searchPlaces } from "../config.js";

export const adopt = new Command()
  .name("adopt")
  .description("Change the code of an app so that each request runs as its user: the package of p9s, the wrapper of the requests, and the answer to refused writes")
  .option("-c, --config <path>", "path to config file")
  .option("-s, --stack <name>", `the stack of the app, found from its files by default: ${stacks.map(stack => stack.name).join(", ")}`)
  .option("-u, --user-id <code>", "how the app finds the id of the user of a request, when it is not the default of the stack: an expression for rails (@user_id), laravel (of $request) and phoenix (of conn), a dotted path to a function of the request for django")
  .option("--packages <directory>", "take the packages of p9s from this checkout of its repository, rather than from their registries")
  .option("--dry-run", "list the files adopt would change, without changing them")
  .action(async (opts) => {
    const root = process.cwd();
    const config = await loadConfig({ configPath: opts.config });
    const found = opts.config ? path.resolve(opts.config) : (await cosmiconfig("p9s", { searchPlaces }).search(root))!.filepath;
    const { app, stack } = await adoptApp(root, {
      config,
      configFile: path.relative(root, found).split(path.sep).join("/"),
      stack: opts.stack,
      userId: opts.userId,
      packages: opts.packages ? path.resolve(opts.packages) : undefined,
      version: packageJson.version.split(".").slice(0, 2).join("."),
    });
    const changed = app.changed;
    if (changed.length === 0) {
      console.log(`Nothing to change: this ${stack.title} app runs its requests as their users already`);
      return;
    }
    if (!opts.dryRun) await app.save();
    console.log(`${opts.dryRun ? "Would change" : "Changed"}, for ${stack.title}:\n${changed.map(file => `  ${file}`).join("\n")}`);
    console.log(`\nThen run: ${stack.install}`);
    const left = [...app.notes, ...stack.left];
    console.log(`\nWhat is left to you:\n${left.map(item => `- ${item}`).join("\n")}`);
    console.log(`\nThe guide of ${stack.title}: https://p9s.vercel.app/docs/integrations/${stack.guide}`);
  });
