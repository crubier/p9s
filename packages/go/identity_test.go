package p9s_test

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	p9s "github.com/crubier/p9s/packages/go"
)

const config = `{
  "engine": {
    "users": ["p9s_go_user"],
    "graphWriters": ["p9s_go_writer"],
    "authentication": {"getCurrentUserId": "current_role_id", "setting": "app.user_id"}
  },
  "tables": []
}`

func identity(t *testing.T) *p9s.Identity {
	t.Helper()
	users, err := p9s.New([]byte(config))
	if err != nil {
		t.Fatal(err)
	}
	return users
}

func equal(t *testing.T, got, want any) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %#v, want %#v", got, want)
	}
}

func TestSettingsTakeTheFirstUserRoleAndTheSetting(t *testing.T) {
	users := identity(t)
	equal(t, users.Role, "p9s_go_user")
	settings, _ := users.Settings(7)
	equal(t, settings, [][2]string{{"role", "p9s_go_user"}, {"app.user_id", "7"}})
	settings, _ = users.Settings(nil)
	equal(t, settings, [][2]string{{"role", "p9s_go_user"}, {"app.user_id", ""}})
	settings, _ = users.Settings("alice", p9s.AsRole("p9s_go_writer"), p9s.Set("app.audit", "on"))
	equal(t, settings, [][2]string{{"role", "p9s_go_writer"}, {"app.user_id", "alice"}, {"app.audit", "on"}})
}

func TestTheStatementHasPositionalParameters(t *testing.T) {
	query, args, _ := identity(t).Statement(7)
	equal(t, query, "select set_config($1, $2, true), set_config($3, $4, true)")
	equal(t, args, []any{"role", "p9s_go_user", "app.user_id", "7"})
}

func TestAClaimSetsJSONClaims(t *testing.T) {
	claims := `{"engine": {"users": ["authenticated"], "authentication": {"setting": "request.jwt.claims", "claim": "sub"}}}`
	users := p9s.Must(p9s.New([]byte(claims)))
	settings, _ := users.Settings(7)
	equal(t, settings[1], [2]string{"request.jwt.claims", `{"sub":"7"}`})
	settings, _ = p9s.Must(p9s.New([]byte(claims), p9s.WithSetting("app.user_id"))).Settings(7)
	equal(t, settings[1], [2]string{"app.user_id", "7"})
}

func TestFromFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "p9s.config.json")
	if err := os.WriteFile(path, []byte(config), 0o600); err != nil {
		t.Fatal(err)
	}
	equal(t, p9s.Must(p9s.FromFile(path)).Setting, "app.user_id")
}

func TestRolesAndSettingsAreChecked(t *testing.T) {
	expectError := func(err error, part string) {
		t.Helper()
		if err == nil || !strings.Contains(err.Error(), part) {
			t.Fatalf("got %v, want an error with %q", err, part)
		}
	}
	_, err := identity(t).Settings(7, p9s.AsRole("postgres"))
	expectError(err, "not a role")
	_, err = p9s.New([]byte(`{"engine": {"authentication": {"setting": "s"}}}`))
	expectError(err, "engine.users is empty")
	_, err = p9s.New([]byte(`{"engine": {"users": ["app_user"]}}`))
	expectError(err, "engine.authentication.setting")
}

type postgresError string

func (e postgresError) Error() string    { return "postgres" }
func (e postgresError) SQLState() string { return string(e) }

func TestIsRefusedLooksThroughWrapping(t *testing.T) {
	equal(t, p9s.IsRefused(postgresError("42501")), true)
	equal(t, p9s.IsRefused(fmt.Errorf("wrapped: %w", postgresError("42501"))), true)
	equal(t, p9s.IsRefused(errors.Join(errors.New("other"), postgresError("42501"))), true)
	equal(t, p9s.IsRefused(fmt.Errorf("wrapped: %w", postgresError("23505"))), false)
	equal(t, p9s.IsRefused(errors.New("nope")), false)
	equal(t, p9s.IsRefused(nil), false)
}

func TestTheMiddlewarePutsTheUserInTheContext(t *testing.T) {
	var seen any
	handler := p9s.Middleware(func(r *http.Request) any { return r.Header.Get("x-user-id") })(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { seen = p9s.UserID(r.Context()) }),
	)
	request := httptest.NewRequest(http.MethodGet, "/", nil)
	request.Header.Set("x-user-id", "42")
	handler.ServeHTTP(httptest.NewRecorder(), request)
	equal(t, seen, "42")
}
