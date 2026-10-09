import Config

config :documents, ecto_repos: [Documents.Repo]
config :documents, DocumentsWeb.Endpoint, adapter: Bandit.PhoenixAdapter, server: true
config :phoenix, :json_library, JSON
config :logger, level: :warning
