-- Email/SMS delivery engine: deskless direct-care staff never log into the web app, so the
-- in-app-only notification feed (20260704200000_notification_center.sql) never reaches them.
-- This adds an outbox (notification_deliveries), consent capture, an escalation path when a
-- staff-level alert goes unactioned, a weekly admin digest, and fixes the alert re-bucketing bug
-- (a due_90 alert never became due_7 as the deadline approached -- the INSERT-only dedup guard
-- kept the first row open and severity frozen).

-- Consent capture. SMS requires an affirmative opt-in (informational/transactional training
-- reminders still need prior consent under TCPA); email uses the account's existing address and
-- is opt-out (email_notifications_enabled at the org level already gates it).
alter table public.profiles
  add column phone_number text,
  add column sms_opt_in boolean not null default false,
  add column sms_consent_at timestamptz;

create table public.notification_deliveries (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  profile_id          uuid not null references public.profiles(id) on delete cascade,
  notification_id     uuid references public.notifications(id) on delete set null,
  channel             text not null check (channel in ('email','sms')),
  delivery_type        text not null default 'alert' check (delivery_type in ('alert','escalation','digest')),
  recipient           text not null,
  status              text not null default 'pending' check (status in ('pending','sent','failed','skipped')),
  provider_message_id text,
  error_message        text,
  created_at          timestamptz not null default now(),
  sent_at             timestamptz
);
create index notification_deliveries_status_idx on public.notification_deliveries(status) where status = 'pending';
create index notification_deliveries_org_idx on public.notification_deliveries(organization_id, created_at desc);
create index notification_deliveries_profile_idx on public.notification_deliveries(profile_id, created_at desc);

alter table public.notification_deliveries enable row level security;
-- System-populated only (trigger + dispatch edge function via service role), same pattern as
-- audit_logs/notifications -- no client insert/update policy at all.
create policy notification_deliveries_select on public.notification_deliveries for select to authenticated using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id()) and (select public.current_role()) in ('org_admin','facility_manager'))
);

-- Fan-out trigger: for every new notification of a deadline-driven type, queue a delivery per
-- channel the org has enabled AND (for SMS) the profile has actually opted into. Scoped to
-- training_due_soon/training_expired -- the deadline nudges this feature exists for -- not every
-- notification type (course_assigned etc. stay in-app-only; SMS-ing every training assignment would
-- be noise, not signal).
create or replace function public.queue_notification_delivery()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare
  v_settings record;
  v_profile record;
begin
  if new.notification_type not in ('training_due_soon', 'training_expired') then
    return new;
  end if;

  select email_notifications_enabled, sms_notifications_enabled
    into v_settings
    from public.organization_settings where organization_id = new.organization_id;

  select email, phone_number, sms_opt_in, is_active into v_profile
    from public.profiles where id = new.profile_id;

  if v_profile is null or not v_profile.is_active then
    return new;
  end if;

  if coalesce(v_settings.email_notifications_enabled, false) and v_profile.email is not null then
    insert into public.notification_deliveries (organization_id, profile_id, notification_id, channel, delivery_type, recipient)
    values (new.organization_id, new.profile_id, new.id, 'email', 'alert', v_profile.email);
  end if;

  if coalesce(v_settings.sms_notifications_enabled, false) and v_profile.sms_opt_in and v_profile.phone_number is not null then
    insert into public.notification_deliveries (organization_id, profile_id, notification_id, channel, delivery_type, recipient)
    values (new.organization_id, new.profile_id, new.id, 'sms', 'alert', v_profile.phone_number);
  end if;

  return new;
end;
$function$;

create trigger queue_notification_delivery after insert on public.notifications
  for each row execute function public.queue_notification_delivery();

