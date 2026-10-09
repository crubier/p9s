# Changelog

The packages `@p9s/core`, `@p9s/postgres`, `@p9s/drizzle`, `@p9s/prisma` and `@p9s/cli` share one version. The migration
can be run again on a database made by an earlier version: upgrading is generating it with the new version and running
it, see [upgrading](https://p9s.vercel.app/docs/configuration/upgrading).

## 0.1.0

First release on npm.

- `@p9s/postgres` generates the migration: resource and role graphs over your tables, caches kept exact by triggers, and
  row level security policies that decide as the statement runs. See the [documentation](https://p9s.vercel.app/docs/intro).
- Acting as a user: with `engine.authentication.setting`, the migration creates the current user function, and
  `createIdentity` runs transactions as a user, sets the `pgSettings` of PostGraphile, or gives the first statement of a
  transaction to any client. `@p9s/drizzle` and `@p9s/prisma` do the same for Drizzle and Prisma, and the documentation
  has recipes for SQLAlchemy, Django, Rails, GORM, sqlx, Ecto and Laravel.
- The migration records the version of p9s and a hash of what it ran, and `p9s postgres status` compares them with a
  config.
- `p9s init` proposes a config from the tables and foreign keys of a database.
- `p9s postgres doctor` checks the roles, RLS, grants, indexes, JIT and caches of a database.
- A `supabase` preset, and a [Supabase guide](https://p9s.vercel.app/docs/integrations/supabase). The migration takes
  back what other roles, like `anon` through the default privileges of Supabase, have on the objects of p9s.
- Users read back the rows they insert, with `insert ... returning`, as ORMs and PostgREST do.
