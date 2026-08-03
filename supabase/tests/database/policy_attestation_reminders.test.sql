begin;
select plan(19);

-- send_policy_attestation_reminders() has run daily since 20260711162509 with no test coverage.
-- These are the targeting rules it is supposed to follow. The headline one is the stamp
-- assertion: an attestation the sweep could not notify must not come back marked as reminded.
--
-- Fixture note: stamp_scope_from_employee_for_attestation overwrites every attestation's due_date
-- from its campaign, unconditionally -- a per-attestation due date passed at insert is discarded.
-- So "due soon", "overdue" and "far off" have to be three campaigns, not three attestations.

------------------------------------------------------------------------------------------------
-- Fixture
------------------------------------------------------------------------------------------------
insert into public.organizations(id, name, slug, subscription_status) values
  ('a1000000-0000-4000-8000-000000000001', 'Reminder Org', 'reminder-org', 'active');

insert into public.facilities(id, organization_id, name, facility_type, is_sandbox, sandbox_seed_version) values
  ('a1000000-0000-4000-8000-000000000011', 'a1000000-0000-4000-8000-000000000001', 'Reminder One', 'PCH', false, null);

insert into auth.users(
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at,
  confirmation_token,recovery_token,email_change_token_new,email_change,
  email_change_token_current,reauthentication_token,is_sso_user,is_anonymous
)
select
  '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated',
  v.email, 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false
from (values
  ('a1000000-0000-4000-8000-000000000101'::uuid, 'reminder-linked@test.local'),
  ('a1000000-0000-4000-8000-000000000102'::uuid, 'reminder-invited-later@test.local'),
  ('a1000000-0000-4000-8000-000000000103'::uuid, 'reminder-terminated@test.local'),
  ('a1000000-0000-4000-8000-000000000104'::uuid, 'reminder-deactivated@test.local'),
  ('a1000000-0000-4000-8000-000000000105'::uuid, 'reminder-overdue@test.local'),
  ('a1000000-0000-4000-8000-000000000106'::uuid, 'reminder-faroff@test.local')
) as v(id,email);

