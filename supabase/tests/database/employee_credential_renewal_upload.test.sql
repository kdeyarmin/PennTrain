-- pgTAP coverage for 20260905020000: an employee can attach their own credential renewal
-- evidence, and only their own.
--
-- The RPC that records a renewal submission has admitted the credential's own employee since
-- 20260711213000, but the two writes in front of it -- the storage object and the
-- employee_credential_documents row -- admitted only org_admin and facility_manager, so
-- /me/credentials failed at the first step and the feature was unreachable for the only role it
-- exists for. Nothing tested either write path from an employee session.
-- Run with: supabase test db (requires the local Supabase Docker stack).

begin;
select plan(10);

insert into public.organizations(id, name, slug) values
  ('3b000000-0000-4000-8000-000000000001', 'Renewal Org', 'renewal-upload-org');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('3b000000-0000-4000-8000-000000000011', '3b000000-0000-4000-8000-000000000001', 'Renewal Facility', 'PCH'),
  ('3b000000-0000-4000-8000-000000000012', '3b000000-0000-4000-8000-000000000001', 'Other Facility', 'PCH');

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
  ('3b000000-0000-4000-8000-000000000101'::uuid, 'renewal-worker@test.local'),
  ('3b000000-0000-4000-8000-000000000102'::uuid, 'renewal-colleague@test.local')
) v(id, email);

select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('3b000000-0000-4000-8000-000000000101', '3b000000-0000-4000-8000-000000000001', 'renewal-worker@test.local', 'Renewal', 'Worker', 'employee', true),
  ('3b000000-0000-4000-8000-000000000102', '3b000000-0000-4000-8000-000000000001', 'renewal-colleague@test.local', 'Renewal', 'Colleague', 'employee', true)
on conflict (id) do update set
  organization_id = excluded.organization_id, email = excluded.email,
  first_name = excluded.first_name, last_name = excluded.last_name,
  role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);

insert into public.employees(
  id, organization_id, facility_id, profile_id, employee_number, first_name, last_name,
  email, hire_date, job_title, status
) values
  ('3b000000-0000-4000-8000-000000000201', '3b000000-0000-4000-8000-000000000001',
   '3b000000-0000-4000-8000-000000000011', '3b000000-0000-4000-8000-000000000101',
   'RW-1', 'Renewal', 'Worker', 'renewal-worker@test.local', public.pa_today()-200, 'Direct Care Worker', 'active'),
  ('3b000000-0000-4000-8000-000000000202', '3b000000-0000-4000-8000-000000000001',
   '3b000000-0000-4000-8000-000000000011', '3b000000-0000-4000-8000-000000000102',
   'RW-2', 'Renewal', 'Colleague', 'renewal-colleague@test.local', public.pa_today()-200, 'Direct Care Worker', 'active');

insert into public.employee_credentials(
  id, organization_id, facility_id, employee_id, credential_type, status, issue_date, expiration_date
) values
  ('3b000000-0000-4000-8000-000000000401', '3b000000-0000-4000-8000-000000000001',
   '3b000000-0000-4000-8000-000000000011', '3b000000-0000-4000-8000-000000000201',
   'tb_screening', 'compliant', public.pa_today()-300, public.pa_today()+20),
  ('3b000000-0000-4000-8000-000000000402', '3b000000-0000-4000-8000-000000000001',
   '3b000000-0000-4000-8000-000000000011', '3b000000-0000-4000-8000-000000000202',
   'tb_screening', 'compliant', public.pa_today()-300, public.pa_today()+20);

create or replace function pg_temp.act_as(p_profile_id uuid)
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_profile_id, 'role', 'authenticated', 'aal', 'aal1',
    'iat', extract(epoch from now())::bigint
  )::text, true);
  set local role authenticated;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- The read path already admitted the employee; the write path is what was missing.
-- ---------------------------------------------------------------------------------------
select pg_temp.act_as('3b000000-0000-4000-8000-000000000101');

