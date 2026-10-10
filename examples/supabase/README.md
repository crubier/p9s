# Adopting p9s in a Supabase app

A [Hono](https://hono.dev) API on [supabase-js](https://supabase.com/docs/reference/javascript) for projects and
documents, as the [adoption tests](../adoption) describe it: teams get access to projects, users to documents, and the
app checks every request in its code.

## Before

[`before/`](./before) is the app as it was. Its [Supabase migrations](./before/supabase/migrations) make the tables,
and its server reads and writes them with the service role key, which RLS lets through.
[`src/permissions.ts`](./before/src/permissions.ts) works out the access of a user from the tables `team_members`,
`project_shares` and `document_shares`, and every route of [`src/server.ts`](./before/src/server.ts) asks it first.

The checks are only in the server. Supabase grants `anon` and `authenticated` every privilege on the tables of
`public`, so anyone with the anon key of the project reads every table through the API, and a signed in user can add
themselves to any team.

## The migration

[`p9s.config.json`](./p9s.config.json) describes the tables: users and teams are roles, projects and documents are
resources, a document is in its project. Its `links` name the tables where the app keeps memberships and shares, and
which bits each access gives. Its engine is the `supabase` preset of `@p9s/core`, but for the current user: the users
of the app have ids of their own, so p9s reads the user from the `sub` claim of the JWT, which PostgREST sets in
`request.jwt.claims`, and finds them in `users` by `id`. With `grantPrivileges`, the migration grants `authenticated`
what its permissions name.

After `supabase migration up`, in the folder of the app, with the direct connection string in `DATABASE_URL`:

```bash
npx @p9s/cli postgres migrate --config p9s.config.json
```

It runs in one transaction, brings the rows of the link tables into the graph, and from then on keeps the graph in step
with them. `npx @p9s/cli postgres generate --config p9s.config.json --output supabase/migrations/<timestamp>_p9s.sql`
writes the same migration as a file of the Supabase CLI instead.

## After

[`adopt.patch`](./adopt.patch) is what [`p9s adopt`](../../packages/cli/src/adopt) writes: the 403 of refused writes in
`app.onError`. [`after.patch`](./after.patch) is the rest, by hand: it deletes `src/permissions.ts` and its checks, and
sends the requests of each user with a client of their own, whose JWT PostgREST runs as `authenticated`:

```ts
app.get("/documents", async c => c.json(await rows(c.get("supabase").from("documents").select("id, project_id, title").order("id"))));
```

A real app passes on the access token of the session. This one signs a token for the user of the request with the JWT
secret of the project, whose subject is their id in `users`, as custom JWTs or third party auth do.

The policies decide what each request reads and writes. A write they refuse fails with `insufficient_privilege`, which
supabase-js returns as the error of the query, and the app answers with 403 when `isRefused(error)` of `@p9s/postgres`
says so. An update or a delete of a document the user reads but cannot change returns no row, and gets 403 too.

The patch also adds a [migration](./after.patch) that takes back what Supabase grants `anon` and `authenticated` on the
tables of the app, so that the API gives them nothing but what p9s grants.

## The test

[`adoption.test.ts`](./adoption.test.ts) runs the app before, the migration, and the app after, on a real Postgres with
what a Supabase project has: its roles, an `auth` schema, its grants, and PostgREST under `/rest/v1`. It checks that
every user gets the same answers, and that after p9s the API lets neither `anon` read a table nor a signed in user
change memberships and shares, see [the adoption tests](../adoption):

```bash
P9S_ADOPTION_DATABASE_URL=postgresql://postgres@localhost:5432/postgres bun test examples/supabase
```
