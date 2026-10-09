defmodule P9s.DatabaseTest do
  use ExUnit.Case

  import P9s.TestConfig, only: [who: 0]

  alias P9s.TestRepo, as: Repo

  @moduletag :database

  setup do
    {:ok, identity: P9s.Identity.new(P9s.TestConfig.config())}
  end

  test "as_user", %{identity: identity} do
    assert P9s.as_user(Repo, 7, &who/0, identity: identity) == {:ok, ["p9s_elixir_user", "7"]}
    refute hd(who()) == "p9s_elixir_user"
  end

  test "a refused write is refused", %{identity: identity} do
    error =
      assert_raise Postgrex.Error, fn ->
        P9s.as_user(Repo, 7, fn -> Repo.query!("insert into p9s_elixir_note (body) values ('refused')") end,
          identity: identity
        )
      end

    assert P9s.refused?(error)
  end

  test "read only", %{identity: identity} do
    error =
      assert_raise Postgrex.Error, fn ->
        P9s.as_user(Repo, 7, fn -> Repo.query!("insert into p9s_elixir_note (body) values ('read only')") end,
          identity: identity,
          role: "p9s_elixir_writer",
          read_only: true
        )
      end

    assert error.postgres.code == :read_only_sql_transaction
  end

  test "a rolled back transaction leaves nothing on the connection", %{identity: identity} do
    assert P9s.as_user(Repo, 7, fn -> Repo.rollback(:no) end, identity: identity) == {:error, :no}
    assert who() |> hd() != "p9s_elixir_user"
    assert who() |> List.last() == ""
  end

  defmodule NotesController do
    use Phoenix.Controller, formats: [:json]
    use P9s.Controller, repo: P9s.TestRepo

    def index(conn, _params), do: json(conn, P9s.TestConfig.who())

    def create(conn, _params) do
      Repo.query!("insert into p9s_elixir_note (body) values ('refused')")
      json(conn, :created)
    end

    def p9s_user_id(conn), do: conn |> Plug.Conn.get_req_header("x-user-id") |> List.first()
  end

  test "the controller acts as the user of the request, and forbids refused writes", %{identity: identity} do
    Application.put_env(:p9s, :config, write_config(identity))

    conn =
      Plug.Test.conn(:get, "/") |> Plug.Conn.put_req_header("x-user-id", "42") |> NotesController.call(:index)

    assert JSON.decode!(conn.resp_body) == ["p9s_elixir_user", "42"]

    conn =
      Plug.Test.conn(:post, "/") |> Plug.Conn.put_req_header("x-user-id", "42") |> NotesController.call(:create)

    assert conn.status == 403
    refute hd(who()) == "p9s_elixir_user"
  end

  defp write_config(_identity) do
    path = Path.join(System.tmp_dir!(), "p9s-elixir-#{System.unique_integer([:positive])}.config.json")
    File.write!(path, JSON.encode!(P9s.TestConfig.config()))
    path
  end
end
