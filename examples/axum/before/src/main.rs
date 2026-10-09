mod permissions;

use axum::extract::{Path, Request, State};
use axum::http::StatusCode;
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, put};
use axum::{Extension, Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::PgPool;

use permissions::{bits_of, document_bits, project_bits, readable_documents, readable_projects};

#[derive(Serialize, sqlx::FromRow)]
struct Project {
    id: i64,
    name: String,
}

#[derive(Serialize, sqlx::FromRow)]
struct Document {
    id: i64,
    project_id: i64,
    title: String,
    body: String,
}

// A document in a list, without its body
#[derive(Serialize, sqlx::FromRow)]
struct DocumentItem {
    id: i64,
    project_id: i64,
    title: String,
}

#[derive(Deserialize)]
struct NewDocument {
    project_id: i64,
    title: String,
    body: Option<String>,
}

#[derive(Deserialize)]
struct Changes {
    title: Option<String>,
    body: Option<String>,
}

#[derive(Deserialize)]
struct Share {
    access: String,
}

#[derive(Clone, Copy)]
struct UserId(i64);

struct Error(sqlx::Error);

impl From<sqlx::Error> for Error {
    fn from(error: sqlx::Error) -> Self {
        Error(error)
    }
}

impl IntoResponse for Error {
    fn into_response(self) -> Response {
        eprintln!("{}", self.0);
        (StatusCode::INTERNAL_SERVER_ERROR, "internal error").into_response()
    }
}

type Answer = Result<Response, Error>;

fn not_found() -> Answer {
    Ok((StatusCode::NOT_FOUND, Json(json!({ "error": "not found" }))).into_response())
}

fn forbidden() -> Answer {
    Ok((StatusCode::FORBIDDEN, Json(json!({ "error": "forbidden" }))).into_response())
}

#[tokio::main]
async fn main() {
    let db = PgPool::connect(&std::env::var("DATABASE_URL").expect("DATABASE_URL")).await.unwrap();
    if std::env::args().nth(1).as_deref() == Some("migrate") {
        sqlx::migrate!().run(&db).await.unwrap();
        return;
    }
    let api = Router::new()
        .route("/projects", get(projects))
        .route("/documents", get(list_documents).post(create_document))
        .route("/documents/{id}", get(get_document).patch(update_document).delete(delete_document))
        .route("/documents/{id}/shares/{user_id}", put(share))
        .layer(middleware::from_fn(authenticate));
    let app = Router::new().route("/health", get(|| async { "ok" })).merge(api).with_state(db);
    let listener = tokio::net::TcpListener::bind(format!("127.0.0.1:{}", std::env::var("PORT").unwrap())).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

// A real app signs users in, with a session or a token, this one reads the user from a header
async fn authenticate(mut request: Request, next: Next) -> Response {
    let user = request.headers().get("x-user-id").and_then(|value| value.to_str().ok()?.parse().ok());
    let Some(user) = user else {
        return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "unauthorized" }))).into_response();
    };
    request.extensions_mut().insert(UserId(user));
    next.run(request).await
}

async fn projects(State(db): State<PgPool>, Extension(UserId(user)): Extension<UserId>) -> Answer {
    let found: Vec<Project> = sqlx::query_as(&readable_projects()).bind(user).fetch_all(&db).await?;
    Ok(Json(found).into_response())
}

async fn list_documents(State(db): State<PgPool>, Extension(UserId(user)): Extension<UserId>) -> Answer {
    let found: Vec<DocumentItem> = sqlx::query_as(&readable_documents()).bind(user).fetch_all(&db).await?;
    Ok(Json(found).into_response())
}

async fn create_document(
    State(db): State<PgPool>,
    Extension(UserId(user)): Extension<UserId>,
    Json(new): Json<NewDocument>,
) -> Answer {
    if !project_bits(&db, user, new.project_id).await?.contains("write") {
        return forbidden();
    }
    let document: Document = sqlx::query_as(
        "insert into documents (project_id, title, body) values ($1, $2, $3) returning id, project_id, title, body",
    )
    .bind(new.project_id)
    .bind(new.title)
    .bind(new.body.unwrap_or_default())
    .fetch_one(&db)
    .await?;
    Ok((StatusCode::CREATED, Json(document)).into_response())
}

async fn find(db: &PgPool, id: i64) -> sqlx::Result<Document> {
    sqlx::query_as("select id, project_id, title, body from documents where id = $1").bind(id).fetch_one(db).await
}

async fn get_document(State(db): State<PgPool>, Extension(UserId(user)): Extension<UserId>, Path(id): Path<i64>) -> Answer {
    match document_bits(&db, user, id).await? {
        Some(bits) if bits.contains("read") => Ok(Json(find(&db, id).await?).into_response()),
        _ => not_found(),
    }
}

async fn update_document(
    State(db): State<PgPool>,
    Extension(UserId(user)): Extension<UserId>,
    Path(id): Path<i64>,
    Json(changes): Json<Changes>,
) -> Answer {
    let bits = match document_bits(&db, user, id).await? {
        Some(bits) if bits.contains("read") => bits,
        _ => return not_found(),
    };
    if !bits.contains("write") {
        return forbidden();
    }
    sqlx::query("update documents set title = coalesce($2, title), body = coalesce($3, body) where id = $1")
        .bind(id)
        .bind(changes.title)
        .bind(changes.body)
        .execute(&db)
        .await?;
    Ok(Json(find(&db, id).await?).into_response())
}

async fn delete_document(
    State(db): State<PgPool>,
    Extension(UserId(user)): Extension<UserId>,
    Path(id): Path<i64>,
) -> Answer {
    let bits = match document_bits(&db, user, id).await? {
        Some(bits) if bits.contains("read") => bits,
        _ => return not_found(),
    };
    if !bits.contains("delete") {
        return forbidden();
    }
    sqlx::query("delete from documents where id = $1").bind(id).execute(&db).await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

async fn share(
    State(db): State<PgPool>,
    Extension(UserId(user)): Extension<UserId>,
    Path((id, target)): Path<(i64, i64)>,
    Json(share): Json<Share>,
) -> Answer {
    if share.access != "viewer" && share.access != "editor" {
        return Ok((StatusCode::BAD_REQUEST, Json(json!({ "error": "bad request" }))).into_response());
    }
    let bits = match document_bits(&db, user, id).await? {
        Some(bits) if bits.contains("read") => bits,
        _ => return not_found(),
    };
    let previous: Option<String> =
        sqlx::query_scalar("select access from document_shares where document_id = $1 and user_id = $2")
            .bind(id)
            .bind(target)
            .fetch_optional(&db)
            .await?;
    let needed = bits_of(&share.access).iter().chain(previous.as_deref().map(bits_of).unwrap_or_default());
    if !needed.into_iter().all(|bit| bits.contains(bit)) {
        return forbidden();
    }
    sqlx::query(
        "insert into document_shares (document_id, user_id, access) values ($1, $2, $3)
         on conflict (document_id, user_id) do update set access = excluded.access",
    )
    .bind(id)
    .bind(target)
    .bind(share.access)
    .execute(&db)
    .await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}
