
  
-----------------------------------------------------------------------------------------------------------------------
-- Preamble
-----------------------------------------------------------------------------------------------------------------------
-- p9s objects are created unqualified, and security definer functions pin search_path to the configured schema
do $$
begin
  if current_schema() is distinct from 'public' then
    raise exception 'p9s: run this migration with % as the current schema, got %', 'public', current_schema();
  end if;
end
$$;


-- Session-local helper. It never touches the owner's privileges, revoking those would lock the migration role out.
create or replace function pg_temp.p9s_set_privileges(target regclass, read_roles text[], write_roles text[], other_roles text[])
returns void as $$
declare
  owner_role name := (select pg_get_userbyid(relowner) from pg_class where oid = target);
  the_role text;
  the_sequence text;
begin
  foreach the_role in array read_roles || write_roles || other_roles loop
    continue when the_role = owner_role;
    execute format('revoke all on table %s from %I', target, the_role);
  end loop;
  foreach the_role in array read_roles loop
    continue when the_role = owner_role;
    execute format('grant select on table %s to %I', target, the_role);
  end loop;
  foreach the_role in array write_roles loop
    continue when the_role = owner_role;
    execute format('grant select, insert, update, delete on table %s to %I', target, the_role);
    for the_sequence in
      select pg_get_serial_sequence(target::text, attname) from pg_attribute
      where attrelid = target and attnum > 0 and not attisdropped and pg_get_serial_sequence(target::text, attname) is not null
    loop
      execute format('grant usage, select on sequence %s to %I', the_sequence, the_role);
    end loop;
  end loop;
end;
$$ language plpgsql;

-- The migration role owns the functions it creates
create or replace function pg_temp.p9s_revoke_execute(target text, roles text[])
returns void as $$
declare
  the_role text;
begin
  foreach the_role in array roles loop
    continue when the_role = current_user;
    execute format('revoke execute on function %s from %I', target, the_role);
  end loop;
end;
$$ language plpgsql;


  
do $$
declare
  "the_trigger" record;
begin
  for "the_trigger" in
    select "t"."tgrelid"::regclass::text as "table", "t"."tgname"::text as "name", "the_name"."name" as "expected",
      exists (select from pg_trigger as "o" where "o"."tgrelid" = "t"."tgrelid" and "o"."tgname" = "the_name"."name") as "replaced"
    from pg_trigger as "t"
    join pg_proc as "p" on "p"."oid" = "t"."tgfoid"
    join unnest(array['05_resource_edge_guard_insert_trigger', '05_resource_edge_guard_update_trigger', '05_resource_edge_guard_delete_trigger', '10_resource_edge_insert_trigger', '10_resource_edge_update_trigger', '10_resource_edge_delete_trigger', '10_resource_node_insert_trigger', '10_resource_node_update_trigger', '10_resource_node_delete_trigger', '05_role_edge_guard_insert_trigger', '05_role_edge_guard_update_trigger', '05_role_edge_guard_delete_trigger', '10_role_edge_insert_trigger', '10_role_edge_update_trigger', '10_role_edge_delete_trigger', '10_role_node_insert_trigger', '10_role_node_update_trigger', '10_role_node_delete_trigger', '10_assignment_edge_insert_trigger', '10_assignment_edge_update_trigger', '10_assignment_edge_delete_trigger', '05_assignment_edge_validate_insert_trigger', '05_assignment_edge_validate_update_trigger', '20_assignment_edge_role_insert_trigger', '20_assignment_edge_role_update_trigger', '20_assignment_edge_role_delete_trigger', '05_truncate_guard_trigger', '10_account_resource_insert_trigger', '10_account_resource_update_trigger', '10_account_resource_delete_trigger', '10_account_role_insert_trigger', '10_account_role_update_trigger', '10_account_role_delete_trigger', '10_account_resource_parent_trigger', '10_account_role_parent_trigger', '10_api_key_resource_insert_trigger', '10_api_key_resource_update_trigger', '10_api_key_resource_delete_trigger', '10_api_key_role_insert_trigger', '10_api_key_role_update_trigger', '10_api_key_role_delete_trigger', '10_api_key_resource_parent_trigger', '10_api_key_role_parent_trigger', '10_audit_event_resource_insert_trigger', '10_audit_event_resource_update_trigger', '10_audit_event_resource_delete_trigger', '10_audit_event_role_insert_trigger', '10_audit_event_role_update_trigger', '10_audit_event_role_delete_trigger', '10_audit_event_resource_parent_trigger', '10_audit_event_role_parent_trigger', '10_comment_resource_insert_trigger', '10_comment_resource_update_trigger', '10_comment_resource_delete_trigger', '10_comment_role_insert_trigger', '10_comment_role_update_trigger', '10_comment_role_delete_trigger', '10_comment_resource_parent_trigger', '10_comment_role_parent_trigger', '10_document_resource_insert_trigger', '10_document_resource_update_trigger', '10_document_resource_delete_trigger', '10_document_role_insert_trigger', '10_document_role_update_trigger', '10_document_role_delete_trigger', '10_document_resource_parent_trigger', '10_document_role_parent_trigger', '10_folder_resource_insert_trigger', '10_folder_resource_update_trigger', '10_folder_resource_delete_trigger', '10_folder_role_insert_trigger', '10_folder_role_update_trigger', '10_folder_role_delete_trigger', '10_folder_resource_parent_trigger', '10_folder_role_parent_trigger', '10_member_resource_insert_trigger', '10_member_resource_update_trigger', '10_member_resource_delete_trigger', '10_member_role_insert_trigger', '10_member_role_update_trigger', '10_member_role_delete_trigger', '10_member_resource_parent_trigger', '10_member_role_parent_trigger', '10_organization_resource_insert_trigger', '10_organization_resource_update_trigger', '10_organization_resource_delete_trigger', '10_organization_role_insert_trigger', '10_organization_role_update_trigger', '10_organization_role_delete_trigger', '10_organization_resource_parent_trigger', '10_organization_role_parent_trigger', '10_session_resource_insert_trigger', '10_session_resource_update_trigger', '10_session_resource_delete_trigger', '10_session_role_insert_trigger', '10_session_role_update_trigger', '10_session_role_delete_trigger', '10_session_resource_parent_trigger', '10_session_role_parent_trigger', '10_team_resource_insert_trigger', '10_team_resource_update_trigger', '10_team_resource_delete_trigger', '10_team_role_insert_trigger', '10_team_role_update_trigger', '10_team_role_delete_trigger', '10_team_resource_parent_trigger', '10_team_role_parent_trigger', '10_user_resource_insert_trigger', '10_user_resource_update_trigger', '10_user_resource_delete_trigger', '10_user_role_insert_trigger', '10_user_role_update_trigger', '10_user_role_delete_trigger', '10_user_resource_parent_trigger', '10_user_role_parent_trigger', '10_verification_resource_insert_trigger', '10_verification_resource_update_trigger', '10_verification_resource_delete_trigger', '10_verification_role_insert_trigger', '10_verification_role_update_trigger', '10_verification_role_delete_trigger', '10_verification_resource_parent_trigger', '10_verification_role_parent_trigger']::text[], array['05_resource_edge_guard_insert_trigger', '05_resource_edge_guard_update_trigger', '05_resource_edge_guard_delete_trigger', '10_resource_edge_insert_trigger', '10_resource_edge_update_trigger', '10_resource_edge_delete_trigger', '10_resource_node_insert_trigger', '10_resource_node_update_trigger', '10_resource_node_delete_trigger', '05_role_edge_guard_insert_trigger', '05_role_edge_guard_update_trigger', '05_role_edge_guard_delete_trigger', '10_role_edge_insert_trigger', '10_role_edge_update_trigger', '10_role_edge_delete_trigger', '10_role_node_insert_trigger', '10_role_node_update_trigger', '10_role_node_delete_trigger', '10_assignment_edge_insert_trigger', '10_assignment_edge_update_trigger', '10_assignment_edge_delete_trigger', '05_assignment_edge_validate_insert_trigger', '05_assignment_edge_validate_update_trigger', '20_assignment_edge_role_insert_trigger', '20_assignment_edge_role_update_trigger', '20_assignment_edge_role_delete_trigger', '05_truncate_guard_trigger', '10_account_resource_insert_trigger', '10_account_resource_update_trigger', '10_account_resource_delete_trigger', '10_account_role_insert_trigger', '10_account_role_update_trigger', '10_account_role_delete_trigger', '10_account_resource_parent_trigger', '10_account_role_parent_trigger', '10_api_key_resource_insert_trigger', '10_api_key_resource_update_trigger', '10_api_key_resource_delete_trigger', '10_api_key_role_insert_trigger', '10_api_key_role_update_trigger', '10_api_key_role_delete_trigger', '10_api_key_resource_parent_trigger', '10_api_key_role_parent_trigger', '10_audit_event_resource_insert_trigger', '10_audit_event_resource_update_trigger', '10_audit_event_resource_delete_trigger', '10_audit_event_role_insert_trigger', '10_audit_event_role_update_trigger', '10_audit_event_role_delete_trigger', '10_audit_event_resource_parent_trigger', '10_audit_event_role_parent_trigger', '10_comment_resource_insert_trigger', '10_comment_resource_update_trigger', '10_comment_resource_delete_trigger', '10_comment_role_insert_trigger', '10_comment_role_update_trigger', '10_comment_role_delete_trigger', '10_comment_resource_parent_trigger', '10_comment_role_parent_trigger', '10_document_resource_insert_trigger', '10_document_resource_update_trigger', '10_document_resource_delete_trigger', '10_document_role_insert_trigger', '10_document_role_update_trigger', '10_document_role_delete_trigger', '10_document_resource_parent_trigger', '10_document_role_parent_trigger', '10_folder_resource_insert_trigger', '10_folder_resource_update_trigger', '10_folder_resource_delete_trigger', '10_folder_role_insert_trigger', '10_folder_role_update_trigger', '10_folder_role_delete_trigger', '10_folder_resource_parent_trigger', '10_folder_role_parent_trigger', '10_member_resource_insert_trigger', '10_member_resource_update_trigger', '10_member_resource_delete_trigger', '10_member_role_insert_trigger', '10_member_role_update_trigger', '10_member_role_delete_trigger', '10_member_resource_parent_trigger', '10_member_role_parent_trigger', '10_organization_resource_insert_trigger', '10_organization_resource_update_trigger', '10_organization_resource_delete_trigger', '10_organization_role_insert_trigger', '10_organization_role_update_trigger', '10_organization_role_delete_trigger', '10_organization_resource_parent_trigger', '10_organization_role_parent_trigger', '10_session_resource_insert_trigger', '10_session_resource_update_trigger', '10_session_resource_delete_trigger', '10_session_role_insert_trigger', '10_session_role_update_trigger', '10_session_role_delete_trigger', '10_session_resource_parent_trigger', '10_session_role_parent_trigger', '10_team_resource_insert_trigger', '10_team_resource_update_trigger', '10_team_resource_delete_trigger', '10_team_role_insert_trigger', '10_team_role_update_trigger', '10_team_role_delete_trigger', '10_team_resource_parent_trigger', '10_team_role_parent_trigger', '10_user_resource_insert_trigger', '10_user_resource_update_trigger', '10_user_resource_delete_trigger', '10_user_role_insert_trigger', '10_user_role_update_trigger', '10_user_role_delete_trigger', '10_user_resource_parent_trigger', '10_user_role_parent_trigger', '10_verification_resource_insert_trigger', '10_verification_resource_update_trigger', '10_verification_resource_delete_trigger', '10_verification_role_insert_trigger', '10_verification_role_update_trigger', '10_verification_role_delete_trigger', '10_verification_resource_parent_trigger', '10_verification_role_parent_trigger']::text[]) as "the_name" ("name", "unprefixed")
      on right("t"."tgname", length("the_name"."unprefixed")) = "the_name"."unprefixed"
    where not "t"."tgisinternal"
    and "t"."tgname" <> all (array['05_resource_edge_guard_insert_trigger', '05_resource_edge_guard_update_trigger', '05_resource_edge_guard_delete_trigger', '10_resource_edge_insert_trigger', '10_resource_edge_update_trigger', '10_resource_edge_delete_trigger', '10_resource_node_insert_trigger', '10_resource_node_update_trigger', '10_resource_node_delete_trigger', '05_role_edge_guard_insert_trigger', '05_role_edge_guard_update_trigger', '05_role_edge_guard_delete_trigger', '10_role_edge_insert_trigger', '10_role_edge_update_trigger', '10_role_edge_delete_trigger', '10_role_node_insert_trigger', '10_role_node_update_trigger', '10_role_node_delete_trigger', '10_assignment_edge_insert_trigger', '10_assignment_edge_update_trigger', '10_assignment_edge_delete_trigger', '05_assignment_edge_validate_insert_trigger', '05_assignment_edge_validate_update_trigger', '20_assignment_edge_role_insert_trigger', '20_assignment_edge_role_update_trigger', '20_assignment_edge_role_delete_trigger', '05_truncate_guard_trigger', '10_account_resource_insert_trigger', '10_account_resource_update_trigger', '10_account_resource_delete_trigger', '10_account_role_insert_trigger', '10_account_role_update_trigger', '10_account_role_delete_trigger', '10_account_resource_parent_trigger', '10_account_role_parent_trigger', '10_api_key_resource_insert_trigger', '10_api_key_resource_update_trigger', '10_api_key_resource_delete_trigger', '10_api_key_role_insert_trigger', '10_api_key_role_update_trigger', '10_api_key_role_delete_trigger', '10_api_key_resource_parent_trigger', '10_api_key_role_parent_trigger', '10_audit_event_resource_insert_trigger', '10_audit_event_resource_update_trigger', '10_audit_event_resource_delete_trigger', '10_audit_event_role_insert_trigger', '10_audit_event_role_update_trigger', '10_audit_event_role_delete_trigger', '10_audit_event_resource_parent_trigger', '10_audit_event_role_parent_trigger', '10_comment_resource_insert_trigger', '10_comment_resource_update_trigger', '10_comment_resource_delete_trigger', '10_comment_role_insert_trigger', '10_comment_role_update_trigger', '10_comment_role_delete_trigger', '10_comment_resource_parent_trigger', '10_comment_role_parent_trigger', '10_document_resource_insert_trigger', '10_document_resource_update_trigger', '10_document_resource_delete_trigger', '10_document_role_insert_trigger', '10_document_role_update_trigger', '10_document_role_delete_trigger', '10_document_resource_parent_trigger', '10_document_role_parent_trigger', '10_folder_resource_insert_trigger', '10_folder_resource_update_trigger', '10_folder_resource_delete_trigger', '10_folder_role_insert_trigger', '10_folder_role_update_trigger', '10_folder_role_delete_trigger', '10_folder_resource_parent_trigger', '10_folder_role_parent_trigger', '10_member_resource_insert_trigger', '10_member_resource_update_trigger', '10_member_resource_delete_trigger', '10_member_role_insert_trigger', '10_member_role_update_trigger', '10_member_role_delete_trigger', '10_member_resource_parent_trigger', '10_member_role_parent_trigger', '10_organization_resource_insert_trigger', '10_organization_resource_update_trigger', '10_organization_resource_delete_trigger', '10_organization_role_insert_trigger', '10_organization_role_update_trigger', '10_organization_role_delete_trigger', '10_organization_resource_parent_trigger', '10_organization_role_parent_trigger', '10_session_resource_insert_trigger', '10_session_resource_update_trigger', '10_session_resource_delete_trigger', '10_session_role_insert_trigger', '10_session_role_update_trigger', '10_session_role_delete_trigger', '10_session_resource_parent_trigger', '10_session_role_parent_trigger', '10_team_resource_insert_trigger', '10_team_resource_update_trigger', '10_team_resource_delete_trigger', '10_team_role_insert_trigger', '10_team_role_update_trigger', '10_team_role_delete_trigger', '10_team_resource_parent_trigger', '10_team_role_parent_trigger', '10_user_resource_insert_trigger', '10_user_resource_update_trigger', '10_user_resource_delete_trigger', '10_user_role_insert_trigger', '10_user_role_update_trigger', '10_user_role_delete_trigger', '10_user_resource_parent_trigger', '10_user_role_parent_trigger', '10_verification_resource_insert_trigger', '10_verification_resource_update_trigger', '10_verification_resource_delete_trigger', '10_verification_role_insert_trigger', '10_verification_role_update_trigger', '10_verification_role_delete_trigger', '10_verification_resource_parent_trigger', '10_verification_role_parent_trigger']::text[])
    and "p"."pronamespace" = 'public'::regnamespace
    and "p"."proname" = any (array['', 'id', 'resource', 'resource_node', 'resource_id_seq', 'resource_pkey', 'resource_edge', 'parent_id', 'child_id', 'permission', 'home', 'resource_edge_pkey', 'resource_edge_guard_trigger_function', '05_resource_edge_guard_insert_trigger', '05_resource_edge_guard_update_trigger', '05_resource_edge_guard_delete_trigger', 'resource_parent_validate', 'resource_node_insert', 'resource_node_update', 'resource_node_delete', 'resource_edge_parent_fkey', 'resource_edge_child_fkey', 'resource_edge_parent_id_index', 'resource_edge_child_id_index', 'resource_edge_cache', 'resource_edge_cache_pkey', 'resource_edge_cache_parent_pkey', 'resource_edge_cache_child_pkey', 'resource_edge_cache_parent_id_index', 'resource_edge_cache_child_id_index', 'resource_edge_cache_parent_compute', 'resource_edge_cache_child_compute', 'var_parent_id', 'var_child_id', 'resource_edge_cache_view', 'resource_edge_cache_backfill', 'resource_edge_insert_trigger_function', '10_resource_edge_insert_trigger', 'resource_edge_update_trigger_function', '10_resource_edge_update_trigger', 'resource_edge_delete_trigger_function', '10_resource_edge_delete_trigger', 'resource_node_insert_trigger_function', '10_resource_node_insert_trigger', 'resource_node_update_trigger_function', '10_resource_node_update_trigger', 'resource_node_delete_trigger_function', '10_resource_node_delete_trigger', 'resource_trigger_enable', 'resource_trigger_disable', 'role', 'role_node', 'role_id_seq', 'role_pkey', 'role_edge', 'role_edge_pkey', 'role_edge_guard_trigger_function', '05_role_edge_guard_insert_trigger', '05_role_edge_guard_update_trigger', '05_role_edge_guard_delete_trigger', 'role_parent_validate', 'role_node_insert', 'role_node_update', 'role_node_delete', 'role_edge_parent_fkey', 'role_edge_child_fkey', 'role_edge_parent_id_index', 'role_edge_child_id_index', 'role_edge_cache', 'role_edge_cache_pkey', 'role_edge_cache_parent_pkey', 'role_edge_cache_child_pkey', 'role_edge_cache_parent_id_index', 'role_edge_cache_child_id_index', 'role_edge_cache_parent_compute', 'role_edge_cache_child_compute', 'role_edge_cache_view', 'role_edge_cache_backfill', 'role_edge_insert_trigger_function', '10_role_edge_insert_trigger', 'role_edge_update_trigger_function', '10_role_edge_update_trigger', 'role_edge_delete_trigger_function', '10_role_edge_delete_trigger', 'role_node_insert_trigger_function', '10_role_node_insert_trigger', 'role_node_update_trigger_function', '10_role_node_update_trigger', 'role_node_delete_trigger_function', '10_role_node_delete_trigger', 'role_trigger_enable', 'role_trigger_disable', 'assignment', 'assignment_edge', 'resource_id', 'role_id', 'assignment_edge_pkey', 'assignment_edge_resource_fkey', 'assignment_edge_role_fkey', 'assignment_edge_resource_id_index', 'assignment_edge_role_id_index', 'assignment_edge_cache', 'assignment_edge_cache_pkey', 'assignment_edge_cache_resource_fkey', 'assignment_edge_cache_role_fkey', 'assignment_edge_cache_resource_id_index', 'assignment_edge_cache_role_id_index', 'assignment_edge_cache_view', 'assignment_edge_cache_backfill', 'assignment_edge_insert_trigger_function', '10_assignment_edge_insert_trigger', 'assignment_edge_update_trigger_function', '10_assignment_edge_update_trigger', 'assignment_edge_delete_trigger_function', '10_assignment_edge_delete_trigger', 'assignment_edge_validate_trigger_function', '05_assignment_edge_validate_insert_trigger', '05_assignment_edge_validate_update_trigger', 'assignment_edge_role_insert_trigger_function', '20_assignment_edge_role_insert_trigger', 'assignment_edge_role_update_trigger_function', '20_assignment_edge_role_update_trigger', 'assignment_edge_role_delete_trigger_function', '20_assignment_edge_role_delete_trigger', 'assignment_trigger_enable', 'assignment_trigger_disable', 'node', 'edge', 'parent', 'child', 'pkey', 'fkey', 'function', 'index', 'cache', 'compute', 'var', 'view', 'reverse', 'backfill', 'refresh', 'trigger', 'policy', 'select', 'insert', 'update', 'delete', 'recursive', 'enable', 'disable', 'seq', 'guard', 'validate', 'truncate', 'public', 'or_bitmap_8', 'truncate_guard_trigger_function', '05_truncate_guard_trigger', 'current_role_node', 'resource_permission', 'current_resource_access', 'current_assignment', 'current_resource_edge', 'current_role', 'resource_access', 'resource_role_access', 'account', 'resource_account_fkey', 'role_account_fkey', 'account_resource_trigger_function', '10_account_resource_insert_trigger', '10_account_resource_update_trigger', '10_account_resource_delete_trigger', 'account_role_trigger_function', '10_account_role_insert_trigger', '10_account_role_update_trigger', '10_account_role_delete_trigger', 'account_resource_parent', 'account_role_parent', 'resource_parent_id', 'account_resource_parent_trigger_function', '10_account_resource_parent_trigger', 'role_parent_id', 'account_role_parent_trigger_function', '10_account_role_parent_trigger', 'api_key', 'resource_api_key_fkey', 'role_api_key_fkey', 'api_key_resource_trigger_function', '10_api_key_resource_insert_trigger', '10_api_key_resource_update_trigger', '10_api_key_resource_delete_trigger', 'api_key_role_trigger_function', '10_api_key_role_insert_trigger', '10_api_key_role_update_trigger', '10_api_key_role_delete_trigger', 'api_key_resource_parent', 'api_key_role_parent', 'api_key_resource_parent_trigger_function', '10_api_key_resource_parent_trigger', 'api_key_role_parent_trigger_function', '10_api_key_role_parent_trigger', 'audit_event', 'resource_audit_event_fkey', 'role_audit_event_fkey', 'audit_event_resource_trigger_function', '10_audit_event_resource_insert_trigger', '10_audit_event_resource_update_trigger', '10_audit_event_resource_delete_trigger', 'audit_event_role_trigger_function', '10_audit_event_role_insert_trigger', '10_audit_event_role_update_trigger', '10_audit_event_role_delete_trigger', 'audit_event_resource_parent', 'audit_event_role_parent', 'audit_event_resource_parent_trigger_function', '10_audit_event_resource_parent_trigger', 'audit_event_role_parent_trigger_function', '10_audit_event_role_parent_trigger', 'audit_event_app_user_select_policy', 'audit_event_app_user_insert_policy', 'audit_event_app_user_update_policy', 'audit_event_app_user_delete_policy', 'comment', 'resource_comment_fkey', 'role_comment_fkey', 'comment_resource_trigger_function', '10_comment_resource_insert_trigger', '10_comment_resource_update_trigger', '10_comment_resource_delete_trigger', 'comment_role_trigger_function', '10_comment_role_insert_trigger', '10_comment_role_update_trigger', '10_comment_role_delete_trigger', 'comment_resource_parent', 'comment_role_parent', 'comment_resource_parent_trigger_function', '10_comment_resource_parent_trigger', 'comment_role_parent_trigger_function', '10_comment_role_parent_trigger', 'comment_app_user_select_policy', 'comment_app_user_insert_policy', 'comment_app_user_update_policy', 'comment_app_user_delete_policy', 'document', 'resource_document_fkey', 'role_document_fkey', 'document_resource_trigger_function', '10_document_resource_insert_trigger', '10_document_resource_update_trigger', '10_document_resource_delete_trigger', 'document_role_trigger_function', '10_document_role_insert_trigger', '10_document_role_update_trigger', '10_document_role_delete_trigger', 'document_resource_parent', 'document_role_parent', 'document_resource_parent_trigger_function', '10_document_resource_parent_trigger', 'document_role_parent_trigger_function', '10_document_role_parent_trigger', 'document_app_user_select_policy', 'document_app_user_insert_policy', 'document_app_user_update_policy', 'document_app_user_delete_policy', 'folder', 'resource_folder_fkey', 'role_folder_fkey', 'folder_resource_trigger_function', '10_folder_resource_insert_trigger', '10_folder_resource_update_trigger', '10_folder_resource_delete_trigger', 'folder_role_trigger_function', '10_folder_role_insert_trigger', '10_folder_role_update_trigger', '10_folder_role_delete_trigger', 'folder_resource_parent', 'folder_role_parent', 'folder_resource_parent_trigger_function', '10_folder_resource_parent_trigger', 'folder_role_parent_trigger_function', '10_folder_role_parent_trigger', 'folder_app_user_select_policy', 'folder_app_user_insert_policy', 'folder_app_user_update_policy', 'folder_app_user_delete_policy', 'member', 'resource_member_fkey', 'role_member_fkey', 'member_resource_trigger_function', '10_member_resource_insert_trigger', '10_member_resource_update_trigger', '10_member_resource_delete_trigger', 'member_role_trigger_function', '10_member_role_insert_trigger', '10_member_role_update_trigger', '10_member_role_delete_trigger', 'member_resource_parent', 'member_role_parent', 'member_resource_parent_trigger_function', '10_member_resource_parent_trigger', 'member_role_parent_trigger_function', '10_member_role_parent_trigger', 'member_app_user_select_policy', 'member_app_user_insert_policy', 'member_app_user_update_policy', 'member_app_user_delete_policy', 'organization', 'resource_organization_fkey', 'role_organization_fkey', 'organization_resource_trigger_function', '10_organization_resource_insert_trigger', '10_organization_resource_update_trigger', '10_organization_resource_delete_trigger', 'organization_role_trigger_function', '10_organization_role_insert_trigger', '10_organization_role_update_trigger', '10_organization_role_delete_trigger', 'organization_resource_parent', 'organization_role_parent', 'organization_resource_parent_trigger_function', '10_organization_resource_parent_trigger', 'organization_role_parent_trigger_function', '10_organization_role_parent_trigger', 'organization_app_user_select_policy', 'organization_app_user_insert_policy', 'organization_app_user_update_policy', 'organization_app_user_delete_policy', 'session', 'resource_session_fkey', 'role_session_fkey', 'session_resource_trigger_function', '10_session_resource_insert_trigger', '10_session_resource_update_trigger', '10_session_resource_delete_trigger', 'session_role_trigger_function', '10_session_role_insert_trigger', '10_session_role_update_trigger', '10_session_role_delete_trigger', 'session_resource_parent', 'session_role_parent', 'session_resource_parent_trigger_function', '10_session_resource_parent_trigger', 'session_role_parent_trigger_function', '10_session_role_parent_trigger', 'team', 'resource_team_fkey', 'role_team_fkey', 'team_resource_trigger_function', '10_team_resource_insert_trigger', '10_team_resource_update_trigger', '10_team_resource_delete_trigger', 'team_role_trigger_function', '10_team_role_insert_trigger', '10_team_role_update_trigger', '10_team_role_delete_trigger', 'team_resource_parent', 'team_role_parent', 'team_resource_parent_trigger_function', '10_team_resource_parent_trigger', 'team_role_parent_trigger_function', '10_team_role_parent_trigger', 'team_app_user_select_policy', 'team_app_user_insert_policy', 'team_app_user_update_policy', 'team_app_user_delete_policy', 'user', 'resource_user_fkey', 'role_user_fkey', 'user_resource_trigger_function', '10_user_resource_insert_trigger', '10_user_resource_update_trigger', '10_user_resource_delete_trigger', 'user_role_trigger_function', '10_user_role_insert_trigger', '10_user_role_update_trigger', '10_user_role_delete_trigger', 'user_resource_parent', 'user_role_parent', 'user_resource_parent_trigger_function', '10_user_resource_parent_trigger', 'user_role_parent_trigger_function', '10_user_role_parent_trigger', 'verification', 'resource_verification_fkey', 'role_verification_fkey', 'verification_resource_trigger_function', '10_verification_resource_insert_trigger', '10_verification_resource_update_trigger', '10_verification_resource_delete_trigger', 'verification_role_trigger_function', '10_verification_role_insert_trigger', '10_verification_role_update_trigger', '10_verification_role_delete_trigger', 'verification_resource_parent', 'verification_role_parent', 'verification_resource_parent_trigger_function', '10_verification_resource_parent_trigger', 'verification_role_parent_trigger_function', '10_verification_role_parent_trigger']::text[])
  loop
    if "the_trigger"."replaced" then
      execute format('drop trigger %I on %s', "the_trigger"."name", "the_trigger"."table");
    else
      execute format('alter trigger %I on %s rename to %I', "the_trigger"."name", "the_trigger"."table", "the_trigger"."expected");
    end if;
  end loop;
