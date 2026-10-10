---
sidebar_position: 8
---

# Ruby

The [`p9s`](https://github.com/crubier/p9s/tree/main/packages/ruby) gem runs Active Record transactions as a user, and every action of a Rails controller as the user of its request.

Guide: [Rails](../integrations/rails). Example: [Rails](https://github.com/crubier/p9s/tree/main/examples/integrations/rails).

## Install

```ruby
# Gemfile
gem "p9s", "~> 0.1"
```

Ruby 3.1 or later, and Active Record 7.0 or later.

## P9s

### P9s.identity

The [`P9s::Identity`](#p9sidentity) of `p9s.config.json`: the file `P9S_CONFIG` names, or the one at the root of the Rails app, read once. Set another with `P9s.identity = P9s::Identity.from_file(path)`.

### P9s.as_user

```ruby
titles = P9s.as_user(user.id, read_only: true) { Document.pluck(:title) }
```

`P9s.as_user(user_id, read_only: false, role: nil, settings: {}, identity: P9s.identity, model: ActiveRecord::Base) { ... }` runs the block in a transaction of the connection of `model`, as the user, and returns what it returns. Every query of the block goes through the policies. It commits when the block ends, and rolls back when it raises. Inside a transaction already, it acts as the user until that transaction ends.

| Option | |
| --- | --- |
| `read_only` | Runs `set transaction read only` first |
| `role` | Another role of `engine.users` or `engine.graphWriters`. Another raises `ArgumentError` |
| `settings` | Other settings of the transaction, like `{ "app.tenant_id" => 3 }`. `nil` sets them empty, and booleans `on` and `off` |
| `identity` | Another identity than `P9s.identity` |
| `model` | The model whose connection runs the transaction, for apps with several databases |

`user_id` is an id, or `nil` for no one.

### P9s.set_user

`P9s.set_user(user_id, read_only: false, role: nil, settings: {}, identity: P9s.identity, model: ActiveRecord::Base)` acts as the user for the rest of the current transaction, and returns `nil`.

### P9s.refused?

```ruby
rescue_from ActiveRecord::StatementInvalid do |error|
  raise error unless P9s.refused?(error)

  render json: { error: "forbidden" }, status: :forbidden
end
```

`P9s.refused?(error)` tells whether an error is Postgres refusing a statement to the user, with `insufficient_privilege`, `42501`, which `P9s::INSUFFICIENT_PRIVILEGE` holds: a row the policies do not let through, a statement the role has no privilege for, or a share of bits the user does not have. Active Record raises `ActiveRecord::StatementInvalid`, whose `cause` is the error of `pg`.

## P9s::Controller

```ruby
class ApplicationController < ActionController::API
  before_action :authenticate
  include P9s::Controller

  private

  def p9s_user_id = @user_id
  def p9s_read_only? = request.get? || request.head?
end
```

`include P9s::Controller` adds an `around_action` that runs every action in `P9s.as_user`. Include it after the callback that finds the user, as callbacks run in the order they are declared. It calls two private methods, which the controller overrides:

| Method | Default | |
| --- | --- | --- |
| `p9s_user_id` | `current_user&.id`, or `nil` without `current_user` | The id of the user of the request |
| `p9s_read_only?` | `false` | Whether the transaction is read only |

A write the policies refuse rolls the transaction back, and raises `ActiveRecord::StatementInvalid` from the action, for a `rescue_from` that tells it with `P9s.refused?`.

## P9s::Identity

`P9s::Identity.new(config, setting: nil, claim: nil)` reads the role and the setting from `engine` of a config, a hash with string keys, like [`createIdentity`](./postgres#createidentity), and `P9s::Identity.from_file(path, **options)` reads `p9s.config.json`. It raises `ArgumentError` when `engine.users` is empty, or when there is no setting.

| Method | |
| --- | --- |
| `role`, `setting`, `claim`, `roles` | The role transactions take, the first of `engine.users`, the setting the current user function reads, its claim or `nil`, and the roles of `engine.users` and `engine.graphWriters` |
| `value(user_id)` | The value of the setting for a user: the id as text, JSON claims, or `""` for `nil` |
| `settings(user_id, role: nil, settings: {})` | The settings of a transaction of the user, as `[name, value]` pairs, the role first |
| `statement(user_id, role: nil, settings: {})` | `["select set_config($1, $2, true), ...", values]` |
