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

```ruby
def as_user(user_id)
  ActiveRecord::Base.transaction do
    ActiveRecord::Base.connection.execute(ActiveRecord::Base.sanitize_sql_array(
      ["select set_config('role', 'app_user', true), set_config('app.role_id', ?, true)", user_id.to_s]
    ))
    yield
  end
end

as_user(current_user.role_id) { @documents = Document.order(updated_at: :desc).limit(50).to_a }
```

## GORM

```go
err := db.Transaction(func(tx *gorm.DB) error {
	if err := tx.Exec("select set_config('role', 'app_user', true), set_config('app.role_id', ?, true)", fmt.Sprint(userID)).Error; err != nil {
		return err
	}
	return tx.Order("updated_at desc").Limit(50).Find(&documents).Error
})
```

## sqlx

```rust
let mut tx = pool.begin().await?;
sqlx::query("select set_config('role', 'app_user', true), set_config('app.role_id', $1, true)")
    .bind(user_id.to_string())
    .execute(&mut *tx)
    .await?;
let documents = sqlx::query_as::<_, Document>("select id, title from document order by updated_at desc limit 50")
    .fetch_all(&mut *tx)
    .await?;
tx.commit().await?;
```

## Ecto

```elixir
Repo.transaction(fn ->
  Repo.query!("select set_config('role', 'app_user', true), set_config('app.role_id', $1, true)", [to_string(user_id)])
  Repo.all(from d in Document, order_by: [desc: d.updated_at], limit: 50)
end)
```

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
