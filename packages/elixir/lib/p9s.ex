defmodule P9s do
  @moduledoc """
  Act as a user of [p9s](https://github.com/crubier/p9s), permissions of trees in Postgres with row level security,
  from Ecto: every query of a transaction runs as the role of the users of the config, with the id of the user in the
  setting its current user function reads, so the policies of p9s decide what it reads and writes.

  The identity comes from `p9s.config.json`, the file of `config :p9s, config: "p9s.config.json"`, or the
  `:identity` option.
  """

  alias P9s.Identity

  @doc "The identity of the config of the application, read once"
  @spec identity() :: Identity.t()
  def identity do
    path = Application.get_env(:p9s, :config, "p9s.config.json") |> to_string()

    case :persistent_term.get({__MODULE__, path}, nil) do
      nil ->
        identity = Identity.from_file(path)
        :persistent_term.put({__MODULE__, path}, identity)
        identity

      identity ->
        identity
    end
  end

  @doc """
  Runs `fun` in a transaction of `repo` as the user: every query of it goes through the policies, it commits when `fun`
  returns, and rolls back when it raises or calls `repo.rollback/1`. Inside a transaction already, acts as the user
  until it ends. Returns `{:ok, result}` or `{:error, reason}`, like `repo.transaction/2`.

  Options: `:read_only`, `:role`, `:settings`, and `:identity`.
  """
  @spec as_user(module(), term(), (-> result), keyword()) :: {:ok, result} | {:error, term()} when result: term()
  def as_user(repo, user_id, fun, opts \\ []) do
    repo.transaction(fn ->
      set_user(repo, user_id, opts)
      fun.()
    end)
  end

  @doc "Acts as the user for the rest of the current transaction"
  @spec set_user(module(), term(), keyword()) :: :ok
  def set_user(repo, user_id, opts \\ []) do
    {statement, params} = Identity.statement(opts[:identity] || identity(), user_id, opts)
    repo.query!(statement, params)
    :ok
  end

  @doc """
  Whether an error is Postgres refusing a statement to the user, with insufficient_privilege (42501): a row the
  policies do not let through, a statement the role has no privilege for, or a share of bits the user does not have.
  """
  @spec refused?(term()) :: boolean()
  def refused?(%{postgres: %{code: :insufficient_privilege}}), do: true
  def refused?(%{postgres: %{pg_code: "42501"}}), do: true
  def refused?(_error), do: false
end
