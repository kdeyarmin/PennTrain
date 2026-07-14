begin;
select plan(28);

-- State form document analyzer: platform_admin-only enqueue/visibility, review-draft and
-- approval gating, service-role worker claim/finish with lease checks and retry backoff,
-- manual retry, and resident-chart linkage validation.

insert into public.organizations(id,name,slug,subscription_status) values
  ('18000000-0000-4000-8000-000000000001','Analyzer Org A','analyzer-org-a','active');
insert into public.facilities(id,organization_id,name,facility_type) values
  ('18000000-0000-4000-8000-000000000011','18000000-0000-4000-8000-000000000001','Analyzer Facility A1','PCH'),
  ('18000000-0000-4000-8000-000000000012','18000000-0000-4000-8000-000000000001','Analyzer Facility A2','PCH');
insert into public.residents(id,organization_id,facility_id,first_name,last_name,admission_date) values
  ('18000000-0000-4000-8000-000000000031','18000000-0000-4000-8000-000000000001','18000000-0000-4000-8000-000000000012','Martha','Ellis','2024-03-15');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change,email_change_token_current,reauthentication_token,is_sso_user,is_anonymous)
select '00000000-0000-0000-0000-000000000000',v.id,'authenticated','authenticated',v.email,'x',now(),'{}','{}',now(),now(),'','','','','','',false,false
from (values
  ('18000000-0000-4000-8000-000000000021'::uuid,'analyzer-platform@test.local'),
  ('18000000-0000-4000-8000-000000000022'::uuid,'analyzer-orgadmin@test.local')
) as v(id,email);
select set_config('app.privileged_write','on',true);
insert into public.profiles(id,organization_id,email,first_name,last_name,role,is_active) values
  ('18000000-0000-4000-8000-000000000021',null,'analyzer-platform@test.local','Analyzer','Platform','platform_admin',true),
  ('18000000-0000-4000-8000-000000000022','18000000-0000-4000-8000-000000000001','analyzer-orgadmin@test.local','Analyzer','OrgAdmin','org_admin',true)
on conflict(id) do update set organization_id=excluded.organization_id,role=excluded.role,is_active=true;
select set_config('app.privileged_write','off',true);

create or replace function pg_temp.act_as(p_id uuid) returns void language plpgsql as $$begin reset role;perform set_config('request.jwt.claims',jsonb_build_object('sub',p_id,'role','authenticated','aal','aal2','iat',extract(epoch from now())::bigint)::text,true);set local role authenticated;end$$;
create temp table analyzer_ids(key text primary key, id uuid) on commit drop;
grant all on analyzer_ids to authenticated;

-- Enqueue authorization + validation.
select pg_temp.act_as('18000000-0000-4000-8000-000000000022');
select throws_ok(
  $$ select public.enqueue_document_analyzer_job('form.pdf', 1000, 'uploads/x-form.pdf') $$,
  '42501', null,
  'org admins cannot enqueue analyzer jobs'
);
select pg_temp.act_as('18000000-0000-4000-8000-000000000021');
select throws_ok(
  $$ select public.enqueue_document_analyzer_job('form.pdf', 1000, 'somewhere/x-form.pdf') $$,
  '22023', null,
  'source paths outside uploads/ are rejected'
);
select throws_ok(
  $$ select public.enqueue_document_analyzer_job('form.png', 1000, 'uploads/x-form.png') $$,
  '22023', null,
  'non-PDF uploads are rejected'
);
insert into analyzer_ids(key,id)
  select 'first', (public.enqueue_document_analyzer_job('Martha_Ellis.pdf', 900000, 'uploads/aaa-Martha_Ellis.pdf')).id;
select results_eq(
  $$ select status, source_bucket, resident_name from public.document_analyzer_jobs
     where id = (select id from analyzer_ids where key='first') $$,
  $$ values ('queued'::text, 'state-form-analyzer'::text, ''::text) $$,
  'a platform admin enqueue creates a queued job'
);

-- Review gating before extraction lands.
select throws_ok(
  $$ select public.update_document_analyzer_job_draft(
       (select id from analyzer_ids where key='first'), 'X','Y','Z','07/12/2026', null, 'notes', null) $$,
  '55000', null,
  'drafts cannot be edited before extraction completes'
);
select throws_ok(
  $$ select public.approve_document_analyzer_job((select id from analyzer_ids where key='first')) $$,
  '55000', null,
  'jobs cannot be approved before extraction completes'
);
select throws_ok(
  $$ select public.retry_document_analyzer_job((select id from analyzer_ids where key='first')) $$,
  '55000', null,
  'only failed jobs can be retried'
);

