# @p9s/postgres

Hierarchical permissions for Postgres, enforced with Row Level Security. Generates the SQL migration of
[p9s](https://p9s.vercel.app): your rows become nodes of a permission graph, triggers cache every transitive permission,
and RLS policies check them with index lookups.

```sh
npm install @p9s/postgres
```

```ts
import { createMigrationSql } from "@p9s/postgres";

const sql = createMigrationSql({
  engine: { users: ["app_user"], authentication: { getCurrentUserId: "current_role_id" } },
  tables: [
    {
      name: "folder",
      isResource: true,
      resourceId: "resource_id",
      resourceParent: { column: "parent_id", table: "folder", key: "id" },
      permission: { app_user: { select: 0, insert: 1, update: 2, delete: 3 } },
    },
    { name: "member", isRole: true, roleId: "role_id" },
  ],
});
```

Run the SQL with any migration tool; it can be run again safely. See the [documentation](https://p9s.vercel.app/docs/intro),
and the [CLI](https://www.npmjs.com/package/@p9s/cli) to do the same without code.
