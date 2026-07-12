-- Widen the notification-type rail to carry policy-attestation events, mirroring the
-- course_assigned / training_due_soon pattern already established for the LMS and
-- compliance-alert engines.
alter table public.notifications drop constraint notifications_notification_type_check;
alter table public.notifications add constraint notifications_notification_type_check
  check (notification_type in (
    'course_assigned', 'quiz_graded', 'certificate_issued', 'training_due_soon', 'training_expired',
    'competency_recorded', 'missing_document', 'certificate_expiring',
    'practicum_due_soon', 'practicum_expired', 'credential_expiring', 'incident_reported',
    'policy_attestation_assigned', 'policy_attestation_due_soon'
  ));

-- Fires once per attestation row, same shape as notify_course_assigned(): look up the
-- employee's profile, resolve a human title via the campaign's policy document, insert an
-- in-app notification. Assignment notifications are in-app-only in this codebase (course_assigned
-- behaves the same way) -- only due-soon reminders ride email/SMS, wired below.
create or replace function public.notify_policy_attestation_assigned()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare v_profile_id uuid; v_title text;
begin
  select profile_id into v_profile_id from public.employees where id = new.employee_id;
  if v_profile_id is null then
    return new;
  end if;

  select pd.title into v_title
  from public.policy_attestation_campaigns c
  join public.policy_documents pd on pd.id = c.policy_document_id
  where c.id = new.campaign_id;

  insert into public.notifications (organization_id, profile_id, notification_type, title, body, link)
  values (
    new.organization_id, v_profile_id, 'policy_attestation_assigned',
    'Policy attestation required',
    coalesce(v_title, 'A policy document') ||
      case when new.due_date is not null then ' — due ' || to_char(new.due_date, 'Mon DD, YYYY') else '' end,
    '/me/attestations'
  );
  return new;
end;
$function$;

create trigger notify_policy_attestation_assigned after insert on public.policy_attestations
  for each row execute function public.notify_policy_attestation_assigned();

revoke all on function public.notify_policy_attestation_assigned() from public, anon, authenticated;

-- Extend the existing delivery-engine gate (email/SMS today fires only for training_due_soon /
-- training_expired) to also cover policy_attestation_due_soon reminders. Full function-body
-- rewrite, identical to the current definition plus the one added type.
create or replace function public.queue_notification_delivery()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare
  v_settings record;
  v_profile record;
begin
  if new.notification_type not in ('training_due_soon', 'training_expired', 'policy_attestation_due_soon') then
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

-- Daily reminder sweep: pending attestations within 7 days of due_date (or already overdue),
-- not reminded in the last 3 days, get a due-soon notification. reminder_sent_at is the dedup
-- key so the nightly job can run indefinitely without re-spamming the same employee.
create or replace function public.send_policy_attestation_reminders()
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  insert into public.notifications (organization_id, profile_id, notification_type, title, body, link)
  select
    pa.organization_id, e.profile_id, 'policy_attestation_due_soon',
    case when pa.due_date < current_date then 'Policy attestation overdue' else 'Policy attestation due soon' end,
    pd.title ||
      case
        when pa.due_date is null then ' requires your attestation.'
        when pa.due_date < current_date then ' was due ' || to_char(pa.due_date, 'Mon DD, YYYY') || ' and is now overdue.'
        else ' is due ' || to_char(pa.due_date, 'Mon DD, YYYY') || '.'
      end,
    '/me/attestations'
  from public.policy_attestations pa
  join public.employees e on e.id = pa.employee_id
  join public.policy_attestation_campaigns c on c.id = pa.campaign_id
  join public.policy_documents pd on pd.id = c.policy_document_id
  where pa.status = 'pending'
    and e.profile_id is not null
    and pa.due_date is not null
    and pa.due_date <= current_date + 7
    and (pa.reminder_sent_at is null or pa.reminder_sent_at < now() - interval '3 days');

  update public.policy_attestations pa
  set reminder_sent_at = now()
  where pa.status = 'pending'
    and pa.due_date is not null
    and pa.due_date <= current_date + 7
    and (pa.reminder_sent_at is null or pa.reminder_sent_at < now() - interval '3 days');
end;
$function$;

revoke all on function public.send_policy_attestation_reminders() from public, anon, authenticated;

select cron.schedule(
  'send-policy-attestation-reminders',
  '0 12 * * *',
  $$select public.send_policy_attestation_reminders();$$
);
