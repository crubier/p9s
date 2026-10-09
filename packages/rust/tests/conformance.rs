//! The conformance suite of p9s, see packages/conformance

use std::path::PathBuf;

use p9s::{is_refused, Identity, TxOptions, UserId};
use serde_json::Value;
use sqlx::postgres::PgPoolOptions;

#[tokio::test]
async fn conformance() {
    let Ok(url) = std::env::var("P9S_CONFORMANCE_DATABASE_URL") else { return };
    let suite = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../conformance");
    let cases: Value = serde_json::from_str(&std::fs::read_to_string(suite.join("cases.json")).unwrap()).unwrap();
    let text = |value: &Value| value.as_str().unwrap().to_string();
    let user = |value: &Value| UserId::from(value.as_i64());

    let users = Identity::from_file(suite.join(text(&cases["config"]))).unwrap();
    assert_eq!((users.role.clone(), users.setting.clone()), (text(&cases["role"]), text(&cases["setting"])));

    let pool = PgPoolOptions::new().max_connections(1).connect(&url).await.unwrap();
    let read_only = TxOptions::default().read_only(true);
    for _ in 0..2 {
        for read in cases["reads"].as_array().unwrap() {
            let mut tx = users.as_user_with(&pool, user(&read["user"]), &read_only).await.unwrap();
            let ids: Vec<i32> = sqlx::query_scalar(&text(&cases["read"])).fetch_all(&mut *tx).await.unwrap();
            tx.commit().await.unwrap();
            let expected: Vec<i32> = serde_json::from_value(read["ids"].clone()).unwrap();
            assert_eq!(ids, expected);
        }
    }

    let insert = &cases["insert"];
    let mut tx = users.as_user(&pool, user(&insert["user"])).await.unwrap();
    let (id, folder_id): (i32, i32) = sqlx::query_as(&text(&insert["sql"])).fetch_one(&mut *tx).await.unwrap();
    tx.commit().await.unwrap();
    assert_eq!(i64::from(folder_id), insert["folderId"].as_i64().unwrap());
    assert!(id > 3);

    let refused = &cases["refused"];
    let mut tx = users.as_user(&pool, user(&refused["user"])).await.unwrap();
    let error = sqlx::query(&text(&refused["sql"])).execute(&mut *tx).await.unwrap_err();
    assert!(is_refused(&error));
    drop(tx);

    let who = text(&cases["who"]);
    let mut tx = users.as_user(&pool, user(&cases["whoUser"])).await.unwrap();
    let inside: (String, String) = sqlx::query_as(&who).fetch_one(&mut *tx).await.unwrap();
    assert_eq!(inside, (text(&cases["role"]), cases["whoUser"].to_string()));
    drop(tx);
    let (role, user_id): (String, String) = sqlx::query_as(&who).fetch_one(&pool).await.unwrap();
    assert_ne!(role, text(&cases["role"]));
    assert_eq!(user_id, "");
}
