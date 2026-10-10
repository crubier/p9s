import { cosmiconfig, getDefaultSearchPlaces } from "cosmiconfig";
import type { Config } from "@p9s/core";

// Besides the places cosmiconfig looks in, p9s.config.json and p9s.config.yaml, which any stack can write
export const searchPlaces = [...getDefaultSearchPlaces("p9s"), "p9s.config.json", "p9s.config.yaml", "p9s.config.yml"];

export async function loadConfig<User extends string>(options: { configPath?: string; cwd?: string } = {}): Promise<Config<User>> {
  const cc = cosmiconfig("p9s", { searchPlaces });
  const result = options.configPath
    ? await cc.load(options.configPath)
    : await cc.search(options.cwd);

  if (!result || result.isEmpty) {
    throw new Error("No config file found. Create p9s.config.json, p9s.config.yaml or p9s.config.ts, or use --config <path>");
  }

  return result.config as Config<User>;
}
