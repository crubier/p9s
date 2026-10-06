-- Business tables. Runs before sql/p9s.sql, which binds them to the permission graph, and can run again.

-- PostGraphile connects as the owner of the tables, and switches to app_user for every request. app_backend writes
-- the graph on its own, like the seed does.
do $$
begin
  if not exists (select from pg_roles where rolname = 'app_user') then create role app_user nologin; end if;
  if not exists (select from pg_roles where rolname = 'app_backend') then create role app_backend nologin; end if;
end
$$;

create extension if not exists "uuid-ossp";

-- The role id of the person a request is made for, from the claims of its token
create or replace function current_role_id() returns uuid
language sql stable as $$
  select nullif(current_setting('jwt.claims.role_id', true), '')::uuid
$$;

-- Root of both trees: projects are in an organization, and people are members of it
create table if not exists organization (
  id uuid primary key default uuid_generate_v4(),
  name text not null
);

create table if not exists person (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organization (id) on delete cascade,
  name text not null,
  email text not null unique
);
create index if not exists person_org_id_index on person (org_id);

-- A person can be in several teams: memberships are role edges, which app.sql lets admins write
create table if not exists team (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organization (id) on delete cascade,
  name text not null
);
create index if not exists team_org_id_index on team (org_id);

create table if not exists project (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organization (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create index if not exists project_org_id_index on project (org_id);

-- Tasks are nodes too, so that a single task can be shared
create table if not exists task (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid not null references project (id) on delete cascade,
  title text not null,
  done boolean not null default false,
  assignee_id uuid references person (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists task_project_id_index on task (project_id);
create index if not exists task_assignee_id_index on task (assignee_id);

-- Comments are leaves: they have the permissions of their task
create table if not exists comment (
  id uuid primary key default uuid_generate_v4(),
  task_id uuid not null references task (id) on delete cascade,
  author_id uuid references person (id) on delete set null,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists comment_task_id_index on comment (task_id);

grant usage on schema public to app_user, app_backend;
grant select on organization, person, team to app_user;
grant select, insert, update, delete on project, task, comment to app_user;
grant execute on function current_role_id() to app_user, app_backend;
