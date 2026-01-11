import { expect, test, describe } from 'bun:test'
import { z } from 'zod';
import {
  baseNamingConfigSchema,
  derivedResourceOrRoleNamingConfigSchema,
  assignmentNamingConfigSchema,
  derivedNamingConfigSchema,
  permissionPerOperationSchema,
  permissionPerOperationNamingSchema,
  tableConfigSchema,
  tableNamingConfigEntrySchema,
  tableNamingConfigSchema,
  namingConfigSchema,
  engineConfigSchema,
  migrationConfigSchema,
  completeConfigSchema,
  configSchema,
} from './configuration-schema';

describe('Configuration JSON Schemas', () => {
  test('permissionPerOperationSchema', () => {
    expect(z.toJSONSchema(permissionPerOperationSchema)).toMatchSnapshot();
  });

  test('permissionPerOperationNamingSchema', () => {
    expect(z.toJSONSchema(permissionPerOperationNamingSchema)).toMatchSnapshot();
  });

  test('baseNamingConfigSchema', () => {
    expect(z.toJSONSchema(baseNamingConfigSchema)).toMatchSnapshot();
  });

  test('derivedResourceOrRoleNamingConfigSchema', () => {
    expect(z.toJSONSchema(derivedResourceOrRoleNamingConfigSchema)).toMatchSnapshot();
  });

  test('assignmentNamingConfigSchema', () => {
    expect(z.toJSONSchema(assignmentNamingConfigSchema)).toMatchSnapshot();
  });

  test('derivedNamingConfigSchema', () => {
    expect(z.toJSONSchema(derivedNamingConfigSchema)).toMatchSnapshot();
  });

  test('tableNamingConfigEntrySchema', () => {
    expect(z.toJSONSchema(tableNamingConfigEntrySchema)).toMatchSnapshot();
  });

  test('tableNamingConfigSchema', () => {
    expect(z.toJSONSchema(tableNamingConfigSchema)).toMatchSnapshot();
  });

  test('namingConfigSchema', () => {
    expect(z.toJSONSchema(namingConfigSchema)).toMatchSnapshot();
  });

  test('tableConfigSchema', () => {
    expect(z.toJSONSchema(tableConfigSchema)).toMatchSnapshot();
  });

  test('engineConfigSchema', () => {
    expect(z.toJSONSchema(engineConfigSchema)).toMatchSnapshot();
  });

  test('migrationConfigSchema', () => {
    expect(z.toJSONSchema(migrationConfigSchema)).toMatchSnapshot();
  });

  test('completeConfigSchema', () => {
    expect(z.toJSONSchema(completeConfigSchema)).toMatchSnapshot();
  });

  test('configSchema', () => {
    expect(z.toJSONSchema(configSchema)).toMatchSnapshot();
  });
});