select lives_ok(
  $$ insert into public.employee_credential_documents(
       organization_id, facility_id, employee_id, credential_id,
       file_name, storage_path, file_type, file_size
     ) values (
       '3b000000-0000-4000-8000-000000000001', '3b000000-0000-4000-8000-000000000011',
       '3b000000-0000-4000-8000-000000000201', '3b000000-0000-4000-8000-000000000401',
       'cpr-card.pdf',
       '3b000000-0000-4000-8000-000000000001/3b000000-0000-4000-8000-000000000011/doc-a.pdf',
       'application/pdf', 1024) $$,
  'an employee can attach evidence to their own credential'
);

select is(
  (select count(*)::int from public.employee_credential_documents
   where credential_id = '3b000000-0000-4000-8000-000000000401'),
  1,
  'the row is stored'
);

-- The scope stamp derives employee/facility from the credential, so naming a colleague's
-- credential attaches the document to THEM -- and the policy then refuses it as not the caller's.
select throws_ok(
  $$ insert into public.employee_credential_documents(
       organization_id, facility_id, employee_id, credential_id,
       file_name, storage_path, file_type, file_size
     ) values (
       '3b000000-0000-4000-8000-000000000001', '3b000000-0000-4000-8000-000000000011',
       '3b000000-0000-4000-8000-000000000201', '3b000000-0000-4000-8000-000000000402',
       'not-mine.pdf',
       '3b000000-0000-4000-8000-000000000001/3b000000-0000-4000-8000-000000000011/doc-b.pdf',
       'application/pdf', 1024) $$,
  '42501',
  null,
  'an employee cannot attach evidence to a colleague''s credential'
);

select ok(
  not exists (
    select 1 from public.employee_credential_documents
    where credential_id = '3b000000-0000-4000-8000-000000000402'
  ),
  'and nothing was written for the colleague'
);

-- Deleting evidence stays with the administrator: a submitted document is what a reviewer acts on.
-- RLS refuses a DELETE by filtering the row out of the statement, not by raising, so the assertion
-- has to be that the row survives -- `throws_ok` here would pass for the wrong reason (and did,
-- while the insert above was still being refused and there was nothing to delete).
select lives_ok(
  $$ delete from public.employee_credential_documents
     where credential_id = '3b000000-0000-4000-8000-000000000401' $$,
  'a delete attempt by the employee does not raise'
);
select is(
  (select count(*)::int from public.employee_credential_documents
   where credential_id = '3b000000-0000-4000-8000-000000000401'),
  1,
  'but it removes nothing -- deleting credential evidence stays with the administrator'
);

-- ---------------------------------------------------------------------------------------
-- Storage: only under the employee's own organization and facility prefix.
-- ---------------------------------------------------------------------------------------
reset role;
select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'credential-documents write'
      and with_check like '%employees e%'
  ),
  'the storage write policy consults the caller''s own employee row'
);

select pg_temp.act_as('3b000000-0000-4000-8000-000000000101');

select lives_ok(
  $$ insert into storage.objects(bucket_id, name, owner)
     values ('credential-documents',
             '3b000000-0000-4000-8000-000000000001/3b000000-0000-4000-8000-000000000011/own.pdf',
             '3b000000-0000-4000-8000-000000000101') $$,
  'an employee can upload under their own organization and facility prefix'
);

select throws_ok(
  $$ insert into storage.objects(bucket_id, name, owner)
     values ('credential-documents',
             '3b000000-0000-4000-8000-000000000001/3b000000-0000-4000-8000-000000000012/elsewhere.pdf',
             '3b000000-0000-4000-8000-000000000101') $$,
  '42501',
  null,
  'but not under another facility in the same organization'
);

select throws_ok(
  $$ insert into storage.objects(bucket_id, name, owner)
     values ('credential-documents',
             '99000000-0000-4000-8000-000000000001/3b000000-0000-4000-8000-000000000011/other-org.pdf',
             '3b000000-0000-4000-8000-000000000101') $$,
  '42501',
  null,
  'and not under another organization'
);

select * from finish();
rollback;
