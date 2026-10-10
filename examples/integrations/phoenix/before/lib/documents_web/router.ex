defmodule DocumentsWeb.Router do
  use Phoenix.Router

  pipeline :api do
    plug DocumentsWeb.Authenticate
  end

  scope "/", DocumentsWeb do
    pipe_through :api

    get "/projects", ProjectController, :index
    resources "/documents", DocumentController, only: [:index, :create, :show, :update, :delete]
    put "/documents/:id/shares/:user_id", DocumentController, :share
  end
end
