class CreateTables < ActiveRecord::Migration[8.1]
  def change
    create_table :users do |t|
      t.text :name, null: false, index: { unique: true }
    end

    create_table :teams do |t|
      t.text :name, null: false, index: { unique: true }
    end

    create_table :team_members, primary_key: %i[team_id user_id] do |t|
      t.references :team, null: false, index: false, foreign_key: { on_delete: :cascade }
      t.references :user, null: false, foreign_key: { on_delete: :cascade }
    end

    create_table :projects do |t|
      t.text :name, null: false
    end

    create_table :project_shares, primary_key: %i[project_id team_id] do |t|
      t.references :project, null: false, index: false, foreign_key: { on_delete: :cascade }
      t.references :team, null: false, foreign_key: { on_delete: :cascade }
      t.text :access, null: false
      t.check_constraint "access in ('viewer', 'editor', 'owner')", name: "project_shares_access_check"
    end

    create_table :documents do |t|
      t.references :project, null: false, foreign_key: { on_delete: :cascade }
      t.text :title, null: false
      t.text :body, null: false, default: ""
    end

    create_table :document_shares, primary_key: %i[document_id user_id] do |t|
      t.references :document, null: false, index: false, foreign_key: { on_delete: :cascade }
      t.references :user, null: false, foreign_key: { on_delete: :cascade }
      t.text :access, null: false
      t.check_constraint "access in ('viewer', 'editor')", name: "document_shares_access_check"
    end
  end
end
