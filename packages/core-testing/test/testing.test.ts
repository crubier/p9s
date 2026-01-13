import { expect, test } from 'bun:test'
import { enumerateTreeNodesAndEdgesBreadthFirst, generateUuidFromInteger } from '../testing';

test('generateUuidFromInteger', async () => {
  expect(generateUuidFromInteger(1)).toMatchInlineSnapshot('"00000000-0000-0000-0000-000000000001"');
  expect(generateUuidFromInteger(165242)).toMatchInlineSnapshot('"00000000-0000-0000-0000-00000002857a"');
  expect(generateUuidFromInteger(1188277438292938219283992828)).toMatchInlineSnapshot('"00000000-03d6-eb89-0171-570000000000"');
  expect(generateUuidFromInteger(11882774382929382192839928288383838382)).toMatchInlineSnapshot('"08f08a02-8004-f380-0000-000000000000"');
});

test('enumerateTreeNodesAndEdgesBreadthFirst', async () => {
  expect(enumerateTreeNodesAndEdgesBreadthFirst([2, 2])).toMatchInlineSnapshot(`
    {
      "edges": [
        {
          "child": 2,
          "parent": 0,
        },
        {
          "child": 3,
          "parent": 0,
        },
        {
          "child": 4,
          "parent": 1,
        },
        {
          "child": 5,
          "parent": 1,
        },
      ],
      "nodes": [
        {
          "id": 0,
        },
        {
          "id": 1,
        },
        {
          "id": 2,
        },
        {
          "id": 3,
        },
        {
          "id": 4,
        },
        {
          "id": 5,
        },
      ],
    }
  `);
});
