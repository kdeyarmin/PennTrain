-- Forward-fix (review finding): training_class_attendees has no unique constraint on
-- (class_id, employee_id), and checkin_via_token()/checkin_via_kiosk_pin() both do an unguarded
-- select-then-branch ("select ... where class_id=X and employee_id=Y; if not found then insert").
-- Under READ COMMITTED, two concurrent calls for the same employee/class (a flaky kiosk tablet
-- retrying after a timeout, or an employee scanning the printed QR on their phone at the same
-- moment a trainer taps "kiosk PIN" for them) can both see "no existing row" before either commits,
-- so both INSERT a new attendee row -- and complete_training_class()'s
-- `where attended=true and training_record_id is null` loop then has no dedup, inserting two
-- employee_training_records for the same employee/class/date and silently double-counting that
-- employee's annual training hours.
--
-- Fix in two layers: a hard backstop unique constraint (so no code path can ever create a
-- duplicate row, even one this migration didn't anticipate), and an advisory transaction lock
-- keyed on (class_id, employee_id) at the top of both check-in RPCs so concurrent callers for the
-- same pairing are serialized rather than racing the select-then-insert -- preserves the existing
-- toggle-logic branching untouched (no restructure into an ON CONFLICT upsert needed).

-- Dedup any existing duplicate (class_id, employee_id) rows before the constraint below, keeping
-- whichever row already produced a training record (evidence of the "real" one), else the earliest
-- inserted.
with ranked as (
  select id,
    row_number() over (
      partition by class_id, employee_id
      order by (training_record_id is not null) desc, created_at asc
    ) as rn
  from public.training_class_attendees
)
delete from public.training_class_attendees a
using ranked r
where a.id = r.id and r.rn > 1;

alter table public.training_class_attendees
  add constraint training_class_attendees_class_employee_uk unique (class_id, employee_id);

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
  if v_class.status <> 'draft' then
    raise exception 'This class is no longer accepting check-ins.' using errcode = 'check_violation';
  end if;

  select * into v_employee from public.employees where profile_id = auth.uid() and organization_id = v_class.organization_id;
  if v_employee is null then
    raise exception 'No employee record found for your account in this organization' using errcode = 'no_data_found';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_class.id::text || ':' || v_employee.id::text));

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
  if v_class.status <> 'draft' then
    raise exception 'This class is no longer accepting check-ins.' using errcode = 'check_violation';
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
$$;

revoke all on function public.checkin_via_kiosk_pin(uuid, uuid, text) from public;
grant execute on function public.checkin_via_kiosk_pin(uuid, uuid, text) to authenticated;
