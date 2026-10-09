# Adopting p9s in a Go app

A Go API on `net/http` and [GORM](https://gorm.io), with [goose](https://github.com/pressly/goose) migrations, for
projects and documents, as the [adoption tests](../adoption) describe it: teams get access to projects, users to
documents, and the app checks every request in its code.

## Before

[`before/`](./before) is the app as it was. [`migrations`](./before/migrations) creates the tables, and
`./documents migrate` runs them with goose, from the binary. [`permissions.go`](./before/permissions.go) works out the
access of a user from the tables `team_members`, `project_shares` and `document_shares`, and every handler of
[`main.go`](./before/main.go) asks it first.

## The migration

[`p9s.config.json`](./p9s.config.json) describes the tables: users and teams are roles, projects and documents are
resources, a document is in its project. Its `links` name the tables where the app keeps memberships and shares, and
which bits each access gives. With `authentication.key`, the app tells p9s the id of the user in its `users` table, and
with `grantPrivileges`, the migration grants `app_user` what its permissions name.

After `./documents migrate`, in the folder of the app, with `DATABASE_URL` set:

```bash
npx @p9s/cli postgres migrate --config p9s.config.json
```

It runs in one transaction, creates the role `app_user`, brings the rows of the link tables into the graph, and from
then on keeps the graph in step with them. The structs do not change: GORM reads the columns its structs name, and
leaves the `role_id` and `resource_id` columns p9s adds to their defaults.

To run p9s with the other migrations of the app instead, as a migration of goose:

```bash
npx @p9s/cli postgres generate --config p9s.config.json --format goose
```

Then `./documents migrate` runs it, and the adoption test checks that too.

## After

[`after.patch`](./after.patch) adds [`p9s`](../../packages/go), deletes `permissions.go`, and runs each handler in a
GORM transaction as the user of its request, read only for `GET`:

```go
err = p9sgorm.AsUser(r.Context(), s.db, s.users, userID, func(tx *gorm.DB) (err error) {
	a, err = h(r, tx)
	return err
}, p9s.ReadOnly(r.Method == http.MethodGet))
if p9s.IsRefused(err) {
	a, err = forbidden, nil
}
```

The policies decide what each query reads and writes. A write they refuse fails with `insufficient_privilege`, the
transaction rolls back, and the app answers 403. An update or a delete of a document the user reads but cannot change
touches no row, and gets 403 too.

In an app, `go get github.com/crubier/p9s/packages/go`. The example takes the module of this repository, with a
`replace` in `go.mod`.

## The test

[`adoption.test.ts`](./adoption.test.ts) builds and runs the app before, the migration, and the app after on a real
Postgres, and checks that every user gets the same answers, see [the adoption tests](../adoption):

```bash
P9S_ADOPTION_DATABASE_URL=postgresql://postgres@localhost:5432/postgres bun test examples/gorm
```
