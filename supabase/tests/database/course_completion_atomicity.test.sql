-- pgTAP coverage for the atomic course-completion/certificate invariant.
-- Run with: supabase test db (requires the local Supabase Docker stack).

begin;
select plan(26);

insert into public.organizations (id, name, slug) values
  ('10000000-0000-0000-0000-000000000001', 'Atomic Completion Org', 'atomic-completion-org');

insert into public.facilities (id, organization_id, name, facility_type) values
  ('10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Atomic Facility', 'PCH');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
)
select
  '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated',
  v.email, 'x', now(), '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '', '', '', false, false
from (values
  ('10000000-0000-0000-0000-000000000003'::uuid, 'atomic-admin@test.local'),
  ('10000000-0000-0000-0000-000000000004'::uuid, 'atomic-learner@test.local'),
  ('10000000-0000-0000-0000-00000000000b'::uuid, 'atomic-manager@test.local')
) as v(id, email);

-- auth.users fires handle_new_user(); finish the trigger-created fixture rows under the
-- same transaction-local bypass used by trusted profile administration paths.
select set_config('app.privileged_write', 'on', true);

insert into public.profiles (id, organization_id, email, first_name, last_name, role, is_active) values
  ('10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'atomic-admin@test.local', 'Atomic', 'Admin', 'org_admin', true),
  ('10000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'atomic-learner@test.local', 'Atomic', 'Learner', 'employee', true),
  ('10000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-000000000001', 'atomic-manager@test.local', 'Atomic', 'Manager', 'facility_manager', true)
on conflict (id) do update set
  organization_id = excluded.organization_id,
  email = excluded.email,
  first_name = excluded.first_name,
  last_name = excluded.last_name,
  role = excluded.role,
  is_active = excluded.is_active;

select set_config('app.privileged_write', 'off', true);

insert into public.employees (
  id, organization_id, facility_id, profile_id, first_name, last_name, job_title, status
) values (
  '10000000-0000-0000-0000-000000000005',
  '10000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000004',
  'Atomic', 'Learner', 'Aide', 'active'
);

insert into public.courses (
  id, organization_id, title, status, estimated_duration_minutes, created_by
) values (
  '10000000-0000-0000-0000-000000000006',
  '10000000-0000-0000-0000-000000000001',
  'Atomic Completion Course', 'draft', 30,
  '10000000-0000-0000-0000-000000000003'
);

insert into public.course_versions (
  id, course_id, organization_id, version_number, title, status, published_at
) values (
  '10000000-0000-0000-0000-000000000007',
  '10000000-0000-0000-0000-000000000006',
  '10000000-0000-0000-0000-000000000001',
  1, 'Atomic Completion Course v1', 'draft', null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body
) values (
  '10000000-0000-0000-0000-00000000000a',
  '10000000-0000-0000-0000-000000000007',
  '10000000-0000-0000-0000-000000000001',
  'text', 0, 'Lesson', '{"content":"Atomic completion test lesson."}'::jsonb
);

select set_config('app.privileged_write', 'on', true);
update public.course_versions
set status = 'published', published_at = now()
where id = '10000000-0000-0000-0000-000000000007';

update public.courses
set current_version_id = '10000000-0000-0000-0000-000000000007',
    status = 'published'
where id = '10000000-0000-0000-0000-000000000006';

insert into public.course_assignments (
  id, organization_id, facility_id, employee_id, course_id, course_version_id, assigned_by
) values (
  '10000000-0000-0000-0000-000000000008',
  '10000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000005',
  '10000000-0000-0000-0000-000000000006',
  '10000000-0000-0000-0000-000000000007',
  '10000000-0000-0000-0000-000000000003'
);

create or replace function pg_temp.act_as(p_profile_id uuid) returns void as $$
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_profile_id::text, 'role', 'authenticated')::text,
    true
  );
  set local role authenticated;
end;
$$ language plpgsql;

select has_function(
  'public',
  'complete_course_assignment',
  array['uuid'],
  'atomic completion RPC exists'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.certificates'::regclass
      and conname = 'certificates_course_assignment_id_key'
      and contype = 'u'
  ),
  'certificate assignment uniqueness is enforced by PostgreSQL'
);

