defmodule DocumentsWeb.Endpoint do
  use Phoenix.Endpoint, otp_app: :documents

  plug :health
  plug Plug.Parsers, parsers: [:json], json_decoder: JSON
  plug DocumentsWeb.Router

  def health(%Plug.Conn{request_path: "/health"} = conn, _opts), do: conn |> send_resp(200, "ok") |> halt()
  def health(conn, _opts), do: conn
end
