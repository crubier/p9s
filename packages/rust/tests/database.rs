use axum::body::Body;
use axum::extract::{FromRef, Request};
use axum::middleware::{self, Next};
use axum::response::Response;
use axum::routing::get;
use axum::Router;
use p9s::axum::{CurrentUser, P9s, UserTx};
use p9s::{is_refused, Identity, TxOptions};
use sqlx::PgPool;
use tokio::sync::OnceCell;
use tower::ServiceExt;

const CONFIG: &str = r#"{
  "engine": {
    "users": ["p9s_rust_user"],
    "graphWriters": ["p9s_rust_writer"],
    "authentication": {"getCurrentUserId": "current_role_id", "setting": "app.user_id"}
  },
  "tables": []
}"#;

static PREPARED: OnceCell<()> = OnceCell::const_new();

// A table the user role reads but cannot write, and the roles of the config
async fn database() -> Option<PgPool> {
    let url = std::env::var("P9S_TEST_DATABASE_URL").ok()?;
    let pool = PgPool::connect(&url).await.unwrap();
    PREPARED
        .get_or_init(|| async {
            sqlx::raw_sql(
                "do $$
                begin
                  if not exists (select from pg_roles where rolname = 'p9s_rust_user') then create role p9s_rust_user nologin; end if;
                  if not exists (select from pg_roles where rolname = 'p9s_rust_writer') then create role p9s_rust_writer nologin; end if;
                end
                $$;
                grant p9s_rust_user, p9s_rust_writer to current_user;
                drop table if exists p9s_rust_note;
                create table p9s_rust_note (id serial primary key, body text not null);
                grant select on p9s_rust_note to p9s_rust_user;
                grant select, insert on p9s_rust_note to p9s_rust_writer;
                grant usage on sequence p9s_rust_note_id_seq to p9s_rust_writer;",
            )
            .execute(&pool)
            .await
            .unwrap();
        })
        .await;
    Some(pool)
}

const WHO: &str = "select current_user::text, coalesce(current_setting('app.user_id', true), '')";

#[tokio::test]
async fn as_user() {
    let Some(pool) = database().await else { return };
    let users = Identity::from_json(CONFIG).unwrap();

    let mut tx = users.as_user(&pool, 7).await.unwrap();
    let who: (String, String) = sqlx::query_as(WHO).fetch_one(&mut *tx).await.unwrap();
    assert_eq!(who, ("p9s_rust_user".into(), "7".into()));
    tx.rollback().await.unwrap();

    let mut tx = users.as_user(&pool, 7).await.unwrap();
    let error = sqlx::query("insert into p9s_rust_note (body) values ('refused')").execute(&mut *tx).await.unwrap_err();
    assert!(is_refused(&error));

    let options = TxOptions::default().role("p9s_rust_writer").read_only(true);
    let mut tx = users.as_user_with(&pool, 7, &options).await.unwrap();
    let error =
        sqlx::query("insert into p9s_rust_note (body) values ('read only')").execute(&mut *tx).await.unwrap_err();
    assert!(error.to_string().contains("read-only transaction"));

    let mut tx = users.as_user_with(&pool, 7, &TxOptions::default().role("p9s_rust_writer")).await.unwrap();
    let id: i32 = sqlx::query_scalar("insert into p9s_rust_note (body) values ('written') returning id")
        .fetch_one(&mut *tx)
        .await
        .unwrap();
    assert!(id > 0);
    tx.commit().await.unwrap();
}

#[tokio::test]
async fn a_dropped_transaction_leaves_nothing_on_the_connection() {
    let Some(pool) = database().await else { return };
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect_with(pool.connect_options().as_ref().clone())
        .await
        .unwrap();
    let users = Identity::from_json(CONFIG).unwrap();
    drop(users.as_user(&pool, 7).await.unwrap());
    let who: (String, String) = sqlx::query_as(WHO).fetch_one(&pool).await.unwrap();
    assert_ne!(who.0, "p9s_rust_user");
    assert_eq!(who.1, "");
}

#[derive(Clone, FromRef)]
struct State {
    p9s: P9s,
}

async fn authenticate(mut request: Request, next: Next) -> Response {
    let user = request.headers().get("x-user-id").and_then(|value| value.to_str().ok()).map(String::from);
    request.extensions_mut().insert(CurrentUser::from(user));
    next.run(request).await
}

async fn who(mut tx: UserTx) -> String {
    let (role, user): (String, String) = sqlx::query_as(WHO).fetch_one(&mut **tx).await.unwrap();
    let read_only: String =
        sqlx::query_scalar("select current_setting('transaction_read_only')").fetch_one(&mut **tx).await.unwrap();
    tx.commit().await.unwrap();
    format!("{role} {user} {read_only}")
}

#[tokio::test]
async fn the_extractor_acts_as_the_user_of_the_request() {
    let Some(pool) = database().await else { return };
    let state = State { p9s: P9s::new(pool, Identity::from_json(CONFIG).unwrap()) };
    let app = Router::new().route("/", get(who).post(who)).layer(middleware::from_fn(authenticate)).with_state(state);
    let answer = |method: &str| {
        let request = Request::builder().method(method).uri("/").header("x-user-id", "42").body(Body::empty()).unwrap();
        let app = app.clone();
        async move {
            let response = app.oneshot(request).await.unwrap();
            String::from_utf8(axum::body::to_bytes(response.into_body(), 1024).await.unwrap().to_vec()).unwrap()
        }
    };
    assert_eq!(answer("GET").await, "p9s_rust_user 42 on");
    assert_eq!(answer("POST").await, "p9s_rust_user 42 off");
}
