# Adopting p9s in a Rails app

A [Rails](https://rubyonrails.org) API for projects and documents, as the [adoption tests](../adoption) describe it:
teams get access to projects, users to documents, and the app checks every request in its code.

## Before

[`before/`](./before) is the app as it was, an API only Rails app with Active Record.
[`db/migrate`](./before/db/migrate) creates the tables, with foreign keys that cascade in the database.
[`app/models/permissions.rb`](./before/app/models/permissions.rb) works out the access of a user from the tables
`team_members`, `project_shares` and `document_shares`, and every action of
[`DocumentsController`](./before/app/controllers/documents_controller.rb) asks it first.

## The migration

[`p9s.config.json`](./p9s.config.json) describes the tables: users and teams are roles, projects and documents are
resources, a document is in its project. Its `links` name the tables where the app keeps memberships and shares, and
which bits each access gives. With `authentication.key`, the app tells p9s the id of the user in its `users` table, and
with `grantPrivileges`, the migration grants `app_user` what its permissions name.

After `bin/rails db:migrate`, in the folder of the app, with `DATABASE_URL` set:

```bash
npx @p9s/cli postgres migrate --config p9s.config.json
```

It runs in one transaction, creates the role `app_user`, brings the rows of the link tables into the graph, and from
then on keeps the graph in step with them. `db/schema.rb` cannot hold the functions, triggers and policies of p9s: an
app that loads its schema, for tests, sets `config.active_record.schema_format = :sql`, or runs the migration of p9s
after `db:schema:load`.

To run p9s with the other migrations of the app instead, as a migration of Rails:

```bash
npx @p9s/cli postgres generate --config p9s.config.json --format rails
```

Then `bin/rails db:migrate` runs it, and the adoption test checks that too.

## After

[`after.patch`](./after.patch) adds the [`p9s`](../../packages/ruby) gem, deletes `app/models/permissions.rb`, and
includes `P9s::Controller` in the application controller, after the callback that finds the user:

```ruby
class ApplicationController < ActionController::API
  before_action :authenticate
  include P9s::Controller

  rescue_from ActiveRecord::StatementInvalid do |error|
    raise error unless P9s.refused?(error)

    forbidden
  end
```

Each action then runs in a transaction that acts as its user, read only for `GET`, and the policies decide what each
query reads and writes. A write they refuse fails with `insufficient_privilege`, the transaction rolls back, and the app
answers 403 when `P9s.refused?(error)` says so. An update or a delete of a document the user reads but cannot change
touches no row, and gets 403 too.

The models change in two ways. They ignore the `role_id` and `resource_id` columns p9s adds, which Active Record would
otherwise read and render. And `belongs_to` on documents and shares is `optional: true`: Active Record would check that
the project or the user exists by reading it, as the user, who may not see the project, and has no privilege on
`users`. The database checks the foreign keys anyway.

In an app, `gem "p9s"`. The example takes the gem of this repository, with a path in the `Gemfile`.

## The test

[`adoption.test.ts`](./adoption.test.ts) runs the app before, the migration, and the app after on a real Postgres, with
Ruby 3.4, Bundler and puma, and checks that every user gets the same answers, see [the adoption tests](../adoption):

```bash
P9S_ADOPTION_DATABASE_URL=postgresql://postgres@localhost:5432/postgres bun test examples/rails
```
