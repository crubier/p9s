---
sidebar_position: 9
---

# Go

The [`p9s`](https://github.com/crubier/p9s/tree/main/packages/go) module runs a function in a transaction as a user: with `database/sql` in the root package, with pgx in `p9spgx`, and with GORM in `p9sgorm`.

Guide: [Go](../integrations/go). Example: [`net/http` and GORM](https://github.com/crubier/p9s/tree/main/examples/integrations/gorm).

## Install

```bash
go get github.com/crubier/p9s/packages/go
```

Go 1.25 or later. The module requires pgx 5 and GORM, for its subpackages.

## p9s

```go
import p9s "github.com/crubier/p9s/packages/go"

var users = p9s.Must(p9s.FromFile("p9s.config.json"))
```

### New, FromFile and Must

`New(configJSON []byte, opts ...Option) (*Identity, error)` reads the role and the setting from `engine` of the JSON of a config, like [`createIdentity`](./postgres#createidentity), and `FromFile(path string, opts ...Option)` reads `p9s.config.json`. They return an error when the JSON does not parse, when `engine.users` is empty, or when there is no setting. `Must(identity, err)` panics on the error, for package level variables.

| Option | |
| --- | --- |
| `WithSetting(setting string)` | Reads the user from another setting than the one of the config, with no claim |
| `WithClaim(claim string)` | Sets the user as this claim of JSON claims in the setting |

### Identity

| Member | |
| --- | --- |
| `Role`, `Setting`, `Claim` | The role transactions take, the first of `engine.users`, the setting the current user function reads, and its claim, or `""` |
| `Value(userID any) string` | The value of the setting for a user: `fmt.Sprint` of the id, JSON claims, or `""` for `nil` |
| `Settings(userID any, opts ...TxOption) ([][2]string, error)` | The settings of a transaction of the user, the role first |
| `Statement(userID any, opts ...TxOption) (string, []any, error)` | `select set_config($1, $2, true), ...` and its arguments |
| `SetUser(ctx, tx Execer, userID any, opts ...TxOption) error` | Acts as the user for the rest of a transaction already begun, of `database/sql` or anything with `ExecContext` |
| `AsUser(ctx, db *sql.DB, userID any, fn func(tx *sql.Tx) error, opts ...TxOption) error` | Runs `fn` in a transaction as the user |

`userID` is any id, or `nil` for no one. `Settings`, `Statement` and the others return an error for a role that is not one of `engine.users` or `engine.graphWriters`.

### Transaction options

| Option | |
| --- | --- |
| `ReadOnly(readOnly bool)` | A read only transaction when `readOnly` is true, like `p9s.ReadOnly(r.Method == http.MethodGet)` |
| `AsRole(role string)` | Another role of `engine.users` or `engine.graphWriters` |
| `Set(name, value string)` | Another setting of the transaction, like `app.tenant_id` |

`Options(opts...)` returns the `TxOptions` they make, for code that begins its own transactions.

### AsUser

```go
err := users.AsUser(ctx, db, userID, func(tx *sql.Tx) error {
	_, err := tx.ExecContext(ctx, "update documents set title = $1 where id = $2", title, id)
	return err
})
if p9s.IsRefused(err) {
	http.Error(w, "forbidden", http.StatusForbidden)
}
```

`AsUser` begins a transaction of `db`, read only with `ReadOnly(true)`, runs the statement of the user, then `fn`. Every query of `tx` goes through the policies. It commits when `fn` returns nil, rolls back and returns the error when it returns one, and rolls back and panics again when it panics.

### IsRefused

`IsRefused(err error) bool` tells whether an error is Postgres refusing a statement to the user, with `insufficient_privilege`, `42501`: a row the policies do not let through, a statement the role has no privilege for, or a share of bits the user does not have. It reads `SQLState()` of the errors of pgx and lib/pq, through any wrapping, with `errors.As`.

### Middleware and UserID

```go
handler := p9s.Middleware(func(r *http.Request) any { return sessionUserID(r) })(mux)
// in a handler
users.AsUser(r.Context(), db, p9s.UserID(r.Context()), fn)
```

`Middleware(userIDOf func(*http.Request) any)` puts the id of the user of each request in its context, and `UserID(ctx) any` reads it, or nil. `WithUserID(ctx, userID)` returns a context that carries an id, for code outside of HTTP.

## p9spgx

```go
import "github.com/crubier/p9s/packages/go/p9spgx"

err := p9spgx.AsUser(ctx, pool, users, userID, func(tx pgx.Tx) error {
	rows, err := tx.Query(ctx, "select title from documents")
	// ...
	return err
}, p9s.ReadOnly(true))
```

`AsUser(ctx, db Beginner, users *p9s.Identity, userID any, fn func(tx pgx.Tx) error, opts ...p9s.TxOption) error` runs `fn` in a transaction as the user, with `pgx.BeginTxFunc`: it commits when `fn` returns nil, and rolls back otherwise. `Beginner` is a `*pgxpool.Pool`, a `*pgx.Conn`, or a transaction, for a nested one. `SetUser(ctx, tx pgx.Tx, users, userID, opts...)` acts as the user for the rest of a transaction already begun.

## p9sgorm

```go
import "github.com/crubier/p9s/packages/go/p9sgorm"

err := p9sgorm.AsUser(r.Context(), db, users, userID, func(tx *gorm.DB) error {
	return tx.Create(&document).Error
})
```

`AsUser(ctx, db *gorm.DB, users *p9s.Identity, userID any, fn func(tx *gorm.DB) error, opts ...p9s.TxOption) error` runs `fn` in a GORM transaction as the user, `db.Transaction`: it commits when `fn` returns nil, and rolls back when it returns an error or panics. `SetUser(tx *gorm.DB, users, userID, opts...)` acts as the user for the rest of a transaction already begun.

A write the policies refuse returns the error of pgx, which `p9s.IsRefused` tells. An update or a delete of a row the user reads but cannot change is no error: `RowsAffected` is 0.
