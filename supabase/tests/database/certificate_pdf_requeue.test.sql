-- pgTAP coverage for 20260905050000: an exhausted certificate PDF job can be started again.
--
-- claim_certificate_pdf_jobs only claims a job with attempt_count < max_attempts, so once the
-- attempts are spent the job is invisible to every worker forever. The only control the product
-- offered in that state was a "Retry PDF" button whose edge function answered 409 "already being
-- prepared. Please try again shortly." -- describing the one case where nothing is being prepared
-- and never will be. app_private.requeue_exhausted_certificate_pdf_jobs existed but is reachable
-- only from a database session.
-- Run with: supabase test db (requires the local Supabase Docker stack).

begin;
select plan(11);

insert into public.organizations(id, name, slug) values
  ('5e000000-0000-4000-8000-000000000001', 'Requeue Org', 'requeue-cert-org'),
  ('5e000000-0000-4000-8000-000000000002', 'Other Org', 'requeue-other-org');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('5e000000-0000-4000-8000-000000000011', '5e000000-0000-4000-8000-000000000001', 'Requeue Facility', 'PCH');

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
  ('5e000000-0000-4000-8000-000000000101'::uuid, 'requeue-holder@test.local'),
  ('5e000000-0000-4000-8000-000000000102'::uuid, 'requeue-admin@test.local'),
  ('5e000000-0000-4000-8000-000000000103'::uuid, 'requeue-outsider@test.local')
) v(id, email);

select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('5e000000-0000-4000-8000-000000000101', '5e000000-0000-4000-8000-000000000001', 'requeue-holder@test.local', 'Holly', 'Holder', 'employee', true),
  ('5e000000-0000-4000-8000-000000000102', '5e000000-0000-4000-8000-000000000001', 'requeue-admin@test.local', 'Adam', 'Admin', 'org_admin', true),
  ('5e000000-0000-4000-8000-000000000103', '5e000000-0000-4000-8000-000000000002', 'requeue-outsider@test.local', 'Otto', 'Outsider', 'org_admin', true)
on conflict (id) do update set
  organization_id = excluded.organization_id, email = excluded.email,
  role = excluded.role, is_active = true;

insert into public.employees(
  id, organization_id, facility_id, profile_id, employee_number, first_name, last_name,
  email, hire_date, job_title, status
) values (
  '5e000000-0000-4000-8000-000000000201', '5e000000-0000-4000-8000-000000000001',
  '5e000000-0000-4000-8000-000000000011', '5e000000-0000-4000-8000-000000000101',
  'RQ-1', 'Holly', 'Holder', 'requeue-holder@test.local', public.pa_today()-90, 'Direct Care', 'active'
);

insert into public.courses(id, organization_id, title, status) values
  ('5e000000-0000-4000-8000-000000000501', '5e000000-0000-4000-8000-000000000001',
   'Requeue drill course', 'draft');

insert into public.certificates(
  id, organization_id, facility_id, employee_id, course_id, slug, credential_number,
  issued_at, pdf_status, pdf_attempt_count
) values
  ('5e000000-0000-4000-8000-000000000301', '5e000000-0000-4000-8000-000000000001',
   '5e000000-0000-4000-8000-000000000011', '5e000000-0000-4000-8000-000000000201',
   '5e000000-0000-4000-8000-000000000501', 'requeue-exhausted-cert', 'RQ-CERT-1', now(), 'failed', 5),
  ('5e000000-0000-4000-8000-000000000302', '5e000000-0000-4000-8000-000000000001',
   '5e000000-0000-4000-8000-000000000011', '5e000000-0000-4000-8000-000000000201',
   '5e000000-0000-4000-8000-000000000501', 'requeue-retrying-cert', 'RQ-CERT-2', now(), 'failed', 2);

-- The jobs themselves are written by the enqueue_certificate_artifacts trigger above (one per
-- certificate, certificate_pdf_jobs_certificate_id_key), so this drives them into the two states
-- that matter rather than inserting its own.
update public.certificate_pdf_jobs
set status = 'failed', attempt_count = 5, max_attempts = 5,
    last_error_message = 'permission denied for table course_assignments'
