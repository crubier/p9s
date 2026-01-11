import { cosmiconfig } from "cosmiconfig";
import type { Config } from "@p9s/core";

export async function loadConfig<User extends string>(options: { configPath?: string; cwd?: string } = {}): Promise<Config<User>> {
  const cc = cosmiconfig("p9s");
  const result = options.configPath
    ? await cc.load(options.configPath)
    : await cc.search(options.cwd);

  if (!result || result.isEmpty) {
    throw new Error("No config file found. Create p9s.config.ts or use --config <path>");
  }

  return result.config as Config<User>;
}
