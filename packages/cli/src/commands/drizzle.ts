import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Command } from "commander";
import { pathToFileURL } from "node:url";

export const drizzle = new Command()
  .name("drizzle")
  .description("Drizzle ORM related commands");

drizzle
  .command("configure")
  .description("Generate p9s configuration from a Drizzle schema")
  .option(
    "-s, --schema <path>",
    "path to Drizzle schema file (default: ./src/db/schema.ts)"
  )
  .option(
    "-o, --output <path>",
    "output file path (default: p9s.config.json). Format is inferred from extension (.json, .js, .ts)"
  )
  .option(
    "-u, --users <users>",
    "comma-separated list of user types",
    "admin,user,viewer"
  )
  .action(async (opts) => {
    const schemaPath = path.resolve(opts.schema ?? "./src/db/schema.ts");
    const outputPath = opts.output ?? "p9s.config.json";
    const users = opts.users.split(",").map((u: string) => u.trim());

    const ext = path.extname(outputPath).toLowerCase();
    const format = ext === ".ts" ? "ts" : ext === ".js" ? "js" : "json";

    console.log(`Loading Drizzle schema from: ${schemaPath}`);

    try {
      await fs.access(schemaPath);
    } catch {
      console.error(`Error: Schema file not found: ${schemaPath}`);
      process.exit(1);
    }

    const schemaModule = await import(pathToFileURL(schemaPath).href);

    const { generateConfigurationFromDrizzleSchema } = await import("@p9s/drizzle");

    const config = generateConfigurationFromDrizzleSchema(schemaModule, {
      users,
      tables: {},
    });

    let configContent: string;

    if (format === "json") {
      configContent = JSON.stringify(config, null, 2);
    } else if (format === "js") {
      configContent = `// p9s configuration generated from Drizzle schema
// Edit this file to customize permissions

/** @type {import("@p9s/core").Config} */
const config = ${JSON.stringify(config, null, 2)};

module.exports = config;
`;
    } else {
      const relativeSchemaPath = path.relative(path.dirname(outputPath), schemaPath).replace(/\.ts$/, "");
      configContent = `import type { Config } from "@p9s/core";
import * as schema from "${relativeSchemaPath}";
import { generateConfigurationFromDrizzleSchema } from "@p9s/drizzle";

const config = generateConfigurationFromDrizzleSchema(schema, {
  users: ${JSON.stringify(users)} as const,
  tables: {
${config.tables?.map((t: any) => `    // ${t.name}: { isResource: ${t.isResource ?? false}, isRole: ${t.isRole ?? false} },`).join("\n")}
  },
});

export default config;
`;
    }

    const outputDir = path.dirname(outputPath);
    if (outputDir && outputDir !== ".") {
      await fs.mkdir(outputDir, { recursive: true });
    }
    await fs.writeFile(outputPath, configContent, "utf-8");

    console.log(`Configuration written to: ${outputPath}`);
    console.log(`\nDetected ${config.tables?.length ?? 0} tables:`);
    config.tables?.forEach((t: any) => {
      const flags = [];
      if (t.isResource) flags.push("resource");
      if (t.isRole) flags.push("role");
      console.log(`  - ${t.name} (${flags.join(", ") || "none"})`);
    });
  });