-- Queue visibility is platform_admin only.
select pg_temp.act_as('18000000-0000-4000-8000-000000000022');
select results_eq(
  $$ select count(*)::int from public.document_analyzer_jobs $$,
  array[0],
  'org admins see none of the analyzer queue'
);
select pg_temp.act_as('18000000-0000-4000-8000-000000000021');
select results_eq(
  $$ select count(*)::int from public.document_analyzer_jobs $$,
  array[1],
  'platform admins see the analyzer queue'
);
reset role;

-- Worker lifecycle: claim -> extraction lands as a reviewable draft.
create temp table analyzer_claims on commit drop as
select * from public.claim_document_analyzer_jobs(
  '18000000-0000-4000-8000-000000000077',
  (select id from analyzer_ids where key='first'), 1);
select results_eq(
  $$ select attempt_count, (run_id is not null), source_path from analyzer_claims $$,
  $$ values (1, true, 'uploads/aaa-Martha_Ellis.pdf'::text) $$,
  'claiming marks the job processing with a lease'
);
select ok(
  not public.finish_document_analyzer_job(
    (select id from analyzer_ids where key='first'),
    '18000000-0000-4000-8000-000000000099', 'needs_review'),
  'finishing with a stale lease is refused'
);
select ok(
  public.finish_document_analyzer_job(
    (select job_id from analyzer_claims),
    (select run_id from analyzer_claims),
    'needs_review', 'claude-test', 4, 86,
    'Martha J. Ellis', 'Sunrise Personal Care Home',
    'RASP (Resident Assessment-Support Plan)', '07/12/2026', '2024-03-15',
    'Walker with standby assist.',
    '[{"field":"review_due_date","message":"Smudged","severity":"warning","suggested_value":null}]'::jsonb),
  'the leased worker records the extraction'
);
select results_eq(
  $$ select status, confidence, resident_name, jsonb_array_length(issues) from public.document_analyzer_jobs
     where id = (select id from analyzer_ids where key='first') $$,
  $$ values ('needs_review'::text, 86, 'Martha J. Ellis'::text, 1) $$,
  'extraction results land on the job row as a reviewable draft'
);

-- Review workflow: draft edits, approval requirements, approval reset.
select pg_temp.act_as('18000000-0000-4000-8000-000000000021');
select results_eq(
  $$ select (public.update_document_analyzer_job_draft(
       (select id from analyzer_ids where key='first'),
       'Martha J. Ellis', 'Sunrise Personal Care Home',
       'RASP (Resident Assessment-Support Plan)', '', null, 'Corrected notes.',
       '18000000-0000-4000-8000-000000000012'::uuid)).organization_id $$,
  $$ values ('18000000-0000-4000-8000-000000000001'::uuid) $$,
  'draft updates persist and derive the organization from the chosen facility'
);
select throws_ok(
  $$ select public.approve_document_analyzer_job((select id from analyzer_ids where key='first')) $$,
  '22023', null,
  'approval requires the review due date'
);
select throws_ok(
  $$ select public.update_document_analyzer_job_draft(
       (select id from analyzer_ids where key='first'),
       'Martha J. Ellis', 'Sunrise Personal Care Home',
       'RASP (Resident Assessment-Support Plan)', '07/12/2026', null, 'Corrected notes.',
       '99000000-0000-4000-8000-000000000099'::uuid) $$,
  '22023', null,
  'draft updates reject facilities that do not exist'
);
select results_eq(
  $$ select (public.update_document_analyzer_job_draft(
       (select id from analyzer_ids where key='first'),
       'Martha J. Ellis', 'Sunrise Personal Care Home',
       'RASP (Resident Assessment-Support Plan)', '07/12/2026', '2024-03-15'::date, 'Corrected notes.',
       '18000000-0000-4000-8000-000000000012'::uuid)).review_due_date $$,
  $$ values ('07/12/2026'::text) $$,
  'a complete draft can be restored'
);
select results_eq(
  $$ select (public.approve_document_analyzer_job((select id from analyzer_ids where key='first'))).approved_for_export $$,
  $$ values (true) $$,
  'a complete reviewed draft can be approved for export'
);
select results_eq(
  $$ select (public.update_document_analyzer_job_draft(
       (select id from analyzer_ids where key='first'),
       'Martha Jane Ellis', 'Sunrise Personal Care Home',
       'RASP (Resident Assessment-Support Plan)', '07/12/2026', '2024-03-15'::date, 'Corrected notes.',
       '18000000-0000-4000-8000-000000000012'::uuid)).approved_for_export $$,
  $$ values (false) $$,
  'editing an approved draft re-opens the human review gate'
);

