create table users (
  id bigserial primary key,
  name text not null unique
);

create table teams (
  id bigserial primary key,
  name text not null unique
);

create table team_members (
  team_id bigint not null references teams (id) on delete cascade,
  user_id bigint not null references users (id) on delete cascade,
  primary key (team_id, user_id)
);
create index team_members_user_id on team_members (user_id);

create table projects (
  id bigserial primary key,
  name text not null
);

create table project_shares (
  project_id bigint not null references projects (id) on delete cascade,
  team_id bigint not null references teams (id) on delete cascade,
  access text not null check (access in ('viewer', 'editor', 'owner')),
  primary key (project_id, team_id)
);
create index project_shares_team_id on project_shares (team_id);

create table documents (
  id bigserial primary key,
  project_id bigint not null references projects (id) on delete cascade,
  title text not null,
  body text not null default ''
);
create index documents_project_id on documents (project_id);

create table document_shares (
  document_id bigint not null references documents (id) on delete cascade,
  user_id bigint not null references users (id) on delete cascade,
  access text not null check (access in ('viewer', 'editor')),
  primary key (document_id, user_id)
);
create index document_shares_user_id on document_shares (user_id);
