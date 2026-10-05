-- What p9s expects from the application: the database roles, the function telling who the current user is, and the
-- privileges of the application role. Runs before migrations/p9s.sql.

-- app_user runs the queries of members, through RLS. app_backend writes shares and team memberships to the graph.
-- Neither can log in: the server connects as the owner of the tables and switches role in each transaction.
do $$
begin
  if not exists (select from pg_roles where rolname = 'app_user') then
    create role app_user nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'app_backend') then
    create role app_backend nologin;
  end if;
end $$;
--> statement-breakpoint
grant app_user, app_backend to current_user;
--> statement-breakpoint
grant usage on schema public to app_user, app_backend;
--> statement-breakpoint
grant select, insert, update, delete on table organization, team, member, folder, document, comment to app_user;
--> statement-breakpoint
-- The user table has no RLS: members only read the profile columns, to show who is who
grant select (id, name, email, image) on table "user" to app_user;
--> statement-breakpoint

-- The role id of the member, or API key, the request is made for. The server sets it at the start of each transaction.
create or replace function current_role_id() returns uuid language sql stable as $$
  select nullif(current_setting('app.role_id', true), '')::uuid
$$;
--> statement-breakpoint

-- p9s follows one parent column per table. A folder is either in a folder or at the top of its organization, so this
-- trigger copies the resource id of the one it is in into parent_resource_id, the column p9s follows. Clients cannot
-- set that column themselves, and a folder always belongs to the organization of its parent.
create or replace function folder_parent_resource() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.parent_id is null then
    select resource_id into new.parent_resource_id from organization where id = new.org_id;
  else
    select org_id, resource_id into new.org_id, new.parent_resource_id from folder where id = new.parent_id;
  end if;
  return new;
end
$$;
--> statement-breakpoint
drop trigger if exists folder_parent_resource on folder;
--> statement-breakpoint
create trigger folder_parent_resource before insert or update on folder
for each row execute function folder_parent_resource();
