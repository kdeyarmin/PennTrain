begin;
select plan(22);

-- PT-006B residuals: organization export archives now expire for real.
-- The storage download policy rejects archives past expires_at, and the
-- run-data-lifecycle sweep (list_expired_organization_exports ->
-- storage removal -> purge_expired_organization_exports) cleans up expired
-- archives and their job rows while honoring data_lifecycle_holds.

insert into public.organizations(id,name,slug,subscription_status) values
  ('77000000-0000-4000-8000-000000000001','Export Expiry Org','export-expiry-org','active');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change,email_change_token_current,reauthentication_token,is_sso_user,is_anonymous)
select '00000000-0000-0000-0000-000000000000',v.id,'authenticated','authenticated',v.email,'x',now(),'{}','{}',now(),now(),'','','','','','',false,false
from (values
  ('77000000-0000-4000-8000-000000000021'::uuid,'export-expiry-admin@test.local'),
  ('77000000-0000-4000-8000-000000000022'::uuid,'export-expiry-platform@test.local')
) as v(id,email);
select set_config('app.privileged_write','on',true);
insert into public.profiles(id,organization_id,email,first_name,last_name,role,is_active) values
  ('77000000-0000-4000-8000-000000000021','77000000-0000-4000-8000-000000000001','export-expiry-admin@test.local','Export','Admin','org_admin',true),
  ('77000000-0000-4000-8000-000000000022',null,'export-expiry-platform@test.local','Export','Platform','platform_admin',true)
on conflict(id) do update set organization_id=excluded.organization_id,role=excluded.role,is_active=true;
select set_config('app.privileged_write','off',true);

insert into public.organization_export_jobs(
  id, organization_id, requested_by, status, attempt_count, completed_at,
  storage_bucket, storage_path, content_sha256, byte_size, table_count, row_count, expires_at
) values
  ('77000000-0000-4000-8000-000000000031','77000000-0000-4000-8000-000000000001','77000000-0000-4000-8000-000000000021',
   'succeeded',1,now() - interval '1 hour','organization-exports',
   '77000000-0000-4000-8000-000000000001/fresh.zip', repeat('a',64), 2048, 3, 42, now() + interval '6 days'),
  ('77000000-0000-4000-8000-000000000032','77000000-0000-4000-8000-000000000001','77000000-0000-4000-8000-000000000021',
   'succeeded',1,now() - interval '8 days','organization-exports',
   '77000000-0000-4000-8000-000000000001/expired.zip', repeat('b',64), 4096, 3, 42, now() - interval '1 day');

insert into storage.objects(bucket_id, name) values
  ('organization-exports','77000000-0000-4000-8000-000000000001/fresh.zip'),
  ('organization-exports','77000000-0000-4000-8000-000000000001/expired.zip');

create or replace function pg_temp.act_as(p_id uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_id, 'role', p_role, 'aal', 'aal2', 'iat', extract(epoch from now())::bigint
  )::text, true);
  if p_role = 'service_role' then set local role service_role;
  else set local role authenticated;
  end if;
end
$$;

-- Structure: the sweep RPCs and the runtime exclusions catalog exist.
select has_function('public','list_expired_organization_exports',array['integer'],
  'expired export listing RPC exists');
select has_function('public','purge_expired_organization_exports',array['uuid[]'],
  'expired export purge RPC exists');
select has_function('public','get_organization_export_exclusions',array[]::text[],
  'runtime export exclusions catalog exists');
select ok(exists(
  select 1 from pg_policies
  where schemaname='storage' and tablename='objects'
    and policyname='organization_exports_download'
    and qual like '%expires_at%'
), 'the export download policy checks archive expiry');

-- Download path: a fresh archive is downloadable, an expired one is not.
select pg_temp.act_as('77000000-0000-4000-8000-000000000021');
select is(
  (select count(*)::integer from storage.objects where bucket_id='organization-exports'),
  1, 'org admin can reach exactly one export archive object');
select results_eq(
  $$ select name from storage.objects where bucket_id='organization-exports' $$,
  $$ values ('77000000-0000-4000-8000-000000000001/fresh.zip') $$,
  'the reachable archive is the unexpired one');
select pg_temp.act_as('77000000-0000-4000-8000-000000000022');
select is(
  (select count(*)::integer from storage.objects where bucket_id='organization-exports'),
  1, 'expiry also applies to platform administrators');

