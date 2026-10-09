# Who may do what, as the app decides it before p9s: from the shares of projects with the teams of the user, and the
# shares of documents with the user
module Permissions
  BITS = { "viewer" => %w[read], "editor" => %w[read write], "owner" => %w[read write delete] }.freeze

  module_function

  def teams_of(user_id)
    TeamMember.where(user_id: user_id).select(:team_id)
  end

  def project_bits(user_id, project_id)
    ProjectShare.where(project_id: project_id, team_id: teams_of(user_id)).pluck(:access).flat_map { |access| BITS[access] }.to_set
  end

  # The bits of the user on the document, or nil when there is no such document
  def document_bits(user_id, document_id)
    project_id = Document.where(id: document_id).pick(:project_id)
    return nil if project_id.nil?

    share = DocumentShare.where(document_id: document_id, user_id: user_id).pick(:access)
    project_bits(user_id, project_id) | (share ? BITS[share] : [])
  end

  # Every share gives read, so a user reads the projects shared with their teams, and the documents of those projects or
  # shared with them
  def readable_project_ids(user_id)
    ProjectShare.where(team_id: teams_of(user_id)).select(:project_id)
  end

  def readable_projects(user_id)
    Project.where(id: readable_project_ids(user_id)).order(:id)
  end

  def readable_documents(user_id)
    shared = DocumentShare.where(user_id: user_id).select(:document_id)
    Document.where(project_id: readable_project_ids(user_id)).or(Document.where(id: shared)).order(:id)
  end
end
