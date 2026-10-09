if Code.ensure_loaded?(Phoenix.Controller) do
  defmodule P9s.Controller do
    @moduledoc """
    Runs every action of a Phoenix controller in a transaction as the user of its request, read only for `GET` and
    `HEAD`. Use it after `Phoenix.Controller`:

        defmodule MyAppWeb.DocumentController do
          use MyAppWeb, :controller
          use P9s.Controller, repo: MyApp.Repo
        end

    The user is `conn.assigns.current_user.id` by default: override `p9s_user_id/1` for another. A write the policies
    refuse rolls the transaction back and calls `p9s_refused/2`, which answers 403 by default.
    """

    defmacro __using__(opts) do
      repo = Keyword.fetch!(opts, :repo)

      quote do
        def action(conn, opts) do
          P9s.Controller.run(conn, unquote(repo), p9s_user_id(conn), fn -> super(conn, opts) end, &p9s_refused/2)
        end

        def p9s_user_id(conn) do
          case conn.assigns[:current_user] do
            %{id: id} -> id
            _ -> nil
          end
        end

        def p9s_refused(conn, _error) do
          conn |> Plug.Conn.send_resp(403, "Forbidden") |> Plug.Conn.halt()
        end

        defoverridable action: 2, p9s_user_id: 1, p9s_refused: 2
      end
    end

    @doc false
    def run(conn, repo, user_id, action, refused) do
      case P9s.as_user(repo, user_id, action, read_only: conn.method in ["GET", "HEAD"]) do
        {:ok, conn} -> conn
        {:error, reason} -> raise "p9s: the transaction of the action rolled back: #{inspect(reason)}"
      end
    rescue
      error -> if P9s.refused?(error), do: refused.(conn, error), else: reraise(error, __STACKTRACE__)
    end
  end
end
