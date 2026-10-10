class ProjectsController < ApplicationController
  def index
    render json: Permissions.readable_projects(@user_id).as_json(only: %i[id name])
  end
end
