import { $ } from 'bun';
import { setupTests } from '@p9s/postgres-testing/pg'
import { runPostgresBenchmark } from './generator';

const composeDir = import.meta.dir;
const databaseUrl = 'postgresql://postgres:postgres@localhost:54321/postgres';

// Start postgres container
await $`docker compose up -d --wait`.cwd(composeDir).quiet();

const testUuid = setupTests(databaseUrl);
await testUuid.setup();
export const Uuid = await runPostgresBenchmark(testUuid.context, { benchmarkSizeFactor: 5, idMode: "uuid" })
await testUuid.teardown();

const testInteger = setupTests(databaseUrl);
await testInteger.setup();
export const Integer = await runPostgresBenchmark(testInteger.context, { benchmarkSizeFactor: 5, idMode: "integer" })
await testInteger.teardown();

// Stop postgres container
await $`docker compose down`.cwd(composeDir).quiet();
