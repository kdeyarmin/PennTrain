-- Saved report views (END_USER_REVIEW.md recommendation #9, first slice).
--
-- Phase 5 shipped the saved/scheduled-reports schema (saved_report_definitions /
-- saved_report_versions / report_schedules / report_snapshots) with SELECT-only access
-- for authenticated users and no write RPCs at all -- a UI could read the tables but
-- nothing could ever populate them. This migration adds the caller-authorized write
-- surface for the part end users feel every week: SAVING a named report configuration
-- so it can be re-run in one click and shared with the organization.
--
-- Definitions follow the schema's versioning contract: every save publishes a new
-- immutable-config version (draft states are skipped -- a saved view is its own
-- publication), supersedes the previous current version, and carries a configuration
-- checksum. Scheduling execution, snapshot generation, and delivery remain unbuilt
-- platform work (the "trusted report worker" in PHASE5_OPERATIONS.md); report_schedules
-- and report_snapshots stay service_role-only until that worker exists.

create or replace function public.save_report_definition(
  p_name text,
  p_report_type text,
  p_filters jsonb default '{}'::jsonb,
  p_columns jsonb default '[]'::jsonb,
  p_time_zone text default 'UTC'
)
returns public.saved_report_definitions
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_profile public.profiles%rowtype;
  v_name text := btrim(coalesce(p_name, ''));
  v_definition public.saved_report_definitions%rowtype;
  v_version_number integer;
  v_config jsonb;
  v_sha text;
  v_version_id uuid;
begin
  select p.* into v_profile from public.profiles p where p.id = auth.uid();
  if v_profile.id is null or not v_profile.is_active
     or v_profile.role not in ('org_admin', 'facility_manager')
     or v_profile.organization_id is null then
    raise exception 'Saving report views is outside caller scope' using errcode = '42501';
  end if;
  if length(v_name) < 3 or length(v_name) > 120 then
    raise exception 'A report view name of 3-120 characters is required' using errcode = '22023';
  end if;
  if p_filters is null or jsonb_typeof(p_filters) <> 'object'
     or p_columns is null or jsonb_typeof(p_columns) <> 'array' then
    raise exception 'filters must be an object and columns an array' using errcode = '22023';
  end if;

  v_config := jsonb_build_object(
    'filters', p_filters,
    'columns', p_columns,
    'timeZone', coalesce(nullif(btrim(p_time_zone), ''), 'UTC')
  );
  v_sha := encode(extensions.digest(convert_to(v_config::text, 'utf8'), 'sha256'), 'hex');

  select d.* into v_definition
  from public.saved_report_definitions d
  where d.organization_id = v_profile.organization_id and d.name = v_name
  for update;

  if v_definition.id is null then
    insert into public.saved_report_definitions (organization_id, name, report_type, owner_profile_id)
    values (v_profile.organization_id, v_name, p_report_type, v_profile.id)
    returning * into v_definition;
    v_version_number := 1;
  else
    select coalesce(max(v.version_number), 0) + 1 into v_version_number
    from public.saved_report_versions v
    where v.report_definition_id = v_definition.id;
    update public.saved_report_versions
    set state = 'superseded'
    where id = v_definition.current_version_id and state = 'published';
  end if;

  insert into public.saved_report_versions (
    report_definition_id, organization_id, version_number,
    filters, columns, sort_spec, time_zone,
    configuration_sha256, state, created_by, published_at
  ) values (
    v_definition.id, v_profile.organization_id, v_version_number,
    p_filters, p_columns, '[]'::jsonb, coalesce(nullif(btrim(p_time_zone), ''), 'UTC'),
    v_sha, 'published', v_profile.id, now()
  )
  returning id into v_version_id;

  update public.saved_report_definitions
  set current_version_id = v_version_id,
      report_type = p_report_type,
      updated_at = now()
  where id = v_definition.id
  returning * into v_definition;

  return v_definition;
end;
$function$;
revoke all on function public.save_report_definition(text, text, jsonb, jsonb, text)
  from public, anon;
grant execute on function public.save_report_definition(text, text, jsonb, jsonb, text)
  to authenticated;

-- Deleting is reserved for the view's owner or an org_admin. Snapshots reference
-- versions with ON DELETE RESTRICT, so history captured by the future report worker
-- can never be deleted out from under an audit -- the delete simply fails then.
create or replace function public.delete_saved_report_definition(p_definition_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_profile public.profiles%rowtype;
  v_definition public.saved_report_definitions%rowtype;
begin
  select p.* into v_profile from public.profiles p where p.id = auth.uid();
  if v_profile.id is null or not v_profile.is_active then
    raise exception 'Deleting report views is outside caller scope' using errcode = '42501';
  end if;

  select d.* into v_definition
  from public.saved_report_definitions d
  where d.id = p_definition_id
  for update;
  if v_definition.id is null then
    raise exception 'Report view not found' using errcode = 'P0002';
  end if;
  if not (
    v_definition.organization_id = v_profile.organization_id
    and (v_profile.role = 'org_admin' or v_definition.owner_profile_id = v_profile.id)
  ) then
    raise exception 'Deleting report views is outside caller scope' using errcode = '42501';
  end if;

  -- current_version_id restricts deleting its version row; detach it first so the
  -- cascade from the definition can remove the version history.
  update public.saved_report_definitions set current_version_id = null where id = v_definition.id;
  delete from public.saved_report_definitions where id = v_definition.id;
  return true;
end;
$function$;
revoke all on function public.delete_saved_report_definition(uuid)
  from public, anon;
grant execute on function public.delete_saved_report_definition(uuid) to authenticated;
