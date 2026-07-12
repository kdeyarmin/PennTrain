begin;
select plan(16);

-- Async compliance binder exports: caller-authorized enqueue with role scoping and
-- in-flight dedup, service-role worker claim/finish with lease checks and retry
-- backoff, and org-scoped queue visibility.

insert into public.organizations(id,name,slug,subscription_status) values
  ('17000000-0000-4000-8000-000000000001','Binder Org G','binder-org-g','active'),
  ('17000000-0000-4000-8000-000000000002','Binder Org H','binder-org-h','active');
insert into public.facilities(id,organization_id,name,facility_type) values
  ('17000000-0000-4000-8000-000000000011','17000000-0000-4000-8000-000000000001','Binder Facility G1','PCH'),
  ('17000000-0000-4000-8000-000000000012','17000000-0000-4000-8000-000000000001','Binder Facility G2','PCH');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change,email_change_token_current,reauthentication_token,is_sso_user,is_anonymous)
select '00000000-0000-0000-0000-000000000000',v.id,'authenticated','authenticated',v.email,'x',now(),'{}','{}',now(),now(),'','','','','','',false,false
from (values
  ('17000000-0000-4000-8000-000000000021'::uuid,'binder-admin-g@test.local'),
  ('17000000-0000-4000-8000-000000000022'::uuid,'binder-manager-g@test.local'),
  ('17000000-0000-4000-8000-000000000023'::uuid,'binder-worker-g@test.local'),
  ('17000000-0000-4000-8000-000000000024'::uuid,'binder-admin-h@test.local')
) as v(id,email);
select set_config('app.privileged_write','on',true);
insert into public.profiles(id,organization_id,email,first_name,last_name,role,is_active) values
  ('17000000-0000-4000-8000-000000000021','17000000-0000-4000-8000-000000000001','binder-admin-g@test.local','Binder','Admin G','org_admin',true),
  ('17000000-0000-4000-8000-000000000022','17000000-0000-4000-8000-000000000001','binder-manager-g@test.local','Binder','Manager G','facility_manager',true),
  ('17000000-0000-4000-8000-000000000023','17000000-0000-4000-8000-000000000001','binder-worker-g@test.local','Binder','Worker G','employee',true),
  ('17000000-0000-4000-8000-000000000024','17000000-0000-4000-8000-000000000002','binder-admin-h@test.local','Binder','Admin H','org_admin',true)
on conflict(id) do update set organization_id=excluded.organization_id,role=excluded.role,is_active=true;
select set_config('app.privileged_write','off',true);
insert into public.facility_assignments(profile_id,facility_id) values
  ('17000000-0000-4000-8000-000000000022','17000000-0000-4000-8000-000000000011');

create or replace function pg_temp.act_as(p_id uuid) returns void language plpgsql as $$begin reset role;perform set_config('request.jwt.claims',jsonb_build_object('sub',p_id,'role','authenticated','aal','aal2','iat',extract(epoch from now())::bigint)::text,true);set local role authenticated;end$$;
create temp table binder_ids(key text primary key, id uuid) on commit drop;
grant all on binder_ids to authenticated;

-- Enqueue authorization + scoping.
select pg_temp.act_as('17000000-0000-4000-8000-000000000023');
select throws_ok(
  $$ select public.request_binder_export() $$,
  '42501', null,
  'employees cannot request binder exports'
);
select pg_temp.act_as('17000000-0000-4000-8000-000000000021');
insert into binder_ids(key,id) select 'admin', (public.request_binder_export()).id;
select results_eq(
  $$ select status, facility_ids from public.binder_export_jobs
     where id = (select id from binder_ids where key='admin') $$,
  $$ values ('pending'::text, '{}'::uuid[]) $$,
  'an org admin request enqueues a pending org-wide export'
);
select is(
  (public.request_binder_export()).id,
  (select id from binder_ids where key='admin'),
  'a repeated identical request returns the in-flight job'
);
select ok(
  (public.request_binder_export(null, array['17000000-0000-4000-8000-000000000012'::uuid])).id
    <> (select id from binder_ids where key='admin'),
  'a different facility scope starts its own export'
);
select throws_ok(
  $$ select public.request_binder_export(null, array['99000000-0000-4000-8000-000000000099'::uuid]) $$,
  '22023', null,
  'facility scope outside the organization is rejected'
);
select pg_temp.act_as('17000000-0000-4000-8000-000000000022');
insert into binder_ids(key,id) select 'manager', (public.request_binder_export()).id;
select results_eq(
  $$ select facility_ids from public.binder_export_jobs
     where id = (select id from binder_ids where key='manager') $$,
  $$ values (array['17000000-0000-4000-8000-000000000011'::uuid]) $$,
  'a facility manager is auto-scoped to their assigned facilities'
);

