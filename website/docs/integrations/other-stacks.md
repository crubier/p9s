---
sidebar_position: 14
---

# Other stacks

p9s is a SQL migration: once it ran, any language reads and writes through the policies. Drizzle, Prisma, Kysely, SQLAlchemy, Django, Rails, Go, Rust, Elixir and Laravel have a package, see [adopting p9s](./adopting). Any other client does what they do, one statement at the start of each transaction of a user.

With [the config](./adopting#the-config), whose `engine.users` is `["app_user"]` and `authentication.setting` is `app.user_id`:

```sql
begin;                   -- or begin read only
select set_config('role', 'app_user', true), set_config('app.user_id', $1, true);
-- the queries of the request
commit;
```

- Pass the id of the user as text, a parameter of the statement, never in its text.
- The third argument of `set_config`, `true`, makes the settings end with the transaction, so a pooled connection never keeps the identity of a previous request, and a rolled back transaction leaves nothing either. Never use `set` or `set role` without `local` on a pooled connection.
- Read the role and the setting from the config rather than repeating them, as the packages do.
- A write the policies refuse fails with `insufficient_privilege`, SQLSTATE `42501`, which the app answers with 403. An update or a delete of a row the user reads but cannot change touches no row.

The [conformance suite](https://github.com/crubier/p9s/tree/main/packages/conformance) holds the cases every package passes, against a database its `prepare.ts` makes: reads and writes as several users on one connection, `insert ... returning`, a refused write, and a rollback. A new package can run them too.

## The migration

```bash
npx @p9s/cli postgres migrate --config p9s.config.json
```

Without Node, a [standalone binary](../packages/cli) of the CLI does the same. Or `p9s postgres generate` writes the migration as a plain SQL file, for any migration tool, see [the CLI](../packages/cli).
