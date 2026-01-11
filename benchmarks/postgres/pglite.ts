
import { setupTests } from '@p9s/postgres-testing/pglite'
import { runPostgresBenchmark } from './generator';

const { context, setup, teardown } = setupTests();
await setup();
export const result = await runPostgresBenchmark(context, { benchmarkSizeFactor: 10, logger: console })
await teardown();
