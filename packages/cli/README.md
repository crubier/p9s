# @p9s/cli

The command line of [p9s](https://p9s.vercel.app), hierarchical permissions for Postgres enforced with Row Level Security.

```sh
npm install --save-dev @p9s/cli
npx p9s init --database-url postgresql://... --users app_user   # propose a config from the tables of a database
npx p9s postgres generate --config p9s.config.ts --output p9s.sql
npx p9s postgres status                                         # did the database run this migration?
npx p9s postgres doctor                                         # roles, RLS, grants, indexes, JIT and caches
```

See the [CLI documentation](https://p9s.vercel.app/docs/packages/cli).
