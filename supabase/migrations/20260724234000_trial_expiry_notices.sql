-- Expiring-trial notices (PT-052, remaining slice).
--
-- 20260724180000 enforces the 30-day signup trial at entitlement-resolution
-- time, so a lapsed trial now loses module access -- but nothing warned the
-- organization it was coming. This migration adds a once-daily scheduled
-- enqueue that notifies active org admins at T-7 and T-1 before
-- organizations.trial_ends_at, through the existing notification delivery
-- engine (public.notifications + enqueue_preferred_notification_delivery +
-- the dispatch-notification-deliveries cron). No new delivery channel is
-- built; external email/SMS/push copy stays generic because
-- renderProviderMessage in the dispatch worker falls back to the generic
-- "sign in to review" message for any notification type without bespoke copy
-- (the PT-005 rule: specific content stays on-platform).
--
-- Idempotency: one notice per (organization, threshold, trial window). The
-- dedupe key includes trial_ends_at so extending a trial re-arms both
-- thresholds for the new window, while re-runs and missed-day catch-ups for
-- the same window stay silent.

-- 1. Register the notification type.
alter table public.notifications drop constraint notifications_notification_type_check;
alter table public.notifications add constraint notifications_notification_type_check check (
  notification_type in (
    'course_assigned', 'quiz_graded', 'certificate_issued',
    'training_due_soon', 'training_expired', 'competency_recorded',
    'missing_document', 'certificate_expiring', 'practicum_due_soon', 'practicum_expired',
    'credential_expiring', 'incident_reported', 'policy_attestation_assigned',
    'policy_attestation_due_soon', 'course_continuation_reminder', 'resident_compliance_due',
    'support_ticket_update', 'workforce_lifecycle_changed', 'training_registration_changed',
    'open_shift_claim_changed', 'shift_swap_changed', 'credential_renewal_changed',
    'qualification_changed', 'course_assignment_due_soon',
    'shift_handoff_assigned', 'shift_handoff_escalated', 'shift_handoff_resolved',
    'time_off_request_changed', 'portal_message_received', 'schedule_published',
    'announcement_published', 'manager_weekly_digest',
    'automation_action_due', 'report_subscription_ready', 'resident_portal_request',
    'billing_trial_expiring'
  )
);

-- 2. Dedupe ledger: one row per notice actually enqueued.
create table app_private.billing_trial_notice_log (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  threshold_days integer not null check (threshold_days in (1, 7)),
  trial_ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, threshold_days, trial_ends_at)
);
alter table app_private.billing_trial_notice_log enable row level security;
revoke all on table app_private.billing_trial_notice_log from public, anon, authenticated;

-- 3. Daily enqueue. Same shape as escalate_unactioned_alerts /
-- send_monday_digest: a cron-invoked SECURITY DEFINER function that writes
-- public.notifications and hands delivery to the existing engine.
create or replace function app_private.enqueue_trial_expiry_notices()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org record;
  v_admin record;
  v_threshold integer;
  v_days_left integer;
  v_notification_id uuid;
  v_enqueued integer := 0;
begin
  for v_org in
    select o.id, o.name, o.trial_ends_at
    from public.organizations o
    join public.billing_accounts a on a.organization_id = o.id
    where o.trial_ends_at is not null
      and o.trial_ends_at > now()
      and o.trial_ends_at <= now() + interval '7 days'
      and not o.is_demo
      -- Only accounts still living off the signup trial. Comped, active,
      -- suspended, and already-downgraded accounts are not trial-notice
      -- audiences.
      and a.billing_state = 'trial'
      -- A live subscription (its own Stripe trial included) overrides the
      -- in-app window -- same guard as get_effective_entitlements.
      and not exists (
        select 1 from public.billing_subscriptions s
        where s.organization_id = o.id
          and s.billing_state in ('trial', 'active', 'grace')
      )
  loop
    -- Most-imminent applicable threshold only: T-7 through T-2 send the
    -- 7-day notice once; T-1 (or a catch-up run landing inside the final
    -- day) sends the 1-day notice once.
    v_threshold := case
      when v_org.trial_ends_at <= now() + interval '1 day' then 1
      else 7
    end;

    insert into app_private.billing_trial_notice_log (
      organization_id, threshold_days, trial_ends_at
    ) values (v_org.id, v_threshold, v_org.trial_ends_at)
    on conflict do nothing;
    if not found then
      continue; -- already notified for this window+threshold
    end if;

    v_days_left := greatest(
      1, ceil(extract(epoch from (v_org.trial_ends_at - now())) / 86400)::integer);

    for v_admin in
      select p.id
      from public.profiles p
      where p.organization_id = v_org.id
        and p.role = 'org_admin'
        and p.is_active
    loop
      insert into public.notifications (
        organization_id, profile_id, notification_type, title, body, link
      ) values (
        v_org.id, v_admin.id, 'billing_trial_expiring',
        case when v_threshold = 1
          then 'Your free trial ends tomorrow'
          else 'Your free trial is ending soon' end,
        'The ' || v_org.name || ' free trial ends on '
          || to_char(v_org.trial_ends_at, 'FMMonth DD, YYYY')
          || ' (' || v_days_left || ' day' || case when v_days_left = 1 then '' else 's' end
          || ' left). Choose a plan to keep uninterrupted access to your subscribed modules.',
        '/app/enterprise'
      ) returning id into v_notification_id;

      -- Off-platform delivery honors the recipient's preferred channel,
      -- consent, and org channel settings; the dispatch worker sends the
      -- generic external copy for this type.
      perform public.enqueue_preferred_notification_delivery(
        v_org.id, v_admin.id, v_notification_id, 'alert');
      v_enqueued := v_enqueued + 1;
    end loop;
  end loop;

  return v_enqueued;
end;
$$;
revoke all on function app_private.enqueue_trial_expiry_notices()
  from public, anon, authenticated;

-- 4. Once per day, before US business hours. Delivery itself rides the
-- existing dispatch-notification-deliveries 15-minute cron.
select cron.unschedule('billing-trial-expiry-notices')
where exists (select 1 from cron.job where jobname = 'billing-trial-expiry-notices');

select cron.schedule(
  'billing-trial-expiry-notices',
  '0 12 * * *',
  $$ select app_private.enqueue_trial_expiry_notices(); $$
);
