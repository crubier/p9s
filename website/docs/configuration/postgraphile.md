---
sidebar_position: 5
---

# PostGraphile

[PostGraphile](https://postgraphile.org) builds a GraphQL API from the tables, views and functions of a schema, and runs every request as a database role, so that RLS decides what it reads and writes. With `engine.postgraphile: true`, the migration adds what it needs to serve p9s too. [`examples/postgraphile`](https://github.com/crubier/p9s/tree/main/examples/postgraphile) is a complete API built that way.

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

- **Keys of the views.** PostGraphile only follows foreign keys, and views have none. Smart comments give `resource_node` and `role_node` (see [views of all nodes](./security-model#nodes-are-rows)) a primary key and a foreign key to each bound table, and give the views of p9s (`current_resource_access`, `current_assignment`, `current_resource_edge`, `current_role`, `resource_access`, `resource_role_access`) foreign keys to the node views. A client walks from an assignment to its resource, then to the project or task it is:

  ```graphql
  {
    allCurrentAssignments {
      nodes { permission resource { tableName project { name } task { title } } }
    }
  }
  ```

  These views are read only: they have no mutation.

- **A `permission` field on each resource table.** PostGraphile skips functions with overloads, and `resource_permission` has two, so the migration adds `<table>_permission(row)` for each resource table, and `resource_node_permission(node)`. PostGraphile serves each as a `permission` field of its type, with the bits of the current user on the row: `allProjects { nodes { name permission } }`. A table with a `permission` column of its own clashes with that field.

- **The internal objects hidden.** Edge tables, caches, the views of each bit, triggers and helper functions get `@behavior -*`: the API has none of them. Edges and assignments are written by graph writers, not through the API, except through `resource_share` and `resource_unshare`, which stay: users with the `share` bit call them as `resourceShare` and `resourceUnshare` mutations, see [sharing](./security-model#sharing).

## What it needs

- **Postgres 15.** The node views use `security_invoker`. Below Postgres 15, p9s adds the `permission` fields and the comments of the tables, without the node views and their keys.
- **The select privilege on every bound table** for the role of the requests, since `resource_node` and `role_node` read all of them.
- **Creating rows through functions.** A create mutation inserts the row, then reads it back. Postgres checks the select policy of the new row before the triggers of p9s give it its home edge, so the user cannot see it yet and the insert fails. Hide the create mutations of node tables, `comment on table project is '@behavior -insert'`, and create rows through a function that inserts without `returning`, then reads the row:

  ```sql
  create function create_project(org_id uuid, name text) returns project
  language plpgsql volatile as $$
  declare
    the_id uuid := uuid_generate_v4();
  begin
    insert into project (id, org_id, name) values (the_id, create_project.org_id, create_project.name);
    return (select p from project p where p.id = the_id);
  end
  $$;
  comment on function create_project(uuid, text) is '@resultFieldName project';
  ```

  Leaf rows, like comments, have no home edge: their create mutations work as they are. Updates and deletes too.