select set_config('app.privileged_write','on',true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('a1000000-0000-4000-8000-000000000101', 'a1000000-0000-4000-8000-000000000001', 'reminder-linked@test.local', 'R', 'Linked', 'employee', true),
  ('a1000000-0000-4000-8000-000000000102', 'a1000000-0000-4000-8000-000000000001', 'reminder-invited-later@test.local', 'R', 'Later', 'employee', true),
  ('a1000000-0000-4000-8000-000000000103', 'a1000000-0000-4000-8000-000000000001', 'reminder-terminated@test.local', 'R', 'Terminated', 'employee', true),
  ('a1000000-0000-4000-8000-000000000104', 'a1000000-0000-4000-8000-000000000001', 'reminder-deactivated@test.local', 'R', 'Deactivated', 'employee', false),
  -- Promoted off the floor: still on the roster, no longer in the employee portal. The link
  -- assertions below are about this person -- see BACKLOG.md E6.
  ('a1000000-0000-4000-8000-000000000105', 'a1000000-0000-4000-8000-000000000001', 'reminder-overdue@test.local', 'R', 'Overdue', 'facility_manager', true),
  ('a1000000-0000-4000-8000-000000000106', 'a1000000-0000-4000-8000-000000000001', 'reminder-faroff@test.local', 'R', 'FarOff', 'employee', true)
-- The auth.users insert above already created these rows via the new-user trigger, so this is an
-- update in practice. `role` has to be in the DO UPDATE list or it silently stays at the column
-- default 'employee' -- which would quietly turn every role-dependent assertion below into a
-- test of the employee path twice.
on conflict(id) do update set
  organization_id = excluded.organization_id,
  first_name = excluded.first_name,
  last_name = excluded.last_name,
  role = excluded.role,
  is_active = excluded.is_active;
select set_config('app.privileged_write','off',true);

-- A facility_manager must be assigned to the facility their employee row sits in; linking one
-- without an assignment is rejected ("target facility is outside the profile organization or
-- inactive"). A promoted manager would have this assignment in real life.
insert into public.facility_assignments(profile_id, facility_id) values
  ('a1000000-0000-4000-8000-000000000105', 'a1000000-0000-4000-8000-000000000011');

insert into public.employees(
  id, organization_id, facility_id, profile_id, first_name, last_name, job_title,
  status, hire_date, administers_medications, trainer_status, is_synthetic
) values
  ('a1000000-0000-4000-8000-000000000201', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000011', 'a1000000-0000-4000-8000-000000000101', 'R', 'Linked', 'Aide', 'active', public.pa_today() - 100, false, false, false),
  -- A roster row imported before this person was invited: no profile to notify yet. Linked
  -- partway through the suite, which is the state the stamping bug used to strand.
  ('a1000000-0000-4000-8000-000000000202', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000011', null, 'R', 'Unlinked', 'Aide', 'active', public.pa_today() - 100, false, false, false),
  ('a1000000-0000-4000-8000-000000000203', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000011', 'a1000000-0000-4000-8000-000000000103', 'R', 'Terminated', 'Aide', 'terminated', public.pa_today() - 100, false, false, false),
  ('a1000000-0000-4000-8000-000000000204', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000011', 'a1000000-0000-4000-8000-000000000104', 'R', 'Deactivated', 'Aide', 'active', public.pa_today() - 100, false, false, false),
  ('a1000000-0000-4000-8000-000000000205', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000011', 'a1000000-0000-4000-8000-000000000105', 'R', 'Overdue', 'Aide', 'active', public.pa_today() - 100, false, false, false),
  ('a1000000-0000-4000-8000-000000000206', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000011', 'a1000000-0000-4000-8000-000000000106', 'R', 'FarOff', 'Aide', 'active', public.pa_today() - 100, false, false, false);

insert into public.policy_documents (id, organization_id, title)
values ('a1000000-0000-4000-8000-000000000301', 'a1000000-0000-4000-8000-000000000001', 'Abuse Reporting');

insert into public.policy_document_versions (
  id, policy_document_id, organization_id, version_number, storage_path,
  file_name, file_type, content_hash, status, published_at
) values (
  'a1000000-0000-4000-8000-000000000311', 'a1000000-0000-4000-8000-000000000301',
  'a1000000-0000-4000-8000-000000000001', 1,
  'a1000000-0000-4000-8000-000000000001/a1000000-0000-4000-8000-000000000301/v1.pdf',
  'abuse-reporting.pdf', 'application/pdf', repeat('c', 64), 'published', now()
);

insert into public.policy_attestation_campaigns (
  id, organization_id, policy_document_id, policy_document_version_id, name, due_date
) values
  ('a1000000-0000-4000-8000-000000000401', 'a1000000-0000-4000-8000-000000000001',
   'a1000000-0000-4000-8000-000000000301', 'a1000000-0000-4000-8000-000000000311',
   'Abuse Reporting -- due soon', public.pa_today() + 3),
  ('a1000000-0000-4000-8000-000000000402', 'a1000000-0000-4000-8000-000000000001',
   'a1000000-0000-4000-8000-000000000301', 'a1000000-0000-4000-8000-000000000311',
   'Abuse Reporting -- overdue', public.pa_today() - 4),
  ('a1000000-0000-4000-8000-000000000403', 'a1000000-0000-4000-8000-000000000001',
   'a1000000-0000-4000-8000-000000000301', 'a1000000-0000-4000-8000-000000000311',
   'Abuse Reporting -- far off', public.pa_today() + 30);

insert into public.policy_attestations (
  id, organization_id, facility_id, employee_id, campaign_id, policy_document_version_id
) values
  ('a1000000-0000-4000-8000-000000000501', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000011', 'a1000000-0000-4000-8000-000000000201', 'a1000000-0000-4000-8000-000000000401', 'a1000000-0000-4000-8000-000000000311'),
  ('a1000000-0000-4000-8000-000000000502', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000011', 'a1000000-0000-4000-8000-000000000202', 'a1000000-0000-4000-8000-000000000401', 'a1000000-0000-4000-8000-000000000311'),
  ('a1000000-0000-4000-8000-000000000503', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000011', 'a1000000-0000-4000-8000-000000000203', 'a1000000-0000-4000-8000-000000000401', 'a1000000-0000-4000-8000-000000000311'),
  ('a1000000-0000-4000-8000-000000000504', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000011', 'a1000000-0000-4000-8000-000000000204', 'a1000000-0000-4000-8000-000000000401', 'a1000000-0000-4000-8000-000000000311'),
  ('a1000000-0000-4000-8000-000000000505', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000011', 'a1000000-0000-4000-8000-000000000205', 'a1000000-0000-4000-8000-000000000402', 'a1000000-0000-4000-8000-000000000311'),
  ('a1000000-0000-4000-8000-000000000506', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000011', 'a1000000-0000-4000-8000-000000000206', 'a1000000-0000-4000-8000-000000000403', 'a1000000-0000-4000-8000-000000000311');

------------------------------------------------------------------------------------------------
-- Assignment notification: the link has to follow the recipient, not assume the employee portal.
------------------------------------------------------------------------------------------------
-- The link deliberately encodes no role. An earlier version resolved it at INSERT time, which
-- left two holes: the else-branch sent auditor and platform_admin somewhere the route did not
-- admit them, and any stored path goes stale when the recipient's role changes before they click.
-- /attestations resolves against the live session instead, so one link is correct for everyone
-- forever. Asserting BOTH recipients get the identical link is what pins that down.
select is(
  (select link from public.notifications
   where notification_type = 'policy_attestation_assigned'
     and profile_id = 'a1000000-0000-4000-8000-000000000101'),
  '/attestations',
  'an employee gets the role-neutral link on assignment'
);

select is(
  (select link from public.notifications
   where notification_type = 'policy_attestation_assigned'
     and profile_id = 'a1000000-0000-4000-8000-000000000105'),
  '/attestations',
  'and so does a promoted manager -- same link, resolved per-session at click time'
);

-- Assignment itself notifies (notify_policy_attestation_assigned). Clear that out so the counts
-- below are about the reminder sweep and nothing else.
delete from public.notifications where notification_type = 'policy_attestation_assigned';

select lives_ok(
  $$ select public.send_policy_attestation_reminders() $$,
  'the reminder sweep runs'
);

------------------------------------------------------------------------------------------------
-- Who was reminded
------------------------------------------------------------------------------------------------
select is(
  (select count(*)::int from public.notifications
   where notification_type = 'policy_attestation_due_soon'),
  2,
  'exactly two attestations are reminded -- the one coming due and the overdue one'
);

select is(
  (select count(*)::int from public.notifications
   where notification_type = 'policy_attestation_due_soon'
     and profile_id = 'a1000000-0000-4000-8000-000000000101'),
  1,
  'the linked, active employee is reminded'
);

select is(
  (select title from public.notifications
   where notification_type = 'policy_attestation_due_soon'
     and profile_id = 'a1000000-0000-4000-8000-000000000105'),
  'Policy attestation overdue',
  'a past-due attestation is titled as overdue, not as due soon'
);

select is(
  (select count(*)::int from public.notifications
   where notification_type = 'policy_attestation_due_soon'
     and profile_id = 'a1000000-0000-4000-8000-000000000103'),
  0,
  'a terminated employee is not reminded -- they have left the facility'
);

select is(
  (select count(*)::int from public.notifications
   where notification_type = 'policy_attestation_due_soon'
     and profile_id = 'a1000000-0000-4000-8000-000000000104'),
  0,
  'a deactivated profile is not reminded'
);

select is(
  (select count(*)::int from public.notifications
   where notification_type = 'policy_attestation_due_soon'
     and profile_id = 'a1000000-0000-4000-8000-000000000106'),
  0,
  'an attestation due beyond the 7-day window is not reminded'
);

------------------------------------------------------------------------------------------------
-- What was stamped. The sweep must stamp exactly what it notified.
------------------------------------------------------------------------------------------------
select is(
  (select link from public.notifications
   where notification_type = 'policy_attestation_due_soon'
     and profile_id = 'a1000000-0000-4000-8000-000000000101'),
  '/attestations',
  'the reminder uses the same role-neutral link'
);

select is(
  (select link from public.notifications
   where notification_type = 'policy_attestation_due_soon'
     and profile_id = 'a1000000-0000-4000-8000-000000000105'),
  '/attestations',
  'for the promoted manager as well -- no stored path to go stale on a role change'
);

select isnt(
  (select reminder_sent_at from public.policy_attestations
   where id = 'a1000000-0000-4000-8000-000000000501'),
  null,
  'the reminded attestation is stamped'
);

-- The headline regression. The old sweep's UPDATE omitted the employees join its INSERT relied
-- on, so it stamped this row without notifying anyone -- and the stamp re-applied every three
-- days, delaying the first real reminder after this employee was finally invited.
select is(
  (select reminder_sent_at from public.policy_attestations
   where id = 'a1000000-0000-4000-8000-000000000502'),
  null,
  'an attestation whose employee has no linked profile is NOT stamped as reminded'
);

select is(
  (select reminder_sent_at from public.policy_attestations
   where id = 'a1000000-0000-4000-8000-000000000503'),
  null,
  'nor is a terminated employee''s'
);

select is(
  (select reminder_sent_at from public.policy_attestations
   where id = 'a1000000-0000-4000-8000-000000000504'),
  null,
  'nor a deactivated profile''s'
);

------------------------------------------------------------------------------------------------
-- Repeat rules -- unchanged by this migration, but previously unasserted
------------------------------------------------------------------------------------------------
select lives_ok(
  $$ select public.send_policy_attestation_reminders() $$,
  'the sweep can run again immediately'
);

select is(
  (select count(*)::int from public.notifications
   where notification_type = 'policy_attestation_due_soon'),
  2,
  'and sends nothing new -- reminder_sent_at holds the three-day interval'
);

-- Once that employee is invited and linked, their attestation is picked up on the very next
-- sweep rather than waiting out a stamp the sweep never earned.
update public.employees set profile_id = 'a1000000-0000-4000-8000-000000000102'
where id = 'a1000000-0000-4000-8000-000000000202';

select lives_ok(
  $$ select public.send_policy_attestation_reminders() $$,
  'the sweep runs again once that employee is linked'
);

select is(
  (select count(*)::int from public.notifications
   where notification_type = 'policy_attestation_due_soon'),
  3,
  'and reminds them with no delay'
);

select * from finish();
rollback;
