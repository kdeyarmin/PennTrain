-- Sweep remaining NULL-unsafe authorization guards.
--
-- Same class as 20260726150000_null_safe_authorization_guards.sql: `if not (<perm>)`
-- fails open when current_role()/current_org_id() return NULL for a deactivated
-- profile, because `not NULL` is NULL and PL/pgSQL skips the raise branch.
-- Wrap each auth guard in coalesce(..., false) so a deactivated caller is denied.
--
-- Auto-generated from live catalog (39 functions, 39 guards).

-- 1 guard(s) wrapped
CREATE OR REPLACE FUNCTION app_private.assert_completed_class_corrector(p_organization_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not coalesce((
    public.is_platform_admin()
    or (
      public.current_profile_active()
      and public.current_org_id() = p_organization_id
      and public.current_role() = 'org_admin'
    )
  ), false) then
    raise exception 'completed class correction requires an organization administrator'
      using errcode = '42501';
  end if;
  perform public.assert_identity_assurance('compliance_profile_admin');
end;
$function$;

-- 1 guard(s) wrapped
CREATE OR REPLACE FUNCTION app_private.assert_daily_ops_manager(p_facility_id uuid)
 RETURNS facilities
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_fac public.facilities%rowtype;
begin
  select * into v_fac from public.facilities where id = p_facility_id;
  if not found then raise exception 'Facility not found' using errcode = 'P0002'; end if;
  if not coalesce((public.is_platform_admin() or (v_fac.organization_id = public.current_org_id() and public.current_role() in ('org_admin','facility_manager') and public.is_assigned_to_facility(v_fac.id))), false) then
    raise exception 'Not authorized for daily operations at this facility' using errcode = '42501';
  end if;
  return v_fac;
end;
$function$;

-- 1 guard(s) wrapped
CREATE OR REPLACE FUNCTION public.assign_employee_to_shift(p_schedule_id uuid, p_employee_id uuid, p_shift_date date, p_shift_definition_id uuid, p_unit_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text)
 RETURNS shift_assignments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_schedule public.schedules%rowtype;
  v_shift public.shift_definitions%rowtype;
  v_assignment public.shift_assignments%rowtype;
begin
  select * into v_schedule from public.schedules where id = p_schedule_id for update;
  if not found then raise exception 'Schedule not found' using errcode = 'P0002'; end if;
  if not coalesce((
    public.is_platform_admin()
    or (v_schedule.organization_id = public.current_org_id()
      and public.current_role() in ('org_admin', 'facility_manager')
      and public.is_assigned_to_facility(v_schedule.facility_id))
  ), false) then raise exception 'Not authorized to edit this schedule' using errcode = '42501'; end if;
  if v_schedule.status <> 'draft' then raise exception 'Only draft schedules can be edited' using errcode = '55000'; end if;
  if p_shift_date < v_schedule.period_start or p_shift_date > v_schedule.period_end then
    raise exception 'Shift date is outside the schedule period' using errcode = '22023';
  end if;
  if not public.is_employee_assigned_to_facility(p_employee_id, v_schedule.facility_id) then
    raise exception 'Employee is not assigned to this facility' using errcode = '23514';
  end if;
  select * into v_shift from public.shift_definitions
  where id = p_shift_definition_id and facility_id = v_schedule.facility_id and is_active;
  if not found then raise exception 'Shift definition is not active for this facility' using errcode = '22023'; end if;
  if p_unit_id is not null and not exists (
    select 1 from public.facility_units u where u.id = p_unit_id and u.facility_id = v_schedule.facility_id and u.is_active
  ) then raise exception 'Unit is not active for this facility' using errcode = '22023'; end if;
  insert into public.shift_assignments(
    organization_id, schedule_id, facility_id, employee_id, unit_id,
    shift_definition_id, shift_date, start_time, end_time, status, source, notes
  ) values (
    v_schedule.organization_id, v_schedule.id, v_schedule.facility_id, p_employee_id, p_unit_id,
    v_shift.id, p_shift_date, v_shift.start_time, v_shift.end_time, 'scheduled', 'manual', nullif(btrim(p_notes), '')
  ) returning * into v_assignment;
  return v_assignment;
end;
$function$;

-- 1 guard(s) wrapped
CREATE OR REPLACE FUNCTION public.checkin_via_kiosk_pin(p_class_id uuid, p_employee_id uuid, p_pin text)
 RETURNS training_class_attendees
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_class record;
  v_employee record;
  v_attendee public.training_class_attendees;
begin
  select * into v_class from public.training_classes where id = p_class_id;
  if v_class is null then
    raise exception 'training class not found';
  end if;
  if v_class.status <> 'draft' then
    raise exception 'This class is no longer accepting check-ins.' using errcode = 'check_violation';
  end if;

  if not coalesce((
    public.is_platform_admin()
    or (v_class.organization_id = public.current_org_id()
        and (public.current_role() in ('org_admin','facility_manager')
             or (public.current_role() = 'trainer' and v_class.trainer_profile_id = auth.uid())))
  ), false) then
    raise exception 'not authorized to run kiosk check-in for this training class';
  end if;

  select * into v_employee from public.employees where id = p_employee_id and organization_id = v_class.organization_id;
  if v_employee is null or v_employee.checkin_pin_hash is null then
    raise exception 'Employee not found or no check-in PIN has been set' using errcode = 'no_data_found';
  end if;
  if extensions.crypt(p_pin, v_employee.checkin_pin_hash) != v_employee.checkin_pin_hash then
    raise exception 'Incorrect PIN' using errcode = 'invalid_password';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_class_id::text || ':' || p_employee_id::text));

  select * into v_attendee from public.training_class_attendees where class_id = p_class_id and employee_id = p_employee_id;

  if v_attendee is null then
    insert into public.training_class_attendees (class_id, employee_id, attended, checked_in_at, checkin_method)
    values (p_class_id, p_employee_id, true, now(), 'kiosk_pin')
    returning * into v_attendee;
  elsif v_attendee.checked_in_at is null then
    update public.training_class_attendees
    set attended = true, checked_in_at = now(), checkin_method = 'kiosk_pin'
    where id = v_attendee.id
    returning * into v_attendee;
  elsif v_attendee.checked_out_at is null then
    update public.training_class_attendees
    set checked_out_at = now()
    where id = v_attendee.id
    returning * into v_attendee;
  else
    raise exception 'This employee has already checked in and out for this class.' using errcode = 'data_exception';
  end if;

  return v_attendee;
end;
$function$;

-- 1 guard(s) wrapped
CREATE OR REPLACE FUNCTION public.clear_auto_filled_assignments(p_schedule_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_schedule public.schedules%rowtype;
  v_deleted integer;
begin
  select * into v_schedule from public.schedules where id = p_schedule_id;
  if v_schedule is null then
    raise exception 'schedule not found';
  end if;

  if not coalesce((
    public.is_platform_admin()
    or (v_schedule.organization_id = public.current_org_id()
        and public.current_role() in ('org_admin', 'facility_manager')
        and public.is_assigned_to_facility(v_schedule.facility_id))
  ), false) then
    raise exception 'not authorized to edit this schedule';
  end if;

  if v_schedule.status <> 'draft' then
    raise exception 'only draft schedules can be cleared';
  end if;

  delete from public.shift_assignments
    where schedule_id = p_schedule_id and source = 'auto_fill' and status = 'scheduled'
      and updated_at = created_at;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$function$;

-- 1 guard(s) wrapped
CREATE OR REPLACE FUNCTION public.complete_resident_compliance_item(p_item_id uuid, p_document_id uuid)
 RETURNS resident_compliance_items
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_item public.resident_compliance_items;
  v_document public.resident_documents;
  v_completed_date date := public.pa_today();
  v_updated public.resident_compliance_items;
  v_facility_type text;
  v_support_plan_citation_ref text;
begin
  select * into v_item from public.resident_compliance_items where id = p_item_id for update;
  if v_item.id is null then
    raise exception 'resident compliance item % not found', p_item_id using errcode = 'no_data_found';
  end if;

  if not coalesce((
    public.is_platform_admin()
    or (v_item.organization_id = public.current_org_id()
        and public.current_role() in ('org_admin', 'facility_manager')
        and public.is_assigned_to_facility(v_item.facility_id))
  ), false) then
    raise exception 'not authorized to complete this resident compliance item' using errcode = 'insufficient_privilege';
  end if;

  if v_item.status = 'compliant' and v_item.completed_date is not null then
    return v_item;
  end if;

  -- The document must exist, belong to the same resident, be linked to THIS item specifically
  -- (not just any state form on file for the resident), and be flagged as the actual state form.
  -- IS DISTINCT FROM (not <>) so a document with a null compliance_item_id -- e.g. uploaded via the
  -- generic per-resident Documents uploader without picking an item -- is correctly rejected instead
  -- of silently passing through three-valued-logic NULL comparison.
  select * into v_document from public.resident_documents where id = p_document_id;
  if v_document.id is null
     or v_document.resident_id is distinct from v_item.resident_id
     or v_document.compliance_item_id is distinct from p_item_id
     or v_document.is_state_form is not true then
    raise exception 'the state-approved DHS form for this item must be uploaded and attached before it can be marked complete -- no exception'
      using errcode = 'check_violation';
  end if;

  update public.resident_compliance_items
  set completed_date = v_completed_date, status = 'compliant'
  where id = p_item_id
  returning * into v_updated;

  if v_item.renewal_interval_days is not null then
    insert into public.resident_compliance_items
      (organization_id, facility_id, resident_id, item_type, due_date, renewal_interval_days, warning_days, grace_period_days)
    values
      (v_item.organization_id, v_item.facility_id, v_item.resident_id, v_item.item_type,
       v_completed_date + v_item.renewal_interval_days, v_item.renewal_interval_days, v_item.warning_days, v_item.grace_period_days);
  end if;

  if v_item.item_type in ('annual_reassessment', 'significant_change_reassessment')
     and not exists (select 1 from public.resident_compliance_items where triggered_by_item_id = p_item_id) then
    select facility_type into v_facility_type from public.facilities where id = v_item.facility_id;
    v_support_plan_citation_ref := case when v_facility_type = 'ALR' then '2800.224' else '2600.227' end;

    insert into public.resident_compliance_items
      (organization_id, facility_id, resident_id, item_type, due_date, renewal_interval_days, warning_days, grace_period_days, citation_topic_id, triggered_by_item_id)
    values
      (v_item.organization_id, v_item.facility_id, v_item.resident_id, 'support_plan_30day',
       v_completed_date + 30, null, 14, 0,
       (select id from public.dhs_citation_topics where citation_ref = v_support_plan_citation_ref),
       p_item_id);
  end if;

  return v_updated;
end;
$function$;

-- 1 guard(s) wrapped
CREATE OR REPLACE FUNCTION public.complete_training_class(p_class_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_class record;
  v_attendee record;
  v_record_id uuid;
  v_hours numeric;
begin
  select * into v_class from public.training_classes where id = p_class_id for update;
  if v_class is null then
    raise exception 'training class not found';
  end if;

  if not coalesce((
    public.is_platform_admin()
    or (v_class.organization_id = public.current_org_id()
        and (public.current_role() in ('org_admin','facility_manager')
             or (public.current_role() = 'trainer' and v_class.trainer_profile_id = auth.uid())))
  ), false) then
    raise exception 'not authorized to complete this training class';
  end if;

  for v_attendee in
    select * from public.training_class_attendees where class_id = p_class_id and attended = true and training_record_id is null
  loop
    v_hours := case
      when v_attendee.checked_in_at is not null and v_attendee.checked_out_at is not null
        then greatest(round(extract(epoch from (v_attendee.checked_out_at - v_attendee.checked_in_at)) / 3600.0, 2), 0)
      else v_class.duration_hours
    end;

    insert into public.employee_training_records (
      organization_id, facility_id, employee_id, training_type_id,
      completion_date, status, trainer_name, hours, completion_method
    )
    select
      v_class.organization_id, coalesce(v_class.facility_id, e.facility_id), v_attendee.employee_id, v_class.training_type_id,
      v_class.class_date, 'compliant',
      (select first_name || ' ' || last_name from public.profiles where id = v_class.trainer_profile_id),
      v_hours, 'in_person'
    from public.employees e where e.id = v_attendee.employee_id
    returning id into v_record_id;

    update public.training_class_attendees set training_record_id = v_record_id where id = v_attendee.id;
  end loop;

  update public.training_classes set status = 'completed' where id = p_class_id;

  perform public.recalculate_compliance_core(v_class.organization_id);
  perform public.resolve_stale_compliance_alerts(v_class.organization_id);
end;
$function$;

-- 1 guard(s) wrapped
CREATE OR REPLACE FUNCTION public.create_credential_renewal_submission(p_employee_id uuid, p_credential_id uuid, p_credential_document_id uuid, p_credential_type text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_employee public.employees%rowtype;
  v_id uuid;
begin
  select * into v_employee from public.employees where id = p_employee_id;
  if not found then raise exception 'Employee not found' using errcode = 'P0002'; end if;
  if not exists (
    select 1 from public.employee_credential_documents d
    where d.id = p_credential_document_id and d.employee_id = p_employee_id
      and (p_credential_id is null or d.credential_id = p_credential_id)
      and d.file_size between 1 and 10485760
      and lower(d.file_type) in ('application/pdf', 'image/jpeg', 'image/png')
  ) then
    raise exception 'Credential document must be a supported employee-owned file under 10 MB'
      using errcode = '23514';
  end if;
  if not coalesce((
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.id = v_employee.profile_id)
    or public.is_platform_admin()
    or public.current_org_id() = v_employee.organization_id and public.current_role() in ('org_admin','facility_manager')
  ), false) then
    raise exception 'Credential renewal submission is outside caller scope' using errcode = '42501';
  end if;
  insert into public.credential_renewal_submissions(
    organization_id, facility_id, employee_id, credential_id,
    credential_document_id, credential_type, submitted_by
  ) values (
    v_employee.organization_id, v_employee.facility_id, v_employee.id,
    p_credential_id, p_credential_document_id, p_credential_type,
    app_private.current_actor_profile_id()
  ) returning id into v_id;
  return v_id;
end;
$function$;

-- 1 guard(s) wrapped
CREATE OR REPLACE FUNCTION public.create_notification_template_version(p_organization_id uuid, p_template_key text, p_channel text, p_subject_template text, p_body_template text, p_allowed_variables text[] DEFAULT '{}'::text[], p_activate boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_id uuid;
  v_version integer;
  v_supersedes uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_organization_id is null then
    if not public.is_platform_admin() then
      raise exception 'Only platform_admin may manage global templates' using errcode = '42501';
    end if;
  elsif not coalesce((
    public.is_platform_admin()
    or (
      public.current_role() = 'org_admin'
      and public.current_org_id() = p_organization_id
    )
  ), false) then
    raise exception 'Template organization is outside the caller scope' using errcode = '42501';
  end if;
  if p_template_key is null or p_channel is null
     or p_channel not in ('email', 'sms')
     or p_template_key !~ '^[a-z][a-z0-9_]{1,79}$' then
    raise exception 'Invalid template key or channel' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    coalesce(p_organization_id::text, 'global') || ':' || p_template_key || ':' || p_channel,
    0
  ));

  select id, version into v_supersedes, v_version
  from public.notification_templates
  where organization_id is not distinct from p_organization_id
    and template_key = p_template_key
    and channel = p_channel
  order by version desc
  limit 1;
  v_version := coalesce(v_version, 0) + 1;

  if p_activate then
    update public.notification_templates
    set status = 'retired'
    where organization_id is not distinct from p_organization_id
      and template_key = p_template_key
      and channel = p_channel
      and status = 'active';
  end if;

  insert into public.notification_templates (
    organization_id, template_key, channel, version, status,
    subject_template, body_template, allowed_variables, supersedes_id,
    created_by, activated_by, activated_at
  ) values (
    p_organization_id, p_template_key, p_channel, v_version,
    case when p_activate then 'active' else 'draft' end,
    p_subject_template, p_body_template, coalesce(p_allowed_variables, '{}'::text[]),
    v_supersedes, auth.uid(), case when p_activate then auth.uid() end,
    case when p_activate then now() end
  ) returning id into v_id;

  return v_id;
end;
$function$;

-- 1 guard(s) wrapped
CREATE OR REPLACE FUNCTION public.create_shift_report_entry(p_facility_id uuid, p_unit_id uuid, p_shift_assignment_id uuid, p_resident_id uuid, p_category text, p_priority text, p_shift_period_start timestamp with time zone, p_shift_period_end timestamp with time zone, p_narrative text, p_follow_up_owner_profile_id uuid DEFAULT NULL::uuid, p_requires_acknowledgement boolean DEFAULT false, p_idempotency_key text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_fac public.facilities%rowtype; v_id uuid; v_work uuid; v_template uuid; v_key text := coalesce(nullif(btrim(p_idempotency_key), ''), 'shift-log:' || auth.uid()::text || ':' || extensions.gen_random_uuid()::text);
begin
  select * into v_fac from public.facilities where id = p_facility_id;
  if not found then raise exception 'Facility not found' using errcode='P0002'; end if;
  if p_priority not in ('low','normal','high','urgent') then raise exception 'Invalid priority' using errcode='22023'; end if;
  if not coalesce((public.is_platform_admin() or (v_fac.organization_id = public.current_org_id() and (public.current_role() in ('org_admin','facility_manager','trainer') or public.is_own_employee_assigned_to_facility(v_fac.id)))), false) then
    raise exception 'Not authorized to create shift report entry' using errcode='42501';
  end if;
  insert into public.shift_report_entries(organization_id, facility_id, unit_id, shift_assignment_id, resident_id, category, priority, shift_period_start, shift_period_end, narrative, author_profile_id, follow_up_owner_profile_id, requires_acknowledgement, idempotency_key)
  values(v_fac.organization_id, v_fac.id, p_unit_id, p_shift_assignment_id, p_resident_id, p_category, p_priority, p_shift_period_start, p_shift_period_end, btrim(p_narrative), auth.uid(), p_follow_up_owner_profile_id, p_requires_acknowledgement, v_key)
  on conflict (organization_id, idempotency_key) do update set updated_at = public.shift_report_entries.updated_at returning id into v_id;
  if p_priority in ('high','urgent') or p_requires_acknowledgement then
    select id into v_template from public.work_item_templates where (organization_id = v_fac.organization_id or organization_id is null) and template_key = 'daily_ops.shift_handoff' order by organization_id nulls last limit 1;
    insert into public.work_items(organization_id, facility_id, template_id, source_type, source_id, deduplication_key, title, description, owner_profile_id, priority, due_at, created_by)
    values(v_fac.organization_id, v_fac.id, v_template, 'rule_exception', v_id, 'shift-log:' || v_id::text, 'Urgent handoff: ' || replace(p_category,'_',' '), left(btrim(p_narrative), 500), p_follow_up_owner_profile_id, p_priority, now() + case when p_priority='urgent' then interval '1 hour' else interval '8 hours' end, auth.uid())
    on conflict (organization_id, deduplication_key) do update set updated_at=now() returning id into v_work;
    update public.shift_report_entries set linked_work_item_id = v_work where id = v_id;
  end if;
  return v_id;
end;
$function$;

-- 1 guard(s) wrapped
CREATE OR REPLACE FUNCTION public.create_work_order(p_facility_id uuid, p_problem_description text, p_inspection_item_id uuid DEFAULT NULL::uuid, p_maintenance_location_id uuid DEFAULT NULL::uuid, p_location_detail text DEFAULT NULL::text, p_room_number text DEFAULT NULL::text, p_safety_risk text DEFAULT 'low'::text, p_priority text DEFAULT 'routine'::text, p_temporary_protective_action text DEFAULT NULL::text, p_assigned_employee_id uuid DEFAULT NULL::uuid, p_external_vendor text DEFAULT NULL::text, p_target_completion_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_parts_needed text DEFAULT NULL::text, p_estimated_cost numeric DEFAULT NULL::numeric, p_resident_impact text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org uuid;
  v_id uuid;
begin
  select f.organization_id into v_org from public.facilities f where f.id = p_facility_id;
  if v_org is null then raise exception 'Facility not found' using errcode = 'P0002'; end if;
  if not coalesce((public.is_platform_admin() or (
    v_org = public.current_org_id()
    and public.current_role() in ('org_admin','facility_manager','trainer')
    and public.is_assigned_to_facility(p_facility_id)
  )), false) then raise exception 'Not authorized to create work orders' using errcode = '42501'; end if;
  if p_inspection_item_id is not null and not exists (
    select 1 from public.inspection_items i
    where i.id = p_inspection_item_id and i.facility_id = p_facility_id
  ) then raise exception 'Inspection item is outside the selected facility' using errcode = '23514'; end if;
  if p_maintenance_location_id is not null and not exists (
    select 1 from public.maintenance_locations l
    where l.id = p_maintenance_location_id and l.facility_id = p_facility_id
  ) then raise exception 'Maintenance location is outside the selected facility' using errcode = '23514'; end if;

  insert into public.work_orders(
    organization_id, facility_id, work_order_number, inspection_item_id,
    maintenance_location_id, location_detail, room_number, problem_description,
    safety_risk, priority, temporary_protective_action, assigned_employee_id,
    external_vendor, target_completion_at, parts_needed, estimated_cost,
    resident_impact, created_by_profile_id
  ) values (
    v_org, p_facility_id, 'pending', p_inspection_item_id,
    p_maintenance_location_id, nullif(btrim(p_location_detail), ''), nullif(btrim(p_room_number), ''),
    btrim(p_problem_description), p_safety_risk, p_priority,
    nullif(btrim(p_temporary_protective_action), ''), p_assigned_employee_id,
    nullif(btrim(p_external_vendor), ''), p_target_completion_at,
    nullif(btrim(p_parts_needed), ''), p_estimated_cost,
    nullif(btrim(p_resident_impact), ''), auth.uid()
  ) returning id into v_id;
  insert into public.work_order_history(
    organization_id, facility_id, work_order_id, event_type, resulting_status,
    actor_profile_id, notes
  ) values (v_org, p_facility_id, v_id, 'created', 'open', auth.uid(), 'Work order created');
  return v_id;
end;
$function$;

-- 1 guard(s) wrapped
CREATE OR REPLACE FUNCTION public.ensure_training_requirement_record(p_employee_id uuid, p_training_type_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_org uuid; v_fac uuid;
begin
  select organization_id, facility_id into v_org, v_fac from public.employees where id = p_employee_id;
  if v_org is null then
    raise exception 'employee % not found', p_employee_id using errcode = 'no_data_found';
  end if;
  if not coalesce((
    public.is_platform_admin()
    or (v_org = public.current_org_id() and public.current_role() in ('org_admin','facility_manager','trainer'))
  ), false) then
    raise exception 'not authorized' using errcode = 'insufficient_privilege';
  end if;

  insert into public.employee_training_records (organization_id, facility_id, employee_id, training_type_id, status, document_required)
  select v_org, v_fac, p_employee_id, tt.id, 'missing', tt.document_required
  from public.training_types tt
  where tt.id = p_training_type_id
    and not exists (
      select 1 from public.employee_training_records r
      where r.employee_id = p_employee_id and r.training_type_id = p_training_type_id
    );
end;
$function$;

-- 1 guard(s) wrapped
CREATE OR REPLACE FUNCTION public.finalize_resident_assessment_form(p_form_id uuid)
 RETURNS resident_assessment_forms
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_form public.resident_assessment_forms;
  v_updated public.resident_assessment_forms;
begin
  select * into v_form from public.resident_assessment_forms where id = p_form_id for update;
  if v_form.id is null then
    raise exception 'resident assessment form % not found', p_form_id using errcode = 'no_data_found';
  end if;

  if not coalesce((
    public.is_platform_admin()
    or (v_form.organization_id = public.current_org_id()
        and public.current_role() in ('org_admin', 'facility_manager')
        and public.is_assigned_to_facility(v_form.facility_id))
  ), false) then
    raise exception 'not authorized to finalize this assessment form' using errcode = 'insufficient_privilege';
  end if;

  if v_form.status = 'finalized' then
    return v_form;
  end if;

  perform public.assert_resident_assessment_compliance_item_valid(v_form.compliance_item_id, v_form.resident_id);

  update public.resident_assessment_forms
  set status = 'finalized', finalized_at = now()
  where id = p_form_id
  returning * into v_updated;

  if v_form.cloned_from_id is not null then
    update public.resident_assessment_forms set superseded_by_id = p_form_id where id = v_form.cloned_from_id;
  end if;

  return v_updated;
end;
$function$;

-- 1 guard(s) wrapped
CREATE OR REPLACE FUNCTION public.generate_class_checkin_token(p_class_id uuid, p_long_lived boolean DEFAULT false)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_class public.training_classes%rowtype;
  v_token text;
  v_not_before timestamptz;
begin
  select * into v_class from public.training_classes where id = p_class_id;
  if not found then raise exception 'training class not found' using errcode = 'P0002'; end if;
  if v_class.status not in ('scheduled', 'in_progress') then
    raise exception 'This class is no longer accepting check-ins.' using errcode = '23514';
  end if;
  if not coalesce((
    public.is_platform_admin()
    or (v_class.organization_id = public.current_org_id()
        and public.current_profile_active()
        and (public.current_role() = 'org_admin'
             or (public.current_role() = 'facility_manager' and public.is_assigned_to_facility(v_class.facility_id))
             or (public.current_role() = 'trainer' and v_class.trainer_profile_id = auth.uid()
                 and public.is_assigned_to_facility(v_class.facility_id))))
  ), false) then
    raise exception 'not authorized to run check-in for this training class' using errcode = '42501';
  end if;

  delete from public.class_checkin_tokens where expires_at < now() - interval '1 day';
  if p_long_lived then
    v_not_before := public.pa_midnight(v_class.class_date);
    if now() >= v_not_before + interval '1 day' then
      raise exception 'The class check-in window has ended.' using errcode = '22023';
    end if;
    update public.class_checkin_tokens
    set revoked_at = now()
    where class_id = p_class_id and token_kind = 'printed' and revoked_at is null;
  else
    v_not_before := now();
  end if;

  insert into public.class_checkin_tokens(class_id, token_kind, not_before, expires_at)
  values (
    p_class_id, case when p_long_lived then 'printed' else 'live' end, v_not_before,
    case when p_long_lived then v_not_before + interval '1 day' else now() + interval '45 seconds' end
  ) returning token into v_token;
  return v_token;
end;
$function$;

-- 1 guard(s) wrapped
CREATE OR REPLACE FUNCTION public.generate_schedule_assignments(p_schedule_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_schedule public.schedules%rowtype;
  v_inserted integer := 0;
  v_skipped integer := 0;
  v_day date;
  v_pref record;
begin
  select * into v_schedule from public.schedules where id = p_schedule_id;
  if v_schedule is null then
    raise exception 'schedule not found';
  end if;

  if not coalesce((
    public.is_platform_admin()
    or (v_schedule.organization_id = public.current_org_id()
        and public.current_role() in ('org_admin', 'facility_manager')
        and public.is_assigned_to_facility(v_schedule.facility_id))
  ), false) then
    raise exception 'not authorized to edit this schedule';
  end if;

  if v_schedule.status <> 'draft' then
    raise exception 'only draft schedules can be auto-filled';
  end if;

  for v_day in select generate_series(v_schedule.period_start, v_schedule.period_end, interval '1 day')::date loop
    for v_pref in
      select distinct on (esp.employee_id)
        esp.employee_id, esp.unit_id, esp.shift_definition_id, sd.start_time, sd.end_time
      from public.employee_schedule_preferences esp
      join public.shift_definitions sd on sd.id = esp.shift_definition_id and sd.is_active
      join public.employees e on e.id = esp.employee_id and e.status = 'active'
      join public.employee_facility_assignments efa
        on efa.employee_id = esp.employee_id and efa.facility_id = esp.facility_id
      where esp.facility_id = v_schedule.facility_id
        and esp.is_active
        and extract(dow from v_day)::smallint = any (esp.days_of_week)
      order by esp.employee_id, esp.priority desc, esp.created_at
    loop
      begin
        insert into public.shift_assignments (
          organization_id, schedule_id, facility_id, employee_id, unit_id, shift_definition_id,
          shift_date, start_time, end_time, status, source
        ) values (
          v_schedule.organization_id, v_schedule.id, v_schedule.facility_id, v_pref.employee_id, v_pref.unit_id,
          v_pref.shift_definition_id, v_day, v_pref.start_time, v_pref.end_time, 'scheduled', 'auto_fill'
        );
        v_inserted := v_inserted + 1;
      exception when unique_violation or exclusion_violation then
        v_skipped := v_skipped + 1;
      end;
    end loop;
  end loop;

  return jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped);
end;
$function$;

-- 1 guard(s) wrapped
CREATE OR REPLACE FUNCTION public.get_facility_benchmark_comparison(p_facility_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_facility public.facilities%rowtype;
  v_access jsonb;
  v_snapshot public.benchmark_snapshots%rowtype;
  v_training_rate numeric;
  v_renewal_days numeric;
  v_incidents_per_100 numeric;
  v_citation_topics jsonb;
begin
  select * into v_facility from public.facilities where id = p_facility_id;
  if v_facility.is_sandbox then return jsonb_build_object('available', false, 'reason', 'sandbox_excluded'); end if; if not found then raise exception 'Facility not found' using errcode = 'P0002'; end if;
  if not coalesce((public.is_platform_admin() or (
    v_facility.organization_id = public.current_org_id()
    and public.current_role() in ('org_admin','facility_manager','auditor')
    and (public.current_role() <> 'facility_manager' or public.is_assigned_to_facility(v_facility.id)))), false) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if not public.is_platform_admin() then
    v_access := public.evaluate_feature_access(v_facility.organization_id, 'analytics.cross_tenant_benchmarks');
    if coalesce((v_access->>'allowed')::boolean, false) is not true then
      raise exception 'Cross-tenant benchmarks are not released for this organization' using errcode = '42501';
    end if;
  end if;
  select * into v_snapshot from public.benchmark_snapshots
  where jurisdiction_code = 'US-' || upper(coalesce(nullif(v_facility.state,''), 'PA'))
    and facility_type = v_facility.facility_type
  order by period_end desc, generated_at desc limit 1;
  if v_facility.is_sandbox then return jsonb_build_object('available', false, 'reason', 'sandbox_excluded'); end if; if not found then return jsonb_build_object('available', false, 'reason', 'cohort_below_k_or_not_generated'); end if;

  select coalesce(100.0 * count(*) filter (where r.status = 'compliant') / nullif(count(*),0), 0)
    into v_training_rate from public.employee_training_records r where r.facility_id = v_facility.id;
  select coalesce(percentile_cont(0.5) within group (
      order by greatest(0, c.expiration_date - v_snapshot.period_end)), 0)
    into v_renewal_days from public.employee_credentials c
    where c.facility_id = v_facility.id and c.status in ('compliant','due_soon') and c.expiration_date is not null;
  select coalesce(100.0 * count(*) / nullif((select count(*) from public.residents r
      where r.facility_id = v_facility.id and r.status = 'active'),0), 0)
    into v_incidents_per_100 from public.incidents i
    where i.facility_id = v_facility.id
      and i.occurred_at >= v_snapshot.period_end - interval '1 year'
      and i.occurred_at < v_snapshot.period_end + interval '1 day';
  select coalesce(jsonb_agg(jsonb_build_object(
      'citationRef', topic.citation_ref,
      'title', topic.title,
      'violationCount', topic.violation_count
    ) order by topic.violation_count desc, topic.title), '[]'::jsonb)
    into v_citation_topics
  from (
    select ct.citation_ref, coalesce(ct.title, 'Uncategorized citation') as title,
      count(*)::integer as violation_count
    from public.dhs_violations v
    left join public.dhs_citation_topics ct on ct.id = v.citation_topic_id
    where v.facility_id = v_facility.id
      and v.inspection_date between v_snapshot.period_start and v_snapshot.period_end
    group by ct.citation_ref, ct.title
    order by count(*) desc, coalesce(ct.title, 'Uncategorized citation')
    limit 5
  ) topic;

  return jsonb_build_object('available', true, 'facilityId', v_facility.id,
    'cohort', jsonb_build_object('jurisdictionCode', v_snapshot.jurisdiction_code,
      'facilityType', v_snapshot.facility_type, 'organizationCount', v_snapshot.organization_count,
      'facilityCount', v_snapshot.facility_count, 'kThreshold', v_snapshot.k_threshold,
      'periodStart', v_snapshot.period_start, 'periodEnd', v_snapshot.period_end),
    'metrics', v_snapshot.metrics,
    'facilityMetrics', jsonb_build_object(
      'trainingComplianceRate', round(v_training_rate, 1),
      'medianCredentialRenewalDays', round(v_renewal_days, 0),
      'incidentsPer100OccupiedBeds', round(v_incidents_per_100, 1),
      'topCitationTopics', v_citation_topics),
    'generatedAt', v_snapshot.generated_at);
end;
$function$;

-- 1 guard(s) wrapped
CREATE OR REPLACE FUNCTION public.get_schedule_service_workload(p_schedule_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_schedule public.schedules%rowtype;
  v_summary jsonb;
  v_rows jsonb;
begin
  select * into v_schedule from public.schedules where id = p_schedule_id;
  if not found then raise exception 'Schedule not found' using errcode = 'P0002'; end if;
  if not coalesce((
    public.is_platform_admin()
    or (v_schedule.organization_id = public.current_org_id()
      and public.current_role() in ('org_admin', 'facility_manager', 'auditor')
      and public.is_assigned_to_facility(v_schedule.facility_id))
  ), false) then raise exception 'Not authorized to view service workload' using errcode = '42501'; end if;

  select jsonb_build_object(
    'activeResidents', count(*) filter (where r.status = 'active'),
    'securedUnitResidents', count(*) filter (where r.status = 'active' and (r.sdcu or ru.secured))
  ) into v_summary
  from public.residents r
  left join public.facility_beds b on b.id = r.bed_id
  left join public.facility_rooms fr on fr.id = b.room_id
  left join public.residential_units ru on ru.id = fr.residential_unit_id
  where r.facility_id = v_schedule.facility_id;

  select v_summary || jsonb_build_object(
    'supportPlanServices', count(*),
    'twoPersonTransfers', count(*) filter (where req.requires_two_staff),
    'escorts', count(*) filter (where lower(task.service_name || ' ' || req.service_code) like '%escort%'),
    'safetyChecks', count(*) filter (where lower(task.service_name || ' ' || req.service_code) similar to '%(safety|check|round)%'),
    'appointmentTransportationDemand', count(*) filter (
      where lower(task.service_name || ' ' || req.service_code) similar to '%(appointment|transport)%'
    )
  ) into v_summary
  from public.resident_service_task_instances task
  join public.resident_service_requirements req on req.id = task.requirement_id
  where task.facility_id = v_schedule.facility_id
    and task.status <> 'superseded'
    and task.scheduled_start < (v_schedule.period_end + 1)::timestamptz
    and task.scheduled_end > v_schedule.period_start::timestamptz;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.shift_date, x.unit_name, x.shift_name), '[]'::jsonb)
  into v_rows
  from (
    select
      d::date as shift_date,
      w.id as workload_profile_id,
      w.unit_id,
      coalesce(u.name, 'Facility-wide') as unit_name,
      w.shift_definition_id,
      sd.name as shift_name,
      w.minimum_staff,
      w.minimum_medication_qualified_staff,
      w.minimum_insulin_qualified_staff,
      w.minimum_first_aid_cpr_staff,
      w.minimum_trainer_supervisor_staff,
      w.secured_unit_coverage_required,
      w.escort_reserve_staff,
      count(sa.id) filter (where sa.status in ('scheduled', 'confirmed'))::integer as scheduled_staff,
      count(sa.id) filter (where sa.status in ('scheduled', 'confirmed') and e.administers_medications)::integer as medication_qualified_staff,
      count(sa.id) filter (where sa.status in ('scheduled', 'confirmed') and exists (
        select 1 from public.employee_qualifications eq
        join public.certification_definitions cd on cd.id = eq.certification_definition_id
        where eq.employee_id = e.id and eq.state = 'active'
          and eq.effective_from <= d::date + sd.start_time
          and (eq.effective_to is null or eq.effective_to > d::date + sd.start_time)
          and (eq.expires_at is null or eq.expires_at > d::date + sd.start_time)
          and cd.qualification_key similar to '%(insulin|diabetes)%'
      ))::integer as insulin_qualified_staff,
      count(sa.id) filter (where sa.status in ('scheduled', 'confirmed') and exists (
        select 1 from public.employee_qualifications eq
        join public.certification_definitions cd on cd.id = eq.certification_definition_id
        where eq.employee_id = e.id and eq.state = 'active'
          and eq.effective_from <= d::date + sd.start_time
          and (eq.effective_to is null or eq.effective_to > d::date + sd.start_time)
          and (eq.expires_at is null or eq.expires_at > d::date + sd.start_time)
          and cd.qualification_key similar to '%(first.aid|cpr)%'
      ))::integer as first_aid_cpr_staff,
      count(sa.id) filter (where sa.status in ('scheduled', 'confirmed')
        and (e.trainer_status or lower(coalesce(e.job_title, '')) similar to '%(supervisor|manager|administrator)%'))::integer
        as trainer_supervisor_staff
    from public.service_workload_profiles w
    join public.shift_definitions sd on sd.id = w.shift_definition_id
    left join public.facility_units u on u.id = w.unit_id
    cross join lateral generate_series(v_schedule.period_start, v_schedule.period_end, interval '1 day') d
    left join public.shift_assignments sa on sa.schedule_id = v_schedule.id
      and sa.shift_date = d::date and sa.shift_definition_id = w.shift_definition_id
      and sa.unit_id is not distinct from w.unit_id
    left join public.employees e on e.id = sa.employee_id
    where w.facility_id = v_schedule.facility_id
    group by d, w.id, u.name, sd.name
  ) x;
  return v_summary || jsonb_build_object(
    'coverageRows', v_rows,
    'coverageGapCount', (
      select count(*) from jsonb_array_elements(v_rows) row
      where (row->>'scheduled_staff')::integer < (row->>'minimum_staff')::integer
        or (row->>'medication_qualified_staff')::integer < (row->>'minimum_medication_qualified_staff')::integer
        or (row->>'insulin_qualified_staff')::integer < (row->>'minimum_insulin_qualified_staff')::integer
        or (row->>'first_aid_cpr_staff')::integer < (row->>'minimum_first_aid_cpr_staff')::integer
        or (row->>'trainer_supervisor_staff')::integer < (row->>'minimum_trainer_supervisor_staff')::integer
    )
  );
end;
$function$;

-- 1 guard(s) wrapped
CREATE OR REPLACE FUNCTION public.get_service_task_available_staff(p_task_id uuid)
 RETURNS TABLE(employee_id uuid, employee_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_task public.resident_service_task_instances%rowtype;
  v_employee public.employees%rowtype;
  v_role text := public.current_role();
begin
  select * into v_task from public.resident_service_task_instances where id = p_task_id;
  if not found then raise exception 'Service task not found' using errcode = 'P0002'; end if;
  select * into v_employee from public.employees e
  where e.profile_id = auth.uid() and e.status = 'active';
  if not coalesce((
    public.is_platform_admin()
    or (
      public.current_org_id() = v_task.organization_id
      and (
        v_role = 'org_admin'
        or (v_role = 'facility_manager' and public.is_assigned_to_facility(v_task.facility_id))
        or (
          v_role = 'employee'
          and v_employee.facility_id = v_task.facility_id
          and (v_task.assigned_employee_id is null or v_task.assigned_employee_id = v_employee.id)
        )
      )
    )
  ), false) then
    raise exception 'Service task is outside caller scope' using errcode = '42501';
  end if;
  return query
  select e.id, e.first_name || ' ' || e.last_name
  from public.employees e
  where e.organization_id = v_task.organization_id
    and e.facility_id = v_task.facility_id
    and e.status = 'active'
    and (v_employee.id is null or e.id <> v_employee.id)
  order by e.last_name, e.first_name;
end;
$function$;

-- 1 guard(s) wrapped
CREATE OR REPLACE FUNCTION public.get_workforce_retention_metrics(p_facility_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_org uuid := public.current_org_id(); v_result jsonb;
begin
  if not coalesce((public.is_platform_admin() or public.current_role() in ('org_admin','facility_manager','auditor')), false) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_facility_id is not null and not exists (
    select 1 from public.facilities f where f.id = p_facility_id
      and (public.is_platform_admin() or f.organization_id = v_org)
      and (public.current_role() <> 'facility_manager' or public.is_assigned_to_facility(f.id))
  ) then raise exception 'Facility not found or outside scope' using errcode = '42501'; end if;
  with scoped as (
    select ep.*, e.job_title
    from public.employment_episodes ep join public.employees e on e.id = ep.employee_id and not e.is_synthetic
    where ep.started_on <= public.pa_today()
      and (public.is_platform_admin() or ep.organization_id = v_org)
      and (p_facility_id is null or ep.facility_id = p_facility_id)
      and (public.current_role() <> 'facility_manager' or public.is_assigned_to_facility(ep.facility_id))
  ), roles as (
    select coalesce(job_title, 'Unspecified') as role,
      count(*) filter (where ended_on between public.pa_today() - 364 and public.pa_today())::integer as separations,
      count(*) filter (where ended_on is null or ended_on >= public.pa_today())::integer as current_headcount,
      count(*) filter (where started_on <= public.pa_today() - 364 and (ended_on is null or ended_on >= public.pa_today() - 364))::integer as starting_headcount,
      count(*) filter (where started_on between public.pa_today() - 455 and public.pa_today() - 90)::integer as ninety_day_cohort,
      count(*) filter (where started_on between public.pa_today() - 455 and public.pa_today() - 90
        and (ended_on is null or ended_on >= started_on + 90))::integer as ninety_day_retained,
      avg((least(coalesce(ended_on, public.pa_today()), public.pa_today()) - started_on)::numeric) as average_tenure_days
    from scoped group by coalesce(job_title, 'Unspecified')
  ), total as (
    select 'All roles'::text as role,
      count(*) filter (where ended_on between public.pa_today() - 364 and public.pa_today())::integer as separations,
      count(*) filter (where ended_on is null or ended_on >= public.pa_today())::integer as current_headcount,
      count(*) filter (where started_on <= public.pa_today() - 364 and (ended_on is null or ended_on >= public.pa_today() - 364))::integer as starting_headcount,
      count(*) filter (where started_on between public.pa_today() - 455 and public.pa_today() - 90)::integer as ninety_day_cohort,
      count(*) filter (where started_on between public.pa_today() - 455 and public.pa_today() - 90
        and (ended_on is null or ended_on >= started_on + 90))::integer as ninety_day_retained,
      avg((least(coalesce(ended_on, public.pa_today()), public.pa_today()) - started_on)::numeric) as average_tenure_days
    from scoped
  ), combined as (select * from total union all select * from roles)
  select jsonb_build_object('asOf', public.pa_today(), 'facilityId', p_facility_id,
    'methodology', jsonb_build_object('turnoverWindowDays',365,'retentionWindowDays',90,
      'turnoverDenominator','average of starting and current headcount'),
    'segments', coalesce(jsonb_agg(jsonb_build_object(
      'role', role, 'separations', separations, 'currentHeadcount', current_headcount,
      'annualizedTurnoverRate', round(100 * separations / nullif((starting_headcount + current_headcount)::numeric / 2, 0), 1),
      'ninetyDayCohort', ninety_day_cohort,
      'ninetyDayRetentionRate', round(100 * ninety_day_retained / nullif(ninety_day_cohort,0)::numeric, 1),
      'averageTenureDays', round(average_tenure_days, 0)
    ) order by case when role = 'All roles' then 0 else 1 end, role), '[]'::jsonb)) into v_result
  from combined;
  return v_result;
end;
$function$;

-- 1 guard(s) wrapped
CREATE OR REPLACE FUNCTION public.log_maintenance_document_access(p_document_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v public.maintenance_documents%rowtype;
begin
  select * into v from public.maintenance_documents where id = p_document_id;
  if not found then raise exception 'Document not found' using errcode = 'P0002'; end if;
  if not coalesce((public.is_platform_admin() or (
    v.organization_id = public.current_org_id()
    and public.current_role() in ('org_admin','facility_manager','trainer','auditor')
    and (public.current_role() in ('org_admin','auditor') or public.is_assigned_to_facility(v.facility_id))
  )), false) then raise exception 'Not authorized to access this document' using errcode = '42501'; end if;
  insert into public.audit_logs(organization_id, actor_profile_id, entity_type, entity_id, action)
  values(v.organization_id, auth.uid(), 'maintenance_documents', v.id::text, 'document_viewed');
end;
$function$;

-- 1 guard(s) wrapped
CREATE OR REPLACE FUNCTION public.preview_shift_assignment_candidates(p_schedule_id uuid, p_shift_date date, p_shift_definition_id uuid, p_unit_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_schedule public.schedules%rowtype;
  v_shift public.shift_definitions%rowtype;
  v_employee record;
  v_starts timestamptz;
  v_ends timestamptz;
  v_result jsonb;
  v_candidates jsonb[] := array[]::jsonb[];
begin
  select * into v_schedule from public.schedules where id = p_schedule_id;
  if not found then raise exception 'Schedule not found' using errcode = 'P0002'; end if;
  if not coalesce((
    public.is_platform_admin()
    or (v_schedule.organization_id = public.current_org_id()
      and public.current_role() in ('org_admin', 'facility_manager', 'auditor')
      and public.is_assigned_to_facility(v_schedule.facility_id))
  ), false) then raise exception 'Not authorized to preview this schedule' using errcode = '42501'; end if;
  if p_shift_date < v_schedule.period_start or p_shift_date > v_schedule.period_end then
    raise exception 'Shift date is outside the schedule period' using errcode = '22023';
  end if;
  select * into v_shift from public.shift_definitions
  where id = p_shift_definition_id and facility_id = v_schedule.facility_id and is_active;
  if not found then raise exception 'Shift definition is not active for this facility' using errcode = '22023'; end if;
  if p_unit_id is not null and not exists (
    select 1 from public.facility_units u where u.id = p_unit_id and u.facility_id = v_schedule.facility_id and u.is_active
  ) then raise exception 'Unit is not active for this facility' using errcode = '22023'; end if;
  v_starts := p_shift_date + v_shift.start_time;
  v_ends := p_shift_date + v_shift.end_time
    + case when v_shift.end_time <= v_shift.start_time then interval '1 day' else interval '0' end;
  for v_employee in
    select e.id, e.first_name, e.last_name, e.job_title
    from public.employee_facility_assignments a
    join public.employees e on e.id = a.employee_id
    where a.facility_id = v_schedule.facility_id
    order by e.last_name, e.first_name
  loop
    v_result := public.evaluate_shift_assignment_eligibility(
      v_employee.id, v_schedule.facility_id, p_unit_id, p_shift_definition_id,
      v_starts, v_ends, array[]::uuid[]
    );
    v_candidates := array_append(v_candidates, v_result || jsonb_build_object(
      'employeeId', v_employee.id,
      'employeeName', btrim(v_employee.first_name || ' ' || v_employee.last_name),
      'jobTitle', v_employee.job_title
    ));
  end loop;
  return to_jsonb(v_candidates);
end;
$function$;

-- 1 guard(s) wrapped
CREATE OR REPLACE FUNCTION public.publish_schedule(p_schedule_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_schedule public.schedules%rowtype;
begin
  select * into v_schedule from public.schedules where id = p_schedule_id for update;
  if v_schedule.id is null then
    raise exception 'Schedule not found' using errcode = 'P0002';
  end if;
  if not coalesce((
    public.is_platform_admin()
    or (
      v_schedule.organization_id = public.current_org_id()
      and public.current_role() in ('org_admin', 'facility_manager')
      and public.is_assigned_to_facility(v_schedule.facility_id)
    )
  ), false) then
    raise exception 'Not authorized to publish this schedule' using errcode = '42501';
  end if;
  if v_schedule.status = 'published' then return; end if;

  update public.schedules set status = 'published', published_at = now()
  where id = p_schedule_id;

  insert into public.notifications (
    organization_id, profile_id, notification_type, title, body, link
  )
  select distinct
    v_schedule.organization_id, e.profile_id, 'schedule_published',
    'Your schedule is available',
    'A work schedule containing one or more of your shifts was published.',
    '/me/schedule'
  from public.shift_assignments sa
  join public.employees e on e.id = sa.employee_id
  where sa.schedule_id = p_schedule_id
    and e.profile_id is not null
    and e.status = 'active';
end;
$function$;

-- 1 guard(s) wrapped
CREATE OR REPLACE FUNCTION public.recalculate_org_compliance(p_organization_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not coalesce((
    public.is_platform_admin()
    or (p_organization_id = public.current_org_id() and public.current_role() in ('org_admin','facility_manager'))
  ), false) then
    raise exception 'not authorized' using errcode = 'insufficient_privilege';
  end if;
  perform public.recalculate_compliance_core(p_organization_id);
end;
$function$;

-- 1 guard(s) wrapped
CREATE OR REPLACE FUNCTION public.record_shift_call_off(p_shift_assignment_id uuid, p_category text, p_reason text, p_partial_starts_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_partial_ends_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_shift public.shift_assignments%rowtype; v_emp public.employees%rowtype; v_req uuid; v_work uuid; v_template uuid;
begin
  if p_category not in ('illness','family_emergency','transportation','bereavement','jury_duty','weather','personal','other') then raise exception 'Invalid call-off category' using errcode='22023'; end if;
  select * into v_shift from public.shift_assignments where id = p_shift_assignment_id for update;
  if not found then raise exception 'Shift not found' using errcode='P0002'; end if;
  select * into v_emp from public.employees where id = v_shift.employee_id;
  if not coalesce((public.is_platform_admin() or v_emp.profile_id = auth.uid() or (v_shift.organization_id = public.current_org_id() and public.current_role() in ('org_admin','facility_manager') and public.is_assigned_to_facility(v_shift.facility_id))), false) then
    raise exception 'Not authorized to call off this shift' using errcode='42501';
  end if;
  insert into public.workforce_time_off_requests(organization_id, facility_id, employee_id, request_type, absence_category, starts_at, ends_at, status, reason, shift_assignment_id, requested_by, idempotency_key)
  values(v_shift.organization_id, v_shift.facility_id, v_shift.employee_id, case when p_partial_starts_at is null then 'call_off' else 'partial_shift_absence' end, p_category,
    coalesce(p_partial_starts_at, v_shift.shift_date + v_shift.start_time), coalesce(p_partial_ends_at, v_shift.shift_date + v_shift.end_time + case when v_shift.end_time <= v_shift.start_time then interval '1 day' else interval '0' end),
    'approved', nullif(btrim(p_reason), ''), v_shift.id, auth.uid(), 'call-off:' || v_shift.id::text)
  on conflict do nothing returning id into v_req;
  if v_req is null then select id into v_req from public.workforce_time_off_requests where shift_assignment_id = v_shift.id and request_type in ('call_off','partial_shift_absence') order by created_at desc limit 1; end if;
  update public.shift_assignments set status = 'called_off', updated_at = now(), notes = concat_ws(E'\n', notes, 'Call-off: ' || coalesce(nullif(btrim(p_reason), ''), p_category)) where id = v_shift.id;
  select id into v_template from public.work_item_templates where (organization_id = v_shift.organization_id or organization_id is null) and template_key = 'daily_ops.unfilled_shift' order by organization_id nulls last limit 1;
  insert into public.work_items(organization_id, facility_id, template_id, source_type, source_id, deduplication_key, title, description, owner_profile_id, priority, due_at, created_by)
  values(v_shift.organization_id, v_shift.facility_id, v_template, 'rule_exception', v_req, 'call-off:' || v_shift.id::text, 'Unfilled shift after call-off', coalesce(nullif(btrim(p_reason), ''), p_category), null, 'high', now() + interval '30 minutes', auth.uid())
  on conflict (organization_id, deduplication_key) do update set updated_at = now() returning id into v_work;
  insert into public.work_item_history(organization_id, facility_id, work_item_id, event_type, resulting_state, actor_profile_id, reason, evidence)
  values(v_shift.organization_id, v_shift.facility_id, v_work, 'created', 'open', auth.uid(), 'Call-off created unfilled-shift work', jsonb_build_object('shiftAssignmentId', v_shift.id, 'requestId', v_req));
  return v_req;
end;
$function$;

-- 1 guard(s) wrapped
CREATE OR REPLACE FUNCTION public.require_identity_administrator(p_organization_id uuid, p_operation text DEFAULT 'identity_admin'::text)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not coalesce((
    public.is_platform_admin()
    or (
      public.current_role() = 'org_admin'
      and public.current_org_id() = p_organization_id
    )
  ), false) then
    raise exception 'identity administrator access is required'
      using errcode = '42501';
  end if;
  perform public.assert_identity_assurance(p_operation);
end;
$function$;

-- 1 guard(s) wrapped
CREATE OR REPLACE FUNCTION public.rescan_org_exclusion_matches(p_organization_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not coalesce((
    public.is_platform_admin()
    or (p_organization_id = public.current_org_id() and public.current_role() in ('org_admin','facility_manager'))
  ), false) then
    raise exception 'not authorized' using errcode = 'insufficient_privilege';
  end if;
  perform public.match_exclusion_list_against_roster_core('oig_leie', p_organization_id);
  perform public.match_exclusion_list_against_roster_core('sam_exclusions', p_organization_id);
end;
$function$;

-- 1 guard(s) wrapped
CREATE OR REPLACE FUNCTION public.revoke_class_checkin_tokens(p_class_id uuid, p_reason text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_class public.training_classes%rowtype;
  v_changed integer;
begin
  select * into v_class from public.training_classes where id = p_class_id;
  if not found then raise exception 'training class not found' using errcode = 'P0002'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'A revocation reason of at least 10 characters is required' using errcode = '22023';
  end if;
  if not coalesce((
    public.is_platform_admin()
    or (v_class.organization_id = public.current_org_id() and public.current_profile_active()
        and (public.current_role() = 'org_admin'
             or (public.current_role() = 'facility_manager' and public.is_assigned_to_facility(v_class.facility_id))
             or (public.current_role() = 'trainer' and v_class.trainer_profile_id = auth.uid())))
  ), false) then raise exception 'not authorized' using errcode = '42501'; end if;
  update public.class_checkin_tokens set revoked_at = now()
  where class_id = p_class_id and revoked_at is null and expires_at >= now();
  get diagnostics v_changed = row_count;
  insert into public.audit_logs(organization_id, actor_profile_id, entity_type, entity_id, action, new_values)
  values (v_class.organization_id, auth.uid(), 'training_class', p_class_id::text,
          'checkin_tokens_revoked', jsonb_build_object('reason', btrim(p_reason), 'count', v_changed));
  return v_changed;
end;
$function$;

-- 1 guard(s) wrapped
CREATE OR REPLACE FUNCTION public.save_employee_credential(p_credential_id uuid DEFAULT NULL::uuid, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS employee_credentials
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_existing public.employee_credentials%rowtype;
  v_employee public.employees%rowtype;
  v_result public.employee_credentials%rowtype;
  v_employee_id uuid;
  v_status text;
  v_type text;
begin
  if auth.uid() is null or jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object' then
    raise exception 'A signed-in user and credential payload are required' using errcode = '42501';
  end if;

  if p_credential_id is not null then
    select * into v_existing from public.employee_credentials
    where id = p_credential_id for update;
    if not found then raise exception 'Credential not found' using errcode = 'P0002'; end if;
    if p_payload ? 'employee_id'
       and (p_payload ->> 'employee_id')::uuid is distinct from v_existing.employee_id then
      raise exception 'Credential cannot be reassigned' using errcode = '23514';
    end if;
    v_employee_id := v_existing.employee_id;
    v_type := case when p_payload ? 'credential_type'
      then p_payload ->> 'credential_type' else v_existing.credential_type end;
    v_status := case when p_payload ? 'status'
      then p_payload ->> 'status' else v_existing.status end;
  else
    v_employee_id := nullif(p_payload ->> 'employee_id', '')::uuid;
    v_type := nullif(btrim(p_payload ->> 'credential_type'), '');
    v_status := coalesce(nullif(p_payload ->> 'status', ''), 'missing');
  end if;

  select * into v_employee from public.employees where id = v_employee_id;
  if not found then raise exception 'Employee not found' using errcode = '23503'; end if;
  if not coalesce((
    public.is_platform_admin()
    or (
      v_employee.organization_id = public.current_org_id()
      and public.current_role() in ('org_admin', 'facility_manager')
      and public.is_assigned_to_facility(v_employee.facility_id)
    )
  ), false) then
    raise exception 'Not authorized to manage this credential' using errcode = '42501';
  end if;
  if v_type is null then raise exception 'Credential type is required' using errcode = '22023'; end if;
  if v_status not in ('compliant','due_soon','expired','missing','not_applicable') then
    raise exception 'Invalid credential status' using errcode = '22023';
  end if;

  if p_credential_id is null then
    insert into public.employee_credentials(
      organization_id, facility_id, employee_id, credential_type, credential_label,
      issuing_authority, credential_number, issue_date, expiration_date,
      last_verified_date, warning_days, status, verification_method,
      verified_by_profile_id, verified_at, notes, citation_topic_id
    ) values (
      v_employee.organization_id, v_employee.facility_id, v_employee.id, v_type,
      nullif(p_payload ->> 'credential_label', ''),
      nullif(p_payload ->> 'issuing_authority', ''),
      nullif(p_payload ->> 'credential_number', ''),
      nullif(p_payload ->> 'issue_date', '')::date,
      nullif(p_payload ->> 'expiration_date', '')::date,
      case when v_status = 'missing' then null else public.pa_today() end,
      coalesce(nullif(p_payload ->> 'warning_days', '')::integer, 90), v_status,
      case when v_status = 'missing' then null else nullif(p_payload ->> 'verification_method', '') end,
      case when v_status = 'missing' then null else auth.uid() end,
      case when v_status = 'missing' then null else now() end,
      nullif(p_payload ->> 'notes', ''),
      nullif(p_payload ->> 'citation_topic_id', '')::uuid
    ) returning * into v_result;
  else
    update public.employee_credentials c set
      credential_type = v_type,
      credential_label = case when p_payload ? 'credential_label' then nullif(p_payload ->> 'credential_label', '') else c.credential_label end,
      issuing_authority = case when p_payload ? 'issuing_authority' then nullif(p_payload ->> 'issuing_authority', '') else c.issuing_authority end,
      credential_number = case when p_payload ? 'credential_number' then nullif(p_payload ->> 'credential_number', '') else c.credential_number end,
      issue_date = case when p_payload ? 'issue_date' then nullif(p_payload ->> 'issue_date', '')::date else c.issue_date end,
      expiration_date = case when p_payload ? 'expiration_date' then nullif(p_payload ->> 'expiration_date', '')::date else c.expiration_date end,
      warning_days = case when p_payload ? 'warning_days' then (p_payload ->> 'warning_days')::integer else c.warning_days end,
      status = v_status,
      verification_method = case
        when v_status = 'missing' then null
        when p_payload ? 'verification_method' then nullif(p_payload ->> 'verification_method', '')
        else c.verification_method end,
      last_verified_date = case when v_status = 'missing' then null else public.pa_today() end,
      verified_by_profile_id = case when v_status = 'missing' then null else auth.uid() end,
      verified_at = case when v_status = 'missing' then null else now() end,
      notes = case when p_payload ? 'notes' then nullif(p_payload ->> 'notes', '') else c.notes end,
      citation_topic_id = case when p_payload ? 'citation_topic_id' then nullif(p_payload ->> 'citation_topic_id', '')::uuid else c.citation_topic_id end,
      updated_at = now()
    where c.id = p_credential_id
    returning * into v_result;
  end if;
  return v_result;
end;
$function$;

-- 1 guard(s) wrapped
CREATE OR REPLACE FUNCTION public.save_practicum(p_practicum_id uuid DEFAULT NULL::uuid, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS practicums
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_existing public.practicums%rowtype;
  v_candidate public.practicums%rowtype;
  v_result public.practicums%rowtype;
  v_employee public.employees%rowtype;
  v_role text := public.current_role();
begin
  if jsonb_typeof(p_payload) <> 'object' then
    raise exception 'practicum payload must be an object' using errcode = '22023';
  end if;

  if p_practicum_id is not null then
    select * into v_existing
    from public.practicums
    where id = p_practicum_id
    for update;
    if not found then
      raise exception 'practicum not found' using errcode = 'P0002';
    end if;
    v_candidate := jsonb_populate_record(v_existing, p_payload);
    v_candidate.id := v_existing.id;
    v_candidate.created_at := v_existing.created_at;
    if v_candidate.employee_id is distinct from v_existing.employee_id
       or v_candidate.practicum_year is distinct from v_existing.practicum_year then
      raise exception 'practicum identity fields cannot be changed' using errcode = '22023';
    end if;
  else
    v_candidate := jsonb_populate_record(null::public.practicums, p_payload);
    v_candidate.id := extensions.gen_random_uuid();
    v_candidate.mar_review_completed := false;
    v_candidate.direct_observation_completed := false;
    v_candidate.remediation_required := coalesce(v_candidate.remediation_required, false);
    v_candidate.reminder_days := coalesce(v_candidate.reminder_days, 30);
    v_candidate.status := coalesce(v_candidate.status, 'missing');
    v_candidate.created_at := now();
  end if;

  select * into v_employee
  from public.employees
  where id = v_candidate.employee_id;
  if not found or v_employee.status = 'terminated' then
    raise exception 'active employee not found' using errcode = '23503';
  end if;
  if not coalesce((
    public.is_platform_admin()
    or (
      v_employee.organization_id = public.current_org_id()
      and v_role in ('org_admin', 'facility_manager', 'trainer')
      and public.is_assigned_to_facility(v_employee.facility_id)
    )
  ), false) then
    raise exception 'not authorized to verify practicum evidence' using errcode = '42501';
  end if;

  if v_candidate.certificate_document_id is not null and not exists (
    select 1 from public.training_documents d
    where d.id = v_candidate.certificate_document_id
      and d.organization_id = v_employee.organization_id
      and d.employee_id = v_employee.id
  ) then
    raise exception 'practicum certificate is outside the employee scope' using errcode = '23514';
  end if;
  if v_candidate.observation_document_id is not null and not exists (
    select 1 from public.training_documents d
    where d.id = v_candidate.observation_document_id
      and d.organization_id = v_employee.organization_id
      and d.employee_id = v_employee.id
  ) then
    raise exception 'practicum observation is outside the employee scope' using errcode = '23514';
  end if;

  v_candidate.organization_id := v_employee.organization_id;
  v_candidate.facility_id := v_employee.facility_id;
  v_candidate.verified_by_profile_id := auth.uid();
  v_candidate.verified_at := now();
  v_candidate.updated_at := now();

  if p_practicum_id is null then
    insert into public.practicums
    select (v_candidate).*
    returning * into v_result;
  else
    update public.practicums p set
      employee_id = v_candidate.employee_id,
      practicum_year = v_candidate.practicum_year,
      completion_date = v_candidate.completion_date,
      observed_by = v_candidate.observed_by,
      remediation_required = v_candidate.remediation_required,
      remediation_notes = v_candidate.remediation_notes,
      notes = v_candidate.notes,
      due_date = v_candidate.due_date,
      status = v_candidate.status,
      verified_by_profile_id = v_candidate.verified_by_profile_id,
      verified_at = v_candidate.verified_at,
      reminder_days = v_candidate.reminder_days,
      certificate_document_id = v_candidate.certificate_document_id,
      observation_document_id = v_candidate.observation_document_id,
      window1_observation_date = v_candidate.window1_observation_date,
      window1_observation_by = v_candidate.window1_observation_by,
      window1_mar_review_date = v_candidate.window1_mar_review_date,
      window1_mar_review_by = v_candidate.window1_mar_review_by,
      window2_observation_date = v_candidate.window2_observation_date,
      window2_observation_by = v_candidate.window2_observation_by,
      window2_mar_review_date = v_candidate.window2_mar_review_date,
      window2_mar_review_by = v_candidate.window2_mar_review_by,
      window1_evidence_document_id = v_candidate.window1_evidence_document_id,
      window2_evidence_document_id = v_candidate.window2_evidence_document_id,
      updated_at = v_candidate.updated_at
    where p.id = p_practicum_id
    returning * into v_result;
  end if;
  return v_result;
end;
$function$;

-- 1 guard(s) wrapped
CREATE OR REPLACE FUNCTION public.save_training_record(p_record_id uuid DEFAULT NULL::uuid, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS employee_training_records
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_existing public.employee_training_records%rowtype;
  v_candidate public.employee_training_records%rowtype;
  v_result public.employee_training_records%rowtype;
  v_employee public.employees%rowtype;
  v_role text := public.current_role();
begin
  if jsonb_typeof(p_payload) <> 'object' then
    raise exception 'training record payload must be an object' using errcode = '22023';
  end if;

  if p_record_id is not null then
    select * into v_existing
    from public.employee_training_records
    where id = p_record_id
    for update;
    if not found then
      raise exception 'training record not found' using errcode = 'P0002';
    end if;
    v_candidate := jsonb_populate_record(v_existing, p_payload);
    v_candidate.id := v_existing.id;
    v_candidate.created_at := v_existing.created_at;
    if v_candidate.employee_id is distinct from v_existing.employee_id
       or v_candidate.training_type_id is distinct from v_existing.training_type_id then
      raise exception 'training record identity fields cannot be changed' using errcode = '22023';
    end if;
  else
    v_candidate := jsonb_populate_record(null::public.employee_training_records, p_payload);
    v_candidate.id := extensions.gen_random_uuid();
    v_candidate.status := coalesce(v_candidate.status, 'missing');
    v_candidate.document_required := coalesce(v_candidate.document_required, false);
    v_candidate.created_at := now();
  end if;

  select * into v_employee
  from public.employees
  where id = v_candidate.employee_id;
  if not found or v_employee.status = 'terminated' then
    raise exception 'active employee not found' using errcode = '23503';
  end if;
  if not exists (
    select 1 from public.training_types t
    where t.id = v_candidate.training_type_id
      and (t.organization_id is null or t.organization_id = v_employee.organization_id)
  ) then
    raise exception 'training type is outside the employee organization' using errcode = '23514';
  end if;
  if v_candidate.external_certificate_document_id is not null and not exists (
    select 1 from public.training_documents d
    where d.id = v_candidate.external_certificate_document_id
      and d.organization_id = v_employee.organization_id
      and d.employee_id = v_employee.id
  ) then
    raise exception 'training evidence document is outside the employee scope' using errcode = '23514';
  end if;

  if not coalesce((
    public.is_platform_admin()
    or (
      v_employee.organization_id = public.current_org_id()
      and v_role in ('org_admin', 'facility_manager', 'trainer')
      and public.is_assigned_to_facility(v_employee.facility_id)
    )
  ), false) then
    raise exception 'not authorized to write training evidence' using errcode = '42501';
  end if;

  v_candidate.organization_id := v_employee.organization_id;
  v_candidate.facility_id := v_employee.facility_id;
  v_candidate.updated_at := now();
  -- Caller-supplied verifier identity/timestamps are never authoritative. Every
  -- controlled write records the authenticated reviewer responsible for it.
  v_candidate.verified_by_profile_id := auth.uid();
  v_candidate.verified_at := now();

  if p_record_id is null then
    insert into public.employee_training_records
    select (v_candidate).*
    returning * into v_result;
  else
    update public.employee_training_records r set
      employee_id = v_candidate.employee_id,
      training_type_id = v_candidate.training_type_id,
      completion_date = v_candidate.completion_date,
      due_date = v_candidate.due_date,
      status = v_candidate.status,
      trainer_name = v_candidate.trainer_name,
      trainer_credentials = v_candidate.trainer_credentials,
      training_provider = v_candidate.training_provider,
      certificate_number = v_candidate.certificate_number,
      score = v_candidate.score,
      hours = v_candidate.hours,
      notes = v_candidate.notes,
      document_required = v_candidate.document_required,
      completion_method = v_candidate.completion_method,
      verified_by_profile_id = v_candidate.verified_by_profile_id,
      verified_at = v_candidate.verified_at,
      approval_status = v_candidate.approval_status,
      review_comments = v_candidate.review_comments,
      external_certificate_document_id = v_candidate.external_certificate_document_id,
      updated_at = v_candidate.updated_at
    where r.id = p_record_id
    returning * into v_result;
  end if;
  return v_result;
end;
$function$;

-- 1 guard(s) wrapped
CREATE OR REPLACE FUNCTION public.set_employee_checkin_pin(p_employee_id uuid, p_pin text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_employee record;
begin
  select * into v_employee from public.employees where id = p_employee_id;
  if v_employee is null then
    raise exception 'employee not found';
  end if;
  if not coalesce((
    public.is_platform_admin()
    or (v_employee.organization_id = public.current_org_id() and public.current_role() in ('org_admin','facility_manager'))
  ), false) then
    raise exception 'not authorized to set a check-in PIN for this employee';
  end if;
  if p_pin !~ '^[0-9]{4,6}$' then
    raise exception 'PIN must be 4-6 digits' using errcode = 'invalid_parameter_value';
  end if;

  update public.employees set checkin_pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf')) where id = p_employee_id;
end;
$function$;

-- 1 guard(s) wrapped
CREATE OR REPLACE FUNCTION public.start_resident_assessment_form(p_resident_id uuid, p_reason text, p_compliance_item_id uuid DEFAULT NULL::uuid)
 RETURNS resident_assessment_forms
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_res record;
  v_facility_type text;
  v_form_type text;
  v_prior public.resident_assessment_forms;
  v_new public.resident_assessment_forms;
  v_profile record;
  v_next_version integer;
  v_content jsonb;
begin
  select id, organization_id, facility_id into v_res from public.residents where id = p_resident_id;
  if v_res.id is null then
    raise exception 'resident % not found', p_resident_id using errcode = 'no_data_found';
  end if;

  if not coalesce((
    public.is_platform_admin()
    or (v_res.organization_id = public.current_org_id()
        and public.current_role() in ('org_admin', 'facility_manager')
        and public.is_assigned_to_facility(v_res.facility_id))
  ), false) then
    raise exception 'not authorized to start an assessment form for this resident' using errcode = 'insufficient_privilege';
  end if;

  select facility_type into v_facility_type from public.facilities where id = v_res.facility_id;
  v_form_type := case when v_facility_type = 'ALR' then 'ASP' else 'RASP' end;

  select * into v_prior from public.resident_assessment_forms
  where resident_id = p_resident_id and form_type = v_form_type and status = 'finalized'
  order by version_number desc limit 1;

  select first_name, last_name, role into v_profile from public.profiles where id = auth.uid();
  v_next_version := coalesce(v_prior.version_number, 0) + 1;

  v_content := coalesce(v_prior.content, '{}'::jsonb);
  v_content := v_content || jsonb_build_object(
    'assessmentInfo',
    coalesce(v_content->'assessmentInfo', '{}'::jsonb)
      || jsonb_build_object('assessmentReason', p_reason, 'supportPlanReason', p_reason)
  );

  insert into public.resident_assessment_forms
    (organization_id, facility_id, resident_id, compliance_item_id, form_type, reason,
     version_number, cloned_from_id, status, content, prepared_by_profile_id, prepared_by_name, prepared_by_title, prepared_date)
  values (
    v_res.organization_id, v_res.facility_id, v_res.id, p_compliance_item_id, v_form_type, p_reason,
    v_next_version, v_prior.id, 'draft',
    v_content,
    auth.uid(), coalesce(v_profile.first_name || ' ' || v_profile.last_name, ''), coalesce(v_profile.role, ''),
    public.pa_today()
  )
  returning * into v_new;

  return v_new;
end;
$function$;

-- 1 guard(s) wrapped
CREATE OR REPLACE FUNCTION public.submit_time_off_request(p_employee_id uuid, p_facility_id uuid, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_reason text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_emp public.employees%rowtype; v_id uuid; v_key text := coalesce(nullif(btrim(p_idempotency_key), ''), 'time-off:' || auth.uid()::text || ':' || p_employee_id::text || ':' || p_starts_at::text);
begin
  select * into v_emp from public.employees where id = p_employee_id;
  if not found then raise exception 'Employee not found' using errcode='P0002'; end if;
  if p_ends_at <= p_starts_at then raise exception 'Time-off end must be after start' using errcode='22023'; end if;
  if not coalesce((public.is_platform_admin() or (v_emp.profile_id = auth.uid()) or (v_emp.organization_id = public.current_org_id() and public.current_role() in ('org_admin','facility_manager') and public.is_assigned_to_facility(p_facility_id))), false) then
    raise exception 'Not authorized to request time off for this employee' using errcode='42501';
  end if;
  insert into public.workforce_time_off_requests(organization_id, facility_id, employee_id, request_type, starts_at, ends_at, reason, requested_by, idempotency_key)
  values(v_emp.organization_id, p_facility_id, p_employee_id, 'time_off', p_starts_at, p_ends_at, nullif(btrim(p_reason), ''), auth.uid(), v_key)
  on conflict do nothing returning id into v_id;
  if v_id is null then
    select id into v_id from public.workforce_time_off_requests where employee_id = p_employee_id and starts_at = p_starts_at and ends_at = p_ends_at and status = 'pending' order by created_at desc limit 1;
  end if;
  return v_id;
end;
$function$;

-- 1 guard(s) wrapped
CREATE OR REPLACE FUNCTION public.transition_work_order(p_work_order_id uuid, p_target_status text, p_notes text, p_actual_cost numeric DEFAULT NULL::numeric, p_downtime_started_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_downtime_ended_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v public.work_orders%rowtype;
  v_allowed boolean := false;
  v_is_assignee boolean := false;
begin
  select * into v from public.work_orders where id = p_work_order_id for update;
  if not found then raise exception 'Work order not found' using errcode = 'P0002'; end if;
  v_is_assignee := exists (
    select 1 from public.employees e where e.id = v.assigned_employee_id and e.profile_id = auth.uid()
  );
  if not coalesce((v_is_assignee or public.is_platform_admin() or (
    v.organization_id = public.current_org_id()
    and public.current_role() in ('org_admin','facility_manager','trainer')
    and public.is_assigned_to_facility(v.facility_id)
  )), false) then raise exception 'Not authorized to transition this work order' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_notes, ''))) < 3 then
    raise exception 'Transition notes are required' using errcode = '22023';
  end if;

  v_allowed := case v.status
    when 'open' then p_target_status in ('assigned','in_progress','on_hold','canceled')
    when 'assigned' then p_target_status in ('in_progress','on_hold','canceled')
    when 'in_progress' then p_target_status in ('on_hold','pending_verification','canceled')
    when 'on_hold' then p_target_status in ('in_progress','canceled')
    when 'pending_verification' then p_target_status = 'in_progress'
    when 'canceled' then p_target_status = 'open'
    else false
  end;
  if not v_allowed then
    raise exception 'Invalid work-order transition from % to %', v.status, p_target_status using errcode = '55000';
  end if;

  if p_target_status = 'pending_verification' then
    update public.work_orders set
      status = p_target_status,
      repair_notes = btrim(p_notes),
      actual_cost = p_actual_cost,
      downtime_started_at = coalesce(p_downtime_started_at, downtime_started_at),
      downtime_ended_at = p_downtime_ended_at,
      completed_by_profile_id = auth.uid(),
      completed_at = now()
    where id = v.id;
  else
    update public.work_orders set
      status = p_target_status,
      canceled_at = case when p_target_status = 'canceled' then now() else null end,
      completed_by_profile_id = case when v.status = 'pending_verification' then null else completed_by_profile_id end,
      completed_at = case when v.status = 'pending_verification' then null else completed_at end
    where id = v.id;
  end if;

  insert into public.work_order_history(
    organization_id, facility_id, work_order_id, event_type, prior_status,
    resulting_status, actor_profile_id, notes, metadata
  ) values (
    v.organization_id, v.facility_id, v.id,
    case when p_target_status = 'pending_verification' then 'submitted_for_verification'
         when v.status = 'pending_verification' then 'reopened' else 'transition' end,
    v.status, p_target_status, auth.uid(), btrim(p_notes),
    jsonb_build_object('actualCost', p_actual_cost, 'downtimeStartedAt', p_downtime_started_at, 'downtimeEndedAt', p_downtime_ended_at)
  );
  return true;
end;
$function$;

-- 1 guard(s) wrapped
CREATE OR REPLACE FUNCTION public.unpublish_course(p_course_id uuid, p_reason text)
 RETURNS courses
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_course public.courses%rowtype;
  v_reason text := btrim(coalesce(p_reason,''));
begin
  select * into v_course from public.courses where id = p_course_id for update;
  if v_course.id is null then raise exception 'Course not found' using errcode = 'P0002'; end if;
  if length(v_reason) < 8 then
    raise exception 'A reason of at least 8 characters is required' using errcode = '22023';
  end if;
  if not coalesce((
    public.is_platform_admin()
    or (
      v_course.organization_id = public.current_org_id()
      and public.current_role() = 'org_admin'
    )
  ), false) then raise exception 'Not authorized to unpublish this course' using errcode = '42501'; end if;
  perform public.assert_identity_assurance('course_unpublish');
  update public.courses set status = 'archived', updated_at = now()
  where id = p_course_id returning * into v_course;
  insert into public.audit_logs (
    organization_id, actor_profile_id, entity_type, entity_id, action, new_values
  ) values (
    v_course.organization_id, auth.uid(), 'course', p_course_id::text,
    'unpublished', jsonb_build_object('reason', v_reason)
  );
  return v_course;
end;
$function$;

-- 1 guard(s) wrapped
CREATE OR REPLACE FUNCTION public.unpublish_schedule(p_schedule_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_schedule public.schedules%rowtype;
begin
  select * into v_schedule from public.schedules where id = p_schedule_id for update;
  if v_schedule.id is null then raise exception 'Schedule not found' using errcode = 'P0002'; end if;
  if not coalesce((
    public.is_platform_admin()
    or (
      v_schedule.organization_id = public.current_org_id()
      and public.current_role() in ('org_admin','facility_manager')
      and public.is_assigned_to_facility(v_schedule.facility_id)
    )
  ), false) then raise exception 'Not authorized to unpublish this schedule' using errcode = '42501'; end if;
  perform public.assert_identity_assurance('schedule_unpublish');
  update public.schedules set status = 'draft', published_at = null
  where id = p_schedule_id;
  insert into public.audit_logs (
    organization_id, actor_profile_id, entity_type, entity_id, action
  ) values (
    v_schedule.organization_id, auth.uid(), 'schedule', p_schedule_id::text, 'unpublished'
  );
end;
$function$;

-- 1 guard(s) wrapped
CREATE OR REPLACE FUNCTION public.update_profile_contact_preferences(p_profile_id uuid, p_first_name text, p_last_name text, p_phone text, p_sms_opt_in boolean, p_preferred_notification_channel text)
 RETURNS SETOF profiles
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_target public.profiles%rowtype;
  v_phone text := nullif(btrim(p_phone), '');
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select * into v_target from public.profiles where id = p_profile_id for update;
  if v_target.id is null then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;
  if not coalesce((
    auth.uid() = v_target.id
    or public.is_platform_admin()
    or (
      public.current_role() = 'org_admin'
      and public.current_org_id() = v_target.organization_id
    )
    or (
      public.current_role() = 'facility_manager'
      and public.current_org_id() = v_target.organization_id
      and exists (
        select 1 from public.employees e
        where e.profile_id = v_target.id
          and e.organization_id = v_target.organization_id
          and public.is_assigned_to_facility(e.facility_id)
      )
    )
  ), false) then
    raise exception 'Profile is outside the caller scope' using errcode = '42501';
  end if;
  if nullif(btrim(p_first_name), '') is null
     or nullif(btrim(p_last_name), '') is null
     or p_sms_opt_in is null
     or p_preferred_notification_channel is null
     or p_preferred_notification_channel not in ('email', 'sms', 'web_push')
     or (p_sms_opt_in and v_phone is null)
     or (p_preferred_notification_channel = 'sms' and (not p_sms_opt_in or v_phone is null))
     or (p_preferred_notification_channel = 'web_push'
       and v_target.preferred_notification_channel is distinct from 'web_push'
       and not exists (
         select 1 from public.push_subscriptions s
         where s.profile_id = v_target.id and s.organization_id = v_target.organization_id
           and s.disabled_at is null
           and (s.expiration_time is null or s.expiration_time > now())
       )) then
    raise exception 'Invalid profile contact or notification preference' using errcode = '22023';
  end if;

  return query
  update public.profiles
  set first_name = btrim(p_first_name),
      last_name = btrim(p_last_name),
      phone = v_phone,
      sms_opt_in = p_sms_opt_in,
      sms_consent_at = case
        when p_sms_opt_in and (
          not v_target.sms_opt_in
          or public.notification_phone_key(v_target.phone)
            is distinct from public.notification_phone_key(v_phone)
        ) then now()
        else v_target.sms_consent_at
      end,
      sms_opt_out_at = case
        when p_sms_opt_in then null
        when v_target.sms_opt_in and not p_sms_opt_in then now()
        else v_target.sms_opt_out_at
      end,
      preferred_notification_channel = p_preferred_notification_channel
  where id = p_profile_id
  returning *;
end;
$function$;

-- 1 guard(s) wrapped
CREATE OR REPLACE FUNCTION public.update_work_order_details(p_work_order_id uuid, p_location_detail text, p_room_number text, p_safety_risk text, p_priority text, p_temporary_protective_action text, p_assigned_employee_id uuid, p_external_vendor text, p_target_completion_at timestamp with time zone, p_parts_needed text, p_estimated_cost numeric, p_resident_impact text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v public.work_orders%rowtype;
begin
  select * into v from public.work_orders where id = p_work_order_id for update;
  if not found then raise exception 'Work order not found' using errcode = 'P0002'; end if;
  if not coalesce((public.is_platform_admin() or (
    v.organization_id = public.current_org_id()
    and public.current_role() in ('org_admin','facility_manager','trainer')
    and public.is_assigned_to_facility(v.facility_id)
  )), false) then raise exception 'Not authorized to update work orders' using errcode = '42501'; end if;
  if v.status in ('verified','canceled') then
    raise exception 'Terminal work orders cannot be edited' using errcode = '55000';
  end if;
  update public.work_orders set
    location_detail = nullif(btrim(p_location_detail), ''),
    room_number = nullif(btrim(p_room_number), ''),
    safety_risk = p_safety_risk,
    priority = p_priority,
    temporary_protective_action = nullif(btrim(p_temporary_protective_action), ''),
    assigned_employee_id = p_assigned_employee_id,
    external_vendor = nullif(btrim(p_external_vendor), ''),
    target_completion_at = p_target_completion_at,
    parts_needed = nullif(btrim(p_parts_needed), ''),
    estimated_cost = p_estimated_cost,
    resident_impact = nullif(btrim(p_resident_impact), '')
  where id = v.id;
  insert into public.work_order_history(
    organization_id, facility_id, work_order_id, event_type, prior_status,
    resulting_status, actor_profile_id, notes
  ) values (v.organization_id, v.facility_id, v.id, 'updated', v.status, v.status, auth.uid(), 'Work-order details updated');
  return true;
end;
$function$;

-- 1 guard(s) wrapped
CREATE OR REPLACE FUNCTION public.verify_work_order(p_work_order_id uuid, p_decision text, p_verification_notes text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v public.work_orders%rowtype;
  v_verifier_name text;
begin
  select * into v from public.work_orders where id = p_work_order_id for update;
  if not found then raise exception 'Work order not found' using errcode = 'P0002'; end if;
  if v.status <> 'pending_verification' then
    raise exception 'Only work awaiting verification can be reviewed' using errcode = '55000';
  end if;
  if p_decision not in ('verified','reopened') or length(btrim(coalesce(p_verification_notes, ''))) < 3 then
    raise exception 'A valid verification decision and notes are required' using errcode = '22023';
  end if;
  if not coalesce((public.is_platform_admin() or (
    v.organization_id = public.current_org_id()
    and public.current_role() in ('org_admin','facility_manager')
    and public.is_assigned_to_facility(v.facility_id)
  )), false) then raise exception 'Supervisor verification is required' using errcode = '42501'; end if;

  if p_decision = 'verified' then
    update public.work_orders set
      status = 'verified', verified_by_profile_id = auth.uid(), verified_at = now(),
      verification_notes = btrim(p_verification_notes)
    where id = v.id;
    if v.source_inspection_event_id is not null then
      update public.inspection_events set
        follow_up_required = false,
        notes = concat_ws(E'\n', nullif(notes, ''), format('%s repair verified: %s', v.work_order_number, btrim(p_verification_notes)))
      where id = v.source_inspection_event_id;
    end if;
    if v.inspection_item_id is not null then
      select concat_ws(' ', p.first_name, p.last_name) into v_verifier_name
      from public.profiles p where p.id = auth.uid();
      insert into public.inspection_events(
        organization_id, facility_id, inspection_item_id, performed_date,
        performed_by, performed_by_profile_id, result, follow_up_required, notes
      ) values (
        v.organization_id, v.facility_id, v.inspection_item_id, public.pa_today(),
        coalesce(nullif(v_verifier_name, ''), 'Maintenance supervisor'), auth.uid(),
        'pass', false, format('%s verified after repair: %s', v.work_order_number, btrim(p_verification_notes))
      );
      update public.inspection_items i set
        last_inspected_date = public.pa_today(),
        next_due_date = public.pa_today() + i.inspection_interval_days,
        status = 'compliant'
      where i.id = v.inspection_item_id;
    end if;
  else
    update public.work_orders set
      status = 'in_progress', completed_by_profile_id = null, completed_at = null,
      verified_by_profile_id = null, verified_at = null,
      verification_notes = btrim(p_verification_notes)
    where id = v.id;
  end if;
  insert into public.work_order_history(
    organization_id, facility_id, work_order_id, event_type, prior_status,
    resulting_status, actor_profile_id, notes
  ) values (
    v.organization_id, v.facility_id, v.id,
    case when p_decision = 'verified' then 'verified' else 'reopened' end,
    v.status, case when p_decision = 'verified' then 'verified' else 'in_progress' end,
    auth.uid(), btrim(p_verification_notes)
  );
  return true;
end;
$function$;