-- Resident chart linkage validates the facility choice.
select throws_ok(
  $$ select public.mark_document_analyzer_job_chart_created(
       (select id from analyzer_ids where key='first'),
       '99000000-0000-4000-8000-000000000031'::uuid) $$,
  '22023', null,
  'chart linkage rejects residents that do not exist'
);
select results_eq(
  $$ select (public.mark_document_analyzer_job_chart_created(
       (select id from analyzer_ids where key='first'),
       '18000000-0000-4000-8000-000000000031'::uuid)).chart_creation_status $$,
  $$ values ('created'::text) $$,
  'a resident in the selected facility can be linked'
);
select throws_ok(
  $$ select public.update_document_analyzer_job_draft(
       (select id from analyzer_ids where key='first'),
       'Martha Jane Ellis', 'Sunrise Personal Care Home',
       'RASP (Resident Assessment-Support Plan)', '07/12/2026', '2024-03-15'::date, 'Corrected notes.',
       '18000000-0000-4000-8000-000000000011'::uuid) $$,
  '55000', null,
  'the facility cannot change after a resident chart is linked'
);
select throws_ok(
  $$ select public.decline_document_analyzer_job_chart((select id from analyzer_ids where key='first')) $$,
  '55000', null,
  'a linked chart cannot be declined afterwards'
);
reset role;

-- Failure path: retries with backoff, exhausts to failed, and manual retry re-queues.
select pg_temp.act_as('18000000-0000-4000-8000-000000000021');
insert into analyzer_ids(key,id)
  select 'flaky', (public.enqueue_document_analyzer_job('Flaky_Scan.pdf', 500, 'uploads/bbb-Flaky_Scan.pdf')).id;
reset role;
do $$
declare v_claim record;
begin
  for i in 1..3 loop
    update public.document_analyzer_jobs set available_at = now()
      where id = (select id from analyzer_ids where key='flaky');
    select * into v_claim from public.claim_document_analyzer_jobs(
      '18000000-0000-4000-8000-000000000077',
      (select id from analyzer_ids where key='flaky'), 1);
    perform public.finish_document_analyzer_job(
      v_claim.job_id, v_claim.run_id, null, null, null, null,
      null, null, null, null, null, null, null,
      'anthropic_error', 'simulated failure');
    if i = 1 then
      -- First failure retries with backoff rather than failing outright.
      if (select status from public.document_analyzer_jobs where id = v_claim.job_id) <> 'queued' then
        raise exception 'expected first failure to re-queue';
      end if;
    end if;
  end loop;
end $$;
select results_eq(
  $$ select status, attempt_count from public.document_analyzer_jobs
     where id = (select id from analyzer_ids where key='flaky') $$,
  $$ values ('failed'::text, 3) $$,
  'exhausted attempts mark the extraction failed'
);
select pg_temp.act_as('18000000-0000-4000-8000-000000000021');
select results_eq(
  $$ select (public.retry_document_analyzer_job((select id from analyzer_ids where key='flaky'))).status $$,
  $$ values ('queued'::text) $$,
  'a super admin can re-queue a failed extraction'
);
select results_eq(
  $$ select attempt_count, last_error_message is null from public.document_analyzer_jobs
     where id = (select id from analyzer_ids where key='flaky') $$,
  $$ values (0, true) $$,
  'manual retry resets attempts and clears the recorded error'
);
reset role;

-- A worker that dies uncleanly on the final attempt leaves an exhausted stale lease that
-- neither reclaim nor finish nor retry could touch; the next claim sweep fails it out so
-- the manual retry RPC can recover it.
create temp table analyzer_lost_claims on commit drop as
select * from public.claim_document_analyzer_jobs(
  '18000000-0000-4000-8000-000000000077',
  (select id from analyzer_ids where key='flaky'), 1);
update public.document_analyzer_jobs
  set attempt_count = max_attempts, locked_at = now() - interval '16 minutes'
  where id = (select id from analyzer_ids where key='flaky');
select results_eq(
  $$ select count(*)::int from public.claim_document_analyzer_jobs(
       '18000000-0000-4000-8000-000000000078', null, 1) $$,
  array[0],
  'an exhausted stale lease is never handed back to a worker'
);
select results_eq(
  $$ select status, last_error_code from public.document_analyzer_jobs
     where id = (select id from analyzer_ids where key='flaky') $$,
  $$ values ('failed'::text, 'worker_lost'::text) $$,
  'the claim sweep fails out exhausted stale leases for manual retry'
);

select * from finish();
rollback;
