-- pgTAP coverage for 20260906240000 (BACKLOG.md J74 -- the Train and Policy paragraphs of
-- RELEASE_READINESS_PLAN.md section 4.3).
--
-- Five defects, all of the same family: the product knew something and then told the user
-- otherwise.
--
--   * A training record that a renewal replaced kept generating `training_expired` alerts every
--     night, so an employee who renewed on time was told monthly that they had not.
--   * The offline learning clock started when the learner RECONNECTED, so an hour on a bus
--     counted for nothing and pushed a comprehensive completion an hour further away.
--   * A cancelled assignment could still be completed, and the learner met the cancellation check
--     constraint's raw text instead of a sentence.
--   * The trainer dashboard's "today" was today's DRAFTS, so opening a class for enrollment
--     removed it from the dashboard on the morning it ran.
--   * The public passport printed the course's estimated duration as "CE hours" on a page badged
--     "Verified transcript".
--
-- Run with: supabase test db (requires the local Supabase Docker stack).

begin;
select plan(16);

-- ---------------------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------------------
insert into public.organizations(id, name, slug, subscription_status) values
  ('7c000000-0000-4000-8000-000000000001', 'Superseded Org', 'superseded-record-org', 'active');
insert into public.facilities(id, organization_id, name, facility_type, state) values
  ('7c000000-0000-4000-8000-000000000011', '7c000000-0000-4000-8000-000000000001',
   'Superseded PCH', 'PCH', 'PA');

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) select
  '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated',
  v.email, 'x', now(), '{}'::jsonb, '{}'::jsonb, now(), now(),
  '', '', '', '', '', '', false, false
from (values
  ('7c000000-0000-4000-8000-000000000101'::uuid, 'superseded-learner@test.local')
) v(id, email);

select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('7c000000-0000-4000-8000-000000000101', '7c000000-0000-4000-8000-000000000001',
   'superseded-learner@test.local', 'Lee', 'Learner', 'employee', true)
on conflict (id) do update set
  organization_id = excluded.organization_id, email = excluded.email,
  role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);

insert into public.employees(
  id, organization_id, facility_id, profile_id, first_name, last_name, job_title, status
) values (
  '7c000000-0000-4000-8000-000000000021', '7c000000-0000-4000-8000-000000000001',
  '7c000000-0000-4000-8000-000000000011', '7c000000-0000-4000-8000-000000000101',
  'Lee', 'Learner', 'Direct Care Staff', 'active'
);

insert into public.training_types(
  id, organization_id, code, name, category, state, applies_to_facility_type,
  renewal_interval_days, warning_days_default, is_active
) values (
  '7c000000-0000-4000-8000-000000000031', '7c000000-0000-4000-8000-000000000001',
  'SUPERSEDED-ANNUAL', 'Superseded Annual Topic', 'annual', 'PA', 'BOTH', 365, 30, true
);

-- Last cycle's record, replaced by this cycle's. It is 'expired' and it stays 'expired' -- that is
-- the evidence of last year's training, not an outstanding obligation.
insert into public.employee_training_records(
  id, organization_id, facility_id, employee_id, training_type_id,
  completion_date, due_date, status, created_at
) values
  ('7c000000-0000-4000-8000-000000000041', '7c000000-0000-4000-8000-000000000001',
   '7c000000-0000-4000-8000-000000000011', '7c000000-0000-4000-8000-000000000021',
   '7c000000-0000-4000-8000-000000000031',
   public.pa_today() - 400, public.pa_today() - 35, 'expired', now() - interval '400 days'),
  ('7c000000-0000-4000-8000-000000000042', '7c000000-0000-4000-8000-000000000001',
   '7c000000-0000-4000-8000-000000000011', '7c000000-0000-4000-8000-000000000021',
   '7c000000-0000-4000-8000-000000000031',
   public.pa_today() - 340, public.pa_today() + 25, 'due_soon', now() - interval '340 days');

-- ---------------------------------------------------------------------------------------
-- B1. The alert belongs to the current record, not to every row ever written
-- ---------------------------------------------------------------------------------------
select public.recalculate_compliance_core('7c000000-0000-4000-8000-000000000001');

select is(
  (select count(*)::integer from public.alerts
   where training_record_id = '7c000000-0000-4000-8000-000000000041' and status = 'open'),
  0,
  'a superseded training record raises no alert -- it used to raise a fresh overdue one every night'
);
select is(
  (select count(*)::integer from public.alerts
   where training_record_id = '7c000000-0000-4000-8000-000000000042' and status = 'open'),
  1,
  'and the current record still does, so the requirement is not silently dropped'
);
select is(
  (select count(*)::integer from public.notifications n
   join public.employees e on e.profile_id = n.profile_id
   where e.id = '7c000000-0000-4000-8000-000000000021'
     and n.notification_type = 'training_expired'),
  0,
  'no training_expired notification reaches the employee who renewed on time'
);

