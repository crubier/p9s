---
sidebar_position: 3.5
---

# Searches

Postgres runs the policies of RLS before any filter that is not leakproof, like `ilike`, `like`, `~`, the trigram `%` or full-text `@@`, so that the filter never sees a row the user cannot read. That keeps such a filter from using an index: it reads every row of the table, and every row the user can read, see [filters that are not leakproof](./querying#filters-that-are-not-leakproof). In the example app, an `ilike` over the titles of 181,000 documents takes 380 ms for a member who reads 108,000 of them, whatever it looks for.

A search declared in the config matches through an index first, then checks only the rows that match: the same search takes 2 ms there. It returns what the filter through RLS would, see [what a search shows](#what-a-search-shows).

## Declaring a search

`search` names the searches of a resource table, each with the columns it matches and the operator:

```json
{
  "name": "documents",
  "isResource": true,
  "resourceId": "resource_id",
  "resourceParent": { "column": "project_id", "table": "projects", "key": "id" },
  "search": {
    "search": { "columns": ["title", "body"], "operator": "ilike" }
  },
  "permission": { "app_user": { "select": 0, "insert": 1, "update": 1, "delete": 2 } }
}
```

Each search becomes a function named after the table and its key, here `documents_search(the_value)`. It returns the rows of the table where one of the columns matches the value, among those the current user can read. A table can have several, like `search` for titles and `words` for full text, which gives `documents_words(the_value)`.

| Operator              | Columns    | Value      | Index                                                     |
| --------------------- | ---------- | ---------- | --------------------------------------------------------- |
| `like`, `ilike`       | `text`     | a pattern  | `pg_trgm`: `gin (column gin_trgm_ops)`                    |
| `~`, `~*`             | `text`     | a regular expression | `pg_trgm`: `gin (column gin_trgm_ops)`          |
| `%`                   | `text`     | a word, matched by similarity | `pg_trgm`: `gin (column gin_trgm_ops)` |
| `@@`                  | `tsvector` | a `tsquery` | `gin (column)`                                           |

`varchar` columns work like `text`. The table needs the `select` bit for at least one user role, and can be a [leaf table](./overview#leaf-tables), whose rows are checked by their parent. Each user role with that bit can run the search. Leaf rows take the permissions of their parent, and soft deleted rows are found when the user could read them.

## The indexes

p9s does not create the indexes: create them with the migrations of the application, before or after the p9s migration. For trigram operators, [`pg_trgm`](https://www.postgresql.org/docs/current/pgtrgm.html), which most hosted Postgres offer, Supabase, Neon and RDS among them:

```sql
create extension if not exists pg_trgm;
create index documents_title_trgm on documents using gin (title gin_trgm_ops);
create index documents_body_trgm on documents using gin (body gin_trgm_ops);
```

With Drizzle, in the schema, as the [Next.js example](https://github.com/crubier/p9s/tree/main/examples/apps/nextjs-drizzle) does:

```ts
(table) => [index("documents_title_trgm").using("gin", table.title.op("gin_trgm_ops"))]
```

For full text, a generated `tsvector` column and its index:

```sql
alter table documents add column words tsvector
  generated always as (to_tsvector('english', title || ' ' || body)) stored;
create index documents_words on documents using gin (words);
```

```json
"search": { "words": { "columns": ["words"], "operator": "@@" } }
```

Without an index, a search still returns the right rows: it reads the whole table as the owner, without the policies, then checks the rows that match. Each index makes the writes of its columns a little slower, as any GIN index does.

## Calling it

A search is a set of rows, which queries filter, join, order, count and page like a table:

```sql
select id, title
from documents_search($1) as d
where d.project_id = $2
order by d.id desc
limit 50;
```

The value is the right-hand side of the operator. For `like` and `ilike` the application adds the wildcards, and escapes those of the user, `\`, `%` and `_`, so that a search for `50%` does not match everything:

```ts
const pattern = `%${query.trim().replace(/[\\%_]/g, character => `\\${character}`)}%`;
```

```sql
-- The same in SQL, as the PostGraphile example does
create function contains_pattern(query text) returns text language sql immutable as $$
  select '%' || replace(replace(replace(trim(coalesce(query, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%'
$$;
```

For `@@`, the value is a `tsquery`, which `websearch_to_tsquery` builds from what a user types:

```sql
select id, title, ts_rank(d.words, query) as rank
from documents_words(websearch_to_tsquery('english', $1)) as d, websearch_to_tsquery('english', $1) as query
order by rank desc
limit 50;
```

To put the best matches first with `ilike`, order by the column that matched, like `order by d.title ilike $1 desc, d.id desc`. Filters on the search, like `d.project_id = $2`, and joins run after it, on the rows the user can read. The argument is named `the_value`, for APIs that call functions by name: `supabase.rpc("documents_search", { the_value: pattern })`, or `documentsSearch(theValue: "%plan%")` in PostGraphile.

Each integration shows the call in its own idiom: [Drizzle](../integrations/drizzle#searches), [PostGraphile](../integrations/postgraphile#searches), [Prisma](../integrations/prisma#searches), [Kysely](../integrations/kysely#searches), [Supabase](../integrations/supabase#searches), [SQLAlchemy](../integrations/sqlalchemy#searches), [Django](../integrations/django#searches), [Rails](../integrations/rails#searches), [Go](../integrations/go#searches), [Rust](../integrations/rust#searches), [Elixir](../integrations/elixir#searches) and [Laravel](../integrations/laravel#searches).

## What it costs

A search costs about what matches in the whole table, readable or not, plus reading back the rows the user can read. In the example app, for the member who reads 108,000 of the 181,000 documents, with trigram indexes on titles and contents:

| Searched for  | Documents that match | `ilike` | `document_search` |
| ------------- | -------------------- | ------- | ----------------- |
| "zebra"       | 0                    | 380 ms  | 2 ms              |
| "hiring plan" | 279                  | 390 ms  | 18 ms             |
| "roadmap"     | 11,000               | 400 ms  | 290 ms            |
| "budget"      | 76,000               | 600 ms  | 730 ms            |

In the [benchmarks](../benchmarks#a-user-who-reaches-every-resource), a rare name among 13,824 posts takes 4 ms for a user who reads 7,744 of them through 10 teams, against 95 ms with `ilike`.

Rare words take milliseconds. Many matches cost more, because the search checks each of them against the policies of the user, then reads them back through RLS. For a user who reads more than 3000 resources, past 200 matches each of these steps lists what the user can read, as the filter does once, see [how policies run](./querying#how-policies-run): a word in nearly half the table takes a little longer than the filter. A `limit` applies to the rows the search returns, after it found every match, so it does not make a search for a common word faster.

## What a search shows

A search returns the rows a filter through RLS would return, and reads them as the caller: the other policies of the table, the application's own included, and the column privileges apply. Only the user roles with the `select` bit on the table can run it. [Searches](./security-model#searches) in the security model explains how. Two things follow:

- **A search reads every column**, as it returns whole rows: a role with `select` on some columns only gets `permission denied`.
- **How long it takes depends on how many rows match, readable or not**, as with any index. A user who times many searches could estimate how many rows they cannot read match a value. Only declare a search where that is acceptable.

The functions behind a search tell who the current user is with `getCurrentUserId`, which runs as the owner there, so it should read the request, like a setting or a claim of the JWT, rather than `current_user`, see [identity](./identity).

## Migrations

The p9s migration creates the function of each declared search, replaces it when its columns or its operator change, and drops the searches the config no longer declares. Declaring a search is a change of the config: run the migration again, and deploy the code that calls the search after it. [`p9s postgres status`](../packages/cli#postgres-status) tells whether the database ran the migration of the current config.

## When it goes wrong

- **`function documents_search(...) does not exist`**: the database has not run the migration since the search was declared, or the key differs, `search` in `documents_search`.
- **`permission denied for function documents_search`**: the request runs as a role without the `select` bit on the table, or as no role of `engine.users`. Check that it runs [as its user](./identity).
- **`permission denied for table documents`**: the role has `select` on some columns only, see above.
- **No rows for a user who should see some**: check the same rows with a filter, `select id from documents where title ilike $1`, in the same transaction. If it finds none either, the user cannot read them: `resource_permission(resource_id)` tells the bits they have on a row, see [checking permissions](./security-model#checking-permissions-in-application-code).
- **As slow as the filter**: the index does not serve the operator. As the owner, `explain select ctid from documents where title ilike '%plan%'` should show a `Bitmap Index Scan` on it. Trigram indexes need 3 characters or more to narrow a pattern down, and `%` matches by `pg_trgm.similarity_threshold`.
