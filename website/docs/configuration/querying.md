---
sidebar_position: 3
---

# Querying through RLS

A p9s policy reads the caches in one of two ways:

- **Checking ancestors**: for one row, a few index lookups find whether one of its ancestors is assigned to the user, 10 to 20 µs per row.
- **Listing**: once per statement, it lists the resources the user has the bit on and puts them in a hash, then each row is a hash probe. That costs about 0.5 µs for each listed resource, whatever the number of rows.

Left to itself, Postgres would choose by the number of rows it expects the scan to return, and it is often wrong: a filter like `ilike` makes it expect a few rows and check every row of the table, a `limit` makes it list everything for a page of 50. So p9s policies decide as the statement runs, see [how policies run](#how-policies-run). The rest of this page is about the statements that still cost more than they should, and how to write them. The numbers come from the [example app](https://github.com/crubier/p9s/tree/main/examples/nextjs-drizzle), where a member reads 108,000 of 181,000 documents, from the benchmarks, and from the dataset of [`reads.test.ts`](https://github.com/crubier/p9s/blob/main/packages/postgres/test/reads.test.ts), where a user reads 10,000 of 20,000 posts, on Postgres 18. That test checks each pattern in every `combineAssignmentsWith` mode.

## How policies run

A select policy goes through these steps, and stops at the first that decides the row:

1. At the first row, it lists the first 1000 resources the user has the bit on. A user who has fewer has them all, and every row of the statement is a hash probe from then on.
2. For a row that is not among them, the first one is checked by its ancestors. A lookup by id stops there: one listing of at most 1000 resources and at most one check.
3. Past that row, it lists the first 3000, all of them for most users.
4. For a row that is not among these either, it checks rows one by one, 50 per statement, then lists every resource the user has the bit on.

So a statement that reads a few rows never lists everything, and one that reads many lists it once, after at most 50 checks. Update and delete policies only do the last step: they check the rows they write, then list past 50. The select policy of a statement that updates or deletes rows does the same, as listing first would also read the cache entries that writes leave behind until a vacuum. A later statement of the same query string, sent in one message, is taken for a write too. That changes its speed, not its rows.

The policies keep their counts in settings of the transaction, one per table and operation, which each statement resets. Every way lets the same rows through: they differ in speed only.

On the planner side, checks and listings are functions that cost 1 to it, so the policies add almost nothing to the estimate of a statement. A count of 20,000 posts through RLS stays under a cost of 10,000, well below the default threshold of JIT, 100,000. Before, Postgres compiled that count with JIT in 140 ms. It now takes 9 ms, with or without JIT. The functions list through the indexes, from the assignments of the user down, so a user who reads few resources never scans a whole cache.

With 10,000 readable posts out of 20,000, `combineAssignmentsWith: none`, JIT off, in milliseconds:

| Statement                            | Before | Now        |
| ------------------------------------ | ------ | ---------- |
| Search names with `ilike`            | 102    | 12–13      |
| First page of 50                     | 2.7    | 0.32–0.41  |
| Read one post by id                  | 0.38   | 0.34       |
| Count every readable post            | 4.4    | 8.9–9.4    |
| Posts of one group                   | 0.72   | 1.15–1.24  |

For a user who reads 200 of them, a search takes 1.25 ms instead of 140 ms, a first page 0.61 ms instead of 0.98 ms, and a lookup by id 0.16 to 0.19 ms instead of 0.40 ms.

The steps cost something too, and some statements are slower than before:

- A user with more than 3000 resources pays for the two first listings and the 50 checks before listing everything: about 4 ms more for a statement over every row, as the count above.
- A lookup by id lists up to 1000 resources: up to 0.25 ms more than a single check, for a user with that many.
- A count over a small table, like folders, for a user with more than 1000 resources, is up to 3 ms slower.

### `p9s.check_rows` {#check-rows}

The `p9s.check_rows` setting says how many rows to check before listing, for every user. With `on` a statement checks every row and never lists, with `off` it lists at the first row, and with a number it checks that many rows:

```sql
begin;
select set_config('p9s.check_rows', '200', true);
select id, title, updated_at from document order by updated_at desc, id desc limit 50;
commit;
```

Unset, or any other value, policies go through the steps above, which suit most statements. The setting is for a statement whose rows you know better than p9s does. Checks go through a function now, which costs about 20 µs per row instead of 10 µs: with `on`, a first page that walks many rows takes twice as long as before. Users may set it: it only changes how fast their statements are.

## Filters that are not leakproof

RLS must not let a filter of the user see rows the policy hides, for example by raising an error that shows a value. So Postgres only runs a filter before the policy, or as an index condition, when its function is leakproof. These are:

- `=`, `<`, `>` and the like on integers, uuids, booleans and text, and on timestamps compared with the same type: a `timestamp` column compared with a `timestamptz` parameter is not leakproof, so cast parameters to the type of the column
- row comparisons of such columns, like `(updated_at, id) < ($1, $2)`

These are not: `like`, `ilike`, `~`, full-text `@@`, the trigram `%`, jsonb operators, and functions like `lower`. `select proleakproof from pg_proc where proname = '...'` tells for any function.

A filter that is not leakproof has two costs:

- **No index**: a trigram or full-text index on the column is not used through RLS, every row of the table is read.
- **The policy runs on every row.** Postgres expects such a filter to keep a few rows, and would check the ancestors of every row of the table. The policies list what the user can read after 50 checks instead: in the benchmarks, a search of 1,800 posts takes 1.4 to 3 ms instead of 17 to 19 ms.

`offset 0`, which keeps a subquery from being merged into the query around it, made Postgres expect every row and list what the user can read. Policies do that on their own now, and the fence makes no difference.

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

That takes under 1 ms. It cannot look them up by a column of another table, as it does with a table: a join or an `exists` that compares a column of the view with a column of each row first lists every row of the view that the other conditions allow. In the example app, `exists (select 1 from current_resource_edge c where c.parent_id = $1 and c.child_id = d.resource_id)` listed the 139,000 resources below the organization, and every resource the user reaches, to check them: 4.4 s for a page of 50 documents and 0.8 s for a single one. The `org_id` column does it in 0.12 s and under 1 ms. Policies are not concerned: they check one row by its id, and list through functions.

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

A page never lists everything the user can read: it lists up to 1000 resources, and checks the rows that are not among them. A first page of 50 takes 0.3 to 0.4 ms for a user who reads 10,000 posts, instead of 2.7 ms when it listed them all.

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
