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

```python
from contextlib import contextmanager
from sqlalchemy import text

AS_USER = text("select set_config('role', 'app_user', true), set_config('app.role_id', :user_id, true)")

@contextmanager
def as_user(Session, user_id):
    with Session.begin() as session:
        session.execute(AS_USER, {"user_id": str(user_id)})
        yield session

with as_user(Session, current_user.role_id) as session:
    documents = session.scalars(select(Document).order_by(Document.updated_at.desc()).limit(50)).all()
```

## Django

```python
from contextlib import contextmanager
from django.db import connection, transaction

@contextmanager
def as_user(user_id):
    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute("select set_config('role', 'app_user', true), set_config('app.role_id', %s, true)", [str(user_id)])
        yield

def documents(request):
    with as_user(request.user.profile.role_id):
        rows = list(Document.objects.order_by("-updated_at")[:50])
    return render(request, "documents.html", {"documents": rows})
```

A middleware can wrap every view the same way, but the tables Django reads for itself in the request, like sessions, then need grants to `app_user` too.

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

## Kysely and other TypeScript clients

`createIdentity(config)` gives the role and the setting of the config, and `statement(userId)` the whole first statement as `{ text, values }`, with `$1` parameters, for clients that take those:

```ts
import { sql } from "kysely";

const users = createIdentity(p9sConfig);
const documents = await db.transaction().execute(async trx => {
  await sql`select set_config('role', ${users.role}, true), set_config(${users.setting}, ${String(userId)}, true)`.execute(trx);
  return trx.selectFrom("document").select(["id", "title"]).orderBy("updated_at", "desc").limit(50).execute();
});
```
