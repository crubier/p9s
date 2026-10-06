-- What the GraphQL API offers on top of the tables. Runs after sql/p9s.sql, and can run again.

-- The person a request is made for
create or replace function current_person() returns person
language sql stable as $$
  select * from person where role_id = current_role_id()
$$;
grant execute on function current_person() to app_user;

create or replace function current_person_id() returns uuid
language sql stable as $$
  select id from person where role_id = current_role_id()
$$;
grant execute on function current_person_id() to app_user;
comment on function current_person_id() is '@behavior -*';

alter table comment alter column author_id set default current_person_id();

-- Postgres checks an insert with `returning` against the select policy before the triggers of p9s give the new row
-- its place in the graph, so the create mutations of PostGraphile would fail on node tables. These insert without
-- `returning`, as the user, then read the row back.
create or replace function create_project(org_id uuid, name text) returns project
language plpgsql volatile as $$
declare
  the_id uuid := uuid_generate_v4();
begin
  insert into project (id, org_id, name) values (the_id, create_project.org_id, create_project.name);
  return (select p from project p where p.id = the_id);
end
$$;
grant execute on function create_project(uuid, text) to app_user;

create or replace function create_task(project_id uuid, title text, assignee_id uuid default null) returns task
language plpgsql volatile as $$
declare
  the_id uuid := uuid_generate_v4();
begin
  insert into task (id, project_id, title, assignee_id) values (the_id, create_task.project_id, create_task.title, create_task.assignee_id);
  return (select t from task t where t.id = the_id);
end
$$;
grant execute on function create_task(uuid, text, uuid) to app_user;

-- Team memberships are role edges, which users cannot write: admins of the organization go through this function,
-- which checks their admin bit first, and writes as the owner
create or replace function set_team_membership(team_id uuid, person_id uuid, member boolean) returns boolean
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  the_team team := (select t from team t where t.id = set_team_membership.team_id);
  the_person person := (select p from person p where p.id = set_team_membership.person_id);
begin
  if the_team is null or the_person is null or the_team.org_id <> the_person.org_id
    or substring(resource_permission((select resource_id from organization where id = the_team.org_id))::text from 8 for 1) <> '1' then
    raise exception 'Only admins of the organization manage its teams' using errcode = 'insufficient_privilege';
  end if;
  if member then
    insert into role_edge (parent_id, child_id, permission) values (the_team.role_id, the_person.role_id, b'11111111')
    on conflict do nothing;
  else
    delete from role_edge where parent_id = the_team.role_id and child_id = the_person.role_id;
  end if;
  return member;
end
$$;
revoke execute on function set_team_membership(uuid, uuid, boolean) from public;
grant execute on function set_team_membership(uuid, uuid, boolean) to app_user;

-- What PostGraphile shows. Organizations, people and teams are created by the server, projects and tasks with the
-- functions above
comment on table organization is '@behavior -insert -update -delete';
comment on table person is '@behavior -insert -update -delete';
comment on table team is '@behavior -insert -update -delete';
comment on table project is '@behavior -insert';
comment on table task is '@behavior -insert';
comment on function current_role_id() is '@behavior -*';
comment on function create_project(uuid, text) is '@resultFieldName project';
comment on function create_task(uuid, text, uuid) is '@resultFieldName task';
