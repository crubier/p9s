defmodule DocumentsWeb.ProjectController do
  use DocumentsWeb, :controller

  import Ecto.Query

  alias Documents.{Permissions, Repo}

  def index(conn, _params) do
    json(
      conn,
      conn.assigns.user_id |> Permissions.readable_projects() |> select([p], map(p, [:id, :name])) |> Repo.all()
    )
  end
end
