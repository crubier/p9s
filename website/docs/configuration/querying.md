---
sidebar_position: 3
---

# Querying through RLS

A p9s policy is one condition that Postgres adds to the query, as a `where` would:

```sql
resource_id in (select current_resource_access_0_list())
```

Once per statement, the function lists the resources the user has the bit on, through the indexes from the assignments of the user down, and Postgres puts them in a hash. Every row is then a hash probe, about 45 ns. The listing costs about 0.2 µs per listed resource, whatever the number of rows: 0.3 ms for a user who reads 1,600 resources, 2 ms for one who reads 10,000.

Postgres runs it the same way whatever it expects of the statement, see [how policies run](#how-policies-run). The rest of this page is about the statements that still cost more than they should, and how to write them. The numbers come from the [example app](https://github.com/crubier/p9s/tree/main/examples/apps/nextjs-drizzle), where a member reads 108,000 of 181,000 documents, from the benchmarks, and from the dataset of [`reads.test.ts`](https://github.com/crubier/p9s/blob/main/packages/postgres/test/reads.test.ts), where a user reads 10,000 of 20,000 posts, on Postgres 18. That test checks each pattern in every `combineAssignmentsWith` mode.

## How policies run

Select, update and delete policies each list once per statement, with no state and nothing decided as the statement runs: a filter like `ilike`, which makes Postgres expect a few rows, or a `limit`, change nothing. Postgres applies the select policy of a statement that updates rows twice, to the rows before and after, so an update lists three times, the resources the user may write and twice those it may read, and a delete twice.

A statement over a few rows pays a whole listing too: a lookup by id takes 0.3 ms more for a user who reads 1,600 resources than checking the ancestors of the row, and 2 ms more for one who reads 10,000. A request that reads a document then updates it lists four times.

The listing goes through index-only scans, and indexes of the caches include the columns it reads. Not through a bitmap: that would go again through the rows that writes leave under the parents of the user until a vacuum, where an index scan marks them dead the first time. Rows that are not visible to every transaction yet, after a bulk load, cost a read of the table each until a vacuum.

The rows of `insert ... returning` are checked by the select policy before the statement gives them their place in the graph. While a statement inserts into a table, that policy also lets a row through when its parent has the select bit, see [inserting and reading back](./identity#inserting-and-reading-back).

On the planner side, checks and listings are functions that cost 1 to it, so the policies add almost nothing to the estimate of a statement. A count of 20,000 posts through RLS stays under a cost of 10,000, well below the default threshold of JIT, 100,000. Before, Postgres compiled that count with JIT in 140 ms. It now takes about 4 ms, with or without JIT. The functions list through the indexes, from the assignments of the user down, so a user who reads few resources never scans a whole cache.

Out of 20,000 posts, `combineAssignmentsWith: none`, JIT off, average latency of each statement in pgbench, in milliseconds, against policies that checked the first rows one by one and listed past them:

| Statement                 | 10,000 readable: checks first | listing | 44 readable: checks first | listing |
| ------------------------- | ----------------------------- | ------- | ------------------------- | ------- |
| Search names with `ilike` | 13.9                          | 5.9     | 3.3                       | 2.5     |
| First page of 50          | 0.84                          | 2.2     | 3.8                       | 1.9     |
| Read one post by id       | 0.14                          | 2.1     | 0.15                      | 0.08    |
| Count every readable post | 12.4                          | 4.2     | 3.3                       | 2.4     |
| Posts of one group        | 0.87                          | 2.1     | 0.20                      | 0.11    |

A user who reads many resources pays for all of them in every statement: 2 ms for a lookup of one post, where checking its ancestors took 0.14 ms. Statements over many rows are faster for every user, and every statement for a user who reads few resources.

## Filters that are not leakproof

RLS must not let a filter of the user see rows the policy hides, for example by raising an error that shows a value. So Postgres only runs a filter before the policy, or as an index condition, when its function is leakproof. These are:

- `=`, `<`, `>` and the like on integers, uuids, booleans and text, and on timestamps compared with the same type: a `timestamp` column compared with a `timestamptz` parameter is not leakproof, so cast parameters to the type of the column
- row comparisons of such columns, like `(updated_at, id) < ($1, $2)`

These are not: `like`, `ilike`, `~`, full-text `@@`, the trigram `%`, jsonb operators, and functions like `lower`. `select proleakproof from pg_proc where proname = '...'` tells for any function.

A filter that is not leakproof has two costs:

- **No index**: a trigram or full-text index on the column is not used through RLS, every row of the table is read.
- **The policy runs on every row.** Postgres expects such a filter to keep a few rows, and would check the ancestors of every row of the table. The policy lists what the user can read once instead, whatever Postgres expects: a search of the names of 20,000 posts takes 5.9 ms for a user who reads 10,000 of them, where checking every row took 122 to 130 ms.

`offset 0`, which keeps a subquery from being merged into the query around it, made Postgres expect every row and list what the user can read. Policies always list, and the fence makes no difference.

Joins and `exists` checks next to the search are still planned for the few rows Postgres expects it to return: in the example app, checking the organization of every match through the resource tree was planned as a loop over the whole cache for each of them, 30 s. Prefer a column, with a leakproof comparison. Documents of the example hold their organization in `org_id`, which a foreign key to their folder keeps right:

```sql
select id, title
from document
where org_id = $2 and (title ilike '%' || $1 || '%' or content ilike '%' || $1 || '%')
order by updated_at desc
limit 50;
```

### Searches through an index

A filter still reads every row of the table, and every row the user can read. A [search](./overview#searches) declared in the config matches through a trigram or full-text index instead, and checks only the rows that match:

```sql
select id, title
from document_search('%' || $1 || '%') as d
where d.org_id = $2
order by d.updated_at desc
limit 50;
```

In the example app, for the member who reads 108,000 documents, with trigram indexes on the titles and contents of the 181,000 documents of every organization, against an `ilike` filter that lists what the member can read:

| Searched for  | Documents that match | `ilike` | `document_search` |
| ------------- | -------------------- | ------- | ----------------- |
| "zebra"       | 0                    | 380 ms  | 2 ms              |
| "hiring plan" | 279                  | 390 ms  | 18 ms             |
| "roadmap"     | 11,000               | 400 ms  | 290 ms            |
| "budget"      | 76,000               | 600 ms  | 730 ms            |

A search costs about what matches in the whole table, readable or not, plus reading back those the user can read: rare words take milliseconds, and a word in nearly half the documents takes a little longer than the filter.

## The views of the current user

Users read their own part of the graph through [views](./security-model#what-users-see-of-the-graph) that are security barriers. Postgres looks the rows of such a view up by the ids it is given, constants or scalar subqueries, in the index:

```sql
select exists (
  select 1 from current_resource_edge
  where parent_id = $1 and child_id = (select resource_id from document where id = $2)
);
```

That takes under 1 ms. It cannot look them up by a column of another table, as it does with a table: a join or an `exists` that compares a column of the view with a column of each row first lists every row of the view that the other conditions allow. In the example app, `exists (select 1 from current_resource_edge c where c.parent_id = $1 and c.child_id = d.resource_id)` listed the 139,000 resources below the organization, and every resource the user reaches, to check them: 4.4 s for a page of 50 documents and 0.8 s for a single one. The `org_id` column does it in 0.12 s and under 1 ms. Policies are not concerned: they list through functions.

## Pages

An `offset` reads every row it skips, and the policy lets each one through or not: the page after 50,000 documents took 2 to 2.7 s. Leakproof comparisons can run in the index before the policy, so a page that starts at a key, from the last row of the previous one, reads about one page of rows wherever it is:

```sql
create index on document (updated_at, id);

select id, title, updated_at
from document
where (updated_at, id) < ($1::timestamp, $2::uuid)
order by updated_at desc, id desc
limit 50;
```

A page lists everything the user can read, once: a first page of 50 takes 2.2 ms for a user who reads 10,000 posts, and 1.9 ms for one who reads 44, which goes through every post to fill it.

## What was shared with the user

A list like "Shared with me" shows the rows a user can read in folders they cannot read. Filtering what they read by a parent they cannot read checks every readable row: 0.5 to 2.4 s for 108,000 documents.

A bit is on every edge of some path from an assignment to the resource, so it is on the path to the parent too. A row readable under a parent that is not was therefore assigned to the user itself, or reached through another edge than the one from its parent. Without other edges, start from the assignments of the user, a few rows, which the `current_assignment` [view](./security-model#what-users-see-of-the-graph) lists:

```sql
select d.id, d.title
from document d
where d.resource_id in (select resource_id from current_assignment)
and not exists (select 1 from folder f where f.id = d.folder_id);
```

That took 5 ms. The view holds the resources assigned to the user, to a role above it, or with [role leaf tables](./overview#role-leaf-tables) to the parent of its API key.

## Statistics

The choices above use the statistics of the caches. The trigger enable functions of [bulk loads](./security-model#rules-for-the-application) analyze the tables they rebuild, and autovacuum the others soon after. Run `analyze` after loading business rows in bulk too.
