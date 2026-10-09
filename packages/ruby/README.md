# p9s for Ruby

Act as a user of [p9s](https://github.com/crubier/p9s), permissions of trees in Postgres with row level security, from
Active Record and Rails: every query of a transaction runs as the role of the users of the config, with the id of the
user in the setting its current user function reads, so the policies of p9s decide what it reads and writes.

```ruby
gem "p9s"
```

The role and the setting come from the config of p9s, as for `createIdentity` of `@p9s/postgres`: `p9s.config.json` at
the root of the Rails app, or the file `P9S_CONFIG` names. Or set it:

```ruby
P9s.identity = P9s::Identity.from_file(Rails.root.join("config/p9s.config.json"))
```

## Active Record

```ruby
P9s.as_user(current_user.id) do
  @documents = Document.order(updated_at: :desc).limit(50).to_a
end

P9s.as_user(current_user.id, read_only: true) { Document.count }
```

`P9s.as_user` begins a transaction, acts as the user in it, commits when the block ends and rolls back when it raises.
The settings end with the transaction, so a pooled connection never keeps the identity of a previous request.
`P9s.set_user(user_id)` acts as the user for the rest of a transaction already begun.

## Rails controllers

```ruby
class ApplicationController < ActionController::API
  include P9s::Controller

  rescue_from ActiveRecord::StatementInvalid do |error|
    raise error unless P9s.refused?(error)

    render json: { error: "forbidden" }, status: :forbidden
  end
end
```

`P9s::Controller` runs every action in a transaction as `current_user.id`. Override `p9s_user_id` for another user, and
`p9s_read_only?` for read only transactions, like `request.get?`. Include it after the callbacks that sign users in.

## Refused writes

Postgres refuses a row the policies do not let through, a statement the role has no privilege for, and a share of bits
the user does not have, with `insufficient_privilege`. `P9s.refused?(error)` tells, through
`ActiveRecord::StatementInvalid`.

## Models

The migration of p9s adds a column to the tables of roles and resources, like `resource_id`, with a default. Active
Record reads every column, so ignore it: `self.ignored_columns += ["resource_id"]`. `belongs_to` checks that the parent
exists by reading it as the user, who may not see it, or have no privilege on its table: with `optional: true`, the
database checks the foreign key, and the policies the rest.

Example: [Rails](https://github.com/crubier/p9s/tree/main/examples/rails).
