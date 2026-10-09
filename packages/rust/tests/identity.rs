use p9s::{Identity, TxOptions, UserId};

pub const CONFIG: &str = r#"{
  "engine": {
    "users": ["p9s_rust_user"],
    "graphWriters": ["p9s_rust_writer"],
    "authentication": {"getCurrentUserId": "current_role_id", "setting": "app.user_id"}
  },
  "tables": []
}"#;

fn pairs(pairs: &[(&str, &str)]) -> Vec<(String, String)> {
    pairs.iter().map(|(name, value)| (name.to_string(), value.to_string())).collect()
}

#[test]
fn settings_take_the_first_user_role_and_the_setting() {
    let users = Identity::from_json(CONFIG).unwrap();
    assert_eq!(users.role, "p9s_rust_user");
    let none = TxOptions::default();
    assert_eq!(users.settings(7, &none).unwrap(), pairs(&[("role", "p9s_rust_user"), ("app.user_id", "7")]));
    assert_eq!(users.settings(None::<i64>, &none).unwrap(), pairs(&[("role", "p9s_rust_user"), ("app.user_id", "")]));
    let options = TxOptions::default().role("p9s_rust_writer").set("app.audit", "on");
    assert_eq!(
        users.settings("alice", &options).unwrap(),
        pairs(&[("role", "p9s_rust_writer"), ("app.user_id", "alice"), ("app.audit", "on")])
    );
}

#[test]
fn the_statement_has_positional_parameters() {
    let (statement, values) = Identity::from_json(CONFIG).unwrap().statement(7, &TxOptions::default()).unwrap();
    assert_eq!(statement, "select set_config($1, $2, true), set_config($3, $4, true)");
    assert_eq!(values, ["role", "p9s_rust_user", "app.user_id", "7"]);
}

#[test]
fn a_claim_sets_json_claims() {
    let config = r#"{"engine": {"users": ["authenticated"], "authentication": {"setting": "request.jwt.claims", "claim": "sub"}}}"#;
    let users = Identity::from_json(config).unwrap();
    assert_eq!(users.value(&UserId::from(7)), r#"{"sub":"7"}"#);
    assert_eq!(users.with_setting("app.user_id").value(&UserId::from(7)), "7");
}

#[test]
fn from_file() {
    let path = std::env::temp_dir().join(format!("p9s-{}.config.json", std::process::id()));
    std::fs::write(&path, CONFIG).unwrap();
    assert_eq!(Identity::from_file(&path).unwrap().setting, "app.user_id");
    std::fs::remove_file(path).unwrap();
}

#[test]
fn roles_and_settings_are_checked() {
    let error = Identity::from_json(CONFIG).unwrap().settings(7, &TxOptions::default().role("postgres")).unwrap_err();
    assert!(error.to_string().contains("not a role"));
    let error = Identity::from_json(r#"{"engine": {"authentication": {"setting": "s"}}}"#).unwrap_err();
    assert!(error.to_string().contains("engine.users is empty"));
    let error = Identity::from_json(r#"{"engine": {"users": ["app_user"]}}"#).unwrap_err();
    assert!(error.to_string().contains("engine.authentication.setting"));
}
