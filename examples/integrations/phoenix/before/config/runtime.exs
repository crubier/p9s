import Config

config :documents, Documents.Repo, url: System.fetch_env!("DATABASE_URL"), pool_size: 5

config :documents, DocumentsWeb.Endpoint,
  http: [ip: {127, 0, 0, 1}, port: String.to_integer(System.get_env("PORT", "4000"))],
  secret_key_base: System.get_env("SECRET_KEY_BASE", String.duplicate("an example, not a secret ", 4))
