import { z } from "zod";
import {
  configSchema,
  completeConfigSchema,
  engineConfigSchema,
  tableConfigSchema,
  type Config,
  type CompleteConfig,
} from "./configuration-schema";

export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; errors: z.ZodError };

/**
 * Validates a partial user-facing configuration
 */
export function validateConfig(config: unknown): ValidationResult<Config> {
  const result = configSchema.safeParse(config);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, errors: result.error };
}

/**
 * Validates a complete configuration (all fields required)
 */
export function validateCompleteConfig(config: unknown): ValidationResult<CompleteConfig> {
  const result = completeConfigSchema.safeParse(config);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, errors: result.error };
}

/**
 * Parses and validates a partial config, throwing on error
 */
export function parseConfig(config: unknown): Config {
  return configSchema.parse(config);
}

/**
 * Parses and validates a complete config, throwing on error
 */
export function parseCompleteConfig(config: unknown): CompleteConfig {
  return completeConfigSchema.parse(config);
}

/**
 * Gets formatted error messages from a validation result
 */
export function getValidationErrors(result: ValidationResult<unknown>): string[] {
  if (result.success) return [];
  return result.errors.issues.map((issue) => {
    const path = issue.path.join(".");
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}

export { configSchema, completeConfigSchema, engineConfigSchema, tableConfigSchema };