-- Queue visibility: a facility manager sees only exports they requested or whose scope is
-- entirely within their assigned facilities -- never the org-wide or other-facility exports
-- the org admin created (the download path signs on the strength of this visibility).
select results_eq(
  $$ select count(*)::int from public.binder_export_jobs $$,
  array[1],
  'a facility manager sees only exports scoped to their assigned facilities'
);
select results_eq(
  $$ select count(*)::int from public.binder_export_jobs
     where id = (select id from binder_ids where key='admin') $$,
  array[0],
  'a facility manager cannot see an org-wide export they did not request'
);

-- Queue visibility is org-scoped.
select pg_temp.act_as('17000000-0000-4000-8000-000000000024');
select results_eq(
  $$ select count(*)::int from public.binder_export_jobs $$,
  array[0],
  'another organization''s admin sees none of the queue'
);
reset role;

-- Worker lifecycle: claim -> succeed.
create temp table binder_claims on commit drop as
select * from public.claim_binder_export_jobs(
  '17000000-0000-4000-8000-000000000077',
  (select id from binder_ids where key='manager'), 1);
select results_eq(
  $$ select attempt_count, (run_id is not null) from binder_claims $$,
  $$ values (1, true) $$,
  'claiming marks the job processing with a lease'
);
select ok(
  not public.finish_binder_export_job(
    (select id from binder_ids where key='manager'),
    '17000000-0000-4000-8000-000000000099', 'binder-exports', 'x/y.pdf'),
  'finishing with a stale lease is refused'
);
select ok(
  public.finish_binder_export_job(
    (select job_id from binder_claims),
    (select run_id from binder_claims),
    'binder-exports',
    '17000000-0000-4000-8000-000000000001/manager.pdf'),
  'the leased worker can finish the job'
);
select results_eq(
  $$ select status, storage_bucket, storage_path from public.binder_export_jobs
     where id = (select id from binder_ids where key='manager') $$,
  $$ values ('succeeded'::text, 'binder-exports'::text,
             '17000000-0000-4000-8000-000000000001/manager.pdf'::text) $$,
  'a finished export records its storage artifact'
);

-- Worker lifecycle: failure retries with backoff, then exhausts to failed.
create temp table binder_fail_claims on commit drop as
select * from public.claim_binder_export_jobs(
  '17000000-0000-4000-8000-000000000077',
  (select id from binder_ids where key='admin'), 1);
select ok(
  public.finish_binder_export_job(
    (select job_id from binder_fail_claims),
    (select run_id from binder_fail_claims),
    null, null, 'render_failed', 'simulated failure'),
  'a failed attempt is recorded'
);
select results_eq(
  $$ select status, available_at > now() from public.binder_export_jobs
     where id = (select id from binder_ids where key='admin') $$,
  $$ values ('pending'::text, true) $$,
  'a failed attempt retries later with backoff'
);
do $$
declare v_claim record;
begin
  for i in 1..2 loop
    update public.binder_export_jobs set available_at = now()
      where id = (select id from binder_ids where key='admin');
    select * into v_claim from public.claim_binder_export_jobs(
      '17000000-0000-4000-8000-000000000077',
      (select id from binder_ids where key='admin'), 1);
    perform public.finish_binder_export_job(
      v_claim.job_id, v_claim.run_id, null, null, 'render_failed', 'simulated failure');
  end loop;
end $$;
select results_eq(
  $$ select status, attempt_count from public.binder_export_jobs
     where id = (select id from binder_ids where key='admin') $$,
  $$ values ('failed'::text, 3) $$,
  'exhausted attempts mark the export failed'
);

select * from finish();
rollback;
