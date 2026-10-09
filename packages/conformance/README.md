# Conformance suite

Every package of p9s that acts as a user, in any language, passes the same suite, on the same database:

| Package | Clients |
| --- | --- |
| [`@p9s/postgres`](../postgres) | `createIdentity(config).run`, on node-postgres |
| [`p9s` for Python](../python) | SQLAlchemy, sync and async, and Django |
| [the `p9s` gem](../ruby) | Active Record |
| [the Go module](../go) | `database/sql`, pgx and GORM |
| [the Rust crate](../rust) | sqlx |
| [the Elixir package](../elixir) | Ecto |
| [`p9s/laravel`](../php) | Laravel and Eloquent |

## The database

[`schema.sql`](./schema.sql) creates the tables of a small app and its rows: members are roles, folders and notes are
resources, a note is in its folder, and `folder_shares` give members access to folders. [`p9s.config.json`](./p9s.config.json)
describes them, and [`prepare.ts`](./prepare.ts) creates the database again and runs the p9s migration on it:

```bash
P9S_CONFORMANCE_DATABASE_URL=postgresql://postgres@localhost:5432/p9s_conformance bun packages/conformance/prepare.ts
```

## The cases

Each package reads [`cases.json`](./cases.json), and with `P9S_CONFORMANCE_DATABASE_URL` set, its tests check, with a
pool of one connection:

1. The identity of `p9s.config.json` has the `role` and the `setting` of the cases: the package reads them from the
   config of p9s, rather than repeating them.
2. Each user of `reads` reads the `ids` of `read`, in a read only transaction as that user, the users in turns, twice:
   reads go through the policies, and two users of one pool never see each other's rows. No user reads nothing.
3. `insert` runs as its user, and its `returning` gives the row it inserted.
4. `refused` runs as its user, and fails with an error that the `is_refused` of the package tells.
5. As `whoUser`, `who` gives the role and the id of the user. Then the transaction rolls back, as the code in it
   raised, and on the same connection `who` gives neither the role nor the user any more.

Without `P9S_CONFORMANCE_DATABASE_URL`, the tests of the suite are skipped. CI prepares the database in the job of each
package, and runs them.
