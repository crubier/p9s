import { z } from "zod";
import { configSchema } from "./configuration-schema.ts";

export const configJsonSchemaUrl = "https://p9s.vercel.app/p9s.config.schema.json";

// The JSON Schema of a config of p9s, as a user writes it, for editors to complete and check p9s.config.json and
// p9s.config.yaml. Objects take no other keys, so that a typo shows, but $schema at the top. The checks across keys,
// like a parent table that exists, are those of p9s validate config.
export const configJsonSchema = () => {
  const schema = z.toJSONSchema(configSchema.extend({ $schema: z.string().optional() }), {
    io: "input",
    unrepresentable: "any",
    override: ({ jsonSchema }) => {
      if (jsonSchema.type === "object" && jsonSchema.properties && jsonSchema.additionalProperties === undefined) {
        jsonSchema.additionalProperties = false;
      }
    },
  });
  return { ...schema, $id: configJsonSchemaUrl, title: "p9s config", description: "The config of p9s, hierarchical permissions for Postgres enforced with Row Level Security, see https://p9s.vercel.app/docs" };
};
