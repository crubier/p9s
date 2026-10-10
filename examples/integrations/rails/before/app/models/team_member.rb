class TeamMember < ApplicationRecord
  self.primary_key = %i[team_id user_id]
  belongs_to :team
  belongs_to :user
end
