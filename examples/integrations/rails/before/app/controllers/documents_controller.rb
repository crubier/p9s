class DocumentsController < ApplicationController
  def index
    render json: Permissions.readable_documents(@user_id).as_json(only: %i[id project_id title])
  end

  def create
    return forbidden unless Permissions.project_bits(@user_id, params[:project_id]).include?("write")

    document = Document.create!(project_id: params[:project_id], title: params[:title], body: params[:body] || "")
    render json: document, status: :created
  end

  def show
    bits = Permissions.document_bits(@user_id, params[:id])
    return not_found unless bits&.include?("read")

    render json: Document.find(params[:id])
  end

  def update
    bits = Permissions.document_bits(@user_id, params[:id])
    return not_found unless bits&.include?("read")
    return forbidden unless bits.include?("write")

    Document.where(id: params[:id]).update_all(params.permit(:title, :body).to_h)
    render json: Document.find(params[:id])
  end

  def destroy
    bits = Permissions.document_bits(@user_id, params[:id])
    return not_found unless bits&.include?("read")
    return forbidden unless bits.include?("delete")

    Document.where(id: params[:id]).delete_all
    head :no_content
  end

  def share
    bits = Permissions.document_bits(@user_id, params[:id])
    return not_found unless bits&.include?("read")

    share = DocumentShare.find_or_initialize_by(document_id: params[:id], user_id: params[:user_id])
    given = Permissions::BITS.fetch(params[:access])
    taken = share.access ? Permissions::BITS[share.access] : []
    return forbidden unless (given + taken).all? { |bit| bits.include?(bit) }

    share.update!(access: params[:access])
    head :no_content
  end
end
