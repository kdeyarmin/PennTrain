-- pgTAP coverage for 20260905320000 (I23).
--
-- prepare_notification_delivery carried the comment "These are non-emergency compliance/training
-- messages. SMS is deferred to the next 08:00-21:00 window" -- and then deferred EVERY SMS, with no
-- test of what the message was. A resident falls at 2 AM, the manager's phone stays silent until
-- 08:00, and the reportable-incident clock in 55 Pa. Code has been running six hours by the time
-- anyone reads it. Run with: supabase test db.

begin;
select plan(14);

select has_function(
  'public', 'notification_bypasses_quiet_hours', array['uuid', 'text'],
  'one predicate decides which messages quiet hours may not hold'
);
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('prepare_notification_delivery', 'retry_notification_delivery',
                       'begin_notification_delivery_attempt')
     and p.prosrc like '%notification_bypasses_quiet_hours%'),
  3,
  'and all three places quiet hours is applied ask it'
);

------------------------------------------------------------------------------------------------
-- Fixture: one organization, one consenting SMS recipient in Pennsylvania
------------------------------------------------------------------------------------------------
insert into public.organizations(id, name, slug, subscription_status) values
  ('1a000000-0000-4000-8000-000000000001', 'Quiet Hours Org', 'quiet-hours-org', 'active');
insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values (
  '00000000-0000-0000-0000-000000000000', '1a000000-0000-4000-8000-000000000002',
  'authenticated', 'authenticated', 'quiet-hours-manager@test.local', 'x', now(), '{}', '{}',
  now(), now(), '', '', '', '', '', '', false, false
);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(
  id, organization_id, email, phone, first_name, last_name, role, is_active,
  notification_timezone, sms_opt_in, sms_consent_at
) values (
  '1a000000-0000-4000-8000-000000000002', '1a000000-0000-4000-8000-000000000001',
  'quiet-hours-manager@test.local', '+12155550199', 'Quiet', 'Manager', 'facility_manager', true,
  'America/New_York', true, now()
)
on conflict (id) do update set
  organization_id = excluded.organization_id, phone = excluded.phone, role = excluded.role,
  is_active = true, notification_timezone = excluded.notification_timezone,
  sms_opt_in = true, sms_consent_at = excluded.sms_consent_at;
select set_config('app.privileged_write', 'off', true);

insert into public.notifications(id, organization_id, profile_id, notification_type, title, body) values
  ('1a000000-0000-4000-8000-000000000011', '1a000000-0000-4000-8000-000000000001',
   '1a000000-0000-4000-8000-000000000002', 'incident_reported',
   'Incident reported', 'A resident fall was reported.'),
  ('1a000000-0000-4000-8000-000000000012', '1a000000-0000-4000-8000-000000000001',
   '1a000000-0000-4000-8000-000000000002', 'training_due_soon',
   'Training due soon', 'Fire safety is due in seven days.'),
  ('1a000000-0000-4000-8000-000000000013', '1a000000-0000-4000-8000-000000000001',
   '1a000000-0000-4000-8000-000000000002', 'shift_handoff_escalated',
   'Handoff escalated', 'A shift handoff was not acknowledged.');

------------------------------------------------------------------------------------------------
-- The predicate
------------------------------------------------------------------------------------------------
select ok(
  public.notification_bypasses_quiet_hours('1a000000-0000-4000-8000-000000000011', 'alert'),
  'a reported incident reaches a phone at any hour'
);
select ok(
  public.notification_bypasses_quiet_hours('1a000000-0000-4000-8000-000000000013', 'alert'),
  'so does an escalated shift handoff -- waiting is the failure it exists to report'
);
select ok(
  public.notification_bypasses_quiet_hours('1a000000-0000-4000-8000-000000000012', 'escalation'),
  'and so does anything sent as an escalation, whatever it is about'
);
select ok(
  not public.notification_bypasses_quiet_hours('1a000000-0000-4000-8000-000000000012', 'alert'),
  'while a training reminder does not -- which is what quiet hours is for'
);
select ok(
  not public.notification_bypasses_quiet_hours(null, 'alert'),
  'and an unidentifiable message defers, because an unknown 3 AM SMS is how a facility switches the channel off'
);

------------------------------------------------------------------------------------------------
-- End to end, through the trigger, at two in the morning
------------------------------------------------------------------------------------------------
-- TOMORROW at 02:00 Pennsylvania time, not a fixed past date: prepare_notification_delivery takes
-- `greatest(coalesce(next_attempt_at, now()), now())`, so a requested time in the past is clamped
-- to now and the assertion would be measuring the clamp rather than the deferral. (Found by writing
-- it the other way first.)
create or replace function pg_temp.at_2am() returns timestamptz language sql stable as $$
  select ((public.pa_today() + 1) + time '02:00') at time zone 'America/New_York';
$$;
create or replace function pg_temp.at_8am() returns timestamptz language sql stable as $$
  select ((public.pa_today() + 1) + time '08:00') at time zone 'America/New_York';
$$;

create or replace function pg_temp.deliver_at_2am(p_notification uuid, p_type text, p_id uuid)
returns void language plpgsql as $$
begin
  insert into public.notification_deliveries(
    id, organization_id, profile_id, notification_id, channel, delivery_type, recipient, status,
    next_attempt_at
  ) values (
    p_id, '1a000000-0000-4000-8000-000000000001', '1a000000-0000-4000-8000-000000000002',
    p_notification, 'sms', p_type, '+12155550199', 'pending',
    pg_temp.at_2am()
  );
end $$;

select pg_temp.deliver_at_2am(
  '1a000000-0000-4000-8000-000000000011', 'alert', '1a000000-0000-4000-8000-000000000021');
select pg_temp.deliver_at_2am(
  '1a000000-0000-4000-8000-000000000012', 'alert', '1a000000-0000-4000-8000-000000000022');
select pg_temp.deliver_at_2am(
  '1a000000-0000-4000-8000-000000000013', 'alert', '1a000000-0000-4000-8000-000000000023');

select is(
  (select next_attempt_at from public.notification_deliveries
   where id = '1a000000-0000-4000-8000-000000000021'),
  pg_temp.at_2am(),
  'the incident SMS keeps its requested 2 AM send time'
);
select is(
  (select quiet_hours_deferred_count from public.notification_deliveries
   where id = '1a000000-0000-4000-8000-000000000021'),
  0,
  'and is not counted as deferred'
);
select is(
  (select next_attempt_at from public.notification_deliveries
   where id = '1a000000-0000-4000-8000-000000000022'),
  pg_temp.at_8am(),
  'the training reminder is held to 08:00 Pennsylvania time, as before'
);
select is(
  (select quiet_hours_deferred_count from public.notification_deliveries
   where id = '1a000000-0000-4000-8000-000000000022'),
  1,
  'and is counted, so the deferral is visible on the delivery record'
);
select is(
  (select next_attempt_at from public.notification_deliveries
   where id = '1a000000-0000-4000-8000-000000000023'),
  pg_temp.at_2am(),
  'and the escalated handoff goes at 2 AM too'
);

-- The rule that quiet hours protects has not moved.
select is(
  public.notification_next_permitted_at('2026-01-15 07:00:00+00', 'America/New_York'),
  '2026-01-15 13:00:00+00'::timestamptz,
  'notification_next_permitted_at itself is unchanged -- this is an exemption, not a weakening'
);
select is(
  public.notification_next_permitted_at('2026-01-15 18:00:00+00', 'America/New_York'),
  '2026-01-15 18:00:00+00'::timestamptz,
  'and a message inside the window still goes when it was asked to'
);

select * from finish();
rollback;
