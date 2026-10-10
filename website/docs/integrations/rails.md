---
sidebar_position: 9
---

# Rails

The [`p9s`](https://github.com/crubier/p9s/tree/main/packages/ruby) gem runs an Active Record block as a user, and every action of a Rails controller as the user of its request. [`examples/integrations/rails`](https://github.com/crubier/p9s/tree/main/examples/integrations/rails) adopts p9s in a Rails API with it.

The reference of each function, its options and its errors: [the `p9s` gem](../packages/ruby).

## p9s adopt

```bash
npx @p9s/cli adopt
bundle install
```

[`p9s adopt`](../packages/cli#adopt) adds the gem, includes `P9s::Controller` in the application controller with read only transactions for `GET` and `HEAD`, answers 403 to refused writes, and changes the models as [below](#models). With `--user-id @user_id`, the user is `@user_id` rather than `current_user.id`. Then delete the permission checks, as in [the example](#the-example). The sections below are what it writes, for an app that makes the changes by hand.

## Install

```ruby
gem "p9s"
```

## Config

The gem reads the role and the setting from [the config](./adopting#the-config): `p9s.config.json` at the root of the Rails app, or the file `P9S_CONFIG` names. Or set it in an initializer:

```ruby
P9s.identity = P9s::Identity.from_file(Rails.root.join("config/p9s.config.json"))
```

## Each request as its user

```ruby
class ApplicationController < ActionController::API
  before_action :authenticate
  include P9s::Controller
end
```

`P9s::Controller` runs every action in a transaction as `current_user.id`, after the callbacks that sign users in. Override `p9s_user_id` for another user, and `p9s_read_only?` for read only transactions, like `request.get?`. Elsewhere, in a job or a console, `P9s.as_user` runs a block as a user:

```ruby
P9s.as_user(user.id, read_only: true) { Document.order(updated_at: :desc).limit(50).to_a }
```

`P9s.set_user(user_id)` acts as the user for the rest of a transaction already begun.

## Refused writes

`P9s.refused?(error)` tells a write the policies refused, through `ActiveRecord::StatementInvalid`:

```ruby
rescue_from ActiveRecord::StatementInvalid do |error|
  raise error unless P9s.refused?(error)

  render json: { error: "forbidden" }, status: :forbidden
end
```

## The migration

After `bin/rails db:migrate`:

```bash
npx @p9s/cli postgres migrate --config p9s.config.json
```

Or as a migration of Rails, in `db/migrate`, which `bin/rails db:migrate` then runs:

```bash
npx @p9s/cli postgres generate --config p9s.config.json --format rails
```

`db/schema.rb` cannot hold the functions, triggers and policies of p9s. An app that loads its schema, for tests, sets `config.active_record.schema_format = :sql`, or runs the migration of p9s after `db:schema:load`.

## Models

The migration adds columns to the tables of roles and resources, like `resource_id`, with a default. Active Record reads and renders every column, so ignore them:

```ruby
class Document < ApplicationRecord
  self.ignored_columns += ["resource_id"]
  belongs_to :project, optional: true
end
```

`belongs_to` checks that the parent exists by reading it as the user, who may not see it, or have no privilege on its table: with `optional: true`, the database checks the foreign key, and the policies the rest.

## The example

[`before/`](https://github.com/crubier/p9s/tree/main/examples/integrations/rails/before) checks every action with `app/models/permissions.rb`. [`adopt.patch`](https://github.com/crubier/p9s/blob/main/examples/integrations/rails/adopt.patch) is what `p9s adopt --user-id @user_id` writes: the gem, `P9s::Controller` in the application controller, and the models as above. [`after.patch`](https://github.com/crubier/p9s/blob/main/examples/integrations/rails/after.patch) is the rest, by hand: it deletes `permissions.rb` and its checks, and answers refused writes with the JSON of the app.
