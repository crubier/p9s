---
sidebar_position: 10
---

# Rust

The [`p9s`](https://github.com/crubier/p9s/tree/main/packages/rust) crate begins a sqlx transaction as a user, and with its `axum` feature, extracts a transaction as the user of the request.

Guide: [Rust](../integrations/rust). Example: [axum and sqlx](https://github.com/crubier/p9s/tree/main/examples/integrations/axum).

## Install

```bash
cargo add p9s --features axum
```

Rust 1.80 or later.

| Feature | Default | |
| --- | --- | --- |
| `sqlx` | on | `as_user`, `set_user` and `is_refused`, on sqlx 0.8 with Postgres |
| `axum` | off | The [`p9s::axum`](#p9saxum) extractor, on axum 0.8. It turns `sqlx` on |

## Identity

```rust
let users = p9s::Identity::from_file("p9s.config.json")?;
```

`Identity::new(config: &serde_json::Value)`, `Identity::from_json(json: &str)` and `Identity::from_file(path)` read the role and the setting from `engine` of a config, like [`createIdentity`](./postgres#createidentity). They return `p9s::Error`: `Io` when the file cannot be read, `Json` when it does not parse, and `Config` when `engine.users` is empty or there is no setting.

| Member | |
| --- | --- |
| `role`, `setting`, `claim` | The role transactions take, the first of `engine.users`, the setting the current user function reads, and its claim, an `Option<String>` |
| `with_setting(setting)` | Reads the user from another setting than the one of the config, with no claim |
| `with_claim(claim)` | Sets the user as this claim of JSON claims in the setting |
| `value(&UserId) -> String` | The value of the setting for a user: the id, JSON claims, or `""` for no user |
| `settings(user_id, &TxOptions) -> Result<Vec<(String, String)>, Error>` | The settings of a transaction of the user, the role first, with `transaction_read_only` for `read_only` |
| `statement(user_id, &TxOptions) -> Result<(String, Vec<String>), Error>` | `select set_config($1, $2, true), ...` and its values |
| `as_user(&pool, user_id).await -> sqlx::Result<Transaction<'static, Postgres>>` | Begins a transaction of the pool as the user |
| `as_user_with(&pool, user_id, &TxOptions).await` | The same, with options |

`user_id` is anything `Into<UserId>`: the integers `i16` to `u64`, `String`, `&str`, and an `Option` of them, `None` for no one. `settings` and the others return `Error::Config` for a role that is not one of `engine.users` or `engine.graphWriters`.

## TxOptions

```rust
let options = p9s::TxOptions::default().read_only(true).set("app.tenant_id", "3");
let mut tx = users.as_user_with(&pool, 7, &options).await?;
```

| Builder | |
| --- | --- |
| `read_only(bool)` | Adds `transaction_read_only` to the settings, for a read only transaction |
| `role(role)` | Another role of `engine.users` or `engine.graphWriters` |
| `set(name, value)` | Another setting of the transaction |

## as_user

```rust
let mut tx = users.as_user(&pool, user_id).await?;
let titles: Vec<String> = sqlx::query_scalar("select title from documents").fetch_all(&mut *tx).await?;
tx.commit().await?;
```

`as_user` begins a transaction of the pool and runs the statement of the user. Every query of the transaction goes through the policies until it commits, or rolls back when dropped. A role the config does not name returns `sqlx::Error::Configuration`.

## set_user

`p9s::set_user(&mut connection, &identity, user_id, &options).await` acts as the user for the rest of a transaction already begun on a `PgConnection`.

## is_refused

```rust
if p9s::is_refused(&error) {
    return (StatusCode::FORBIDDEN, Json(json!({ "error": "forbidden" }))).into_response();
}
```

`is_refused(&sqlx::Error) -> bool` tells whether an error is Postgres refusing a statement to the user, with `insufficient_privilege`, `42501`: a row the policies do not let through, a statement the role has no privilege for, or a share of bits the user does not have.

## p9s::axum

```rust
use p9s::axum::{CurrentUser, P9s, UserTx};

#[derive(Clone, FromRef)]
struct AppState { p9s: P9s }

async fn authenticate(mut request: Request, next: Next) -> Response {
    let user_id: Option<i64> = user_of(&request);
    request.extensions_mut().insert(CurrentUser::from(user_id));
    next.run(request).await
}

async fn titles(mut tx: UserTx) -> Result<Json<Vec<String>>, AppError> {
    let titles = sqlx::query_scalar("select title from documents").fetch_all(&mut **tx).await?;
    tx.commit().await?;
    Ok(Json(titles))
}
```

| Type | |
| --- | --- |
| `P9s` | The pool and the identity, `P9s::new(pool, identity)`, which the state of the router gives with `FromRef` |
| `CurrentUser` | The user of a request, which its authentication puts in the extensions. A request without it reads as no one |
| `UserTx` | An extractor of a transaction as the user of the request, read only for `GET` and `HEAD`. It derefs to the `Transaction`. Commit it with `commit()`, or it rolls back when dropped |

A `UserTx` that cannot begin its transaction rejects the request with 500 and the error.
