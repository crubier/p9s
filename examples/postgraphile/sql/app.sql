-- The GraphQL API, on top of the tables. Runs after sql/p9s.sql, and can run again.
--
-- PostGraphile serves the tables, the views of p9s and the functions below, with no resolver: what the server of the
-- Next.js example does in TypeScript is done here. Every request runs as app_user, with these settings, set by the
-- server from the session or the API key of the request:
-- - app.role_id: the role id of the member the request acts as, or of their API key, which p9s reads
-- - app.user_id: the signed-in user, to list their organizations
-- - app.impersonator_member_id: the admin viewing or acting as the member. Viewing makes the transaction read only
--
-- Functions read and write as the member, through RLS, unless they are `security definer`: those check the bits of the
-- member first, with `resource_permission`, which reads app.role_id whoever runs it, then write the graph or the audit
-- log as the owner of the tables.

-- Helpers, hidden from GraphQL

create or replace function bit_on(bits bit(8), bit_index int) returns boolean
language sql immutable as $$
  select substring(bits::text from bit_index + 1 for 1) = '1'
$$;

-- The bits of an access level, as in lib/permissions.ts
create or replace function access_level_bits(level text) returns bit(8)
language sql immutable as $$
  select case level
    when 'viewer' then b'10000000'
    when 'commenter' then b'10001000'
    when 'editor' then b'11111000'
    when 'manager' then b'11111100'
  end
$$;

-- Bits included in others
create or replace function bits_within(requested bit(8), granted bit(8)) returns boolean
language sql immutable as $$
  select granted is not null and requested & granted = requested
$$;

