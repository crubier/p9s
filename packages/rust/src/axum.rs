//! An axum extractor of a transaction as the user of the request.
//!
//! The authentication of the app puts the [`CurrentUser`] in the extensions of the request, and the state gives
//! [`P9s`], the pool and the identity, with `FromRef`:
//!
//! ```no_run
//! use axum::{extract::{FromRef, Request}, middleware::Next, response::Response};
//! use p9s::axum::{CurrentUser, P9s, UserTx};
//!
//! #[derive(Clone, FromRef)]
//! struct AppState { p9s: P9s }
//!
//! async fn authenticate(mut request: Request, next: Next) -> Response {
//!     let user_id: Option<i64> = None; // from a session or a token
//!     request.extensions_mut().insert(CurrentUser::from(user_id));
//!     next.run(request).await
//! }
//!
//! async fn titles(mut tx: UserTx) -> Result<String, String> {
//!     let titles: Vec<String> =
//!         sqlx::query_scalar("select title from documents").fetch_all(&mut **tx).await.map_err(|e| e.to_string())?;
//!     tx.commit().await.map_err(|e| e.to_string())?;
//!     Ok(titles.join("\n"))
//! }
//! ```

use std::ops::{Deref, DerefMut};
use std::sync::Arc;

use axum::extract::{FromRef, FromRequestParts};
use axum::http::request::Parts;
use axum::http::{Method, StatusCode};
use sqlx::{PgPool, Postgres, Transaction};

use crate::{Identity, TxOptions, UserId};

/// The pool and the identity, which the state of the app gives with `FromRef`
#[derive(Clone)]
pub struct P9s {
    pub pool: PgPool,
    pub identity: Arc<Identity>,
}

impl P9s {
    pub fn new(pool: PgPool, identity: Identity) -> Self {
        P9s { pool, identity: Arc::new(identity) }
    }
}

/// The user of a request, which its authentication puts in its extensions. A request without it reads as no one.
#[derive(Clone, Debug, Default)]
pub struct CurrentUser(pub UserId);

impl<T: Into<UserId>> From<T> for CurrentUser {
    fn from(user_id: T) -> Self {
        CurrentUser(user_id.into())
    }
}

/// A transaction as the user of the request, read only for `GET` and `HEAD`. Commit it, or it rolls back when dropped.
pub struct UserTx(pub Transaction<'static, Postgres>);

impl UserTx {
    pub async fn commit(self) -> sqlx::Result<()> {
        self.0.commit().await
    }
}

impl Deref for UserTx {
    type Target = Transaction<'static, Postgres>;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl DerefMut for UserTx {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.0
    }
}

impl<S> FromRequestParts<S> for UserTx
where
    P9s: FromRef<S>,
    S: Send + Sync,
{
    type Rejection = (StatusCode, String);

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let p9s = P9s::from_ref(state);
        let user = parts.extensions.get::<CurrentUser>().cloned().unwrap_or_default();
        let options = TxOptions::default().read_only(parts.method == Method::GET || parts.method == Method::HEAD);
        let tx = p9s
            .identity
            .as_user_with(&p9s.pool, user.0, &options)
            .await
            .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        Ok(UserTx(tx))
    }
}
