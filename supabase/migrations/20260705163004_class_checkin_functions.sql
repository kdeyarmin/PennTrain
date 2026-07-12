-- Same authorization shape as complete_training_class(): trainer for their own class, or
-- org_admin/facility_manager org-wide. Opportunistically sweeps long-expired tokens (>1 day) so
-- this small table doesn't grow unbounded without needing a separate cron job.
create or replace function public.generate_class_checkin_token(p_class_id uuid)
returns text language plpgsql security definer set search_path to 'public' as $$
declare
  v_class record;
  v_token text;
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
    raise exception 'not authorized to run check-in for this training class';
  end if;

  delete from public.class_checkin_tokens where expires_at < now() - interval '1 day';

  insert into public.class_checkin_tokens (class_id) values (p_class_id)
  returning token into v_token;

  return v_token;
end;
$$;

revoke all on function public.generate_class_checkin_token(uuid) from public;
grant execute on function public.generate_class_checkin_token(uuid) to authenticated;

-- Called by the scanning employee's own authenticated session. Toggles: first scan of a class
-- sets checked_in_at, a later scan (while still checked in) sets checked_out_at -- the common
-- "scan to check in, scan again to check out" kiosk/QR UX. attended is set true on check-in so
-- existing attendance-marking behavior (and complete_training_class's attended-row loop) picks
-- it up automatically.
create or replace function public.checkin_via_token(p_token text)
returns public.training_class_attendees language plpgsql security definer set search_path to 'public' as $$
declare
  v_token_row record;
  v_class record;
  v_employee record;
  v_attendee public.training_class_attendees;
begin
  select * into v_token_row from public.class_checkin_tokens where token = p_token;
  if v_token_row is null or v_token_row.expires_at < now() then
    raise exception 'This check-in code has expired. Please scan the current QR code again.' using errcode = 'data_exception';
  end if;

  select * into v_class from public.training_classes where id = v_token_row.class_id;

  select * into v_employee from public.employees where profile_id = auth.uid() and organization_id = v_class.organization_id;
  if v_employee is null then
    raise exception 'No employee record found for your account in this organization' using errcode = 'no_data_found';
  end if;

  select * into v_attendee from public.training_class_attendees where class_id = v_class.id and employee_id = v_employee.id;

  if v_attendee is null then
    insert into public.training_class_attendees (class_id, employee_id, attended, checked_in_at, checkin_method)
    values (v_class.id, v_employee.id, true, now(), 'qr')
    returning * into v_attendee;
  elsif v_attendee.checked_in_at is null then
    update public.training_class_attendees
    set attended = true, checked_in_at = now(), checkin_method = 'qr'
    where id = v_attendee.id
    returning * into v_attendee;
  elsif v_attendee.checked_out_at is null then
    update public.training_class_attendees
    set checked_out_at = now()
    where id = v_attendee.id
    returning * into v_attendee;
  else
    raise exception 'You have already checked in and out for this class.' using errcode = 'data_exception';
  end if;

  return v_attendee;
end;
$$;

revoke all on function public.checkin_via_token(text) from public;
grant execute on function public.checkin_via_token(text) to authenticated;

-- Admin-set PIN for kiosk-mode identification -- bcrypt via pgcrypto (crypt/gen_salt), not a
-- reversible or plain-comparable value.
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

  update public.employees set checkin_pin_hash = crypt(p_pin, gen_salt('bf')) where id = p_employee_id;
end;
$$;

revoke all on function public.set_employee_checkin_pin(uuid, text) from public;
grant execute on function public.set_employee_checkin_pin(uuid, text) to authenticated;

-- Kiosk mode: the trainer/admin is authenticated on the shared tablet (proving the device is
-- authorized to run check-in for this class); the individual employee's PIN is the second factor
-- that attributes the specific check-in to them. Same toggle logic as checkin_via_token.
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
  if crypt(p_pin, v_employee.checkin_pin_hash) != v_employee.checkin_pin_hash then
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

revoke all on function public.checkin_via_kiosk_pin(uuid, uuid, text) from public;
grant execute on function public.checkin_via_kiosk_pin(uuid, uuid, text) to authenticated;