-- The sweep RPCs are service-role only.
select pg_temp.act_as('77000000-0000-4000-8000-000000000021');
select throws_ok(
  $$ select * from public.list_expired_organization_exports() $$,
  '42501', null, 'org admins cannot list expired exports');
select throws_ok(
  $$ select public.purge_expired_organization_exports(array['77000000-0000-4000-8000-000000000032'::uuid]) $$,
  '42501', null, 'org admins cannot purge expired exports');
select throws_ok(
  $$ select * from public.get_organization_export_exclusions() $$,
  '42501', null, 'org admins cannot read the exclusions catalog directly');

-- The exclusions catalog names exactly the tables the tenant catalog cannot see.
select pg_temp.act_as('77000000-0000-4000-8000-000000000021','service_role');
select ok(
  exists(select 1 from public.get_organization_export_exclusions() where table_name='organizations')
  and exists(select 1 from public.get_organization_export_exclusions() where table_name='release_flags'),
  'tables without organization_id appear in the exclusions catalog');
select ok(
  not exists(select 1 from public.get_organization_export_exclusions() where table_name='employees'),
  'tenant-scoped tables stay out of the exclusions catalog');

-- Lifecycle sweep: only the expired archive is listed for purging.
select results_eq(
  $$ select job_id from public.list_expired_organization_exports() $$,
  $$ values ('77000000-0000-4000-8000-000000000032'::uuid) $$,
  'only the expired archive is offered to the sweep');
select is(
  public.purge_expired_organization_exports(array['77000000-0000-4000-8000-000000000031'::uuid]),
  0, 'a fresh archive cannot be purged even when named directly');

-- Legal holds pause the sweep until released.
reset role;
insert into public.data_lifecycle_holds(id, organization_id, source_table, reason, placed_by) values
  ('77000000-0000-4000-8000-000000000041','77000000-0000-4000-8000-000000000001',
   'organization_export_jobs','Litigation hold covering export evidence','77000000-0000-4000-8000-000000000021');
select pg_temp.act_as('77000000-0000-4000-8000-000000000021','service_role');
select is_empty(
  $$ select job_id from public.list_expired_organization_exports() $$,
  'an active legal hold keeps expired archives out of the sweep');
select is(
  public.purge_expired_organization_exports(array['77000000-0000-4000-8000-000000000032'::uuid]),
  0, 'the purge re-checks holds and refuses held archives');
reset role;
update public.data_lifecycle_holds
set released_at = now(), released_by = '77000000-0000-4000-8000-000000000021',
    release_reason = 'Hold released after review'
where id = '77000000-0000-4000-8000-000000000041';
select pg_temp.act_as('77000000-0000-4000-8000-000000000021','service_role');
select results_eq(
  $$ select job_id from public.list_expired_organization_exports() $$,
  $$ values ('77000000-0000-4000-8000-000000000032'::uuid) $$,
  'releasing the hold returns the archive to the sweep');

-- Purge removes the expired row (worker removes the object first) and audits it.
select is(
  public.purge_expired_organization_exports(array['77000000-0000-4000-8000-000000000032'::uuid]),
  1, 'the expired archive row is purged');
select results_eq(
  $$ select id from public.organization_export_jobs
     where organization_id='77000000-0000-4000-8000-000000000001' $$,
  $$ values ('77000000-0000-4000-8000-000000000031'::uuid) $$,
  'only the fresh export job row survives the purge');
select is(
  public.purge_expired_organization_exports(array['77000000-0000-4000-8000-000000000032'::uuid]),
  0, 'purging is idempotent once the row is gone');
select ok(exists(
  select 1 from public.audit_logs
  where entity_type='organization_export'
    and entity_id='77000000-0000-4000-8000-000000000032'
    and action='expired_purged'
    and organization_id='77000000-0000-4000-8000-000000000001'
), 'the purge leaves an audit trail');

-- Orphaned objects (job row gone, object still present) stay default-deny.
select pg_temp.act_as('77000000-0000-4000-8000-000000000021');
select results_eq(
  $$ select name from storage.objects where bucket_id='organization-exports' $$,
  $$ values ('77000000-0000-4000-8000-000000000001/fresh.zip') $$,
  'an orphaned archive object without a live job row is not downloadable');

select * from finish();
rollback;
