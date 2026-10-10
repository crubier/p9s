# Adopting p9s in a Rust app

A Rust API on [axum](https://github.com/tokio-rs/axum) and [sqlx](https://github.com/launchbadge/sqlx), for projects
and documents, as the [adoption tests](../adoption) describe it: teams get access to projects, users to documents, and
the app checks every request in its code.

## Before

[`before/`](./before) is the app as it was. [`migrations`](./before/migrations) creates the tables, and
`cargo run -- migrate` runs them with `sqlx::migrate!`. [`src/permissions.rs`](./before/src/permissions.rs) works out
the access of a user from the tables `team_members`, `project_shares` and `document_shares`, and every handler of
[`src/main.rs`](./before/src/main.rs) asks it first.

## The migration

[`p9s.config.json`](./p9s.config.json) describes the tables: users and teams are roles, projects and documents are
resources, a document is in its project. Its `links` name the tables where the app keeps memberships and shares, and
which bits each access gives. With `authentication.key`, the app tells p9s the id of the user in its `users` table, and
with `grantPrivileges`, the migration grants `app_user` what its permissions name.

After `cargo run -- migrate`, in the folder of the app, with `DATABASE_URL` set:

```bash
npx @p9s/cli postgres migrate --config p9s.config.json
```

It runs in one transaction, creates the role `app_user`, brings the rows of the link tables into the graph, and from
then on keeps the graph in step with them. The queries name their columns, so the `role_id` and `resource_id` columns
p9s adds change nothing.

To run p9s with the other migrations of the app instead, as a migration of sqlx:

```bash
npx @p9s/cli postgres generate --config p9s.config.json --format sqlx
```

Then `cargo run -- migrate` runs it, as [`build.rs`](./before/build.rs) builds the app again when a migration is
added, and the adoption test checks that too.

## After

[`adopt.patch`](./adopt.patch) is what [`p9s adopt`](../../../packages/cli/src/adopt) writes: the
[`p9s`](../../../packages/rust) crate with its `axum` feature. [`after.patch`](./after.patch) is the rest, by hand: it
deletes `src/permissions.rs` and its checks, and makes `P9s`, the pool and the identity, the state of the router. The
middleware that finds the user puts it in the request as `CurrentUser`, and every handler takes a `UserTx`, a
transaction as that user, read only for `GET`:

```rust
async fn update_document(mut tx: UserTx, Path(id): Path<i64>, Json(changes): Json<Changes>) -> Answer {
    // ...
    let Some(document) = updated else { return forbidden() };
    tx.commit().await?;
    Ok(Json(document).into_response())
}
```

The policies decide what each query reads and writes. A write they refuse fails with `insufficient_privilege`, which
the error of the app answers with 403 when `p9s::is_refused` says so, and the transaction rolls back when dropped. An
update or a delete of a document the user reads but cannot change touches no row, and gets 403 too.

In an app, `cargo add p9s --features axum`. The example takes the crate of this repository, with a path in
`Cargo.toml`.

## The test

[`adoption.test.ts`](./adoption.test.ts) builds and runs the app before, the migration, and the app after on a real
Postgres, with Rust 1.88 or later, and checks that every user gets the same answers, see
[the adoption tests](../adoption):

```bash
P9S_ADOPTION_DATABASE_URL=postgresql://postgres@localhost:5432/postgres bun test examples/integrations/axum
```