-- Alert re-bucketing fix: escalate an already-open alert's type/severity/title/message when the
-- record's status/urgency has moved on, instead of leaving it frozen at whatever it was when
-- first opened. Also fires notify_training_alert again on a real escalation (severity change),
-- not on every recalculation pass, via the trigger's WHEN clause below.
create or replace function public.recalculate_all_compliance()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.employee_training_records r
  set
    due_date = case
      when r.completion_date is null or tt.renewal_interval_days is null then null
      else r.completion_date + tt.renewal_interval_days
    end,
    status = case
      when r.status in ('not_applicable','pending_review') then r.status
      when r.completion_date is null then 'missing'
      when tt.renewal_interval_days is null then 'compliant'
      when (r.completion_date + tt.renewal_interval_days) < current_date then 'expired'
      when (r.completion_date + tt.renewal_interval_days) <= current_date + tt.warning_days_default then 'due_soon'
      else 'compliant'
    end
  from public.training_types tt
  where r.training_type_id = tt.id;

  update public.practicums p
  set status = case
    when p.due_date is null then 'missing'
    when p.due_date < current_date then 'expired'
    when p.due_date <= current_date + p.reminder_days then 'due_soon'
    else 'compliant'
  end;

  -- Insert a fresh alert for any record with no open alert yet, OR escalate (update in place) an
  -- already-open alert whose bucket needs to move up as the deadline tightens (or the record
  -- expired outright). "Escalate" only ever tightens the window (due_90 -> due_30 -> due_7 ->
  -- overdue), never loosens it back down on its own -- a record that becomes compliant again
  -- resolves via the existing resolve/dismiss actions, not a silent re-bucket.
  with computed as (
    select
      r.id as training_record_id, r.organization_id, r.facility_id, r.employee_id,
      case
        when r.status = 'expired' then 'overdue'
        when r.due_date <= current_date + 7 then 'due_7'
        when r.due_date <= current_date + 14 then 'due_14'
        when r.due_date <= current_date + 30 then 'due_30'
        when r.due_date <= current_date + 60 then 'due_60'
        else 'due_90'
      end as computed_alert_type,
      case when r.status = 'expired' then 'critical' else 'warning' end as computed_severity,
      tt.name || ' — ' || e.first_name || ' ' || e.last_name as computed_title,
      case when r.status = 'expired'
        then tt.name || ' has expired for ' || e.first_name || ' ' || e.last_name
        else tt.name || ' is due soon for ' || e.first_name || ' ' || e.last_name
      end as computed_message
    from public.employee_training_records r
    join public.training_types tt on tt.id = r.training_type_id
    join public.employees e on e.id = r.employee_id
    where r.status in ('due_soon','expired')
  ),
  alert_rank as (
    select unnest(array['due_90','due_60','due_30','due_14','due_7','overdue']) as alert_type,
           unnest(array[0,1,2,3,4,5]) as rank
  ),
  escalations as (
    update public.alerts a
    set alert_type = c.computed_alert_type,
        severity = c.computed_severity,
        title = c.computed_title,
        message = c.computed_message
    from computed c
    join alert_rank new_rank on new_rank.alert_type = c.computed_alert_type
    join alert_rank old_rank on old_rank.alert_type = a.alert_type
    where a.training_record_id = c.training_record_id
      and a.status = 'open'
      and new_rank.rank > old_rank.rank
    returning a.training_record_id
  )
  insert into public.alerts (organization_id, facility_id, employee_id, training_record_id, alert_type, title, message, severity)
  select c.organization_id, c.facility_id, c.employee_id, c.training_record_id,
         c.computed_alert_type, c.computed_title, c.computed_message, c.computed_severity
  from computed c
  where not exists (
    select 1 from public.alerts a where a.training_record_id = c.training_record_id and a.status = 'open'
  );
end;
$$;
grant execute on function public.recalculate_all_compliance() to authenticated;

-- Re-notify (and re-queue delivery) when an already-open alert's severity is escalated in place,
-- not just on the original insert -- otherwise an SMS sent at due_90 would never be followed by
-- one at due_7 even though the underlying alerts row now says due_7.
create trigger notify_training_alert_on_escalation after update of alert_type on public.alerts
  for each row
  when (old.alert_type is distinct from new.alert_type and new.status = 'open')
  execute function public.notify_training_alert();

-- Alerts left open past a hard threshold get escalated to the facility's admin roles, not just
-- re-nudged at the same staff member -- captures "staff-level nudges going unanswered" without a
-- full workflow-assignment system. escalated_at guards against re-escalating the same alert
-- every time this runs.
alter table public.alerts add column escalated_at timestamptz;

