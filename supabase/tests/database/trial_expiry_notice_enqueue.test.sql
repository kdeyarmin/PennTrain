-- PT-052: the daily trial-expiry notice enqueue notifies active org admins at
-- T-7 and T-1 before organizations.trial_ends_at, skips orgs with a live
-- subscription, lapsed/far-out windows, and demo tenants, and is idempotent
-- per (organization, threshold, trial window).
begin;
select plan(12);

insert into public.organizations (id, name, slug, subscription_status, trial_ends_at, is_demo, demo_seed_version)
values
  ('34000000-0000-4000-8000-000000000021', 'Notice T7 Org', 'notice-t7-org', 'trial',
   now() + interval '5 days', false, null),
  ('34000000-0000-4000-8000-000000000022', 'Notice T1 Org', 'notice-t1-org', 'trial',
   now() + interval '12 hours', false, null),
  ('34000000-0000-4000-8000-000000000023', 'Notice Lapsed Org', 'notice-lapsed-org', 'trial',
   now() - interval '1 day', false, null),
  ('34000000-0000-4000-8000-000000000024', 'Notice Far Org', 'notice-far-org', 'trial',
   now() + interval '20 days', false, null),
  ('34000000-0000-4000-8000-000000000025', 'Notice Subscribed Org', 'notice-subscribed-org', 'trial',
   now() + interval '3 days', false, null),
  ('34000000-0000-4000-8000-000000000026', 'Notice Demo Org', 'notice-demo-org', 'trial',
   now() + interval '3 days', true, 1);

-- A live subscription overrides the in-app trial window.
insert into public.billing_subscriptions (
  organization_id, billing_account_id, stripe_subscription_id,
  provider_status, billing_state, seat_quantity,
  provider_event_created_at, provider_event_id
)
select
  '34000000-0000-4000-8000-000000000025', a.id, 'sub_noticeLive',
  'active', 'active', 4, now(), 'evt_notice_live'
from public.billing_accounts a
where a.organization_id = '34000000-0000-4000-8000-000000000025';

-- Email deliveries enabled only for the T-1 org, to observe both the
-- delivery-enqueued and in-app-only paths.
insert into public.organization_settings (organization_id, email_notifications_enabled)
values ('34000000-0000-4000-8000-000000000022', true)
on conflict (organization_id) do update set email_notifications_enabled = true;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
)
select
  '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated',
  v.email, 'x', now(), '{}'::jsonb, '{}'::jsonb, now(), now(),
  '', '', '', '', '', '', false, false
from (values
  ('34000000-0000-4000-8000-000000000201'::uuid, 'notice-t7-admin@test.local'),
  ('34000000-0000-4000-8000-000000000202'::uuid, 'notice-t7-inactive@test.local'),
  ('34000000-0000-4000-8000-000000000203'::uuid, 'notice-t7-manager@test.local'),
  ('34000000-0000-4000-8000-000000000204'::uuid, 'notice-t1-admin@test.local'),
  ('34000000-0000-4000-8000-000000000205'::uuid, 'notice-sub-admin@test.local'),
  ('34000000-0000-4000-8000-000000000206'::uuid, 'notice-demo-admin@test.local'),
  ('34000000-0000-4000-8000-000000000207'::uuid, 'notice-lapsed-admin@test.local')
) v(id, email);

select set_config('app.privileged_write', 'on', true);
insert into public.profiles (
  id, organization_id, email, first_name, last_name, role, is_active
) values
  ('34000000-0000-4000-8000-000000000201', '34000000-0000-4000-8000-000000000021',
   'notice-t7-admin@test.local', 'Notice', 'AdminA', 'org_admin', true),
  ('34000000-0000-4000-8000-000000000202', '34000000-0000-4000-8000-000000000021',
   'notice-t7-inactive@test.local', 'Notice', 'Inactive', 'org_admin', false),
  ('34000000-0000-4000-8000-000000000203', '34000000-0000-4000-8000-000000000021',
   'notice-t7-manager@test.local', 'Notice', 'Manager', 'facility_manager', true),
  ('34000000-0000-4000-8000-000000000204', '34000000-0000-4000-8000-000000000022',
   'notice-t1-admin@test.local', 'Notice', 'AdminB', 'org_admin', true),
  ('34000000-0000-4000-8000-000000000205', '34000000-0000-4000-8000-000000000025',
   'notice-sub-admin@test.local', 'Notice', 'AdminC', 'org_admin', true),
  ('34000000-0000-4000-8000-000000000206', '34000000-0000-4000-8000-000000000026',
   'notice-demo-admin@test.local', 'Notice', 'AdminD', 'org_admin', true),
  ('34000000-0000-4000-8000-000000000207', '34000000-0000-4000-8000-000000000023',
   'notice-lapsed-admin@test.local', 'Notice', 'AdminE', 'org_admin', true)
