-- The same rows for every app, after its migrations. Ids follow the order of the rows.
insert into users (name) values ('alice'), ('bob'), ('carol'), ('dave'), ('erin');
insert into teams (name) values ('eng'), ('sales'), ('leads');
-- alice and bob are in eng, carol in sales, bob in leads too
insert into team_members (team_id, user_id) values (1, 1), (1, 2), (2, 3), (3, 2);
insert into projects (name) values ('apollo'), ('zeus');
insert into project_shares (project_id, team_id, access) values (1, 1, 'editor'), (1, 2, 'viewer'), (1, 3, 'owner'), (2, 2, 'owner');
insert into documents (project_id, title, body) values (1, 'spec', 'The plan'), (1, 'notes', 'Ideas'), (2, 'pricing', 'Numbers');
-- alice reads pricing, dave edits spec
insert into document_shares (document_id, user_id, access) values (3, 1, 'viewer'), (1, 4, 'editor');
