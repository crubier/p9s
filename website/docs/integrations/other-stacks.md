---
sidebar_position: 2
---

# Other stacks

p9s is a SQL migration: once it ran, any language reads and writes through the policies. The only thing the server does is to start every transaction of a user with the role and the id of that user, as [acting as a user](../configuration/identity) explains. These recipes assume this config:

```ts
engine: { users: ["app_user"], authentication: { getCurrentUserId: "current_role_id", setting: "app.role_id" } }
```

Each opens a transaction, sets the settings for that transaction only with `set_config(..., true)`, runs the queries of the request and commits. Pass the id as text, a parameter of `set_config`. For a read only transaction, run `set transaction read only` first. Generate the migration with the [CLI](../packages/cli) and run it with the migrations of your stack: `p9s postgres generate` writes a plain SQL file.

## SQLAlchemy

[`p9s`](https://github.com/crubier/p9s/tree/main/packages/python) on PyPI reads the role and the setting from the config, and runs a transaction of a session as the user, sync or async. [`examples/fastapi`](https://github.com/crubier/p9s/tree/main/examples/fastapi) adopts p9s in an existing FastAPI app with it:

```python
from p9s import Identity, is_refused
from p9s.sqlalchemy import as_user

users = Identity.from_file("p9s.config.json")

with Session(engine) as session, as_user(session, users, current_user.id):
    documents = session.scalars(select(Document).order_by(Document.updated_at.desc()).limit(50)).all()
```

`as_user_async` does the same for an `AsyncSession`, and `read_only=True` makes the transaction read only. `is_refused(error)` tells a write the policies refused, through the wrappers of SQLAlchemy. Alembic's autogenerate would drop the tables and columns of p9s, which the models do not know: an `include_object` that leaves what only the database has keeps them, see the example.

## Django

The same package has a middleware, which runs every request in a transaction as its user, `request.user.pk` by default. [`examples/django`](https://github.com/crubier/p9s/tree/main/examples/django) adopts p9s in an existing Django app with it:

```python
# settings.py
P9S_CONFIG = BASE_DIR / "p9s.config.json"
MIDDLEWARE = [..., "django.contrib.auth.middleware.AuthenticationMiddleware", "p9s.django.P9sMiddleware"]
```

`@as_request_user` does it for one view, and `with as_user(user_id):` for a block, in a task or a command. Then the tables Django reads for itself in the request, like sessions, need grants to `app_user` too. Foreign keys should cascade in the database, with `on_delete=models.DB_CASCADE`: with `models.CASCADE`, Django deletes the dependent rows itself, as the user.

## Rails

The [`p9s`](https://github.com/crubier/p9s/tree/main/packages/ruby) gem reads the role and the setting from `p9s.config.json`, runs an Active Record block as the user, and runs every action of a controller as `current_user.id`. [`examples/rails`](https://github.com/crubier/p9s/tree/main/examples/rails) adopts p9s in an existing Rails app with it:

```ruby
class ApplicationController < ActionController::API
  include P9s::Controller

  rescue_from ActiveRecord::StatementInvalid do |error|
    raise error unless P9s.refused?(error)

    render json: { error: "forbidden" }, status: :forbidden
  end
end

P9s.as_user(current_user.id) { @documents = Document.order(updated_at: :desc).limit(50).to_a }
```

Models ignore the columns p9s adds, with `self.ignored_columns += ["resource_id"]`, and `belongs_to` a parent the user may not read is `optional: true`, as the database checks the foreign key. `db/schema.rb` cannot hold the policies of p9s, so use `config.active_record.schema_format = :sql`.

## Go

The [`p9s`](https://github.com/crubier/p9s/tree/main/packages/go) module reads the role and the setting from `p9s.config.json`, and runs a function in a transaction as the user, for `database/sql`, pgx with `p9spgx`, and GORM with `p9sgorm`. [`examples/gorm`](https://github.com/crubier/p9s/tree/main/examples/gorm) adopts p9s in an existing `net/http` and GORM app with it:

```go
var users = p9s.Must(p9s.FromFile("p9s.config.json"))

err := p9sgorm.AsUser(ctx, db, users, userID, func(tx *gorm.DB) error {
	return tx.Order("updated_at desc").Limit(50).Find(&documents).Error
}, p9s.ReadOnly(true))
if p9s.IsRefused(err) {
	// 403
}
```

## sqlx and axum

The [`p9s`](https://github.com/crubier/p9s/tree/main/packages/rust) crate reads the role and the setting from `p9s.config.json`, and begins a sqlx transaction as the user. With its `axum` feature, `UserTx` extracts a transaction as the user of the request. [`examples/axum`](https://github.com/crubier/p9s/tree/main/examples/axum) adopts p9s in an existing axum and sqlx app with it:

```rust
let users = p9s::Identity::from_file("p9s.config.json")?;
let mut tx = users.as_user(&pool, user_id).await?;
let documents: Vec<Document> = sqlx::query_as("select id, title from documents order by updated_at desc limit 50")
    .fetch_all(&mut *tx)
    .await?;
tx.commit().await?;
```

`p9s::is_refused(&error)` tells a write the policies refused.

## Ecto and Phoenix

The [`p9s`](https://github.com/crubier/p9s/tree/main/packages/elixir) package reads the role and the setting from `p9s.config.json`, and runs a function in an Ecto transaction as the user. `use P9s.Controller` runs every action of a Phoenix controller as the user of its request. [`examples/phoenix`](https://github.com/crubier/p9s/tree/main/examples/phoenix) adopts p9s in an existing Phoenix app with it:

```elixir
{:ok, documents} =
  P9s.as_user(Repo, user.id, fn -> Repo.all(from d in Document, order_by: [desc: d.updated_at], limit: 50) end)
```

`P9s.refused?(error)` tells a write the policies refused.

## Laravel

```php
$documents = DB::transaction(function () use ($userId) {
    DB::select("select set_config('role', 'app_user', true), set_config('app.role_id', ?, true)", [(string) $userId]);
    return Document::orderByDesc('updated_at')->limit(50)->get();
});
```

## Kysely

`withUser` of `@p9s/kysely` runs a Kysely transaction as the user. [`examples/kysely`](https://github.com/crubier/p9s/tree/main/examples/kysely) adopts p9s in an existing Hono and Kysely app with it:

```ts
import { createIdentity } from "@p9s/postgres";
import { withUser } from "@p9s/kysely";

const users = createIdentity(p9sConfig);
const documents = await withUser(db, users, userId, trx =>
  trx.selectFrom("document").select(["id", "title"]).orderBy("updated_at", "desc").limit(50).execute(), { readOnly: true });
```

## Other TypeScript clients

`createIdentity(config)` gives the role and the setting of the config, and `statement(userId)` the whole first statement as `{ text, values }`, with `$1` parameters, for clients that take those. With node-postgres, `run(pool, userId, fn)` does it all, see [acting as a user](../configuration/identity#node-postgres-neon-and-pglite).
