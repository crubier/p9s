---
sidebar_position: 12
---

# Elixir

The [`p9s`](https://github.com/crubier/p9s/tree/main/packages/elixir) package runs a function in an Ecto transaction as a user, and every action of a Phoenix controller as the user of its request. [`examples/phoenix`](https://github.com/crubier/p9s/tree/main/examples/phoenix) adopts p9s in a Phoenix API with it.

## Install

```elixir
# mix.exs
{:p9s, "~> 0.1"}
```

## Config

The package reads the role and the setting from [the config](./adopting#the-config): `p9s.config.json` in the folder the app runs in, or the file of:

```elixir
config :p9s, config: "priv/p9s.config.json"
```

## Each request as its user

A plug cannot wrap the plugs after it in a transaction, so `P9s.Controller` wraps the actions of a controller, after `Phoenix.Controller`:

```elixir
def controller do
  quote do
    use Phoenix.Controller, formats: [:json]
    use P9s.Controller, repo: MyApp.Repo
  end
end
```

Every action then runs in a transaction as `conn.assigns.current_user.id`, read only for `GET`. Override `p9s_user_id/1` for another user. Elsewhere, `P9s.as_user/4` runs a function as a user:

```elixir
{:ok, documents} = P9s.as_user(Repo, user.id, fn -> Repo.all(Document) end, read_only: true)
```

It commits when the function returns, and rolls back when it raises or calls `Repo.rollback/1`. Options: `:read_only`, `:role`, another role of the config, `:settings`, other settings, and `:identity`. `P9s.set_user/3` acts as the user for the rest of a transaction already begun.

## Refused writes

A write the policies refuse rolls the transaction of the action back and calls `p9s_refused/2`, which answers 403 by default:

```elixir
def p9s_refused(conn, _error), do: conn |> put_status(403) |> json(%{error: "forbidden"})
```

`P9s.refused?(error)` tells, for `Postgrex.Error`. An `update_all` or a `delete_all` of rows the user reads but cannot change returns a count of 0.

## The migration

After `mix ecto.migrate`:

```bash
npx @p9s/cli postgres migrate --config p9s.config.json
```

Or as a migration of Ecto, in `priv/repo/migrations`, which `mix ecto.migrate` then runs. Its module is `<App>.Repo.Migrations`, from `mix.exs`, or `--module`:

```bash
npx @p9s/cli postgres generate --config p9s.config.json --format ecto
```

The schemas do not change: Ecto reads the fields its schemas name, and leaves the `role_id` and `resource_id` columns p9s adds to their defaults.

## The example

[`before/`](https://github.com/crubier/p9s/tree/main/examples/phoenix/before) checks every action with `lib/documents/permissions.ex`. [`after.patch`](https://github.com/crubier/p9s/blob/main/examples/phoenix/after.patch) deletes it and uses `P9s.Controller` in the controllers of the app.
