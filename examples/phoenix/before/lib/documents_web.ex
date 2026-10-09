defmodule DocumentsWeb do
  def controller do
    quote do
      use Phoenix.Controller, formats: [:json]

      import Plug.Conn
      import DocumentsWeb.Answers
    end
  end

  defmacro __using__(which) when is_atom(which), do: apply(__MODULE__, which, [])
end

defmodule DocumentsWeb.Answers do
  import Phoenix.Controller, only: [json: 2]
  import Plug.Conn

  def not_found(conn), do: conn |> put_status(404) |> json(%{error: "not found"})
  def forbidden(conn), do: conn |> put_status(403) |> json(%{error: "forbidden"})
  def bad_request(conn), do: conn |> put_status(400) |> json(%{error: "bad request"})

  def id(text) do
    case Integer.parse(to_string(text)) do
      {id, ""} -> id
      _ -> nil
    end
  end
end

# A real app signs users in, with a session or a token, this one reads the user from a header
defmodule DocumentsWeb.Authenticate do
  import Plug.Conn

  def init(opts), do: opts

  def call(conn, _opts) do
    case conn |> get_req_header("x-user-id") |> List.first() |> DocumentsWeb.Answers.id() do
      nil -> conn |> put_status(401) |> Phoenix.Controller.json(%{error: "unauthorized"}) |> halt()
      user_id -> assign(conn, :user_id, user_id)
    end
  end
end
