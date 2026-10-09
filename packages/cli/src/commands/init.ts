import * as fs from "node:fs/promises";
import { Command } from "commander";
import { proposeConfig, readTables, type Proposal } from "@p9s/postgres";
import { connect } from "../database.js";

// An object literal as a person would write it: keys without quotes, and short objects on one line
const literal = (value: unknown, indent = ""): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  const inner = `${indent}  `;
  const entries = Array.isArray(value)
    ? value.map(item => literal(item, inner))
    : Object.entries(value).map(([key, item]) => `${/^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key)}: ${literal(item, inner)}`);
  const [open, close] = Array.isArray(value) ? ["[", "]"] : ["{", "}"];
  if (entries.length === 0) return `${open}${close}`;
  const flat = Array.isArray(value) ? `[${entries.join(", ")}]` : `{ ${entries.join(", ")} }`;
  if (flat.length + indent.length <= 100 && !flat.includes("\n")) return flat;
  return `${open}\n${entries.map(entry => `${inner}${entry},`).join("\n")}\n${indent}${close}`;
};

// A config module with what p9s init guessed as comments, or plain JSON for a .json file
export const renderProposal = (proposal: Proposal<string>, output: string, schema: string) => {
  if (output.endsWith(".json")) return `${JSON.stringify(proposal.config, null, 2)}\n`;
  const users = (proposal.config.engine?.users ?? []).map(user => JSON.stringify(user)).join(" | ") || "string";
  return `import type { Config } from "@p9s/core";

// Proposed by p9s init from the tables of ${schema}. Check these guesses, then run p9s postgres generate:
${proposal.notes.map(note => `// - ${note}`).join("\n")}
const config: Config<${users}> = ${literal(proposal.config)};

export default config;
`;
};

export const init = new Command()
  .name("init")
  .description("Propose a config from the tables and foreign keys of a database")
  .option("-d, --database-url <url>", "database to read (default: DATABASE_URL)")
  .option("-s, --schema <name>", "schema of the tables", "public")
  .option("-u, --users <roles>", "database roles of the application users, comma separated", "app_user")
  .option("-o, --output <path>", "file to write, a .json file for JSON", "p9s.config.ts")
  .option("-f, --force", "overwrite the file if it exists")
  .action(async (opts) => {
    if (!opts.force && (await fs.stat(opts.output).catch(() => undefined))) {
      throw new Error(`${opts.output} exists, pass --force to overwrite it`);
    }
    const client = await connect(opts.databaseUrl);
    let proposal: Proposal<string>;
    try {
      const tables = await readTables(client, opts.schema);
      proposal = proposeConfig(tables, { users: opts.users.split(",").map((user: string) => user.trim()).filter(Boolean), schema: opts.schema });
    } finally {
      await client.end();
    }
    await fs.writeFile(opts.output, renderProposal(proposal, opts.output, opts.schema), "utf-8");
    console.log(proposal.notes.map(note => `- ${note}`).join("\n"));
    console.log(`\nWrote ${opts.output}. Check it, then run p9s postgres generate`);
  });
