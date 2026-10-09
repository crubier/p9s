package p9s

import (
	"context"
	"database/sql"
	"errors"
)

// Execer is a transaction of database/sql, or anything that runs a statement.
type Execer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

// SetUser acts as the user for the rest of a transaction already begun.
func (i *Identity) SetUser(ctx context.Context, tx Execer, userID any, opts ...TxOption) error {
	if Options(opts...).ReadOnly {
		if _, err := tx.ExecContext(ctx, "set transaction read only"); err != nil {
			return err
		}
	}
	query, args, err := i.Statement(userID, opts...)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, query, args...)
	return err
}

// AsUser runs fn in a transaction of db as the user: every query of tx goes through the policies, it commits when fn
// returns nil, and rolls back when it returns an error or panics.
func (i *Identity) AsUser(ctx context.Context, db *sql.DB, userID any, fn func(tx *sql.Tx) error, opts ...TxOption) (err error) {
	tx, err := db.BeginTx(ctx, &sql.TxOptions{ReadOnly: Options(opts...).ReadOnly})
	if err != nil {
		return err
	}
	defer func() {
		if recovered := recover(); recovered != nil {
			_ = tx.Rollback()
			panic(recovered)
		}
		if err != nil {
			err = errors.Join(err, ignoreDone(tx.Rollback()))
		}
	}()
	if err = i.SetUser(ctx, tx, userID, opts...); err != nil {
		return err
	}
	if err = fn(tx); err != nil {
		return err
	}
	return tx.Commit()
}

func ignoreDone(err error) error {
	if errors.Is(err, sql.ErrTxDone) {
		return nil
	}
	return err
}
