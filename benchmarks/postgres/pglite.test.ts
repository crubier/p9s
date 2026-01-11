import { describe, test, beforeEach, afterEach } from 'bun:test'
import { setupTests } from '@p9s/postgres-testing/pglite'
import { runPostgresBenchmark } from './generator';

describe('postgres benchmark', async () => {
  const { context, setup, teardown } = setupTests();

  beforeEach(setup)
  afterEach(teardown)

  test('SQL integer benchmark', async () => {
    await runPostgresBenchmark(context, { benchmarkSizeFactor: 5 })
  }, { timeout: 180000 })

});