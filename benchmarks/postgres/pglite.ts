
import { setupTests } from '@p9s/postgres-testing/pglite'
import { runPostgresBenchmark } from './generator';

const testUuid = setupTests();
await testUuid.setup();
export const Uuid = await runPostgresBenchmark(testUuid.context, { benchmarkSizeFactor: 5, idMode: "uuid" })
await testUuid.teardown();

const testInteger = setupTests();
await testInteger.setup();
export const Integer = await runPostgresBenchmark(testInteger.context, { benchmarkSizeFactor: 5, idMode: "integer" })
await testInteger.teardown();