-- An alert already open against the superseded row is closed by the resolver, even while the
-- current record is only due_soon (it used to need a sibling that had reached compliant).
insert into public.alerts(
  organization_id, facility_id, employee_id, training_record_id, alert_type, title, message, severity
) values (
  '7c000000-0000-4000-8000-000000000001', '7c000000-0000-4000-8000-000000000011',
  '7c000000-0000-4000-8000-000000000021', '7c000000-0000-4000-8000-000000000041',
  'overdue', 'Legacy alert', 'Left over from before the fix', 'critical'
);
select public.resolve_stale_compliance_alerts('7c000000-0000-4000-8000-000000000001');
select is(
  (select status from public.alerts
   where training_record_id = '7c000000-0000-4000-8000-000000000041'
   order by created_at desc limit 1),
  'resolved',
  'and an alert already open against a superseded record is resolved rather than left shouting'
);

-- ---------------------------------------------------------------------------------------
-- B3. A cancelled assignment is refused with a sentence, not a constraint name
-- ---------------------------------------------------------------------------------------
insert into public.courses(id, organization_id, title, estimated_duration_minutes)
values ('7c000000-0000-4000-8000-000000000051', '7c000000-0000-4000-8000-000000000001',
        'Superseded Test Course', 60);
insert into public.course_versions(id, course_id, organization_id, version_number, title)
values ('7c000000-0000-4000-8000-000000000061', '7c000000-0000-4000-8000-000000000051',
        '7c000000-0000-4000-8000-000000000001', 1, 'Superseded Test Course');
insert into public.course_blocks(
  id, course_version_id, organization_id, block_type, sort_order, title, body
) values
  ('7c000000-0000-4000-8000-000000000071', '7c000000-0000-4000-8000-000000000061',
   '7c000000-0000-4000-8000-000000000001', 'text', 1, 'Only lesson', '{"content":"Only lesson"}'::jsonb);

select set_config('app.privileged_write', 'on', true);
update public.course_versions set status = 'published', published_at = now()
where id = '7c000000-0000-4000-8000-000000000061';
update public.courses
set current_version_id = '7c000000-0000-4000-8000-000000000061', status = 'published'
where id = '7c000000-0000-4000-8000-000000000051';
select set_config('app.privileged_write', 'off', true);

insert into public.course_assignments(
  id, organization_id, facility_id, employee_id, course_id, course_version_id
) values (
  '7c000000-0000-4000-8000-000000000081', '7c000000-0000-4000-8000-000000000001',
  '7c000000-0000-4000-8000-000000000011', '7c000000-0000-4000-8000-000000000021',
  '7c000000-0000-4000-8000-000000000051', '7c000000-0000-4000-8000-000000000061'
);

select set_config('app.privileged_write', 'on', true);
update public.course_assignments
set status = 'canceled', canceled_at = now(), cancellation_reason = 'Learner moved to another site'
where id = '7c000000-0000-4000-8000-000000000081';
select set_config('app.privileged_write', 'off', true);

select throws_ok(
  $$ select public.complete_course_assignment('7c000000-0000-4000-8000-000000000081') $$,
  '55000',
  'This training assignment was cancelled and cannot be completed. Ask a manager to assign it again if the training is still required.',
  'completing a cancelled assignment is refused by name, not by course_assignment_cancellation_check'
);

-- ---------------------------------------------------------------------------------------
-- B2. The offline seat clock starts at study, clamped to the bundle download
-- ---------------------------------------------------------------------------------------
insert into public.offline_device_registrations(
  id, organization_id, profile_id, device_public_key, device_fingerprint_sha256,
  role_at_registration, status
) values (
  '7c000000-0000-4000-8000-000000000091', '7c000000-0000-4000-8000-000000000001',
  '7c000000-0000-4000-8000-000000000101', 'marker',
  repeat('a', 64), 'employee', 'active'
);
insert into public.offline_content_manifests(
  organization_id, profile_id, device_id, course_version_id, manifest_version,
  content_sha256, encrypted_content_key, allowlisted_assets, expires_at, created_at
) values (
  '7c000000-0000-4000-8000-000000000001', '7c000000-0000-4000-8000-000000000101',
  '7c000000-0000-4000-8000-000000000091', '7c000000-0000-4000-8000-000000000061', 1,
  repeat('b', 64), 'device-bound:test', '[]'::jsonb, now() + interval '30 days',
  now() - interval '6 hours'
);
insert into public.course_assignments(
  id, organization_id, facility_id, employee_id, course_id, course_version_id
) values (
  '7c000000-0000-4000-8000-000000000082', '7c000000-0000-4000-8000-000000000001',
  '7c000000-0000-4000-8000-000000000011', '7c000000-0000-4000-8000-000000000021',
  '7c000000-0000-4000-8000-000000000051', '7c000000-0000-4000-8000-000000000061'
);

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