end
$$;


  create extension if not exists "uuid-ossp";

  
-----------------------------------------------------------------------------------------------------------------------
-- Special functions
-----------------------------------------------------------------------------------------------------------------------
create or replace aggregate "or_bitmap_8" (bit) (
  sfunc = bitor,
  stype = bit,
  initcond = '00000000'
);

grant execute on function "or_bitmap_8" (bit) to "app_user";
grant execute on function "or_bitmap_8" (bit) to "app_backend";

-- Truncate skips row and statement triggers, it would leave the graph pointing at rows that no longer exist
create or replace function "truncate_guard_trigger_function"()
returns trigger as $$
begin
  raise exception 'p9s: % cannot be truncated while p9s triggers are enabled, delete its rows instead, or disable the triggers and enable them again afterwards', tg_table_name;
end;
$$ language plpgsql;


revoke execute on function "truncate_guard_trigger_function" () from public;




  
-----------------------------------------------------------------------------------------------------------------------
-- 'resource' ids
-----------------------------------------------------------------------------------------------------------------------


-----------------------------------------------------------------------------------------------------------------------
-- 'resource' edge table
-----------------------------------------------------------------------------------------------------------------------
-- Endpoints are ids of bound rows, checked by the triggers below. Home edges are the ones p9s keeps in sync with the
-- parent column of their child row.
create table if not exists "resource_edge" (
  "parent_id" uuid not null,
  "child_id" uuid not null,
  "permission" bit(8),
  "home" boolean not null default false,
  constraint "resource_edge_pkey" primary key ("parent_id", "child_id")
);

alter table "resource_edge" add column if not exists "home" boolean not null default false;

-- The triggers look up the children of nodes that mostly have none. Postgres estimates such a lookup as the edges per
-- distinct parent, so when a few nodes hold most of the rows, it would scan the whole table for a node without
-- children. Count every node instead: a node has about one child on average.
alter table "resource_edge" alter column "parent_id" set (n_distinct = -1);

create index if not exists "resource_edge_parent_id_index" on "resource_edge" ("parent_id");

create index if not exists "resource_edge_child_id_index" on "resource_edge" ("child_id");

select pg_temp.p9s_set_privileges('"resource_edge"'::regclass, array[]::text[], array['app_backend']::text[], array['app_user']::text[]);

-----------------------------------------------------------------------------------------------------------------------
-- 'resource' transitive edge cache table
-----------------------------------------------------------------------------------------------------------------------
-- Every bound row has a self row (id, id, all bits), which also makes the cache the registry of ids in use
create table if not exists "resource_edge_cache" (
  "parent_id" uuid not null,
  "child_id" uuid not null,
  "permission" bit(8),
  constraint "resource_edge_cache_pkey" primary key ("parent_id", "child_id")
);

create index if not exists "resource_edge_cache_parent_id_index" on "resource_edge_cache" ("parent_id");

create index if not exists "resource_edge_cache_child_id_index" on "resource_edge_cache" ("child_id");

-- Policies either check the ancestors of each row, or list once every resource the user can see, from the ones
-- assigned to them. Postgres estimates the descendants of an assigned resource as the cache rows per distinct parent,
-- a few rows, while assignments are mostly high in the tree, over large subtrees. It would then list every visible
-- resource to check a single row. Estimate the descendants of a resource as those of the largest subtree instead.
alter table "resource_edge_cache" alter column "parent_id" set (n_distinct = 1);

-- Only p9s triggers write to the cache. Users see their own part of the graph through the views of the current user.
select pg_temp.p9s_set_privileges('"resource_edge_cache"'::regclass, array['app_backend']::text[], array[]::text[], array['app_user']::text[]);

-----------------------------------------------------------------------------------------------------------------------
-- 'resource' compute recursive permissions, towards parent
-----------------------------------------------------------------------------------------------------------------------
create or replace function "resource_edge_cache_parent_compute" ("var_child_id" uuid)
  returns setof "resource_edge_cache"
  as $$
  with recursive "search_graph" ("parent_id", "child_id", "permission", "depth", "path") 
  as (
    (values ("var_child_id", "var_child_id", ~  b'0'::bit(8), 0, array[]::uuid[])) -- seed
    union all
    select -- recursive query
      "the_edge"."parent_id" as "parent_id",
      "the_search_graph"."child_id" as "child_id",
      ("the_search_graph"."permission"::bit(8) & "the_edge"."permission"::bit(8))::bit(8) as "permission", -- bitwise "and" on permission along a path
      "the_search_graph"."depth" + 1 as "depth", -- increment depth
      "the_search_graph"."path" || "the_edge"."child_id" as "path" -- append node id to path
    from "resource_edge" as "the_edge"
    join "search_graph" as "the_search_graph" 
    on "the_edge"."child_id" = "the_search_graph"."parent_id"
    where ("the_edge"."child_id" <> all ("the_search_graph"."path")) -- prevent from cycling
    and "the_search_graph"."depth" <= 16 -- max search depth
  )
    select
      "the_search_graph"."parent_id",
      "the_search_graph"."child_id",
      "or_bitmap_8" ("the_search_graph"."permission") -- bitwise "or" on permissions between various paths
    from "search_graph" as "the_search_graph"
    group by ("the_search_graph"."parent_id", "the_search_graph"."child_id");

-- query a recursive table. you can add limit output or use a cursor
$$
language sql
stable;


revoke execute on function "resource_edge_cache_parent_compute" ("var_child_id" uuid) from public;
select pg_temp.p9s_revoke_execute('"resource_edge_cache_parent_compute" ("var_child_id" uuid)', array['app_user']::text[]);
grant execute on function "resource_edge_cache_parent_compute" ("var_child_id" uuid) to "app_backend";

-----------------------------------------------------------------------------------------------------------------------
-- 'resource' compute recursive permissions, towards child
-----------------------------------------------------------------------------------------------------------------------
create or replace function "resource_edge_cache_child_compute" ("var_parent_id" uuid)
  returns setof "resource_edge_cache"
  as $$
  with recursive "search_graph" ("parent_id", "child_id", "permission", "depth", "path") 
  as (
    (values ("var_parent_id", "var_parent_id", ~  b'0'::bit(8), 0, array[]::uuid[])) -- seed
    union all
    select -- recursive query
      "the_search_graph"."parent_id" as "parent_id",
      "the_edge"."child_id" as "child_id",
      ("the_search_graph"."permission"::bit(8) & "the_edge"."permission"::bit(8))::bit(8) as "permission", -- bitwise "and" on permission along a path
      "the_search_graph"."depth" + 1 as "depth", -- increment depth
      "the_search_graph"."path" || "the_edge"."parent_id" as "path" -- append node id to path
    from "resource_edge" as "the_edge"
    join "search_graph" as "the_search_graph" 
    on "the_search_graph"."child_id" = "the_edge"."parent_id"
    where ("the_edge"."parent_id" <> all ("the_search_graph"."path")) -- prevent from cycling
    and "the_search_graph"."depth" <= 16 -- max search depth
  )
    select
      "the_search_graph"."parent_id",
      "the_search_graph"."child_id",
      "or_bitmap_8" ("the_search_graph"."permission") -- bitwise "or" on permissions between various paths
    from "search_graph" as "the_search_graph"
    group by ("the_search_graph"."parent_id", "the_search_graph"."child_id");

-- query a recursive table. you can add limit output or use a cursor
$$
language sql
stable;


revoke execute on function "resource_edge_cache_child_compute" ("var_parent_id" uuid) from public;
select pg_temp.p9s_revoke_execute('"resource_edge_cache_child_compute" ("var_parent_id" uuid)', array['app_user']::text[]);
grant execute on function "resource_edge_cache_child_compute" ("var_parent_id" uuid) to "app_backend";


  
-----------------------------------------------------------------------------------------------------------------------
-- 'role' ids
-----------------------------------------------------------------------------------------------------------------------


-----------------------------------------------------------------------------------------------------------------------
-- 'role' edge table
-----------------------------------------------------------------------------------------------------------------------
-- Endpoints are ids of bound rows, checked by the triggers below. Home edges are the ones p9s keeps in sync with the
-- parent column of their child row.
create table if not exists "role_edge" (
  "parent_id" uuid not null,
  "child_id" uuid not null,
  "permission" bit(8),
  "home" boolean not null default false,
  constraint "role_edge_pkey" primary key ("parent_id", "child_id")
);

alter table "role_edge" add column if not exists "home" boolean not null default false;

-- The triggers look up the children of nodes that mostly have none. Postgres estimates such a lookup as the edges per
-- distinct parent, so when a few nodes hold most of the rows, it would scan the whole table for a node without
-- children. Count every node instead: a node has about one child on average.
alter table "role_edge" alter column "parent_id" set (n_distinct = -1);

create index if not exists "role_edge_parent_id_index" on "role_edge" ("parent_id");

create index if not exists "role_edge_child_id_index" on "role_edge" ("child_id");

select pg_temp.p9s_set_privileges('"role_edge"'::regclass, array[]::text[], array['app_backend']::text[], array['app_user']::text[]);

-----------------------------------------------------------------------------------------------------------------------
-- 'role' transitive edge cache table
-----------------------------------------------------------------------------------------------------------------------
-- Every bound row has a self row (id, id, all bits), which also makes the cache the registry of ids in use
create table if not exists "role_edge_cache" (
  "parent_id" uuid not null,
  "child_id" uuid not null,
  "permission" bit(8),
  constraint "role_edge_cache_pkey" primary key ("parent_id", "child_id")
);

create index if not exists "role_edge_cache_parent_id_index" on "role_edge_cache" ("parent_id");

create index if not exists "role_edge_cache_child_id_index" on "role_edge_cache" ("child_id");

-- Only p9s triggers write to the cache. Users see their own part of the graph through the views of the current user.
select pg_temp.p9s_set_privileges('"role_edge_cache"'::regclass, array['app_backend']::text[], array[]::text[], array['app_user']::text[]);

-----------------------------------------------------------------------------------------------------------------------
-- 'role' compute recursive permissions, towards parent
-----------------------------------------------------------------------------------------------------------------------
create or replace function "role_edge_cache_parent_compute" ("var_child_id" uuid)
  returns setof "role_edge_cache"
  as $$
  with recursive "search_graph" ("parent_id", "child_id", "permission", "depth", "path") 
  as (
    (values ("var_child_id", "var_child_id", ~  b'0'::bit(8), 0, array[]::uuid[])) -- seed
    union all
    select -- recursive query
      "the_edge"."parent_id" as "parent_id",
      "the_search_graph"."child_id" as "child_id",
      ("the_search_graph"."permission"::bit(8) & "the_edge"."permission"::bit(8))::bit(8) as "permission", -- bitwise "and" on permission along a path
      "the_search_graph"."depth" + 1 as "depth", -- increment depth
      "the_search_graph"."path" || "the_edge"."child_id" as "path" -- append node id to path
    from "role_edge" as "the_edge"
    join "search_graph" as "the_search_graph" 
    on "the_edge"."child_id" = "the_search_graph"."parent_id"
    where ("the_edge"."child_id" <> all ("the_search_graph"."path")) -- prevent from cycling
    and "the_search_graph"."depth" <= 8 -- max search depth
  )
    select
      "the_search_graph"."parent_id",
      "the_search_graph"."child_id",
      "or_bitmap_8" ("the_search_graph"."permission") -- bitwise "or" on permissions between various paths
    from "search_graph" as "the_search_graph"
    group by ("the_search_graph"."parent_id", "the_search_graph"."child_id");

-- query a recursive table. you can add limit output or use a cursor
$$
language sql
stable;


revoke execute on function "role_edge_cache_parent_compute" ("var_child_id" uuid) from public;
select pg_temp.p9s_revoke_execute('"role_edge_cache_parent_compute" ("var_child_id" uuid)', array['app_user']::text[]);
grant execute on function "role_edge_cache_parent_compute" ("var_child_id" uuid) to "app_backend";

-----------------------------------------------------------------------------------------------------------------------
-- 'role' compute recursive permissions, towards child
-----------------------------------------------------------------------------------------------------------------------
create or replace function "role_edge_cache_child_compute" ("var_parent_id" uuid)
  returns setof "role_edge_cache"
  as $$
  with recursive "search_graph" ("parent_id", "child_id", "permission", "depth", "path") 
  as (
    (values ("var_parent_id", "var_parent_id", ~  b'0'::bit(8), 0, array[]::uuid[])) -- seed
    union all
    select -- recursive query
      "the_search_graph"."parent_id" as "parent_id",
      "the_edge"."child_id" as "child_id",
      ("the_search_graph"."permission"::bit(8) & "the_edge"."permission"::bit(8))::bit(8) as "permission", -- bitwise "and" on permission along a path
      "the_search_graph"."depth" + 1 as "depth", -- increment depth
      "the_search_graph"."path" || "the_edge"."parent_id" as "path" -- append node id to path
    from "role_edge" as "the_edge"
    join "search_graph" as "the_search_graph" 
    on "the_search_graph"."child_id" = "the_edge"."parent_id"
    where ("the_edge"."parent_id" <> all ("the_search_graph"."path")) -- prevent from cycling
    and "the_search_graph"."depth" <= 8 -- max search depth
  )
    select
      "the_search_graph"."parent_id",
      "the_search_graph"."child_id",
      "or_bitmap_8" ("the_search_graph"."permission") -- bitwise "or" on permissions between various paths
    from "search_graph" as "the_search_graph"
    group by ("the_search_graph"."parent_id", "the_search_graph"."child_id");

-- query a recursive table. you can add limit output or use a cursor
$$
language sql
stable;


revoke execute on function "role_edge_cache_child_compute" ("var_parent_id" uuid) from public;
select pg_temp.p9s_revoke_execute('"role_edge_cache_child_compute" ("var_parent_id" uuid)', array['app_user']::text[]);
grant execute on function "role_edge_cache_child_compute" ("var_parent_id" uuid) to "app_backend";


  
-----------------------------------------------------------------------------------------------------------------------
-- Assignment from role to resource
-----------------------------------------------------------------------------------------------------------------------
create table if not exists "assignment_edge" (
  "resource_id" uuid not null,
  "role_id" uuid not null,
  "permission" bit(8),
  constraint "assignment_edge_pkey" primary key ("resource_id", "role_id")
);

create index if not exists "assignment_edge_resource_id_index" on "assignment_edge" ("resource_id");

create index if not exists "assignment_edge_role_id_index" on "assignment_edge" ("role_id");

select pg_temp.p9s_set_privileges('"assignment_edge"'::regclass, array[]::text[], array['app_backend']::text[], array['app_user']::text[]);


  
-----------------------------------------------------------------------------------------------------------------------
-- Table bindings
-----------------------------------------------------------------------------------------------------------------------

alter table "public"."document" add column if not exists "resource_id" uuid unique;

alter table "public"."folder" add column if not exists "resource_id" uuid unique;

alter table "public"."member" add column if not exists "resource_id" uuid unique;

alter table "public"."organization" add column if not exists "resource_id" uuid unique;

alter table "public"."team" add column if not exists "resource_id" uuid unique;

alter table "public"."member" add column if not exists "role_id" uuid unique;

alter table "public"."organization" add column if not exists "role_id" uuid unique;

alter table "public"."team" add column if not exists "role_id" uuid unique;

alter table "public"."api_key" add column if not exists "role_id" uuid unique;

alter table "public"."audit_event" add column if not exists "resource_parent_id" uuid;

alter table "public"."comment" add column if not exists "resource_parent_id" uuid;

alter table "public"."api_key" add column if not exists "role_parent_id" uuid;


do $$
begin
  if not (select "atthasdef" from pg_attribute where "attrelid" = '"public"."document"'::regclass and "attname" = 'resource_id') then
    alter table "public"."document" alter column "resource_id" set default uuid_generate_v4();
  end if;
end
$$;
update "public"."document" set "resource_id" = default where "resource_id" is null;
alter table "public"."document" alter column "resource_id" set not null;


do $$
begin
  if not (select "atthasdef" from pg_attribute where "attrelid" = '"public"."folder"'::regclass and "attname" = 'resource_id') then
    alter table "public"."folder" alter column "resource_id" set default uuid_generate_v4();
  end if;
end
$$;
update "public"."folder" set "resource_id" = default where "resource_id" is null;
alter table "public"."folder" alter column "resource_id" set not null;


do $$
begin
  if not (select "atthasdef" from pg_attribute where "attrelid" = '"public"."member"'::regclass and "attname" = 'resource_id') then
    alter table "public"."member" alter column "resource_id" set default uuid_generate_v4();
  end if;
end
$$;
update "public"."member" set "resource_id" = default where "resource_id" is null;
alter table "public"."member" alter column "resource_id" set not null;


do $$
begin
  if not (select "atthasdef" from pg_attribute where "attrelid" = '"public"."organization"'::regclass and "attname" = 'resource_id') then
    alter table "public"."organization" alter column "resource_id" set default uuid_generate_v4();
  end if;
end
$$;
update "public"."organization" set "resource_id" = default where "resource_id" is null;
alter table "public"."organization" alter column "resource_id" set not null;


do $$
begin
  if not (select "atthasdef" from pg_attribute where "attrelid" = '"public"."team"'::regclass and "attname" = 'resource_id') then
    alter table "public"."team" alter column "resource_id" set default uuid_generate_v4();
  end if;
end
$$;
update "public"."team" set "resource_id" = default where "resource_id" is null;
alter table "public"."team" alter column "resource_id" set not null;


do $$
begin
  if not (select "atthasdef" from pg_attribute where "attrelid" = '"public"."member"'::regclass and "attname" = 'role_id') then
    alter table "public"."member" alter column "role_id" set default uuid_generate_v4();
  end if;
end
$$;
update "public"."member" set "role_id" = default where "role_id" is null;
alter table "public"."member" alter column "role_id" set not null;


do $$
begin
  if not (select "atthasdef" from pg_attribute where "attrelid" = '"public"."organization"'::regclass and "attname" = 'role_id') then
    alter table "public"."organization" alter column "role_id" set default uuid_generate_v4();
  end if;
end
$$;
update "public"."organization" set "role_id" = default where "role_id" is null;
alter table "public"."organization" alter column "role_id" set not null;


do $$
begin
  if not (select "atthasdef" from pg_attribute where "attrelid" = '"public"."team"'::regclass and "attname" = 'role_id') then
    alter table "public"."team" alter column "role_id" set default uuid_generate_v4();
  end if;
end
$$;
update "public"."team" set "role_id" = default where "role_id" is null;
alter table "public"."team" alter column "role_id" set not null;


do $$
begin
  if not (select "atthasdef" from pg_attribute where "attrelid" = '"public"."api_key"'::regclass and "attname" = 'role_id') then
    alter table "public"."api_key" alter column "role_id" set default uuid_generate_v4();
  end if;
end
$$;
update "public"."api_key" set "role_id" = default where "role_id" is null;
alter table "public"."api_key" alter column "role_id" set not null;



  
-----------------------------------------------------------------------------------------------------------------------
-- 'resource' view of all transitive edges, computed from scratch
-----------------------------------------------------------------------------------------------------------------------
-- This direction is easy, since we have less parents than children in general
create or replace view "resource_edge_cache_view" as
select
  "parent_permissions"."parent_id" as "parent_id",
  "parent_permissions"."child_id" as "child_id",
  "parent_permissions"."permission" as "permission"
from
  (select "resource_id" from "public"."document" union all select "resource_id" from "public"."folder" union all select "resource_id" from "public"."member" union all select "resource_id" from "public"."organization" union all select "resource_id" from "public"."team") as "the_node" ("id"),
  lateral "resource_edge_cache_parent_compute" ("the_node"."id") as "parent_permissions";

select pg_temp.p9s_set_privileges('"resource_edge_cache_view"'::regclass, array['app_backend']::text[], array[]::text[], array['app_user']::text[]);


  
-----------------------------------------------------------------------------------------------------------------------
-- 'role' view of all transitive edges, computed from scratch
-----------------------------------------------------------------------------------------------------------------------
-- This direction is easy, since we have less parents than children in general
create or replace view "role_edge_cache_view" as
select
  "parent_permissions"."parent_id" as "parent_id",
  "parent_permissions"."child_id" as "child_id",
  "parent_permissions"."permission" as "permission"
from
  (select "role_id" from "public"."member" union all select "role_id" from "public"."organization" union all select "role_id" from "public"."team") as "the_node" ("id"),
  lateral "role_edge_cache_parent_compute" ("the_node"."id") as "parent_permissions";

select pg_temp.p9s_set_privileges('"role_edge_cache_view"'::regclass, array['app_backend']::text[], array[]::text[], array['app_user']::text[]);


  
-----------------------------------------------------------------------------------------------------------------------
-- Upgrade from node tables: 'resource'
-----------------------------------------------------------------------------------------------------------------------
do $$
declare
  "the_count" bigint;
begin
  if to_regclass('resource_node') is not null then
    select count(*) into "the_count" from "resource_node" as "the_node" where not exists (select from "public"."document" as "the_row" where "the_row"."resource_id" = "the_node"."id") and not exists (select from "public"."folder" as "the_row" where "the_row"."resource_id" = "the_node"."id") and not exists (select from "public"."member" as "the_row" where "the_row"."resource_id" = "the_node"."id") and not exists (select from "public"."organization" as "the_row" where "the_row"."resource_id" = "the_node"."id") and not exists (select from "public"."team" as "the_row" where "the_row"."resource_id" = "the_node"."id");
    if "the_count" > 0 then
      raise exception 'p9s: % % nodes are not a row of a bound table. Bind a table that holds them (a table with only an id column is enough) or delete them, then run the migration again.', "the_count", 'resource';
    end if;
    alter table "resource_edge" drop constraint if exists "resource_edge_parent_fkey";
    alter table "resource_edge" drop constraint if exists "resource_edge_child_fkey";
    alter table "resource_edge_cache" drop constraint if exists "resource_edge_cache_parent_pkey";
    alter table "resource_edge_cache" drop constraint if exists "resource_edge_cache_child_pkey";
    alter table "assignment_edge" drop constraint if exists "assignment_edge_resource_fkey";
    alter table if exists "assignment_edge_cache" drop constraint if exists "assignment_edge_cache_resource_fkey";
    alter table "public"."audit_event" drop constraint if exists "resource_audit_event_fkey";
    alter table "public"."comment" drop constraint if exists "resource_comment_fkey";
    alter table "public"."document" drop constraint if exists "resource_document_fkey";
    alter table "public"."folder" drop constraint if exists "resource_folder_fkey";
    alter table "public"."member" drop constraint if exists "resource_member_fkey";
    alter table "public"."organization" drop constraint if exists "resource_organization_fkey";
    alter table "public"."team" drop constraint if exists "resource_team_fkey";
    -- Recreated below. The bootstrap rebuilds the cache, there is no need to refresh it edge by edge here.
    drop trigger if exists "10_resource_edge_insert_trigger" on "resource_edge";
    drop trigger if exists "10_resource_edge_update_trigger" on "resource_edge";
    drop trigger if exists "10_resource_edge_delete_trigger" on "resource_edge";
    -- Edges that match a parent column become the home edges of their rows
    
    update "resource_edge" as "the_edge" set "home" = true
    from "public"."document" as "the_row"
    where "the_edge"."child_id" = "the_row"."resource_id" and "the_edge"."parent_id" = (select "the_parent"."resource_id" from "public"."folder" as "the_parent" where "the_parent"."id" = "the_row"."folder_id");

    update "resource_edge" as "the_edge" set "home" = true
    from "public"."folder" as "the_row"
    where "the_edge"."child_id" = "the_row"."resource_id" and "the_edge"."parent_id" = "the_row"."parent_resource_id";

    update "resource_edge" as "the_edge" set "home" = true
    from "public"."member" as "the_row"
    where "the_edge"."child_id" = "the_row"."resource_id" and "the_edge"."parent_id" = (select "the_parent"."resource_id" from "public"."organization" as "the_parent" where "the_parent"."id" = "the_row"."org_id");

    update "resource_edge" as "the_edge" set "home" = true
    from "public"."team" as "the_row"
    where "the_edge"."child_id" = "the_row"."resource_id" and "the_edge"."parent_id" = (select "the_parent"."resource_id" from "public"."organization" as "the_parent" where "the_parent"."id" = "the_row"."org_id");
    drop table "resource_node";
    drop function if exists "resource_node_insert_trigger_function"();
    drop function if exists "resource_node_update_trigger_function"();
    drop function if exists "resource_node_delete_trigger_function"();
  end if;
end
$$;


  
-----------------------------------------------------------------------------------------------------------------------
-- Upgrade from node tables: 'role'
-----------------------------------------------------------------------------------------------------------------------
do $$
declare
  "the_count" bigint;
begin
  if to_regclass('role_node') is not null then
    select count(*) into "the_count" from "role_node" as "the_node" where not exists (select from "public"."member" as "the_row" where "the_row"."role_id" = "the_node"."id") and not exists (select from "public"."organization" as "the_row" where "the_row"."role_id" = "the_node"."id") and not exists (select from "public"."team" as "the_row" where "the_row"."role_id" = "the_node"."id");
    if "the_count" > 0 then
      raise exception 'p9s: % % nodes are not a row of a bound table. Bind a table that holds them (a table with only an id column is enough) or delete them, then run the migration again.', "the_count", 'role';
    end if;
    alter table "role_edge" drop constraint if exists "role_edge_parent_fkey";
    alter table "role_edge" drop constraint if exists "role_edge_child_fkey";
    alter table "role_edge_cache" drop constraint if exists "role_edge_cache_parent_pkey";
    alter table "role_edge_cache" drop constraint if exists "role_edge_cache_child_pkey";
    alter table "assignment_edge" drop constraint if exists "assignment_edge_role_fkey";
    alter table if exists "assignment_edge_cache" drop constraint if exists "assignment_edge_cache_role_fkey";
    alter table "public"."api_key" drop constraint if exists "role_api_key_fkey";
    alter table "public"."member" drop constraint if exists "role_member_fkey";
    alter table "public"."organization" drop constraint if exists "role_organization_fkey";
    alter table "public"."team" drop constraint if exists "role_team_fkey";
    -- Recreated below. The bootstrap rebuilds the cache, there is no need to refresh it edge by edge here.
    drop trigger if exists "10_role_edge_insert_trigger" on "role_edge";
    drop trigger if exists "10_role_edge_update_trigger" on "role_edge";
    drop trigger if exists "10_role_edge_delete_trigger" on "role_edge";
    -- Edges that match a parent column become the home edges of their rows
    
    update "role_edge" as "the_edge" set "home" = true
    from "public"."member" as "the_row"
    where "the_edge"."child_id" = "the_row"."role_id" and "the_edge"."parent_id" = (select "the_parent"."role_id" from "public"."organization" as "the_parent" where "the_parent"."id" = "the_row"."org_id");
    drop table "role_node";
    drop function if exists "role_node_insert_trigger_function"();
    drop function if exists "role_node_update_trigger_function"();
    drop function if exists "role_node_delete_trigger_function"();
  end if;