-- A pattern that matches text containing the query, with the wildcards of the query escaped
create or replace function contains_pattern(query text) returns text
language sql immutable as $$
  select '%' || replace(replace(replace(trim(coalesce(query, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%'
$$;

-- Errors for the user. 42501 is also what RLS raises, which the server shows as a generic refusal
create or replace function forbidden(message text) returns void
language plpgsql as $$
begin
  raise exception '%', message using errcode = '42501', hint = 'p9s-example';
end
$$;

create or replace function not_found(message text default 'This does not exist, or you don''t have access to it.') returns void
language plpgsql as $$
begin
  raise exception '%', message using errcode = 'P0002', hint = 'p9s-example';
end
$$;

-- The member the request acts as, directly or with one of their API keys
create or replace function current_member_id() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select id from member where role_id = current_role_id()), (select member_id from api_key where role_id = current_role_id()))
$$;

create or replace function current_user_id() returns text
language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')
$$;

create or replace function current_impersonator_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.impersonator_member_id', true), '')::uuid
$$;

-- Who the request is for

do $$ begin create type viewer as (id text, name text, email text); exception when duplicate_object then null; end $$;

-- The signed-in user. Null for requests made with an API key
create or replace function viewer() returns viewer
language sql stable security definer set search_path = public, pg_temp as $$
  select id, name, email from "user" where id = current_user_id()
$$;

-- The organizations of the signed-in user, which RLS only shows them while they act in each one
create or replace function my_organizations() returns setof organization
language sql stable security definer set search_path = public, pg_temp as $$
  select o.* from organization o join member m on m.org_id = o.id where m.user_id = current_user_id() order by o.name
$$;

create or replace function current_member() returns member
language sql stable as $$
  select * from member where id = current_member_id()
$$;

do $$ begin create type impersonation as (admin_member_id uuid, admin_name text, read_only boolean); exception when duplicate_object then null; end $$;

-- The admin viewing or acting as the member, if any
create or replace function current_impersonation() returns impersonation
language sql stable security definer set search_path = public, pg_temp as $$
  select m.id, u.name, current_setting('transaction_read_only')::boolean
  from member m join "user" u on u.id = m.user_id where m.id = current_impersonator_id()
$$;

-- Members and teams

-- Everyone who can see a member can see their name
create or replace function member_name(m member) returns text
language sql stable as $$
  select name from "user" where id = m.user_id
$$;

create or replace function member_email(m member) returns text
language sql stable as $$
  select email from "user" where id = m.user_id
$$;

-- Team memberships are role edges, which users cannot read: whoever sees the member reads their teams from the graph
create or replace function member_teams(m member) returns setof team
language sql stable security definer set search_path = public, pg_temp as $$
  select t.* from role_edge e join team t on t.role_id = e.parent_id
  where e.child_id = m.role_id and t.org_id = m.org_id and bit_on(resource_permission(m.resource_id), 6)
  order by t.name
$$;

create or replace function team_member_count(t team) returns int
language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)::int from role_edge e where e.parent_id = t.role_id and bit_on(resource_permission(t.resource_id), 6)
$$;

-- A team administers the organization when it is assigned the admin bit on it, like the Admins team
create or replace function team_administers(t team) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select bit_on(resource_permission(t.resource_id), 6) and exists (
    select 1 from assignment_edge a join organization o on o.resource_id = a.resource_id
    where o.id = t.org_id and a.role_id = t.role_id and bit_on(a.permission, 7)
  )
$$;

-- RLS shows the members of the organization to everyone in it, through the directory bit
create or replace function organization_members(o organization, query text default '') returns setof member
language sql stable as $$
  select m.* from member m join "user" u on u.id = m.user_id
  where m.org_id = o.id and (u.name ilike contains_pattern(query) or u.email ilike contains_pattern(query))
  order by u.name, u.email
$$;

-- Members are resources in their organization: inserting one needs the admin bit there, RLS checks it
create or replace function invite_member(org_id uuid, email text) returns member
language plpgsql volatile as $$
declare
  the_user_id text := (select id from "user" u where u.email = lower(trim(invite_member.email)));
  the_id uuid := gen_random_uuid();
begin
  if the_user_id is null then perform not_found('Nobody has signed up with that email yet.'); end if;
  if exists (select 1 from member m where m.org_id = invite_member.org_id and m.user_id = the_user_id) then
    perform forbidden('Already a member.');
  end if;
  insert into member (id, org_id, user_id) values (the_id, invite_member.org_id, the_user_id);
  return (select m from member m where m.id = the_id);
end
$$;

create or replace function remove_member(member_id uuid) returns boolean
language plpgsql volatile as $$
begin
  if member_id = current_member_id() then perform forbidden('You cannot remove yourself.'); end if;
  delete from member m where m.id = remove_member.member_id;
  if not found then perform forbidden('You don''t have permission to do that.'); end if;
  return true;
end
$$;

create or replace function create_team(org_id uuid, name text) returns team
language plpgsql volatile as $$
declare
  the_id uuid := gen_random_uuid();
begin
  insert into team (id, org_id, name) values (the_id, create_team.org_id, create_team.name);
  return (select t from team t where t.id = the_id);
end
$$;

create or replace function delete_team(team_id uuid) returns boolean
language plpgsql volatile as $$
begin
  if exists (select 1 from team t where t.id = team_id and team_administers(t)) then
    perform forbidden('This team administers the organization, it cannot be deleted.');
  end if;
  delete from team t where t.id = delete_team.team_id;
  if not found then perform forbidden('You don''t have permission to do that.'); end if;
  return true;
end
$$;

-- A team membership is a role edge from the team to the member, which only graph writers write: this checks that the
-- member may manage the team, then writes the edge as the owner
create or replace function set_team_membership(team_id uuid, member_id uuid, is_member boolean) returns boolean
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  the_team team := (select t from team t where t.id = set_team_membership.team_id);
  the_member member := (select m from member m where m.id = set_team_membership.member_id);
begin
  if the_team is null or not bit_on(resource_permission(the_team.resource_id), 6) then perform not_found('No such team.'); end if;
  if not bit_on(resource_permission(the_team.resource_id), 7) then perform forbidden('Only admins can change teams.'); end if;
  if the_member is null or the_member.org_id <> the_team.org_id then perform not_found('No such member.'); end if;
  if not is_member and the_member.id = current_member_id() and team_administers(the_team) then
    perform forbidden('You cannot remove yourself from a team that administers the organization.');
  end if;
  if is_member then
    insert into role_edge (parent_id, child_id, permission) values (the_team.role_id, the_member.role_id, b'11111111') on conflict do nothing;
  else
    delete from role_edge where parent_id = the_team.role_id and child_id = the_member.role_id and not home;
  end if;
  return is_member;
end
$$;

-- Organizations

-- An organization has nothing above it in the graph, so RLS has nothing to check its creation against: this creates
-- it as the owner, with the signed-in user as its first member, an Admins team, and a General space everyone can edit.
-- The audit triggers would record it in the organization the request acts in, so they are off until the end.
create or replace function create_organization(name text) returns organization
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  the_user "user" := (select u from "user" u where u.id = current_user_id());
  base text := coalesce(nullif(left(trim(both '-' from regexp_replace(lower(create_organization.name), '[^a-z0-9]+', '-', 'g')), 40), ''), 'org');
  the_slug text := base;
  the_org organization;
  admins team;
  creator member;
  general folder;
  role_id_setting text := current_setting('app.role_id', true);
begin
  if the_user is null then perform forbidden('Sign in to create an organization.'); end if;
  if trim(coalesce(create_organization.name, '')) = '' then perform forbidden('An organization needs a name.'); end if;
  for n in 2..1000 loop
    exit when not exists (select 1 from organization where slug = the_slug);
    the_slug := base || '-' || n;
  end loop;
  perform set_config('app.role_id', '', true);
  insert into organization (name, slug) values (trim(create_organization.name), the_slug) returning * into the_org;
  insert into team (org_id, name) values (the_org.id, 'Admins') returning * into admins;
  insert into member (org_id, user_id) values (the_org.id, the_user.id) returning * into creator;
  insert into folder (org_id, name) values (the_org.id, 'General') returning * into general;
  insert into audit_event (org_id, actor_member_id, actor_name, action, subject_kind, subject_id, subject_name)
  values (the_org.id, creator.id, the_user.name, 'created', 'organization', the_org.id, the_org.name);
  insert into role_edge (parent_id, child_id, permission) values (admins.role_id, creator.role_id, b'11111111');
  insert into assignment_edge (resource_id, role_id, permission) values
    (the_org.resource_id, admins.role_id, b'11111111'),
    (the_org.resource_id, the_org.role_id, b'00000010'),
    (general.resource_id, the_org.role_id, access_level_bits('editor'));
  perform set_config('app.role_id', coalesce(role_id_setting, ''), true);
  return the_org;
end
$$;

-- Folders and documents

-- The spaces the member can see
create or replace function organization_spaces(o organization) returns setof folder
language sql stable as $$
  select * from folder where org_id = o.id and parent_id is null order by name, id
$$;

-- What was shared with the member inside spaces they cannot see. Access given on a folder reaches what is inside, so a
-- folder or document whose parent RLS hides was shared on its own: only look among what is assigned to the member,
-- their teams and the organization, rather than through everything they can read
create or replace function organization_shared_folders(o organization) returns setof folder
language sql stable as $$
  select f.* from folder f
  where f.resource_id in (select resource_id from current_assignment) and f.org_id = o.id and f.parent_id is not null
    and not exists (select 1 from folder p where p.id = f.parent_id)
  order by f.name
$$;

create or replace function organization_shared_documents(o organization) returns setof document
language sql stable as $$
  select d.* from document d
  where d.resource_id in (select resource_id from current_assignment) and d.org_id = o.id
    and not exists (select 1 from folder p where p.id = d.folder_id)
  order by d.title
$$;

-- Folders and documents whose name matches, among those RLS shows. Postgres checks RLS before any filter that is not
-- leakproof, like ilike, so it never matches through an index: the search functions of p9s do, then keep the matches
-- the member can read
create or replace function organization_search_folders(o organization, query text) returns setof folder
language sql stable as $$
  select f.* from folder_search(contains_pattern(query)) f where f.org_id = o.id order by f.name
$$;

create or replace function organization_search_documents(o organization, query text) returns setof document
language sql stable as $$
  select d.* from document_search(contains_pattern(query)) d where d.org_id = o.id
  order by d.title ilike contains_pattern(query) desc, d.updated_at desc
$$;

-- The folders the member can create in, labelled with the part of their path they can see, to pick where to move
-- something
do $$ begin create type move_target as (id uuid, label text); exception when duplicate_object then null; end $$;

create or replace function organization_move_targets(o organization) returns setof move_target
language sql stable as $$
  with recursive visible as (
    select f.id, f.parent_id, f.name, resource_permission(f.resource_id) as permission from folder f where f.org_id = o.id
  ), labelled (id, label) as (
    select v.id, v.name from visible v where not exists (select 1 from visible p where p.id = v.parent_id)
    union all
    select v.id, l.label || ' / ' || v.name from visible v join labelled l on v.parent_id = l.id
  )
  select l.id, l.label from labelled l join visible v on v.id = l.id where bit_on(v.permission, 1) order by l.label
$$;

-- The folders above, from the top, and the folder itself: RLS stops the walk at the first one the member cannot see
create or replace function folder_path(f folder) returns setof folder
language sql stable as $$
  with recursive up as (
    select f.id, f.parent_id, 0 as depth
    union all
    select p.id, p.parent_id, up.depth + 1 from folder p join up on p.id = up.parent_id
  )
  select folder.* from up join folder on folder.id = up.id order by up.depth desc
$$;

create or replace function document_path(d document) returns setof folder
language sql stable as $$
  select p.* from folder f, folder_path(f) p where f.id = d.folder_id
$$;

-- Postgres checks an insert with `returning` against the select policy before the triggers of p9s give the new row its
-- place in the graph, so the create mutations of PostGraphile would fail on node tables. These insert without
-- `returning`, as the member, then read the row back. With no parent, the folder is a space: RLS checks the create
-- bit on the organization, only admins have it
create or replace function create_folder(org_id uuid, parent_id uuid, name text) returns folder
language plpgsql volatile as $$
declare
  the_id uuid := gen_random_uuid();
begin
  if parent_id is not null and not exists (select 1 from folder f where f.id = create_folder.parent_id and f.org_id = create_folder.org_id) then
    perform not_found('This folder does not exist, or you don''t have access to it.');
  end if;
  insert into folder (id, org_id, parent_id, name) values (the_id, create_folder.org_id, create_folder.parent_id, create_folder.name);
  return (select f from folder f where f.id = the_id);
end
$$;

-- RLS checks the edit bit on the folder and the create bit on its new parent
create or replace function move_folder(folder_id uuid, parent_id uuid) returns folder
language plpgsql volatile as $$
declare
  the_folder folder := (select f from folder f where f.id = move_folder.folder_id);
begin
  if the_folder is null or not exists (select 1 from folder f where f.id = move_folder.parent_id and f.org_id = the_folder.org_id) then
    perform not_found('This folder does not exist, or you don''t have access to it.');
  end if;
  -- The cache only has rows below shared resources, so walk up the folders of the new parent. Those between the folder
  -- and a parent inside it are below the folder, which the member reads
  if exists (
    with recursive up (id) as (select move_folder.parent_id union select f.parent_id from folder f join up on f.id = up.id where f.parent_id is not null)
    select 1 from up where id = move_folder.folder_id
  ) then
    perform forbidden('A folder cannot be moved into itself.');
  end if;
  update folder f set parent_id = move_folder.parent_id where f.id = move_folder.folder_id;
  if not found then perform forbidden('You don''t have permission to do that.'); end if;
  return (select f from folder f where f.id = move_folder.folder_id);
end
$$;

create or replace function create_document(folder_id uuid, title text, content text default '') returns document
language plpgsql volatile as $$
declare
  the_id uuid := gen_random_uuid();
  the_org_id uuid := (select f.org_id from folder f where f.id = create_document.folder_id);
begin
  if the_org_id is null then perform not_found('This folder does not exist, or you don''t have access to it.'); end if;
  insert into document (id, org_id, folder_id, title, content, created_by)
  values (the_id, the_org_id, create_document.folder_id, create_document.title, coalesce(create_document.content, ''), current_member_id());
  return (select d from document d where d.id = the_id);
end
$$;

create or replace function document_touch() returns trigger
language plpgsql as $$
begin
  if (new.title, new.content, new.folder_id) is distinct from (old.title, old.content, old.folder_id) then new.updated_at := now(); end if;
  return new;
end
$$;
drop trigger if exists document_touch on document;
create trigger document_touch before update on document for each row execute function document_touch();

alter table comment alter column member_id set default current_member_id();

-- Sharing

do $$ begin create type principal as (role_id uuid, kind text, name text, detail text); exception when duplicate_object then null; end $$;

-- Who a resource can be shared with: everyone in the organization, its teams and its members
create or replace function organization_principals(o organization, query text default '') returns setof principal
language sql stable as $$
  select role_id, kind, name, detail from (
    select role_id, 'everyone' as kind, 'Everyone at ' || name as name, null as detail, 0 as rank from organization where id = o.id
    union all
    select role_id, 'team', name, null, 1 from team where org_id = o.id
    union all
    select m.role_id, 'member', u.name, u.email, 2 from member m join "user" u on u.id = m.user_id where m.org_id = o.id
  ) principals
  where name ilike contains_pattern(query) or detail ilike contains_pattern(query)
  order by rank, name
$$;

-- p9s lets a member share a resource if they have the share bit on it, and only give bits they have themselves. This
-- checks the same first, to tell why it refuses
create or replace function share_resource(resource_id uuid, role_id uuid, level text) returns boolean
language plpgsql volatile as $$
declare
  granted bit(8) := resource_permission(share_resource.resource_id);
  requested bit(8) := access_level_bits(level);
  existing bit(8) := (select a.permission from assignment_edge a where a.resource_id = share_resource.resource_id and a.role_id = share_resource.role_id);
  the_org organization := (select o from organization o where o.id = (select m.org_id from member m where m.id = current_member_id()));
begin
  if granted is null then perform not_found(); end if;
  if requested is null then perform not_found('No such access level.'); end if;
  if not bit_on(granted, 5) then perform forbidden('You cannot share this.'); end if;
  if not bits_within(requested, granted) then perform forbidden('You can only give access you have yourself.'); end if;
  if not exists (select 1 from organization_principals(the_org) p where p.role_id = share_resource.role_id) then perform not_found('No such member or team.'); end if;
  if existing is not null and not bits_within(existing, granted) then perform forbidden('You cannot change access you don''t have yourself.'); end if;
  perform resource_share(share_resource.resource_id, share_resource.role_id, requested);
  return true;
end
$$;

-- Removing access needs the share bit too, and cannot take away more than the member has
create or replace function unshare_resource(resource_id uuid, role_id uuid) returns boolean
language plpgsql volatile as $$
declare
  granted bit(8) := resource_permission(unshare_resource.resource_id);
  existing bit(8) := (select a.permission from assignment_edge a where a.resource_id = unshare_resource.resource_id and a.role_id = unshare_resource.role_id);
begin
  if granted is null then perform not_found(); end if;
  if not bit_on(granted, 5) then perform forbidden('You cannot change who has access to this.'); end if;
  if existing is null then perform not_found('That access is not given here.'); end if;
  if not bits_within(existing, granted) then perform forbidden('You cannot remove access you don''t have yourself.'); end if;
  return resource_unshare(unshare_resource.resource_id, unshare_resource.role_id);
end
$$;

-- Who has access to a resource, and where it comes from: the resource itself, a folder above it, or the organization.
-- Anyone who can read the resource reads the assignments that reach it, through the resource_access view of p9s. A
-- folder above that the member cannot see has no name
do $$ begin create type access_entry as (role_id uuid, kind text, name text, detail text, permission text, direct boolean, from_name text, from_folder_id uuid); exception when duplicate_object then null; end $$;

create or replace function resource_access_entries(resource_id uuid, org_id uuid) returns setof access_entry
language sql stable as $$
  select a.role_id, p.kind, p.name, p.detail, a.permission::text, a.assigned_resource_id = resource_access_entries.resource_id,
    case when a.assigned_resource_id <> resource_access_entries.resource_id then coalesce(f.name, src.name) end,
    case when a.assigned_resource_id <> resource_access_entries.resource_id then f.id end
  from organization o
  cross join lateral organization_principals(o) p
  join resource_access a on a.role_id = p.role_id and a.resource_id = resource_access_entries.resource_id
  left join folder f on f.resource_id = a.assigned_resource_id
  left join organization src on src.resource_id = a.assigned_resource_id
  where o.id = resource_access_entries.org_id and a.permission & b'11111100' <> b'00000000'
  order by a.assigned_resource_id = resource_access_entries.resource_id desc, case p.kind when 'member' then 0 when 'team' then 1 else 2 end, p.name
$$;

create or replace function folder_access(f folder) returns setof access_entry
language sql stable as $$
  select * from resource_access_entries(f.resource_id, f.org_id)
$$;

create or replace function document_access(d document) returns setof access_entry
language sql stable as $$
  select * from resource_access_entries(d.resource_id, d.org_id)
$$;

-- What a member can do in every space, for the access overview, which only admins see. `resource_permission(resource_id,
-- role_id)` gives the bits of another role to those with the manageAccess bit on the resource, the read bit here: admins
-- read every space. Ordered like organization_spaces
create or replace function member_space_permissions(m member) returns text[]
language sql stable as $$
  select coalesce(array_agg(nullif(resource_permission(f.resource_id, m.role_id) & b'11111100', b'00000000')::text order by f.name, f.id), '{}')
  from folder f
  where f.org_id = m.org_id and f.parent_id is null
    and bit_on(resource_permission((select o.resource_id from organization o where o.id = m.org_id)), 7)
$$;

-- For the sign-in page: which demo accounts the seed created
do $$ begin create type demo_accounts as (mock_users int, acme boolean); exception when duplicate_object then null; end $$;

create or replace function demo_accounts() returns demo_accounts
language sql stable security definer set search_path = public, pg_temp as $$
  select count(*) filter (where email like '%@example.test')::int, coalesce(bool_or(email = 'alice@acme.test'), false) from "user"
$$;

-- The audit log. RLS shows it to admins only: everyone else gets no rows

create or replace function organization_audit_events(o organization, category text default null, member_id uuid default null) returns setof audit_event
language sql stable as $$
  select * from audit_event e
  where e.org_id = o.id and (organization_audit_events.member_id is null or e.actor_member_id = organization_audit_events.member_id)
    and case category
      when 'content' then e.subject_kind in ('space', 'folder', 'document') and e.action not in ('shared', 'changed access to', 'removed access to')
      when 'sharing' then e.action in ('shared', 'changed access to', 'removed access to')
      when 'people' then e.subject_kind in ('member', 'team') and e.action not like '% as'
      when 'impersonation' then e.impersonator_member_id is not null or e.action like '% as'
      when 'api' then e.api_key_name is not null or e.subject_kind = 'api_key'
      else true
    end
  order by e.created_at desc, e.id
$$;

-- Impersonation. An admin views the organization as one of its members, with the member's role id: RLS shows exactly
-- what the member sees. Viewing is read only, enforced by Postgres. Acting allows changes, which the audit log records
-- as made by the member, and by the admin acting as them. The server follows a cookie that names the member, and
-- checks again for every request that the signed-in user is an admin: these only check and record when it starts and
-- stops.

create or replace function record_impersonation(member_id uuid, mode text, started boolean) returns member
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  admin member := (select m from member m where m.id = current_member_id());
  target member := (select m from member m where m.id = record_impersonation.member_id);
  admin_name text := (select u.name from "user" u where u.id = admin.user_id);
begin
  if current_impersonator_id() is not null then perform forbidden('Stop acting as someone else first.'); end if;
  if mode not in ('view', 'act') then perform not_found('No such mode.'); end if;
  if admin is null or admin.id = record_impersonation.member_id then perform forbidden('That is you.'); end if;
  if not bit_on(resource_permission((select o.resource_id from organization o where o.id = admin.org_id)), 7) then
    perform forbidden('Only admins can view the organization as someone else.');
  end if;
  if target is null or target.org_id <> admin.org_id then perform not_found('No such member.'); end if;
  insert into audit_event (org_id, actor_member_id, actor_name, action, subject_kind, subject_id, subject_name)
  values (admin.org_id, admin.id, admin_name,
    case when started then 'started ' else 'stopped ' end || case mode when 'view' then 'viewing as' else 'acting as' end,
    'member', target.id, (select u.name from "user" u where u.id = target.user_id));
  return target;
end
$$;

create or replace function start_impersonation(member_id uuid, mode text) returns member
language sql volatile as $$
  select record_impersonation(member_id, mode, true)
$$;

create or replace function stop_impersonation(member_id uuid, mode text) returns member
language sql volatile as $$
  select record_impersonation(member_id, mode, false)
$$;

-- API keys. Role tables have no RLS, so only their member manages their keys, and admins acting as someone cannot get
-- keys in their name. A key is stored hashed: the server hashes the token of each request the same way

do $$ begin create type api_key_info as (id uuid, name text, token_start text, created_at timestamp, last_used_at timestamp); exception when duplicate_object then null; end $$;

create or replace function my_api_keys() returns setof api_key_info
language sql stable security definer set search_path = public, pg_temp as $$
  select id, name, token_start, created_at, last_used_at from api_key where member_id = current_member_id() order by created_at desc
$$;

create or replace function api_key_hash(token text) returns text
language sql immutable as $$
  select encode(sha256(convert_to(token, 'UTF8')), 'hex')
$$;

-- Returns the token, which is only shown once
create or replace function create_api_key(name text) returns text
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  token text := 'p9s_' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  if current_impersonator_id() is not null then perform forbidden('API keys can only be managed by their owner.'); end if;
  if current_member_id() is null then perform forbidden('You don''t have permission to do that.'); end if;
  insert into api_key (member_id, name, token_hash, token_start) values (current_member_id(), create_api_key.name, api_key_hash(token), left(token, 8));
  perform audit_write('created', 'api_key', null, create_api_key.name);
  return token;
end
$$;

create or replace function revoke_api_key(id uuid) returns boolean
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  revoked text;
begin
  if current_impersonator_id() is not null then perform forbidden('API keys can only be managed by their owner.'); end if;
  delete from api_key k where k.id = revoke_api_key.id and k.member_id = current_member_id() returning k.name into revoked;
  if revoked is null then perform not_found('No such key.'); end if;
  perform audit_write('revoked', 'api_key', null, revoked);
  return true;
end
$$;

-- Privileges. Functions are executable by everyone unless revoked

do $$
declare
  the_function regprocedure;
begin
  for the_function in
    select p.oid::regprocedure from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname in (
      'bit_on', 'access_level_bits', 'bits_within', 'contains_pattern', 'forbidden', 'not_found', 'current_member_id', 'current_user_id',
      'current_impersonator_id', 'viewer', 'my_organizations', 'current_member', 'current_impersonation', 'member_name', 'member_email',
      'member_teams', 'team_member_count', 'team_administers', 'organization_members', 'invite_member', 'remove_member', 'create_team',
      'delete_team', 'set_team_membership', 'create_organization', 'organization_spaces', 'organization_shared_folders',
      'organization_shared_documents', 'organization_search_folders', 'organization_search_documents', 'organization_move_targets',
      'folder_path', 'document_path', 'create_folder', 'move_folder', 'create_document', 'organization_principals', 'share_resource',
      'unshare_resource', 'resource_access_entries', 'folder_access', 'document_access', 'member_space_permissions', 'demo_accounts',
      'organization_audit_events', 'record_impersonation', 'start_impersonation', 'stop_impersonation', 'my_api_keys', 'api_key_hash',
      'create_api_key', 'revoke_api_key'
    )
  loop
    execute format('revoke execute on function %s from public', the_function);
    execute format('grant execute on function %s to app_user', the_function);
  end loop;
end
$$;
revoke execute on function document_touch() from public;

-- What PostGraphile shows. Rows of node tables are created by the functions above, organizations, teams and members
-- only change through them, and columns that the graph or the server fill cannot be written
comment on table organization is '@behavior -insert -update -delete';
comment on table team is '@behavior -insert -update -delete';
comment on table member is '@behavior -insert -update -delete';
comment on table folder is '@behavior -insert';
comment on column folder.org_id is '@behavior -update';
comment on column folder.parent_id is '@behavior -update';
comment on column folder.resource_id is '@behavior -insert -update';
comment on column folder.created_at is '@behavior -insert -update';
comment on table document is '@behavior -insert';
comment on column document.org_id is '@behavior -update';
comment on column document.created_by is '@behavior -update';
comment on column document.resource_id is '@behavior -insert -update';
comment on column document.created_at is '@behavior -insert -update';
comment on column document.updated_at is '@behavior -insert -update';
comment on table comment is '@behavior -update';
comment on column comment.member_id is '@behavior -insert';
comment on column comment.created_at is '@behavior -insert';
comment on column comment.resource_parent_id is '@behavior -*';
comment on table audit_event is '@behavior -insert -update -delete';
comment on column audit_event.resource_parent_id is '@behavior -*';
comment on table "user" is '@behavior -*';
comment on table session is '@behavior -*';
comment on table account is '@behavior -*';
comment on table verification is '@behavior -*';
comment on table api_key is '@behavior -*';
-- Members and audit events of an organization are read through `members` and `auditEvents`, which filter them
comment on constraint team_org_id_fkey on team is E'@fieldName organization\n@foreignFieldName teams';
comment on constraint member_org_id_fkey on member is E'@fieldName organization\n@backwardBehavior -*';
comment on constraint folder_org_id_fkey on folder is E'@fieldName organization\n@foreignFieldName folders';
comment on constraint document_org_id_fkey on document is E'@fieldName organization\n@foreignFieldName documents';
comment on constraint audit_event_org_id_fkey on audit_event is E'@fieldName organization\n@backwardBehavior -*';
comment on constraint comment_document_id_fkey on comment is E'@fieldName document\n@foreignFieldName comments';
-- Only there for the foreign keys that keep folders and documents in the organization of their folder
comment on constraint folder_id_org_id_unique on folder is '@behavior -*';
comment on constraint folder_parent_org_fk on folder is E'@fieldName parent\n@foreignFieldName children';
comment on constraint document_folder_org_fk on document is E'@fieldName folder\n@foreignFieldName documents';
comment on constraint comment_member_id_fkey on comment is E'@fieldName author\n@foreignFieldName comments';
comment on constraint document_created_by_fkey on document is E'@fieldName author\n@foreignFieldName createdDocuments';

comment on function bit_on(bit, int) is '@behavior -*';
comment on function access_level_bits(text) is '@behavior -*';
comment on function bits_within(bit, bit) is '@behavior -*';
comment on function contains_pattern(text) is '@behavior -*';
comment on function forbidden(text) is '@behavior -*';
comment on function not_found(text) is '@behavior -*';
comment on function current_member_id() is '@behavior -*';
comment on function current_user_id() is '@behavior -*';
comment on function current_impersonator_id() is '@behavior -*';
comment on function current_role_id() is '@behavior -*';
comment on function record_impersonation(uuid, text, boolean) is '@behavior -*';
comment on function api_key_hash(text) is '@behavior -*';
comment on function document_touch() is '@behavior -*';
-- The p9s search functions take a pattern and search every organization: the API searches one, with searchFolders and
-- searchDocuments
comment on function folder_search(text) is '@behavior -*';
comment on function document_search(text) is '@behavior -*';
comment on function member_name(member) is '@fieldName name';
comment on function member_email(member) is '@fieldName email';
comment on function member_teams(member) is '@fieldName teams';
comment on function team_member_count(team) is '@fieldName memberCount';
comment on function team_administers(team) is '@fieldName administers';
comment on function organization_members(organization, text) is '@fieldName members';
comment on function organization_spaces(organization) is '@fieldName spaces';
comment on function organization_shared_folders(organization) is '@fieldName sharedFolders';
comment on function organization_shared_documents(organization) is '@fieldName sharedDocuments';
comment on function organization_search_folders(organization, text) is '@fieldName searchFolders';
comment on function organization_search_documents(organization, text) is '@fieldName searchDocuments';
comment on function organization_move_targets(organization) is '@fieldName moveTargets';
comment on function organization_principals(organization, text) is '@fieldName principals';
comment on function organization_audit_events(organization, text, uuid) is '@fieldName auditEvents';
comment on function member_space_permissions(member) is '@fieldName spacePermissions';
comment on function resource_access_entries(uuid, uuid) is '@behavior -*';
comment on function folder_access(folder) is '@fieldName access';
comment on function document_access(document) is '@fieldName access';
comment on function folder_path(folder) is '@fieldName path';
comment on function document_path(document) is '@fieldName path';
comment on function invite_member(uuid, text) is '@resultFieldName member';
comment on function create_team(uuid, text) is '@resultFieldName team';
comment on function create_organization(text) is '@resultFieldName organization';
comment on function create_folder(uuid, uuid, text) is '@resultFieldName folder';
comment on function move_folder(uuid, uuid) is '@resultFieldName folder';
comment on function create_document(uuid, text, text) is '@resultFieldName document';
comment on function start_impersonation(uuid, text) is '@resultFieldName member';
comment on function stop_impersonation(uuid, text) is '@resultFieldName member';
comment on function create_api_key(text) is '@resultFieldName token';
