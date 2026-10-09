class Project < ApplicationRecord
  has_many :project_shares
  has_many :documents
end
