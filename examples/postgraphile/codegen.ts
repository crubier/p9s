import type { CodegenConfig } from "@graphql-codegen/cli";

// Types for the operations of the app, from schema.graphql. The documents stay strings, sent as they are written and
// opened as they are in GraphiQL
const config: CodegenConfig = {
  schema: "schema.graphql",
  documents: ["web/**/*.{ts,tsx}", "!web/gql/**"],
  generates: {
    "web/gql/": {
      preset: "client",
      presetConfig: { fragmentMasking: false },
      config: {
        documentMode: "string",
        useTypeImports: true,
        enumsAsTypes: true,
        scalars: { UUID: "string", Datetime: "string", BitString: "string", Cursor: "string" },
      },
    },
  },
};

export default config;
