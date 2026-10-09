defmodule P9s.ConformanceTest do
  # The conformance suite of p9s, see packages/conformance
  use ExUnit.Case

  alias P9s.ConformanceRepo, as: Repo

  @moduletag :conformance

  @suite Path.expand("../../conformance", __DIR__)
  @cases @suite |> Path.join("cases.json") |> File.read!() |> JSON.decode!()

  setup_all do
    {:ok, users: P9s.Identity.from_file(Path.join(@suite, @cases["config"]))}
  end

  defp rows(sql), do: Repo.query!(sql).rows

  test "the role and the setting come from the config", %{users: users} do
    assert {users.role, users.setting} == {@cases["role"], @cases["setting"]}
  end

  test "each user reads their rows, on one connection, in turns", %{users: users} do
    for _ <- 1..2, %{"user" => user, "ids" => ids} <- @cases["reads"] do
      assert P9s.as_user(Repo, user, fn -> Enum.map(rows(@cases["read"]), &hd/1) end, identity: users, read_only: true) ==
               {:ok, ids}
    end
  end

  test "insert ... returning works", %{users: users} do
    %{"user" => user, "sql" => sql, "folderId" => folder_id} = @cases["insert"]
    assert {:ok, [[id, ^folder_id]]} = P9s.as_user(Repo, user, fn -> rows(sql) end, identity: users)
    assert id > 3
  end

  test "a refused write is an error", %{users: users} do
    %{"user" => user, "sql" => sql} = @cases["refused"]
    error = assert_raise Postgrex.Error, fn -> P9s.as_user(Repo, user, fn -> rows(sql) end, identity: users) end
    assert P9s.refused?(error)
  end

  test "a rolled back transaction leaves nothing on the connection", %{users: users} do
    user = @cases["whoUser"]

    assert P9s.as_user(Repo, user, fn -> Repo.rollback(rows(@cases["who"])) end, identity: users) ==
             {:error, [[@cases["role"], to_string(user)]]}

    assert_raise RuntimeError, fn -> P9s.as_user(Repo, user, fn -> raise "rolled back" end, identity: users) end
    [[role, user_id]] = rows(@cases["who"])
    refute role == @cases["role"]
    assert user_id == ""
  end
end