select pg_temp.act_as('10000000-0000-0000-0000-000000000003');

select lives_ok(
  $$ select public.complete_course_assignment('10000000-0000-0000-0000-000000000008') $$,
  'the first completion succeeds'
);

select results_eq(
  $$ select status from public.course_assignments where id = '10000000-0000-0000-0000-000000000008' $$,
  array['completed'],
  'the assignment is completed'
);

select results_eq(
  $$ select count(*)::int from public.certificates where course_assignment_id = '10000000-0000-0000-0000-000000000008' $$,
  array[1],
  'the same transaction creates one certificate'
);

select ok(
  (select credential_number ~ '^CMT-[0-9A-F]+$'
   from public.certificates
   where course_assignment_id = '10000000-0000-0000-0000-000000000008'),
  'the certificate receives one stable credential number'
);

select results_eq(
  $$ select count(*)::int from public.certificate_lifecycle_events
     where course_assignment_id = '10000000-0000-0000-0000-000000000008'
       and event_type = 'certificate_issued' $$,
  array[1],
  'one logical certificate-issued outbox event is committed'
);

select results_eq(
  $$ select count(*)::int from public.certificate_pdf_jobs j
     join public.certificates c on c.id = j.certificate_id
     where c.course_assignment_id = '10000000-0000-0000-0000-000000000008'
       and j.status = 'pending' $$,
  array[1],
  'one durable PDF job is queued'
);

select results_eq(
  $$ select count(*)::int from public.notifications
     where profile_id = '10000000-0000-0000-0000-000000000004'
       and notification_type = 'certificate_issued' $$,
  array[1],
  'one logical learner notification is produced'
);

create temporary table first_atomic_outcome on commit drop as
select ca.completed_at, c.id as certificate_id, c.credential_number
from public.course_assignments ca
join public.certificates c on c.course_assignment_id = ca.id
where ca.id = '10000000-0000-0000-0000-000000000008';

select lives_ok(
  $$ select public.complete_course_assignment('10000000-0000-0000-0000-000000000008') $$,
  'replaying the completion succeeds'
);

select results_eq(
  $$ select ca.completed_at
     from public.course_assignments ca
     where ca.id = '10000000-0000-0000-0000-000000000008' $$,
  $$ select completed_at from first_atomic_outcome $$,
  'a replay preserves the original completion timestamp'
);

select results_eq(
  $$ select c.id, c.credential_number
     from public.certificates c
     where c.course_assignment_id = '10000000-0000-0000-0000-000000000008' $$,
  $$ select certificate_id, credential_number from first_atomic_outcome $$,
  'a replay preserves the certificate and credential number'
);

select results_eq(
  $$ select
       (select count(*)::int from public.certificates c where c.course_assignment_id = '10000000-0000-0000-0000-000000000008'),
       (select count(*)::int from public.certificate_lifecycle_events e where e.course_assignment_id = '10000000-0000-0000-0000-000000000008'),
       (select count(*)::int from public.certificate_pdf_jobs j join public.certificates c on c.id = j.certificate_id where c.course_assignment_id = '10000000-0000-0000-0000-000000000008'),
       (select count(*)::int from public.notifications n where n.profile_id = '10000000-0000-0000-0000-000000000004' and n.notification_type = 'certificate_issued') $$,
  $$ values (1, 1, 1, 1) $$,
  'replay creates no duplicate certificate, event, job, or notification'
);

select results_eq(
  $$ select public.issue_certificate(
       '10000000-0000-0000-0000-000000000005',
       '10000000-0000-0000-0000-000000000006',
       '10000000-0000-0000-0000-000000000008',
       null
     ) $$,
  $$ select certificate_id from first_atomic_outcome $$,
  'the legacy issuance RPC idempotently returns the existing certificate'
);

select results_eq(
  $$ select
       (select count(*)::int from public.certificates c where c.course_assignment_id = '10000000-0000-0000-0000-000000000008'),
       (select count(*)::int from public.certificate_lifecycle_events e where e.course_assignment_id = '10000000-0000-0000-0000-000000000008') $$,
  $$ values (1, 1) $$,
  'legacy replay also creates no duplicate certificate or outbox event'
);

