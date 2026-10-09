Application.put_env(:phoenix, :json_library, JSON)

defmodule P9s.TestRepo do
  use Ecto.Repo, otp_app: :p9s, adapter: Ecto.Adapters.Postgres
end

defmodule P9s.ConformanceRepo do
  use Ecto.Repo, otp_app: :p9s, adapter: Ecto.Adapters.Postgres
end

defmodule P9s.TestConfig do
  def config do
    %{
      "engine" => %{
        "users" => ["p9s_elixir_user"],
        "graphWriters" => ["p9s_elixir_writer"],
        "authentication" => %{"getCurrentUserId" => "current_role_id", "setting" => "app.user_id"}
      },
      "tables" => []
    }
  end

  def who do
    %{rows: [row]} =
      P9s.TestRepo.query!("select current_user::text, coalesce(current_setting('app.user_id', true), '')")

    row
  end
end

excluded =
  case System.get_env("P9S_CONFORMANCE_DATABASE_URL") do
    nil ->
      [:conformance]

    url ->
      {:ok, _} = P9s.ConformanceRepo.start_link(url: url, pool_size: 1, log: false)
      []
  end

case System.get_env("P9S_TEST_DATABASE_URL") do
  nil ->
    ExUnit.start(exclude: [:database | excluded])

  url ->
    {:ok, _} = P9s.TestRepo.start_link(url: url, pool_size: 1, log: false)

    # A table the user role reads but cannot write, and the roles of the config
    for statement <- [
          """
          do $$
          begin
            if not exists (select from pg_roles where rolname = 'p9s_elixir_user') then create role p9s_elixir_user nologin; end if;
            if not exists (select from pg_roles where rolname = 'p9s_elixir_writer') then create role p9s_elixir_writer nologin; end if;
          end
          $$
          """,
          "grant p9s_elixir_user, p9s_elixir_writer to current_user",
          "drop table if exists p9s_elixir_note",
          "create table p9s_elixir_note (id serial primary key, body text not null)",
          "grant select on p9s_elixir_note to p9s_elixir_user",
          "grant select, insert on p9s_elixir_note to p9s_elixir_writer",
          "grant usage on sequence p9s_elixir_note_id_seq to p9s_elixir_writer"
        ] do
      P9s.TestRepo.query!(statement)
    end

    ExUnit.start(exclude: excluded)
end