select pg_temp.act_as('7c000000-0000-4000-8000-000000000101');
select lives_ok(
  $$ select public.sync_offline_learning_action(
       '7c000000-0000-4000-8000-000000000091',
       '7c000000-0000-4000-8000-000000000082',
       'idem-offline-1', 1, 0, 'progress', now(),
       jsonb_build_object(
         'percentComplete', 100,
         'startedAt', (now() - interval '2 hours')::text,
         'lastBlockId', '7c000000-0000-4000-8000-000000000071'
       )) $$,
  'an offline checkpoint syncs'
);
reset role;

select ok(
  (select started_at from public.course_progress
   where assignment_id = '7c000000-0000-4000-8000-000000000082')
    <= now() - interval '110 minutes',
  'the seat clock starts when the learner started studying, not when they reconnected'
);
select is(
  (select last_block_id from public.course_progress
   where assignment_id = '7c000000-0000-4000-8000-000000000082'),
  '7c000000-0000-4000-8000-000000000071'::uuid,
  'and the block reached offline is carried, so the live player resumes there'
);

-- A claim from before the download cannot buy seat time that could not have been spent. A second
-- course, because course_assignments_one_open_per_course_idx refuses a second open assignment for
-- the same (employee, course) -- the index J58 works around by reusing the open row.
insert into public.courses(id, organization_id, title, estimated_duration_minutes)
values ('7c000000-0000-4000-8000-000000000052', '7c000000-0000-4000-8000-000000000001',
        'Superseded Test Course Two', 60);
insert into public.course_versions(id, course_id, organization_id, version_number, title)
values ('7c000000-0000-4000-8000-000000000062', '7c000000-0000-4000-8000-000000000052',
        '7c000000-0000-4000-8000-000000000001', 1, 'Superseded Test Course Two');
insert into public.course_blocks(
  id, course_version_id, organization_id, block_type, sort_order, title, body
) values
  ('7c000000-0000-4000-8000-000000000072', '7c000000-0000-4000-8000-000000000062',
   '7c000000-0000-4000-8000-000000000001', 'text', 1, 'Only lesson', '{"content":"Only lesson"}'::jsonb);
select set_config('app.privileged_write', 'on', true);
update public.course_versions set status = 'published', published_at = now()
where id = '7c000000-0000-4000-8000-000000000062';
update public.courses
set current_version_id = '7c000000-0000-4000-8000-000000000062', status = 'published'
where id = '7c000000-0000-4000-8000-000000000052';
select set_config('app.privileged_write', 'off', true);
insert into public.offline_content_manifests(
  organization_id, profile_id, device_id, course_version_id, manifest_version,
  content_sha256, encrypted_content_key, allowlisted_assets, expires_at, created_at
) values (
  '7c000000-0000-4000-8000-000000000001', '7c000000-0000-4000-8000-000000000101',
  '7c000000-0000-4000-8000-000000000091', '7c000000-0000-4000-8000-000000000062', 1,
  repeat('e', 64), 'device-bound:test', '[]'::jsonb, now() + interval '30 days',
  now() - interval '6 hours'
);
insert into public.course_assignments(
  id, organization_id, facility_id, employee_id, course_id, course_version_id
) values (
  '7c000000-0000-4000-8000-000000000083', '7c000000-0000-4000-8000-000000000001',
  '7c000000-0000-4000-8000-000000000011', '7c000000-0000-4000-8000-000000000021',
  '7c000000-0000-4000-8000-000000000052', '7c000000-0000-4000-8000-000000000062'
);
select pg_temp.act_as('7c000000-0000-4000-8000-000000000101');
select public.sync_offline_learning_action(
  '7c000000-0000-4000-8000-000000000091',
  '7c000000-0000-4000-8000-000000000083',
  'idem-offline-2', 1, 0, 'progress', now(),
  jsonb_build_object('percentComplete', 40, 'startedAt', (now() - interval '90 days')::text)
);
reset role;
select ok(
  (select started_at from public.course_progress
   where assignment_id = '7c000000-0000-4000-8000-000000000083')
    >= now() - interval '7 hours',
  'a start time earlier than the bundle download is clamped to the download'
);

