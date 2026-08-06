-- Fifth-pass review: more SECURITY DEFINER writers that admitted facility_manager
-- (and sometimes trainer) without is_assigned_to_facility, while sibling RLS /
-- generate_class_checkin_token already require assignment.
--
-- 1. set_employee_checkin_pin
-- 2. checkin_via_kiosk_pin
-- 3. complete_training_class
-- 4. create_shift_report_entry

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
    or (
      v_employee.organization_id = public.current_org_id()
      and (
        public.current_role() = 'org_admin'
        or (
          public.current_role() = 'facility_manager'
          and v_employee.facility_id is not null
          and public.is_assigned_to_facility(v_employee.facility_id)
        )
      )
    )
  ), false) then
    raise exception 'not authorized to set a check-in PIN for this employee';
  end if;
  if p_pin !~ '^[0-9]{4,6}$' then
    raise exception 'PIN must be 4-6 digits' using errcode = 'invalid_parameter_value';
  end if;

  update public.employees set checkin_pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf')) where id = p_employee_id;
end;
$function$;

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
        and public.current_profile_active()
        and (public.current_role() = 'org_admin'
             or (public.current_role() = 'facility_manager'
                 and v_class.facility_id is not null
                 and public.is_assigned_to_facility(v_class.facility_id))
             or (public.current_role() = 'trainer' and v_class.trainer_profile_id = auth.uid()
                 and v_class.facility_id is not null
                 and public.is_assigned_to_facility(v_class.facility_id))))
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
        and public.current_profile_active()
        and (public.current_role() = 'org_admin'
             or (public.current_role() = 'facility_manager'
                 and v_class.facility_id is not null
                 and public.is_assigned_to_facility(v_class.facility_id))
             or (public.current_role() = 'trainer' and v_class.trainer_profile_id = auth.uid()
                 and v_class.facility_id is not null
                 and public.is_assigned_to_facility(v_class.facility_id))))
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
  if not coalesce((
    public.is_platform_admin()
    or (
      v_fac.organization_id = public.current_org_id()
      and (
        public.current_role() = 'org_admin'
        or (
          public.current_role() in ('facility_manager', 'trainer')
          and public.is_assigned_to_facility(v_fac.id)
        )
        or public.is_own_employee_assigned_to_facility(v_fac.id)
      )
    )
  ), false) then
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
