import { App } from "./app.js";
import { axum } from "./axum.js";
import { django } from "./django.js";
import { fastapi } from "./fastapi.js";
import { go } from "./go.js";
import { laravel } from "./laravel.js";
import { phoenix } from "./phoenix.js";
import { rails } from "./rails.js";
import type { Options, Stack } from "./stack.js";
import { drizzle, kysely, postgraphile, prisma, supabase } from "./typescript.js";

export { App } from "./app.js";
export type { Options, Stack } from "./stack.js";

// In the order adopt tries them, the more specific first: a Supabase app may use Drizzle too
export const stacks: Stack[] = [rails, django, fastapi, laravel, phoenix, go, axum, supabase, postgraphile, prisma, drizzle, kysely];

export const detectStack = async (app: App) => {
  for (const stack of stacks) if (await stack.detect(app)) return stack;
  return undefined;
};

export const adopt = async (root: string, options: Options & { stack?: string }) => {
  const app = new App(root);
  const stack = options.stack ? stacks.find(candidate => candidate.name === options.stack) : await detectStack(app);
  if (!stack) {
    throw new Error(options.stack
      ? `Unknown stack ${options.stack}, one of ${stacks.map(candidate => candidate.name).join(", ")}`
      : `Found no stack p9s adopt knows in ${root}. Pass --stack, one of ${stacks.map(candidate => candidate.name).join(", ")}`);
  }
  await stack.adopt(app, options);
  return { app, stack };
};
