import { $ } from 'bun';
import { setupTests } from '@p9s/postgres-testing/pg'
import { runPostgresBenchmark } from './generator';

const composeDir = import.meta.dir;
const databaseUrl = 'postgresql://postgres:postgres@localhost:54321/postgres';

// Start postgres container
await $`docker compose up -d --wait`.cwd(composeDir).quiet();

const { context, setup, teardown } = setupTests(databaseUrl);
await setup();
export const result = await runPostgresBenchmark(context, { benchmarkSizeFactor: 15 })
await teardown();

// Stop postgres container
await $`docker compose down`.cwd(composeDir).quiet();
