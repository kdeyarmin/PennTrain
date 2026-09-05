-- pgTAP coverage for 20260904110000 and 20260904120000: the certificate PDF worker's direct
-- reads are granted to the service role, exhausted PDF jobs can be requeued, and the one cron
-- entry that sent an empty secret now fails loudly like the other fifteen.
-- Run with: supabase test db (requires the local Supabase Docker stack).

begin;
select plan(25);

-- ---------------------------------------------------------------------------------------
-- The worker's direct reads. Every table generate-certificate-pdf touches with the
-- service-role client outside an RPC must carry SELECT, and none may carry a write.
-- ---------------------------------------------------------------------------------------
select ok(
  has_table_privilege('service_role', 'public.course_assignments', 'SELECT'),
  'service_role can read course_assignments (the version the learner actually took)'
);
select ok(
  has_table_privilege('service_role', 'public.quiz_attempts', 'SELECT'),
  'service_role can read quiz_attempts (the best passed final-exam score)'
);
select ok(
  has_table_privilege('service_role', 'public.quizzes', 'SELECT'),
  'service_role can read quizzes (to find the final exam)'
);
select ok(
  not has_table_privilege('service_role', 'public.course_assignments', 'INSERT'),
  'the repair added no INSERT on course_assignments'
);
select ok(
  not has_table_privilege('service_role', 'public.course_assignments', 'UPDATE'),
  'the repair added no UPDATE on course_assignments'
);
select ok(
  not has_table_privilege('service_role', 'public.course_assignments', 'DELETE'),
  'the repair added no DELETE on course_assignments'
);
select ok(
  not has_table_privilege('service_role', 'public.quiz_attempts', 'INSERT')
  and not has_table_privilege('service_role', 'public.quiz_attempts', 'UPDATE')
  and not has_table_privilege('service_role', 'public.quiz_attempts', 'DELETE'),
  'quiz_attempts stays read-only for service_role'
);
select ok(
  not has_table_privilege('service_role', 'public.quizzes', 'INSERT')
  and not has_table_privilege('service_role', 'public.quizzes', 'UPDATE')
  and not has_table_privilege('service_role', 'public.quizzes', 'DELETE'),
  'quizzes stays read-only for service_role'
);

-- ---------------------------------------------------------------------------------------
-- Requeueing an exhausted job. Fixture mirrors course_completion_atomicity.test.sql.
-- ---------------------------------------------------------------------------------------
insert into public.organizations (id, name, slug) values
  ('11000000-0000-0000-0000-000000000001', 'PDF Requeue Org', 'pdf-requeue-org');

insert into public.facilities (id, organization_id, name, facility_type) values
  ('11000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-000000000001', 'PDF Requeue Facility', 'PCH');

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
  ('11000000-0000-0000-0000-000000000003'::uuid, 'pdf-requeue-admin@test.local'),
  ('11000000-0000-0000-0000-000000000004'::uuid, 'pdf-requeue-learner@test.local')
) as v(id, email);

select set_config('app.privileged_write', 'on', true);

insert into public.profiles (id, organization_id, email, first_name, last_name, role, is_active) values
  ('11000000-0000-0000-0000-000000000003', '11000000-0000-0000-0000-000000000001', 'pdf-requeue-admin@test.local', 'Requeue', 'Admin', 'org_admin', true),
  ('11000000-0000-0000-0000-000000000004', '11000000-0000-0000-0000-000000000001', 'pdf-requeue-learner@test.local', 'Requeue', 'Learner', 'employee', true)
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
  '11000000-0000-0000-0000-000000000005',
  '11000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000002',
  '11000000-0000-0000-0000-000000000004',
  'Requeue', 'Learner', 'Aide', 'active'
);

insert into public.courses (
  id, organization_id, title, status, estimated_duration_minutes, created_by
) values (
  '11000000-0000-0000-0000-000000000006',
  '11000000-0000-0000-0000-000000000001',
  'PDF Requeue Course', 'draft', 30,
  '11000000-0000-0000-0000-000000000003'
);

insert into public.course_versions (
  id, course_id, organization_id, version_number, title, status, published_at
) values (
  '11000000-0000-0000-0000-000000000007',
  '11000000-0000-0000-0000-000000000006',
  '11000000-0000-0000-0000-000000000001',
  1, 'PDF Requeue Course v1', 'draft', null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body
) values (
  '11000000-0000-0000-0000-00000000000a',
  '11000000-0000-0000-0000-000000000007',
  '11000000-0000-0000-0000-000000000001',
  'text', 0, 'Lesson', '{"content":"PDF requeue test lesson."}'::jsonb
);

select set_config('app.privileged_write', 'on', true);
update public.course_versions
set status = 'published', published_at = now()
where id = '11000000-0000-0000-0000-000000000007';

update public.courses
set current_version_id = '11000000-0000-0000-0000-000000000007',
    status = 'published'
where id = '11000000-0000-0000-0000-000000000006';