end
$$;


  
-----------------------------------------------------------------------------------------------------------------------
-- 'resource' function to rebuild the cache from scratch
-----------------------------------------------------------------------------------------------------------------------
create or replace function "resource_edge_cache_backfill" ()
  returns setof "resource_edge_cache"
  as $$
begin
  perform pg_advisory_xact_lock(hashtext('p9s:public:'));
  if exists (select from (select "resource_id" from "public"."document" union all select "resource_id" from "public"."folder" union all select "resource_id" from "public"."member" union all select "resource_id" from "public"."organization" union all select "resource_id" from "public"."team") as "the_id" ("id") group by "the_id"."id" having count(*) > 1) then
    raise exception 'p9s: the % id % is used by more than one bound row', 'resource',
      (select "the_id"."id" from (select "resource_id" from "public"."document" union all select "resource_id" from "public"."folder" union all select "resource_id" from "public"."member" union all select "resource_id" from "public"."organization" union all select "resource_id" from "public"."team") as "the_id" ("id") group by "the_id"."id" having count(*) > 1 limit 1)
      using errcode = 'unique_violation';
  end if;
  -- Anti joins rather than not in: Postgres only hashes a not in that it expects to fit in work_mem, and otherwise
  -- scans the ids again for every edge
  if exists (select from "resource_edge" as "the_edge" where not exists (select from (select "resource_id" from "public"."document" union all select "resource_id" from "public"."folder" union all select "resource_id" from "public"."member" union all select "resource_id" from "public"."organization" union all select "resource_id" from "public"."team") as "the_id" ("id") where "the_id"."id" = "the_edge"."parent_id"))
    or exists (select from "resource_edge" as "the_edge" where not exists (select from (select "resource_id" from "public"."document" union all select "resource_id" from "public"."folder" union all select "resource_id" from "public"."member" union all select "resource_id" from "public"."organization" union all select "resource_id" from "public"."team") as "the_id" ("id") where "the_id"."id" = "the_edge"."child_id")) then
    raise exception 'p9s: % edges connect ids that are not rows of bound tables', 'resource' using errcode = 'foreign_key_violation';
  end if;
  if exists (select from "assignment_edge" as "the_assignment" where not exists (select from (select "resource_id" from "public"."document" union all select "resource_id" from "public"."folder" union all select "resource_id" from "public"."member" union all select "resource_id" from "public"."organization" union all select "resource_id" from "public"."team") as "the_id" ("id") where "the_id"."id" = "the_assignment"."resource_id")) then
    raise exception 'p9s: assignments reference % ids that are not rows of bound tables', 'resource' using errcode = 'foreign_key_violation';
  end if;
  -- Backfills usually follow a bulk load, before autovacuum has gathered statistics. Without them the planner can
  -- seq scan the edge table at every step of the recursive walk, which is quadratic in the number of edges.
  -- This has to be plpgsql: a sql function plans every statement before running the first one.
  analyze "resource_edge";
  if exists (select from (
    with recursive "walk" ("node", "depth", "path") as (
      select distinct "the_edge"."child_id", 0, array["the_edge"."child_id"] from "resource_edge" as "the_edge"
      union all
      select "the_edge"."parent_id", "walk"."depth" + 1, "the_edge"."parent_id" || "walk"."path"
      from "walk" join "resource_edge" as "the_edge" on "the_edge"."child_id" = "walk"."node"
      where "the_edge"."parent_id" <> all ("walk"."path") and "walk"."depth" <= 16
    )
    select "walk"."path" from "walk" where "walk"."depth" > 16
  ) as "the_path") then
    raise exception 'p9s: the % path % has more than % edges, the maxDepth of the % tree', 'resource',
      (select array_to_string("the_path"."path", ' -> ') from (
    with recursive "walk" ("node", "depth", "path") as (
      select distinct "the_edge"."child_id", 0, array["the_edge"."child_id"] from "resource_edge" as "the_edge"
      union all
      select "the_edge"."parent_id", "walk"."depth" + 1, "the_edge"."parent_id" || "walk"."path"
      from "walk" join "resource_edge" as "the_edge" on "the_edge"."child_id" = "walk"."node"
      where "the_edge"."parent_id" <> all ("walk"."path") and "walk"."depth" <= 16
    )
    select "walk"."path" from "walk" where "walk"."depth" > 16
  ) as "the_path" limit 1), 16, 'resource'
      using errcode = 'program_limit_exceeded';
  end if;
  delete from "resource_edge_cache";
  return query
  insert into "resource_edge_cache" ("parent_id", "child_id", "permission")
  select "parent_id", "child_id", "permission"
  from
    "resource_edge_cache_view"
    returning
      *;
end;
$$
language plpgsql
volatile
security definer set search_path = "public", pg_temp;


revoke execute on function "resource_edge_cache_backfill" () from public;

grant execute on function "resource_edge_cache_backfill" () to "app_backend";

-----------------------------------------------------------------------------------------------------------------------
-- 'resource' Update cache when edges change
-----------------------------------------------------------------------------------------------------------------------


create or replace function "resource_edge_insert_trigger_function"()
returns trigger as $$
begin

  if not exists (select from "p9s_new_rows") then
    return null;
  end if;
  
  
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'p9s: permission graph writes must run in READ COMMITTED isolation, not %', current_setting('transaction_isolation');
  end if;
  perform pg_advisory_xact_lock(hashtext('p9s:public:'));

  if exists (select from "p9s_new_rows" as "the_edge"
    left join "resource_edge_cache" as "the_parent_self" on "the_parent_self"."parent_id" = "the_edge"."parent_id" and "the_parent_self"."child_id" = "the_edge"."parent_id"
    left join "resource_edge_cache" as "the_child_self" on "the_child_self"."parent_id" = "the_edge"."child_id" and "the_child_self"."child_id" = "the_edge"."child_id"
    where "the_parent_self"."parent_id" is null or "the_child_self"."parent_id" is null) then
    raise exception 'p9s: the % edge % does not connect two rows of bound tables', 'resource',
      (select format('%s -> %s', "the_edge"."parent_id", "the_edge"."child_id") from "p9s_new_rows" as "the_edge"
    left join "resource_edge_cache" as "the_parent_self" on "the_parent_self"."parent_id" = "the_edge"."parent_id" and "the_parent_self"."child_id" = "the_edge"."parent_id"
    left join "resource_edge_cache" as "the_child_self" on "the_child_self"."parent_id" = "the_edge"."child_id" and "the_child_self"."child_id" = "the_edge"."child_id"
    where "the_parent_self"."parent_id" is null or "the_child_self"."parent_id" is null limit 1)
      using errcode = 'foreign_key_violation';
  end if;
  if exists (
    with recursive "the_new" as (select distinct "parent_id", "child_id" from "p9s_new_rows"),
    "below" ("parent", "node", "depth", "path") as (
      select "the_new"."parent_id", "the_new"."child_id", 0, array["the_new"."child_id"] from "the_new"
      union all
      select "below"."parent", "the_edge"."child_id", "below"."depth" + 1, "below"."path" || "the_edge"."child_id"
      from "below" join "resource_edge" as "the_edge" on "the_edge"."parent_id" = "below"."node"
      where "the_edge"."child_id" <> all ("below"."path") and "below"."depth" < 16
    ),
    "above" ("node", "depth", "path", "budget") as (
      select "below"."parent", 0, array["below"."parent"], 15 - max("below"."depth") from "below" group by "below"."parent"
      union all
      select "the_edge"."parent_id", "above"."depth" + 1, "above"."path" || "the_edge"."parent_id", "above"."budget"
      from "above" join "resource_edge" as "the_edge" on "the_edge"."child_id" = "above"."node"
      where "the_edge"."parent_id" <> all ("above"."path") and "above"."depth" <= "above"."budget"
    )
    select from "above" where "above"."depth" > "above"."budget") and exists (select from (
    with recursive "the_new" as (select distinct "parent_id", "child_id" from "p9s_new_rows"),
    "above" ("start", "node", "depth", "path") as (
      select "the_start"."id", "the_start"."id", 0, array["the_start"."id"] from (select distinct "parent_id" as "id" from "the_new") as "the_start"
      union all
      select "above"."start", "the_edge"."parent_id", "above"."depth" + 1, "above"."path" || "the_edge"."parent_id"
      from "above" join "resource_edge" as "the_edge" on "the_edge"."child_id" = "above"."node"
      where "the_edge"."parent_id" <> all ("above"."path") and "above"."depth" < 16
    ),
    "below" ("start", "node", "depth", "path") as (
      select "the_start"."id", "the_start"."id", 0, array["the_start"."id"] from (select distinct "child_id" as "id" from "the_new") as "the_start"
      union all
      select "below"."start", "the_edge"."child_id", "below"."depth" + 1, "below"."path" || "the_edge"."child_id"
      from "below" join "resource_edge" as "the_edge" on "the_edge"."parent_id" = "below"."node"
      where "the_edge"."child_id" <> all ("below"."path") and "below"."depth" < 16
    )
    select "the_new"."parent_id", "the_new"."child_id"
    from "the_new"
    join "above" on "above"."start" = "the_new"."parent_id"
    join "below" on "below"."start" = "the_new"."child_id"
    where "above"."depth" + 1 + "below"."depth" > 16
    and not ("above"."path" && "below"."path")
  ) as "the_edge") then
    raise exception 'p9s: the % edge % makes a path of more than % edges, the maxDepth of the % tree', 'resource',
      (select format('%s -> %s', "the_edge"."parent_id", "the_edge"."child_id") from (
    with recursive "the_new" as (select distinct "parent_id", "child_id" from "p9s_new_rows"),
    "above" ("start", "node", "depth", "path") as (
      select "the_start"."id", "the_start"."id", 0, array["the_start"."id"] from (select distinct "parent_id" as "id" from "the_new") as "the_start"
      union all
      select "above"."start", "the_edge"."parent_id", "above"."depth" + 1, "above"."path" || "the_edge"."parent_id"
      from "above" join "resource_edge" as "the_edge" on "the_edge"."child_id" = "above"."node"
      where "the_edge"."parent_id" <> all ("above"."path") and "above"."depth" < 16
    ),
    "below" ("start", "node", "depth", "path") as (
      select "the_start"."id", "the_start"."id", 0, array["the_start"."id"] from (select distinct "child_id" as "id" from "the_new") as "the_start"
      union all
      select "below"."start", "the_edge"."child_id", "below"."depth" + 1, "below"."path" || "the_edge"."child_id"
      from "below" join "resource_edge" as "the_edge" on "the_edge"."parent_id" = "below"."node"
      where "the_edge"."child_id" <> all ("below"."path") and "below"."depth" < 16
    )
    select "the_new"."parent_id", "the_new"."child_id"
    from "the_new"
    join "above" on "above"."start" = "the_new"."parent_id"
    join "below" on "below"."start" = "the_new"."child_id"
    where "above"."depth" + 1 + "below"."depth" > 16
    and not ("above"."path" && "below"."path")
  ) as "the_edge" limit 1), 16, 'resource'
      using errcode = 'program_limit_exceeded';
  end if;

  with recursive "affected" ("parent_id") as (
    (select "child_id" from "p9s_new_rows")
    union
    select "the_edge"."child_id"
    from "resource_edge" as "the_edge"
    join "affected" on "the_edge"."parent_id" = "affected"."parent_id"
  ),
  "upstream" ("parent_id") as (
    (select "parent_id" from "p9s_new_rows")
    union
    select "the_edge"."parent_id"
    from "resource_edge" as "the_edge"
    join "upstream" on "the_edge"."child_id" = "upstream"."parent_id"
  ),
  "walk" ("parent_id", "child_id", "permission", "inside", "depth", "path") as (
    select "affected"."parent_id", "affected"."parent_id", ~ b'0'::bit(8), true, 0, array["affected"."parent_id"]
    from "affected"
    union all
    select
      "the_edge"."parent_id",
      "walk"."child_id",
      ("walk"."permission" & "the_edge"."permission")::bit(8), -- bitwise "and" on permission along a path
      "the_edge"."parent_id" in (select "parent_id" from "affected"),
      "walk"."depth" + 1,
      "walk"."path" || "the_edge"."parent_id"
    from "walk"
    join "resource_edge" as "the_edge" on "the_edge"."child_id" = "walk"."parent_id"
    where "walk"."inside"
    and "the_edge"."parent_id" <> all ("walk"."path") -- prevent from cycling
    and "walk"."depth" <= 16 -- max search depth
  ),
  "fresh" as (
    select "the_path"."parent_id", "the_path"."child_id", "or_bitmap_8" ("the_path"."permission") as "permission" -- bitwise "or" on permissions between various paths
    from (
      select "walk"."parent_id", "walk"."child_id", "walk"."permission"
      from "walk"
      where "walk"."inside"
      and ("walk"."parent_id" in (select "parent_id" from "upstream")) is true
      union all
      -- Filtered after the join: on the cache lookup, Postgres would count building the hash of "upstream" once per
      -- walked node, and prefer comparing every walked node with the whole cache.
      select "the_ancestor"."parent_id", "the_ancestor"."child_id", "the_ancestor"."permission"
      from (
        select "the_edge_cache"."parent_id", "walk"."child_id", ("the_edge_cache"."permission" & "walk"."permission")::bit(8) as "permission"
        from "walk"
        join "resource_edge_cache" as "the_edge_cache" on "the_edge_cache"."child_id" = "walk"."parent_id"
        where not "walk"."inside"
        offset 0
      ) as "the_ancestor"
      where ("the_ancestor"."parent_id" in (select "parent_id" from "upstream")) is true
    ) as "the_path"
    group by ("the_path"."parent_id", "the_path"."child_id")
  ),
  -- An array is computed once and drives a single index scan. As a join, the planner can prefer a whole table scan
  -- when it overestimates the rows of "fresh".
  "stale" as (
    delete from "resource_edge_cache"
    where "resource_edge_cache"."child_id" = any (array (select "parent_id" from "affected"))
    and ("resource_edge_cache"."parent_id" in (select "parent_id" from "upstream")) is true
    and ("resource_edge_cache"."parent_id", "resource_edge_cache"."child_id") not in (select "fresh"."parent_id", "fresh"."child_id" from "fresh")
  )
  insert into "resource_edge_cache" ("parent_id", "child_id", "permission")
  select "fresh"."parent_id", "fresh"."child_id", "fresh"."permission"
  from "fresh"
  where not exists (
    select 1 from "resource_edge_cache" as "the_edge_cache"
    where "the_edge_cache"."parent_id" = "fresh"."parent_id"
    and "the_edge_cache"."child_id" = "fresh"."child_id"
    and "the_edge_cache"."permission" = "fresh"."permission"
  )
  on conflict on constraint "resource_edge_cache_pkey"
  do update set "permission" = excluded."permission";
  return null;
end;
$$ language plpgsql security definer set search_path = "public", pg_temp
set enable_hashjoin = off
set enable_mergejoin = off;


revoke execute on function "resource_edge_insert_trigger_function" () from public;




drop trigger if exists "10_resource_edge_insert_trigger" on "resource_edge";
create trigger "10_resource_edge_insert_trigger"
after insert on "resource_edge"
referencing new table as "p9s_new_rows"
for each statement execute function "resource_edge_insert_trigger_function"();



create or replace function "resource_edge_update_trigger_function"()
returns trigger as $$
begin

  if not exists (select from "p9s_new_rows") then
    return null;
  end if;
  
  
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'p9s: permission graph writes must run in READ COMMITTED isolation, not %', current_setting('transaction_isolation');
  end if;
  perform pg_advisory_xact_lock(hashtext('p9s:public:'));

  if exists (select from "p9s_new_rows" as "the_edge"
    left join "resource_edge_cache" as "the_parent_self" on "the_parent_self"."parent_id" = "the_edge"."parent_id" and "the_parent_self"."child_id" = "the_edge"."parent_id"
    left join "resource_edge_cache" as "the_child_self" on "the_child_self"."parent_id" = "the_edge"."child_id" and "the_child_self"."child_id" = "the_edge"."child_id"
    where "the_parent_self"."parent_id" is null or "the_child_self"."parent_id" is null) then
    raise exception 'p9s: the % edge % does not connect two rows of bound tables', 'resource',
      (select format('%s -> %s', "the_edge"."parent_id", "the_edge"."child_id") from "p9s_new_rows" as "the_edge"
    left join "resource_edge_cache" as "the_parent_self" on "the_parent_self"."parent_id" = "the_edge"."parent_id" and "the_parent_self"."child_id" = "the_edge"."parent_id"
    left join "resource_edge_cache" as "the_child_self" on "the_child_self"."parent_id" = "the_edge"."child_id" and "the_child_self"."child_id" = "the_edge"."child_id"
    where "the_parent_self"."parent_id" is null or "the_child_self"."parent_id" is null limit 1)
      using errcode = 'foreign_key_violation';
  end if;
  if exists (
    with recursive "the_new" as (select distinct "parent_id", "child_id" from "p9s_new_rows"),
    "below" ("parent", "node", "depth", "path") as (
      select "the_new"."parent_id", "the_new"."child_id", 0, array["the_new"."child_id"] from "the_new"
      union all
      select "below"."parent", "the_edge"."child_id", "below"."depth" + 1, "below"."path" || "the_edge"."child_id"
      from "below" join "resource_edge" as "the_edge" on "the_edge"."parent_id" = "below"."node"
      where "the_edge"."child_id" <> all ("below"."path") and "below"."depth" < 16
    ),
    "above" ("node", "depth", "path", "budget") as (
      select "below"."parent", 0, array["below"."parent"], 15 - max("below"."depth") from "below" group by "below"."parent"
      union all
      select "the_edge"."parent_id", "above"."depth" + 1, "above"."path" || "the_edge"."parent_id", "above"."budget"
      from "above" join "resource_edge" as "the_edge" on "the_edge"."child_id" = "above"."node"
      where "the_edge"."parent_id" <> all ("above"."path") and "above"."depth" <= "above"."budget"
    )
    select from "above" where "above"."depth" > "above"."budget") and exists (select from (
    with recursive "the_new" as (select distinct "parent_id", "child_id" from "p9s_new_rows"),
    "above" ("start", "node", "depth", "path") as (
      select "the_start"."id", "the_start"."id", 0, array["the_start"."id"] from (select distinct "parent_id" as "id" from "the_new") as "the_start"
      union all
      select "above"."start", "the_edge"."parent_id", "above"."depth" + 1, "above"."path" || "the_edge"."parent_id"
      from "above" join "resource_edge" as "the_edge" on "the_edge"."child_id" = "above"."node"
      where "the_edge"."parent_id" <> all ("above"."path") and "above"."depth" < 16
    ),
    "below" ("start", "node", "depth", "path") as (
      select "the_start"."id", "the_start"."id", 0, array["the_start"."id"] from (select distinct "child_id" as "id" from "the_new") as "the_start"
      union all
      select "below"."start", "the_edge"."child_id", "below"."depth" + 1, "below"."path" || "the_edge"."child_id"
      from "below" join "resource_edge" as "the_edge" on "the_edge"."parent_id" = "below"."node"
      where "the_edge"."child_id" <> all ("below"."path") and "below"."depth" < 16
    )
    select "the_new"."parent_id", "the_new"."child_id"
    from "the_new"
    join "above" on "above"."start" = "the_new"."parent_id"
    join "below" on "below"."start" = "the_new"."child_id"
    where "above"."depth" + 1 + "below"."depth" > 16
    and not ("above"."path" && "below"."path")
  ) as "the_edge") then
    raise exception 'p9s: the % edge % makes a path of more than % edges, the maxDepth of the % tree', 'resource',
      (select format('%s -> %s', "the_edge"."parent_id", "the_edge"."child_id") from (
    with recursive "the_new" as (select distinct "parent_id", "child_id" from "p9s_new_rows"),
    "above" ("start", "node", "depth", "path") as (
      select "the_start"."id", "the_start"."id", 0, array["the_start"."id"] from (select distinct "parent_id" as "id" from "the_new") as "the_start"
      union all
      select "above"."start", "the_edge"."parent_id", "above"."depth" + 1, "above"."path" || "the_edge"."parent_id"
      from "above" join "resource_edge" as "the_edge" on "the_edge"."child_id" = "above"."node"
      where "the_edge"."parent_id" <> all ("above"."path") and "above"."depth" < 16
    ),
    "below" ("start", "node", "depth", "path") as (
      select "the_start"."id", "the_start"."id", 0, array["the_start"."id"] from (select distinct "child_id" as "id" from "the_new") as "the_start"
      union all
      select "below"."start", "the_edge"."child_id", "below"."depth" + 1, "below"."path" || "the_edge"."child_id"
      from "below" join "resource_edge" as "the_edge" on "the_edge"."parent_id" = "below"."node"
      where "the_edge"."child_id" <> all ("below"."path") and "below"."depth" < 16
    )
    select "the_new"."parent_id", "the_new"."child_id"
    from "the_new"
    join "above" on "above"."start" = "the_new"."parent_id"
    join "below" on "below"."start" = "the_new"."child_id"
    where "above"."depth" + 1 + "below"."depth" > 16
    and not ("above"."path" && "below"."path")
  ) as "the_edge" limit 1), 16, 'resource'
      using errcode = 'program_limit_exceeded';
  end if;

  with recursive "affected" ("parent_id") as (
    (select "child_id" from "p9s_old_rows" union select "child_id" from "p9s_new_rows")
    union
    select "the_edge"."child_id"
    from "resource_edge" as "the_edge"
    join "affected" on "the_edge"."parent_id" = "affected"."parent_id"
  ),
  "upstream" ("parent_id") as (
    (select "parent_id" from "p9s_old_rows" union select "parent_id" from "p9s_new_rows")
    union
    select "the_edge"."parent_id"
    from "resource_edge" as "the_edge"
    join "upstream" on "the_edge"."child_id" = "upstream"."parent_id"
  ),
  "walk" ("parent_id", "child_id", "permission", "inside", "depth", "path") as (
    select "affected"."parent_id", "affected"."parent_id", ~ b'0'::bit(8), true, 0, array["affected"."parent_id"]
    from "affected"
    union all
    select
      "the_edge"."parent_id",
      "walk"."child_id",
      ("walk"."permission" & "the_edge"."permission")::bit(8), -- bitwise "and" on permission along a path
      "the_edge"."parent_id" in (select "parent_id" from "affected"),
      "walk"."depth" + 1,
      "walk"."path" || "the_edge"."parent_id"
    from "walk"
    join "resource_edge" as "the_edge" on "the_edge"."child_id" = "walk"."parent_id"
    where "walk"."inside"
    and "the_edge"."parent_id" <> all ("walk"."path") -- prevent from cycling
    and "walk"."depth" <= 16 -- max search depth
  ),
  "fresh" as (
    select "the_path"."parent_id", "the_path"."child_id", "or_bitmap_8" ("the_path"."permission") as "permission" -- bitwise "or" on permissions between various paths
    from (
      select "walk"."parent_id", "walk"."child_id", "walk"."permission"
      from "walk"
      where "walk"."inside"
      and ("walk"."parent_id" in (select "parent_id" from "upstream")) is true
      union all
      -- Filtered after the join: on the cache lookup, Postgres would count building the hash of "upstream" once per
      -- walked node, and prefer comparing every walked node with the whole cache.
      select "the_ancestor"."parent_id", "the_ancestor"."child_id", "the_ancestor"."permission"
      from (
        select "the_edge_cache"."parent_id", "walk"."child_id", ("the_edge_cache"."permission" & "walk"."permission")::bit(8) as "permission"
        from "walk"
        join "resource_edge_cache" as "the_edge_cache" on "the_edge_cache"."child_id" = "walk"."parent_id"
        where not "walk"."inside"
        offset 0
      ) as "the_ancestor"
      where ("the_ancestor"."parent_id" in (select "parent_id" from "upstream")) is true
    ) as "the_path"
    group by ("the_path"."parent_id", "the_path"."child_id")
  ),
  -- An array is computed once and drives a single index scan. As a join, the planner can prefer a whole table scan
  -- when it overestimates the rows of "fresh".
  "stale" as (
    delete from "resource_edge_cache"
    where "resource_edge_cache"."child_id" = any (array (select "parent_id" from "affected"))
    and ("resource_edge_cache"."parent_id" in (select "parent_id" from "upstream")) is true
    and ("resource_edge_cache"."parent_id", "resource_edge_cache"."child_id") not in (select "fresh"."parent_id", "fresh"."child_id" from "fresh")
  )
  insert into "resource_edge_cache" ("parent_id", "child_id", "permission")
  select "fresh"."parent_id", "fresh"."child_id", "fresh"."permission"
  from "fresh"
  where not exists (
    select 1 from "resource_edge_cache" as "the_edge_cache"
    where "the_edge_cache"."parent_id" = "fresh"."parent_id"
    and "the_edge_cache"."child_id" = "fresh"."child_id"
    and "the_edge_cache"."permission" = "fresh"."permission"
  )
  on conflict on constraint "resource_edge_cache_pkey"
  do update set "permission" = excluded."permission";
  return null;
end;
$$ language plpgsql security definer set search_path = "public", pg_temp
set enable_hashjoin = off
set enable_mergejoin = off;


revoke execute on function "resource_edge_update_trigger_function" () from public;




drop trigger if exists "10_resource_edge_update_trigger" on "resource_edge";
create trigger "10_resource_edge_update_trigger"
after update on "resource_edge"
referencing old table as "p9s_old_rows" new table as "p9s_new_rows"
for each statement execute function "resource_edge_update_trigger_function"();



create or replace function "resource_edge_delete_trigger_function"()
returns trigger as $$
begin

  if not exists (select from "p9s_old_rows") then
    return null;
  end if;
  
  
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'p9s: permission graph writes must run in READ COMMITTED isolation, not %', current_setting('transaction_isolation');
  end if;
  perform pg_advisory_xact_lock(hashtext('p9s:public:'));


  with recursive "affected" ("parent_id") as (
    (select "child_id" from "p9s_old_rows")
    union
    select "the_edge"."child_id"
    from "resource_edge" as "the_edge"
    join "affected" on "the_edge"."parent_id" = "affected"."parent_id"
  ),
  "upstream" ("parent_id") as (
    (select "parent_id" from "p9s_old_rows")
    union
    select "the_edge"."parent_id"
    from "resource_edge" as "the_edge"
    join "upstream" on "the_edge"."child_id" = "upstream"."parent_id"
  ),
  "walk" ("parent_id", "child_id", "permission", "inside", "depth", "path") as (
    select "affected"."parent_id", "affected"."parent_id", ~ b'0'::bit(8), true, 0, array["affected"."parent_id"]
    from "affected"
    union all
    select
      "the_edge"."parent_id",
      "walk"."child_id",
      ("walk"."permission" & "the_edge"."permission")::bit(8), -- bitwise "and" on permission along a path
      "the_edge"."parent_id" in (select "parent_id" from "affected"),
      "walk"."depth" + 1,
      "walk"."path" || "the_edge"."parent_id"
    from "walk"
    join "resource_edge" as "the_edge" on "the_edge"."child_id" = "walk"."parent_id"
    where "walk"."inside"
    and "the_edge"."parent_id" <> all ("walk"."path") -- prevent from cycling
    and "walk"."depth" <= 16 -- max search depth
  ),
  "fresh" as (
    select "the_path"."parent_id", "the_path"."child_id", "or_bitmap_8" ("the_path"."permission") as "permission" -- bitwise "or" on permissions between various paths
    from (
      select "walk"."parent_id", "walk"."child_id", "walk"."permission"
      from "walk"
      where "walk"."inside"
      and ("walk"."parent_id" in (select "parent_id" from "upstream")) is true
      union all
      -- Filtered after the join: on the cache lookup, Postgres would count building the hash of "upstream" once per
      -- walked node, and prefer comparing every walked node with the whole cache.
      select "the_ancestor"."parent_id", "the_ancestor"."child_id", "the_ancestor"."permission"
      from (
        select "the_edge_cache"."parent_id", "walk"."child_id", ("the_edge_cache"."permission" & "walk"."permission")::bit(8) as "permission"
        from "walk"
        join "resource_edge_cache" as "the_edge_cache" on "the_edge_cache"."child_id" = "walk"."parent_id"
        where not "walk"."inside"
        offset 0
      ) as "the_ancestor"
      where ("the_ancestor"."parent_id" in (select "parent_id" from "upstream")) is true
    ) as "the_path"
    group by ("the_path"."parent_id", "the_path"."child_id")
  ),
  -- An array is computed once and drives a single index scan. As a join, the planner can prefer a whole table scan
  -- when it overestimates the rows of "fresh".
  "stale" as (
    delete from "resource_edge_cache"
    where "resource_edge_cache"."child_id" = any (array (select "parent_id" from "affected"))
    and ("resource_edge_cache"."parent_id" in (select "parent_id" from "upstream")) is true
    and ("resource_edge_cache"."parent_id", "resource_edge_cache"."child_id") not in (select "fresh"."parent_id", "fresh"."child_id" from "fresh")
  )
  insert into "resource_edge_cache" ("parent_id", "child_id", "permission")
  select "fresh"."parent_id", "fresh"."child_id", "fresh"."permission"
  from "fresh"
  where not exists (
    select 1 from "resource_edge_cache" as "the_edge_cache"
    where "the_edge_cache"."parent_id" = "fresh"."parent_id"
    and "the_edge_cache"."child_id" = "fresh"."child_id"
    and "the_edge_cache"."permission" = "fresh"."permission"
  )
  on conflict on constraint "resource_edge_cache_pkey"
  do update set "permission" = excluded."permission";
  return null;
