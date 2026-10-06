---
sidebar_position: 4
---

# Upgrading

The migration upgrades databases created by earlier versions in place. Some changes need changes in the application too.

## Users no longer read the graph

Application users used to read the edge, assignment and cache tables whole. They now have no privilege on them, and see their own part of the graph through [views of the current user](./security-model#what-users-see-of-the-graph). Queries that application users run on the graph tables fail with `permission denied`:

- To list what was shared with the user, read `current_assignment` rather than `assignment_edge` or `assignment_edge_cache`.
- To tell whether a resource is below another, read `current_resource_edge` rather than `resource_edge_cache`. Both must be in reach of the user.
- To list the teams of the user, read `current_role` rather than `role_edge_cache`.
- To list who has access to a document, or what another role can do on it, give the table a `manageAccess` bit and read `resource_access`, or call `resource_permission(resource_id, role_id)`, see [seeing the access of others](./security-model#seeing-the-access-of-others). `resource_permission(resource_id, role_id)` used to refuse users: it now returns no bits to users without the bit.
- To read who is in a team, read the role tables as a graph writer, after checking that the user may know.

## From node tables

Earlier versions of p9s kept every node in a `resource_node` or `role_node` table. A business row referenced its node through a foreign key, and the application created the node and its edges before the row. Now every row of a bound table is a node itself, and the node tables are gone.

Running the new migration on a database created by an earlier version upgrades it in place, keeping its ids, edges and assignments. It fails without changing anything if the database has nodes that are not rows.

### Before migrating

**Every node must be a row of a bound table.** Nodes that were only used to group other nodes, such as an organization node with no table of its own, must become rows. A table with only an id column is enough:

```sql
create table "organization" ("resource_id" integer primary key);
insert into "organization" ("resource_id")
select "id" from "resource_node" as "the_node"
where not exists (select from "document" where "document"."resource_id" = "the_node"."id")
-- ... and not exists in the other bound tables
;
```

Then add the table to the config with `isResource: true` and `resourceId: "resource_id"`. If some nodes are not rows of any bound table, the migration stops with an error such as `p9s: 6 resource nodes are not a row of a bound table`. Delete them, or bind a table that holds them, then run the migration again.

**Optionally, add parent columns.** If your rows already record their parent, for example in a `folder_id` column, set `resourceParent` (or `roleParent`) on the table. The upgrade marks the edges matching that column as home edges, and adds home edges for rows whose parent has none. From then on, the column is the only thing to write when creating or moving a row. Edges that don't match a parent column stay as shares.

### What the migration does

1. Drops the foreign keys of edges, caches, assignments and bound tables to the node tables. Triggers check edges and assignments instead.
2. Adds the `home` column to the edge tables, and marks the edges matching parent columns as home edges.
3. Drops `resource_node` and `role_node`.
4. In integer mode, creates the shared sequences `resource_id_seq` and `role_id_seq` and moves them past the largest existing id, so that new rows of every bound table get unused ids.
5. Rebuilds the caches.

The upgrade only runs while the node tables exist, so running the migration again is safe.

### Application changes

- Stop inserting into `resource_node` and `role_node`. Insert the business row, its id column has a default.
- Where the application inserted an edge from a row's parent, set the parent column instead, and drop the edge insert. The same goes for moves (update the column) and for deleting a row (its edges and assignments are deleted with it).
- Application users can now insert rows themselves, under a parent where they have the table's `insert` bit. Rows without parent still have to be created by the owner, or by a `security definer` function.
- Edges that the application deletes or updates directly must not be home edges: p9s rejects deleting a home edge, and turns a home edge it updates into a share. See [home edges and shares](./security-model#home-edges-and-shares).
