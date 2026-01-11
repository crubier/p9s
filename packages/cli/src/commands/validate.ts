import { Command } from "commander";
import { validateConfig, getValidationErrors } from "@p9s/core";
import { loadConfig } from "../config.js";

export const validate = new Command()
  .name("validate")
  .description("Validate configuration file");

validate
  .command("config")
  .description("Validate the p9s configuration file")
  .option("-c, --config <path>", "path to config file")
  .option("--strict", "exit with error code on validation failure")
  .action(async (opts) => {
    try {
      console.log("Loading configuration...");
      const config = await loadConfig({ configPath: opts.config });

      console.log("Validating configuration...");
      const result = validateConfig(config);

      if (result.success) {
        console.log("✓ Configuration is valid");
        process.exit(0);
      } else {
        console.error("✗ Configuration validation failed:");
        const errors = getValidationErrors(result);
        for (const error of errors) {
          console.error(`  - ${error}`);
        }
        if (opts.strict) {
          process.exit(1);
        }
      }
    } catch (error) {
      console.error("Error:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });
