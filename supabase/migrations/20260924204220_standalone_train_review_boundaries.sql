-- Resident directories and packets must observe product access inside definer RPCs.
-- Existing role, facility, clinical-consent and assurance checks remain in place.
create function app_private.assert_resident_product()
returns void language plpgsql stable security definer set search_path='' as $$
begin
  if not coalesce(app_private.has_resident_product(),false) then
    raise exception 'A resident product is required' using errcode='42501';
  end if;
end;
$$;
revoke all on function app_private.assert_resident_product() from public,anon,authenticated;

-- Both SQL readers and the administrative packet readers share these predicates.
do $migration$
declare v_name text; v_oid oid; v_body text; v_def text;
begin
  foreach v_name in array array['admission_row_visible','clinical_record_visible'] loop
    select p.oid,p.prosrc,pg_get_functiondef(p.oid) into strict v_oid,v_body,v_def
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='app_private' and p.proname=v_name;
    execute replace(v_def,v_body,' select app_private.has_resident_product() and (' || regexp_replace(v_body,';\s*$','') || '); ');
  end loop;
end;
$migration$;

-- Explicitly cover resident read entry points and the common resident-write guards.
-- Recreate the current definitions to retain later fixes, ownership and grants.
do $migration$
declare v_target record; v_def text; v_body text; v_new text;
begin
  for v_target in
    select p.oid,p.proname,p.prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='app_private' and p.proname in (
      'assert_admission_manager','assert_resident_care_manager','assert_resident_finance_manager',
      'assert_change_event_contributor','assert_dietary_contributor','assert_medication_scope',
      'assert_resident_portal_manager','assert_clinical_contributor','assert_clinical_integration_scope'))
    or (n.nspname='public' and p.proname in (
      'get_change_event_resident_options','get_resident_administrative_packet',
      'start_resident_assessment_form','get_schedule_service_workload',
      'get_resident_service_task_queue','get_resident_care_delivery_analytics','get_resident_service_utilization',
      'get_resident_clinical_observations','get_resident_clinical_chart','get_resident_clinical_care','get_resident_clinical_fhir'))
  loop
    v_body:=v_target.prosrc;
    v_new:=regexp_replace(v_body,'(\mbegin\M)',E'\\1\n  perform app_private.assert_resident_product();','i');
    if v_new=v_body then raise exception 'Missing entry block for %',v_target.proname; end if;
    v_def:=pg_get_functiondef(v_target.oid);
    execute replace(v_def,v_body,v_new);
  end loop;
end;
$migration$;

-- The shift workspace is a Workforce RPC with a resident-task subview. A Train
-- license cannot open it, and Workforce alone does not reveal resident tasks.
do $migration$
declare v_def text; v_body text; v_new text;
begin
  select p.prosrc,pg_get_functiondef(p.oid) into strict v_body,v_def
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='get_my_shift_workspace';
  v_new:=regexp_replace(v_body,'(\mbegin\M)',E'\\1\n' || $guard$  if not app_private.has_product_module('modules.workforce') then raise exception 'Workforce access required' using errcode='42501'; end if;$guard$,'i');
  if position('where t.assigned_employee_id = v_employee.id' in v_new)=0 then
    raise exception 'Shift workspace resident-task query has changed'; end if;
  v_new:=replace(v_new,'where t.assigned_employee_id = v_employee.id','where app_private.has_resident_product() and t.assigned_employee_id = v_employee.id');
  execute replace(v_def,v_body,v_new);
end;
$migration$;
