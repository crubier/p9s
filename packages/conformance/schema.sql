-- The tables of the app the conformance suite runs on, and its rows, before the p9s migration: members are roles,
-- folders and notes resources, a note is in its folder, and folder_shares give members access to folders
create table members (id serial primary key, name text not null unique);
create table folders (id serial primary key, name text not null);
create table folder_shares (
  folder_id integer not null references folders on delete cascade,
  member_id integer not null references members on delete cascade,
  access text not null check (access in ('viewer', 'editor')),
  primary key (folder_id, member_id)
);
create index folder_shares_member_id_idx on folder_shares (member_id);
create table notes (
  id serial primary key,
  folder_id integer not null references folders on delete cascade,
  body text not null
);
create index notes_folder_id_idx on notes (folder_id);

insert into members (name) values ('alice'), ('bob'), ('carol');
insert into folders (name) values ('alice writes'), ('bob reads'), ('bob writes');
insert into folder_shares (folder_id, member_id, access) values (1, 1, 'editor'), (2, 2, 'viewer'), (3, 2, 'editor');
insert into notes (folder_id, body) values (1, 'alice writes'), (2, 'bob reads'), (3, 'bob writes');
