# p9s for Elixir

Act as a user of [p9s](https://github.com/crubier/p9s), permissions of trees in Postgres with row level security, from
Ecto and Phoenix: every query of a transaction runs as the role of the users of the config, with the id of the user in
the setting its current user function reads, so the policies of p9s decide what it reads and writes.

```elixir
{:p9s, "~> 0.1"}
```

The role and the setting come from the config of p9s, as for `createIdentity` of `@p9s/postgres`: `p9s.config.json`
in the folder the app runs in, or the file of `config :p9s, config: "priv/p9s.config.json"`.

## Ecto

```elixir
{:ok, documents} = P9s.as_user(Repo, user.id, fn -> Repo.all(Document) end, read_only: true)
```

`P9s.as_user/4` runs the function in a transaction as the user, commits when it returns, and rolls back when it raises
or calls `Repo.rollback/1`. The settings end with the transaction, so a pooled connection never keeps the identity of a
previous request. Options: `:read_only`, `:role`, another role of the config, `:settings`, other settings, and
`:identity`. `P9s.set_user/3` acts as the user for the rest of a transaction already begun.

## Phoenix

A plug cannot wrap the plugs after it in a transaction, so `P9s.Controller` wraps the actions of a controller, after
`Phoenix.Controller`:

```elixir
def controller do
  quote do
    use Phoenix.Controller, formats: [:json]
    use P9s.Controller, repo: MyApp.Repo

    def p9s_refused(conn, _error), do: conn |> put_status(403) |> json(%{error: "forbidden"})
  end
end
```

Every action then runs in a transaction as `conn.assigns.current_user.id`, read only for `GET`. Override
`p9s_user_id/1` for another user. A write the policies refuse rolls the transaction back and calls `p9s_refused/2`,
which answers 403 by default.

## Refused writes

Postgres refuses a row the policies do not let through, a statement the role has no privilege for, and a share of bits
the user does not have, with `insufficient_privilege`. `P9s.refused?(error)` tells, for `Postgrex.Error`. An
`update_all` or a `delete_all` of rows the user reads but cannot change returns a count of 0.

Example: [Phoenix](https://github.com/crubier/p9s/tree/main/examples/integrations/phoenix).
