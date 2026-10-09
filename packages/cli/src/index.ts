#!/usr/bin/env node

import { Command } from "commander";
import packageJson from "../package.json" with { type: "json" };
import { postgres } from "./commands/postgres.js";
import { validate } from "./commands/validate.js";
import { drizzle } from "./commands/drizzle.js";
import { init } from "./commands/init.js";

// The overloads of process.on depend on which @types/node bun-types resolves to, those of EventEmitter do not
const signals: NodeJS.EventEmitter = process;
signals.on("SIGINT", () => process.exit(0));
signals.on("SIGTERM", () => process.exit(0));

async function main() {
  const program = new Command()
    .name("p9s")
    .description("Permission Tree CLI - manage permissions for PostgreSQL")
    .version(packageJson.version, "-v, --version", "display the version number");

  program.addCommand(init);
  program.addCommand(postgres);
  program.addCommand(validate);
  program.addCommand(drizzle);

  program.parse();
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