end;
$$ language plpgsql security definer set search_path = "public", pg_temp
set enable_hashjoin = off
set enable_mergejoin = off;


revoke execute on function "resource_edge_delete_trigger_function" () from public;




drop trigger if exists "10_resource_edge_delete_trigger" on "resource_edge";
create trigger "10_resource_edge_delete_trigger"
after delete on "resource_edge"
referencing old table as "p9s_old_rows"
for each statement execute function "resource_edge_delete_trigger_function"();


drop trigger if exists "05_truncate_guard_trigger" on "resource_edge";
create trigger "05_truncate_guard_trigger" before truncate on "resource_edge" for each statement execute function "truncate_guard_trigger_function"();

-----------------------------------------------------------------------------------------------------------------------
-- 'resource' home edges are written by p9s only
-----------------------------------------------------------------------------------------------------------------------
-- p9s writes them from the triggers of bound tables, one level deeper than a statement sent by a client
create or replace function "resource_edge_guard_trigger_function"()
returns trigger as $$
begin
  if pg_trigger_depth() > 1 then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'INSERT' then
    raise exception 'p9s: home edges are created by p9s from the parent column of their row'
      using errcode = 'insufficient_privilege';
  elsif tg_op = 'UPDATE' then
    if new."home" and not old."home" then
      raise exception 'p9s: an edge cannot be made a home edge, home edges follow the parent column of their row'
        using errcode = 'insufficient_privilege';
    end if;
    -- Changing a home edge makes it a regular edge, which moving or deleting its row leaves alone
    new."home" := false;
    return new;
  end if;
  raise exception 'p9s: home edges are removed by moving or deleting their row. To delete one apart from its row, first make it a regular edge with update ... set home = false'
    using errcode = 'insufficient_privilege';
end;
$$ language plpgsql;


revoke execute on function "resource_edge_guard_trigger_function" () from public;



drop trigger if exists "05_resource_edge_guard_insert_trigger" on "resource_edge";
create trigger "05_resource_edge_guard_insert_trigger" before insert on "resource_edge" for each row when (new."home") execute function "resource_edge_guard_trigger_function"();
drop trigger if exists "05_resource_edge_guard_update_trigger" on "resource_edge";
create trigger "05_resource_edge_guard_update_trigger" before update on "resource_edge" for each row when (old."home" or new."home") execute function "resource_edge_guard_trigger_function"();
drop trigger if exists "05_resource_edge_guard_delete_trigger" on "resource_edge";
create trigger "05_resource_edge_guard_delete_trigger" before delete on "resource_edge" for each row when (old."home") execute function "resource_edge_guard_trigger_function"();

-----------------------------------------------------------------------------------------------------------------------
-- 'resource' rows of bound tables
-----------------------------------------------------------------------------------------------------------------------


create or replace function "resource_node_insert" ("the_ids" uuid[], "the_parents" uuid[])
returns void as $$
begin

  if exists (select "the_row"."id" from unnest("the_ids") as "the_row" ("id")
    join "resource_edge_cache" as "the_self" on "the_self"."parent_id" = "the_row"."id" and "the_self"."child_id" = "the_row"."id") then
    raise exception 'p9s: the % id % is already used by another row', 'resource',
      (select "the_used"."id" from (select "the_row"."id" from unnest("the_ids") as "the_row" ("id")
    join "resource_edge_cache" as "the_self" on "the_self"."parent_id" = "the_row"."id" and "the_self"."child_id" = "the_row"."id") as "the_used" limit 1)
      using errcode = 'unique_violation';
  end if;
  -- A new row cannot be referenced by others yet, so its self row needs no lock
  insert into "resource_edge_cache" ("parent_id", "child_id", "permission")
  select "the_row"."id", "the_row"."id", ~ b'0'::bit(8) from unnest("the_ids") as "the_row" ("id");
  if exists (select from unnest("the_parents") as "the_parent" ("id") where "the_parent"."id" is not null) then
    
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'p9s: permission graph writes must run in READ COMMITTED isolation, not %', current_setting('transaction_isolation');
  end if;
  perform pg_advisory_xact_lock(hashtext('p9s:public:'));
    insert into "resource_edge" ("parent_id", "child_id", "permission", "home")
    select "the_row"."parent", "the_row"."id", ~ b'0'::bit(8), true
    from unnest("the_ids", coalesce("the_parents", '{}')) as "the_row" ("id", "parent")
    where "the_row"."parent" is not null
    on conflict on constraint "resource_edge_pkey" do nothing;
  end if;
end;
$$ language plpgsql set plan_cache_mode = force_generic_plan;


revoke execute on function "resource_node_insert" ("the_ids" uuid[], "the_parents" uuid[]) from public;



-- The home edge follows the parent column. It moves when nothing else links the new parent to the row, otherwise it
-- gives way to that edge and the edge keeps its bits.

create or replace function "resource_node_update" ("the_ids" uuid[], "the_parents" uuid[])
returns void as $$
begin

  
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'p9s: permission graph writes must run in READ COMMITTED isolation, not %', current_setting('transaction_isolation');
  end if;
  perform pg_advisory_xact_lock(hashtext('p9s:public:'));
  update "resource_edge" as "the_edge" set "parent_id" = "the_row"."parent"
  from unnest("the_ids", coalesce("the_parents", '{}')) as "the_row" ("id", "parent")
  where "the_edge"."child_id" = "the_row"."id" and "the_edge"."home"
  and "the_row"."parent" is not null and "the_edge"."parent_id" <> "the_row"."parent"
  and not exists (select from "resource_edge" as "the_other" where "the_other"."parent_id" = "the_row"."parent" and "the_other"."child_id" = "the_row"."id");

  delete from "resource_edge" as "the_edge"
  using unnest("the_ids", coalesce("the_parents", '{}')) as "the_row" ("id", "parent")
  where "the_edge"."child_id" = "the_row"."id" and "the_edge"."home"
  and "the_edge"."parent_id" is distinct from "the_row"."parent";

  insert into "resource_edge" ("parent_id", "child_id", "permission", "home")
  select "the_row"."parent", "the_row"."id", ~ b'0'::bit(8), true
  from unnest("the_ids", coalesce("the_parents", '{}')) as "the_row" ("id", "parent")
  where "the_row"."parent" is not null
  on conflict on constraint "resource_edge_pkey" do nothing;
end;
$$ language plpgsql set plan_cache_mode = force_generic_plan;


revoke execute on function "resource_node_update" ("the_ids" uuid[], "the_parents" uuid[]) from public;



-- The lock comes first: an edge to these rows committed while they are deleted must be seen by the deletes below

create or replace function "resource_node_delete" ("the_ids" uuid[])
returns void as $$
begin

  
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'p9s: permission graph writes must run in READ COMMITTED isolation, not %', current_setting('transaction_isolation');
  end if;
  perform pg_advisory_xact_lock(hashtext('p9s:public:'));
  delete from "assignment_edge" as "the_assignment"
  where "the_assignment"."resource_id" = any ("the_ids");
  delete from "resource_edge" as "the_edge"
  where "the_edge"."parent_id" = any ("the_ids") or "the_edge"."child_id" = any ("the_ids");
  delete from "resource_edge_cache" as "the_self"
  using unnest("the_ids") as "the_row" ("id")
  where "the_self"."parent_id" = "the_row"."id" and "the_self"."child_id" = "the_row"."id";
end;
$$ language plpgsql set plan_cache_mode = force_generic_plan;


revoke execute on function "resource_node_delete" ("the_ids" uuid[]) from public;




-- 'document' rows are 'resource' nodes
create or replace function "document_resource_trigger_function"()
returns trigger as $$
begin
  if tg_op = 'INSERT' then
  if exists (select from "p9s_new_rows" as "the_row" where "the_row"."folder_id" is not null and (select "the_parent"."resource_id" from "public"."folder" as "the_parent" where "the_parent"."id" = "the_row"."folder_id") is null) then
    raise exception 'p9s: % rows have a % that matches no row of %', 'document', 'folder_id', 'folder'
      using errcode = 'foreign_key_violation';
  end if;
    perform "resource_node_insert"(array_agg("the_row"."resource_id"), array_agg((select "the_parent"."resource_id" from "public"."folder" as "the_parent" where "the_parent"."id" = "the_row"."folder_id"))) from "p9s_new_rows" as "the_row" having count(*) > 0;
  elsif tg_op = 'UPDATE' then
    if exists (select "resource_id" from "p9s_old_rows" except select "resource_id" from "p9s_new_rows") then
      raise exception 'p9s: the % id of a % row cannot change', 'resource', 'document' using errcode = 'integrity_constraint_violation';
    end if;
    -- Transition tables have no index: an exists would be planned to stop early, comparing every new row with every
    -- old row when no parent changed. Counting them is planned as a join of both
    if (select count(*) from "p9s_new_rows" as "the_row" join "p9s_old_rows" as "the_old_row" using ("resource_id")
      where "the_row"."folder_id" is distinct from "the_old_row"."folder_id") > 0 then
  if exists (select from "p9s_new_rows" as "the_row" where "the_row"."folder_id" is not null and (select "the_parent"."resource_id" from "public"."folder" as "the_parent" where "the_parent"."id" = "the_row"."folder_id") is null) then
    raise exception 'p9s: % rows have a % that matches no row of %', 'document', 'folder_id', 'folder'
      using errcode = 'foreign_key_violation';
  end if;
      perform "resource_node_update"(array_agg("the_row"."resource_id"), array_agg((select "the_parent"."resource_id" from "public"."folder" as "the_parent" where "the_parent"."id" = "the_row"."folder_id")))
      from "p9s_new_rows" as "the_row" join "p9s_old_rows" as "the_old_row" using ("resource_id")
      where "the_row"."folder_id" is distinct from "the_old_row"."folder_id";
    end if;
  else
    perform "resource_node_delete"(array_agg("the_row"."resource_id")) from "p9s_old_rows" as "the_row" having count(*) > 0;
  end if;
  return null;
end;
$$ language plpgsql security definer set search_path = "public", pg_temp;

revoke execute on function "document_resource_trigger_function" () from public;



drop trigger if exists "10_document_resource_insert_trigger" on "public"."document";
create trigger "10_document_resource_insert_trigger"
after insert on "public"."document"
referencing new table as "p9s_new_rows"
for each statement execute function "document_resource_trigger_function"();

drop trigger if exists "10_document_resource_update_trigger" on "public"."document";
create trigger "10_document_resource_update_trigger"
after update on "public"."document"
referencing old table as "p9s_old_rows" new table as "p9s_new_rows"
for each statement execute function "document_resource_trigger_function"();

drop trigger if exists "10_document_resource_delete_trigger" on "public"."document";
create trigger "10_document_resource_delete_trigger"
after delete on "public"."document"
referencing old table as "p9s_old_rows"
for each statement execute function "document_resource_trigger_function"();

drop trigger if exists "05_truncate_guard_trigger" on "public"."document";
create trigger "05_truncate_guard_trigger" before truncate on "public"."document" for each statement execute function "truncate_guard_trigger_function"();


-- 'folder' rows are 'resource' nodes
create or replace function "folder_resource_trigger_function"()
returns trigger as $$
begin
  if tg_op = 'INSERT' then
    perform "resource_node_insert"(array_agg("the_row"."resource_id"), array_agg("the_row"."parent_resource_id")) from "p9s_new_rows" as "the_row" having count(*) > 0;
  elsif tg_op = 'UPDATE' then
    if exists (select "resource_id" from "p9s_old_rows" except select "resource_id" from "p9s_new_rows") then
      raise exception 'p9s: the % id of a % row cannot change', 'resource', 'folder' using errcode = 'integrity_constraint_violation';
    end if;
    -- Transition tables have no index: an exists would be planned to stop early, comparing every new row with every
    -- old row when no parent changed. Counting them is planned as a join of both
    if (select count(*) from "p9s_new_rows" as "the_row" join "p9s_old_rows" as "the_old_row" using ("resource_id")
      where "the_row"."parent_resource_id" is distinct from "the_old_row"."parent_resource_id") > 0 then
      perform "resource_node_update"(array_agg("the_row"."resource_id"), array_agg("the_row"."parent_resource_id"))
      from "p9s_new_rows" as "the_row" join "p9s_old_rows" as "the_old_row" using ("resource_id")
      where "the_row"."parent_resource_id" is distinct from "the_old_row"."parent_resource_id";
    end if;
  else
    perform "resource_node_delete"(array_agg("the_row"."resource_id")) from "p9s_old_rows" as "the_row" having count(*) > 0;
  end if;
  return null;
end;
$$ language plpgsql security definer set search_path = "public", pg_temp;

revoke execute on function "folder_resource_trigger_function" () from public;



drop trigger if exists "10_folder_resource_insert_trigger" on "public"."folder";
create trigger "10_folder_resource_insert_trigger"
after insert on "public"."folder"
referencing new table as "p9s_new_rows"
for each statement execute function "folder_resource_trigger_function"();

drop trigger if exists "10_folder_resource_update_trigger" on "public"."folder";
create trigger "10_folder_resource_update_trigger"
after update on "public"."folder"
referencing old table as "p9s_old_rows" new table as "p9s_new_rows"
for each statement execute function "folder_resource_trigger_function"();

drop trigger if exists "10_folder_resource_delete_trigger" on "public"."folder";
create trigger "10_folder_resource_delete_trigger"
after delete on "public"."folder"
referencing old table as "p9s_old_rows"
for each statement execute function "folder_resource_trigger_function"();

drop trigger if exists "05_truncate_guard_trigger" on "public"."folder";
create trigger "05_truncate_guard_trigger" before truncate on "public"."folder" for each statement execute function "truncate_guard_trigger_function"();


-- 'member' rows are 'resource' nodes
create or replace function "member_resource_trigger_function"()
returns trigger as $$
begin
  if tg_op = 'INSERT' then
  if exists (select from "p9s_new_rows" as "the_row" where "the_row"."org_id" is not null and (select "the_parent"."resource_id" from "public"."organization" as "the_parent" where "the_parent"."id" = "the_row"."org_id") is null) then
    raise exception 'p9s: % rows have a % that matches no row of %', 'member', 'org_id', 'organization'
      using errcode = 'foreign_key_violation';
  end if;
    perform "resource_node_insert"(array_agg("the_row"."resource_id"), array_agg((select "the_parent"."resource_id" from "public"."organization" as "the_parent" where "the_parent"."id" = "the_row"."org_id"))) from "p9s_new_rows" as "the_row" having count(*) > 0;
  elsif tg_op = 'UPDATE' then
    if exists (select "resource_id" from "p9s_old_rows" except select "resource_id" from "p9s_new_rows") then
      raise exception 'p9s: the % id of a % row cannot change', 'resource', 'member' using errcode = 'integrity_constraint_violation';
    end if;
    -- Transition tables have no index: an exists would be planned to stop early, comparing every new row with every
    -- old row when no parent changed. Counting them is planned as a join of both
    if (select count(*) from "p9s_new_rows" as "the_row" join "p9s_old_rows" as "the_old_row" using ("resource_id")
      where "the_row"."org_id" is distinct from "the_old_row"."org_id") > 0 then
  if exists (select from "p9s_new_rows" as "the_row" where "the_row"."org_id" is not null and (select "the_parent"."resource_id" from "public"."organization" as "the_parent" where "the_parent"."id" = "the_row"."org_id") is null) then
    raise exception 'p9s: % rows have a % that matches no row of %', 'member', 'org_id', 'organization'
      using errcode = 'foreign_key_violation';
  end if;
      perform "resource_node_update"(array_agg("the_row"."resource_id"), array_agg((select "the_parent"."resource_id" from "public"."organization" as "the_parent" where "the_parent"."id" = "the_row"."org_id")))
      from "p9s_new_rows" as "the_row" join "p9s_old_rows" as "the_old_row" using ("resource_id")
      where "the_row"."org_id" is distinct from "the_old_row"."org_id";
    end if;
  else
    perform "resource_node_delete"(array_agg("the_row"."resource_id")) from "p9s_old_rows" as "the_row" having count(*) > 0;
  end if;
  return null;
end;
$$ language plpgsql security definer set search_path = "public", pg_temp;

revoke execute on function "member_resource_trigger_function" () from public;



drop trigger if exists "10_member_resource_insert_trigger" on "public"."member";
create trigger "10_member_resource_insert_trigger"
after insert on "public"."member"
referencing new table as "p9s_new_rows"
for each statement execute function "member_resource_trigger_function"();

drop trigger if exists "10_member_resource_update_trigger" on "public"."member";
create trigger "10_member_resource_update_trigger"
after update on "public"."member"
referencing old table as "p9s_old_rows" new table as "p9s_new_rows"
for each statement execute function "member_resource_trigger_function"();

drop trigger if exists "10_member_resource_delete_trigger" on "public"."member";
create trigger "10_member_resource_delete_trigger"
after delete on "public"."member"
referencing old table as "p9s_old_rows"
for each statement execute function "member_resource_trigger_function"();

drop trigger if exists "05_truncate_guard_trigger" on "public"."member";
create trigger "05_truncate_guard_trigger" before truncate on "public"."member" for each statement execute function "truncate_guard_trigger_function"();


-- 'organization' rows are 'resource' nodes
create or replace function "organization_resource_trigger_function"()
returns trigger as $$
begin
  if tg_op = 'INSERT' then
    perform "resource_node_insert"(array_agg("the_row"."resource_id"), null) from "p9s_new_rows" as "the_row" having count(*) > 0;
  elsif tg_op = 'UPDATE' then
    if exists (select "resource_id" from "p9s_old_rows" except select "resource_id" from "p9s_new_rows") then
      raise exception 'p9s: the % id of a % row cannot change', 'resource', 'organization' using errcode = 'integrity_constraint_violation';
    end if;
  else
    perform "resource_node_delete"(array_agg("the_row"."resource_id")) from "p9s_old_rows" as "the_row" having count(*) > 0;
  end if;
  return null;
end;
$$ language plpgsql security definer set search_path = "public", pg_temp;

revoke execute on function "organization_resource_trigger_function" () from public;



drop trigger if exists "10_organization_resource_insert_trigger" on "public"."organization";
create trigger "10_organization_resource_insert_trigger"
after insert on "public"."organization"
referencing new table as "p9s_new_rows"
for each statement execute function "organization_resource_trigger_function"();

drop trigger if exists "10_organization_resource_update_trigger" on "public"."organization";
create trigger "10_organization_resource_update_trigger"
after update on "public"."organization"
referencing old table as "p9s_old_rows" new table as "p9s_new_rows"
for each statement execute function "organization_resource_trigger_function"();

drop trigger if exists "10_organization_resource_delete_trigger" on "public"."organization";
create trigger "10_organization_resource_delete_trigger"
after delete on "public"."organization"
referencing old table as "p9s_old_rows"
for each statement execute function "organization_resource_trigger_function"();

drop trigger if exists "05_truncate_guard_trigger" on "public"."organization";
create trigger "05_truncate_guard_trigger" before truncate on "public"."organization" for each statement execute function "truncate_guard_trigger_function"();


-- 'team' rows are 'resource' nodes
create or replace function "team_resource_trigger_function"()
returns trigger as $$
begin
  if tg_op = 'INSERT' then
  if exists (select from "p9s_new_rows" as "the_row" where "the_row"."org_id" is not null and (select "the_parent"."resource_id" from "public"."organization" as "the_parent" where "the_parent"."id" = "the_row"."org_id") is null) then
    raise exception 'p9s: % rows have a % that matches no row of %', 'team', 'org_id', 'organization'
      using errcode = 'foreign_key_violation';
  end if;
    perform "resource_node_insert"(array_agg("the_row"."resource_id"), array_agg((select "the_parent"."resource_id" from "public"."organization" as "the_parent" where "the_parent"."id" = "the_row"."org_id"))) from "p9s_new_rows" as "the_row" having count(*) > 0;
  elsif tg_op = 'UPDATE' then
    if exists (select "resource_id" from "p9s_old_rows" except select "resource_id" from "p9s_new_rows") then
      raise exception 'p9s: the % id of a % row cannot change', 'resource', 'team' using errcode = 'integrity_constraint_violation';
    end if;
    -- Transition tables have no index: an exists would be planned to stop early, comparing every new row with every
    -- old row when no parent changed. Counting them is planned as a join of both
    if (select count(*) from "p9s_new_rows" as "the_row" join "p9s_old_rows" as "the_old_row" using ("resource_id")
      where "the_row"."org_id" is distinct from "the_old_row"."org_id") > 0 then
  if exists (select from "p9s_new_rows" as "the_row" where "the_row"."org_id" is not null and (select "the_parent"."resource_id" from "public"."organization" as "the_parent" where "the_parent"."id" = "the_row"."org_id") is null) then
    raise exception 'p9s: % rows have a % that matches no row of %', 'team', 'org_id', 'organization'
      using errcode = 'foreign_key_violation';
  end if;
      perform "resource_node_update"(array_agg("the_row"."resource_id"), array_agg((select "the_parent"."resource_id" from "public"."organization" as "the_parent" where "the_parent"."id" = "the_row"."org_id")))
      from "p9s_new_rows" as "the_row" join "p9s_old_rows" as "the_old_row" using ("resource_id")
      where "the_row"."org_id" is distinct from "the_old_row"."org_id";
    end if;
  else
    perform "resource_node_delete"(array_agg("the_row"."resource_id")) from "p9s_old_rows" as "the_row" having count(*) > 0;
  end if;
  return null;
end;
$$ language plpgsql security definer set search_path = "public", pg_temp;

revoke execute on function "team_resource_trigger_function" () from public;



drop trigger if exists "10_team_resource_insert_trigger" on "public"."team";
create trigger "10_team_resource_insert_trigger"
after insert on "public"."team"
referencing new table as "p9s_new_rows"
for each statement execute function "team_resource_trigger_function"();

drop trigger if exists "10_team_resource_update_trigger" on "public"."team";
create trigger "10_team_resource_update_trigger"
after update on "public"."team"
referencing old table as "p9s_old_rows" new table as "p9s_new_rows"
for each statement execute function "team_resource_trigger_function"();

drop trigger if exists "10_team_resource_delete_trigger" on "public"."team";
create trigger "10_team_resource_delete_trigger"
after delete on "public"."team"
referencing old table as "p9s_old_rows"
for each statement execute function "team_resource_trigger_function"();

drop trigger if exists "05_truncate_guard_trigger" on "public"."team";
create trigger "05_truncate_guard_trigger" before truncate on "public"."team" for each statement execute function "truncate_guard_trigger_function"();


-----------------------------------------------------------------------------------------------------------------------
-- 'resource' functions to enable / disable triggers
-----------------------------------------------------------------------------------------------------------------------
create or replace function "resource_trigger_disable"()
returns void as $$
begin
  alter table "resource_edge" disable trigger "10_resource_edge_insert_trigger";
  alter table "resource_edge" disable trigger "10_resource_edge_update_trigger";
  alter table "resource_edge" disable trigger "10_resource_edge_delete_trigger";
  alter table "resource_edge" disable trigger "05_resource_edge_guard_insert_trigger";
  alter table "resource_edge" disable trigger "05_resource_edge_guard_update_trigger";
  alter table "resource_edge" disable trigger "05_resource_edge_guard_delete_trigger";
  alter table "resource_edge" disable trigger "05_truncate_guard_trigger";
  alter table "public"."document" disable trigger "10_document_resource_insert_trigger";
  alter table "public"."document" disable trigger "10_document_resource_update_trigger";
  alter table "public"."document" disable trigger "10_document_resource_delete_trigger";
  alter table "public"."document" disable trigger "05_truncate_guard_trigger";
  alter table "public"."folder" disable trigger "10_folder_resource_insert_trigger";
  alter table "public"."folder" disable trigger "10_folder_resource_update_trigger";
  alter table "public"."folder" disable trigger "10_folder_resource_delete_trigger";
  alter table "public"."folder" disable trigger "05_truncate_guard_trigger";
  alter table "public"."member" disable trigger "10_member_resource_insert_trigger";
  alter table "public"."member" disable trigger "10_member_resource_update_trigger";
  alter table "public"."member" disable trigger "10_member_resource_delete_trigger";
  alter table "public"."member" disable trigger "05_truncate_guard_trigger";
  alter table "public"."organization" disable trigger "10_organization_resource_insert_trigger";
  alter table "public"."organization" disable trigger "10_organization_resource_update_trigger";
  alter table "public"."organization" disable trigger "10_organization_resource_delete_trigger";
  alter table "public"."organization" disable trigger "05_truncate_guard_trigger";
  alter table "public"."team" disable trigger "10_team_resource_insert_trigger";
  alter table "public"."team" disable trigger "10_team_resource_update_trigger";
  alter table "public"."team" disable trigger "10_team_resource_delete_trigger";
  alter table "public"."team" disable trigger "05_truncate_guard_trigger";
  alter table "assignment_edge" disable trigger "05_assignment_edge_validate_insert_trigger";
  alter table "assignment_edge" disable trigger "05_assignment_edge_validate_update_trigger";
  alter table "assignment_edge" disable trigger "05_truncate_guard_trigger";
end;
$$ language plpgsql security definer set search_path = "public", pg_temp;


revoke execute on function "resource_trigger_disable" () from public;

grant execute on function "resource_trigger_disable" () to "app_backend";

