import { expect, test } from 'bun:test'
import { deepMerge, replaceNestedStrings, capitalizeFirstLetter } from './util';

test('deepMerge - null and undefined handling', () => {
  expect(deepMerge(null, { a: 1 })).toEqual({ a: 1 });
  expect(deepMerge({ a: 1 }, null)).toEqual({ a: 1 });
  expect(deepMerge(undefined, { a: 1 })).toEqual({ a: 1 });
  expect(deepMerge({ a: 1 }, undefined)).toEqual({ a: 1 });
  expect(deepMerge(null, null)).toEqual(null);
  expect(deepMerge(undefined, undefined)).toEqual(undefined);
});

test('deepMerge - array concatenation', () => {
  expect(deepMerge([1, 2], [3, 4])).toEqual([1, 2, 3, 4]);
  expect(deepMerge([], [1, 2])).toEqual([1, 2]);
  expect(deepMerge([1, 2], [])).toEqual([1, 2]);
});

test('deepMerge - object merging', () => {
  expect(deepMerge({ a: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 });
  expect(deepMerge({ a: 1 }, { a: 2 })).toEqual({ a: 2 });
  expect(deepMerge({ a: { b: 1 } }, { a: { c: 2 } })).toEqual({ a: { b: 1, c: 2 } });
});

test('deepMerge - nested object merging', () => {
  const obj1 = {
    level1: {
      level2: {
        a: 1,
        b: 2
      }
    }
  };
  const obj2 = {
    level1: {
      level2: {
        b: 3,
        c: 4
      }
    }
  };
  expect(deepMerge(obj1, obj2)).toEqual({
    level1: {
      level2: {
        a: 1,
        b: 3,
        c: 4
      }
    }
  });
});

test('deepMerge - mixed types', () => {
  expect(deepMerge({ a: 1 }, { a: { b: 2 } })).toEqual({ a: { b: 2 } });
  expect(deepMerge({ a: { b: 2 } }, { a: 1 })).toEqual({ a: 1 });
});

test('replaceNestedStrings - simple object', () => {
  const obj = { a: 'hello', b: 'world' };
  const result = replaceNestedStrings(obj, (s) => s.toUpperCase());
  expect(result).toEqual({ a: 'HELLO', b: 'WORLD' });
});

test('replaceNestedStrings - nested object', () => {
  const obj = {
    level1: {
      a: 'hello',
      level2: {
        b: 'world'
      }
    }
  };
  const result = replaceNestedStrings(obj, (s) => s.toUpperCase());
  expect(result).toEqual({
    level1: {
      a: 'HELLO',
      level2: {
        b: 'WORLD'
      }
    }
  });
});

test('replaceNestedStrings - with transform function', () => {
  const obj = { name: 'test', value: 'data' };
  const result = replaceNestedStrings(obj, (s) => s.length);
  expect(result).toEqual({ name: 4, value: 4 });
});

test('capitalizeFirstLetter - basic cases', () => {
  expect(capitalizeFirstLetter('hello')).toBe('Hello');
  expect(capitalizeFirstLetter('world')).toBe('World');
  expect(capitalizeFirstLetter('a')).toBe('A');
});

test('capitalizeFirstLetter - edge cases', () => {
  expect(capitalizeFirstLetter('')).toBe('');
  expect(capitalizeFirstLetter('Hello')).toBe('Hello');
  expect(capitalizeFirstLetter('123abc')).toBe('123abc');
});
