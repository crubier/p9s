import { makePgService } from "postgraphile/adaptors/pg";
import { PostGraphileAmberPreset } from "postgraphile/presets/amber";
import { roleIdOf } from "./auth";

// Every request runs as app_user, so that RLS decides what it reads and writes, with the role id of its token. A
// request without a valid token has no role id: p9s gives it nothing.
export const preset: GraphileConfig.Preset = {
  extends: [PostGraphileAmberPreset],
  pgServices: [makePgService({ connectionString: process.env.DATABASE_URL, schemas: ["public"] })],
  grafast: {
    async context(requestContext) {
      const authorization = requestContext.http?.getHeader("authorization");
      const token = authorization?.match(/^Bearer (.+)$/i)?.[1];
      const roleId = token ? await roleIdOf(token).catch(() => undefined) : undefined;
      return { pgSettings: { role: "app_user", "jwt.claims.role_id": roleId ?? "" } };
    },
  },
  grafserv: { port: Number(process.env.PORT ?? 5678), graphiql: true, watch: false },
};