reset role;
select pg_temp.act_as('10000000-0000-0000-0000-00000000000b');
select throws_ok(
  $$ select public.complete_course_assignment('10000000-0000-0000-0000-000000000008') $$,
  '42501',
  null,
  'a facility manager cannot complete an assignment outside their assigned facilities'
);

reset role;
insert into public.facility_assignments (profile_id, facility_id) values (
  '10000000-0000-0000-0000-00000000000b',
  '10000000-0000-0000-0000-000000000002'
);
select pg_temp.act_as('10000000-0000-0000-0000-00000000000b');
select lives_ok(
  $$ select public.issue_certificate(
       '10000000-0000-0000-0000-000000000005',
       '10000000-0000-0000-0000-000000000006',
       '10000000-0000-0000-0000-000000000008',
       null
     ) $$,
  'an assigned facility manager may use the idempotent issuance compatibility path'
);

reset role;
select set_config('app.privileged_write', 'on', true);
select throws_ok(
  $$ insert into public.certificates (
       organization_id, facility_id, employee_id, course_id, course_assignment_id
     ) values (
       '10000000-0000-0000-0000-000000000001',
       '10000000-0000-0000-0000-000000000002',
       '10000000-0000-0000-0000-000000000005',
       '10000000-0000-0000-0000-000000000006',
       '10000000-0000-0000-0000-000000000008'
     ) $$,
  null,
  null,
  'the database rejects a competing duplicate certificate insert'
);

select pg_temp.act_as('10000000-0000-0000-0000-000000000003');
select lives_ok(
  $$ insert into public.course_assignments (
       id, organization_id, facility_id, employee_id, course_id, course_version_id, assigned_by
     ) values (
       '10000000-0000-0000-0000-000000000009',
       '10000000-0000-0000-0000-000000000001',
       '10000000-0000-0000-0000-000000000002',
       '10000000-0000-0000-0000-000000000005',
       '10000000-0000-0000-0000-000000000006',
       '10000000-0000-0000-0000-000000000007',
       '10000000-0000-0000-0000-000000000003'
     ) $$,
  'a second assignment is available for rollback fault injection'
);

reset role;
alter table public.certificate_lifecycle_events
  add constraint test_reject_certificate_event check (false) not valid;
select pg_temp.act_as('10000000-0000-0000-0000-000000000003');

select throws_ok(
  $$ select public.complete_course_assignment('10000000-0000-0000-0000-000000000009') $$,
  null,
  null,
  'a downstream outbox failure aborts the completion command'
);

select results_eq(
  $$ select status from public.course_assignments where id = '10000000-0000-0000-0000-000000000009' $$,
  array['assigned'],
  'the assignment transition rolls back after a downstream failure'
);

select results_eq(
  $$ select count(*)::int from public.certificates where course_assignment_id = '10000000-0000-0000-0000-000000000009' $$,
  array[0],
  'certificate issuance rolls back after a downstream failure'
);

select results_eq(
  $$ select count(*)::int from public.certificate_lifecycle_events where course_assignment_id = '10000000-0000-0000-0000-000000000009' $$,
  array[0],
  'no partial lifecycle event survives the failed transaction'
);

reset role;
alter table public.certificate_lifecycle_events drop constraint test_reject_certificate_event;
select pg_temp.act_as('10000000-0000-0000-0000-000000000003');

select lives_ok(
  $$ select public.complete_course_assignment('10000000-0000-0000-0000-000000000009') $$,
  'the same command succeeds after the downstream fault is cleared'
);

select results_eq(
  $$ select count(*)::int from public.certificates where course_assignment_id = '10000000-0000-0000-0000-000000000009' $$,
  array[1],
  'the recovered completion creates exactly one certificate'
);

select results_eq(
  $$ select
       (select count(*)::int from public.certificate_lifecycle_events e where e.course_assignment_id = '10000000-0000-0000-0000-000000000009'),
       (select count(*)::int from public.certificate_pdf_jobs j join public.certificates c on c.id = j.certificate_id where c.course_assignment_id = '10000000-0000-0000-0000-000000000009') $$,
  $$ values (1, 1) $$,
  'the recovered completion creates exactly one event and one PDF job'
);

select * from finish();
rollback;