-- Also brings the graph up to date with rows written while the triggers were disabled
create or replace function "resource_trigger_enable"()
returns void as $$
begin
  perform pg_advisory_xact_lock(hashtext('p9s:public:'));
  alter table "resource_edge" disable trigger "10_resource_edge_insert_trigger";
  alter table "resource_edge" disable trigger "10_resource_edge_update_trigger";
  alter table "resource_edge" disable trigger "10_resource_edge_delete_trigger";
  alter table "resource_edge" disable trigger "05_resource_edge_guard_insert_trigger";
  alter table "resource_edge" disable trigger "05_resource_edge_guard_update_trigger";
  alter table "resource_edge" disable trigger "05_resource_edge_guard_delete_trigger";
  alter table "resource_edge" disable trigger "05_truncate_guard_trigger";
  alter table "public"."document" disable trigger "10_document_resource_insert_trigger";
  alter table "public"."document" disable trigger "10_document_resource_update_trigger";
  alter table "public"."document" disable trigger "10_document_resource_delete_trigger";
  alter table "public"."document" disable trigger "05_truncate_guard_trigger";
  alter table "public"."folder" disable trigger "10_folder_resource_insert_trigger";
  alter table "public"."folder" disable trigger "10_folder_resource_update_trigger";
  alter table "public"."folder" disable trigger "10_folder_resource_delete_trigger";
  alter table "public"."folder" disable trigger "05_truncate_guard_trigger";
  alter table "public"."member" disable trigger "10_member_resource_insert_trigger";
  alter table "public"."member" disable trigger "10_member_resource_update_trigger";
  alter table "public"."member" disable trigger "10_member_resource_delete_trigger";
  alter table "public"."member" disable trigger "05_truncate_guard_trigger";
  alter table "public"."organization" disable trigger "10_organization_resource_insert_trigger";
  alter table "public"."organization" disable trigger "10_organization_resource_update_trigger";
  alter table "public"."organization" disable trigger "10_organization_resource_delete_trigger";
  alter table "public"."organization" disable trigger "05_truncate_guard_trigger";
  alter table "public"."team" disable trigger "10_team_resource_insert_trigger";
  alter table "public"."team" disable trigger "10_team_resource_update_trigger";
  alter table "public"."team" disable trigger "10_team_resource_delete_trigger";
  alter table "public"."team" disable trigger "05_truncate_guard_trigger";
  alter table "assignment_edge" disable trigger "05_assignment_edge_validate_insert_trigger";
  alter table "assignment_edge" disable trigger "05_assignment_edge_validate_update_trigger";
  alter table "assignment_edge" disable trigger "05_truncate_guard_trigger";
  
  
  if exists (select from "public"."document" as "the_row" where "the_row"."folder_id" is not null and (select "the_parent"."resource_id" from "public"."folder" as "the_parent" where "the_parent"."id" = "the_row"."folder_id") is null) then
    raise exception 'p9s: % rows have a % that matches no row of %', 'document', 'folder_id', 'folder'
      using errcode = 'foreign_key_violation';
  end if;
  delete from "resource_edge" as "the_edge"
  using "public"."document" as "the_row"
  where "the_edge"."child_id" = "the_row"."resource_id" and "the_edge"."home"
  and "the_edge"."parent_id" is distinct from (select "the_parent"."resource_id" from "public"."folder" as "the_parent" where "the_parent"."id" = "the_row"."folder_id");
  insert into "resource_edge" ("parent_id", "child_id", "permission", "home")
  select (select "the_parent"."resource_id" from "public"."folder" as "the_parent" where "the_parent"."id" = "the_row"."folder_id"), "the_row"."resource_id", ~ b'0'::bit(8), true
  from "public"."document" as "the_row"
  where "the_row"."folder_id" is not null
  on conflict on constraint "resource_edge_pkey" do nothing;

  
  delete from "resource_edge" as "the_edge"
  using "public"."folder" as "the_row"
  where "the_edge"."child_id" = "the_row"."resource_id" and "the_edge"."home"
  and "the_edge"."parent_id" is distinct from "the_row"."parent_resource_id";
  insert into "resource_edge" ("parent_id", "child_id", "permission", "home")
  select "the_row"."parent_resource_id", "the_row"."resource_id", ~ b'0'::bit(8), true
  from "public"."folder" as "the_row"
  where "the_row"."parent_resource_id" is not null
  on conflict on constraint "resource_edge_pkey" do nothing;

  
  if exists (select from "public"."member" as "the_row" where "the_row"."org_id" is not null and (select "the_parent"."resource_id" from "public"."organization" as "the_parent" where "the_parent"."id" = "the_row"."org_id") is null) then
    raise exception 'p9s: % rows have a % that matches no row of %', 'member', 'org_id', 'organization'
      using errcode = 'foreign_key_violation';
  end if;
  delete from "resource_edge" as "the_edge"
  using "public"."member" as "the_row"
  where "the_edge"."child_id" = "the_row"."resource_id" and "the_edge"."home"
  and "the_edge"."parent_id" is distinct from (select "the_parent"."resource_id" from "public"."organization" as "the_parent" where "the_parent"."id" = "the_row"."org_id");
  insert into "resource_edge" ("parent_id", "child_id", "permission", "home")
  select (select "the_parent"."resource_id" from "public"."organization" as "the_parent" where "the_parent"."id" = "the_row"."org_id"), "the_row"."resource_id", ~ b'0'::bit(8), true
  from "public"."member" as "the_row"
  where "the_row"."org_id" is not null
  on conflict on constraint "resource_edge_pkey" do nothing;

  -- No parent column: the home edges of these rows become regular edges
  update "resource_edge" as "the_edge" set "home" = false
  from "public"."organization" as "the_row"
  where "the_edge"."child_id" = "the_row"."resource_id" and "the_edge"."home";

  
  if exists (select from "public"."team" as "the_row" where "the_row"."org_id" is not null and (select "the_parent"."resource_id" from "public"."organization" as "the_parent" where "the_parent"."id" = "the_row"."org_id") is null) then
    raise exception 'p9s: % rows have a % that matches no row of %', 'team', 'org_id', 'organization'
      using errcode = 'foreign_key_violation';
  end if;
  delete from "resource_edge" as "the_edge"
  using "public"."team" as "the_row"
  where "the_edge"."child_id" = "the_row"."resource_id" and "the_edge"."home"
  and "the_edge"."parent_id" is distinct from (select "the_parent"."resource_id" from "public"."organization" as "the_parent" where "the_parent"."id" = "the_row"."org_id");
  insert into "resource_edge" ("parent_id", "child_id", "permission", "home")
  select (select "the_parent"."resource_id" from "public"."organization" as "the_parent" where "the_parent"."id" = "the_row"."org_id"), "the_row"."resource_id", ~ b'0'::bit(8), true
  from "public"."team" as "the_row"
  where "the_row"."org_id" is not null
  on conflict on constraint "resource_edge_pkey" do nothing;
  alter table "resource_edge" enable trigger "10_resource_edge_insert_trigger";
  alter table "resource_edge" enable trigger "10_resource_edge_update_trigger";
  alter table "resource_edge" enable trigger "10_resource_edge_delete_trigger";
  alter table "resource_edge" enable trigger "05_resource_edge_guard_insert_trigger";
  alter table "resource_edge" enable trigger "05_resource_edge_guard_update_trigger";
  alter table "resource_edge" enable trigger "05_resource_edge_guard_delete_trigger";
  alter table "resource_edge" enable trigger "05_truncate_guard_trigger";
  alter table "public"."document" enable trigger "10_document_resource_insert_trigger";
  alter table "public"."document" enable trigger "10_document_resource_update_trigger";
  alter table "public"."document" enable trigger "10_document_resource_delete_trigger";
  alter table "public"."document" enable trigger "05_truncate_guard_trigger";
  alter table "public"."folder" enable trigger "10_folder_resource_insert_trigger";
  alter table "public"."folder" enable trigger "10_folder_resource_update_trigger";
  alter table "public"."folder" enable trigger "10_folder_resource_delete_trigger";
  alter table "public"."folder" enable trigger "05_truncate_guard_trigger";
  alter table "public"."member" enable trigger "10_member_resource_insert_trigger";
  alter table "public"."member" enable trigger "10_member_resource_update_trigger";
  alter table "public"."member" enable trigger "10_member_resource_delete_trigger";
  alter table "public"."member" enable trigger "05_truncate_guard_trigger";
  alter table "public"."organization" enable trigger "10_organization_resource_insert_trigger";
  alter table "public"."organization" enable trigger "10_organization_resource_update_trigger";
  alter table "public"."organization" enable trigger "10_organization_resource_delete_trigger";
  alter table "public"."organization" enable trigger "05_truncate_guard_trigger";
  alter table "public"."team" enable trigger "10_team_resource_insert_trigger";
  alter table "public"."team" enable trigger "10_team_resource_update_trigger";
  alter table "public"."team" enable trigger "10_team_resource_delete_trigger";
  alter table "public"."team" enable trigger "05_truncate_guard_trigger";
  alter table "assignment_edge" enable trigger "05_assignment_edge_validate_insert_trigger";
  alter table "assignment_edge" enable trigger "05_assignment_edge_validate_update_trigger";
  alter table "assignment_edge" enable trigger "05_truncate_guard_trigger";
  perform "resource_edge_cache_backfill"();
end;
$$ language plpgsql security definer set search_path = "public", pg_temp;


revoke execute on function "resource_trigger_enable" () from public;

grant execute on function "resource_trigger_enable" () to "app_backend";


  
-----------------------------------------------------------------------------------------------------------------------
-- 'role' function to rebuild the cache from scratch
-----------------------------------------------------------------------------------------------------------------------
create or replace function "role_edge_cache_backfill" ()
  returns setof "role_edge_cache"
  as $$
begin
  perform pg_advisory_xact_lock(hashtext('p9s:public:'));
  if exists (select from (select "role_id" from "public"."member" union all select "role_id" from "public"."organization" union all select "role_id" from "public"."team" union all select "role_id" from "public"."api_key") as "the_id" ("id") group by "the_id"."id" having count(*) > 1) then
    raise exception 'p9s: the % id % is used by more than one bound row', 'role',
      (select "the_id"."id" from (select "role_id" from "public"."member" union all select "role_id" from "public"."organization" union all select "role_id" from "public"."team" union all select "role_id" from "public"."api_key") as "the_id" ("id") group by "the_id"."id" having count(*) > 1 limit 1)
      using errcode = 'unique_violation';
  end if;
  -- Anti joins rather than not in: Postgres only hashes a not in that it expects to fit in work_mem, and otherwise
  -- scans the ids again for every edge
  if exists (select from "role_edge" as "the_edge" where not exists (select from (select "role_id" from "public"."member" union all select "role_id" from "public"."organization" union all select "role_id" from "public"."team") as "the_id" ("id") where "the_id"."id" = "the_edge"."parent_id"))
    or exists (select from "role_edge" as "the_edge" where not exists (select from (select "role_id" from "public"."member" union all select "role_id" from "public"."organization" union all select "role_id" from "public"."team") as "the_id" ("id") where "the_id"."id" = "the_edge"."child_id")) then
    raise exception 'p9s: % edges connect ids that are not rows of bound tables', 'role' using errcode = 'foreign_key_violation';
  end if;
  if exists (select from "assignment_edge" as "the_assignment" where not exists (select from (select "role_id" from "public"."member" union all select "role_id" from "public"."organization" union all select "role_id" from "public"."team") as "the_id" ("id") where "the_id"."id" = "the_assignment"."role_id")) then
    raise exception 'p9s: assignments reference % ids that are not rows of bound tables', 'role' using errcode = 'foreign_key_violation';
  end if;
  -- Backfills usually follow a bulk load, before autovacuum has gathered statistics. Without them the planner can
  -- seq scan the edge table at every step of the recursive walk, which is quadratic in the number of edges.
  -- This has to be plpgsql: a sql function plans every statement before running the first one.
  analyze "role_edge";
  if exists (select from (
    with recursive "walk" ("node", "depth", "path") as (
      select distinct "the_edge"."child_id", 0, array["the_edge"."child_id"] from "role_edge" as "the_edge"
      union all
      select "the_edge"."parent_id", "walk"."depth" + 1, "the_edge"."parent_id" || "walk"."path"
      from "walk" join "role_edge" as "the_edge" on "the_edge"."child_id" = "walk"."node"
      where "the_edge"."parent_id" <> all ("walk"."path") and "walk"."depth" <= 8
    )
    select "walk"."path" from "walk" where "walk"."depth" > 8
  ) as "the_path") then
    raise exception 'p9s: the % path % has more than % edges, the maxDepth of the % tree', 'role',
      (select array_to_string("the_path"."path", ' -> ') from (
    with recursive "walk" ("node", "depth", "path") as (
      select distinct "the_edge"."child_id", 0, array["the_edge"."child_id"] from "role_edge" as "the_edge"
      union all
      select "the_edge"."parent_id", "walk"."depth" + 1, "the_edge"."parent_id" || "walk"."path"
      from "walk" join "role_edge" as "the_edge" on "the_edge"."child_id" = "walk"."node"
      where "the_edge"."parent_id" <> all ("walk"."path") and "walk"."depth" <= 8
    )
    select "walk"."path" from "walk" where "walk"."depth" > 8
  ) as "the_path" limit 1), 8, 'role'
      using errcode = 'program_limit_exceeded';
  end if;
  delete from "role_edge_cache";
  return query
  insert into "role_edge_cache" ("parent_id", "child_id", "permission")
  select "parent_id", "child_id", "permission"
  from
    "role_edge_cache_view"
    returning
      *;
end;
$$
language plpgsql
volatile
security definer set search_path = "public", pg_temp;


revoke execute on function "role_edge_cache_backfill" () from public;

grant execute on function "role_edge_cache_backfill" () to "app_backend";

-----------------------------------------------------------------------------------------------------------------------
-- 'role' Update cache when edges change
-----------------------------------------------------------------------------------------------------------------------


create or replace function "role_edge_insert_trigger_function"()
returns trigger as $$
begin

  if not exists (select from "p9s_new_rows") then
    return null;
  end if;
  
  
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'p9s: permission graph writes must run in READ COMMITTED isolation, not %', current_setting('transaction_isolation');
  end if;
  perform pg_advisory_xact_lock(hashtext('p9s:public:'));

  if exists (select from "p9s_new_rows" as "the_edge"
    left join "role_edge_cache" as "the_parent_self" on "the_parent_self"."parent_id" = "the_edge"."parent_id" and "the_parent_self"."child_id" = "the_edge"."parent_id"
    left join "role_edge_cache" as "the_child_self" on "the_child_self"."parent_id" = "the_edge"."child_id" and "the_child_self"."child_id" = "the_edge"."child_id"
    where "the_parent_self"."parent_id" is null or "the_child_self"."parent_id" is null) then
    raise exception 'p9s: the % edge % does not connect two rows of bound tables', 'role',
      (select format('%s -> %s', "the_edge"."parent_id", "the_edge"."child_id") from "p9s_new_rows" as "the_edge"
    left join "role_edge_cache" as "the_parent_self" on "the_parent_self"."parent_id" = "the_edge"."parent_id" and "the_parent_self"."child_id" = "the_edge"."parent_id"
    left join "role_edge_cache" as "the_child_self" on "the_child_self"."parent_id" = "the_edge"."child_id" and "the_child_self"."child_id" = "the_edge"."child_id"
    where "the_parent_self"."parent_id" is null or "the_child_self"."parent_id" is null limit 1)
      using errcode = 'foreign_key_violation';
  end if;
  if exists (
    with recursive "the_new" as (select distinct "parent_id", "child_id" from "p9s_new_rows"),
    "below" ("parent", "node", "depth", "path") as (
      select "the_new"."parent_id", "the_new"."child_id", 0, array["the_new"."child_id"] from "the_new"
      union all
      select "below"."parent", "the_edge"."child_id", "below"."depth" + 1, "below"."path" || "the_edge"."child_id"
      from "below" join "role_edge" as "the_edge" on "the_edge"."parent_id" = "below"."node"
      where "the_edge"."child_id" <> all ("below"."path") and "below"."depth" < 8
    ),
    "above" ("node", "depth", "path", "budget") as (
      select "below"."parent", 0, array["below"."parent"], 7 - max("below"."depth") from "below" group by "below"."parent"
      union all
      select "the_edge"."parent_id", "above"."depth" + 1, "above"."path" || "the_edge"."parent_id", "above"."budget"
      from "above" join "role_edge" as "the_edge" on "the_edge"."child_id" = "above"."node"
      where "the_edge"."parent_id" <> all ("above"."path") and "above"."depth" <= "above"."budget"
    )
    select from "above" where "above"."depth" > "above"."budget") and exists (select from (
    with recursive "the_new" as (select distinct "parent_id", "child_id" from "p9s_new_rows"),
    "above" ("start", "node", "depth", "path") as (
      select "the_start"."id", "the_start"."id", 0, array["the_start"."id"] from (select distinct "parent_id" as "id" from "the_new") as "the_start"
      union all
      select "above"."start", "the_edge"."parent_id", "above"."depth" + 1, "above"."path" || "the_edge"."parent_id"
      from "above" join "role_edge" as "the_edge" on "the_edge"."child_id" = "above"."node"
      where "the_edge"."parent_id" <> all ("above"."path") and "above"."depth" < 8
    ),
    "below" ("start", "node", "depth", "path") as (
      select "the_start"."id", "the_start"."id", 0, array["the_start"."id"] from (select distinct "child_id" as "id" from "the_new") as "the_start"
      union all
      select "below"."start", "the_edge"."child_id", "below"."depth" + 1, "below"."path" || "the_edge"."child_id"
      from "below" join "role_edge" as "the_edge" on "the_edge"."parent_id" = "below"."node"
      where "the_edge"."child_id" <> all ("below"."path") and "below"."depth" < 8
    )
    select "the_new"."parent_id", "the_new"."child_id"
    from "the_new"
    join "above" on "above"."start" = "the_new"."parent_id"
    join "below" on "below"."start" = "the_new"."child_id"
    where "above"."depth" + 1 + "below"."depth" > 8
    and not ("above"."path" && "below"."path")
  ) as "the_edge") then
    raise exception 'p9s: the % edge % makes a path of more than % edges, the maxDepth of the % tree', 'role',
      (select format('%s -> %s', "the_edge"."parent_id", "the_edge"."child_id") from (
    with recursive "the_new" as (select distinct "parent_id", "child_id" from "p9s_new_rows"),
    "above" ("start", "node", "depth", "path") as (
      select "the_start"."id", "the_start"."id", 0, array["the_start"."id"] from (select distinct "parent_id" as "id" from "the_new") as "the_start"
      union all
      select "above"."start", "the_edge"."parent_id", "above"."depth" + 1, "above"."path" || "the_edge"."parent_id"
      from "above" join "role_edge" as "the_edge" on "the_edge"."child_id" = "above"."node"
      where "the_edge"."parent_id" <> all ("above"."path") and "above"."depth" < 8
    ),
    "below" ("start", "node", "depth", "path") as (
      select "the_start"."id", "the_start"."id", 0, array["the_start"."id"] from (select distinct "child_id" as "id" from "the_new") as "the_start"
      union all
      select "below"."start", "the_edge"."child_id", "below"."depth" + 1, "below"."path" || "the_edge"."child_id"
      from "below" join "role_edge" as "the_edge" on "the_edge"."parent_id" = "below"."node"
      where "the_edge"."child_id" <> all ("below"."path") and "below"."depth" < 8
    )
    select "the_new"."parent_id", "the_new"."child_id"
    from "the_new"
    join "above" on "above"."start" = "the_new"."parent_id"
    join "below" on "below"."start" = "the_new"."child_id"
    where "above"."depth" + 1 + "below"."depth" > 8
    and not ("above"."path" && "below"."path")
  ) as "the_edge" limit 1), 8, 'role'
      using errcode = 'program_limit_exceeded';
  end if;

  with recursive "affected" ("parent_id") as (
    (select "child_id" from "p9s_new_rows")
    union
    select "the_edge"."child_id"
    from "role_edge" as "the_edge"
    join "affected" on "the_edge"."parent_id" = "affected"."parent_id"
  ),
  "upstream" ("parent_id") as (
    (select "parent_id" from "p9s_new_rows")
    union
    select "the_edge"."parent_id"
    from "role_edge" as "the_edge"
    join "upstream" on "the_edge"."child_id" = "upstream"."parent_id"
  ),
  "walk" ("parent_id", "child_id", "permission", "inside", "depth", "path") as (
    select "affected"."parent_id", "affected"."parent_id", ~ b'0'::bit(8), true, 0, array["affected"."parent_id"]
    from "affected"
    union all
    select
      "the_edge"."parent_id",
      "walk"."child_id",
      ("walk"."permission" & "the_edge"."permission")::bit(8), -- bitwise "and" on permission along a path
      "the_edge"."parent_id" in (select "parent_id" from "affected"),
      "walk"."depth" + 1,
      "walk"."path" || "the_edge"."parent_id"
    from "walk"
    join "role_edge" as "the_edge" on "the_edge"."child_id" = "walk"."parent_id"
    where "walk"."inside"
    and "the_edge"."parent_id" <> all ("walk"."path") -- prevent from cycling
    and "walk"."depth" <= 8 -- max search depth
  ),
  "fresh" as (
    select "the_path"."parent_id", "the_path"."child_id", "or_bitmap_8" ("the_path"."permission") as "permission" -- bitwise "or" on permissions between various paths
    from (
      select "walk"."parent_id", "walk"."child_id", "walk"."permission"
      from "walk"
      where "walk"."inside"
      and ("walk"."parent_id" in (select "parent_id" from "upstream")) is true
      union all
      -- Filtered after the join: on the cache lookup, Postgres would count building the hash of "upstream" once per
      -- walked node, and prefer comparing every walked node with the whole cache.
      select "the_ancestor"."parent_id", "the_ancestor"."child_id", "the_ancestor"."permission"
      from (
        select "the_edge_cache"."parent_id", "walk"."child_id", ("the_edge_cache"."permission" & "walk"."permission")::bit(8) as "permission"
        from "walk"
        join "role_edge_cache" as "the_edge_cache" on "the_edge_cache"."child_id" = "walk"."parent_id"
        where not "walk"."inside"
        offset 0
      ) as "the_ancestor"
      where ("the_ancestor"."parent_id" in (select "parent_id" from "upstream")) is true
    ) as "the_path"
    group by ("the_path"."parent_id", "the_path"."child_id")
  ),
  -- An array is computed once and drives a single index scan. As a join, the planner can prefer a whole table scan
  -- when it overestimates the rows of "fresh".
  "stale" as (
    delete from "role_edge_cache"
    where "role_edge_cache"."child_id" = any (array (select "parent_id" from "affected"))
    and ("role_edge_cache"."parent_id" in (select "parent_id" from "upstream")) is true
    and ("role_edge_cache"."parent_id", "role_edge_cache"."child_id") not in (select "fresh"."parent_id", "fresh"."child_id" from "fresh")
  )
  insert into "role_edge_cache" ("parent_id", "child_id", "permission")
  select "fresh"."parent_id", "fresh"."child_id", "fresh"."permission"
  from "fresh"
  where not exists (
    select 1 from "role_edge_cache" as "the_edge_cache"
    where "the_edge_cache"."parent_id" = "fresh"."parent_id"
    and "the_edge_cache"."child_id" = "fresh"."child_id"
    and "the_edge_cache"."permission" = "fresh"."permission"
  )
  on conflict on constraint "role_edge_cache_pkey"
  do update set "permission" = excluded."permission";
  return null;
end;
$$ language plpgsql security definer set search_path = "public", pg_temp
set enable_hashjoin = off
set enable_mergejoin = off;


revoke execute on function "role_edge_insert_trigger_function" () from public;




drop trigger if exists "10_role_edge_insert_trigger" on "role_edge";
create trigger "10_role_edge_insert_trigger"
after insert on "role_edge"
referencing new table as "p9s_new_rows"
for each statement execute function "role_edge_insert_trigger_function"();



create or replace function "role_edge_update_trigger_function"()
returns trigger as $$
begin

  if not exists (select from "p9s_new_rows") then
    return null;
  end if;
  
  
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'p9s: permission graph writes must run in READ COMMITTED isolation, not %', current_setting('transaction_isolation');
  end if;
  perform pg_advisory_xact_lock(hashtext('p9s:public:'));

  if exists (select from "p9s_new_rows" as "the_edge"
    left join "role_edge_cache" as "the_parent_self" on "the_parent_self"."parent_id" = "the_edge"."parent_id" and "the_parent_self"."child_id" = "the_edge"."parent_id"
    left join "role_edge_cache" as "the_child_self" on "the_child_self"."parent_id" = "the_edge"."child_id" and "the_child_self"."child_id" = "the_edge"."child_id"
    where "the_parent_self"."parent_id" is null or "the_child_self"."parent_id" is null) then
    raise exception 'p9s: the % edge % does not connect two rows of bound tables', 'role',
      (select format('%s -> %s', "the_edge"."parent_id", "the_edge"."child_id") from "p9s_new_rows" as "the_edge"
    left join "role_edge_cache" as "the_parent_self" on "the_parent_self"."parent_id" = "the_edge"."parent_id" and "the_parent_self"."child_id" = "the_edge"."parent_id"
    left join "role_edge_cache" as "the_child_self" on "the_child_self"."parent_id" = "the_edge"."child_id" and "the_child_self"."child_id" = "the_edge"."child_id"
    where "the_parent_self"."parent_id" is null or "the_child_self"."parent_id" is null limit 1)
      using errcode = 'foreign_key_violation';
  end if;
  if exists (
    with recursive "the_new" as (select distinct "parent_id", "child_id" from "p9s_new_rows"),
    "below" ("parent", "node", "depth", "path") as (
      select "the_new"."parent_id", "the_new"."child_id", 0, array["the_new"."child_id"] from "the_new"
      union all
      select "below"."parent", "the_edge"."child_id", "below"."depth" + 1, "below"."path" || "the_edge"."child_id"
      from "below" join "role_edge" as "the_edge" on "the_edge"."parent_id" = "below"."node"
      where "the_edge"."child_id" <> all ("below"."path") and "below"."depth" < 8
    ),
    "above" ("node", "depth", "path", "budget") as (
      select "below"."parent", 0, array["below"."parent"], 7 - max("below"."depth") from "below" group by "below"."parent"
      union all
      select "the_edge"."parent_id", "above"."depth" + 1, "above"."path" || "the_edge"."parent_id", "above"."budget"
      from "above" join "role_edge" as "the_edge" on "the_edge"."child_id" = "above"."node"
      where "the_edge"."parent_id" <> all ("above"."path") and "above"."depth" <= "above"."budget"
    )
    select from "above" where "above"."depth" > "above"."budget") and exists (select from (
    with recursive "the_new" as (select distinct "parent_id", "child_id" from "p9s_new_rows"),
    "above" ("start", "node", "depth", "path") as (
      select "the_start"."id", "the_start"."id", 0, array["the_start"."id"] from (select distinct "parent_id" as "id" from "the_new") as "the_start"
      union all
      select "above"."start", "the_edge"."parent_id", "above"."depth" + 1, "above"."path" || "the_edge"."parent_id"
      from "above" join "role_edge" as "the_edge" on "the_edge"."child_id" = "above"."node"
      where "the_edge"."parent_id" <> all ("above"."path") and "above"."depth" < 8
    ),
    "below" ("start", "node", "depth", "path") as (
      select "the_start"."id", "the_start"."id", 0, array["the_start"."id"] from (select distinct "child_id" as "id" from "the_new") as "the_start"
      union all
      select "below"."start", "the_edge"."child_id", "below"."depth" + 1, "below"."path" || "the_edge"."child_id"
      from "below" join "role_edge" as "the_edge" on "the_edge"."parent_id" = "below"."node"
      where "the_edge"."child_id" <> all ("below"."path") and "below"."depth" < 8
    )
    select "the_new"."parent_id", "the_new"."child_id"
    from "the_new"
    join "above" on "above"."start" = "the_new"."parent_id"
    join "below" on "below"."start" = "the_new"."child_id"
    where "above"."depth" + 1 + "below"."depth" > 8
    and not ("above"."path" && "below"."path")
  ) as "the_edge") then
    raise exception 'p9s: the % edge % makes a path of more than % edges, the maxDepth of the % tree', 'role',
      (select format('%s -> %s', "the_edge"."parent_id", "the_edge"."child_id") from (
    with recursive "the_new" as (select distinct "parent_id", "child_id" from "p9s_new_rows"),
    "above" ("start", "node", "depth", "path") as (
      select "the_start"."id", "the_start"."id", 0, array["the_start"."id"] from (select distinct "parent_id" as "id" from "the_new") as "the_start"
      union all
      select "above"."start", "the_edge"."parent_id", "above"."depth" + 1, "above"."path" || "the_edge"."parent_id"
      from "above" join "role_edge" as "the_edge" on "the_edge"."child_id" = "above"."node"
      where "the_edge"."parent_id" <> all ("above"."path") and "above"."depth" < 8
    ),
    "below" ("start", "node", "depth", "path") as (
      select "the_start"."id", "the_start"."id", 0, array["the_start"."id"] from (select distinct "child_id" as "id" from "the_new") as "the_start"
      union all
      select "below"."start", "the_edge"."child_id", "below"."depth" + 1, "below"."path" || "the_edge"."child_id"
      from "below" join "role_edge" as "the_edge" on "the_edge"."parent_id" = "below"."node"
      where "the_edge"."child_id" <> all ("below"."path") and "below"."depth" < 8
    )
    select "the_new"."parent_id", "the_new"."child_id"
    from "the_new"
    join "above" on "above"."start" = "the_new"."parent_id"
    join "below" on "below"."start" = "the_new"."child_id"
    where "above"."depth" + 1 + "below"."depth" > 8
    and not ("above"."path" && "below"."path")
  ) as "the_edge" limit 1), 8, 'role'
      using errcode = 'program_limit_exceeded';
  end if;

  with recursive "affected" ("parent_id") as (
    (select "child_id" from "p9s_old_rows" union select "child_id" from "p9s_new_rows")
    union
    select "the_edge"."child_id"
    from "role_edge" as "the_edge"
    join "affected" on "the_edge"."parent_id" = "affected"."parent_id"
  ),
  "upstream" ("parent_id") as (
    (select "parent_id" from "p9s_old_rows" union select "parent_id" from "p9s_new_rows")
    union
    select "the_edge"."parent_id"
    from "role_edge" as "the_edge"
    join "upstream" on "the_edge"."child_id" = "upstream"."parent_id"
  ),
  "walk" ("parent_id", "child_id", "permission", "inside", "depth", "path") as (
    select "affected"."parent_id", "affected"."parent_id", ~ b'0'::bit(8), true, 0, array["affected"."parent_id"]
    from "affected"
    union all
    select
      "the_edge"."parent_id",
      "walk"."child_id",
      ("walk"."permission" & "the_edge"."permission")::bit(8), -- bitwise "and" on permission along a path
      "the_edge"."parent_id" in (select "parent_id" from "affected"),
      "walk"."depth" + 1,
      "walk"."path" || "the_edge"."parent_id"
    from "walk"
    join "role_edge" as "the_edge" on "the_edge"."child_id" = "walk"."parent_id"
    where "walk"."inside"
    and "the_edge"."parent_id" <> all ("walk"."path") -- prevent from cycling
    and "walk"."depth" <= 8 -- max search depth
  ),
  "fresh" as (
    select "the_path"."parent_id", "the_path"."child_id", "or_bitmap_8" ("the_path"."permission") as "permission" -- bitwise "or" on permissions between various paths
    from (
      select "walk"."parent_id", "walk"."child_id", "walk"."permission"
      from "walk"
      where "walk"."inside"
      and ("walk"."parent_id" in (select "parent_id" from "upstream")) is true
      union all
      -- Filtered after the join: on the cache lookup, Postgres would count building the hash of "upstream" once per
      -- walked node, and prefer comparing every walked node with the whole cache.
      select "the_ancestor"."parent_id", "the_ancestor"."child_id", "the_ancestor"."permission"
      from (
        select "the_edge_cache"."parent_id", "walk"."child_id", ("the_edge_cache"."permission" & "walk"."permission")::bit(8) as "permission"
        from "walk"
        join "role_edge_cache" as "the_edge_cache" on "the_edge_cache"."child_id" = "walk"."parent_id"
        where not "walk"."inside"
        offset 0
      ) as "the_ancestor"
      where ("the_ancestor"."parent_id" in (select "parent_id" from "upstream")) is true
    ) as "the_path"
    group by ("the_path"."parent_id", "the_path"."child_id")
  ),
  -- An array is computed once and drives a single index scan. As a join, the planner can prefer a whole table scan
  -- when it overestimates the rows of "fresh".
  "stale" as (
    delete from "role_edge_cache"
    where "role_edge_cache"."child_id" = any (array (select "parent_id" from "affected"))
    and ("role_edge_cache"."parent_id" in (select "parent_id" from "upstream")) is true
    and ("role_edge_cache"."parent_id", "role_edge_cache"."child_id") not in (select "fresh"."parent_id", "fresh"."child_id" from "fresh")
  )
  insert into "role_edge_cache" ("parent_id", "child_id", "permission")
  select "fresh"."parent_id", "fresh"."child_id", "fresh"."permission"
  from "fresh"
  where not exists (
    select 1 from "role_edge_cache" as "the_edge_cache"
    where "the_edge_cache"."parent_id" = "fresh"."parent_id"
    and "the_edge_cache"."child_id" = "fresh"."child_id"
    and "the_edge_cache"."permission" = "fresh"."permission"
  )
  on conflict on constraint "role_edge_cache_pkey"
  do update set "permission" = excluded."permission";
  return null;
