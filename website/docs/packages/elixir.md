---
sidebar_position: 11
---

# Elixir

[`p9s`](https://github.com/crubier/p9s/tree/main/packages/elixir) on Hex runs a function in an Ecto transaction as a user, and every action of a Phoenix controller as the user of its request.

Guide: [Elixir](../integrations/elixir). Example: [Phoenix](https://github.com/crubier/p9s/tree/main/examples/integrations/phoenix).

## Install

```elixir
# mix.exs
defp deps do
  [{:p9s, "~> 0.1"}]
end
```

Elixir 1.18 or later, with `ecto_sql` 3.12 and Postgrex. Phoenix 1.7 is optional, for `P9s.Controller`.

## Config

```elixir
config :p9s, config: "priv/p9s.config.json"
```

The identity comes from `p9s.config.json` in the folder the app runs in, or the file of `config :p9s, config: ...`. `P9s.identity/0` reads it once, and keeps it in `:persistent_term`.

## P9s

### as_user/4

```elixir
{:ok, titles} = P9s.as_user(Repo, user_id, fn -> Repo.all(from d in Document, select: d.title) end, read_only: true)
```

`P9s.as_user(repo, user_id, fun, opts \\ [])` runs `fun` in a transaction of `repo` as the user, and returns `{:ok, result}` or `{:error, reason}`, like `repo.transaction/2`. Every query of `fun` goes through the policies. It commits when `fun` returns, and rolls back when it raises or calls `repo.rollback/1`. Inside a transaction already, it acts as the user until that transaction ends.

| Option | |
| --- | --- |
| `:read_only` | Runs `set transaction read only` first |
| `:role` | Another role of `engine.users` or `engine.graphWriters`. Another raises `ArgumentError` |
| `:settings` | Other settings of the transaction, like `%{"app.tenant_id" => 3}`. `nil` sets them empty, and booleans `on` and `off` |
| `:identity` | Another identity than `P9s.identity/0` |

`user_id` is an id, or `nil` for no one.

### set_user/3

`P9s.set_user(repo, user_id, opts \\ [])` acts as the user for the rest of the current transaction, and returns `:ok`. It takes the options of `as_user/4`.

### refused?/1

`P9s.refused?(error)` tells whether an error is Postgres refusing a statement to the user, with `insufficient_privilege`, `42501`: a row the policies do not let through, a statement the role has no privilege for, or a share of bits the user does not have. It matches the `Postgrex.Error` that Ecto raises.

## P9s.Controller

```elixir
def controller do
  quote do
    use Phoenix.Controller, formats: [:json]
    use P9s.Controller, repo: MyApp.Repo

    def p9s_user_id(conn), do: conn.assigns.user_id
  end
end
```

`use P9s.Controller, repo: MyApp.Repo`, after `use Phoenix.Controller`, overrides `action/2` to run every action in `P9s.as_user/4`, read only for `GET` and `HEAD`. A plug cannot, as the transaction has to wrap the action. Two callbacks can be overridden:

| Callback | Default | |
| --- | --- | --- |
| `p9s_user_id(conn)` | `conn.assigns.current_user.id`, or `nil` | The id of the user of the request |
| `p9s_refused(conn, error)` | Sends 403 `Forbidden` and halts | The answer to a write the policies refuse, after the transaction rolled back |

An action whose transaction rolls back for another reason raises, and an error that is not a refusal is raised again.

## P9s.Identity

`P9s.Identity.new(config, opts \\ [])` reads the role and the setting from `engine` of a config, a map with string keys, like [`createIdentity`](./postgres#createidentity), and `P9s.Identity.from_file(path, opts \\ [])` reads `p9s.config.json`. The options are `:setting`, another setting to read the user from, with no claim, and `:claim`, the claim of JSON claims in the setting. They raise `ArgumentError` when `engine.users` is empty, or when there is no setting.

| Function | |
| --- | --- |
| `value(identity, user_id)` | The value of the setting for a user: the id as text, JSON claims, or `""` for `nil` |
| `settings(identity, user_id, opts \\ [])` | The settings of a transaction of the user, as `{name, value}` pairs, the role first, with `:role` and `:settings` |
| `statement(identity, user_id, opts \\ [])` | `{"select set_config($1, $2, true), ...", params}` |

The struct has `role`, `setting`, `claim` and `roles`, the roles of `engine.users` and `engine.graphWriters`.
