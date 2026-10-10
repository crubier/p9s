# p9s for Rust

Act as a user of [p9s](https://github.com/crubier/p9s), permissions of trees in Postgres with row level security, from
sqlx and axum: every query of a transaction runs as the role of the users of the config, with the id of the user in the
setting its current user function reads, so the policies of p9s decide what it reads and writes.

```toml
[dependencies]
p9s = { version = "0.1", features = ["axum"] }
```

The role and the setting come from the config of p9s, as for `createIdentity` of `@p9s/postgres`:

```rust
let users = p9s::Identity::from_file("p9s.config.json")?;
```

## sqlx

```rust
let mut tx = users.as_user(&pool, user_id).await?;
let documents: Vec<Document> = sqlx::query_as("select id, title from documents").fetch_all(&mut *tx).await?;
tx.commit().await?;
```

`as_user` begins a transaction of the pool and acts as the user in it, until it commits, or rolls back when dropped.
The settings end with the transaction, so a pooled connection never keeps the identity of a previous request.
`as_user_with` takes `TxOptions`: `read_only`, another `role` of the config, and other settings. `p9s::set_user` acts as
the user for the rest of a transaction already begun.

## axum

With the `axum` feature, `UserTx` extracts a transaction as the user of the request, read only for `GET`. The
authentication of the app puts the `CurrentUser` in the extensions of the request, and the state gives `P9s`, the pool
and the identity:

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

Postgres refuses a row the policies do not let through, a statement the role has no privilege for, and a share of bits
the user does not have, with `insufficient_privilege`. `p9s::is_refused(&error)` tells. An update or a delete of rows
the user reads but cannot change touches no row: check `rows_affected`, or `returning`.

Example: [axum and sqlx](https://github.com/crubier/p9s/tree/main/examples/integrations/axum).