end;
$$ language plpgsql security definer set search_path = "public", pg_temp
set enable_hashjoin = off
set enable_mergejoin = off;


revoke execute on function "role_edge_update_trigger_function" () from public;




drop trigger if exists "10_role_edge_update_trigger" on "role_edge";
create trigger "10_role_edge_update_trigger"
after update on "role_edge"
referencing old table as "p9s_old_rows" new table as "p9s_new_rows"
for each statement execute function "role_edge_update_trigger_function"();



create or replace function "role_edge_delete_trigger_function"()
returns trigger as $$
begin

  if not exists (select from "p9s_old_rows") then
    return null;
  end if;
  
  
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'p9s: permission graph writes must run in READ COMMITTED isolation, not %', current_setting('transaction_isolation');
  end if;
  perform pg_advisory_xact_lock(hashtext('p9s:public:'));


  with recursive "affected" ("parent_id") as (
    (select "child_id" from "p9s_old_rows")
    union
    select "the_edge"."child_id"
    from "role_edge" as "the_edge"
    join "affected" on "the_edge"."parent_id" = "affected"."parent_id"
  ),
  "upstream" ("parent_id") as (
    (select "parent_id" from "p9s_old_rows")
    union
    select "the_edge"."parent_id"
    from "role_edge" as "the_edge"
    join "upstream" on "the_edge"."child_id" = "upstream"."parent_id"
  ),
  "walk" ("parent_id", "child_id", "permission", "inside", "depth", "path") as (
    select "affected"."parent_id", "affected"."parent_id", ~ b'0'::bit(8), true, 0, array["affected"."parent_id"]
    from "affected"
    union all
    select
      "the_edge"."parent_id",
      "walk"."child_id",
      ("walk"."permission" & "the_edge"."permission")::bit(8), -- bitwise "and" on permission along a path
      "the_edge"."parent_id" in (select "parent_id" from "affected"),
      "walk"."depth" + 1,
      "walk"."path" || "the_edge"."parent_id"
    from "walk"
    join "role_edge" as "the_edge" on "the_edge"."child_id" = "walk"."parent_id"
    where "walk"."inside"
    and "the_edge"."parent_id" <> all ("walk"."path") -- prevent from cycling
    and "walk"."depth" <= 8 -- max search depth
  ),
  "fresh" as (
    select "the_path"."parent_id", "the_path"."child_id", "or_bitmap_8" ("the_path"."permission") as "permission" -- bitwise "or" on permissions between various paths
    from (
      select "walk"."parent_id", "walk"."child_id", "walk"."permission"
      from "walk"
      where "walk"."inside"
      and ("walk"."parent_id" in (select "parent_id" from "upstream")) is true
      union all
      -- Filtered after the join: on the cache lookup, Postgres would count building the hash of "upstream" once per
      -- walked node, and prefer comparing every walked node with the whole cache.
      select "the_ancestor"."parent_id", "the_ancestor"."child_id", "the_ancestor"."permission"
      from (
        select "the_edge_cache"."parent_id", "walk"."child_id", ("the_edge_cache"."permission" & "walk"."permission")::bit(8) as "permission"
        from "walk"
        join "role_edge_cache" as "the_edge_cache" on "the_edge_cache"."child_id" = "walk"."parent_id"
        where not "walk"."inside"
        offset 0
      ) as "the_ancestor"
      where ("the_ancestor"."parent_id" in (select "parent_id" from "upstream")) is true
    ) as "the_path"
    group by ("the_path"."parent_id", "the_path"."child_id")
  ),
  -- An array is computed once and drives a single index scan. As a join, the planner can prefer a whole table scan
  -- when it overestimates the rows of "fresh".
  "stale" as (
    delete from "role_edge_cache"
    where "role_edge_cache"."child_id" = any (array (select "parent_id" from "affected"))
    and ("role_edge_cache"."parent_id" in (select "parent_id" from "upstream")) is true
    and ("role_edge_cache"."parent_id", "role_edge_cache"."child_id") not in (select "fresh"."parent_id", "fresh"."child_id" from "fresh")
  )
  insert into "role_edge_cache" ("parent_id", "child_id", "permission")
  select "fresh"."parent_id", "fresh"."child_id", "fresh"."permission"
  from "fresh"
  where not exists (
    select 1 from "role_edge_cache" as "the_edge_cache"
    where "the_edge_cache"."parent_id" = "fresh"."parent_id"
    and "the_edge_cache"."child_id" = "fresh"."child_id"
    and "the_edge_cache"."permission" = "fresh"."permission"
  )
  on conflict on constraint "role_edge_cache_pkey"
  do update set "permission" = excluded."permission";
  return null;
end;
$$ language plpgsql security definer set search_path = "public", pg_temp
set enable_hashjoin = off
set enable_mergejoin = off;


revoke execute on function "role_edge_delete_trigger_function" () from public;




drop trigger if exists "10_role_edge_delete_trigger" on "role_edge";
create trigger "10_role_edge_delete_trigger"
after delete on "role_edge"
referencing old table as "p9s_old_rows"
for each statement execute function "role_edge_delete_trigger_function"();


drop trigger if exists "05_truncate_guard_trigger" on "role_edge";
create trigger "05_truncate_guard_trigger" before truncate on "role_edge" for each statement execute function "truncate_guard_trigger_function"();

-----------------------------------------------------------------------------------------------------------------------
-- 'role' home edges are written by p9s only
-----------------------------------------------------------------------------------------------------------------------
-- p9s writes them from the triggers of bound tables, one level deeper than a statement sent by a client
create or replace function "role_edge_guard_trigger_function"()
returns trigger as $$
begin
  if pg_trigger_depth() > 1 then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'INSERT' then
    raise exception 'p9s: home edges are created by p9s from the parent column of their row'
      using errcode = 'insufficient_privilege';
  elsif tg_op = 'UPDATE' then
    if new."home" and not old."home" then
      raise exception 'p9s: an edge cannot be made a home edge, home edges follow the parent column of their row'
        using errcode = 'insufficient_privilege';
    end if;
    -- Changing a home edge makes it a regular edge, which moving or deleting its row leaves alone
    new."home" := false;
    return new;
  end if;
  raise exception 'p9s: home edges are removed by moving or deleting their row. To delete one apart from its row, first make it a regular edge with update ... set home = false'
    using errcode = 'insufficient_privilege';
end;
$$ language plpgsql;


revoke execute on function "role_edge_guard_trigger_function" () from public;



drop trigger if exists "05_role_edge_guard_insert_trigger" on "role_edge";
create trigger "05_role_edge_guard_insert_trigger" before insert on "role_edge" for each row when (new."home") execute function "role_edge_guard_trigger_function"();
drop trigger if exists "05_role_edge_guard_update_trigger" on "role_edge";
create trigger "05_role_edge_guard_update_trigger" before update on "role_edge" for each row when (old."home" or new."home") execute function "role_edge_guard_trigger_function"();
drop trigger if exists "05_role_edge_guard_delete_trigger" on "role_edge";
create trigger "05_role_edge_guard_delete_trigger" before delete on "role_edge" for each row when (old."home") execute function "role_edge_guard_trigger_function"();

-----------------------------------------------------------------------------------------------------------------------
-- 'role' rows of bound tables
-----------------------------------------------------------------------------------------------------------------------


create or replace function "role_node_insert" ("the_ids" uuid[], "the_parents" uuid[])
returns void as $$
begin

  if exists (select "the_row"."id" from unnest("the_ids") as "the_row" ("id")
    join "role_edge_cache" as "the_self" on "the_self"."parent_id" = "the_row"."id" and "the_self"."child_id" = "the_row"."id"
    union all
    select "the_row"."id" from unnest("the_ids") as "the_row" ("id")
    join "public"."api_key" as "the_leaf" on "the_leaf"."role_id" = "the_row"."id") then
    raise exception 'p9s: the % id % is already used by another row', 'role',
      (select "the_used"."id" from (select "the_row"."id" from unnest("the_ids") as "the_row" ("id")
    join "role_edge_cache" as "the_self" on "the_self"."parent_id" = "the_row"."id" and "the_self"."child_id" = "the_row"."id"
    union all
    select "the_row"."id" from unnest("the_ids") as "the_row" ("id")
    join "public"."api_key" as "the_leaf" on "the_leaf"."role_id" = "the_row"."id") as "the_used" limit 1)
      using errcode = 'unique_violation';
  end if;
  -- A new row cannot be referenced by others yet, so its self row needs no lock
  insert into "role_edge_cache" ("parent_id", "child_id", "permission")
  select "the_row"."id", "the_row"."id", ~ b'0'::bit(8) from unnest("the_ids") as "the_row" ("id");
  if exists (select from unnest("the_parents") as "the_parent" ("id") where "the_parent"."id" is not null) then
    
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'p9s: permission graph writes must run in READ COMMITTED isolation, not %', current_setting('transaction_isolation');
  end if;
  perform pg_advisory_xact_lock(hashtext('p9s:public:'));
    insert into "role_edge" ("parent_id", "child_id", "permission", "home")
    select "the_row"."parent", "the_row"."id", ~ b'0'::bit(8), true
    from unnest("the_ids", coalesce("the_parents", '{}')) as "the_row" ("id", "parent")
    where "the_row"."parent" is not null
    on conflict on constraint "role_edge_pkey" do nothing;
  end if;
end;
$$ language plpgsql set plan_cache_mode = force_generic_plan;


revoke execute on function "role_node_insert" ("the_ids" uuid[], "the_parents" uuid[]) from public;



-- The home edge follows the parent column. It moves when nothing else links the new parent to the row, otherwise it
-- gives way to that edge and the edge keeps its bits.

create or replace function "role_node_update" ("the_ids" uuid[], "the_parents" uuid[])
returns void as $$
begin

  
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'p9s: permission graph writes must run in READ COMMITTED isolation, not %', current_setting('transaction_isolation');
  end if;
  perform pg_advisory_xact_lock(hashtext('p9s:public:'));
  update "role_edge" as "the_edge" set "parent_id" = "the_row"."parent"
  from unnest("the_ids", coalesce("the_parents", '{}')) as "the_row" ("id", "parent")
  where "the_edge"."child_id" = "the_row"."id" and "the_edge"."home"
  and "the_row"."parent" is not null and "the_edge"."parent_id" <> "the_row"."parent"
  and not exists (select from "role_edge" as "the_other" where "the_other"."parent_id" = "the_row"."parent" and "the_other"."child_id" = "the_row"."id");

  delete from "role_edge" as "the_edge"
  using unnest("the_ids", coalesce("the_parents", '{}')) as "the_row" ("id", "parent")
  where "the_edge"."child_id" = "the_row"."id" and "the_edge"."home"
  and "the_edge"."parent_id" is distinct from "the_row"."parent";

  insert into "role_edge" ("parent_id", "child_id", "permission", "home")
  select "the_row"."parent", "the_row"."id", ~ b'0'::bit(8), true
  from unnest("the_ids", coalesce("the_parents", '{}')) as "the_row" ("id", "parent")
  where "the_row"."parent" is not null
  on conflict on constraint "role_edge_pkey" do nothing;
end;
$$ language plpgsql set plan_cache_mode = force_generic_plan;


revoke execute on function "role_node_update" ("the_ids" uuid[], "the_parents" uuid[]) from public;



-- The lock comes first: an edge to these rows committed while they are deleted must be seen by the deletes below

create or replace function "role_node_delete" ("the_ids" uuid[])
returns void as $$
begin

  
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'p9s: permission graph writes must run in READ COMMITTED isolation, not %', current_setting('transaction_isolation');
  end if;
  perform pg_advisory_xact_lock(hashtext('p9s:public:'));
  delete from "assignment_edge" as "the_assignment"
  where "the_assignment"."role_id" = any ("the_ids");
  delete from "role_edge" as "the_edge"
  where "the_edge"."parent_id" = any ("the_ids") or "the_edge"."child_id" = any ("the_ids");
  delete from "role_edge_cache" as "the_self"
  using unnest("the_ids") as "the_row" ("id")
  where "the_self"."parent_id" = "the_row"."id" and "the_self"."child_id" = "the_row"."id";
end;
$$ language plpgsql set plan_cache_mode = force_generic_plan;


revoke execute on function "role_node_delete" ("the_ids" uuid[]) from public;




-- 'member' rows are 'role' nodes
create or replace function "member_role_trigger_function"()
returns trigger as $$
begin
  if tg_op = 'INSERT' then
  if exists (select from "p9s_new_rows" as "the_row" where "the_row"."org_id" is not null and (select "the_parent"."role_id" from "public"."organization" as "the_parent" where "the_parent"."id" = "the_row"."org_id") is null) then
    raise exception 'p9s: % rows have a % that matches no row of %', 'member', 'org_id', 'organization'
      using errcode = 'foreign_key_violation';
  end if;
    perform "role_node_insert"(array_agg("the_row"."role_id"), array_agg((select "the_parent"."role_id" from "public"."organization" as "the_parent" where "the_parent"."id" = "the_row"."org_id"))) from "p9s_new_rows" as "the_row" having count(*) > 0;
  elsif tg_op = 'UPDATE' then
    if exists (select "role_id" from "p9s_old_rows" except select "role_id" from "p9s_new_rows") then
      raise exception 'p9s: the % id of a % row cannot change', 'role', 'member' using errcode = 'integrity_constraint_violation';
    end if;
    -- Transition tables have no index: an exists would be planned to stop early, comparing every new row with every
    -- old row when no parent changed. Counting them is planned as a join of both
    if (select count(*) from "p9s_new_rows" as "the_row" join "p9s_old_rows" as "the_old_row" using ("role_id")
      where "the_row"."org_id" is distinct from "the_old_row"."org_id") > 0 then
  if exists (select from "p9s_new_rows" as "the_row" where "the_row"."org_id" is not null and (select "the_parent"."role_id" from "public"."organization" as "the_parent" where "the_parent"."id" = "the_row"."org_id") is null) then
    raise exception 'p9s: % rows have a % that matches no row of %', 'member', 'org_id', 'organization'
      using errcode = 'foreign_key_violation';
  end if;
      perform "role_node_update"(array_agg("the_row"."role_id"), array_agg((select "the_parent"."role_id" from "public"."organization" as "the_parent" where "the_parent"."id" = "the_row"."org_id")))
      from "p9s_new_rows" as "the_row" join "p9s_old_rows" as "the_old_row" using ("role_id")
      where "the_row"."org_id" is distinct from "the_old_row"."org_id";
    end if;
  else
    perform "role_node_delete"(array_agg("the_row"."role_id")) from "p9s_old_rows" as "the_row" having count(*) > 0;
  end if;
  return null;
end;
$$ language plpgsql security definer set search_path = "public", pg_temp;

revoke execute on function "member_role_trigger_function" () from public;



drop trigger if exists "10_member_role_insert_trigger" on "public"."member";
create trigger "10_member_role_insert_trigger"
after insert on "public"."member"
referencing new table as "p9s_new_rows"
for each statement execute function "member_role_trigger_function"();

drop trigger if exists "10_member_role_update_trigger" on "public"."member";
create trigger "10_member_role_update_trigger"
after update on "public"."member"
referencing old table as "p9s_old_rows" new table as "p9s_new_rows"
for each statement execute function "member_role_trigger_function"();

drop trigger if exists "10_member_role_delete_trigger" on "public"."member";
create trigger "10_member_role_delete_trigger"
after delete on "public"."member"
referencing old table as "p9s_old_rows"
for each statement execute function "member_role_trigger_function"();

drop trigger if exists "05_truncate_guard_trigger" on "public"."member";
create trigger "05_truncate_guard_trigger" before truncate on "public"."member" for each statement execute function "truncate_guard_trigger_function"();


-- 'organization' rows are 'role' nodes
create or replace function "organization_role_trigger_function"()
returns trigger as $$
begin
  if tg_op = 'INSERT' then
    perform "role_node_insert"(array_agg("the_row"."role_id"), null) from "p9s_new_rows" as "the_row" having count(*) > 0;
  elsif tg_op = 'UPDATE' then
    if exists (select "role_id" from "p9s_old_rows" except select "role_id" from "p9s_new_rows") then
      raise exception 'p9s: the % id of a % row cannot change', 'role', 'organization' using errcode = 'integrity_constraint_violation';
    end if;
  else
    perform "role_node_delete"(array_agg("the_row"."role_id")) from "p9s_old_rows" as "the_row" having count(*) > 0;
  end if;
  return null;
end;
$$ language plpgsql security definer set search_path = "public", pg_temp;

revoke execute on function "organization_role_trigger_function" () from public;



drop trigger if exists "10_organization_role_insert_trigger" on "public"."organization";
create trigger "10_organization_role_insert_trigger"
after insert on "public"."organization"
referencing new table as "p9s_new_rows"
for each statement execute function "organization_role_trigger_function"();

drop trigger if exists "10_organization_role_update_trigger" on "public"."organization";
create trigger "10_organization_role_update_trigger"
after update on "public"."organization"
referencing old table as "p9s_old_rows" new table as "p9s_new_rows"
for each statement execute function "organization_role_trigger_function"();

drop trigger if exists "10_organization_role_delete_trigger" on "public"."organization";
create trigger "10_organization_role_delete_trigger"
after delete on "public"."organization"
referencing old table as "p9s_old_rows"
for each statement execute function "organization_role_trigger_function"();

drop trigger if exists "05_truncate_guard_trigger" on "public"."organization";
create trigger "05_truncate_guard_trigger" before truncate on "public"."organization" for each statement execute function "truncate_guard_trigger_function"();


-- 'team' rows are 'role' nodes
create or replace function "team_role_trigger_function"()
returns trigger as $$
begin
  if tg_op = 'INSERT' then
    perform "role_node_insert"(array_agg("the_row"."role_id"), null) from "p9s_new_rows" as "the_row" having count(*) > 0;
  elsif tg_op = 'UPDATE' then
    if exists (select "role_id" from "p9s_old_rows" except select "role_id" from "p9s_new_rows") then
      raise exception 'p9s: the % id of a % row cannot change', 'role', 'team' using errcode = 'integrity_constraint_violation';
    end if;
  else
    perform "role_node_delete"(array_agg("the_row"."role_id")) from "p9s_old_rows" as "the_row" having count(*) > 0;
  end if;
  return null;
end;
$$ language plpgsql security definer set search_path = "public", pg_temp;

revoke execute on function "team_role_trigger_function" () from public;



drop trigger if exists "10_team_role_insert_trigger" on "public"."team";
create trigger "10_team_role_insert_trigger"
after insert on "public"."team"
referencing new table as "p9s_new_rows"
for each statement execute function "team_role_trigger_function"();

drop trigger if exists "10_team_role_update_trigger" on "public"."team";
create trigger "10_team_role_update_trigger"
after update on "public"."team"
referencing old table as "p9s_old_rows" new table as "p9s_new_rows"
for each statement execute function "team_role_trigger_function"();

drop trigger if exists "10_team_role_delete_trigger" on "public"."team";
create trigger "10_team_role_delete_trigger"
after delete on "public"."team"
referencing old table as "p9s_old_rows"
for each statement execute function "team_role_trigger_function"();

drop trigger if exists "05_truncate_guard_trigger" on "public"."team";
create trigger "05_truncate_guard_trigger" before truncate on "public"."team" for each statement execute function "truncate_guard_trigger_function"();


-----------------------------------------------------------------------------------------------------------------------
-- 'role' functions to enable / disable triggers
-----------------------------------------------------------------------------------------------------------------------
create or replace function "role_trigger_disable"()
returns void as $$
begin
  alter table "role_edge" disable trigger "10_role_edge_insert_trigger";
  alter table "role_edge" disable trigger "10_role_edge_update_trigger";
  alter table "role_edge" disable trigger "10_role_edge_delete_trigger";
  alter table "role_edge" disable trigger "05_role_edge_guard_insert_trigger";
  alter table "role_edge" disable trigger "05_role_edge_guard_update_trigger";
  alter table "role_edge" disable trigger "05_role_edge_guard_delete_trigger";
  alter table "role_edge" disable trigger "05_truncate_guard_trigger";
  alter table "public"."member" disable trigger "10_member_role_insert_trigger";
  alter table "public"."member" disable trigger "10_member_role_update_trigger";
  alter table "public"."member" disable trigger "10_member_role_delete_trigger";
  alter table "public"."member" disable trigger "05_truncate_guard_trigger";
  alter table "public"."organization" disable trigger "10_organization_role_insert_trigger";
  alter table "public"."organization" disable trigger "10_organization_role_update_trigger";
  alter table "public"."organization" disable trigger "10_organization_role_delete_trigger";
  alter table "public"."organization" disable trigger "05_truncate_guard_trigger";
  alter table "public"."team" disable trigger "10_team_role_insert_trigger";
  alter table "public"."team" disable trigger "10_team_role_update_trigger";
  alter table "public"."team" disable trigger "10_team_role_delete_trigger";
  alter table "public"."team" disable trigger "05_truncate_guard_trigger";
end;
$$ language plpgsql security definer set search_path = "public", pg_temp;


revoke execute on function "role_trigger_disable" () from public;

grant execute on function "role_trigger_disable" () to "app_backend";

-- Also brings the graph up to date with rows written while the triggers were disabled
create or replace function "role_trigger_enable"()
returns void as $$
begin
  perform pg_advisory_xact_lock(hashtext('p9s:public:'));
  alter table "role_edge" disable trigger "10_role_edge_insert_trigger";
  alter table "role_edge" disable trigger "10_role_edge_update_trigger";
  alter table "role_edge" disable trigger "10_role_edge_delete_trigger";
  alter table "role_edge" disable trigger "05_role_edge_guard_insert_trigger";
  alter table "role_edge" disable trigger "05_role_edge_guard_update_trigger";
  alter table "role_edge" disable trigger "05_role_edge_guard_delete_trigger";
  alter table "role_edge" disable trigger "05_truncate_guard_trigger";
  alter table "public"."member" disable trigger "10_member_role_insert_trigger";
  alter table "public"."member" disable trigger "10_member_role_update_trigger";
  alter table "public"."member" disable trigger "10_member_role_delete_trigger";
  alter table "public"."member" disable trigger "05_truncate_guard_trigger";
  alter table "public"."organization" disable trigger "10_organization_role_insert_trigger";
  alter table "public"."organization" disable trigger "10_organization_role_update_trigger";
  alter table "public"."organization" disable trigger "10_organization_role_delete_trigger";
  alter table "public"."organization" disable trigger "05_truncate_guard_trigger";
  alter table "public"."team" disable trigger "10_team_role_insert_trigger";
  alter table "public"."team" disable trigger "10_team_role_update_trigger";
  alter table "public"."team" disable trigger "10_team_role_delete_trigger";
  alter table "public"."team" disable trigger "05_truncate_guard_trigger";
  
  
  if exists (select from "public"."member" as "the_row" where "the_row"."org_id" is not null and (select "the_parent"."role_id" from "public"."organization" as "the_parent" where "the_parent"."id" = "the_row"."org_id") is null) then
    raise exception 'p9s: % rows have a % that matches no row of %', 'member', 'org_id', 'organization'
      using errcode = 'foreign_key_violation';
  end if;
  delete from "role_edge" as "the_edge"
  using "public"."member" as "the_row"
  where "the_edge"."child_id" = "the_row"."role_id" and "the_edge"."home"
  and "the_edge"."parent_id" is distinct from (select "the_parent"."role_id" from "public"."organization" as "the_parent" where "the_parent"."id" = "the_row"."org_id");
  insert into "role_edge" ("parent_id", "child_id", "permission", "home")
  select (select "the_parent"."role_id" from "public"."organization" as "the_parent" where "the_parent"."id" = "the_row"."org_id"), "the_row"."role_id", ~ b'0'::bit(8), true
  from "public"."member" as "the_row"
  where "the_row"."org_id" is not null
  on conflict on constraint "role_edge_pkey" do nothing;

  -- No parent column: the home edges of these rows become regular edges
  update "role_edge" as "the_edge" set "home" = false
  from "public"."organization" as "the_row"
  where "the_edge"."child_id" = "the_row"."role_id" and "the_edge"."home";

  -- No parent column: the home edges of these rows become regular edges
  update "role_edge" as "the_edge" set "home" = false
  from "public"."team" as "the_row"
  where "the_edge"."child_id" = "the_row"."role_id" and "the_edge"."home";
  alter table "role_edge" enable trigger "10_role_edge_insert_trigger";
  alter table "role_edge" enable trigger "10_role_edge_update_trigger";
  alter table "role_edge" enable trigger "10_role_edge_delete_trigger";
  alter table "role_edge" enable trigger "05_role_edge_guard_insert_trigger";
  alter table "role_edge" enable trigger "05_role_edge_guard_update_trigger";
  alter table "role_edge" enable trigger "05_role_edge_guard_delete_trigger";
  alter table "role_edge" enable trigger "05_truncate_guard_trigger";
  alter table "public"."member" enable trigger "10_member_role_insert_trigger";
  alter table "public"."member" enable trigger "10_member_role_update_trigger";
  alter table "public"."member" enable trigger "10_member_role_delete_trigger";
  alter table "public"."member" enable trigger "05_truncate_guard_trigger";
  alter table "public"."organization" enable trigger "10_organization_role_insert_trigger";
  alter table "public"."organization" enable trigger "10_organization_role_update_trigger";
  alter table "public"."organization" enable trigger "10_organization_role_delete_trigger";
  alter table "public"."organization" enable trigger "05_truncate_guard_trigger";
  alter table "public"."team" enable trigger "10_team_role_insert_trigger";
  alter table "public"."team" enable trigger "10_team_role_update_trigger";
  alter table "public"."team" enable trigger "10_team_role_delete_trigger";
  alter table "public"."team" enable trigger "05_truncate_guard_trigger";
  perform "role_edge_cache_backfill"();
