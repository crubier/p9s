-- The tables, and what p9s expects from the application: the database roles, and the function telling who the
-- current user is. Runs before sql/p9s.sql, which binds the tables to the permission graph, and can run again.

-- app_user runs the requests of members, through RLS. app_backend writes the graph, inside the functions of
-- sql/app.sql that check first that the member may. Neither can log in: the server connects as the owner of the tables,
-- and PostGraphile switches to app_user for every request.
do $$
begin
  if not exists (select from pg_roles where rolname = 'app_user') then create role app_user nologin; end if;
  if not exists (select from pg_roles where rolname = 'app_backend') then create role app_backend nologin; end if;
end
$$;
grant app_user, app_backend to current_user;
grant usage on schema public to app_user, app_backend;

create extension if not exists pg_trgm;

-- The role id of the member, or API key, a request is made for. The server sets it for every request.
create or replace function current_role_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.role_id', true), '')::uuid
$$;
grant execute on function current_role_id() to app_user, app_backend;

-- Better Auth. These tables are not part of the permission graph: people act through their membership of an
-- organization

create table if not exists "user" (
  id text primary key,
  name text not null,
  email text not null unique,
  email_verified boolean not null default false,
  image text,
  created_at timestamp not null default now(),
  updated_at timestamp not null default now()
);

create table if not exists session (
  id text primary key,
  expires_at timestamp not null,
  token text not null unique,
  created_at timestamp not null default now(),
  updated_at timestamp not null,
  ip_address text,
  user_agent text,
  user_id text not null references "user" (id) on delete cascade
);
create index if not exists session_user_id_idx on session (user_id);

create table if not exists account (
  id text primary key,
  account_id text not null,
  provider_id text not null,
  user_id text not null references "user" (id) on delete cascade,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamp,
  refresh_token_expires_at timestamp,
  scope text,
  password text,
  created_at timestamp not null default now(),
  updated_at timestamp not null
);
create index if not exists account_user_id_idx on account (user_id);

create table if not exists verification (
  id text primary key,
  identifier text not null,
  value text not null,
  expires_at timestamp not null,
  created_at timestamp not null default now(),
  updated_at timestamp not null default now()
);
create index if not exists verification_identifier_idx on verification (identifier);

-- The workspace. `resource_id` and `role_id` are the ids of the rows in the permission graph, which p9s fills

-- A root of both trees: the resource that holds the members, teams and spaces, and the role of everyone in it
create table if not exists organization (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  resource_id uuid unique,
  role_id uuid unique,
  created_at timestamp not null default now()
);

-- A group of members. A resource in its organization, so that admins manage it through RLS, and a role, whose
-- members are role edges
create table if not exists team (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organization (id) on delete cascade,
  name text not null,
  resource_id uuid unique,
  role_id uuid unique,
  created_at timestamp not null default now()
);
create index if not exists team_org_id_idx on team (org_id);

-- A user in an organization: the role the user acts as in that organization. It is a child of the organization in
-- both trees, through the same column: admins add members through RLS, and members get what is assigned to everyone
create table if not exists member (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organization (id) on delete cascade,
  user_id text not null references "user" (id) on delete cascade,
  resource_id uuid unique,
  role_id uuid unique,
  created_at timestamp not null default now(),
  unique (org_id, user_id)
);
create index if not exists member_org_id_idx on member (org_id);
create index if not exists member_user_id_idx on member (user_id);

-- A key to call the API on behalf of a member. A role leaf: it acts with exactly the permissions of its member
create table if not exists api_key (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references member (id) on delete cascade,
  name text not null,
  token_hash text not null unique,
  token_start text not null,
  role_id uuid unique,
  created_at timestamp not null default now(),
  last_used_at timestamp
);
create index if not exists api_key_member_id_idx on api_key (member_id);

