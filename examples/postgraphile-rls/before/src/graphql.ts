import { postgraphile } from "postgraphile";
import { makePgService } from "postgraphile/adaptors/pg";
import { grafast } from "postgraphile/grafast";
import type { ExecutionResult } from "postgraphile/graphql";
import { PostGraphileAmberPreset } from "postgraphile/presets/amber";

declare global {
  namespace Grafast {
    interface RequestContext {
      // The user of an operation the server runs in the process, rather than of a request to /graphql
      userId?: number;
    }
  }
}

// What a request of the user runs with: the role the policies are for, and the id of the user they read
const pgSettingsOf = (userId: number | undefined) => ({ role: "app_user", "app.user_id": userId === undefined ? "" : String(userId) });

const userIdOf = (header: string | undefined) => {
  const userId = Number(header);
  return header && Number.isInteger(userId) ? userId : undefined;
};

const preset: GraphileConfig.Preset = {
  extends: [PostGraphileAmberPreset],
  pgServices: [makePgService({ connectionString: process.env.DATABASE_URL, schemas: ["public"] })],
  grafast: {
    context: requestContext => ({
      pgSettings: pgSettingsOf(requestContext.userId ?? userIdOf(requestContext.honov4?.ctx.req.header("x-user-id"))),
    }),
  },
  grafserv: { graphqlPath: "/graphql", watch: false },
};

export const pgl = postgraphile(preset);

// Runs an operation as the user, as a request of theirs to /graphql would, and throws its first error
export const graphql = async <T>(userId: number, source: string, variableValues?: Record<string, unknown>) => {
  const { schema, resolvedPreset } = await pgl.getSchemaResult();
  const result = await grafast({ schema, source, variableValues, resolvedPreset, requestContext: { userId } }) as ExecutionResult;
  const [error] = result.errors ?? [];
  if (error) throw error;
  return result.data as T;
};
