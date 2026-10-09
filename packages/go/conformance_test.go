package p9s_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"testing"

	p9s "github.com/crubier/p9s/packages/go"
	"github.com/crubier/p9s/packages/go/p9sgorm"
	"github.com/crubier/p9s/packages/go/p9spgx"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// The conformance suite of p9s, see packages/conformance
type conformanceCases struct {
	Config  string
	Role    string
	Setting string
	Read    string
	Reads   []struct {
		User *int
		IDs  []int
	}
	Insert struct {
		User     int
		SQL      string
		FolderID int
	}
	Refused struct {
		User int
		SQL  string
	}
	Who     string
	WhoUser int
}

// A query takes a function to call for each row, then the destinations of its columns. asUser runs queries in a
// transaction as a user, query on the pool, outside of any transaction.
type conformanceClient struct {
	asUser func(user any, readOnly bool, fn func(query func(sql string, row ...any) error) error) error
	query  func(sql string, row ...any) error
}

func conformance(t *testing.T) (string, conformanceCases, *p9s.Identity) {
	t.Helper()
	url := os.Getenv("P9S_CONFORMANCE_DATABASE_URL")
	if url == "" {
		t.Skip("P9S_CONFORMANCE_DATABASE_URL is not set")
	}
	suite := filepath.Join("..", "conformance")
	content, err := os.ReadFile(filepath.Join(suite, "cases.json"))
	if err != nil {
		t.Fatal(err)
	}
	var cases conformanceCases
	if err := json.Unmarshal(content, &cases); err != nil {
		t.Fatal(err)
	}
	users, err := p9s.FromFile(filepath.Join(suite, cases.Config))
	if err != nil {
		t.Fatal(err)
	}
	equal(t, []string{users.Role, users.Setting}, []string{cases.Role, cases.Setting})
	return url, cases, users
}

func userOf(user *int) any {
	if user == nil {
		return nil
	}
	return *user
}

func runConformance(t *testing.T, cases conformanceCases, client conformanceClient) {
	t.Helper()
	for range 2 {
		for _, read := range cases.Reads {
			ids := []int{}
			err := client.asUser(userOf(read.User), true, func(query func(string, ...any) error) error {
				var id int
				return query(cases.Read, func() error { ids = append(ids, id); return nil }, &id)
			})
			equal(t, []any{err, ids}, []any{nil, read.IDs})
		}
	}

	var id, folderID int
	err := client.asUser(cases.Insert.User, false, func(query func(string, ...any) error) error {
		return query(cases.Insert.SQL, func() error { return nil }, &id, &folderID)
	})
	equal(t, []any{err, folderID, id > 3}, []any{nil, cases.Insert.FolderID, true})

	err = client.asUser(cases.Refused.User, false, func(query func(string, ...any) error) error {
		return query(cases.Refused.SQL, func() error { return nil })
	})
	equal(t, p9s.IsRefused(err), true)

	rolledBack := errors.New("rolled back")
	var role, user string
	err = client.asUser(cases.WhoUser, false, func(query func(string, ...any) error) error {
		if err := query(cases.Who, func() error { return nil }, &role, &user); err != nil {
			return err
		}
		return rolledBack
	})
	equal(t, []any{errors.Is(err, rolledBack), role, user}, []any{true, cases.Role, strconv.Itoa(cases.WhoUser)})
	if err := client.query(cases.Who, func() error { return nil }, &role, &user); err != nil {
		t.Fatal(err)
	}
	if role == cases.Role || user != "" {
		t.Fatalf("the connection kept %s %q", role, user)
	}
}

// Calls each with the row scanned into the destinations, for each row
func scanRows(next func() bool, scan func(...any) error, err func() error, args []any) error {
	each, destinations := args[0].(func() error), args[1:]
	for next() {
		if len(destinations) > 0 {
			if err := scan(destinations...); err != nil {
				return err
			}
		}
		if err := each(); err != nil {
			return err
		}
	}
	return err()
}

func TestConformanceSQL(t *testing.T) {
	url, cases, users := conformance(t)
	db, err := sql.Open("pgx", url)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	ctx := context.Background()
	queryOn := func(q interface {
		QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	}) func(string, ...any) error {
		return func(statement string, args ...any) error {
			rows, err := q.QueryContext(ctx, statement)
			if err != nil {
				return err
			}
			defer rows.Close()
			return scanRows(rows.Next, rows.Scan, rows.Err, args)
		}
	}
	runConformance(t, cases, conformanceClient{
		asUser: func(user any, readOnly bool, fn func(func(string, ...any) error) error) error {
			return users.AsUser(ctx, db, user, func(tx *sql.Tx) error { return fn(queryOn(tx)) }, p9s.ReadOnly(readOnly))
		},
		query: queryOn(db),
	})
}

func TestConformancePgx(t *testing.T) {
	url, cases, users := conformance(t)
	ctx := context.Background()
	config, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	config.MaxConns = 1
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	queryOn := func(q interface {
		Query(context.Context, string, ...any) (pgx.Rows, error)
	}) func(string, ...any) error {
		return func(statement string, args ...any) error {
			rows, err := q.Query(ctx, statement)
			if err != nil {
				return err
			}
			defer rows.Close()
			return scanRows(rows.Next, rows.Scan, rows.Err, args)
		}
	}
	runConformance(t, cases, conformanceClient{
		asUser: func(user any, readOnly bool, fn func(func(string, ...any) error) error) error {
			return p9spgx.AsUser(ctx, pool, users, user, func(tx pgx.Tx) error { return fn(queryOn(tx)) }, p9s.ReadOnly(readOnly))
		},
		query: queryOn(pool),
	})
}

func TestConformanceGorm(t *testing.T) {
	url, cases, users := conformance(t)
	db, err := gorm.Open(postgres.Open(url), &gorm.Config{Logger: logger.Discard})
	if err != nil {
		t.Fatal(err)
	}
	pool, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	pool.SetMaxOpenConns(1)
	queryOn := func(tx *gorm.DB) func(string, ...any) error {
		return func(statement string, args ...any) error {
			rows, err := tx.Raw(statement).Rows()
			if err != nil {
				return err
			}
			defer rows.Close()
			return scanRows(rows.Next, rows.Scan, rows.Err, args)
		}
	}
	ctx := context.Background()
	runConformance(t, cases, conformanceClient{
		asUser: func(user any, readOnly bool, fn func(func(string, ...any) error) error) error {
			return p9sgorm.AsUser(ctx, db, users, user, func(tx *gorm.DB) error { return fn(queryOn(tx)) }, p9s.ReadOnly(readOnly))
		},
		query: queryOn(db),
	})
}