-- ---------------------------------------------------------------------------------------
-- B4. Today's class is the one that is running, not the one still in draft
-- ---------------------------------------------------------------------------------------
insert into public.training_classes(
  id, organization_id, facility_id, trainer_profile_id, training_type_id,
  class_name, class_date, duration_hours, status
) values
  ('7c000000-0000-4000-8000-0000000000a1', '7c000000-0000-4000-8000-000000000001',
   '7c000000-0000-4000-8000-000000000011', '7c000000-0000-4000-8000-000000000101',
   '7c000000-0000-4000-8000-000000000031', 'Still a draft', public.pa_today(), 1, 'draft'),
  ('7c000000-0000-4000-8000-0000000000a2', '7c000000-0000-4000-8000-000000000001',
   '7c000000-0000-4000-8000-000000000011', '7c000000-0000-4000-8000-000000000101',
   '7c000000-0000-4000-8000-000000000031', 'Open for enrollment', public.pa_today(), 1, 'scheduled');

select is(
  (select count(*)::integer
   from jsonb_array_elements(public.get_trainer_dashboard_summary() -> 'classes' -> 'todays') t
   where t ->> 'className' = 'Open for enrollment'),
  1,
  'the class that is open for enrollment today is the one the kiosk button offers'
);
select is(
  (select count(*)::integer
   from jsonb_array_elements(public.get_trainer_dashboard_summary() -> 'classes' -> 'todays') t
   where t ->> 'className' = 'Still a draft'),
  0,
  'and a draft is not today''s class -- nobody has been invited to it'
);

-- ---------------------------------------------------------------------------------------
-- B6. The transcript prints recorded credit, or nothing
-- ---------------------------------------------------------------------------------------
select set_config('app.privileged_write', 'on', true);
insert into public.certificates(
  id, organization_id, facility_id, employee_id, course_id, course_assignment_id,
  credential_number, slug, issued_at
) values (
  '7c000000-0000-4000-8000-0000000000b1', '7c000000-0000-4000-8000-000000000001',
  '7c000000-0000-4000-8000-000000000011', '7c000000-0000-4000-8000-000000000021',
  '7c000000-0000-4000-8000-000000000051', '7c000000-0000-4000-8000-000000000082',
  'CB-SUPERSEDED-1', repeat('c', 36), now()
);
select set_config('app.privileged_write', 'off', true);
insert into public.training_passports(
  organization_id, profile_id, employee_id, slug, is_active, include_expired
) values (
  '7c000000-0000-4000-8000-000000000001', '7c000000-0000-4000-8000-000000000101',
  '7c000000-0000-4000-8000-000000000021', repeat('d', 36), true, true
);

select is(
  public.verify_training_passport(repeat('d', 36)) -> 'certificates' -> 0 -> 'creditHours',
  'null'::jsonb,
  'a completion with no recorded compliance credit prints no hours at all'
);
select is(
  (public.verify_training_passport(repeat('d', 36)) ->> 'totalCreditHours')::numeric,
  0::numeric,
  'and the header total counts only what was recorded, never the course''s estimated duration'
);

insert into public.course_completion_credits(
  course_assignment_id, course_id, course_version_id, organization_id, facility_id,
  employee_id, training_type_id, topic_code, credit_hours, training_year, citation_note, credited_at
) values (
  '7c000000-0000-4000-8000-000000000082', '7c000000-0000-4000-8000-000000000051',
  '7c000000-0000-4000-8000-000000000061', '7c000000-0000-4000-8000-000000000001',
  '7c000000-0000-4000-8000-000000000011', '7c000000-0000-4000-8000-000000000021',
  '7c000000-0000-4000-8000-000000000031', 'superseded-topic', 0.75,
  extract(year from public.pa_today())::integer, '55 Pa. Code 2600.65', now()
);
select is(
  (public.verify_training_passport(repeat('d', 36)) -> 'certificates' -> 0 ->> 'creditHours')::numeric,
  0.75::numeric,
  'once a governed credit exists the transcript prints that, and only that'
);

-- ---------------------------------------------------------------------------------------
-- F7. A job aide's audience is a set of real roles
-- ---------------------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.help_articles(article_type, category, title, content)
     values ('job_aide', 'Workforce', 'Typo aide',
             '{"audience":["faciilty_manager"],"steps":[]}'::jsonb) $$,
  '23514',
  null,
  'a mistyped role in a job aide is refused instead of hiding the aide from everyone'
);
select lives_ok(
  $$ insert into public.help_articles(article_type, category, title, content)
     values ('job_aide', 'Workforce', 'Correct aide',
             '{"audience":["facility_manager","org_admin"],"steps":[]}'::jsonb) $$,
  'and a real audience is accepted unchanged'
);

select * from finish();
rollback;
