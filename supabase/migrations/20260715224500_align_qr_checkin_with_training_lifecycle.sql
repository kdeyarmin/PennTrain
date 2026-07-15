-- D1 release journey repair: Phase 3 made scheduled/in-progress the live
-- training-session states, but the later token hardening accidentally retained
-- the legacy draft-only check. Keep the revocable token controls while aligning
-- QR attendance with the governed training lifecycle.

create or replace function public.generate_class_checkin_token(
  p_class_id uuid, p_long_lived boolean default false
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
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
  if not (
    public.is_platform_admin()
    or (v_class.organization_id = public.current_org_id()
        and public.current_profile_active()
        and (public.current_role() = 'org_admin'
             or (public.current_role() = 'facility_manager' and public.is_assigned_to_facility(v_class.facility_id))
             or (public.current_role() = 'trainer' and v_class.trainer_profile_id = auth.uid()
                 and public.is_assigned_to_facility(v_class.facility_id))))
  ) then
    raise exception 'not authorized to run check-in for this training class' using errcode = '42501';
  end if;

  delete from public.class_checkin_tokens where expires_at < now() - interval '1 day';
  if p_long_lived then
    v_not_before := v_class.class_date::timestamp at time zone 'UTC';
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
$$;

create or replace function public.checkin_via_token(p_token text)
returns public.training_class_attendees
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token_row public.class_checkin_tokens%rowtype;
  v_class public.training_classes%rowtype;
  v_employee public.employees%rowtype;
  v_attendee public.training_class_attendees%rowtype;
begin
  select * into v_token_row from public.class_checkin_tokens where token = p_token for update;
  if not found or v_token_row.revoked_at is not null or now() < v_token_row.not_before
     or v_token_row.expires_at < now() then
    raise exception 'This check-in code is not active. Please scan the current QR code again.'
      using errcode = '22000';
  end if;
  select * into v_class from public.training_classes where id = v_token_row.class_id;
  if v_class.status not in ('scheduled', 'in_progress') then
    raise exception 'This class is no longer accepting check-ins.' using errcode = '23514';
  end if;
  select * into v_employee from public.employees
  where profile_id = auth.uid() and organization_id = v_class.organization_id
    and status <> 'terminated';
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
$$;

revoke all on function public.generate_class_checkin_token(uuid, boolean) from public, anon;
revoke all on function public.checkin_via_token(text) from public, anon;
grant execute on function public.generate_class_checkin_token(uuid, boolean) to authenticated;
grant execute on function public.checkin_via_token(text) to authenticated;