create or replace function public.escalate_unactioned_alerts()
returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_alert record; v_admin record;
begin
  for v_alert in
    select a.* from public.alerts a
    where a.status = 'open' and a.escalated_at is null
      and a.alert_type in ('due_7','overdue')
      and a.created_at < now() - interval '5 days'
  loop
    for v_admin in
      select p.id as profile_id, p.email, p.phone_number, p.sms_opt_in, os.email_notifications_enabled, os.sms_notifications_enabled
      from public.profiles p
      left join public.organization_settings os on os.organization_id = p.organization_id
      where p.organization_id = v_alert.organization_id
        and p.role in ('org_admin','facility_manager')
        and p.is_active
    loop
      insert into public.notifications (organization_id, profile_id, notification_type, title, body, link)
      values (
        v_alert.organization_id, v_admin.profile_id, 'training_expired',
        'Unresolved: ' || v_alert.title,
        'This alert has been open for 5+ days without resolution: ' || v_alert.message,
        '/app/alerts'
      );
      if coalesce(v_admin.email_notifications_enabled, false) and v_admin.email is not null then
        insert into public.notification_deliveries (organization_id, profile_id, channel, delivery_type, recipient)
        values (v_alert.organization_id, v_admin.profile_id, 'email', 'escalation', v_admin.email);
      end if;
      if coalesce(v_admin.sms_notifications_enabled, false) and v_admin.sms_opt_in and v_admin.phone_number is not null then
        insert into public.notification_deliveries (organization_id, profile_id, channel, delivery_type, recipient)
        values (v_alert.organization_id, v_admin.profile_id, 'sms', 'escalation', v_admin.phone_number);
      end if;
    end loop;
    update public.alerts set escalated_at = now() where id = v_alert.id;
  end loop;
end;
$function$;
revoke all on function public.escalate_unactioned_alerts() from public, anon, authenticated;

-- Monday morning digest for org_admin/facility_manager: one summary delivery per enabled channel,
-- not a per-alert flood. Content lives in the notification body; the dispatch function sends
-- whatever body/title it finds without needing to know this is a digest vs. a single alert.
create or replace function public.send_monday_digest()
returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_admin record; v_due_soon int; v_expired int; v_critical_alerts int;
begin
  for v_admin in
    select p.id as profile_id, p.organization_id, p.email, p.phone_number, p.sms_opt_in,
           os.email_notifications_enabled, os.sms_notifications_enabled
    from public.profiles p
    left join public.organization_settings os on os.organization_id = p.organization_id
    where p.role in ('org_admin','facility_manager') and p.is_active
  loop
    select count(*) filter (where r.status = 'due_soon'),
           count(*) filter (where r.status = 'expired')
      into v_due_soon, v_expired
      from public.employee_training_records r
      where r.organization_id = v_admin.organization_id;

    select count(*) into v_critical_alerts
      from public.alerts a
      where a.organization_id = v_admin.organization_id and a.status = 'open' and a.severity = 'critical';

    if v_due_soon = 0 and v_expired = 0 and v_critical_alerts = 0 then
      continue;
    end if;

    insert into public.notifications (organization_id, profile_id, notification_type, title, body, link)
    values (
      v_admin.organization_id, v_admin.profile_id, 'training_due_soon',
      'Weekly compliance digest',
      v_expired || ' expired, ' || v_due_soon || ' due soon, ' || v_critical_alerts || ' critical alert(s) open.',
      '/app'
    );
    if coalesce(v_admin.email_notifications_enabled, false) and v_admin.email is not null then
      insert into public.notification_deliveries (organization_id, profile_id, channel, delivery_type, recipient)
      values (v_admin.organization_id, v_admin.profile_id, 'email', 'digest', v_admin.email);
    end if;
    if coalesce(v_admin.sms_notifications_enabled, false) and v_admin.sms_opt_in and v_admin.phone_number is not null then
      insert into public.notification_deliveries (organization_id, profile_id, channel, delivery_type, recipient)
      values (v_admin.organization_id, v_admin.profile_id, 'sms', 'digest', v_admin.phone_number);
    end if;
  end loop;
end;
$function$;
revoke all on function public.send_monday_digest() from public, anon, authenticated;

-- Cron: dispatch the outbox frequently (the edge function itself no-ops cheaply when the queue is
-- empty), escalate daily, digest Monday mornings. Fire-and-forget net.http_post -- the edge
-- function updates notification_deliveries directly via its own service-role client, so Postgres
-- doesn't need to see the HTTP response.
select cron.schedule(
  'dispatch-notification-deliveries',
  '*/15 * * * *',
  $$ select net.http_post(
       url := 'https://xsqobvvreaovwibxwyvv.supabase.co/functions/v1/dispatch-notifications',
       headers := jsonb_build_object('Content-Type', 'application/json'),
       body := '{}'::jsonb
     ); $$
);

select cron.schedule(
  'escalate-unactioned-alerts',
  '0 13 * * *',
  $$ select public.escalate_unactioned_alerts(); $$
);

select cron.schedule(
  'send-monday-digest',
  '0 12 * * 1',
  $$ select public.send_monday_digest(); $$
);
