// sqlx::migrate! embeds the migrations in the app: a new one builds it again
fn main() {
    println!("cargo:rerun-if-changed=migrations");
}
