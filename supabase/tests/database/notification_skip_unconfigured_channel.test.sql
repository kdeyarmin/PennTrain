-- pgTAP coverage for 20260905100000: an unconfigured channel is skipped, not failed.
--
-- Until the provider secrets are set, dispatch-notifications answered `provider_not_configured` as
-- a non-retryable PROVIDER FAILURE, and complete_notification_delivery_attempt finalized the row
-- `status = 'failed'`, `final_outcome = 'failed'` -- which is the exact pair
-- enqueue_notification_fallback fires on. So a deployment with no providers configured opened a
-- second delivery on the alternate channel, stamped "alternate_channel_after_permanent_failure",
-- for a message that never had a way to be sent; that one failed too, and both counted toward the
-- tally that opens the dispatch circuit breaker.
--
-- This is block 2's row (BACKLOG I13's deferred half): it is what the operator reads when they set
-- the SendGrid and Twilio secrets and follow one real email and one real SMS to `delivered`.
-- Run with: supabase test db (requires the local Supabase Docker stack).

begin;
select plan(9);

insert into public.organizations(id, name, slug) values
  ('af000000-0000-4000-8000-000000000001', 'Notify Org', 'notify-skip-org');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('af000000-0000-4000-8000-000000000011', 'af000000-0000-4000-8000-000000000001', 'Notify Facility', 'PCH');

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values (
  '00000000-0000-0000-0000-000000000000', 'af000000-0000-4000-8000-000000000021', 'authenticated',
  'authenticated', 'notify-target@test.local', 'x', now(), '{}'::jsonb, '{}'::jsonb, now(), now(),
  '', '', '', '', '', '', false, false
);

select set_config('app.privileged_write', 'on', true);
insert into public.profiles(
  id, organization_id, email, first_name, last_name, role, is_active,
  phone, sms_opt_in, sms_consent_at, email_opt_out
) values (
  'af000000-0000-4000-8000-000000000021', 'af000000-0000-4000-8000-000000000001',
  'notify-target@test.local', 'Nadia', 'Nurse', 'facility_manager', true,
  '+15555550123', true, now(), false
-- handle_new_user already created this profile from the auth row, so the conflict branch has to
-- set the SMS fields too: without them the fallback trigger correctly declines to open an SMS
-- delivery, and the defect below would look fixed when it is only unreachable.
) on conflict (id) do update set
  organization_id = excluded.organization_id, role = 'facility_manager', is_active = true,
  phone = excluded.phone, sms_opt_in = true, sms_consent_at = excluded.sms_consent_at,
  email_opt_out = false, email = excluded.email;

-- Both channels on, and fallback armed. This is the configuration the defect needs: without
-- fallback enabled the second delivery is never created and the bug is invisible.
insert into public.organization_settings(organization_id, email_notifications_enabled, sms_notifications_enabled)
values ('af000000-0000-4000-8000-000000000001', true, true)
on conflict (organization_id) do update set
  email_notifications_enabled = true, sms_notifications_enabled = true;
insert into public.notification_channel_policies(organization_id, fallback_enabled, fallback_delay_minutes, max_fallback_depth)
values ('af000000-0000-4000-8000-000000000001', true, 15, 1)
on conflict (organization_id) do update set fallback_enabled = true, max_fallback_depth = 1;

-- Two identical email deliveries, claimed. One is finalized the way an unconfigured channel used
-- to be (failed), the other the way it is now (skipped).
insert into public.notification_deliveries(
  id, organization_id, profile_id, channel, delivery_type, recipient, status
) values
  ('af000000-0000-4000-8000-000000000031', 'af000000-0000-4000-8000-000000000001',
   'af000000-0000-4000-8000-000000000021', 'email', 'alert', 'notify-target@test.local', 'processing'),
  ('af000000-0000-4000-8000-000000000032', 'af000000-0000-4000-8000-000000000001',
   'af000000-0000-4000-8000-000000000021', 'email', 'alert', 'notify-target@test.local', 'processing');
select set_config('app.privileged_write', 'off', true);

-- ---------------------------------------------------------------------------------------
-- The old behaviour, reproduced: a "failure" that invents an escalation.
-- ---------------------------------------------------------------------------------------
select set_config('app.privileged_write', 'on', true);
update public.notification_deliveries
set status = 'failed', final_outcome = 'failed', finalized_at = now(),
    error_code = 'provider_not_configured',
    error_message = 'SendGrid delivery is not configured for this deployment'
where id = 'af000000-0000-4000-8000-000000000031';
select set_config('app.privileged_write', 'off', true);

select is(
  (select count(*)::int from public.notification_deliveries
   where parent_delivery_id = 'af000000-0000-4000-8000-000000000031'),
  1,
  'recording an unconfigured channel as FAILED opens a delivery on the alternate channel'
);

select is(
  (select escalation_reason from public.notification_deliveries
   where parent_delivery_id = 'af000000-0000-4000-8000-000000000031'),
  'alternate_channel_after_permanent_failure',
  'stamped as following a permanent failure -- for a message that never had a way to be sent'
);

select is(
  (select channel from public.notification_deliveries
   where parent_delivery_id = 'af000000-0000-4000-8000-000000000031'),
  'sms',
  'and on a deployment with neither provider set, the alternate is equally unconfigured'
);

-- ---------------------------------------------------------------------------------------
-- The new behaviour: nothing was attempted, so nothing failed.
-- ---------------------------------------------------------------------------------------
select lives_ok(
  $$ select public.skip_notification_delivery(
       'af000000-0000-4000-8000-000000000032',
       'The email provider has no credentials in this deployment, so no attempt was made',
       'provider_not_configured') $$,
  'a claimed delivery on an unconfigured channel is skipped'
);

select is(
  (select status from public.notification_deliveries where id = 'af000000-0000-4000-8000-000000000032'),
  'skipped',
  'and reads as skipped in the operator surface, not as a provider rejection'
);

select is(
  (select final_outcome from public.notification_deliveries where id = 'af000000-0000-4000-8000-000000000032'),
  null,
  'with no final outcome -- the delivery reached none'
);

-- The assertion the whole change is for.
select is(
  (select count(*)::int from public.notification_deliveries
   where parent_delivery_id = 'af000000-0000-4000-8000-000000000032'),
  0,
  'so no alternate-channel escalation is invented, with no change to the fallback trigger itself'
);

select is(
  (select error_code from public.notification_deliveries where id = 'af000000-0000-4000-8000-000000000032'),
  'provider_not_configured',
  'the reason is still on the row, so the operator can tell WHY it was skipped'
);

-- ---------------------------------------------------------------------------------------
-- It cannot be used to rewrite a delivery that already has an answer.
-- ---------------------------------------------------------------------------------------
select lives_ok(
  $$ select public.skip_notification_delivery(
       'af000000-0000-4000-8000-000000000031', 'Trying to skip an already-failed delivery',
       'provider_not_configured') $$,
  'skipping a delivery that is no longer processing is a no-op, not an error'
);

select * from finish();
rollback;