-- A folder is in its parent folder, or at the top of its organization, then called a space: p9s follows the parent
-- folder, or else the organization. The foreign key on both columns keeps a folder in the organization of its parent.
create table if not exists folder (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organization (id) on delete cascade,
  parent_id uuid,
  name text not null,
  resource_id uuid unique,
  created_at timestamp not null default now(),
  constraint folder_id_org_id_unique unique (id, org_id),
  constraint folder_parent_org_fk foreign key (parent_id, org_id) references folder (id, org_id) on delete cascade
);
create index if not exists folder_org_id_idx on folder (org_id);
-- Foreign keys have an index from their columns, which PostGraphile asks for before it serves the relation backwards
drop index if exists folder_parent_id_idx;
create index if not exists folder_parent_id_org_id_idx on folder (parent_id, org_id);
-- For folder_search, which matches names through it: RLS never runs ilike before its policies, so never on an index
create index if not exists folder_name_trgm_idx on folder using gin (name gin_trgm_ops);

-- A document holds the organization of its folder, which the foreign key on both columns keeps, so that a request in an
-- organization finds its documents without walking the resource tree, even those whose folder RLS hides
create table if not exists document (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organization (id) on delete cascade,
  folder_id uuid not null,
  title text not null,
  content text not null default '',
  created_by uuid references member (id) on delete set null,
  resource_id uuid unique,
  created_at timestamp not null default now(),
  updated_at timestamp not null default now(),
  constraint document_folder_org_fk foreign key (folder_id, org_id) references folder (id, org_id) on delete cascade
);
create index if not exists document_org_id_idx on document (org_id);
drop index if exists document_folder_id_idx;
create index if not exists document_folder_id_org_id_idx on document (folder_id, org_id);
create index if not exists document_created_by_idx on document (created_by);
-- Pages of the documents of an organization, last updated first, start at a key of this index
create index if not exists document_org_updated_at_idx on document (org_id, updated_at, id);
create index if not exists document_title_trgm_idx on document using gin (title gin_trgm_ops);
create index if not exists document_content_trgm_idx on document using gin (content gin_trgm_ops);

-- A resource leaf: comments are not in the graph, they have the permissions of their document
create table if not exists comment (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references document (id) on delete cascade,
  member_id uuid references member (id) on delete set null,
  body text not null,
  created_at timestamp not null default now()
);
drop index if exists comment_document_id_idx;
create index if not exists comment_document_id_created_at_idx on comment (document_id, created_at);
create index if not exists comment_member_id_idx on comment (member_id);

-- What members did, written by the triggers of sql/audit.sql. A resource leaf of the organization, which only admins
-- can read. Names are copied when the event is written, so that the log outlives what it is about
create table if not exists audit_event (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organization (id) on delete cascade,
  actor_member_id uuid references member (id) on delete set null,
  actor_name text,
  -- The API key the request was made with
  api_key_name text,
  -- The admin acting as the member
  impersonator_member_id uuid references member (id) on delete set null,
  impersonator_name text,
  action text not null,
  subject_kind text not null,
  subject_id uuid,
  subject_name text,
  -- Who access was given to, who joined a team, where something was moved, or its former name
  detail text,
  permission text,
  created_at timestamp not null default now()
);
create index if not exists audit_event_org_id_created_at_idx on audit_event (org_id, created_at);
create index if not exists audit_event_actor_member_id_idx on audit_event (actor_member_id);
create index if not exists audit_event_impersonator_member_id_idx on audit_event (impersonator_member_id);

-- PostGraphile reads every bound table through the views of all nodes, so app_user selects all of them. RLS decides
-- which rows. Only the content tables are written by requests directly, the others through the functions of app.sql
grant select on organization, team, member, folder, document, comment, audit_event to app_user;
grant insert, update, delete on folder, document, comment to app_user;
grant insert, delete on team, member to app_user;
-- Profiles, to show who is who. PostGraphile does not serve the table: members have name and email fields
grant select (id, name, email) on "user" to app_user;
