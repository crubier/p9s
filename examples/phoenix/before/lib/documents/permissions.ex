defmodule Documents.Permissions do
  @moduledoc """
  Who may do what, as the app decides it before p9s: from the shares of projects with the teams of the user, and the
  shares of documents with the user
  """

  import Ecto.Query

  alias Documents.{Document, DocumentShare, Project, ProjectShare, Repo, TeamMember}

  @bits %{"viewer" => ["read"], "editor" => ["read", "write"], "owner" => ["read", "write", "delete"]}

  def bits_of(access), do: Map.get(@bits, access, [])

  defp teams_of(user_id), do: from(m in TeamMember, where: m.user_id == ^user_id, select: m.team_id)

  def project_bits(user_id, project_id) do
    from(s in ProjectShare, where: s.project_id == ^project_id and s.team_id in subquery(teams_of(user_id)))
    |> select([s], s.access)
    |> Repo.all()
    |> Enum.flat_map(&bits_of/1)
    |> MapSet.new()
  end

  @doc "The bits of the user on the document, or nil when there is no such document"
  def document_bits(user_id, document_id) do
    case Repo.one(from d in Document, where: d.id == ^document_id, select: d.project_id) do
      nil ->
        nil

      project_id ->
        shares = Repo.all(from s in DocumentShare, where: s.document_id == ^document_id and s.user_id == ^user_id)
        MapSet.union(project_bits(user_id, project_id), MapSet.new(Enum.flat_map(shares, &bits_of(&1.access))))
    end
  end

  # Every share gives read, so a user reads the projects shared with their teams, and the documents of those projects
  # or shared with them
  defp readable_project_ids(user_id) do
    from(s in ProjectShare, where: s.team_id in subquery(teams_of(user_id)), select: s.project_id)
  end

  def readable_projects(user_id) do
    from(p in Project, where: p.id in subquery(readable_project_ids(user_id)), order_by: p.id)
  end

  def readable_documents(user_id) do
    shared = from(s in DocumentShare, where: s.user_id == ^user_id, select: s.document_id)

    from(d in Document,
      where: d.project_id in subquery(readable_project_ids(user_id)) or d.id in subquery(shared),
      order_by: d.id
    )
  end
end
