import * as path from "node:path";
import { getCompleteConfig, getCompleteNamingConfig, type Config } from "@p9s/core";
import type { App } from "./app.js";

export interface Options {
  config: Config<string>;
  // The config file, relative to the root of the app
  configFile: string;
  // How the app finds the id of the user of a request, in the language of the stack
  userId?: string;
  // A checkout of the p9s repository, whose packages the app takes rather than those of the registries
  packages?: string;
  // The version of the packages of the registries, like 0.1
  version: string;
}

export interface Stack {
  name: string;
  title: string;
  // The page of the stack in the integrations of the docs
  guide: string;
  detect(app: App): Promise<boolean>;
  adopt(app: App, options: Options): Promise<void>;
  // The command that installs what adopt added
  install: string;
  // What adopt leaves to the person, after its changes
  left: string[];
}

// The path of a package of the p9s repository from the root of the app, like ../../packages/ruby
export const packagePath = (app: App, options: Options, name: string) => path.relative(app.root, path.join(options.packages!, "packages", name)) || ".";

// What the config of p9s means for the models of an app: the columns p9s adds to tables, which the app neither reads nor
// writes, and the tables whose rows the users of the config insert or update
export const tablesOf = (config: Config<string>) => {
  const complete = getCompleteConfig(config);
  const naming = getCompleteNamingConfig(complete);
  const key = complete.engine.authentication.key?.column;
  const columns = new Map<string, string[]>();
  for (const table of complete.tables) {
    const names = naming.tables[table.name]!;
    const added = [table.isResource ? names.resourceId : undefined, table.isRole ? names.roleId : undefined]
      .filter((column): column is string => column !== undefined && column !== "id" && column !== key);
    if (added.length > 0) columns.set(table.name, added);
  }
  const writes = (operations: Iterable<string>) => [...operations].some(operation => operation === "insert" || operation === "update");
  const written = new Set([
    ...complete.tables
      .filter(table => Object.values(table.permission ?? {}).some(bits => writes(Object.entries(bits ?? {}).filter(([, bit]) => bit != null).map(([operation]) => operation))))
      .map(table => table.name),
    ...(complete.links ?? []).filter(link => Object.values(link.privileges ?? {}).some(writes)).map(link => link.name),
  ]);
  return { columns, written };
};
