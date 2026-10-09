package p9s_test

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"strings"
	"sync"
	"testing"

	p9s "github.com/crubier/p9s/packages/go"
	"github.com/crubier/p9s/packages/go/p9sgorm"
	"github.com/crubier/p9s/packages/go/p9spgx"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var prepare sync.Once

// A table the user role reads but cannot write, and the roles of the config
func database(t *testing.T) string {
	t.Helper()
	url := os.Getenv("P9S_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("P9S_TEST_DATABASE_URL is not set")
	}
	prepare.Do(func() {
		db, err := sql.Open("pgx", url)
		if err != nil {
			t.Fatal(err)
		}
		defer db.Close()
		_, err = db.Exec(`
			do $$
			begin
			  if not exists (select from pg_roles where rolname = 'p9s_go_user') then create role p9s_go_user nologin; end if;
			  if not exists (select from pg_roles where rolname = 'p9s_go_writer') then create role p9s_go_writer nologin; end if;
			end
			$$;
			grant p9s_go_user, p9s_go_writer to current_user;
			drop table if exists p9s_go_note;
			create table p9s_go_note (id serial primary key, body text not null);
			grant select on p9s_go_note to p9s_go_user;
			grant select, insert on p9s_go_note to p9s_go_writer;
			grant usage on sequence p9s_go_note_id_seq to p9s_go_writer;`)
		if err != nil {
			t.Fatal(err)
		}
	})
	return url
}

const who = "select current_user::text, coalesce(current_setting('app.user_id', true), '')"

func TestDatabaseSQL(t *testing.T) {
	db, err := sql.Open("pgx", database(t))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	users, ctx := identity(t), context.Background()

	var role, user string
	err = users.AsUser(ctx, db, 7, func(tx *sql.Tx) error { return tx.QueryRow(who).Scan(&role, &user) })
	equal(t, []any{err, role, user}, []any{nil, "p9s_go_user", "7"})

	err = users.AsUser(ctx, db, 7, func(tx *sql.Tx) error {
		_, err := tx.Exec("insert into p9s_go_note (body) values ('refused')")
		return err
	})
	equal(t, p9s.IsRefused(err), true)

	err = users.AsUser(ctx, db, 7, func(tx *sql.Tx) error {
		_, err := tx.Exec("insert into p9s_go_note (body) values ('read only')")
		return err
	}, p9s.AsRole("p9s_go_writer"), p9s.ReadOnly(true))
	if err == nil || !strings.Contains(err.Error(), "read-only transaction") {
		t.Fatalf("got %v, want a read-only transaction error", err)
	}

	rolledBack := errors.New("rolled back")
	err = users.AsUser(ctx, db, 7, func(tx *sql.Tx) error { return rolledBack })
	equal(t, errors.Is(err, rolledBack), true)
	if err := db.QueryRow(who).Scan(&role, &user); err != nil {
		t.Fatal(err)
	}
	if role == "p9s_go_user" || user != "" {
		t.Fatalf("the connection kept %s %q", role, user)
	}
}

func TestPgx(t *testing.T) {
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, database(t))
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	users := identity(t)

	var role, user string
	err = p9spgx.AsUser(ctx, pool, users, 7, func(tx pgx.Tx) error { return tx.QueryRow(ctx, who).Scan(&role, &user) }, p9s.ReadOnly(true))
	equal(t, []any{err, role, user}, []any{nil, "p9s_go_user", "7"})

	err = p9spgx.AsUser(ctx, pool, users, 7, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, "insert into p9s_go_note (body) values ('refused')")
		return err
	})
	equal(t, p9s.IsRefused(err), true)

	var id int
	err = p9spgx.AsUser(ctx, pool, users, 7, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, "insert into p9s_go_note (body) values ('written') returning id").Scan(&id)
	}, p9s.AsRole("p9s_go_writer"))
	equal(t, err, nil)
}

func TestGorm(t *testing.T) {
	db, err := gorm.Open(postgres.Open(database(t)), &gorm.Config{Logger: logger.Discard})
	if err != nil {
		t.Fatal(err)
	}
	users, ctx := identity(t), context.Background()

	var row struct{ Role, User string }
	err = p9sgorm.AsUser(ctx, db, users, 7, func(tx *gorm.DB) error {
		return tx.Raw("select current_user::text as role, current_setting('app.user_id', true) as user").Scan(&row).Error
	}, p9s.ReadOnly(true))
	equal(t, []any{err, row.Role, row.User}, []any{nil, "p9s_go_user", "7"})

	type note struct {
		ID   int
		Body string
	}
	err = p9sgorm.AsUser(ctx, db, users, 7, func(tx *gorm.DB) error {
		return tx.Table("p9s_go_note").Create(&note{Body: "refused"}).Error
	})
	equal(t, p9s.IsRefused(err), true)

	written := note{Body: "written"}
	err = p9sgorm.AsUser(ctx, db, users, 7, func(tx *gorm.DB) error {
		return tx.Table("p9s_go_note").Create(&written).Error
	}, p9s.AsRole("p9s_go_writer"))
	equal(t, err, nil)
	if written.ID == 0 {
		t.Fatal("insert returning gave no id")
	}
}
