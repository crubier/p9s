---
sidebar_position: 3
---

# Upgrading from Node Tables

Earlier versions of p9s kept every node in a `resource_node` or `role_node` table. A business row referenced its node through a foreign key, and the application created the node and its edges before the row. Now every row of a bound table is a node itself, and the node tables are gone.

Running the new migration on a database created by an earlier version upgrades it in place, keeping its ids, edges and assignments. It fails without changing anything if the database has nodes that are not rows.

## Before migrating

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

## What the migration does

1. Drops the foreign keys of edges, caches, assignments and bound tables to the node tables. Triggers check edges and assignments instead.
2. Adds the `home` column to the edge tables, and marks the edges matching parent columns as home edges.
3. Drops `resource_node` and `role_node`.
4. In integer mode, creates the shared sequences `resource_id_seq` and `role_id_seq` and moves them past the largest existing id, so that new rows of every bound table get unused ids.
5. Rebuilds the caches.

The upgrade only runs while the node tables exist, so running the migration again is safe.

## Application changes

- Stop inserting into `resource_node` and `role_node`. Insert the business row, its id column has a default.
- Where the application inserted an edge from a row's parent, set the parent column instead, and drop the edge insert. The same goes for moves (update the column) and for deleting a row (its edges and assignments are deleted with it).
- Application users can now insert rows themselves, under a parent where they have the table's `insert` bit. Rows without parent still have to be created by the owner, or by a `security definer` function.
- Edges that the application deletes or updates directly must not be home edges: p9s rejects deleting a home edge, and turns a home edge it updates into a share. See [home edges and shares](./security-model#home-edges-and-shares).
