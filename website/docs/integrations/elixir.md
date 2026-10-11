---
sidebar_position: 12
---

# Elixir

The [`p9s`](https://github.com/crubier/p9s/tree/main/packages/elixir) package runs a function in an Ecto transaction as a user, and every action of a Phoenix controller as the user of its request. [`examples/integrations/phoenix`](https://github.com/crubier/p9s/tree/main/examples/integrations/phoenix) adopts p9s in a Phoenix API with it.

The reference of each function, its options and its errors: [`p9s` on Hex](../packages/elixir).

## p9s adopt

```bash
npx @p9s/cli adopt
mix deps.get
```

[`p9s adopt`](../packages/cli#adopt) adds `p9s` to the deps of `mix.exs`, and `use P9s.Controller` with the repo of the app to the `controller` of `lib/<app>_web.ex`, which every controller uses. With `--user-id conn.assigns.user_id`, or any expression of `conn`, it defines `p9s_user_id/1`, which is `conn.assigns.current_user.id` by default. Then delete the permission checks, as in [the example](#the-example). The sections below are what it writes, for an app that makes the changes by hand.

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

[`before/`](https://github.com/crubier/p9s/tree/main/examples/integrations/phoenix/before) checks every action with `lib/documents/permissions.ex`. [`adopt.patch`](https://github.com/crubier/p9s/blob/main/examples/integrations/phoenix/adopt.patch) is what `p9s adopt --user-id conn.assigns.user_id` writes: the package, and `P9s.Controller` in the controllers of the app. [`after.patch`](https://github.com/crubier/p9s/blob/main/examples/integrations/phoenix/after.patch) is the rest, by hand: it deletes `permissions.ex` and its checks, and answers refused writes with the JSON of the app, in `p9s_refused/2`.

## Benchmark

The [example](https://github.com/crubier/p9s/tree/main/examples/integrations/phoenix) before p9s and after p9s, each on its own database with the rows of [`benchmark-seed.sql`](https://github.com/crubier/p9s/blob/main/examples/integrations/adoption/benchmark-seed.sql): 1000 users in 100 teams, 1000 projects and 20,000 documents, of which each user reads about 1200. 20 of the users send each request 600 times to each app, 4 at a time, in 3 rounds that switch which app goes first. Times are in milliseconds.

| Request | Before: median | p95 | Requests/s | After: median | p95 | Requests/s | After / before |
|---|---:|---:|---:|---:|---:|---:|---:|
| List projects `GET /projects` | 0.41 | 0.63 | 9,111 | 0.95 | 1.31 | 4,021 | 2.32× |
| List documents `GET /documents` | 4.25 | 4.98 | 923 | 4.51 | 5.33 | 873 | 1.06× |
| Read a document `GET /documents/:id` | 0.49 | 0.76 | 7,625 | 0.8 | 1.13 | 4,765 | 1.63× |
| Create a document `POST /documents` | 0.35 | 0.63 | 10,590 | 1.21 | 1.84 | 3,082 | 3.46× |
| Update a document `PATCH /documents/:id` | 0.61 | 1.02 | 6,068 | 3.71 | 4.28 | 1,077 | 6.08× |
| Share a document `PUT /documents/:id/shares/:user_id` | 0.61 | 1.06 | 5,885 | 1.48 | 2.07 | 2,529 | 2.43× |

Measured on 2026-10-11: Apple M2 Max, 12 cores, 64 GiB, Darwin 25.6.0 arm64. Elixir 1.20.4, Erlang/OTP 29, PostgreSQL 18.6, p9s 0.1.0. [How it runs](../benchmarks#the-examples).
