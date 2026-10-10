// Writes the benchmark.json of each example into the "Benchmark" section of its page in website/docs/integrations, and
// a summary of all into the "The examples" section of the Benchmarks page, after `bun run bench:integrations`
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { repository } from "./harness.ts";
import { slowdown, type Benchmark } from "./benchmark.ts";

const pages: Record<string, string> = {
  axum: "rust",
  django: "django",
  drizzle: "drizzle",
  fastapi: "sqlalchemy",
  gorm: "go",
  kysely: "kysely",
  laravel: "laravel",
  phoenix: "elixir",
  "postgraphile-rls": "postgraphile",
  prisma: "prisma",
  rails: "rails",
  supabase: "supabase",
};

const github = "https://github.com/crubier/p9s/blob/main";
const number = (value: number) => value.toLocaleString("en-US");

export const section = (benchmark: Benchmark) => {
  const { settings, machine, versions } = benchmark;
  const sent = settings.requests * settings.rounds;
  return [
    "## Benchmark",
    "",
    `The [example](https://github.com/crubier/p9s/tree/main/examples/integrations/${benchmark.example}) before p9s and after p9s, each on its own database with the rows of [\`benchmark-seed.sql\`](${github}/examples/integrations/adoption/benchmark-seed.sql): 1000 users in 100 teams, 1000 projects and 20,000 documents, of which each user reads about 1200. ${settings.users} of the users send each request ${number(sent)} times to each app, ${settings.concurrency} at a time, in ${settings.rounds} rounds that switch which app goes first. Times are in milliseconds, and the app has no endpoint that counts.`,
    "",
    "| Request | Before: median | p95 | Requests/s | After: median | p95 | Requests/s | After / before |",
    "|---|---:|---:|---:|---:|---:|---:|---:|",
    ...benchmark.results.map(r =>
      `| ${r.request} \`${r.method} ${r.path}\` | ${r.before.median} | ${r.before.p95} | ${number(r.before.rps)} | ${r.after.median} | ${r.after.p95} | ${number(r.after.rps)} | ${slowdown(r).toFixed(2)}× |`),
    "",
    `Measured on ${benchmark.date}: ${machine.cpu}, ${machine.cores} cores, ${machine.memory}, ${machine.os}. ${versions.app}, PostgreSQL ${versions.PostgreSQL}, p9s ${versions.p9s}. [How it runs](../benchmarks#the-examples).`,
    "",
  ].join("\n");
};

const names: Record<string, string> = {
  axum: "Axum", django: "Django", drizzle: "Drizzle", fastapi: "FastAPI", gorm: "GORM", kysely: "Kysely", laravel: "Laravel",
  phoenix: "Phoenix", "postgraphile-rls": "PostGraphile", prisma: "Prisma", rails: "Rails", supabase: "Supabase",
};

export const summary = (benchmarks: Benchmark[]) => {
  const requests = benchmarks[0]!.results.map(r => r.request);
  const machines = [...new Set(benchmarks.map(b => `${b.machine.cpu}, ${b.machine.cores} cores, ${b.machine.memory}, ${b.machine.os}, PostgreSQL ${b.versions.PostgreSQL}`))];
  return [
    "## The examples",
    "",
    `Each [example app](https://github.com/crubier/p9s/tree/main/examples/integrations) has a benchmark of the app before p9s, which checks permissions in its code, and of the app after \`p9s adopt\` and \`after.patch\`, which leaves them to the policies. Each app gets its own database on the same server, with its migrations, the rows of [\`benchmark-seed.sql\`](${github}/examples/integrations/adoption/benchmark-seed.sql), and for the app after, the migration of p9s. 20 users, each in 3 teams that share about 60 projects and 1200 documents with them, list the projects and the documents, read a document, create one, rename one, and share one with another user. The requests go to each app in turns, a few at a time, after a warm-up, and every answer must have the status the rules give. The apps have no endpoint that counts.`,
    "",
    "```bash",
    "P9S_ADOPTION_DATABASE_URL=postgresql://postgres@localhost:5432/postgres bun run bench:integrations [kysely ...]",
    "bun run bench:integrations:docs",
    "```",
    "",
    "The first writes the `benchmark.json` of each example, the second the table of its integration page and the one below. CI runs each with fewer requests, `--compare --fail`, and fails when a request of the app after got more than twice as slow against the app before as its `benchmark.json` says, and more than 2 ms slower.",
    "",
    "The median of the app after p9s divided by the median of the app before:",
    "",
    `| Example | ${requests.join(" | ")} |`,
    `|---|${requests.map(() => "---:").join("|")}|`,
    ...benchmarks.map(b => `| [${names[b.example] ?? b.example}](./integrations/${pages[b.example]}#benchmark) | ${b.results.map(r => `${slowdown(r).toFixed(2)}×`).join(" | ")} |`),
    "",
    `Measured on ${machines.join("; ")}.`,
    "",
  ].join("\n");
};

// The page with its section of that heading replaced, or added at its end
export const withSection = (page: string, text: string, heading = "Benchmark") => {
  const start = page.search(new RegExp(`^## ${heading}$`, "m"));
  if (start < 0) return `${page.trimEnd()}\n\n${text}`;
  const rest = page.slice(start + 1).search(/^## /m);
  return rest < 0 ? `${page.slice(0, start)}${text}` : `${page.slice(0, start)}${text}\n${page.slice(start + 1 + rest)}`;
};

if (import.meta.main) {
  const benchmarks: Benchmark[] = [];
  for (const [example, page] of Object.entries(pages)) {
    const results = path.join(repository, "examples/integrations", example, "benchmark.json");
    if (!existsSync(results)) {
      console.error(`No benchmark of ${example}: run bun run bench:integrations ${example}`);
      process.exitCode = 1;
      continue;
    }
    const file = path.join(repository, "website/docs/integrations", `${page}.md`);
    const benchmark: Benchmark = JSON.parse(await readFile(results, "utf8"));
    benchmarks.push(benchmark);
    await writeFile(file, withSection(await readFile(file, "utf8"), section(benchmark)));
    console.log(`Wrote the benchmark of ${example} in ${path.relative(repository, file)}`);
  }
  if (benchmarks.length) {
    const file = path.join(repository, "website/docs/benchmarks.md");
    await writeFile(file, withSection(await readFile(file, "utf8"), summary(benchmarks), "The examples"));
    console.log(`Wrote the summary in ${path.relative(repository, file)}`);
  }
}
