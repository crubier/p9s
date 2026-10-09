// Package p9spgx acts as a user of p9s with pgx: AsUser runs a function in a transaction of a pool or a connection as
// the user.
package p9spgx

import (
	"context"

	p9s "github.com/crubier/p9s/packages/go"
	"github.com/jackc/pgx/v5"
)

// Beginner is a *pgxpool.Pool, a *pgx.Conn, or a transaction, for a nested one.
type Beginner interface {
	BeginTx(ctx context.Context, options pgx.TxOptions) (pgx.Tx, error)
}

// SetUser acts as the user for the rest of a transaction already begun.
func SetUser(ctx context.Context, tx pgx.Tx, users *p9s.Identity, userID any, opts ...p9s.TxOption) error {
	if p9s.Options(opts...).ReadOnly {
		if _, err := tx.Exec(ctx, "set transaction read only"); err != nil {
			return err
		}
	}
	query, args, err := users.Statement(userID, opts...)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, query, args...)
	return err
}

// AsUser runs fn in a transaction as the user: every query of tx goes through the policies, it commits when fn returns
// nil, and rolls back when it returns an error or panics.
func AsUser(ctx context.Context, db Beginner, users *p9s.Identity, userID any, fn func(tx pgx.Tx) error, opts ...p9s.TxOption) error {
	mode := pgx.ReadWrite
	if p9s.Options(opts...).ReadOnly {
		mode = pgx.ReadOnly
	}
	return pgx.BeginTxFunc(ctx, db, pgx.TxOptions{AccessMode: mode}, func(tx pgx.Tx) error {
		if err := SetUser(ctx, tx, users, userID, opts...); err != nil {
			return err
		}
		return fn(tx)
	})
}
