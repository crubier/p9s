class ProjectShare < ApplicationRecord
  self.primary_key = %i[project_id team_id]
  belongs_to :project
  belongs_to :team
end
