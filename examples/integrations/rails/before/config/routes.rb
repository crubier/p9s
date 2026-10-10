Rails.application.routes.draw do
  get "health", to: ->(_env) { [200, { "content-type" => "text/plain" }, ["ok"]] }
  get "projects", to: "projects#index"
  resources :documents, only: %i[index create show update destroy]
  put "documents/:id/shares/:user_id", to: "documents#share"
end
