// Package p9s acts as a user of p9s, permissions of trees in Postgres with row level security: every query of a
// transaction runs as the role of the users of the config, with the id of the user in the setting its current user
// function reads, so the policies of p9s decide what it reads and writes.
//
// Both are set with set_config(..., true), so that they end with the transaction, and a pooled connection never keeps
// the identity of a previous request.
package p9s

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
)

// Identity is the role and the setting of the config, like createIdentity of @p9s/postgres.
type Identity struct {
	// Role is the role transactions take, the first of engine.users
	Role string
	// Setting is the setting the current user function reads
	Setting string
	// Claim is the claim of the setting, when it holds JSON claims, like request.jwt.claims of PostgREST
	Claim string
	roles map[string]bool
}

type config struct {
	Engine struct {
		Users          []string `json:"users"`
		GraphWriters   []string `json:"graphWriters"`
		Authentication struct {
			Setting string `json:"setting"`
			Claim   string `json:"claim"`
		} `json:"authentication"`
	} `json:"engine"`
}

// Option changes the setting or the claim of an identity.
type Option func(*options)

type options struct {
	setting, claim *string
}

// WithSetting reads the user from another setting than the one of the config, with no claim.
func WithSetting(setting string) Option { return func(o *options) { o.setting = &setting } }

// WithClaim sets the user as this claim of JSON claims in the setting.
func WithClaim(claim string) Option { return func(o *options) { o.claim = &claim } }

// New reads the identity from the JSON of p9s.config.json.
func New(configJSON []byte, opts ...Option) (*Identity, error) {
	var c config
	if err := json.Unmarshal(configJSON, &c); err != nil {
		return nil, fmt.Errorf("p9s: reading the config: %w", err)
	}
	var o options
	for _, opt := range opts {
		opt(&o)
	}
	if len(c.Engine.Users) == 0 {
		return nil, errors.New("p9s: engine.users is empty")
	}
	identity := &Identity{Role: c.Engine.Users[0], Setting: c.Engine.Authentication.Setting, roles: map[string]bool{}}
	if o.setting != nil {
		identity.Setting = *o.setting
	} else {
		identity.Claim = c.Engine.Authentication.Claim
	}
	if o.claim != nil {
		identity.Claim = *o.claim
	}
	if identity.Setting == "" {
		return nil, errors.New(`p9s: set engine.authentication.setting, like "app.user_id", for the migration to read the current user from it, or pass the setting the current user function reads`)
	}
	for _, role := range append(c.Engine.Users, c.Engine.GraphWriters...) {
		identity.roles[role] = true
	}
	return identity, nil
}

// FromFile reads the identity from p9s.config.json.
func FromFile(path string, opts ...Option) (*Identity, error) {
	configJSON, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("p9s: %w", err)
	}
	return New(configJSON, opts...)
}

// Must panics when an identity cannot be read, for package level variables.
func Must(identity *Identity, err error) *Identity {
	if err != nil {
		panic(err)
	}
	return identity
}

// TxOption changes a transaction of a user.
type TxOption func(*TxOptions)

// TxOptions are the options of a transaction of a user.
type TxOptions struct {
	ReadOnly bool
	Role     string
	Settings [][2]string
}

// ReadOnly makes the transaction read only when readOnly is true.
func ReadOnly(readOnly bool) TxOption { return func(o *TxOptions) { o.ReadOnly = readOnly } }

// AsRole takes another role of engine.users or engine.graphWriters.
func AsRole(role string) TxOption { return func(o *TxOptions) { o.Role = role } }

// Set sets another setting for the transaction, like app.tenant_id.
func Set(name, value string) TxOption {
	return func(o *TxOptions) { o.Settings = append(o.Settings, [2]string{name, value}) }
}

// Options applies options.
func Options(opts ...TxOption) TxOptions {
	var o TxOptions
	for _, opt := range opts {
		opt(&o)
	}
	return o
}

// Value is the value of the setting for a user, "" for no user.
func (i *Identity) Value(userID any) string {
	if userID == nil {
		return ""
	}
	text := fmt.Sprint(userID)
	if i.Claim == "" {
		return text
	}
	claims, _ := json.Marshal(map[string]string{i.Claim: text})
	return string(claims)
}

// Settings are the settings of a transaction of the user, the role first. No user reads as no one.
func (i *Identity) Settings(userID any, opts ...TxOption) ([][2]string, error) {
	o := Options(opts...)
	role := i.Role
	if o.Role != "" {
		role = o.Role
	}
	if !i.roles[role] {
		return nil, fmt.Errorf("p9s: %s is not a role of engine.users or engine.graphWriters", role)
	}
	return append([][2]string{{"role", role}, {i.Setting, i.Value(userID)}}, o.Settings...), nil
}

// Statement is the statement to run first in a transaction, with positional parameters:
// select set_config($1, $2, true), ...
func (i *Identity) Statement(userID any, opts ...TxOption) (string, []any, error) {
	settings, err := i.Settings(userID, opts...)
	if err != nil {
		return "", nil, err
	}
	calls := make([]string, len(settings))
	args := make([]any, 0, 2*len(settings))
	for index, setting := range settings {
		calls[index] = fmt.Sprintf("set_config($%d, $%d, true)", 2*index+1, 2*index+2)
		args = append(args, setting[0], setting[1])
	}
	return "select " + strings.Join(calls, ", "), args, nil
}

// IsRefused tells whether an error is Postgres refusing a statement to the user, with insufficient_privilege (42501): a
// row the policies do not let through, a statement the role has no privilege for, or a share of bits the user does not
// have. Errors of pgx and lib/pq have a SQLState method, through any wrapping.
func IsRefused(err error) bool {
	var postgres interface{ SQLState() string }
	return errors.As(err, &postgres) && postgres.SQLState() == "42501"
}
