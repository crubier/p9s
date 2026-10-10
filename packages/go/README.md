# p9s for Go

Act as a user of [p9s](https://github.com/crubier/p9s), permissions of trees in Postgres with row level security, from
`database/sql`, pgx and GORM: every query of a transaction runs as the role of the users of the config, with the id of
the user in the setting its current user function reads, so the policies of p9s decide what it reads and writes.

```bash
go get github.com/crubier/p9s/packages/go
```

The role and the setting come from the config of p9s, as for `createIdentity` of `@p9s/postgres`:

```go
import p9s "github.com/crubier/p9s/packages/go"

var users = p9s.Must(p9s.FromFile("p9s.config.json"))
```

## database/sql

```go
err := users.AsUser(ctx, db, userID, func(tx *sql.Tx) error {
	rows, err := tx.QueryContext(ctx, "select id, title from documents order by id")
	// ...
}, p9s.ReadOnly(true))
```

`AsUser` begins a transaction, acts as the user in it, commits when the function returns nil and rolls back when it
returns an error or panics. The settings end with the transaction, so a pooled connection never keeps the identity of a
previous request. `users.SetUser(ctx, tx, userID)` acts as the user for the rest of a transaction already begun.
`p9s.AsRole(role)` takes another role of the config, and `p9s.Set(name, value)` sets another setting.

## pgx

```go
import "github.com/crubier/p9s/packages/go/p9spgx"

err := p9spgx.AsUser(ctx, pool, users, userID, func(tx pgx.Tx) error {
	_, err := tx.Exec(ctx, "update documents set title = $1 where id = $2", title, id)
	return err
})
```

## GORM

```go
import "github.com/crubier/p9s/packages/go/p9sgorm"

err := p9sgorm.AsUser(ctx, db, users, userID, func(tx *gorm.DB) error {
	return tx.Order("id").Find(&documents).Error
})
```

## HTTP

`p9s.Middleware(userIDOf)` puts the id of the user of each request in its context, and `p9s.UserID(r.Context())` reads
it back.

## Refused writes

Postgres refuses a row the policies do not let through, a statement the role has no privilege for, and a share of bits
the user does not have, with `insufficient_privilege`. `p9s.IsRefused(err)` tells, through any wrapping, for pgx and
lib/pq. An update or a delete of rows the user reads but cannot change touches no row: check `RowsAffected`.

Example: [`net/http` and GORM, with goose](https://github.com/crubier/p9s/tree/main/examples/integrations/gorm).
