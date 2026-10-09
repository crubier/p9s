defmodule P9s.Identity do
  @moduledoc """
  What a transaction needs to act as an application user: the database role the policies are for, and the setting the
  current user function of the migration reads, from `engine.authentication` of the config of p9s, like
  `createIdentity` of `@p9s/postgres`. Both are set with `set_config(..., true)`, so that they end with the
  transaction, and a pooled connection never keeps the identity of a previous request.
  """

  @enforce_keys [:role, :setting, :roles]
  defstruct [:role, :setting, :claim, :roles]

  @type t :: %__MODULE__{role: String.t(), setting: String.t(), claim: String.t() | nil, roles: MapSet.t(String.t())}

  @doc """
  The identity of a config of p9s, a map with string keys. Options: `:setting`, another setting to read the user from,
  with no claim, and `:claim`, the claim of JSON claims in the setting.
  """
  @spec new(map(), keyword()) :: t()
  def new(config, opts \\ []) do
    engine = config["engine"] || %{}
    authentication = engine["authentication"] || %{}

    role =
      case engine["users"] do
        [role | _] -> role
        _ -> raise ArgumentError, "p9s: engine.users is empty"
      end

    setting = opts[:setting] || authentication["setting"]

    if setting in [nil, ""] do
      raise ArgumentError,
            ~s(p9s: set engine.authentication.setting, like "app.user_id", for the migration to read the current ) <>
              "user from it, or pass the setting the current user function reads"
    end

    claim = Keyword.get(opts, :claim, if(opts[:setting], do: nil, else: authentication["claim"]))
    roles = MapSet.new((engine["users"] || []) ++ (engine["graphWriters"] || []))
    %__MODULE__{role: role, setting: setting, claim: claim, roles: roles}
  end

  @doc "The identity of `p9s.config.json`"
  @spec from_file(Path.t(), keyword()) :: t()
  def from_file(path, opts \\ []), do: path |> File.read!() |> JSON.decode!() |> new(opts)

  @doc "The value of the setting for a user, empty for no user"
  @spec value(t(), term()) :: String.t()
  def value(_identity, nil), do: ""
  def value(%__MODULE__{claim: nil}, user_id), do: to_string(user_id)
  def value(%__MODULE__{claim: claim}, user_id), do: JSON.encode!(%{claim => to_string(user_id)})

  @doc """
  The settings of a transaction of the user, as `{name, value}` pairs, the role first. Options: `:role`, another role of
  `engine.users` or `engine.graphWriters`, and `:settings`, other settings, like `%{"app.tenant_id" => 3}`.
  """
  @spec settings(t(), term(), keyword()) :: [{String.t(), String.t()}]
  def settings(%__MODULE__{} = identity, user_id, opts \\ []) do
    role = opts[:role] || identity.role

    unless MapSet.member?(identity.roles, role) do
      raise ArgumentError, "p9s: #{role} is not a role of engine.users or engine.graphWriters"
    end

    others = for {name, value} <- opts[:settings] || [], do: {to_string(name), text(value)}
    [{"role", role}, {identity.setting, value(identity, user_id)} | others]
  end

  @doc "The statement to run first in a transaction, and its parameters: `select set_config($1, $2, true), ...`"
  @spec statement(t(), term(), keyword()) :: {String.t(), [String.t()]}
  def statement(identity, user_id, opts \\ []) do
    pairs = settings(identity, user_id, opts)
    calls = for index <- 0..(length(pairs) - 1), do: "set_config($#{2 * index + 1}, $#{2 * index + 2}, true)"
    {"select " <> Enum.join(calls, ", "), Enum.flat_map(pairs, fn {name, value} -> [name, value] end)}
  end

  defp text(nil), do: ""
  defp text(true), do: "on"
  defp text(false), do: "off"
  defp text(value), do: to_string(value)
end
