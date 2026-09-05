-- pgTAP coverage for 20260905080000: a reportable-incident deadline starts when the facility knows.
--
-- create_incident_notification_presets anchored every deadline at `occurred_at`, always -- so a
-- determination made days after the event created a notification that was already overdue, which
-- recalculate_incident_notifications then raised as a CRITICAL alert and the incident file printed
-- as a missed state deadline for a duty that did not exist until the determination. Nothing tested
-- the anchor, and the windows themselves were literals in the function body with no citation.
-- Run with: supabase test db (requires the local Supabase Docker stack).

begin;
select plan(12);

insert into public.organizations(id, name, slug) values
  ('8c000000-0000-4000-8000-000000000001', 'Incident Org', 'incident-anchor-org');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('8c000000-0000-4000-8000-000000000011', '8c000000-0000-4000-8000-000000000001', 'Incident Facility', 'PCH');

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values (
  '00000000-0000-0000-0000-000000000000', '8c000000-0000-4000-8000-000000000021', 'authenticated',
  'authenticated', 'incident-admin@test.local', 'x', now(), '{}'::jsonb, '{}'::jsonb, now(), now(),
  '', '', '', '', '', '', false, false
);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('8c000000-0000-4000-8000-000000000021', '8c000000-0000-4000-8000-000000000001',
   'incident-admin@test.local', 'Morgan', 'Manager', 'org_admin', true)
on conflict (id) do update set organization_id = excluded.organization_id, role = 'org_admin', is_active = true;
select set_config('app.privileged_write', 'off', true);

create or replace function pg_temp.act_as(p_profile_id uuid)
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_profile_id, 'role', 'authenticated', 'aal', 'aal2',
    'iat', extract(epoch from now())::bigint
  )::text, true);
  set local role authenticated;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- The case that produced a false missed deadline: stood down, then reinstated days later.
-- ---------------------------------------------------------------------------------------
-- A resident falls on Monday. Staff judge the injury minor and record it as not reportable, which
-- stands the notification down. On Thursday the emergency room comes back with a fracture and the
-- determination is reversed. The duty arose on Thursday.
--
-- `significant_injury` is auto-reportable at insert (app_private.default_incident_reportability),
-- so the notification already exists, anchored at the event -- which is precisely why reinstating
-- it used to revive a deadline three days in the past.
insert into public.incidents(
  id, organization_id, facility_id, incident_type, occurred_at, reported_at,
  narrative, severity, status
) values (
  '8c000000-0000-4000-8000-000000000101', '8c000000-0000-4000-8000-000000000001',
  '8c000000-0000-4000-8000-000000000011', 'significant_injury',
  now() - interval '3 days', now() - interval '3 days',
  'Resident fell in the corridor and was sent for evaluation.', 'major', 'investigating'
);

select pg_temp.act_as('8c000000-0000-4000-8000-000000000021');
select lives_ok(
  $$ select public.determine_incident_reportability(
       '8c000000-0000-4000-8000-000000000101', 'not_reportable',
       'Examined on site; no apparent injury beyond bruising.') $$,
  'the fall is first recorded as not reportable'
);

select is(
  (select status from public.incident_notifications
   where incident_id = '8c000000-0000-4000-8000-000000000101'
     and notification_type = 'state_hotline'),
  'not_required',
  'which stands the notification down without destroying it'
);

select lives_ok(
  $$ select public.determine_incident_reportability(
       '8c000000-0000-4000-8000-000000000101', 'reportable',
       'Emergency room confirmed a fracture; this meets the reporting threshold.') $$,
  'and three days later the emergency room results reverse that'
);
reset role;

-- This is the assertion the row is about. Restoring the original due_at revived a deadline that had
-- passed 71 hours earlier.
select ok(
  (select due_at from public.incident_notifications
   where incident_id = '8c000000-0000-4000-8000-000000000101'
     and notification_type = 'state_hotline') > now(),
  'the reinstated notification is due in the FUTURE, not already overdue the moment it comes back'
);

select ok(
  (select due_at from public.incident_notifications
   where incident_id = '8c000000-0000-4000-8000-000000000101'
     and notification_type = 'state_hotline')
    between now() + interval '23 hours' and now() + interval '25 hours',
  'and it is the rule''s own window measured from the determination that reinstated it'
);

-- The alert this used to raise is the visible harm: a critical "missed state deadline" on a
-- facility that missed nothing.
select set_config('app.privileged_write', 'on', true);
select public.recalculate_incident_notifications();
select set_config('app.privileged_write', 'off', true);

select is(
  (select status from public.incident_notifications
   where incident_id = '8c000000-0000-4000-8000-000000000101'
     and notification_type = 'state_hotline'),
  'pending',
  'the notification is pending, not overdue'
);

select is(
  (select count(*)::int from public.alerts a
   join public.incident_notifications n on n.id = a.incident_notification_id
   where n.incident_id = '8c000000-0000-4000-8000-000000000101'
     and a.alert_type = 'incident_notification_overdue'),
  0,
  'and no critical overdue alert is raised for a duty that is minutes old'
);

-- ---------------------------------------------------------------------------------------
-- An incident whose type settles it: the presets are created at insert, from reported_at.
-- ---------------------------------------------------------------------------------------
insert into public.incidents(
  id, organization_id, facility_id, incident_type, occurred_at, reported_at,
  narrative, severity, status, reportability_status
) values (
  '8c000000-0000-4000-8000-000000000102', '8c000000-0000-4000-8000-000000000001',
  '8c000000-0000-4000-8000-000000000011', 'death',
  now() - interval '30 minutes', now() - interval '20 minutes',
  'Resident died overnight; coroner notified.', 'critical', 'reported', 'reportable'
);

select ok(
  (select due_at from public.incident_notifications
   where incident_id = '8c000000-0000-4000-8000-000000000102'
     and notification_type = 'state_hotline') > now(),
  'a death reported immediately still gets a live deadline, not one measured from a stale event time'
);

-- Anchored at reported_at (20 minutes ago), not occurred_at (30) -- the difference matters most
-- when someone finds the resident hours after the event.
select ok(
  (select due_at from public.incident_notifications
   where incident_id = '8c000000-0000-4000-8000-000000000102'
     and notification_type = 'state_hotline')
    > (select occurred_at from public.incidents where id = '8c000000-0000-4000-8000-000000000102')
      + interval '2 hours',
  'and it runs from when the facility knew, not from when the event occurred'
);

-- ---------------------------------------------------------------------------------------
-- The windows are data with a source, not literals in a function body.
-- ---------------------------------------------------------------------------------------
select is(
  (select count(*)::int from public.incident_notification_rules where citation is null),
  0,
  'no reporting window exists without a citation -- the column refuses it'
);

-- The two-hour rows are the open regulatory question. Marking them is how the next person knows
-- the value has not been checked, rather than reconstructing it from a commit message.
select is(
  (select count(*)::int from public.incident_notification_rules
   where due_hours = 2 and source_confidence = 'verified'),
  0,
  'the two-hour windows are still marked unverified, because the regulation has not been read yet'
);

select ok(
  not has_table_privilege('authenticated', 'public.incident_notification_rules', 'UPDATE'),
  'and nobody can change a reporting deadline through the API -- that is a reviewed migration'
);

select * from finish();
rollback;
