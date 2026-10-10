---
sidebar_position: 11
---

# Rust

The [`p9s`](https://github.com/crubier/p9s/tree/main/packages/rust) crate begins a sqlx transaction as a user, and with its `axum` feature, extracts a transaction as the user of the request. [`examples/axum`](https://github.com/crubier/p9s/tree/main/examples/axum) adopts p9s in an axum and sqlx app with it.

## p9s adopt

```bash
npx @p9s/cli adopt
cargo build
```

[`p9s adopt`](../packages/cli#adopt) adds the crate to `Cargo.toml`, with the `axum` feature in an axum app. The state of the router, the extractor of each handler and the answer to refused writes go through types of the app, so they are left to you, as in [the example](#the-example).

## Install

```bash
cargo add p9s --features axum
```

## Config

`Identity` reads the role and the setting from [the config](./adopting#the-config):

```rust
let users = p9s::Identity::from_file("p9s.config.json")?;
```

## Each request as its user

```rust
let mut tx = users.as_user(&pool, user_id).await?;
let documents: Vec<Document> = sqlx::query_as("select id, title from documents").fetch_all(&mut *tx).await?;
tx.commit().await?;
```

`as_user` begins a transaction of the pool and acts as the user in it, until it commits, or rolls back when dropped. `as_user_with` takes `TxOptions`: `read_only`, another `role` of the config, and other settings. `p9s::set_user` acts as the user for the rest of a transaction already begun.

With axum, `UserTx` extracts a transaction as the user of the request, read only for `GET`. The authentication of the app puts the `CurrentUser` in the extensions of the request, and the state gives `P9s`, the pool and the identity:

```rust
use p9s::axum::{CurrentUser, P9s, UserTx};

async fn authenticate(mut request: Request, next: Next) -> Response {
    request.extensions_mut().insert(CurrentUser::from(user_id));
    next.run(request).await
}

async fn documents(mut tx: UserTx) -> Result<Json<Vec<Document>>, Error> {
    let documents = sqlx::query_as("select id, title from documents").fetch_all(&mut **tx).await?;
    tx.commit().await?;
    Ok(Json(documents))
}

let app = Router::new()
    .route("/documents", get(documents))
    .layer(middleware::from_fn(authenticate))
    .with_state(P9s::new(pool, users));
```

## Refused writes

`p9s::is_refused(&error)` tells a write the policies refused, for the error type of the app to answer 403. An update or a delete of rows the user reads but cannot change touches no row: check `rows_affected`, or `returning`.

## The migration

After the migrations of the app:

```bash
npx @p9s/cli postgres migrate --config p9s.config.json
```

Or as a migration of sqlx, in `migrations`, which `sqlx migrate run` or `sqlx::migrate!` then runs:

```bash
npx @p9s/cli postgres generate --config p9s.config.json --format sqlx
```

`sqlx::migrate!` embeds the migrations when the app builds, so a `build.rs` tells Cargo to build again when one is added:

```rust
fn main() {
    println!("cargo:rerun-if-changed=migrations");
}
```

The queries name their columns, so the `role_id` and `resource_id` columns p9s adds change nothing.

## The example

[`before/`](https://github.com/crubier/p9s/tree/main/examples/axum/before) checks every handler with `src/permissions.rs`. [`adopt.patch`](https://github.com/crubier/p9s/blob/main/examples/axum/adopt.patch) is what `p9s adopt` writes: the crate. [`after.patch`](https://github.com/crubier/p9s/blob/main/examples/axum/after.patch) is the rest, by hand: it deletes `permissions.rs` and its checks, makes `P9s` the state of the router, and gives every handler a `UserTx`.
