defmodule Documents.Repo.Migrations.CreateTables do
  use Ecto.Migration

  def change do
    create table(:users) do
      add :name, :text, null: false
    end

    create unique_index(:users, [:name])

    create table(:teams) do
      add :name, :text, null: false
    end

    create unique_index(:teams, [:name])

    create table(:team_members, primary_key: false) do
      add :team_id, references(:teams, on_delete: :delete_all), primary_key: true
      add :user_id, references(:users, on_delete: :delete_all), primary_key: true
    end

    create index(:team_members, [:user_id])

    create table(:projects) do
      add :name, :text, null: false
    end

    create table(:project_shares, primary_key: false) do
      add :project_id, references(:projects, on_delete: :delete_all), primary_key: true
      add :team_id, references(:teams, on_delete: :delete_all), primary_key: true
      add :access, :text, null: false
    end

    create index(:project_shares, [:team_id])
    create constraint(:project_shares, :project_shares_access_check, check: "access in ('viewer', 'editor', 'owner')")

    create table(:documents) do
      add :project_id, references(:projects, on_delete: :delete_all), null: false
      add :title, :text, null: false
      add :body, :text, null: false, default: ""
    end

    create index(:documents, [:project_id])

    create table(:document_shares, primary_key: false) do
      add :document_id, references(:documents, on_delete: :delete_all), primary_key: true
      add :user_id, references(:users, on_delete: :delete_all), primary_key: true
      add :access, :text, null: false
    end

    create index(:document_shares, [:user_id])
    create constraint(:document_shares, :document_shares_access_check, check: "access in ('viewer', 'editor')")
  end
end
