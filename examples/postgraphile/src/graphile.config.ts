import { makePgService } from "postgraphile/adaptors/pg";
import { sideEffect, type ObjectStep, type Step } from "postgraphile/grafast";
import { defaultMaskError } from "postgraphile/grafserv";
import { GraphQLError } from "postgraphile/graphql";
import { PostGraphileAmberPreset } from "postgraphile/presets/amber";
import { wrapPlans } from "postgraphile/utils";
import { pool } from "./db.js";
import { identify, ORG_HEADER, pgSettingsOf, type Identity } from "./identity.js";

declare global {
  namespace Grafast {
    interface RequestContext {
      // Given by the seed and the tests, which run GraphQL in the process. Requests over HTTP never have it
      identity?: Identity;
    }
  }
}

const DENIED = "You don't have permission to do that.";

// What a database error tells the user. The functions of sql/app.sql raise their own messages with the hint
// `p9s-example`; RLS refusals and constraint errors name tables and policies, which are replaced
const messageOf = (error: { code: string; message: string; hint?: string }) => {
  if (error.hint === "p9s-example") return error.message;
  switch (error.code) {
    case "42501":
      return DENIED;
    case "25006":
      return "You are viewing as someone else: act as them to change anything.";
    case "54000":
      return "That would nest folders too deeply.";
    case "23505":
      return "That already exists.";
    case "23503":
      return "This does not exist, or you don't have access to it.";
    case "57014":
      return "The request took too long.";
    case "P0001":
      return error.message;
  }
};

const isDatabaseError = (error: unknown): error is { code: string; message: string; hint?: string } =>
  typeof error === "object" && error !== null && typeof (error as { code?: unknown }).code === "string";

export const maskError = (error: GraphQLError) => {
  const original = error.originalError;
  const message = isDatabaseError(original) ? messageOf(original) : undefined;
  if (!message) return defaultMaskError(error);
  return new GraphQLError(message, {
    nodes: error.nodes,
    source: error.source,
    positions: error.positions,
    path: error.path,
    extensions: { code: (original as unknown as { code: string }).code },
  });
};

// RLS hides the rows a member cannot change from an update or a delete, which PostGraphile then answers with no row
// and no error: the request fails as Postgres refuses an insert
const RefuseHiddenRowsPlugin = wrapPlans(
  (context) => (context.scope.isPgUpdateMutation || context.scope.isPgDeleteMutation ? true : null),
  () => (plan) => {
    const $payload = plan() as ObjectStep<{ result: Step }>;
    sideEffect($payload.get("result"), (row) => {
      if (row == null) throw Object.assign(new Error(DENIED), { code: "42501" });
    });
    return $payload;
  },
);

// GraphiQL opened from a link of the app: `?query=…&variables=…&org=…` fill its editors, and the organization header
const linkScript = `
<script>
  {
    const params = new URLSearchParams(location.search);
    if (params.has("query")) RURU_CONFIG.initialQuery = params.get("query");
    if (params.has("variables")) RURU_CONFIG.initialVariables = params.get("variables");
    if (params.has("org")) RURU_CONFIG.initialHeaders = JSON.stringify({ "${ORG_HEADER}": params.get("org") }, null, 2);
  }
</script>`;

const defaultQuery = `# Requests run as the signed-in user: RLS, enforced by p9s, decides what they read and write.
# The ${ORG_HEADER} header names the organization they act in. Open GraphiQL from a page of the app to get
# the query of that page, or try this one.
query MyOrganizations {
  viewer {
    name
    email
  }
  myOrganizations {
    nodes {
      name
      slug
      permission {
        bitmap
        directory
        admin
      }
    }
  }
}
`;

// Every request runs as app_user, so that RLS decides what it reads and writes, with the role id of its member or API
// key. A request from no one has no role id: p9s gives it nothing.
export const preset: GraphileConfig.Preset = {
  extends: [PostGraphileAmberPreset],
  plugins: [RefuseHiddenRowsPlugin],
  pgServices: [makePgService({ pool, schemas: ["public"] })],
  grafast: {
    async context(requestContext) {
      const headers = requestContext.node?.req.headers ?? {};
      const identity = requestContext.identity ?? (await identify(headers));
      return { pgSettings: pgSettingsOf(identity) };
    },
  },
  grafserv: {
    graphqlPath: "/graphql",
    graphiqlPath: "/graphiql",
    graphiqlOnGraphQLGET: false,
    watch: false,
    maskError,
  },
  ruru: {
    clientConfig: { defaultQuery },
    htmlParts: { configScript: (original) => original + linkScript },
  },
};
