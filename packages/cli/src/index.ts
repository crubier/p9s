#!/usr/bin/env node

import { Command } from "commander";
import { postgres } from "./commands/postgres.js";
import { validate } from "./commands/validate.js";

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

async function main() {
  const program = new Command()
    .name("p9s")
    .description("Permission Tree CLI - manage permissions for PostgreSQL")
    .version("0.0.1", "-v, --version", "display the version number");

  program.addCommand(postgres);
  program.addCommand(validate);

  program.parse();
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
