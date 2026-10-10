//! Act as a user of [p9s](https://github.com/crubier/p9s), permissions of trees in Postgres with row level security:
//! every query of a transaction runs as the role of the users of the config, with the id of the user in the setting its
//! current user function reads, so the policies of p9s decide what it reads and writes.
//!
//! Both are set with `set_config(..., true)`, so that they end with the transaction, and a pooled connection never keeps
//! the identity of a previous request.
//!
//! ```no_run
//! # async fn example(pool: sqlx::PgPool) -> Result<(), Box<dyn std::error::Error>> {
//! let users = p9s::Identity::from_file("p9s.config.json")?;
//! let mut tx = users.as_user(&pool, 7).await?;
//! let titles: Vec<String> = sqlx::query_scalar("select title from documents").fetch_all(&mut *tx).await?;
//! tx.commit().await?;
//! # Ok(())
//! # }
//! ```

use std::collections::HashSet;
use std::fmt;
use std::path::Path;

use serde_json::Value;

#[cfg(feature = "sqlx")]
mod sqlx_support;
#[cfg(feature = "sqlx")]
pub use sqlx_support::{is_refused, set_user};

#[cfg(feature = "axum")]
pub mod axum;

/// An error of the config of p9s, or of a role it does not name
#[derive(Debug)]
pub enum Error {
    Io(std::io::Error),
    Json(serde_json::Error),
    Config(String),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Io(error) => write!(f, "p9s: {error}"),
            Error::Json(error) => write!(f, "p9s: reading the config: {error}"),
            Error::Config(message) => write!(f, "p9s: {message}"),
        }
    }
}

impl std::error::Error for Error {}

/// The id of a user, or no user, who reads as no one
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct UserId(pub Option<String>);

macro_rules! user_ids {
    ($($type:ty),*) => {$(
        impl From<$type> for UserId {
            fn from(id: $type) -> Self { UserId(Some(id.to_string())) }
        }
        impl From<Option<$type>> for UserId {
            fn from(id: Option<$type>) -> Self { UserId(id.map(|id| id.to_string())) }
        }
    )*};
}

user_ids!(i16, i32, i64, u16, u32, u64, String, &str, &String);

/// The options of a transaction of a user
#[derive(Clone, Debug, Default)]
pub struct TxOptions {
    pub read_only: bool,
    pub role: Option<String>,
    pub settings: Vec<(String, String)>,
}

impl TxOptions {
    /// Makes the transaction read only when `read_only` is true
    pub fn read_only(mut self, read_only: bool) -> Self {
        self.read_only = read_only;
        self
    }

    /// Takes another role of `engine.users` or `engine.graphWriters`
    pub fn role(mut self, role: impl Into<String>) -> Self {
        self.role = Some(role.into());
        self
    }

    /// Sets another setting for the transaction, like `app.tenant_id`
    pub fn set(mut self, name: impl Into<String>, value: impl Into<String>) -> Self {
        self.settings.push((name.into(), value.into()));
        self
    }
}

/// The role and the setting of the config, like `createIdentity` of `@p9s/postgres`
#[derive(Clone, Debug)]
pub struct Identity {
    /// The role transactions take, the first of `engine.users`
    pub role: String,
    /// The setting the current user function reads
    pub setting: String,
    /// The claim of the setting, when it holds JSON claims, like `request.jwt.claims` of PostgREST
    pub claim: Option<String>,
    roles: HashSet<String>,
}

fn strings(value: &Value) -> Vec<String> {
    value.as_array().into_iter().flatten().filter_map(|role| role.as_str().map(String::from)).collect()
}

impl Identity {
    /// The identity of a config of p9s
    pub fn new(config: &Value) -> Result<Self, Error> {
        let engine = &config["engine"];
        let users = strings(&engine["users"]);
        let role = users.first().cloned().ok_or_else(|| Error::Config("engine.users is empty".into()))?;
        let authentication = &engine["authentication"];
        let setting = authentication["setting"].as_str().unwrap_or_default().to_string();
        if setting.is_empty() {
            return Err(Error::Config(
                "set engine.authentication.setting, like \"app.user_id\", for the migration to read the current user from it, or set the setting the current user function reads".into(),
            ));
        }
        let roles = users.into_iter().chain(strings(&engine["graphWriters"])).collect();
        Ok(Identity { role, setting, claim: authentication["claim"].as_str().map(String::from), roles })
    }

    /// The identity of the JSON of `p9s.config.json`
    pub fn from_json(json: &str) -> Result<Self, Error> {
        Self::new(&serde_json::from_str(json).map_err(Error::Json)?)
    }

    /// The identity of `p9s.config.json`
    pub fn from_file(path: impl AsRef<Path>) -> Result<Self, Error> {
        Self::from_json(&std::fs::read_to_string(path).map_err(Error::Io)?)
    }

    /// Reads the user from another setting than the one of the config, with no claim
    pub fn with_setting(mut self, setting: impl Into<String>) -> Self {
        self.setting = setting.into();
        self.claim = None;
        self
    }

    /// Sets the user as this claim of JSON claims in the setting
    pub fn with_claim(mut self, claim: impl Into<String>) -> Self {
        self.claim = Some(claim.into());
        self
    }

    /// The value of the setting for a user, empty for no user
    pub fn value(&self, user_id: &UserId) -> String {
        match (&user_id.0, &self.claim) {
            (None, _) => String::new(),
            (Some(id), None) => id.clone(),
            (Some(id), Some(claim)) => serde_json::json!({ claim: id }).to_string(),
        }
    }

    /// The settings of a transaction of the user, the role first, with `transaction_read_only` for a read only
    /// transaction, which Postgres takes even after the transaction has run a statement
    pub fn settings(&self, user_id: impl Into<UserId>, options: &TxOptions) -> Result<Vec<(String, String)>, Error> {
        let role = options.role.clone().unwrap_or_else(|| self.role.clone());
        if !self.roles.contains(&role) {
            return Err(Error::Config(format!("{role} is not a role of engine.users or engine.graphWriters")));
        }
        let mut settings = vec![("role".to_string(), role), (self.setting.clone(), self.value(&user_id.into()))];
        settings.extend(options.settings.iter().cloned());
        if options.read_only {
            settings.push(("transaction_read_only".to_string(), "on".to_string()));
        }
        Ok(settings)
    }

    /// The statement to run first in a transaction, with positional parameters:
    /// `select set_config($1, $2, true), ...`
    pub fn statement(&self, user_id: impl Into<UserId>, options: &TxOptions) -> Result<(String, Vec<String>), Error> {
        let settings = self.settings(user_id, options)?;
        let calls: Vec<String> = (0..settings.len())
            .map(|index| format!("set_config(${}, ${}, true)", 2 * index + 1, 2 * index + 2))
            .collect();
        let values = settings.into_iter().flat_map(|(name, value)| [name, value]).collect();
        Ok((format!("select {}", calls.join(", ")), values))
    }
}
