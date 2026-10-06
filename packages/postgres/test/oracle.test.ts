import { expect, describe, test, beforeEach, afterEach } from 'bun:test'
import { setupTests } from '@p9s/postgres-testing';
import { assignedCacheMismatches, cacheMismatches, combineModes, createGraphDriver, createRandom, edgeMismatches, emptyGraph, idModes, noMismatches, randomBatchOperation, randomOperation, resourceCacheModes, setupBlog } from './helpers';

const OPERATIONS = 200;

const runs = resourceCacheModes.flatMap(resourceCache => combineModes.flatMap(combineAssignmentsWith => idModes.map(idMode => ({ resourceCache, combineAssignmentsWith, idMode }))));

for (const { resourceCache, combineAssignmentsWith, idMode } of runs) {
  describe(`incremental caches (resourceCache: ${resourceCache}, combineAssignmentsWith: ${combineAssignmentsWith}, id: ${idMode})`, () => {
    const { setup, teardown, context } = setupTests();
    beforeEach(setup);
    afterEach(teardown);

    test('match a full recompute after every random graph change', async () => {
      await setupBlog(context, { combineAssignmentsWith, idMode, resourceCache });
      const driver = createGraphDriver(context, idMode, emptyGraph(16, 10));
      await driver.createNodes();
      expect(await cacheMismatches(context, combineAssignmentsWith)).toEqual(noMismatches);

      const random = createRandom(combineModes.indexOf(combineAssignmentsWith) * 1000 + idModes.indexOf(idMode) + 42);
      const history: string[] = [];
      for (let i = 0; i < OPERATIONS; i++) {
        history.push(await randomOperation(driver, random));
        const mismatches = await cacheMismatches(context, combineAssignmentsWith);
        const edges = await edgeMismatches(context, driver.graph);
        if (resourceCache === "assigned") expect({ assigned: await assignedCacheMismatches(context), history: history.slice(-5) }).toEqual({ assigned: 0, history: history.slice(-5) });
        // Reporting the history makes a failure reproducible by hand
        expect({ mismatches, edges, history: history.slice(-5) }).toEqual({ mismatches: noMismatches, edges: { resource: [], role: [] }, history: history.slice(-5) });
      }
    }, { timeout: 120000 });

    test('match a full recompute after multi-edge statements on graphs with cycles', async () => {
      await setupBlog(context, { combineAssignmentsWith, idMode, resourceCache });
      const driver = createGraphDriver(context, idMode, emptyGraph(12, 8));
      await driver.createNodes();

      const random = createRandom(combineModes.indexOf(combineAssignmentsWith) * 1000 + idModes.indexOf(idMode) + 7);
      const history: string[] = [];
      for (let i = 0; i < OPERATIONS / 2; i++) {
        history.push(await (random.next() < 0.5 ? randomBatchOperation(driver, random) : randomOperation(driver, random)));
        const mismatches = await cacheMismatches(context, combineAssignmentsWith);
        const edges = await edgeMismatches(context, driver.graph);
        if (resourceCache === "assigned") expect({ assigned: await assignedCacheMismatches(context), history: history.slice(-5) }).toEqual({ assigned: 0, history: history.slice(-5) });
        expect({ mismatches, edges, history: history.slice(-5) }).toEqual({ mismatches: noMismatches, edges: { resource: [], role: [] }, history: history.slice(-5) });
      }
    }, { timeout: 120000 });
  });
}
