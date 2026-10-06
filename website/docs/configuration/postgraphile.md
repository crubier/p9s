---
sidebar_position: 5
---

# PostGraphile

[PostGraphile](https://postgraphile.org) builds a GraphQL API from the tables, views and functions of a schema, and runs every request as a database role, so that RLS decides what it reads and writes. With `engine.postgraphile: true`, the migration adds what it needs to serve p9s too. [`examples/postgraphile`](https://github.com/crubier/p9s/tree/main/examples/postgraphile) is a complete app built that way: a team workspace whose React front end only talks to GraphQL, with a GraphiQL link on every page.

```ts
const config = {
  engine: {
    users: ["app_user"],
    authentication: { getCurrentUserId: "current_role_id" },
    postgraphile: true,
    // ...
  },
  tables: [/* ... */],
};
```

## What the migration adds

- **Keys of the views.** PostGraphile only follows foreign keys, and views have none. Smart comments give `resource_node` and `role_node` (see [views of all nodes](./security-model#nodes-are-rows)) a primary key and a foreign key to each bound table, and give the views of p9s (`current_resource_access`, `current_assignment`, `current_resource_edge`, `current_role`, `resource_access`, `resource_role_access`) foreign keys to the node views. A client walks from an assignment to its resource, then to the folder or document it is:

  ```graphql
  {
    allCurrentAssignments {
      nodes { permission resource { tableName folder { name } document { title } } }
    }
  }
  ```

  These views are read only: they have no mutation.

- **A `permission` field on each resource table.** PostGraphile skips functions with overloads, and `resource_permission` has two, so the migration adds `<table>_permission(row)` for each resource table, and `resource_node_permission(node)`. PostGraphile serves each as a `permission` field of its type, with the bits of the current user on the row: `allFolders { nodes { name permission } }`. A table with a `permission` column of its own clashes with that field.

- **A boolean per bit, with bit names.** Name the bits in `engine.permission.bitmap.names`, and the `permission` fields return their names rather than a bitmap:

  ```ts
  permission: { bitmap: { size: 8, names: { read: 0, create: 1, edit: 2, delete: 3, comment: 4, share: 5, directory: 6, admin: 7 } } },
  ```

  ```graphql
  {
    allFolders {
      nodes { name permission { bitmap read edit share } }
    }
  }
  ```

  The migration creates the composite type `permission_flags`, with the `bitmap` and a boolean per name, and `permission_flags(bit)`, which converts a bitmap, for SQL: `select (permission_flags(resource_permission(id))).edit`. The views of p9s get the same field, in place of their `permission` column. Positions count from the left, as everywhere in p9s. The type changes with the names: the migration drops and creates it again with the functions of p9s that return it, and stops if a table, a view or a function of the application uses it. Without names, the fields return the bitmap.

- **The internal objects hidden.** Edge tables, caches, the views of each bit, triggers and helper functions get `@behavior -*`: the API has none of them. Edges and assignments are written by graph writers, not through the API, except through `resource_share` and `resource_unshare`, which stay: users with the `share` bit call them as `resourceShare` and `resourceUnshare` mutations, see [sharing](./security-model#sharing). [Searches](./overview#searches) stay too, as query fields like `documentSearch(theValue)`, while their functions for each user role are hidden. They search everything the user reads: an app with organizations can hide them too, and search one organization through a function of its own, as the example does with `searchDocuments`.

## What it needs

- **Postgres 15.** The node views use `security_invoker`. Below Postgres 15, p9s adds the `permission` fields and the comments of the tables, without the node views and their keys.
- **The select privilege on every bound table** for the role of the requests, since `resource_node` and `role_node` read all of them.
- **Creating rows through functions.** A create mutation inserts the row, then reads it back. Postgres checks the select policy of the new row before the triggers of p9s give it its home edge, so the user cannot see it yet and the insert fails. Hide the create mutations of node tables, `comment on table document is '@behavior -insert'`, and create rows through a function that inserts without `returning`, then reads the row:

  ```sql
  create function create_document(folder_id uuid, title text) returns document
  language plpgsql volatile as $$
  declare
    the_id uuid := uuid_generate_v4();
  begin
    insert into document (id, folder_id, title) values (the_id, create_document.folder_id, create_document.title);
    return (select d from document d where d.id = the_id);
  end
  $$;
  comment on function create_document(uuid, text) is '@resultFieldName document';
  ```

  Leaf rows, like comments, have no home edge: their create mutations work as they are. Updates and deletes too.
- **An error for the rows RLS keeps from an update or a delete.** The policies of p9s filter what a user may not change, so Postgres updates no row, and PostGraphile 5 answers with a null row and no error: a user who can read a document but not edit it is told the edit worked. A plan wrapper can refuse it, as [`src/graphile.config.ts`](https://github.com/crubier/p9s/tree/main/examples/postgraphile/src/graphile.config.ts) of the example does:

  ```ts
  import { sideEffect } from "postgraphile/grafast";
  import { wrapPlans } from "postgraphile/utils";

  const RefuseHiddenRowsPlugin = wrapPlans(
    (context) => (context.scope.isPgUpdateMutation || context.scope.isPgDeleteMutation ? true : null),
    () => (plan) => {
      const $payload = plan();
      sideEffect($payload.get("result"), (row) => {
        if (row == null) throw Object.assign(new Error("You don't have permission to do that."), { code: "42501" });
      });
      return $payload;
    },
  );
  ```