where certificate_id = '5e000000-0000-4000-8000-000000000301';  -- every attempt spent

update public.certificate_pdf_jobs
set status = 'failed', attempt_count = 2, max_attempts = 5,
    last_error_message = 'transient render failure'
where certificate_id = '5e000000-0000-4000-8000-000000000302';  -- the queue will retry this itself
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
-- The state that made this necessary: no worker can see an exhausted job.
-- ---------------------------------------------------------------------------------------
reset role;
select is(
  (select count(*)::int from public.claim_certificate_pdf_jobs(
     gen_random_uuid(), '5e000000-0000-4000-8000-000000000301', 1)),
  0,
  'an exhausted job is invisible to the worker that would render it'
);

-- ---------------------------------------------------------------------------------------
-- The holder can start it again.
-- ---------------------------------------------------------------------------------------
select pg_temp.act_as('5e000000-0000-4000-8000-000000000101');

select lives_ok(
  $$ select public.requeue_certificate_pdf('5e000000-0000-4000-8000-000000000301') $$,
  'the employee whose certificate it is can requeue it'
);

reset role;
select is(
  (select attempt_count from public.certificate_pdf_jobs where certificate_id = '5e000000-0000-4000-8000-000000000301'),
  0,
  'the job has a fresh set of attempts'
);

select is(
  (select status from public.certificate_pdf_jobs where certificate_id = '5e000000-0000-4000-8000-000000000301'),
  'pending',
  'and is pending again'
);

select is(
  (select pdf_status from public.certificates where id = '5e000000-0000-4000-8000-000000000301'),
  'pending',
  'the certificate row says so too, so the page stops offering Retry'
);

-- The point of the whole exercise: the worker can now see it.
select is(
  (select count(*)::int from public.claim_certificate_pdf_jobs(
     gen_random_uuid(), '5e000000-0000-4000-8000-000000000301', 1)),
  1,
  'and the worker claims it on its next tick'
);

-- ---------------------------------------------------------------------------------------
-- It refuses anything that is not actually stuck.
-- ---------------------------------------------------------------------------------------
select pg_temp.act_as('5e000000-0000-4000-8000-000000000102');

select throws_ok(
  $$ select public.requeue_certificate_pdf('5e000000-0000-4000-8000-000000000302') $$,
  '22023',
  'This certificate PDF is still being retried automatically',
  'a job with attempts left is left alone, and says why'
);

reset role;
select is(
  (select attempt_count from public.certificate_pdf_jobs where certificate_id = '5e000000-0000-4000-8000-000000000302'),
  2,
  'the refusal changes nothing'
);

-- ---------------------------------------------------------------------------------------
-- Who may call it.
-- ---------------------------------------------------------------------------------------
select set_config('app.privileged_write', 'on', true);
update public.certificate_pdf_jobs set status = 'failed', attempt_count = 5
where certificate_id = '5e000000-0000-4000-8000-000000000301';
select set_config('app.privileged_write', 'off', true);

select pg_temp.act_as('5e000000-0000-4000-8000-000000000102');
select lives_ok(
  $$ select public.requeue_certificate_pdf('5e000000-0000-4000-8000-000000000301') $$,
  'an org_admin in the certificate organization can requeue it'
);

-- Refused on authorization, not on visibility: the function is SECURITY DEFINER, so it reads the
-- certificate past RLS and then applies its own rule -- the same shape as every other privileged
-- RPC here (revoke_user_invitation, complete_training_class).
select pg_temp.act_as('5e000000-0000-4000-8000-000000000103');
select throws_ok(
  $$ select public.requeue_certificate_pdf('5e000000-0000-4000-8000-000000000301') $$,
  '42501',
  'Not authorized to requeue this certificate PDF',
  'an org_admin in another organization is refused'
);

reset role;
select ok(
  not has_function_privilege('anon', 'public.requeue_certificate_pdf(uuid)', 'execute'),
  'anon cannot call it at all'
);

select * from finish();
rollback;
