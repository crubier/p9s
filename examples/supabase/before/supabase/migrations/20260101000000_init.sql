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
