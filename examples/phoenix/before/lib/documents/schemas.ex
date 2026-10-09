defmodule Documents.TeamMember do
  use Ecto.Schema

  @primary_key false
  schema "team_members" do
    field :team_id, :id, primary_key: true
    field :user_id, :id, primary_key: true
  end
end

defmodule Documents.ProjectShare do
  use Ecto.Schema

  @primary_key false
  schema "project_shares" do
    field :project_id, :id, primary_key: true
    field :team_id, :id, primary_key: true
    field :access, :string
  end
end

defmodule Documents.Project do
  use Ecto.Schema

  schema "projects" do
    field :name, :string
  end
end

defmodule Documents.Document do
  use Ecto.Schema

  schema "documents" do
    field :project_id, :id
    field :title, :string
    field :body, :string, default: ""
  end

  def json(document), do: Map.take(document, [:id, :project_id, :title, :body])
end

defmodule Documents.DocumentShare do
  use Ecto.Schema

  @primary_key false
  schema "document_shares" do
    field :document_id, :id, primary_key: true
    field :user_id, :id, primary_key: true
    field :access, :string
  end
end
