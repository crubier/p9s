---
sidebar_position: 3
---

# Querying through RLS

A p9s policy is an `exists` over the caches. Postgres runs it in one of two ways:

- **Checking ancestors**: for each row, a few index lookups find whether one of its ancestors is assigned to the user, 5 to 10 µs per row.
- **Listing**: once per statement, it lists every resource the user can read and puts them in a hash, then each row is a hash probe. That costs about what the user can read, whatever the number of rows.

It chooses by the number of rows it expects the scan to return. p9s tells the planner that an assigned resource can have most of the cache below it, so that a statement over a few rows checks their ancestors rather than listing everything, see the [benchmarks](../benchmarks#users-who-see-much-of-the-graph). This page is about statements where that expectation is wrong, and how to write them. The numbers come from the [example app](https://github.com/crubier/p9s/tree/main/examples/nextjs-drizzle), where a member reads 108,000 of 181,000 documents, and from the benchmarks. [`reads.test.ts`](https://github.com/crubier/p9s/blob/main/packages/postgres/test/reads.test.ts) checks each pattern in every `combineAssignmentsWith` mode.

## Filters that are not leakproof

RLS must not let a filter of the user see rows the policy hides, for example by raising an error that shows a value. So Postgres only runs a filter before the policy, or as an index condition, when its function is leakproof. These are:

- `=`, `<`, `>` and the like on integers, uuids, booleans and text, and on timestamps compared with the same type: a `timestamp` column compared with a `timestamptz` parameter is not leakproof, so cast parameters to the type of the column
- row comparisons of such columns, like `(updated_at, id) < ($1, $2)`

These are not: `like`, `ilike`, `~`, full-text `@@`, the trigram `%`, jsonb operators, and functions like `lower`. `select proleakproof from pg_proc where proname = '...'` tells for any function.

A filter that is not leakproof has two costs:

- **No index**: a trigram or full-text index on the column is not used through RLS, every row of the table is read.
- **The policy runs on every row, planned for the rows the filter keeps.** A search for a word looks like it matches a few rows, so Postgres checks the ancestors of each row, for every row of the table. Searching the titles and contents of 181,000 documents took 1.7 s, against 0.2 s for the same filter when Postgres expects it to keep every row. In the benchmarks, a search over 5,600 posts takes 60 ms instead of 1.9 ms.

`offset 0` keeps a subquery from being merged into the query around it. Its scan then has the policy as its only filter, Postgres expects every row and lists what the user can read once, and the search filters the result:

```sql
select id, title
from (select id, title, content, updated_at from document offset 0) as d
where d.title ilike '%' || $1 || '%' or d.content ilike '%' || $1 || '%'
order by d.updated_at desc
limit 50;
```

The same goes for `count(*)` with such a filter. A fenced search costs about a count of what the user can read: 0.2 to 0.45 s for 108,000 documents.

Joins and `exists` checks next to the search are planned for the few rows Postgres expects it to return, too: in the example app, checking the organization of every match through the resource tree was planned as a loop over the whole cache for each of them, 30 s. Prefer a column, with a leakproof comparison that can go inside the subquery. Documents of the example hold their organization in `org_id`, which a foreign key to their folder keeps right:

```sql
select id, title
from (select id, title, content, updated_at from document where org_id = $2 offset 0) as d
where d.title ilike '%' || $1 || '%' or d.content ilike '%' || $1 || '%'
order by d.updated_at desc
limit 50;
```

That took 0.4 s.

## The views of the current user

Users read their own part of the graph through [views](./security-model#what-users-see-of-the-graph) that are security barriers. Postgres looks the rows of such a view up by the ids it is given, constants or scalar subqueries, in the index:

```sql
select exists (
  select 1 from current_resource_edge
  where parent_id = $1 and child_id = (select resource_id from document where id = $2)
);
```

That takes under 1 ms. It cannot look them up by a column of another table, as it does with a table: a join or an `exists` that compares a column of the view with a column of each row first lists every row of the view that the other conditions allow. In the example app, `exists (select 1 from current_resource_edge c where c.parent_id = $1 and c.child_id = d.resource_id)` listed the 139,000 resources below the organization, and every resource the user reaches, to check them: 4.4 s for a page of 50 documents and 0.8 s for a single one. The `org_id` column does it in 0.12 s and under 1 ms. Policies are not concerned: Postgres runs each one as a subquery of the row it checks, and looks the views up by the id of that row.

## Pages

An `offset` reads every row it skips, and checks each one against the policy: the page after 50,000 documents took 2 to 2.7 s. Leakproof comparisons can run in the index before the policy, so a page that starts at a key, from the last row of the previous one, reads about one page of rows wherever it is:

```sql
create index on document (updated_at, id);

select id, title, updated_at
from document
where (updated_at, id) < ($1::timestamp, $2::uuid)
order by updated_at desc, id desc
limit 50;
```

That page took 0.07 to 0.16 s. Postgres expects the index to return every row of the table, not the 50 the limit keeps, so it still lists what the user can read once: a first page costs about what the user can read, whatever its size.

### First pages

Postgres does not let a query choose how a policy runs, so the select policies of p9s read a setting. With `p9s.check_rows` on, they check the ancestors of each row the scan returns, and never list:

```sql
begin;
select set_config('p9s.check_rows', 'on', true);
select id, title, updated_at from document order by updated_at desc, id desc limit 50;
commit;
```

Checking costs 5 to 10 µs for each row the scan walks, listing about 1 µs for each resource the user can read. A page walks rows until it has enough readable ones, about its size divided by the share of the rows the user can read. So turn the setting on for statements that stop early, like a page under a `limit`, when the user can read much of what the scan walks, and leave it off for those that read every row, like a count:

| Postgres 18                                                   | Off    | `p9s.check_rows` on |
| ------------------------------------------------------------- | ------ | ------------------- |
| First page of 50, for a user who reads 100,000 posts of 100,000 | 12 ms  | 0.3 ms              |
| Count of those posts                                          | 23 ms  | 170 ms              |
| First page of 50, for a user who reads 200 posts of 5,600 (benchmarks) | 2.6 ms | 33 ms      |

An application rarely knows the share of rows a user can read beforehand. Since a check only costs time while it goes, a short `statement_timeout` bounds it: in a savepoint, run the page with the setting on and a timeout of a few milliseconds, and if Postgres cancels it, roll back to the savepoint and run it again with the setting off. A user who reads few rows then pays the timeout on top of a listing that is cheap for them. Rolling back to the savepoint also restores both settings, which a read does not need to keep. The [example app](https://github.com/crubier/p9s/blob/main/examples/nextjs-drizzle/src/db.ts) does this in `pageRows`.

The setting changes how a policy checks rows, not which rows it lets through, so a user setting it only changes how fast their reads are. It is read once per statement. Off, the policy runs as before, at the same speed.

Postgres estimates a `case` at the cost of all its branches, so the estimates of every read through RLS double. With JIT on, which Postgres built with LLVM enables by default from a cost of 100,000, the count above compiles more and takes 160 to 200 ms instead of 100 to 150 ms. It took 23 ms without JIT. In a small database, JIT compiled a count of 7 documents for longer than 10 ms, so a page under a timeout always ran twice. Turn JIT off for the application: with `alter role ... set jit = off` for the role it logs in as, or with `set_config('jit', 'off', true)` in its transactions.

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
