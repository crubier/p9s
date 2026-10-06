-- The audit log: triggers record what members change, on the business tables and on the shares and team memberships
-- of the permission graph. Runs after sql/p9s.sql, which creates the edge tables, and can run again.
--
-- An event is written when the change is made on behalf of a member, that is when the server set `app.role_id`, and
-- only for the statement the request made: not for what follows from it, like the documents deleted with their
-- folder, or the edges p9s writes itself. Nothing is written when the server works as the owner, like the seed.
--
-- Postgres fires the triggers of rows deleted by `on delete cascade` at the same depth as the statement's own, so a
-- deleted row is only recorded while what it belongs to still exists.

grant select on table audit_event to app_user;

-- The member the request is made for, directly or with one of their API keys, and the admin acting as them
create or replace function audit_actor()
returns table (org_id uuid, member_id uuid, member_name text, api_key_name text, impersonator_id uuid, impersonator_name text)
language sql stable security definer set search_path = public, pg_temp as $$
  with key as (select member_id, name from api_key where role_id = current_role_id())
  select m.org_id, m.id, u.name, (select name from key), i.id, iu.name
  from member m
  join "user" u on u.id = m.user_id
  left join member i on i.id = nullif(current_setting('app.impersonator_member_id', true), '')::uuid
  left join "user" iu on iu.id = i.user_id
  where m.id = coalesce((select member_id from key), (select id from member where role_id = current_role_id()))
$$;

create or replace function audit_write(action text, kind text, subject_id uuid, subject_name text, detail text default null, permission text default null)
returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into audit_event (org_id, actor_member_id, actor_name, api_key_name, impersonator_member_id, impersonator_name,
    action, subject_kind, subject_id, subject_name, detail, permission)
  select a.org_id, a.member_id, a.member_name, a.api_key_name, a.impersonator_id, a.impersonator_name,
    action, kind, subject_id, subject_name, detail, permission
  from audit_actor() a
$$;

-- What a resource or role id of the graph is, to name it in the log
create or replace function audit_resource(id uuid) returns table (kind text, row_id uuid, name text)
language sql stable security definer set search_path = public, pg_temp as $$
  select case when parent_id is null then 'space' else 'folder' end, folder.id, folder.name from folder where resource_id = $1
  union all select 'document', document.id, title from document where resource_id = $1
  union all select 'organization', organization.id, organization.name from organization where resource_id = $1
$$;

create or replace function audit_role_name(id uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select u.name from member m join "user" u on u.id = m.user_id where m.role_id = $1),
    (select name from team where role_id = $1),
    (select 'Everyone at ' || name from organization where role_id = $1)
  )
$$;

create or replace function audit_skip() returns boolean language sql stable as $$
  select pg_trigger_depth() > 1 or current_role_id() is null
$$;

create or replace function audit_folder_trigger() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  kind text := case when coalesce(new.parent_id, old.parent_id) is null then 'space' else 'folder' end;
begin
  if audit_skip() then return null; end if;
  if tg_op = 'INSERT' then
    perform audit_write('created', kind, new.id, new.name);
  elsif tg_op = 'DELETE' then
    if not exists (select from organization where id = old.org_id)
      or old.parent_id is not null and not exists (select from folder where id = old.parent_id) then
      return null;
    end if;
    perform audit_write('deleted', kind, old.id, old.name);
  else
    if new.parent_id is distinct from old.parent_id then
      perform audit_write('moved', kind, new.id, new.name, (select name from folder where id = new.parent_id));
    end if;
    if new.name <> old.name then
      perform audit_write('renamed', kind, new.id, new.name, old.name);
    end if;
  end if;
  return null;
end
$$;

create or replace function audit_document_trigger() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if audit_skip() then return null; end if;
  if tg_op = 'INSERT' then
    perform audit_write('created', 'document', new.id, new.title);
  elsif tg_op = 'DELETE' then
    if not exists (select from folder where id = old.folder_id) then return null; end if;
    perform audit_write('deleted', 'document', old.id, old.title);
  else
    if new.folder_id <> old.folder_id then
      perform audit_write('moved', 'document', new.id, new.title, (select name from folder where id = new.folder_id));
    end if;
    if new.title <> old.title then
      perform audit_write('renamed', 'document', new.id, new.title, old.title);
    end if;
    if new.content <> old.content then
      perform audit_write('edited', 'document', new.id, new.title);
    end if;
  end if;
  return null;
