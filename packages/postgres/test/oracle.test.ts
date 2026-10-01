import { expect, describe, test, beforeEach, afterEach } from 'bun:test'
import { setupTests } from '@p9s/postgres-testing';
import { cacheMismatches, combineModes, createGraphDriver, createRandom, emptyGraph, idModes, noMismatches, randomBatchOperation, randomOperation, setupBlog } from './helpers';

const OPERATIONS = 200;

for (const combineAssignmentsWith of combineModes) {
  for (const idMode of idModes) {
    describe(`incremental caches (combineAssignmentsWith: ${combineAssignmentsWith}, id: ${idMode})`, () => {
      const { setup, teardown, context } = setupTests();
      beforeEach(setup);
      afterEach(teardown);

      test('match a full recompute after every random graph change', async () => {
        await setupBlog(context, { combineAssignmentsWith, idMode });
        const driver = createGraphDriver(context, idMode, emptyGraph(16, 10));
        await driver.createNodes();
        expect(await cacheMismatches(context, combineAssignmentsWith)).toEqual(noMismatches);

        const random = createRandom(combineModes.indexOf(combineAssignmentsWith) * 1000 + idModes.indexOf(idMode) + 42);
        const history: string[] = [];
        for (let i = 0; i < OPERATIONS; i++) {
          history.push(await randomOperation(driver, random));
          const mismatches = await cacheMismatches(context, combineAssignmentsWith);
          // Reporting the history makes a failure reproducible by hand
          expect({ mismatches, history: history.slice(-5) }).toEqual({ mismatches: noMismatches, history: history.slice(-5) });
        }
      }, { timeout: 120000 });

      test('match a full recompute after multi-edge statements on graphs with cycles', async () => {
        await setupBlog(context, { combineAssignmentsWith, idMode });
        const driver = createGraphDriver(context, idMode, emptyGraph(12, 8));
        await driver.createNodes();

        const random = createRandom(combineModes.indexOf(combineAssignmentsWith) * 1000 + idModes.indexOf(idMode) + 7);
        const history: string[] = [];
        for (let i = 0; i < OPERATIONS / 2; i++) {
          history.push(await (random.next() < 0.5 ? randomBatchOperation(driver, random) : randomOperation(driver, random)));
          const mismatches = await cacheMismatches(context, combineAssignmentsWith);
          expect({ mismatches, history: history.slice(-5) }).toEqual({ mismatches: noMismatches, history: history.slice(-5) });
        }
      }, { timeout: 120000 });
    });
  }
}
