defmodule Documents.Application do
  use Application

  @impl true
  def start(_type, _args) do
    Supervisor.start_link([Documents.Repo, DocumentsWeb.Endpoint], strategy: :one_for_one, name: Documents.Supervisor)
  end
end
