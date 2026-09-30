import { generateConfigurationFromDrizzleSchema } from "@p9s/drizzle";
import { createMigration } from "@p9s/postgres";
import { compile } from "pg-sql2";
import * as schema from "./schema";

// Bits of the permission bitmap, shared by every resource table
const bits = { select: 0, insert: 1, update: 2, delete: 3 };

export const p9sConfig = generateConfigurationFromDrizzleSchema(schema, {
  // Database role the Next.js server uses for requests made on behalf of a signed-in user
  users: ["app_user"],
  tables: {
    user: { isResource: false, isRole: true, roleId: "role_id" },
    session: { isResource: false },
    account: { isResource: false, isRole: false },
    verification: { isResource: false },
    // `folder.parent_id` is not mirrored into `resource_edge`: the app inserts or moves the edge when it moves a folder
    folder: { resourceId: "resource_id", permission: { app_user: bits } },
    image: { resourceId: "resource_id", permission: { app_user: bits } },
    text_content: { resourceId: "resource_id", permission: { app_user: bits } },
  },
  engine: {
    // Backend role allowed to share folders and move things around, app_user can only read the permission graph
    graphWriters: ["app_backend"],
    authentication: { getCurrentUserId: "current_role_id" },
    id: { mode: "uuid" },
    combineAssignmentsWith: "role",
    permission: { bitmap: { size: 8 }, maxDepth: { resource: 16, role: 16 } },
  },
  migration: { output: { sql: "migrations/p9s.sql" } },
});

// `bun src/p9s.ts` writes the migration, run it with `psql -f` after the Drizzle migrations
if (import.meta.main) {
  const { text } = compile(createMigration(p9sConfig));
  await Bun.write(new URL(`../${p9sConfig.migration!.output!.sql}`, import.meta.url), text);
  console.log(`Wrote ${p9sConfig.migration!.output!.sql}`);
}
