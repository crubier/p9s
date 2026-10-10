# Deleting a document deletes its shares in the database, with on_delete: :cascade
class Document < ApplicationRecord
  belongs_to :project
  has_many :document_shares
end