end;
$$ language plpgsql security definer set search_path = "public", pg_temp;


revoke execute on function "role_trigger_enable" () from public;

grant execute on function "role_trigger_enable" () to "app_backend";


  
-----------------------------------------------------------------------------------------------------------------------
-- Assignments connect rows of bound tables
-----------------------------------------------------------------------------------------------------------------------

create or replace function "assignment_edge_validate_trigger_function"()
returns trigger as $$
begin

  if not exists (select from "p9s_new_rows") then
    return null;
  end if;
  
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'p9s: permission graph writes must run in READ COMMITTED isolation, not %', current_setting('transaction_isolation');
  end if;
  perform pg_advisory_xact_lock(hashtext('p9s:public:'));

  if exists (select from "p9s_new_rows" as "the_assignment"
    left join "resource_edge_cache" as "the_resource_self" on "the_resource_self"."parent_id" = "the_assignment"."resource_id" and "the_resource_self"."child_id" = "the_assignment"."resource_id"
    left join "role_edge_cache" as "the_role_self" on "the_role_self"."parent_id" = "the_assignment"."role_id" and "the_role_self"."child_id" = "the_assignment"."role_id"
    where "the_resource_self"."parent_id" is null or "the_role_self"."parent_id" is null) then
    raise exception 'p9s: the assignment of resource % to role % does not reference rows of bound tables',
      (select "the_assignment"."resource_id" from "p9s_new_rows" as "the_assignment"
    left join "resource_edge_cache" as "the_resource_self" on "the_resource_self"."parent_id" = "the_assignment"."resource_id" and "the_resource_self"."child_id" = "the_assignment"."resource_id"
    left join "role_edge_cache" as "the_role_self" on "the_role_self"."parent_id" = "the_assignment"."role_id" and "the_role_self"."child_id" = "the_assignment"."role_id"
    where "the_resource_self"."parent_id" is null or "the_role_self"."parent_id" is null limit 1), (select "the_assignment"."role_id" from "p9s_new_rows" as "the_assignment"
    left join "resource_edge_cache" as "the_resource_self" on "the_resource_self"."parent_id" = "the_assignment"."resource_id" and "the_resource_self"."child_id" = "the_assignment"."resource_id"
    left join "role_edge_cache" as "the_role_self" on "the_role_self"."parent_id" = "the_assignment"."role_id" and "the_role_self"."child_id" = "the_assignment"."role_id"
    where "the_resource_self"."parent_id" is null or "the_role_self"."parent_id" is null limit 1)
      using errcode = 'foreign_key_violation';
  end if;
  return null;
end;
$$ language plpgsql security definer set search_path = "public", pg_temp
set enable_hashjoin = off
set enable_mergejoin = off;


revoke execute on function "assignment_edge_validate_trigger_function" () from public;




drop trigger if exists "05_assignment_edge_validate_insert_trigger" on "assignment_edge";
create trigger "05_assignment_edge_validate_insert_trigger"
after insert on "assignment_edge"
referencing new table as "p9s_new_rows"
for each statement execute function "assignment_edge_validate_trigger_function"();


drop trigger if exists "05_assignment_edge_validate_update_trigger" on "assignment_edge";
create trigger "05_assignment_edge_validate_update_trigger"
after update on "assignment_edge"
referencing old table as "p9s_old_rows" new table as "p9s_new_rows"
for each statement execute function "assignment_edge_validate_trigger_function"();


drop trigger if exists "05_truncate_guard_trigger" on "assignment_edge";
create trigger "05_truncate_guard_trigger" before truncate on "assignment_edge" for each statement execute function "truncate_guard_trigger_function"();


drop trigger if exists "10_assignment_edge_insert_trigger" on "assignment_edge";
drop trigger if exists "10_assignment_edge_update_trigger" on "assignment_edge";
drop trigger if exists "10_assignment_edge_delete_trigger" on "assignment_edge";

drop trigger if exists "20_assignment_edge_role_insert_trigger" on "role_edge_cache";
drop trigger if exists "20_assignment_edge_role_update_trigger" on "role_edge_cache";
drop trigger if exists "20_assignment_edge_role_delete_trigger" on "role_edge_cache";

drop trigger if exists "20_assignment_edge_resource_insert_trigger" on "resource_edge_cache";
drop trigger if exists "20_assignment_edge_resource_update_trigger" on "resource_edge_cache";
drop trigger if exists "20_assignment_edge_resource_delete_trigger" on "resource_edge_cache";




-----------------------------------------------------------------------------------------------------------------------
-- Assignment transitive edge cache table
-----------------------------------------------------------------------------------------------------------------------
create table if not exists "assignment_edge_cache" (
  "role_id" uuid not null,
  "resource_id" uuid not null,
  "permission" bit(8),
  constraint "assignment_edge_cache_pkey" primary key ("role_id", "resource_id")
);

create index if not exists "assignment_edge_cache_role_id_index" on "assignment_edge_cache" ("role_id");

create index if not exists "assignment_edge_cache_resource_id_index" on "assignment_edge_cache" ("resource_id");

-- With resources, a role has a row for every resource below its assignments, mostly high in the tree. As for the
-- resource cache, estimate the rows of a role as those of the largest, so that checking a few rows does not list them.
alter table "assignment_edge_cache" alter column "role_id" reset (n_distinct);

-- Only p9s triggers write to the cache. Users see their own part of the graph through the views of the current user.
select pg_temp.p9s_set_privileges('"assignment_edge_cache"'::regclass, array['app_backend']::text[], array[]::text[], array['app_user']::text[]);


-----------------------------------------------------------------------------------------------------------------------
-- View of all transitive assignment with cache edges
-----------------------------------------------------------------------------------------------------------------------
create or replace view "assignment_edge_cache_view" as

    select
      "the_edge_cache"."child_id" as "role_id",
      "the_assignment"."resource_id" as "resource_id",
      "or_bitmap_8" ("the_assignment"."permission" & "the_edge_cache"."permission") as "permission" -- bitwise "or" on permissions between various paths
    from
      "assignment_edge" as "the_assignment"
    join
      "role_edge_cache" as "the_edge_cache"
    on
      "the_assignment"."role_id" = "the_edge_cache"."parent_id"
    where true
    group by ("the_assignment"."resource_id", "the_edge_cache"."child_id");

select pg_temp.p9s_set_privileges('"assignment_edge_cache_view"'::regclass, array['app_backend']::text[], array[]::text[], array['app_user']::text[]);

-----------------------------------------------------------------------------------------------------------------------
-- Assignment function to rebuild the cache from scratch
-----------------------------------------------------------------------------------------------------------------------
create or replace function "assignment_edge_cache_backfill" ()
  returns setof "assignment_edge_cache"
  as $$
begin
  perform pg_advisory_xact_lock(hashtext('p9s:public:'));
  -- Same as the edge cache backfills, the join plan needs statistics on freshly loaded tables
  analyze "assignment_edge";
  analyze "role_edge_cache";
  delete from "assignment_edge_cache";
  -- Policies read the rows of a role together. In this order they fill few pages, whatever plan the view takes.
  return query
  insert into "assignment_edge_cache" ("role_id", "resource_id", "permission")
  select "role_id", "resource_id", "permission"
  from
    "assignment_edge_cache_view"
  order by
    "role_id", "resource_id"
    returning
      *;
end;
$$
language plpgsql
volatile
security definer set search_path = "public", pg_temp;


revoke execute on function "assignment_edge_cache_backfill" () from public;

grant execute on function "assignment_edge_cache_backfill" () to "app_backend";

-----------------------------------------------------------------------------------------------------------------------
-- Update cache when assignments change
-----------------------------------------------------------------------------------------------------------------------


create or replace function "assignment_edge_insert_trigger_function"()
returns trigger as $$
begin

  if not exists (select from "p9s_new_rows") then
    return null;
  end if;
  
  
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'p9s: permission graph writes must run in READ COMMITTED isolation, not %', current_setting('transaction_isolation');
  end if;
  perform pg_advisory_xact_lock(hashtext('p9s:public:'));

  delete from "assignment_edge_cache" where "resource_id" in (select "resource_id" from "p9s_new_rows");
  insert into "assignment_edge_cache" ("role_id", "resource_id", "permission")
  
    select
      "the_edge_cache"."child_id" as "role_id",
      "the_assignment"."resource_id" as "resource_id",
      "or_bitmap_8" ("the_assignment"."permission" & "the_edge_cache"."permission") as "permission" -- bitwise "or" on permissions between various paths
    from
      "assignment_edge" as "the_assignment"
    join
      "role_edge_cache" as "the_edge_cache"
    on
      "the_assignment"."role_id" = "the_edge_cache"."parent_id"
    where "the_assignment"."resource_id" in (select "resource_id" from "p9s_new_rows")
    group by ("the_assignment"."resource_id", "the_edge_cache"."child_id");
  return null;
end;
$$ language plpgsql security definer set search_path = "public", pg_temp;


revoke execute on function "assignment_edge_insert_trigger_function" () from public;




drop trigger if exists "10_assignment_edge_insert_trigger" on "assignment_edge";
create trigger "10_assignment_edge_insert_trigger"
after insert on "assignment_edge"
referencing new table as "p9s_new_rows"
for each statement execute function "assignment_edge_insert_trigger_function"();



create or replace function "assignment_edge_update_trigger_function"()
returns trigger as $$
begin

  if not exists (select from "p9s_new_rows") then
    return null;
  end if;
  
  
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'p9s: permission graph writes must run in READ COMMITTED isolation, not %', current_setting('transaction_isolation');
  end if;
  perform pg_advisory_xact_lock(hashtext('p9s:public:'));

  delete from "assignment_edge_cache" where "resource_id" in (select "resource_id" from "p9s_old_rows" union select "resource_id" from "p9s_new_rows");
  insert into "assignment_edge_cache" ("role_id", "resource_id", "permission")
  
    select
      "the_edge_cache"."child_id" as "role_id",
      "the_assignment"."resource_id" as "resource_id",
      "or_bitmap_8" ("the_assignment"."permission" & "the_edge_cache"."permission") as "permission" -- bitwise "or" on permissions between various paths
    from
      "assignment_edge" as "the_assignment"
    join
      "role_edge_cache" as "the_edge_cache"
    on
      "the_assignment"."role_id" = "the_edge_cache"."parent_id"
    where "the_assignment"."resource_id" in (select "resource_id" from "p9s_old_rows" union select "resource_id" from "p9s_new_rows")
    group by ("the_assignment"."resource_id", "the_edge_cache"."child_id");
  return null;
end;
$$ language plpgsql security definer set search_path = "public", pg_temp;


revoke execute on function "assignment_edge_update_trigger_function" () from public;




drop trigger if exists "10_assignment_edge_update_trigger" on "assignment_edge";
create trigger "10_assignment_edge_update_trigger"
after update on "assignment_edge"
referencing old table as "p9s_old_rows" new table as "p9s_new_rows"
for each statement execute function "assignment_edge_update_trigger_function"();



create or replace function "assignment_edge_delete_trigger_function"()
returns trigger as $$
begin

  if not exists (select from "p9s_old_rows") then
    return null;
  end if;
  
  
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'p9s: permission graph writes must run in READ COMMITTED isolation, not %', current_setting('transaction_isolation');
  end if;
  perform pg_advisory_xact_lock(hashtext('p9s:public:'));

  delete from "assignment_edge_cache" where "resource_id" in (select "resource_id" from "p9s_old_rows");
  insert into "assignment_edge_cache" ("role_id", "resource_id", "permission")
  
    select
      "the_edge_cache"."child_id" as "role_id",
      "the_assignment"."resource_id" as "resource_id",
      "or_bitmap_8" ("the_assignment"."permission" & "the_edge_cache"."permission") as "permission" -- bitwise "or" on permissions between various paths
    from
      "assignment_edge" as "the_assignment"
    join
      "role_edge_cache" as "the_edge_cache"
    on
      "the_assignment"."role_id" = "the_edge_cache"."parent_id"
    where "the_assignment"."resource_id" in (select "resource_id" from "p9s_old_rows")
    group by ("the_assignment"."resource_id", "the_edge_cache"."child_id");
  return null;
end;
$$ language plpgsql security definer set search_path = "public", pg_temp;


revoke execute on function "assignment_edge_delete_trigger_function" () from public;




drop trigger if exists "10_assignment_edge_delete_trigger" on "assignment_edge";
create trigger "10_assignment_edge_delete_trigger"
after delete on "assignment_edge"
referencing old table as "p9s_old_rows"
for each statement execute function "assignment_edge_delete_trigger_function"();


-----------------------------------------------------------------------------------------------------------------------
-- Update cache when the 'role' transitive edge cache changes
-----------------------------------------------------------------------------------------------------------------------


create or replace function "assignment_edge_role_insert_trigger_function"()
returns trigger as $$
begin

  if not exists (select from "p9s_new_rows") then
    return null;
  end if;
  if not exists (
    select from "p9s_new_rows" as "the_edge_cache"
    where "the_edge_cache"."parent_id" <> "the_edge_cache"."child_id"
  ) and not exists (
    select from "p9s_new_rows" as "the_edge_cache"
    join "assignment_edge" as "the_assignment" on "the_assignment"."role_id" = "the_edge_cache"."parent_id"
  ) then
    return null;
  end if;
  
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'p9s: permission graph writes must run in READ COMMITTED isolation, not %', current_setting('transaction_isolation');
  end if;
  perform pg_advisory_xact_lock(hashtext('p9s:public:'));

  delete from "assignment_edge_cache" where "role_id" in (select "child_id" from "p9s_new_rows");
  insert into "assignment_edge_cache" ("role_id", "resource_id", "permission")
  
    select
      "the_edge_cache"."child_id" as "role_id",
      "the_assignment"."resource_id" as "resource_id",
      "or_bitmap_8" ("the_assignment"."permission" & "the_edge_cache"."permission") as "permission" -- bitwise "or" on permissions between various paths
    from
      "assignment_edge" as "the_assignment"
    join
      "role_edge_cache" as "the_edge_cache"
    on
      "the_assignment"."role_id" = "the_edge_cache"."parent_id"
    where "the_edge_cache"."child_id" in (select "child_id" from "p9s_new_rows")
    group by ("the_assignment"."resource_id", "the_edge_cache"."child_id");
  return null;
end;
$$ language plpgsql security definer set search_path = "public", pg_temp;


revoke execute on function "assignment_edge_role_insert_trigger_function" () from public;




drop trigger if exists "20_assignment_edge_role_insert_trigger" on "role_edge_cache";
create trigger "20_assignment_edge_role_insert_trigger"
after insert on "role_edge_cache"
referencing new table as "p9s_new_rows"
for each statement execute function "assignment_edge_role_insert_trigger_function"();



create or replace function "assignment_edge_role_update_trigger_function"()
returns trigger as $$
begin

  if not exists (select from "p9s_new_rows") then
    return null;
  end if;
  
  
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'p9s: permission graph writes must run in READ COMMITTED isolation, not %', current_setting('transaction_isolation');
  end if;
  perform pg_advisory_xact_lock(hashtext('p9s:public:'));

  delete from "assignment_edge_cache" where "role_id" in (select "child_id" from "p9s_old_rows" union select "child_id" from "p9s_new_rows");
  insert into "assignment_edge_cache" ("role_id", "resource_id", "permission")
  
    select
      "the_edge_cache"."child_id" as "role_id",
      "the_assignment"."resource_id" as "resource_id",
      "or_bitmap_8" ("the_assignment"."permission" & "the_edge_cache"."permission") as "permission" -- bitwise "or" on permissions between various paths
    from
      "assignment_edge" as "the_assignment"
    join
      "role_edge_cache" as "the_edge_cache"
    on
      "the_assignment"."role_id" = "the_edge_cache"."parent_id"
    where "the_edge_cache"."child_id" in (select "child_id" from "p9s_old_rows" union select "child_id" from "p9s_new_rows")
    group by ("the_assignment"."resource_id", "the_edge_cache"."child_id");
  return null;
end;
$$ language plpgsql security definer set search_path = "public", pg_temp;


revoke execute on function "assignment_edge_role_update_trigger_function" () from public;




drop trigger if exists "20_assignment_edge_role_update_trigger" on "role_edge_cache";
create trigger "20_assignment_edge_role_update_trigger"
after update on "role_edge_cache"
referencing old table as "p9s_old_rows" new table as "p9s_new_rows"
for each statement execute function "assignment_edge_role_update_trigger_function"();



create or replace function "assignment_edge_role_delete_trigger_function"()
returns trigger as $$
begin

  if not exists (select from "p9s_old_rows") then
    return null;
  end if;
  
  
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'p9s: permission graph writes must run in READ COMMITTED isolation, not %', current_setting('transaction_isolation');
  end if;
  perform pg_advisory_xact_lock(hashtext('p9s:public:'));

  delete from "assignment_edge_cache" where "role_id" in (select "child_id" from "p9s_old_rows");
  insert into "assignment_edge_cache" ("role_id", "resource_id", "permission")
  
    select
      "the_edge_cache"."child_id" as "role_id",
      "the_assignment"."resource_id" as "resource_id",
      "or_bitmap_8" ("the_assignment"."permission" & "the_edge_cache"."permission") as "permission" -- bitwise "or" on permissions between various paths
    from
      "assignment_edge" as "the_assignment"
    join
      "role_edge_cache" as "the_edge_cache"
    on
      "the_assignment"."role_id" = "the_edge_cache"."parent_id"
    where "the_edge_cache"."child_id" in (select "child_id" from "p9s_old_rows")
    group by ("the_assignment"."resource_id", "the_edge_cache"."child_id");
  return null;
end;
$$ language plpgsql security definer set search_path = "public", pg_temp;


revoke execute on function "assignment_edge_role_delete_trigger_function" () from public;




drop trigger if exists "20_assignment_edge_role_delete_trigger" on "role_edge_cache";
create trigger "20_assignment_edge_role_delete_trigger"
after delete on "role_edge_cache"
referencing old table as "p9s_old_rows"
for each statement execute function "assignment_edge_role_delete_trigger_function"();


-----------------------------------------------------------------------------------------------------------------------
-- Assignment functions to enable / disable triggers
-----------------------------------------------------------------------------------------------------------------------
create or replace function "assignment_trigger_enable"()
returns void as $$
  alter table "assignment_edge" enable trigger "10_assignment_edge_insert_trigger";
  alter table "assignment_edge" enable trigger "10_assignment_edge_update_trigger";
  alter table "assignment_edge" enable trigger "10_assignment_edge_delete_trigger";
  alter table "role_edge_cache" enable trigger "20_assignment_edge_role_insert_trigger";
  alter table "role_edge_cache" enable trigger "20_assignment_edge_role_update_trigger";
  alter table "role_edge_cache" enable trigger "20_assignment_edge_role_delete_trigger";
  -- Backfill cache
  select 1 from "assignment_edge_cache_backfill"();
$$ language sql security definer set search_path = "public", pg_temp;


revoke execute on function "assignment_trigger_enable" () from public;

grant execute on function "assignment_trigger_enable" () to "app_backend";

create or replace function "assignment_trigger_disable"()
returns void as $$
  alter table "assignment_edge" disable trigger "10_assignment_edge_insert_trigger";
  alter table "assignment_edge" disable trigger "10_assignment_edge_update_trigger";
  alter table "assignment_edge" disable trigger "10_assignment_edge_delete_trigger";
  alter table "role_edge_cache" disable trigger "20_assignment_edge_role_insert_trigger";
  alter table "role_edge_cache" disable trigger "20_assignment_edge_role_update_trigger";
  alter table "role_edge_cache" disable trigger "20_assignment_edge_role_delete_trigger";
$$ language sql security definer set search_path = "public", pg_temp;


revoke execute on function "assignment_trigger_disable" () from public;

grant execute on function "assignment_trigger_disable" () to "app_backend";

  


  
-----------------------------------------------------------------------------------------------------------------------
-- The graph as the current user sees it
-----------------------------------------------------------------------------------------------------------------------

create or replace function "current_role_node" ()
  returns uuid
  as $$
declare
  "the_user_id" uuid := "current_role_id"();
begin
  return coalesce(
    (select "the_leaf"."role_parent_id" from "public"."api_key" as "the_leaf" where "the_leaf"."role_id" = "the_user_id"),
    "the_user_id"
  );
end
$$ language plpgsql stable security definer set search_path = "public", pg_temp;


revoke execute on function "current_role_node" () from public;

grant execute on function "current_role_node" () to "app_user";
grant execute on function "current_role_node" () to "app_backend";

-- Every way the current user reaches a resource, with the bits it gives. A resource the user reaches several ways has
-- the OR of their bits.
create or replace view "current_resource_access" with (security_barrier) as
select
  "the_resource_edge"."child_id" as "resource_id",
  ("the_resource_edge"."permission" & "the_assignment_edge"."permission")::bit(8) as "permission"
from "resource_edge_cache" as "the_resource_edge"
join "assignment_edge_cache" as "the_assignment_edge" on "the_assignment_edge"."resource_id" = "the_resource_edge"."parent_id"
where "the_assignment_edge"."role_id" = (select "current_role_node"());

select pg_temp.p9s_set_privileges('"current_resource_access"'::regclass, array['app_user', 'app_backend']::text[], array[]::text[], array[]::text[]);

-- The resources the current user has a bit on, for each bit the policies check. Checking the bit on every segment
-- keeps only the edges that have it: a security barrier would only check it after the joins, as it is not leakproof.

create or replace view "current_resource_access_0" with (security_barrier) as
select
  "the_resource_edge"."child_id" as "resource_id"
from "resource_edge_cache" as "the_resource_edge"
join "assignment_edge_cache" as "the_assignment_edge" on "the_assignment_edge"."resource_id" = "the_resource_edge"."parent_id"
where "the_assignment_edge"."role_id" = (select "current_role_node"()) and ("the_resource_edge"."permission" << 0)::bit = b'1' and ("the_assignment_edge"."permission" << 0)::bit = b'1';

select pg_temp.p9s_set_privileges('"current_resource_access_0"'::regclass, array['app_user', 'app_backend']::text[], array[]::text[], array[]::text[]);

create or replace view "current_resource_access_1" with (security_barrier) as
select
  "the_resource_edge"."child_id" as "resource_id"
from "resource_edge_cache" as "the_resource_edge"
join "assignment_edge_cache" as "the_assignment_edge" on "the_assignment_edge"."resource_id" = "the_resource_edge"."parent_id"
where "the_assignment_edge"."role_id" = (select "current_role_node"()) and ("the_resource_edge"."permission" << 1)::bit = b'1' and ("the_assignment_edge"."permission" << 1)::bit = b'1';

select pg_temp.p9s_set_privileges('"current_resource_access_1"'::regclass, array['app_user', 'app_backend']::text[], array[]::text[], array[]::text[]);

create or replace view "current_resource_access_2" with (security_barrier) as
select
  "the_resource_edge"."child_id" as "resource_id"
from "resource_edge_cache" as "the_resource_edge"
join "assignment_edge_cache" as "the_assignment_edge" on "the_assignment_edge"."resource_id" = "the_resource_edge"."parent_id"
where "the_assignment_edge"."role_id" = (select "current_role_node"()) and ("the_resource_edge"."permission" << 2)::bit = b'1' and ("the_assignment_edge"."permission" << 2)::bit = b'1';

select pg_temp.p9s_set_privileges('"current_resource_access_2"'::regclass, array['app_user', 'app_backend']::text[], array[]::text[], array[]::text[]);

create or replace view "current_resource_access_3" with (security_barrier) as
select
  "the_resource_edge"."child_id" as "resource_id"
from "resource_edge_cache" as "the_resource_edge"
join "assignment_edge_cache" as "the_assignment_edge" on "the_assignment_edge"."resource_id" = "the_resource_edge"."parent_id"
where "the_assignment_edge"."role_id" = (select "current_role_node"()) and ("the_resource_edge"."permission" << 3)::bit = b'1' and ("the_assignment_edge"."permission" << 3)::bit = b'1';

select pg_temp.p9s_set_privileges('"current_resource_access_3"'::regclass, array['app_user', 'app_backend']::text[], array[]::text[], array[]::text[]);

create or replace view "current_resource_access_4" with (security_barrier) as
select
  "the_resource_edge"."child_id" as "resource_id"
from "resource_edge_cache" as "the_resource_edge"
join "assignment_edge_cache" as "the_assignment_edge" on "the_assignment_edge"."resource_id" = "the_resource_edge"."parent_id"
where "the_assignment_edge"."role_id" = (select "current_role_node"()) and ("the_resource_edge"."permission" << 4)::bit = b'1' and ("the_assignment_edge"."permission" << 4)::bit = b'1';

select pg_temp.p9s_set_privileges('"current_resource_access_4"'::regclass, array['app_user', 'app_backend']::text[], array[]::text[], array[]::text[]);

create or replace view "current_resource_access_6" with (security_barrier) as
select
  "the_resource_edge"."child_id" as "resource_id"
from "resource_edge_cache" as "the_resource_edge"
join "assignment_edge_cache" as "the_assignment_edge" on "the_assignment_edge"."resource_id" = "the_resource_edge"."parent_id"
where "the_assignment_edge"."role_id" = (select "current_role_node"()) and ("the_resource_edge"."permission" << 6)::bit = b'1' and ("the_assignment_edge"."permission" << 6)::bit = b'1';

select pg_temp.p9s_set_privileges('"current_resource_access_6"'::regclass, array['app_user', 'app_backend']::text[], array[]::text[], array[]::text[]);

create or replace view "current_resource_access_7" with (security_barrier) as
select
  "the_resource_edge"."child_id" as "resource_id"
from "resource_edge_cache" as "the_resource_edge"
join "assignment_edge_cache" as "the_assignment_edge" on "the_assignment_edge"."resource_id" = "the_resource_edge"."parent_id"
where "the_assignment_edge"."role_id" = (select "current_role_node"()) and ("the_resource_edge"."permission" << 7)::bit = b'1' and ("the_assignment_edge"."permission" << 7)::bit = b'1';

select pg_temp.p9s_set_privileges('"current_resource_access_7"'::regclass, array['app_user', 'app_backend']::text[], array[]::text[], array[]::text[]);


-- What was shared with the current user: the resources assigned to it and to the roles above it, with the bits these
-- assignments give, whatever is below these resources
create or replace view "current_assignment" with (security_barrier) as
select "the_assignment_edge"."resource_id", "the_assignment_edge"."permission"
from "assignment_edge_cache" as "the_assignment_edge"
where "the_assignment_edge"."role_id" = (select "current_role_node"());

