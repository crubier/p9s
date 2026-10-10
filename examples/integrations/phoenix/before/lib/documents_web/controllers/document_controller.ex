defmodule DocumentsWeb.DocumentController do
  use DocumentsWeb, :controller

  import Ecto.Query

  alias Documents.{Document, DocumentShare, Permissions, Repo}

  def index(conn, _params) do
    documents =
      conn.assigns.user_id |> Permissions.readable_documents() |> select([d], map(d, [:id, :project_id, :title]))

    json(conn, Repo.all(documents))
  end

  def create(conn, %{"project_id" => project_id, "title" => title} = params) do
    if "write" in Permissions.project_bits(conn.assigns.user_id, project_id) do
      document = Repo.insert!(%Document{project_id: project_id, title: title, body: params["body"] || ""})
      conn |> put_status(201) |> json(Document.json(document))
    else
      forbidden(conn)
    end
  end

  def show(conn, %{"id" => id}) do
    with id when id != nil <- id(id),
         bits when bits != nil <- Permissions.document_bits(conn.assigns.user_id, id),
         true <- "read" in bits do
      json(conn, Document.json(Repo.get!(Document, id)))
    else
      _ -> not_found(conn)
    end
  end

  def update(conn, %{"id" => id} = params) do
    with {:ok, id, bits} <- readable(conn, id) do
      if "write" in bits do
        changes = for {name, value} <- Map.take(params, ["title", "body"]), do: {String.to_existing_atom(name), value}
        Repo.update_all(from(d in Document, where: d.id == ^id), set: changes)
        json(conn, Document.json(Repo.get!(Document, id)))
      else
        forbidden(conn)
      end
    end
  end

  def delete(conn, %{"id" => id}) do
    with {:ok, id, bits} <- readable(conn, id) do
      if "delete" in bits do
        Repo.delete_all(from d in Document, where: d.id == ^id)
        send_resp(conn, 204, "")
      else
        forbidden(conn)
      end
    end
  end

  def share(conn, %{"id" => id, "user_id" => target, "access" => access}) when access in ["viewer", "editor"] do
    with {:ok, id, bits} <- readable(conn, id), target when target != nil <- id(target) do
      previous =
        Repo.one(from s in DocumentShare, where: s.document_id == ^id and s.user_id == ^target, select: s.access)

      if Enum.all?(Permissions.bits_of(access) ++ Permissions.bits_of(previous), &(&1 in bits)) do
        Repo.insert!(%DocumentShare{document_id: id, user_id: target, access: access},
          on_conflict: {:replace, [:access]},
          conflict_target: [:document_id, :user_id]
        )

        send_resp(conn, 204, "")
      else
        forbidden(conn)
      end
    end
  end

  def share(conn, _params), do: bad_request(conn)

  # The id and the bits of a document the user reads, or not found
  defp readable(conn, id) do
    with id when id != nil <- id(id),
         bits when bits != nil <- Permissions.document_bits(conn.assigns.user_id, id),
         true <- "read" in bits do
      {:ok, id, bits}
    else
      _ -> not_found(conn)
    end
  end
end