insert into public.course_assignments (
  id, organization_id, facility_id, employee_id, course_id, course_version_id, assigned_by
) values (
  '11000000-0000-0000-0000-000000000008',
  '11000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000002',
  '11000000-0000-0000-0000-000000000005',
  '11000000-0000-0000-0000-000000000006',
  '11000000-0000-0000-0000-000000000007',
  '11000000-0000-0000-0000-000000000003'
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

select pg_temp.act_as('11000000-0000-0000-0000-000000000003');

select lives_ok(
  $$ select public.complete_course_assignment('11000000-0000-0000-0000-000000000008') $$,
  'the completion succeeds and issues the certificate'
);

reset role;
select set_config('request.jwt.claims', '', true);

select results_eq(
  $$ select count(*)::int from public.certificate_pdf_jobs j
     join public.certificates c on c.id = j.certificate_id
     where c.course_assignment_id = '11000000-0000-0000-0000-000000000008'
       and j.status = 'pending' and j.attempt_count = 0 $$,
  array[1],
  'issuance queues one pending PDF job'
);

-- Spend every attempt the way finish_certificate_pdf_job does on the last failure, storing the
-- exact error text production held: the worker had stringified a plain PostgREST error object.
select set_config('app.privileged_write', 'on', true);
update public.certificate_pdf_jobs j
set status = 'failed',
    attempt_count = j.max_attempts,
    completed_at = now(),
    last_error_code = 'render_failed',
    last_error_message = '[object Object]'
from public.certificates c
where c.id = j.certificate_id
  and c.course_assignment_id = '11000000-0000-0000-0000-000000000008';
update public.certificates
set pdf_status = 'failed',
    pdf_attempt_count = 5,
    pdf_last_attempt_at = now(),
    pdf_last_error = '[object Object]'
where course_assignment_id = '11000000-0000-0000-0000-000000000008';

select is(
  (public.run_phase1_synthetic_checks() ->> 'certificatePdfJobsExhausted')::int,
  1,
  'an exhausted job is what turns the synthetic health check red'
);

select is(
  app_private.requeue_exhausted_certificate_pdf_jobs(100),
  1,
  'requeue resets the one exhausted job and reports it'
);

select ok(
  exists (
    select 1 from public.certificate_pdf_jobs j
    join public.certificates c on c.id = j.certificate_id
    where c.course_assignment_id = '11000000-0000-0000-0000-000000000008'
      and j.status = 'pending'
      and j.attempt_count = 0
      and j.current_run_id is null
      and j.worker_id is null
      and j.locked_at is null
      and j.completed_at is null
      and j.available_at <= now()
  ),
  'the job is pending, unlocked, with a fresh attempt budget'
);

select ok(
  exists (
    select 1 from public.certificates
    where course_assignment_id = '11000000-0000-0000-0000-000000000008'
      and pdf_status = 'pending'
      and pdf_attempt_count = 0
  ),
  'the certificate reads pending again, not failed'
);

select is(
  (public.run_phase1_synthetic_checks() ->> 'certificatePdfJobsExhausted')::int,
  0,
  'the synthetic health check can reach zero again'
);

select is(
  app_private.requeue_exhausted_certificate_pdf_jobs(100),
  0,
  'a second requeue finds nothing to do'
);

-- A job that failed but still has attempts left is the worker's to retry on its own backoff;
-- the requeue must not touch it (resetting its count would defeat the exponential backoff).
update public.certificate_pdf_jobs j
set status = 'failed',
    attempt_count = 2,
    available_at = now() + interval '1 minute',
    last_error_code = 'render_failed',
    last_error_message = 'transient'
from public.certificates c
where c.id = j.certificate_id
  and c.course_assignment_id = '11000000-0000-0000-0000-000000000008';

select is(
  app_private.requeue_exhausted_certificate_pdf_jobs(100),
  0,
  'a failed job with attempts remaining is not requeued'
);

select ok(
  exists (
    select 1 from public.certificate_pdf_jobs j
    join public.certificates c on c.id = j.certificate_id
    where c.course_assignment_id = '11000000-0000-0000-0000-000000000008'
      and j.status = 'failed' and j.attempt_count = 2
  ),
  'its state and attempt count are untouched'
);

select throws_ok(
  $$ select app_private.requeue_exhausted_certificate_pdf_jobs(0) $$,
  '22023',
  'p_limit must be between 1 and 1000',
  'the requeue refuses an unbounded or zero limit'
);

select has_function(
  'app_private', 'requeue_exhausted_certificate_pdf_jobs', array['integer'],
  'the requeue function exists'
);

select ok(
  not has_function_privilege('authenticated', 'app_private.requeue_exhausted_certificate_pdf_jobs(integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'app_private.requeue_exhausted_certificate_pdf_jobs(integer)', 'EXECUTE'),
  'no browser role can execute the requeue'
);

-- ---------------------------------------------------------------------------------------
-- The cron entry now resolves its URL and secret the way the other fifteen do.
-- ---------------------------------------------------------------------------------------
select ok(
  (select command from cron.job where jobname = 'process-credential-renewals')
    like '%app_private.require_cron_shared_secret()%',
  'process-credential-renewals reads the secret through require_cron_shared_secret()'
);
select ok(
  (select command from cron.job where jobname = 'process-credential-renewals')
    like '%app_private.require_functions_base_url()%',
  'process-credential-renewals resolves the functions host through require_functions_base_url()'
);
select ok(
  (select command from cron.job where jobname = 'process-credential-renewals')
    not like '%supabase.co%'
  and (select command from cron.job where jobname = 'process-credential-renewals')
    not like '%vault.decrypted_secrets%',
  'no hard-coded project host and no inline vault read remain'
);
select is(
  (select schedule from cron.job where jobname = 'process-credential-renewals'),
  '*/10 * * * *',
  'the schedule is unchanged'
);

select * from finish();
rollback;
