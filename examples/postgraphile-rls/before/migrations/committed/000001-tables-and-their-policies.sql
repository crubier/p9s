--! Previous: -
--! Hash: sha1:fbfdacecf5e3522a6b166ce0fbf3dca82dbd1577
--! Message: Tables, and their policies

create table users (
  id serial primary key,
  name text not null unique
);

create table teams (
  id serial primary key,
  name text not null unique
);

create table team_members (
  team_id integer not null references teams on delete cascade,
  user_id integer not null references users on delete cascade,
  primary key (team_id, user_id)
);

create table projects (
  id serial primary key,
  name text not null
);

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

-- The role of the requests of users, which PostGraphile takes with the id of the user in app.user_id
do $$
begin
  if not exists (select from pg_roles where rolname = 'app_user') then create role app_user nologin; end if;
end
$$;
grant app_user to current_user;

create schema app_private;
grant usage on schema app_private to app_user;

create function app_private.current_user_id() returns integer language sql stable
  as $$ select nullif(current_setting('app.user_id', true), '')::integer $$;

create function app_private.bits_of(access text) returns text[] language sql immutable
  as $$ select case access when 'viewer' then array['read'] when 'editor' then array['read', 'write'] when 'owner' then array['read', 'write', 'delete'] else '{}' end $$;

-- The bits of the current user on a project, from its shares with their teams
create function app_private.project_bits(project_id integer) returns text[] language sql stable security definer
  set search_path = public, pg_temp
  as $$
    select coalesce(array_agg(distinct bit), '{}')
    from project_shares
    join team_members on team_members.team_id = project_shares.team_id
    cross join unnest(app_private.bits_of(project_shares.access)) as bit
    where project_shares.project_id = project_bits.project_id and team_members.user_id = app_private.current_user_id()
  $$;

-- The bits of the current user on a document of a project, from the project and the shares of the document
create function app_private.document_bits(document_id integer, project_id integer) returns text[] language sql stable security definer
  set search_path = public, pg_temp
  as $$
    select app_private.project_bits(document_bits.project_id) || coalesce((
      select app_private.bits_of(access) from document_shares
      where document_shares.document_id = document_bits.document_id and user_id = app_private.current_user_id()
    ), '{}')
  $$;

alter table projects enable row level security;
create policy projects_select on projects for select using ('read' = any(app_private.project_bits(id)));

alter table documents enable row level security;
create policy documents_select on documents for select using ('read' = any(app_private.document_bits(id, project_id)));
create policy documents_insert on documents for insert with check ('write' = any(app_private.project_bits(project_id)));
create policy documents_update on documents for update using ('write' = any(app_private.document_bits(id, project_id)));
create policy documents_delete on documents for delete using ('delete' = any(app_private.document_bits(id, project_id)));

-- A user shares a document they read, giving only bits they have, and changing a share only when they have its bits
create function app_private.check_document_share() returns trigger language plpgsql
  set search_path = public, pg_temp
  as $$
declare
  bits text[] := app_private.document_bits(new.document_id, (select project_id from documents where id = new.document_id));
  previous text := (select access from document_shares where document_id = new.document_id and user_id = new.user_id);
begin
  if current_user <> 'app_user' then
    return new;
  end if;
  if not ('read' = any(bits) and app_private.bits_of(new.access) <@ bits and app_private.bits_of(previous) <@ bits) then
    raise exception 'You cannot give or take away access you do not have' using errcode = '42501';
  end if;
  return new;
end
$$;
create trigger document_shares_check before insert or update on document_shares
  for each row execute function app_private.check_document_share();

grant select on projects to app_user;
grant select, insert, update, delete on documents to app_user;
grant usage on sequence documents_id_seq to app_user;
grant select, insert, update on document_shares to app_user;
