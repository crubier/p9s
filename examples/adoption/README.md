# Adoption tests

Each example of a stack, like [`examples/kysely`](../kysely), is an app that checks permissions in its own code, and the
change that hands those checks to p9s:

- `before/`: the app as it was, with its own migrations, and its permission checks in its code
- `p9s.config.json`: the config that describes its tables, and the tables where it keeps memberships and shares
- `after.patch`: the change to the code once p9s runs, which removes the permission checks and runs the queries of
  each request as the user
- `adoption.json`: how to set the app up, run its migrations, and start it, and the `format` of its migration tool for
  `p9s postgres generate --format`, see [`harness.ts`](./harness.ts). With
  `"stack": "supabase"`, each database gets what a Supabase project has, its roles, `auth` schema and grants, and the
  app gets PostgREST under `/rest/v1` of `SUPABASE_URL`, with the keys of the project, see [`supabase.ts`](./supabase.ts)
- `adoption.test.ts`: the test, which calls the harness of this folder

The adoption itself is one command, in the folder of the app:

```bash
npx @p9s/cli postgres migrate --config p9s.config.json
```

## What the test does

1. Copies `before/` twice, applies `after.patch` to the second copy, and creates two databases
2. Runs the migrations of the app on the first database, loads [`seed.sql`](./seed.sql), starts the app, and runs the
   [scenario](./scenario.ts): requests of each user, each with the status the rules below give
3. Runs the p9s migration on that database, in one command
4. Connects as each user, and checks that they read the projects and documents the rules give, and that the database
   refuses the writes the rules refuse and lets through the others
5. Runs `p9s postgres doctor`, which must find nothing wrong
6. Runs the migrations of the app on the second database, loads the seed, runs the p9s migration, starts the app after
   the patch, and runs the scenario again: every answer must be the same as before. On Supabase, the API itself must
   not let `anon` read any table, nor a signed in user read or write memberships and shares
7. Runs the p9s migration again on both databases: it is up to date, and forcing it changes no row
8. With a `format` in `adoption.json`, writes the migration of p9s in the format of the migration tool of the app, with
   `p9s postgres generate --format`, into the migrations of the app after the patch. Its migrate command makes a third
   database, which `p9s postgres status` finds up to date, and where each user reads and writes as the rules say, with
   the rows of the seed inserted after p9s

`P9S_ADOPTION_DATABASE_URL` is a Postgres server where the role of the URL can create databases and roles, like
`postgresql://postgres@localhost:5432/postgres`. Without it, the tests are skipped. Run the tests of one example with
`bun test examples/kysely`, and keep the databases and copies with `P9S_ADOPTION_KEEP=1`. The Supabase example
downloads a release of PostgREST once, or takes the binary of `P9S_POSTGREST`, or `postgrest` on the `PATH`.

To change the code after p9s, `bun examples/adoption/patch.ts edit kysely` writes the patched copy to
`examples/kysely/.adoption-edit`, and `bun examples/adoption/patch.ts save kysely` writes the patch again from it.

## The app

### Tables

The migrations of every app make the same tables, with these names and columns:

```sql
create table users (id serial primary key, name text not null unique);
create table teams (id serial primary key, name text not null unique);
create table team_members (
  team_id integer not null references teams on delete cascade,
  user_id integer not null references users on delete cascade,
  primary key (team_id, user_id)
);
create table projects (id serial primary key, name text not null);
create table project_shares (
  project_id integer not null references projects on delete cascade,
  team_id integer not null references teams on delete cascade,
  access text not null check (access in ('viewer', 'editor', 'owner')),
  primary key (project_id, team_id)
);
create table documents (
  id serial primary key,
  project_id integer not null references projects on delete cascade,
  title text not null,
  body text not null default ''
);
create index documents_project_id_idx on documents (project_id);
create table document_shares (
  document_id integer not null references documents on delete cascade,
  user_id integer not null references users on delete cascade,
  access text not null check (access in ('viewer', 'editor')),
  primary key (document_id, user_id)
);
```

### Rules

- `viewer` gives `read`, `editor` gives `read` and `write`, `owner` gives `read`, `write` and `delete`
- On a project, a user has the bits of the shares of the project with the teams they are in
- On a document, a user has the bits they have on its project, and those of the share of the document with them
- Reading needs `read`, creating a document in a project needs `write` on the project, updating a document `write`,
  deleting it `delete`
- Sharing a document with a user needs `read` on it, and the user who shares must have every bit of the access they
  give, and of the access the share gave before

### API

Every request but `GET /health` tells the user with the header `x-user-id`, the id of the user in `users`. Bodies are
JSON, and errors are `{ "error": "unauthorized" }` (401), `{ "error": "not found" }` (404) and
`{ "error": "forbidden" }` (403).

| Request | Answer |
| --- | --- |
| `GET /health` | 200 |
| `GET /projects` | 200, the projects the user reads, by id: `[{ id, name }]` |
| `GET /documents` | 200, the documents the user reads, by id: `[{ id, project_id, title }]` |
| `GET /documents/:id` | 200 `{ id, project_id, title, body }`, 404 when the user does not read it |
| `POST /documents` with `{ project_id, title, body? }` | 201 with the document, 403 without `write` on the project |
| `PATCH /documents/:id` with `{ title?, body? }` | 200 with the document, 404 when the user does not read it, 403 without `write` |
| `DELETE /documents/:id` | 204, 404 when the user does not read it, 403 without `delete` |
| `PUT /documents/:id/shares/:user_id` with `{ access }` | 204, 404 when the user does not read the document, 403 when the access or the share before have bits the user does not have |

A request without `x-user-id` gets 401.