on conflict (id) do update set
  organization_id = excluded.organization_id,
  email = excluded.email,
  role = excluded.role,
  is_active = excluded.is_active;
select set_config('app.privileged_write', 'off', true);

-- First daily run: one notice each for the T-7 and T-1 org admins; nothing
-- for inactive admins, non-admin roles, live-subscription, demo, lapsed, or
-- far-out orgs.
select is(
  app_private.enqueue_trial_expiry_notices(),
  2,
  'the first run enqueues one notice per eligible org admin'
);
select results_eq(
  $$ select notification_type, title from public.notifications
     where profile_id = '34000000-0000-4000-8000-000000000201' $$,
  $$ values ('billing_trial_expiring'::text, 'Your free trial is ending soon'::text) $$,
  'the T-7 admin receives the ending-soon notice'
);
select results_eq(
  $$ select notification_type, title from public.notifications
     where profile_id = '34000000-0000-4000-8000-000000000204' $$,
  $$ values ('billing_trial_expiring'::text, 'Your free trial ends tomorrow'::text) $$,
  'the T-1 admin receives the ends-tomorrow notice'
);
select is(
  (select count(*)::integer from public.notifications
   where notification_type = 'billing_trial_expiring'),
  2,
  'no notices go to inactive admins, managers, subscribed, demo, lapsed, or far-out orgs'
);
select results_eq(
  $$ select organization_id, threshold_days from app_private.billing_trial_notice_log
     order by threshold_days $$,
  $$ values ('34000000-0000-4000-8000-000000000022'::uuid, 1),
       ('34000000-0000-4000-8000-000000000021'::uuid, 7) $$,
  'each notice is recorded in the dedupe ledger under its threshold'
);
select is(
  (select count(*)::integer from public.notification_deliveries d
   join public.notifications n on n.id = d.notification_id
   where n.notification_type = 'billing_trial_expiring'
     and d.channel = 'email'
     and d.organization_id = '34000000-0000-4000-8000-000000000022'),
  1,
  'the email-enabled org gets an email delivery through the existing engine'
);
select is(
  (select count(*)::integer from public.notification_deliveries d
   join public.notifications n on n.id = d.notification_id
   where n.notification_type = 'billing_trial_expiring'
     and d.organization_id = '34000000-0000-4000-8000-000000000021'),
  0,
  'an org without delivery channels enabled stays in-app only'
);

-- Second daily run: fully idempotent for the same windows.
select is(
  app_private.enqueue_trial_expiry_notices(),
  0,
  'a same-day or catch-up re-run enqueues nothing new'
);
select is(
  (select count(*)::integer from public.notifications
   where notification_type = 'billing_trial_expiring'),
  2,
  'no duplicate notices after the re-run'
);

-- The T-7 org reaches its final day: the T-1 threshold fires exactly once.
update public.organizations
set trial_ends_at = now() + interval '12 hours'
where id = '34000000-0000-4000-8000-000000000021';
select is(
  app_private.enqueue_trial_expiry_notices(),
  1,
  'entering the final day fires the T-1 notice for the already-warned org'
);
select results_eq(
  $$ select title from public.notifications
     where profile_id = '34000000-0000-4000-8000-000000000201'
     order by created_at, title $$,
  $$ values ('Your free trial ends tomorrow'::text),
       ('Your free trial is ending soon'::text) $$,
  'the T-7 admin now holds both the ending-soon and ends-tomorrow notices'
);
select is(
  (select count(*)::integer from app_private.billing_trial_notice_log),
  3,
  'the dedupe ledger holds one row per org, threshold, and trial window'
);

select * from finish();
rollback;
