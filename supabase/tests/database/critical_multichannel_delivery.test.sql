begin;
select plan(12);

-- Critical multi-channel delivery: the five critical notification types fan out to BOTH
-- email and SMS behind the 'notifications.critical_multichannel' flag, but only for
-- recipients with both channels deliverable; non-critical types and the flag-off state
-- keep the single-channel behavior exactly.

select results_eq(
  $$ select rollout_mode, is_enabled from public.release_flags
     where feature_key = 'notifications.critical_multichannel' $$,
  $$ values ('off'::text, false) $$,
  'the critical-multichannel release flag is seeded default-off'
);
select ok(
  exists (select 1 from public.feature_definitions
          where feature_key = 'notifications.critical_multichannel'),
  'the critical-multichannel feature definition is registered'
);
select ok(
  not has_function_privilege(
    'authenticated', 'public.enqueue_critical_notification_delivery(uuid,uuid,uuid,text)', 'EXECUTE'
  ),
  'the multi-channel enqueue helper is not callable by clients'
);

insert into public.organizations (id, name, slug) values
  ('1a000000-0000-0000-0000-000000000001', 'Critical Channels A', 'critical-channels-a');
insert into public.organization_settings (
  organization_id, email_notifications_enabled, sms_notifications_enabled
) values
  ('1a000000-0000-0000-0000-000000000001', true, true);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
)
select '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated', v.email,
  'x', now(), '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '', '', '', false, false
from (values
  ('1a000000-0000-0000-0000-000000000020'::uuid, 'crit-platform@test.local'),
  ('1a000000-0000-0000-0000-000000000021'::uuid, 'crit-both@test.local'),
  ('1a000000-0000-0000-0000-000000000022'::uuid, 'crit-email-only@test.local')
) as v(id, email);

-- Worker "both": email + fully-consented SMS. Worker "email-only": no SMS consent/phone.
select set_config('app.privileged_write', 'on', true);
insert into public.profiles (
  id, organization_id, first_name, last_name, email, role, is_active,
  preferred_notification_channel, sms_opt_in, sms_consent_at, phone
) values
  ('1a000000-0000-0000-0000-000000000020', null, 'Crit', 'Platform',
   'crit-platform@test.local', 'platform_admin', true, 'email', false, null, null),
  ('1a000000-0000-0000-0000-000000000021', '1a000000-0000-0000-0000-000000000001',
   'Crit', 'Both', 'crit-both@test.local', 'employee', true,
   'email', true, now(), '+15555550021'),
  ('1a000000-0000-0000-0000-000000000022', '1a000000-0000-0000-0000-000000000001',
   'Crit', 'EmailOnly', 'crit-email-only@test.local', 'employee', true,
   'email', false, null, null)
on conflict (id) do update set
  organization_id = excluded.organization_id, role = excluded.role, is_active = true,
  preferred_notification_channel = excluded.preferred_notification_channel,
  sms_opt_in = excluded.sms_opt_in, sms_consent_at = excluded.sms_consent_at,
  phone = excluded.phone;
select set_config('app.privileged_write', 'off', true);

create or replace function pg_temp.act_as(p_profile_id uuid, p_aal text default 'aal2')
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_profile_id, 'role', 'authenticated', 'aal', p_aal,
    'iat', extract(epoch from now())::bigint)::text, true);
  set local role authenticated;
end $$;

-- Flag off (default): a critical type still queues exactly one (single-channel) delivery.
insert into public.notifications (id, organization_id, profile_id, notification_type, title, body, link)
values ('1a000000-0000-0000-0000-000000000101', '1a000000-0000-0000-0000-000000000001',
        '1a000000-0000-0000-0000-000000000021', 'training_expired', 'Lapsed', 'Body', '/me');
select results_eq(
  $$ select count(*)::int from public.notification_deliveries
     where notification_id = '1a000000-0000-0000-0000-000000000101' $$,
  array[1],
  'with the flag off, a critical type queues a single delivery'
);

-- Enable globally as an AAL2 platform admin.
select pg_temp.act_as('1a000000-0000-0000-0000-000000000020', 'aal2');
select lives_ok(
  $$ select public.set_release_flag(
       'notifications.critical_multichannel', 'global', true,
       'notifications', 'pgTAP: enable critical multichannel', null) $$,
  'a platform admin with step-up can enable the flag'
);
reset role;

-- Flag on + both channels deliverable: the critical type fans out to email AND sms.
insert into public.notifications (id, organization_id, profile_id, notification_type, title, body, link)
values ('1a000000-0000-0000-0000-000000000201', '1a000000-0000-0000-0000-000000000001',
        '1a000000-0000-0000-0000-000000000021', 'training_expired', 'Lapsed', 'Body', '/me');
select results_eq(
  $$ select count(*)::int from public.notification_deliveries
     where notification_id = '1a000000-0000-0000-0000-000000000201' $$,
  array[2],
  'a critical type reaches a dual-channel recipient on two channels'
);
select results_eq(
  $$ select channel from public.notification_deliveries
     where notification_id = '1a000000-0000-0000-0000-000000000201' order by channel $$,
  $$ values ('email'::text), ('sms'::text) $$,
  'the two critical deliveries are one email and one SMS'
);
select results_eq(
  $$ select recipient from public.notification_deliveries
     where notification_id = '1a000000-0000-0000-0000-000000000201' and channel = 'sms' $$,
  array['+15555550021'::text],
  'the SMS delivery targets the recipient phone'
);

-- Flag on but recipient has only email: the critical type stays single-channel.
insert into public.notifications (id, organization_id, profile_id, notification_type, title, body, link)
values ('1a000000-0000-0000-0000-000000000202', '1a000000-0000-0000-0000-000000000001',
        '1a000000-0000-0000-0000-000000000022', 'training_expired', 'Lapsed', 'Body', '/me');
select results_eq(
  $$ select channel from public.notification_deliveries
     where notification_id = '1a000000-0000-0000-0000-000000000202' $$,
  array['email'::text],
  'a recipient without SMS consent still gets exactly the email'
);

-- Non-critical type with the flag on stays single-channel even for a dual-channel recipient.
insert into public.notifications (id, organization_id, profile_id, notification_type, title, body, link)
values ('1a000000-0000-0000-0000-000000000203', '1a000000-0000-0000-0000-000000000001',
        '1a000000-0000-0000-0000-000000000021', 'training_due_soon', 'Soon', 'Body', '/me');
select results_eq(
  $$ select count(*)::int from public.notification_deliveries
     where notification_id = '1a000000-0000-0000-0000-000000000203' $$,
  array[1],
  'a non-critical type stays single-channel with the flag on'
);

-- Global kill switch dominates the release: critical types revert to single-channel.
select pg_temp.act_as('1a000000-0000-0000-0000-000000000020', 'aal2');
select lives_ok(
  $$ select public.set_feature_kill_switch(
       'notifications.critical_multichannel', null, true,
       'pgTAP: global emergency disable', null) $$,
  'a platform admin with step-up can activate a global kill switch'
);
reset role;
insert into public.notifications (id, organization_id, profile_id, notification_type, title, body, link)
values ('1a000000-0000-0000-0000-000000000204', '1a000000-0000-0000-0000-000000000001',
        '1a000000-0000-0000-0000-000000000021', 'training_expired', 'Lapsed', 'Body', '/me');
select results_eq(
  $$ select count(*)::int from public.notification_deliveries
     where notification_id = '1a000000-0000-0000-0000-000000000204' $$,
  array[1],
  'a global kill switch reverts critical delivery to single-channel'
);

select * from finish();
rollback;
