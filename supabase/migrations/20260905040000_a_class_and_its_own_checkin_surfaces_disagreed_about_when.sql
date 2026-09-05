-- A class and its own check-in surfaces disagreed about when a check-in is allowed.
--
-- THE FINDING. Three functions decide whether a class is still taking attendance, and they did not
-- agree with each other:
--
--   generate_class_checkin_token   scheduled / in_progress
--   checkin_via_token              scheduled / in_progress
--   checkin_via_kiosk_pin          draft, and ONLY draft
--
-- A class is created `draft` and moves to `scheduled` exactly once -- "Open for enrollment" is the
-- only control that exists, and there is no way back. So the two check-in paths were never
-- available for the same class at the same time. Worse, ClassDetail rendered the QR card and the
-- printed meeting notice (which mints a long-lived token through the same generator) only while
-- `status = draft` -- the one state in which both of them refuse. The QR card therefore showed an
-- error where the code should be, rotated 30 seconds later, and showed it again, for the life of
-- every draft class; opening the class for enrolment removed the card rather than making it work.
-- QR check-in and the printed notice were unreachable in every state a class can be in.
--
-- THE RULE, stated once. A class records attendance until it is finished: `draft`, `scheduled` and
-- `in_progress` all accept check-ins, `completed` and `cancelled` do not -- which is exactly what
-- the error message ("This class is no longer accepting check-ins.") has always claimed. That rule
-- now lives in one function all three call, instead of three copies that had already drifted.
--
-- This is strictly MORE permissive than what each function did before, so nothing that worked
-- stops working: the kiosk keeps taking PINs on a draft class, and now keeps taking them after the
-- class opens for enrolment -- which is when the class actually meets. Enrolment is a separate
-- track and is untouched: register_for_training_session still requires `scheduled`/`in_progress`,
-- because enrolling in a class nobody has announced is a different thing from walking into one.
--
-- Each body below is the deployed source with the status check swapped and nothing else touched.
--
-- Rollback: restore the three functions from 20260806030000 (kiosk), 20260727020000 (token) and
-- 20260705164500 (generator). That restores two check-in paths that cannot both be used.

create or replace function app_private.class_accepts_checkins(p_status text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_status in ('draft', 'scheduled', 'in_progress');
$$;

comment on function app_private.class_accepts_checkins(text) is
  'A class records attendance until it is completed or cancelled. Called by generate_class_checkin_token, checkin_via_token and checkin_via_kiosk_pin so the three cannot disagree again.';

create or replace function public.generate_class_checkin_token(p_class_id uuid, p_long_lived boolean default false)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$

declare
  v_class public.training_classes%rowtype;
  v_token text;
  v_not_before timestamptz;
begin
  select * into v_class from public.training_classes where id = p_class_id;
  if not found then raise exception 'training class not found' using errcode = 'P0002'; end if;
  if not app_private.class_accepts_checkins(v_class.status) then
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

$fn$;

create or replace function public.checkin_via_token(p_token text)
returns public.training_class_attendees
language plpgsql
security definer
set search_path = ''
as $fn$

declare
  v_token_row public.class_checkin_tokens%rowtype;
  v_class public.training_classes%rowtype;
  v_employee public.employees%rowtype;
  v_attendee public.training_class_attendees%rowtype;
begin
  if not public.current_profile_active() then
    raise exception 'An active account is required for QR check-in' using errcode = '42501';
  end if;
  select * into v_token_row from public.class_checkin_tokens where token = p_token for update;
  if not found or v_token_row.revoked_at is not null or now() < v_token_row.not_before
     or v_token_row.expires_at < now() then
    raise exception 'This check-in code is not active. Please scan the current QR code again.'
      using errcode = '22000';
  end if;
  select * into v_class from public.training_classes where id = v_token_row.class_id;
  if not app_private.class_accepts_checkins(v_class.status) then
    raise exception 'This class is no longer accepting check-ins.' using errcode = '23514';
  end if;
  select * into v_employee from public.employees
  where profile_id = auth.uid() and organization_id = v_class.organization_id
    and status = 'active';
  if not found then
    raise exception 'No active employee record found for your account in this organization'
      using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtext(v_class.id::text || ':' || v_employee.id::text));
  select * into v_attendee from public.training_class_attendees
  where class_id = v_class.id and employee_id = v_employee.id;
  if not found then
    insert into public.training_class_attendees(class_id, employee_id, attended, checked_in_at, checkin_method)
    values (v_class.id, v_employee.id, true, now(), 'qr') returning * into v_attendee;
  elsif v_attendee.checked_in_at is null then
    update public.training_class_attendees
    set attended = true, checked_in_at = now(), checkin_method = 'qr'
    where id = v_attendee.id returning * into v_attendee;
  elsif v_attendee.checked_out_at is null then
    update public.training_class_attendees set checked_out_at = now()
    where id = v_attendee.id returning * into v_attendee;
  else
    raise exception 'You have already checked in and out for this class.' using errcode = '22000';
  end if;
  update public.class_checkin_tokens set last_used_at = now() where id = v_token_row.id;
  return v_attendee;
end;

$fn$;

create or replace function public.checkin_via_kiosk_pin(p_class_id uuid, p_employee_id uuid, p_pin text)
returns public.training_class_attendees
language plpgsql
security definer
set search_path = public
as $fn$

declare
  v_class record;
  v_employee record;
  v_attendee public.training_class_attendees;
begin
  select * into v_class from public.training_classes where id = p_class_id;
  if v_class is null then
    raise exception 'training class not found';
  end if;
  if not app_private.class_accepts_checkins(v_class.status) then
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

$fn$;
