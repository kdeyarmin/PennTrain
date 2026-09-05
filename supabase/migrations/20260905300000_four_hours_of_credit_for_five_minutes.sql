-- Four hours of training credit for five minutes in the room (I23).
--
-- complete_training_class computed an attendee's seat time as the interval between check-in and
-- check-out, and where a check-out was missing it fell back to `v_class.duration_hours` -- the
-- SCHEDULED length of the class. So somebody who signed in at the door and left after five minutes
-- got a completed, compliant training record for the full four hours. Nobody made that claim; the
-- fallback made it for them, into the one file a state surveyor reads.
--
-- And the record's status was the literal 'compliant' regardless of the hours, so a check-in at
-- 09:00 with a check-out at 09:01 produced a compliant record too -- the honest hours, and a
-- verdict that ignored them.
--
-- correct_completed_class_attendee carried the same two lines, in a second copy. Both now call one
-- function, because a rule about what counts as attendance is not a thing to keep in two places.
--
-- Neither case is refused. Both land in the Pending Review queue that PendingApprovals.tsx already
-- works (status = 'pending_review', approval_status = 'pending'), with the two numbers stated in
-- review_comments, so a trainer decides. recalculate_compliance_core already preserves
-- 'pending_review' rather than recomputing over it, and sums hours with coalesce(hours, 0), so an
-- unknown-hours record credits nothing until somebody says what it was.

create or replace function app_private.class_attendance_credit(
  p_checked_in_at timestamptz,
  p_checked_out_at timestamptz,
  p_scheduled_hours numeric
)
returns table (hours numeric, status text, approval_status text, review_comments text)
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_hours numeric;
  -- A product default, not a citation. Continuing-education programmes commonly require most of the
  -- scheduled contact time before credit is given; the alternative -- crediting whatever was
  -- evidenced, however little -- is what put a one-minute attendance in a regulated file as
  -- compliant. An organization that wants a different bar should get a setting, and this is the
  -- one place it would read from.
  v_minimum_fraction constant numeric := 0.90;
begin
  if p_checked_in_at is not null and p_checked_out_at is not null then
    v_hours := greatest(round(
      extract(epoch from (p_checked_out_at - p_checked_in_at)) / 3600.0, 2), 0);
  else
    v_hours := null;
  end if;

  if v_hours is null then
    return query select
      null::numeric,
      'pending_review'::text,
      'pending'::text,
      ('No check-out was recorded, so the hours attended are unknown. Confirm the time attended '
       || 'and approve, or reject this record.')::text;
  elsif p_scheduled_hours is not null and p_scheduled_hours > 0
        and v_hours < round(p_scheduled_hours * v_minimum_fraction, 2) then
    return query select
      v_hours,
      'pending_review'::text,
      'pending'::text,
      ('Attended ' || v_hours::text || ' of ' || p_scheduled_hours::text || ' scheduled hours. '
       || 'Confirm whether this meets the requirement and approve, or reject this record.')::text;
  else
    return query select v_hours, 'compliant'::text, 'approved'::text, null::text;
  end if;
end;
$function$;

comment on function app_private.class_attendance_credit(timestamptz, timestamptz, numeric) is
  'What an in-person class attendance is worth: the hours evidenced, and whether that is enough to '
  'stand as compliant without a human looking. One rule for complete_training_class and '
  'correct_completed_class_attendee, which each held their own copy.';

revoke all on function app_private.class_attendance_credit(timestamptz, timestamptz, numeric)
  from public, anon, authenticated;

