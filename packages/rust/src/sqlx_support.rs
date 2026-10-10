use sqlx::{PgConnection, PgPool, Postgres, Transaction};

use crate::{Identity, TxOptions, UserId};

/// Acts as the user for the rest of a transaction already begun
pub async fn set_user(
    connection: &mut PgConnection,
    identity: &Identity,
    user_id: impl Into<UserId>,
    options: &TxOptions,
) -> sqlx::Result<()> {
    let (statement, values) =
        identity.statement(user_id, options).map_err(|error| sqlx::Error::Configuration(Box::new(error)))?;
    let mut query = sqlx::query(&statement);
    for value in values {
        query = query.bind(value);
    }
    query.execute(connection).await?;
    Ok(())
}

impl Identity {
    /// Begins a transaction of the pool as the user: every query of it goes through the policies, until it commits, or
    /// rolls back when dropped
    pub async fn as_user(
        &self,
        pool: &PgPool,
        user_id: impl Into<UserId>,
    ) -> sqlx::Result<Transaction<'static, Postgres>> {
        self.as_user_with(pool, user_id, &TxOptions::default()).await
    }

    /// Begins a transaction of the pool as the user, with options
    pub async fn as_user_with(
        &self,
        pool: &PgPool,
        user_id: impl Into<UserId>,
        options: &TxOptions,
    ) -> sqlx::Result<Transaction<'static, Postgres>> {
        let mut tx = pool.begin().await?;
        set_user(&mut tx, self, user_id, options).await?;
        Ok(tx)
    }
}

/// Whether an error is Postgres refusing a statement to the user, with insufficient_privilege (42501): a row the
/// policies do not let through, a statement the role has no privilege for, or a share of bits the user does not have
pub fn is_refused(error: &sqlx::Error) -> bool {
    error.as_database_error().and_then(|error| error.code()).is_some_and(|code| code == "42501")
}
