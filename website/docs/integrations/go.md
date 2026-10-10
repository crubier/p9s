---
sidebar_position: 10
---

# Go

The [`p9s`](https://github.com/crubier/p9s/tree/main/packages/go) module runs a function in a transaction as a user, for `database/sql`, pgx with `p9spgx`, and GORM with `p9sgorm`. [`examples/integrations/gorm`](https://github.com/crubier/p9s/tree/main/examples/integrations/gorm) adopts p9s in a `net/http` and GORM app, with goose migrations.

The reference of each function, its options and its errors: [the `p9s` module](../packages/go).

## p9s adopt

```bash
npx @p9s/cli adopt
go mod tidy
```

[`p9s adopt`](../packages/cli#adopt) adds the module to `go.mod`, and writes `p9s.go`, with the identity `users` of [the config](#config), in the package at the root of the module. A Go app has no one place where every request goes, so running them as their users, answering 403 to refused writes, and deleting the permission checks are left to you, as in [the example](#the-example).

## Install

```bash
go get github.com/crubier/p9s/packages/go
```

## Config

`FromFile` reads the role and the setting from [the config](./adopting#the-config):

```go
import p9s "github.com/crubier/p9s/packages/go"

var users = p9s.Must(p9s.FromFile("p9s.config.json"))
```

## Each request as its user

```go
// database/sql
err := users.AsUser(ctx, db, userID, func(tx *sql.Tx) error {
	rows, err := tx.QueryContext(ctx, "select id, title from documents order by id")
	// ...
}, p9s.ReadOnly(true))

// pgx
err := p9spgx.AsUser(ctx, pool, users, userID, func(tx pgx.Tx) error { /* ... */ })

// GORM
err := p9sgorm.AsUser(ctx, db, users, userID, func(tx *gorm.DB) error {
	return tx.Order("id").Find(&documents).Error
})
```

`AsUser` begins a transaction, acts as the user in it, commits when the function returns nil and rolls back when it returns an error or panics. `users.SetUser(ctx, tx, userID)` acts as the user for the rest of a transaction already begun. `p9s.Middleware(userIDOf)` puts the id of the user of each request in its context, and `p9s.UserID(r.Context())` reads it back. The example runs each handler that way, read only for `GET`:

```go
err = p9sgorm.AsUser(r.Context(), s.db, s.users, userID, func(tx *gorm.DB) (err error) {
	a, err = h(r, tx)
	return err
}, p9s.ReadOnly(r.Method == http.MethodGet))
```

## Refused writes

`p9s.IsRefused(err)` tells a write the policies refused, through any wrapping, for pgx and lib/pq:

```go
if p9s.IsRefused(err) {
	http.Error(w, "forbidden", http.StatusForbidden)
}
```

An update or a delete of rows the user reads but cannot change touches no row: check `RowsAffected`.

## The migration

After the migrations of the app:

```bash
npx @p9s/cli postgres migrate --config p9s.config.json
```

Or as a migration of goose, in `migrations`, which `goose up`, or `goose.Up` with embedded migrations, then runs:

```bash
npx @p9s/cli postgres generate --config p9s.config.json --format goose
```

The structs do not change: GORM reads the columns its structs name, and leaves the `role_id` and `resource_id` columns p9s adds to their defaults.

## The example

[`before/`](https://github.com/crubier/p9s/tree/main/examples/integrations/gorm/before) checks every handler with `permissions.go`. [`adopt.patch`](https://github.com/crubier/p9s/blob/main/examples/integrations/gorm/adopt.patch) is what `p9s adopt` writes: the module, and `p9s.go`. [`after.patch`](https://github.com/crubier/p9s/blob/main/examples/integrations/gorm/after.patch) is the rest, by hand: it deletes `permissions.go` and its checks, and runs each handler in a GORM transaction as the user of its request.

## Benchmark

The [example](https://github.com/crubier/p9s/tree/main/examples/integrations/gorm) before p9s and after p9s, each on its own database with the rows of [`benchmark-seed.sql`](https://github.com/crubier/p9s/blob/main/examples/integrations/adoption/benchmark-seed.sql): 1000 users in 100 teams, 1000 projects and 20,000 documents, of which each user reads about 1200. 20 of the users send each request 600 times to each app, 4 at a time, in 3 rounds that switch which app goes first. Times are in milliseconds.

| Request | Before: median | p95 | Requests/s | After: median | p95 | Requests/s | After / before |
|---|---:|---:|---:|---:|---:|---:|---:|
| List projects `GET /projects` | 0.39 | 1.07 | 4,931 | 1.27 | 2.82 | 2,137 | 3.26× |
| List documents `GET /documents` | 3.33 | 5.55 | 1,045 | 6.33 | 12.29 | 510 | 1.90× |
| Read a document `GET /documents/:id` | 0.74 | 8.88 | 2,660 | 0.77 | 2.22 | 2,746 | 1.04× |
| Create a document `POST /documents` | 0.49 | 5.73 | 3,754 | 0.85 | 2.57 | 2,982 | 1.73× |
| Update a document `PATCH /documents/:id` | 0.64 | 7.06 | 3,139 | 1 | 2.27 | 2,717 | 1.56× |
| Share a document `PUT /documents/:id/shares/:user_id` | 0.87 | 8.35 | 2,484 | 1.33 | 2.02 | 2,434 | 1.53× |

Measured on 2026-10-10: Apple M2 Max, 12 cores, 64 GiB, Darwin 25.6.0 arm64. Go 1.26.0, PostgreSQL 18.6, p9s 0.1.0. [How it runs](../benchmarks#the-examples).