------------------------------------------------------------------------------------------------
-- Both writers move onto it
------------------------------------------------------------------------------------------------
-- Bodies extracted from the live catalog with pg_get_functiondef and patched, not retyped.

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
  v_credit record;
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
    -- One rule for both writers (BACKLOG.md I23). See app_private.class_attendance_credit.
    select * into v_credit from app_private.class_attendance_credit(
      v_attendee.checked_in_at, v_attendee.checked_out_at, v_class.duration_hours);

    insert into public.employee_training_records (
      organization_id, facility_id, employee_id, training_type_id,
      completion_date, status, trainer_name, hours, completion_method,
      approval_status, review_comments
    )
    select
      v_class.organization_id, coalesce(v_class.facility_id, e.facility_id), v_attendee.employee_id, v_class.training_type_id,
      v_class.class_date, v_credit.status,
      (select first_name || ' ' || last_name from public.profiles where id = v_class.trainer_profile_id),
      v_credit.hours, 'in_person',
      v_credit.approval_status, v_credit.review_comments
    from public.employees e where e.id = v_attendee.employee_id
    returning id into v_record_id;

    update public.training_class_attendees set training_record_id = v_record_id where id = v_attendee.id;
  end loop;

  update public.training_classes set status = 'completed' where id = p_class_id;

  perform public.recalculate_compliance_core(v_class.organization_id);
  perform public.resolve_stale_compliance_alerts(v_class.organization_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.correct_completed_class_attendee(p_class_id uuid, p_employee_id uuid, p_action text, p_attended boolean, p_reason text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_class public.training_classes%rowtype;
  v_employee public.employees%rowtype;
  v_attendee public.training_class_attendees%rowtype;
  v_before jsonb;
  v_record_id uuid;
  v_credit record;
begin
  select * into v_class from public.training_classes where id = p_class_id for update;
  if not found or v_class.status <> 'completed' then
    raise exception 'completed training class not found' using errcode = 'P0002';
  end if;
  perform app_private.assert_completed_class_corrector(v_class.organization_id);
  if p_action not in ('upsert', 'delete')
     or length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'valid correction action and reason are required' using errcode = '22023';
  end if;
  select * into v_employee from public.employees where id = p_employee_id;
  if not found or v_employee.organization_id <> v_class.organization_id then
    raise exception 'employee is outside the completed class organization' using errcode = '23514';
  end if;
  select * into v_attendee
  from public.training_class_attendees
  where class_id = p_class_id and employee_id = p_employee_id
  for update;
  v_before := case when found then to_jsonb(v_attendee) else null end;

  perform set_config('app.completed_class_correction', 'on', true);
  if p_action = 'delete' then
    if v_attendee.id is null then return false; end if;
    v_record_id := v_attendee.training_record_id;
    update public.training_class_attendees
    set training_record_id = null
    where id = v_attendee.id;
    if v_record_id is not null then
      delete from public.employee_training_records where id = v_record_id;
    end if;
    delete from public.training_class_attendees where id = v_attendee.id;
  else
    if v_attendee.id is null then
      insert into public.training_class_attendees(class_id, employee_id, attended, checkin_method)
      values (p_class_id, p_employee_id, coalesce(p_attended, false), 'manual')
      returning * into v_attendee;
    else
      update public.training_class_attendees
      set attended = coalesce(p_attended, attended), checkin_method = 'manual'
      where id = v_attendee.id
      returning * into v_attendee;
    end if;

    if v_attendee.attended and v_attendee.training_record_id is null then
      -- The correcting reviewer is attesting that this person ATTENDED, which is not the same
      -- statement as how long for. So the same credit rule applies here, and their identity is
      -- still recorded on the row -- a correction is attributed whether or not it is conclusive.
      select * into v_credit from app_private.class_attendance_credit(
        v_attendee.checked_in_at, v_attendee.checked_out_at, v_class.duration_hours);
      insert into public.employee_training_records(
        organization_id, facility_id, employee_id, training_type_id,
        completion_date, status, trainer_name, hours, completion_method,
        verified_by_profile_id, verified_at, approval_status, review_comments
      ) values (
        v_class.organization_id, coalesce(v_class.facility_id, v_employee.facility_id),
        p_employee_id, v_class.training_type_id, v_class.class_date, v_credit.status,
        (select first_name || ' ' || last_name from public.profiles where id = v_class.trainer_profile_id),
        v_credit.hours, 'in_person', auth.uid(), now(),
        v_credit.approval_status, v_credit.review_comments
      ) returning id into v_record_id;
      update public.training_class_attendees
      set training_record_id = v_record_id
      where id = v_attendee.id
      returning * into v_attendee;
    elsif not v_attendee.attended and v_attendee.training_record_id is not null then
      v_record_id := v_attendee.training_record_id;
      update public.training_class_attendees
      set training_record_id = null
      where id = v_attendee.id
      returning * into v_attendee;
      delete from public.employee_training_records where id = v_record_id;
    end if;
  end if;

  insert into public.audit_logs(
    organization_id, actor_profile_id, entity_type, entity_id, action,
    old_values, new_values
  ) values (
    v_class.organization_id, auth.uid(), 'training_class_attendee',
    coalesce(v_attendee.id::text, p_class_id::text || ':' || p_employee_id::text),
    'completed_attendance_correction', v_before,
    jsonb_build_object(
      'action', p_action, 'attended', p_attended,
      'reason', btrim(p_reason), 'classId', p_class_id, 'employeeId', p_employee_id
    )
  );
  perform public.recalculate_compliance_core(v_class.organization_id);
  return true;
end;
$function$;
