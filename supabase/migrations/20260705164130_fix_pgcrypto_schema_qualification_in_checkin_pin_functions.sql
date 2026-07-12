-- pgcrypto's functions (crypt/gen_salt) live in the `extensions` schema on this managed Postgres
-- instance, not `public` -- these two functions each `set search_path to 'public'`, so the bare
-- crypt()/gen_salt() calls failed to resolve at call time (discovered via manual RPC testing).
-- gen_random_bytes() in the class_checkin_tokens.token column DEFAULT was unaffected because
-- column defaults resolve function OIDs once at DDL time, not per-call against the calling
-- function's search_path.
create or replace function public.set_employee_checkin_pin(p_employee_id uuid, p_pin text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_employee record;
begin
  select * into v_employee from public.employees where id = p_employee_id;
  if v_employee is null then
    raise exception 'employee not found';
  end if;
  if not (
    public.is_platform_admin()
    or (v_employee.organization_id = public.current_org_id() and public.current_role() in ('org_admin','facility_manager'))
  ) then
    raise exception 'not authorized to set a check-in PIN for this employee';
  end if;
  if p_pin !~ '^[0-9]{4,6}$' then
    raise exception 'PIN must be 4-6 digits' using errcode = 'invalid_parameter_value';
  end if;

  update public.employees set checkin_pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf')) where id = p_employee_id;
end;
$$;

create or replace function public.checkin_via_kiosk_pin(p_class_id uuid, p_employee_id uuid, p_pin text)
returns public.training_class_attendees language plpgsql security definer set search_path to 'public' as $$
declare
  v_class record;
  v_employee record;
  v_attendee public.training_class_attendees;
begin
  select * into v_class from public.training_classes where id = p_class_id;
  if v_class is null then
    raise exception 'training class not found';
  end if;

  if not (
    public.is_platform_admin()
    or (v_class.organization_id = public.current_org_id()
        and (public.current_role() in ('org_admin','facility_manager')
             or (public.current_role() = 'trainer' and v_class.trainer_profile_id = auth.uid())))
  ) then
    raise exception 'not authorized to run kiosk check-in for this training class';
  end if;

  select * into v_employee from public.employees where id = p_employee_id and organization_id = v_class.organization_id;
  if v_employee is null or v_employee.checkin_pin_hash is null then
    raise exception 'Employee not found or no check-in PIN has been set' using errcode = 'no_data_found';
  end if;
  if extensions.crypt(p_pin, v_employee.checkin_pin_hash) != v_employee.checkin_pin_hash then
    raise exception 'Incorrect PIN' using errcode = 'invalid_password';
  end if;

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
$$;
