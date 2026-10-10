// Package p9sgorm acts as a user of p9s with GORM: AsUser runs a function in a GORM transaction as the user.
package p9sgorm

import (
	"context"
	"database/sql"
	"regexp"

	p9s "github.com/crubier/p9s/packages/go"
	"gorm.io/gorm"
)

var placeholder = regexp.MustCompile(`\$\d+`)

// SetUser acts as the user for the rest of a transaction already begun.
func SetUser(tx *gorm.DB, users *p9s.Identity, userID any, opts ...p9s.TxOption) error {
	query, args, err := users.Statement(userID, opts...)
	if err != nil {
		return err
	}
	return tx.Exec(placeholder.ReplaceAllString(query, "?"), args...).Error
}

// AsUser runs fn in a transaction of db as the user: every query of tx goes through the policies, it commits when fn
// returns nil, and rolls back when it returns an error or panics.
func AsUser(ctx context.Context, db *gorm.DB, users *p9s.Identity, userID any, fn func(tx *gorm.DB) error, opts ...p9s.TxOption) error {
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := SetUser(tx, users, userID, opts...); err != nil {
			return err
		}
		return fn(tx)
	}, &sql.TxOptions{ReadOnly: p9s.Options(opts...).ReadOnly})
}
