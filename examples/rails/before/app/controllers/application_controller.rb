# A real app signs users in, with a session or a token, this one reads the user from a header
class ApplicationController < ActionController::API
  before_action :authenticate

  private

  def authenticate
    header = request.headers["x-user-id"].to_s
    @user_id = header.match?(/\A-?\d+\z/) ? header.to_i : nil
    render json: { error: "unauthorized" }, status: :unauthorized if @user_id.nil?
  end

  def not_found
    render json: { error: "not found" }, status: :not_found
  end

  def forbidden
    render json: { error: "forbidden" }, status: :forbidden
  end
end
