-- Tier 3.4 (ROADMAP.md): Mobile-first employee experience.
--
-- The viewport meta fix and the responsive sidebar/drawer described in the roadmap text were
-- already shipped in an earlier commit (f099785) -- this migration covers the remaining gaps:
-- wiring the dead in_progress/overdue course_assignments statuses, and an SMS continuation-nudge
-- reusing the existing notification delivery engine (see ROADMAP.md's "SMS magic-link drip" --
-- scoped here to a plain deep link, not a new passwordless-auth mechanism; see PR notes).

-- in_progress: the one caller-triggerable transition, mirroring complete_course_assignment()'s
-- own set_config('app.privileged_write', 'on', true) pattern to get past
-- protect_course_assignment_fields() (which otherwise reverts every non-privileged status write).
-- Idempotent (only fires from 'assigned') and ownership-checked so an employee can only start their
-- own assignment.
create or replace function public.start_course_assignment(p_assignment_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_owns boolean;
begin
  select exists (
    select 1 from public.course_assignments ca
    join public.employees e on e.id = ca.employee_id
    where ca.id = p_assignment_id and e.profile_id = auth.uid()
  ) into v_owns;

  if not v_owns and not public.is_platform_admin() then
    raise exception 'not authorized to start this training assignment' using errcode = 'insufficient_privilege';
  end if;

  perform set_config('app.privileged_write', 'on', true);
  update public.course_assignments
  set status = 'in_progress'
  where id = p_assignment_id and status = 'assigned';
end;
$$;
revoke all on function public.start_course_assignment(uuid) from public, anon;
grant execute on function public.start_course_assignment(uuid) to authenticated;

-- overdue: recomputed nightly (mirrors recalculate_all_compliance()'s cron-only convention) --
-- bidirectional, like training-record status, so an assignment recovers out of 'overdue' if its
-- due_date is later pushed out or cleared, rather than being stuck once flagged.
create or replace function public.recalculate_course_assignment_statuses()
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  perform set_config('app.privileged_write', 'on', true);

  update public.course_assignments
  set status = 'overdue'
  where status in ('assigned', 'in_progress')
    and due_date is not null
    and due_date < current_date;

  update public.course_assignments ca
  set status = case
    when exists (select 1 from public.course_progress cp where cp.assignment_id = ca.id) then 'in_progress'
    else 'assigned'
  end
  where ca.status = 'overdue'
    and (ca.due_date is null or ca.due_date >= current_date);
end;
$$;
revoke all on function public.recalculate_course_assignment_statuses() from public, anon, authenticated;

select cron.schedule(
  'recalculate-course-assignment-statuses-nightly',
  '15 6 * * *',
  $$ select public.recalculate_course_assignment_statuses(); $$
);

-- Continuation reminder: reuses the existing notification -> notification_deliveries -> Twilio/
-- Resend pipeline (dispatch-notifications, Tier 2.1) rather than a new delivery mechanism. Widen
-- the notifications type enum and the delivery-queue trigger's type filter (both are fixed
-- allow-lists, not free text) to include it.
alter table public.notifications drop constraint notifications_notification_type_check;
alter table public.notifications add constraint notifications_notification_type_check
  check (notification_type in (
    'course_assigned', 'quiz_graded', 'certificate_issued', 'training_due_soon', 'training_expired',
    'competency_recorded', 'missing_document', 'certificate_expiring', 'practicum_due_soon',
    'practicum_expired', 'credential_expiring', 'incident_reported', 'policy_attestation_assigned',
    'policy_attestation_due_soon', 'course_continuation_reminder'
  ));

create or replace function public.queue_notification_delivery()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare
  v_settings record;
  v_profile record;
begin
  if new.notification_type not in ('training_due_soon', 'training_expired', 'policy_attestation_due_soon', 'course_continuation_reminder') then
    return new;
  end if;

  select email_notifications_enabled, sms_notifications_enabled
    into v_settings
    from public.organization_settings where organization_id = new.organization_id;

  select email, phone, sms_opt_in, is_active into v_profile
    from public.profiles where id = new.profile_id;

  if v_profile is null or not v_profile.is_active then
    return new;
  end if;

  if coalesce(v_settings.email_notifications_enabled, false) and v_profile.email is not null then
    insert into public.notification_deliveries (organization_id, profile_id, notification_id, channel, delivery_type, recipient)
    values (new.organization_id, new.profile_id, new.id, 'email', 'alert', v_profile.email);
  end if;

  if coalesce(v_settings.sms_notifications_enabled, false) and v_profile.sms_opt_in and v_profile.phone is not null then
    insert into public.notification_deliveries (organization_id, profile_id, notification_id, channel, delivery_type, recipient)
    values (new.organization_id, new.profile_id, new.id, 'sms', 'alert', v_profile.phone);
  end if;

  return new;
end;
$function$;

-- One nudge per stalled assignment (not a repeating drip) -- deduped by an exact link match
-- rather than time-windowed, so this is safe to run nightly without needing its own state table.
create or replace function public.queue_course_continuation_reminders()
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  insert into public.notifications (organization_id, profile_id, notification_type, title, body, link)
  select
    ca.organization_id, e.profile_id, 'course_continuation_reminder',
    'Continue your course',
    coalesce(co.title, 'A course') || ' is waiting for you to finish.',
    '/me/courses/' || ca.id
  from public.course_assignments ca
  join public.employees e on e.id = ca.employee_id
  join public.courses co on co.id = ca.course_id
  join public.course_progress cp on cp.assignment_id = ca.id
  where ca.status = 'in_progress'
    and e.profile_id is not null
    and cp.updated_at < now() - interval '3 days'
    and not exists (
      select 1 from public.notifications n
      where n.notification_type = 'course_continuation_reminder' and n.link = '/me/courses/' || ca.id
    );
end;
$$;
revoke all on function public.queue_course_continuation_reminders() from public, anon, authenticated;

select cron.schedule(
  'course-continuation-reminders-daily',
  '0 14 * * *',
  $$ select public.queue_course_continuation_reminders(); $$
);
