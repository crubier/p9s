---
sidebar_position: 10
---

# Go

The [`p9s`](https://github.com/crubier/p9s/tree/main/packages/go) module runs a function in a transaction as a user, for `database/sql`, pgx with `p9spgx`, and GORM with `p9sgorm`. [`examples/gorm`](https://github.com/crubier/p9s/tree/main/examples/gorm) adopts p9s in a `net/http` and GORM app, with goose migrations.

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

[`before/`](https://github.com/crubier/p9s/tree/main/examples/gorm/before) checks every handler with `permissions.go`. [`after.patch`](https://github.com/crubier/p9s/blob/main/examples/gorm/after.patch) deletes it, and runs each handler in a GORM transaction as the user of its request.