end
$$;

create or replace function audit_comment_trigger() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r comment := coalesce(new, old);
begin
  if audit_skip() or not exists (select from document where id = r.document_id) then return null; end if;
  perform audit_write(case tg_op when 'INSERT' then 'commented' else 'deleted a comment' end, 'document',
    r.document_id, (select title from document where id = r.document_id), left(r.body, 140));
  return null;
end
$$;

create or replace function audit_team_trigger() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if audit_skip() or not exists (select from organization where id = coalesce(new.org_id, old.org_id)) then return null; end if;
  if tg_op = 'INSERT' then
    perform audit_write('created', 'team', new.id, new.name);
  elsif tg_op = 'DELETE' then
    perform audit_write('deleted', 'team', old.id, old.name);
  elsif new.name <> old.name then
    perform audit_write('renamed', 'team', new.id, new.name, old.name);
  end if;
  return null;
end
$$;

create or replace function audit_member_trigger() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r member := coalesce(new, old);
begin
  if audit_skip() or not exists (select from organization where id = r.org_id) then return null; end if;
  perform audit_write(case tg_op when 'INSERT' then 'added' else 'removed' end, 'member',
    r.id, (select name from "user" where id = r.user_id));
  return null;
end
$$;

-- Shares: an assignment gives a role bits on a resource
create or replace function audit_assignment_trigger() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r assignment_edge := coalesce(new, old);
  resource record;
begin
  if audit_skip() then return null; end if;
  select * into resource from audit_resource(r.resource_id);
  if resource.row_id is null or audit_role_name(r.role_id) is null then return null; end if;
  perform audit_write(case tg_op when 'INSERT' then 'shared' when 'UPDATE' then 'changed access to' else 'removed access to' end,
    coalesce(resource.kind, 'resource'), resource.row_id, resource.name, audit_role_name(r.role_id), r.permission::text);
  return null;
end
$$;

-- Team memberships: a role edge from a team to a member. Home edges are written by p9s with their rows
create or replace function audit_role_edge_trigger() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r role_edge := coalesce(new, old);
begin
  if audit_skip() or r.home or audit_role_name(r.child_id) is null or not exists (select from team where role_id = r.parent_id) then
    return null;
  end if;
  perform audit_write(case tg_op when 'INSERT' then 'added to' else 'removed from' end, 'team',
    (select id from team where role_id = r.parent_id), (select name from team where role_id = r.parent_id), audit_role_name(r.child_id));
  return null;
end
$$;

drop trigger if exists audit_trigger on folder;
create trigger audit_trigger after insert or update or delete on folder for each row execute function audit_folder_trigger();
drop trigger if exists audit_trigger on document;
create trigger audit_trigger after insert or update or delete on document for each row execute function audit_document_trigger();
drop trigger if exists audit_trigger on comment;
create trigger audit_trigger after insert or delete on comment for each row execute function audit_comment_trigger();
drop trigger if exists audit_trigger on team;
create trigger audit_trigger after insert or update or delete on team for each row execute function audit_team_trigger();
drop trigger if exists audit_trigger on member;
create trigger audit_trigger after insert or delete on member for each row execute function audit_member_trigger();
drop trigger if exists audit_trigger on assignment_edge;
create trigger audit_trigger after insert or update or delete on assignment_edge for each row execute function audit_assignment_trigger();
drop trigger if exists audit_trigger on role_edge;
create trigger audit_trigger after insert or delete on role_edge for each row execute function audit_role_edge_trigger();

-- Only triggers and the functions of sql/app.sql write the log, and GraphQL serves none of these
do $$
declare
  the_function regprocedure;
begin
  for the_function in select p.oid::regprocedure from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'audit\_%' loop
    execute format('revoke execute on function %s from public', the_function);
    execute format('comment on function %s is %L', the_function, '@behavior -*');
  end loop;
end
$$;
