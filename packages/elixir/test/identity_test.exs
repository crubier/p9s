defmodule P9s.IdentityTest do
  use ExUnit.Case, async: true

  alias P9s.Identity

  test "settings take the first user role and the setting" do
    users = Identity.new(P9s.TestConfig.config())
    assert users.role == "p9s_elixir_user"
    assert Identity.settings(users, 7) == [{"role", "p9s_elixir_user"}, {"app.user_id", "7"}]
    assert Identity.settings(users, nil) == [{"role", "p9s_elixir_user"}, {"app.user_id", ""}]

    assert Identity.settings(users, "alice",
             role: "p9s_elixir_writer",
             settings: [{"app.audit", true}, {"app.reason", nil}]
           ) ==
             [{"role", "p9s_elixir_writer"}, {"app.user_id", "alice"}, {"app.audit", "on"}, {"app.reason", ""}]
  end

  test "the statement has positional parameters" do
    assert Identity.statement(Identity.new(P9s.TestConfig.config()), 7) ==
             {"select set_config($1, $2, true), set_config($3, $4, true)",
              ["role", "p9s_elixir_user", "app.user_id", "7"]}
  end

  test "a claim sets JSON claims" do
    config = %{
      "engine" => %{
        "users" => ["authenticated"],
        "authentication" => %{"setting" => "request.jwt.claims", "claim" => "sub"}
      }
    }

    assert Identity.value(Identity.new(config), 7) == ~s({"sub":"7"})
    assert Identity.value(Identity.new(config, setting: "app.user_id"), 7) == "7"
  end

  @tag :tmp_dir
  test "from_file", %{tmp_dir: directory} do
    path = Path.join(directory, "p9s.config.json")
    File.write!(path, JSON.encode!(P9s.TestConfig.config()))
    assert Identity.from_file(path).setting == "app.user_id"
  end

  test "roles and settings are checked" do
    assert_raise ArgumentError, ~r/not a role/, fn ->
      Identity.settings(Identity.new(P9s.TestConfig.config()), 7, role: "postgres")
    end

    assert_raise ArgumentError, ~r/engine.users is empty/, fn ->
      Identity.new(%{"engine" => %{"authentication" => %{"setting" => "s"}}})
    end

    assert_raise ArgumentError, ~r/engine.authentication.setting/, fn ->
      Identity.new(%{"engine" => %{"users" => ["app_user"]}})
    end
  end

  test "refused? reads the code of Postgres" do
    assert P9s.refused?(%Postgrex.Error{postgres: %{code: :insufficient_privilege}})
    assert P9s.refused?(%{postgres: %{pg_code: "42501"}})
    refute P9s.refused?(%Postgrex.Error{postgres: %{code: :unique_violation}})
    refute P9s.refused?(%RuntimeError{message: "nope"})
  end
end
