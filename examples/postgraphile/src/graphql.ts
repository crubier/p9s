import { postgraphile } from "postgraphile";
import { grafast } from "postgraphile/grafast";
import type { ExecutionResult } from "postgraphile/graphql";
import { maskError, preset } from "./graphile.config";
import type { Identity } from "./identity";

export const pgl = postgraphile(preset);

export class GraphQLRequestError extends Error {
  constructor(readonly errors: readonly { message: string; extensions?: Record<string, unknown> }[]) {
    super(errors.map((error) => error.message).join("\n"));
  }
}

// Runs an operation in the process, on behalf of `identity`, as the server would for a request of theirs: with the
// same settings, through RLS, and the same messages. For the seed and the tests
export const graphql = async <T = Record<string, unknown>>(identity: Identity, source: string, variableValues?: Record<string, unknown>) => {
  const { schema, resolvedPreset } = await pgl.getSchemaResult();
  const result = (await grafast({ schema, source, variableValues, resolvedPreset, requestContext: { identity } })) as ExecutionResult;
  if (result.errors?.length) throw new GraphQLRequestError(result.errors.map(maskError));
  return result.data as T;
};
