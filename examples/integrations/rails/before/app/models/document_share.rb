class DocumentShare < ApplicationRecord
  self.primary_key = %i[document_id user_id]
  belongs_to :document
  belongs_to :user
end
