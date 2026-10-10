-- The rows of the benchmark, the same for every app, after its migrations: 1000 users in 100 teams, 1000 projects each
-- shared with 2 teams, 20,000 documents, and 4000 shares of documents with users. Each user is in 3 teams, so reads
-- about 60 projects and 1200 documents. Ids follow the order of the rows.
insert into users (name) select 'user ' || i from generate_series(1, 1000) as i;
insert into teams (name) select 'team ' || i from generate_series(1, 100) as i;
insert into team_members (team_id, user_id)
select 1 + (u + 37 * k) % 100, u from generate_series(1, 1000) as u, generate_series(0, 2) as k;
insert into projects (name) select 'project ' || i from generate_series(1, 1000) as i;
insert into project_shares (project_id, team_id, access)
select p, 1 + (3 * p + 41 * k) % 100, (array['viewer', 'editor', 'owner'])[1 + (p + k) % 3]
from generate_series(1, 1000) as p, generate_series(0, 1) as k;
insert into documents (project_id, title, body)
select 1 + (i - 1) % 1000, 'document ' || i, 'The body of document ' || i from generate_series(1, 20000) as i;
insert into document_shares (document_id, user_id, access)
select 1 + 5 * (i - 1), 1 + (7 * i) % 1000, (array['viewer', 'editor'])[1 + i % 2] from generate_series(1, 4000) as i;