select pg_temp.p9s_set_privileges('"current_assignment"'::regclass, array['app_user', 'app_backend']::text[], array[]::text[], array[]::text[]);

-- The edges of the resource cache between two resources the current user reaches, to tell what is below what. The
-- cache has a row for every ancestor, bits or not, so whoever reaches a resource reaches what is below it
create or replace view "current_resource_edge" with (security_barrier) as
select "the_edge"."parent_id", "the_edge"."child_id", "the_edge"."permission"
from "resource_edge_cache" as "the_edge"
where exists (select from "current_resource_access" as "the_access" where "the_access"."resource_id" = "the_edge"."parent_id");

select pg_temp.p9s_set_privileges('"current_resource_edge"'::regclass, array['app_user', 'app_backend']::text[], array[]::text[], array[]::text[]);

-- The roles the current user acts as: its role node and the roles above it, with the bits of the way up
create or replace view "current_role" with (security_barrier) as
select "the_edge"."parent_id" as "role_id", "the_edge"."permission"
from "role_edge_cache" as "the_edge"
where "the_edge"."child_id" = (select "current_role_node"());

select pg_temp.p9s_set_privileges('"current_role"'::regclass, array['app_user', 'app_backend']::text[], array[]::text[], array[]::text[]);

-- Who has access to a resource: every assignment that reaches it, from the resource itself or from above, with the
-- bits that reach it. For users with the manageAccess bit on the resource, and for the roles that can read the graph.
create or replace view "resource_access" with (security_barrier) as
select "the_resource_edge"."child_id" as "resource_id", "the_assignment_edge"."role_id",
  "the_assignment_edge"."resource_id" as "assigned_resource_id",
  ("the_resource_edge"."permission" & "the_assignment_edge"."permission")::bit(8) as "permission"
from "resource_edge_cache" as "the_resource_edge"
join "assignment_edge" as "the_assignment_edge" on "the_assignment_edge"."resource_id" = "the_resource_edge"."parent_id"
where (
  (select has_table_privilege(current_user, '"resource_edge_cache"'::regclass, 'select'))
  or (exists (select from "public"."document" as "the_row" where "the_row"."resource_id" = "the_resource_edge"."child_id") and (
    (pg_has_role(current_user, 'app_user', 'member') and exists (select from "current_resource_access_0" as "the_manager" where "the_manager"."resource_id" = "the_resource_edge"."child_id"))))
  or (exists (select from "public"."folder" as "the_row" where "the_row"."resource_id" = "the_resource_edge"."child_id") and (
    (pg_has_role(current_user, 'app_user', 'member') and exists (select from "current_resource_access_0" as "the_manager" where "the_manager"."resource_id" = "the_resource_edge"."child_id"))))
);

select pg_temp.p9s_set_privileges('"resource_access"'::regclass, array['app_user', 'app_backend']::text[], array[]::text[], array[]::text[]);

-- Every way any role reaches a resource, with the bits it gives, as the view of the current user has them for the
-- current user. A role leaf row has the ways of its parent.
create or replace view "resource_role_access" with (security_barrier) as
select "the_access"."resource_id", "the_access"."role_id", "the_access"."permission"
from (
  select "the_resource_edge"."child_id" as "resource_id", "the_assignment_edge"."role_id",
    ("the_resource_edge"."permission" & "the_assignment_edge"."permission")::bit(8) as "permission"
  from "resource_edge_cache" as "the_resource_edge"
  join "assignment_edge_cache" as "the_assignment_edge" on "the_assignment_edge"."resource_id" = "the_resource_edge"."parent_id"
  union all
  select "the_node_access"."resource_id", "the_leaf"."role_id", "the_node_access"."permission"
  from (
  select "the_resource_edge"."child_id" as "resource_id", "the_assignment_edge"."role_id",
    ("the_resource_edge"."permission" & "the_assignment_edge"."permission")::bit(8) as "permission"
  from "resource_edge_cache" as "the_resource_edge"
  join "assignment_edge_cache" as "the_assignment_edge" on "the_assignment_edge"."resource_id" = "the_resource_edge"."parent_id") as "the_node_access"
  join "public"."api_key" as "the_leaf" on "the_leaf"."role_parent_id" = "the_node_access"."role_id"
) as "the_access"
where (
  (select has_table_privilege(current_user, '"resource_edge_cache"'::regclass, 'select'))
  or (exists (select from "public"."document" as "the_row" where "the_row"."resource_id" = "the_access"."resource_id") and (
    (pg_has_role(current_user, 'app_user', 'member') and exists (select from "current_resource_access_0" as "the_manager" where "the_manager"."resource_id" = "the_access"."resource_id"))))
  or (exists (select from "public"."folder" as "the_row" where "the_row"."resource_id" = "the_access"."resource_id") and (
    (pg_has_role(current_user, 'app_user', 'member') and exists (select from "current_resource_access_0" as "the_manager" where "the_manager"."resource_id" = "the_access"."resource_id"))))
);

select pg_temp.p9s_set_privileges('"resource_role_access"'::regclass, array['app_user', 'app_backend']::text[], array[]::text[], array[]::text[]);


  
-----------------------------------------------------------------------------------------------------------------------
-- Table policies
-----------------------------------------------------------------------------------------------------------------------

create or replace function "resource_permission" ("the_resource_id" uuid)
  returns bit(8)
  as $$
begin
  return (
    select "or_bitmap_8" ("var_access"."permission") from "current_resource_access" as "var_access"
    where "var_access"."resource_id" = "the_resource_id"
  )::bit(8);
end
$$ language plpgsql stable set search_path = "public", pg_temp;


revoke execute on function "resource_permission" (uuid) from public;

grant execute on function "resource_permission" (uuid) to "app_user";
grant execute on function "resource_permission" (uuid) to "app_backend";

-- The permissions of any role, for users with the manageAccess bit on the resource and for graph writers
create or replace function "resource_permission" ("the_resource_id" uuid, "the_role_id" uuid)
  returns bit(8)
  as $$
begin
  return (
    select "or_bitmap_8" ("var_access"."permission") from "resource_role_access" as "var_access"
    where "var_access"."resource_id" = "the_resource_id" and "var_access"."role_id" = "the_role_id"
  )::bit(8);
end
$$ language plpgsql stable security invoker set search_path = "public", pg_temp;


revoke execute on function "resource_permission" (uuid, uuid) from public;

grant execute on function "resource_permission" (uuid, uuid) to "app_user";
grant execute on function "resource_permission" (uuid, uuid) to "app_backend";


create or replace function "document_resource_parent" ("the_key" "public"."document"."folder_id"%type)
  returns uuid
  as $$
  select "the_parent"."resource_id" from "public"."folder" as "the_parent" where "the_parent"."id" = $1
$$ language sql stable security definer set search_path = "public", pg_temp;


revoke execute on function "document_resource_parent" ("public"."document"."folder_id"%type) from public;

grant execute on function "document_resource_parent" ("public"."document"."folder_id"%type) to "app_user";


create or replace function "member_resource_parent" ("the_key" "public"."member"."org_id"%type)
  returns uuid
  as $$
  select "the_parent"."resource_id" from "public"."organization" as "the_parent" where "the_parent"."id" = $1
$$ language sql stable security definer set search_path = "public", pg_temp;


revoke execute on function "member_resource_parent" ("public"."member"."org_id"%type) from public;

grant execute on function "member_resource_parent" ("public"."member"."org_id"%type) to "app_user";


create or replace function "team_resource_parent" ("the_key" "public"."team"."org_id"%type)
  returns uuid
  as $$
  select "the_parent"."resource_id" from "public"."organization" as "the_parent" where "the_parent"."id" = $1
$$ language sql stable security definer set search_path = "public", pg_temp;


revoke execute on function "team_resource_parent" ("public"."team"."org_id"%type) from public;

grant execute on function "team_resource_parent" ("public"."team"."org_id"%type) to "app_user";


create or replace function "resource_parent_validate" ("the_parent" uuid, "the_child" uuid, "the_insert_bit" integer)
  returns boolean
  as $$
begin
  return "the_parent" is null
    or (exists (select from "resource_edge" as "var_edge" where "var_edge"."parent_id" = "the_parent" and "var_edge"."child_id" = "the_child")
      and exists (select from "current_resource_access" as "var_access" where "var_access"."resource_id" = "the_child" and position(b'1' in "var_access"."permission") > 0))
    or ("the_insert_bit" is not null and 
  exists (
    select from "current_resource_access" as "var_access"
    where "var_access"."resource_id" = "the_parent" and ("var_access"."permission" << "the_insert_bit")::bit = b'1'
  ));
end
$$ language plpgsql stable security definer set search_path = "public", pg_temp;


revoke execute on function "resource_parent_validate" (uuid, uuid, integer) from public;

grant execute on function "resource_parent_validate" (uuid, uuid, integer) to "app_user";



drop policy if exists "audit_event_app_user_select_policy" on "public"."audit_event";
create policy "audit_event_app_user_select_policy" on "public"."audit_event" 
as permissive for select to "app_user" 
using (
  exists (select from "current_resource_access_7" as "var_access" where "var_access"."resource_id" = "audit_event"."resource_parent_id")
)
;


drop policy if exists "audit_event_app_user_insert_policy" on "public"."audit_event";
create policy "audit_event_app_user_insert_policy" on "public"."audit_event"
as permissive for insert to "app_user"
with check (
  exists (select from "current_resource_access_7" as "var_access" where "var_access"."resource_id" = "audit_event"."resource_parent_id")
);


drop policy if exists "audit_event_app_user_update_policy" on "public"."audit_event";
create policy "audit_event_app_user_update_policy" on "public"."audit_event" 
as permissive for update to "app_user" 
using (
  exists (select from "current_resource_access_7" as "var_access" where "var_access"."resource_id" = "audit_event"."resource_parent_id")
)
with check (
  exists (select from "current_resource_access_7" as "var_access" where "var_access"."resource_id" = "audit_event"."resource_parent_id")
);


drop policy if exists "audit_event_app_user_delete_policy" on "public"."audit_event";
create policy "audit_event_app_user_delete_policy" on "public"."audit_event" 
as permissive for delete to "app_user" 
using (
  exists (select from "current_resource_access_7" as "var_access" where "var_access"."resource_id" = "audit_event"."resource_parent_id")
)
;


drop policy if exists "comment_app_user_select_policy" on "public"."comment";
create policy "comment_app_user_select_policy" on "public"."comment" 
as permissive for select to "app_user" 
using (
  exists (select from "current_resource_access_0" as "var_access" where "var_access"."resource_id" = "comment"."resource_parent_id")
)
;


drop policy if exists "comment_app_user_insert_policy" on "public"."comment";
create policy "comment_app_user_insert_policy" on "public"."comment"
as permissive for insert to "app_user"
with check (
  exists (select from "current_resource_access_4" as "var_access" where "var_access"."resource_id" = "comment"."resource_parent_id")
);


drop policy if exists "comment_app_user_update_policy" on "public"."comment";
create policy "comment_app_user_update_policy" on "public"."comment" 
as permissive for update to "app_user" 
using (
  exists (select from "current_resource_access_2" as "var_access" where "var_access"."resource_id" = "comment"."resource_parent_id")
)
with check (
  exists (select from "current_resource_access_2" as "var_access" where "var_access"."resource_id" = "comment"."resource_parent_id")
);


drop policy if exists "comment_app_user_delete_policy" on "public"."comment";
create policy "comment_app_user_delete_policy" on "public"."comment" 
as permissive for delete to "app_user" 
using (
  exists (select from "current_resource_access_3" as "var_access" where "var_access"."resource_id" = "comment"."resource_parent_id")
)
;


drop policy if exists "document_app_user_select_policy" on "public"."document";
create policy "document_app_user_select_policy" on "public"."document" 
as permissive for select to "app_user" 
using (
  exists (select from "current_resource_access_0" as "var_access" where "var_access"."resource_id" = "document"."resource_id")
)
;


drop policy if exists "document_app_user_insert_policy" on "public"."document";
create policy "document_app_user_insert_policy" on "public"."document"
as permissive for insert to "app_user"
with check (
  exists (select from "current_resource_access_1" as "var_access" where "var_access"."resource_id" = "document_resource_parent"("document"."folder_id"))
);


drop policy if exists "document_app_user_update_policy" on "public"."document";
create policy "document_app_user_update_policy" on "public"."document" 
as permissive for update to "app_user" 
using (
  exists (select from "current_resource_access_2" as "var_access" where "var_access"."resource_id" = "document"."resource_id")
)
with check (
  exists (select from "current_resource_access_2" as "var_access" where "var_access"."resource_id" = "document"."resource_id")
  and "resource_parent_validate"("document_resource_parent"("document"."folder_id"), "document"."resource_id", 1)
);


drop policy if exists "document_app_user_delete_policy" on "public"."document";
create policy "document_app_user_delete_policy" on "public"."document" 
as permissive for delete to "app_user" 
using (
  exists (select from "current_resource_access_3" as "var_access" where "var_access"."resource_id" = "document"."resource_id")
)
;


drop policy if exists "folder_app_user_select_policy" on "public"."folder";
create policy "folder_app_user_select_policy" on "public"."folder" 
as permissive for select to "app_user" 
using (
  exists (select from "current_resource_access_0" as "var_access" where "var_access"."resource_id" = "folder"."resource_id")
)
;


drop policy if exists "folder_app_user_insert_policy" on "public"."folder";
create policy "folder_app_user_insert_policy" on "public"."folder"
as permissive for insert to "app_user"
with check (
  exists (select from "current_resource_access_1" as "var_access" where "var_access"."resource_id" = "folder"."parent_resource_id")
);


drop policy if exists "folder_app_user_update_policy" on "public"."folder";
create policy "folder_app_user_update_policy" on "public"."folder" 
as permissive for update to "app_user" 
using (
  exists (select from "current_resource_access_2" as "var_access" where "var_access"."resource_id" = "folder"."resource_id")
)
with check (
  exists (select from "current_resource_access_2" as "var_access" where "var_access"."resource_id" = "folder"."resource_id")
  and "resource_parent_validate"("folder"."parent_resource_id", "folder"."resource_id", 1)
);


drop policy if exists "folder_app_user_delete_policy" on "public"."folder";
create policy "folder_app_user_delete_policy" on "public"."folder" 
as permissive for delete to "app_user" 
using (
  exists (select from "current_resource_access_3" as "var_access" where "var_access"."resource_id" = "folder"."resource_id")
)
;


drop policy if exists "member_app_user_select_policy" on "public"."member";
create policy "member_app_user_select_policy" on "public"."member" 
as permissive for select to "app_user" 
using (
  exists (select from "current_resource_access_6" as "var_access" where "var_access"."resource_id" = "member"."resource_id")
)
;


drop policy if exists "member_app_user_insert_policy" on "public"."member";
create policy "member_app_user_insert_policy" on "public"."member"
as permissive for insert to "app_user"
with check (
  exists (select from "current_resource_access_7" as "var_access" where "var_access"."resource_id" = "member_resource_parent"("member"."org_id"))
);


drop policy if exists "member_app_user_update_policy" on "public"."member";
create policy "member_app_user_update_policy" on "public"."member" 
as permissive for update to "app_user" 
using (
  exists (select from "current_resource_access_7" as "var_access" where "var_access"."resource_id" = "member"."resource_id")
)
with check (
  exists (select from "current_resource_access_7" as "var_access" where "var_access"."resource_id" = "member"."resource_id")
  and "resource_parent_validate"("member_resource_parent"("member"."org_id"), "member"."resource_id", 7)
);


drop policy if exists "member_app_user_delete_policy" on "public"."member";
create policy "member_app_user_delete_policy" on "public"."member" 
as permissive for delete to "app_user" 
using (
  exists (select from "current_resource_access_7" as "var_access" where "var_access"."resource_id" = "member"."resource_id")
)
;


drop policy if exists "organization_app_user_select_policy" on "public"."organization";
create policy "organization_app_user_select_policy" on "public"."organization" 
as permissive for select to "app_user" 
using (
  exists (select from "current_resource_access_6" as "var_access" where "var_access"."resource_id" = "organization"."resource_id")
)
;


drop policy if exists "organization_app_user_update_policy" on "public"."organization";
create policy "organization_app_user_update_policy" on "public"."organization" 
as permissive for update to "app_user" 
using (
  exists (select from "current_resource_access_7" as "var_access" where "var_access"."resource_id" = "organization"."resource_id")
)
with check (
  exists (select from "current_resource_access_7" as "var_access" where "var_access"."resource_id" = "organization"."resource_id")
);


drop policy if exists "organization_app_user_delete_policy" on "public"."organization";
create policy "organization_app_user_delete_policy" on "public"."organization" 
as permissive for delete to "app_user" 
using (
  exists (select from "current_resource_access_7" as "var_access" where "var_access"."resource_id" = "organization"."resource_id")
)
;


drop policy if exists "team_app_user_select_policy" on "public"."team";
create policy "team_app_user_select_policy" on "public"."team" 
as permissive for select to "app_user" 
using (
  exists (select from "current_resource_access_6" as "var_access" where "var_access"."resource_id" = "team"."resource_id")
)
;


drop policy if exists "team_app_user_insert_policy" on "public"."team";
create policy "team_app_user_insert_policy" on "public"."team"
as permissive for insert to "app_user"
with check (
  exists (select from "current_resource_access_7" as "var_access" where "var_access"."resource_id" = "team_resource_parent"("team"."org_id"))
);


drop policy if exists "team_app_user_update_policy" on "public"."team";
create policy "team_app_user_update_policy" on "public"."team" 
as permissive for update to "app_user" 
using (
  exists (select from "current_resource_access_7" as "var_access" where "var_access"."resource_id" = "team"."resource_id")
)
with check (
  exists (select from "current_resource_access_7" as "var_access" where "var_access"."resource_id" = "team"."resource_id")
  and "resource_parent_validate"("team_resource_parent"("team"."org_id"), "team"."resource_id", 7)
);


drop policy if exists "team_app_user_delete_policy" on "public"."team";
create policy "team_app_user_delete_policy" on "public"."team" 
as permissive for delete to "app_user" 
using (
  exists (select from "current_resource_access_7" as "var_access" where "var_access"."resource_id" = "team"."resource_id")
)
;

    
-----------------------------------------------------------------------------------------------------------------------
-- Enable RLS on tables
-----------------------------------------------------------------------------------------------------------------------

  alter table "public"."audit_event" enable row level security;
  

  alter table "public"."comment" enable row level security;
  

  alter table "public"."document" enable row level security;
  

  alter table "public"."folder" enable row level security;
  

  alter table "public"."member" enable row level security;
  

  alter table "public"."organization" enable row level security;
  

  alter table "public"."team" enable row level security;
  
-- Views of bits that policies have stopped checking
do $$
declare
  "the_view" text;
begin
  for "the_view" in
    select "viewname" from pg_views where "schemaname" = current_schema()
    and left("viewname", 24) = 'current_resource_access_'
    and substr("viewname", 25) ~ '^[0-9]+$'
    and not "viewname" = any (array['current_resource_access_0', 'current_resource_access_1', 'current_resource_access_2', 'current_resource_access_3', 'current_resource_access_4', 'current_resource_access_6', 'current_resource_access_7']::text[])
  loop
    execute format('drop view %I', "the_view");
  end loop;
end
$$;

-- Earlier versions mapped any role id, policies have stopped calling it by now
drop function if exists "current_role_node" (uuid);

    


  

  
-----------------------------------------------------------------------------------------------------------------------
-- Leaf tables
-----------------------------------------------------------------------------------------------------------------------

drop trigger if exists "10_document_resource_parent_trigger" on "public"."document";
drop trigger if exists "10_folder_resource_parent_trigger" on "public"."folder";
drop trigger if exists "10_member_resource_parent_trigger" on "public"."member";
drop trigger if exists "10_organization_resource_parent_trigger" on "public"."organization";
drop trigger if exists "10_team_resource_parent_trigger" on "public"."team";

do $$
begin
  if exists (select from pg_trigger where "tgrelid" = '"public"."audit_event"'::regclass and "tgname" = '10_audit_event_resource_insert_trigger') then
    perform pg_advisory_xact_lock(hashtext('p9s:public:'));
    if exists (select from "resource_edge" as "the_edge" join "public"."audit_event" as "the_row" on "the_edge"."parent_id" = "the_row"."resource_id") then
      raise exception 'p9s: rows of % are parents of other resources, so % cannot become a resource leaf table. Move their children first.', 'audit_event', 'audit_event'
        using errcode = 'dependent_objects_still_exist';
    end if;
    drop trigger "10_audit_event_resource_insert_trigger" on "public"."audit_event";
    drop trigger if exists "10_audit_event_resource_update_trigger" on "public"."audit_event";
    drop trigger if exists "10_audit_event_resource_delete_trigger" on "public"."audit_event";
    drop trigger if exists "05_truncate_guard_trigger" on "public"."audit_event";
    drop function if exists "audit_event_resource_trigger_function" ();
    -- Home edges can only be deleted with the triggers off. The bootstrap turns them back on.
    perform "resource_trigger_disable"();
    delete from "assignment_edge" as "the_assignment" using "public"."audit_event" as "the_row" where "the_assignment"."resource_id" = "the_row"."resource_id";
    delete from "resource_edge" as "the_edge" using "public"."audit_event" as "the_row" where "the_edge"."child_id" = "the_row"."resource_id";
  end if;
end
$$;

do $$
begin
  if exists (select from pg_trigger where "tgrelid" = '"public"."comment"'::regclass and "tgname" = '10_comment_resource_insert_trigger') then
    perform pg_advisory_xact_lock(hashtext('p9s:public:'));
    if exists (select from "resource_edge" as "the_edge" join "public"."comment" as "the_row" on "the_edge"."parent_id" = "the_row"."resource_id") then
      raise exception 'p9s: rows of % are parents of other resources, so % cannot become a resource leaf table. Move their children first.', 'comment', 'comment'
        using errcode = 'dependent_objects_still_exist';
    end if;
    drop trigger "10_comment_resource_insert_trigger" on "public"."comment";
    drop trigger if exists "10_comment_resource_update_trigger" on "public"."comment";
    drop trigger if exists "10_comment_resource_delete_trigger" on "public"."comment";
    drop trigger if exists "05_truncate_guard_trigger" on "public"."comment";
    drop function if exists "comment_resource_trigger_function" ();
    -- Home edges can only be deleted with the triggers off. The bootstrap turns them back on.
    perform "resource_trigger_disable"();
    delete from "assignment_edge" as "the_assignment" using "public"."comment" as "the_row" where "the_assignment"."resource_id" = "the_row"."resource_id";
    delete from "resource_edge" as "the_edge" using "public"."comment" as "the_row" where "the_edge"."child_id" = "the_row"."resource_id";
  end if;
end
$$;

create or replace function "audit_event_resource_parent_trigger_function"()
returns trigger as $$
begin
  new."resource_parent_id" := (select "the_parent"."resource_id" from "public"."organization" as "the_parent" where "the_parent"."id" = new."org_id");
  if new."org_id" is not null and new."resource_parent_id" is null then
    raise exception 'p9s: % rows have a % that matches no row of %', 'audit_event', 'org_id', 'organization'
      using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = "public", pg_temp;

revoke execute on function "audit_event_resource_parent_trigger_function" () from public;


drop trigger if exists "10_audit_event_resource_parent_trigger" on "public"."audit_event";
create trigger "10_audit_event_resource_parent_trigger" before insert or update of "org_id", "resource_parent_id" on "public"."audit_event" for each row execute function "audit_event_resource_parent_trigger_function"();
update "public"."audit_event" as "the_row" set "resource_parent_id" = "the_parent"."resource_id"
from "public"."organization" as "the_parent"
where "the_parent"."id" = "the_row"."org_id" and "the_row"."resource_parent_id" is distinct from "the_parent"."resource_id";

create or replace function "comment_resource_parent_trigger_function"()
returns trigger as $$
begin
  new."resource_parent_id" := (select "the_parent"."resource_id" from "public"."document" as "the_parent" where "the_parent"."id" = new."document_id");
  if new."document_id" is not null and new."resource_parent_id" is null then
    raise exception 'p9s: % rows have a % that matches no row of %', 'comment', 'document_id', 'document'
      using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = "public", pg_temp;

revoke execute on function "comment_resource_parent_trigger_function" () from public;


drop trigger if exists "10_comment_resource_parent_trigger" on "public"."comment";
create trigger "10_comment_resource_parent_trigger" before insert or update of "document_id", "resource_parent_id" on "public"."comment" for each row execute function "comment_resource_parent_trigger_function"();
update "public"."comment" as "the_row" set "resource_parent_id" = "the_parent"."resource_id"
from "public"."document" as "the_parent"
where "the_parent"."id" = "the_row"."document_id" and "the_row"."resource_parent_id" is distinct from "the_parent"."resource_id";

drop trigger if exists "10_member_role_parent_trigger" on "public"."member";
drop trigger if exists "10_organization_role_parent_trigger" on "public"."organization";
drop trigger if exists "10_team_role_parent_trigger" on "public"."team";

do $$
begin
  if exists (select from pg_trigger where "tgrelid" = '"public"."api_key"'::regclass and "tgname" = '10_api_key_role_insert_trigger') then
    perform pg_advisory_xact_lock(hashtext('p9s:public:'));
    if exists (select from "role_edge" as "the_edge" join "public"."api_key" as "the_row" on "the_edge"."parent_id" = "the_row"."role_id") then
      raise exception 'p9s: rows of % are parents of other roles, so % cannot become a role leaf table. Move their children first.', 'api_key', 'api_key'
        using errcode = 'dependent_objects_still_exist';
    end if;
    drop trigger "10_api_key_role_insert_trigger" on "public"."api_key";
    drop trigger if exists "10_api_key_role_update_trigger" on "public"."api_key";
    drop trigger if exists "10_api_key_role_delete_trigger" on "public"."api_key";
    drop trigger if exists "05_truncate_guard_trigger" on "public"."api_key";
    drop function if exists "api_key_role_trigger_function" ();
    -- Home edges can only be deleted with the triggers off. The bootstrap turns them back on.
    perform "role_trigger_disable"();
    delete from "assignment_edge" as "the_assignment" using "public"."api_key" as "the_row" where "the_assignment"."role_id" = "the_row"."role_id";
    delete from "role_edge" as "the_edge" using "public"."api_key" as "the_row" where "the_edge"."child_id" = "the_row"."role_id";
  end if;
end
$$;

create or replace function "api_key_role_parent_trigger_function"()
returns trigger as $$
begin
  if tg_op = 'UPDATE' then
    if new."role_id" is distinct from old."role_id" then
      raise exception 'p9s: the role id of a % row cannot change', 'api_key' using errcode = 'integrity_constraint_violation';
    end if;
  elsif exists (select from "role_edge_cache" as "the_self" where "the_self"."parent_id" = new."role_id" and "the_self"."child_id" = new."role_id") then
    raise exception 'p9s: the role id % is already used by another row', new."role_id" using errcode = 'unique_violation';
  end if;
  new."role_parent_id" := (select "the_parent"."role_id" from "public"."member" as "the_parent" where "the_parent"."id" = new."member_id");
  if new."member_id" is not null and new."role_parent_id" is null then
    raise exception 'p9s: % rows have a % that matches no row of %', 'api_key', 'member_id', 'member'
      using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = "public", pg_temp;

revoke execute on function "api_key_role_parent_trigger_function" () from public;


drop trigger if exists "10_api_key_role_parent_trigger" on "public"."api_key";
create trigger "10_api_key_role_parent_trigger" before insert or update of "role_id", "member_id", "role_parent_id" on "public"."api_key" for each row execute function "api_key_role_parent_trigger_function"();
update "public"."api_key" as "the_row" set "role_parent_id" = "the_parent"."role_id"
from "public"."member" as "the_parent"
where "the_parent"."id" = "the_row"."member_id" and "the_row"."role_parent_id" is distinct from "the_parent"."role_id";


  
-----------------------------------------------------------------------------------------------------------------------
-- Bootstrap caches
-----------------------------------------------------------------------------------------------------------------------
select "assignment_trigger_disable"();
select "resource_trigger_enable"();
select "role_trigger_enable"();
select "assignment_trigger_enable"();

  