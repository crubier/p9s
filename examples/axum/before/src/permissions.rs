//! Who may do what, as the app decides it before p9s: from the shares of projects with the teams of the user, and the
//! shares of documents with the user

use std::collections::HashSet;

use sqlx::PgPool;

pub type Bits = HashSet<&'static str>;

pub fn bits_of(access: &str) -> &'static [&'static str] {
    match access {
        "viewer" => &["read"],
        "editor" => &["read", "write"],
        "owner" => &["read", "write", "delete"],
        _ => &[],
    }
}

fn bits(accesses: Vec<String>) -> Bits {
    accesses.iter().flat_map(|access| bits_of(access)).copied().collect()
}

const TEAMS_OF: &str = "select team_id from team_members where user_id = $1";

pub async fn project_bits(db: &PgPool, user_id: i64, project_id: i64) -> sqlx::Result<Bits> {
    let query = format!("select access from project_shares where team_id in ({TEAMS_OF}) and project_id = $2");
    Ok(bits(sqlx::query_scalar(&query).bind(user_id).bind(project_id).fetch_all(db).await?))
}

/// The bits of the user on the document, or None when there is no such document
pub async fn document_bits(db: &PgPool, user_id: i64, document_id: i64) -> sqlx::Result<Option<Bits>> {
    let project_id: Option<i64> =
        sqlx::query_scalar("select project_id from documents where id = $1").bind(document_id).fetch_optional(db).await?;
    let Some(project_id) = project_id else { return Ok(None) };
    let mut result = project_bits(db, user_id, project_id).await?;
    let shares = sqlx::query_scalar("select access from document_shares where document_id = $1 and user_id = $2")
        .bind(document_id)
        .bind(user_id)
        .fetch_all(db)
        .await?;
    result.extend(bits(shares));
    Ok(Some(result))
}

// Every share gives read, so a user reads the projects shared with their teams, and the documents of those projects or
// shared with them
fn readable_project_ids() -> String {
    format!("select project_id from project_shares where team_id in ({TEAMS_OF})")
}

pub fn readable_projects() -> String {
    format!("select id, name from projects where id in ({}) order by id", readable_project_ids())
}

pub fn readable_documents() -> String {
    format!(
        "select id, project_id, title from documents
         where project_id in ({}) or id in (select document_id from document_shares where user_id = $1) order by id",
        readable_project_ids()
    )
}
