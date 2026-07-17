begin;
select plan(19);

insert into public.organizations (id, name, slug)
values
  ('91000000-0000-4000-8000-000000000001', 'Policy Security A', 'policy-security-a'),
  ('91000000-0000-4000-8000-000000000002', 'Policy Security B', 'policy-security-b');

insert into public.facilities (id, organization_id, name, facility_type)
values
  ('91000000-0000-4000-8000-000000000011', '91000000-0000-4000-8000-000000000001', 'Policy A PCH', 'PCH'),
  ('91000000-0000-4000-8000-000000000012', '91000000-0000-4000-8000-000000000002', 'Policy B ALR', 'ALR');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
)
select
  '00000000-0000-0000-0000-000000000000', fixture.id, 'authenticated',
  'authenticated', fixture.email, 'x', now(), '{}'::jsonb, '{}'::jsonb,
  now(), now(), '', '', '', '', '', '', false, false
from (values
  ('91000000-0000-4000-8000-000000000101'::uuid, 'policy-manager-a@test.local'),
  ('91000000-0000-4000-8000-000000000102'::uuid, 'policy-employee-a@test.local'),
  ('91000000-0000-4000-8000-000000000103'::uuid, 'policy-employee-b@test.local')
) as fixture(id, email);

select set_config('app.privileged_write', 'on', true);
insert into public.profiles (
  id, organization_id, email, first_name, last_name, role, is_active
)
values
  ('91000000-0000-4000-8000-000000000101', '91000000-0000-4000-8000-000000000001',
   'policy-manager-a@test.local', 'Policy', 'Manager', 'facility_manager', true),
  ('91000000-0000-4000-8000-000000000102', '91000000-0000-4000-8000-000000000001',
   'policy-employee-a@test.local', 'Policy', 'Employee A', 'employee', true),
  ('91000000-0000-4000-8000-000000000103', '91000000-0000-4000-8000-000000000002',
   'policy-employee-b@test.local', 'Policy', 'Employee B', 'employee', true)
on conflict (id) do update set
  organization_id = excluded.organization_id,
  email = excluded.email,
  role = excluded.role,
  is_active = excluded.is_active;
select set_config('app.privileged_write', 'off', true);

insert into public.facility_assignments (profile_id, facility_id)
values ('91000000-0000-4000-8000-000000000101', '91000000-0000-4000-8000-000000000011');

insert into public.employees (
  id, organization_id, facility_id, profile_id, first_name, last_name, job_title
)
values
  ('91000000-0000-4000-8000-000000000201', '91000000-0000-4000-8000-000000000001',
   '91000000-0000-4000-8000-000000000011', '91000000-0000-4000-8000-000000000102',
   'Policy', 'Employee A', 'Direct Care Worker'),
  ('91000000-0000-4000-8000-000000000202', '91000000-0000-4000-8000-000000000002',
   '91000000-0000-4000-8000-000000000012', '91000000-0000-4000-8000-000000000103',
   'Policy', 'Employee B', 'Direct Care Worker');

insert into public.policy_documents (id, organization_id, title)
values
  ('91000000-0000-4000-8000-000000000301', '91000000-0000-4000-8000-000000000001', 'Policy A One'),
  ('91000000-0000-4000-8000-000000000302', '91000000-0000-4000-8000-000000000001', 'Policy A Two'),
  ('91000000-0000-4000-8000-000000000303', '91000000-0000-4000-8000-000000000002', 'Policy B One');

insert into public.policy_document_versions (
  id, policy_document_id, organization_id, version_number, storage_path,
  file_name, file_type, content_hash, status, published_at
)
values
  ('91000000-0000-4000-8000-000000000311', '91000000-0000-4000-8000-000000000301',
   '91000000-0000-4000-8000-000000000001', 1,
   '91000000-0000-4000-8000-000000000001/91000000-0000-4000-8000-000000000301/v1.pdf',
   'policy-a-one.pdf', 'application/pdf', repeat('a', 64), 'published', now()),
  ('91000000-0000-4000-8000-000000000312', '91000000-0000-4000-8000-000000000302',
   '91000000-0000-4000-8000-000000000001', 1,
   '91000000-0000-4000-8000-000000000001/91000000-0000-4000-8000-000000000302/v1.pdf',
   'policy-a-two.pdf', 'application/pdf', repeat('b', 64), 'published', now()),
  ('91000000-0000-4000-8000-000000000313', '91000000-0000-4000-8000-000000000303',
   '91000000-0000-4000-8000-000000000002', 1,
   '91000000-0000-4000-8000-000000000002/91000000-0000-4000-8000-000000000303/v1.pdf',
   'policy-b-one.pdf', 'application/pdf', repeat('c', 64), 'published', now());

update public.policy_documents
set current_version_id = '91000000-0000-4000-8000-000000000311'
where id = '91000000-0000-4000-8000-000000000301';

insert into public.policy_attestation_campaigns (
  id, organization_id, policy_document_id, policy_document_version_id,
  name, due_date
)
values (
  '91000000-0000-4000-8000-000000000401',
  '91000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000301',
  '91000000-0000-4000-8000-000000000311',
  'Policy A campaign', date '2026-08-15'
);

create or replace function pg_temp.act_as(p_profile_id uuid, p_aal text)
returns void
language plpgsql
as $function$
begin
  reset role;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', p_profile_id,
      'role', 'authenticated',
      'aal', p_aal,
      'iat', extract(epoch from now())::bigint
    )::text,
    true
  );
  set local role authenticated;
end;
$function$;

select pg_temp.act_as('91000000-0000-4000-8000-000000000101', 'aal2');
select ok(
  public.identity_operation_requires_aal2('policy_document_admin'),
  'policy administration is part of the privileged MFA baseline'
);
reset role;

select matches(
  (select column_default::text from information_schema.columns
   where table_schema = 'public'
     and table_name = 'identity_security_policies'
     and column_name = 'sensitive_operations'),
  'policy_document_admin',
  'new tenant security policies inherit the policy-administration MFA floor'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_constraint
    where conname in (
      'policy_documents_id_org_uk',
      'policy_document_versions_identity_uk',
      'policy_document_versions_document_org_fk',
      'policy_attestation_campaigns_identity_uk',
      'policy_attestation_campaigns_document_version_fk',
      'policy_attestations_campaign_version_fk'
    )
  ),
  6,
  'composite document, version, campaign, and assignment constraints are installed'
);

select throws_ok(
  $$ insert into public.policy_document_versions (
       id, policy_document_id, organization_id, version_number, storage_path,
       file_name, file_type, content_hash
     ) values (
       '91000000-0000-4000-8000-000000000321',
       '91000000-0000-4000-8000-000000000301',
       '91000000-0000-4000-8000-000000000002', 2,
       'cross-tenant.pdf', 'cross-tenant.pdf', 'application/pdf', repeat('d', 64)
     ) $$,
  '23503', null,
  'a version cannot claim an organization different from its parent document'
);

select throws_ok(
  $$ insert into public.policy_attestation_campaigns (
       id, organization_id, policy_document_id, policy_document_version_id, name
     ) values (
       '91000000-0000-4000-8000-000000000402',
       '91000000-0000-4000-8000-000000000001',
       '91000000-0000-4000-8000-000000000301',
       '91000000-0000-4000-8000-000000000312', 'Mismatched campaign'
     ) $$,
  '23503', null,
  'a campaign version must belong to the campaign document and organization'
);

select throws_ok(
  $$ update public.policy_documents
     set current_version_id = '91000000-0000-4000-8000-000000000312'
     where id = '91000000-0000-4000-8000-000000000301' $$,
  '23514', null,
  'a document cannot publish another document version as current'
);

select pg_temp.act_as('91000000-0000-4000-8000-000000000101', 'aal1');
select throws_ok(
  $$ insert into public.policy_documents (
       id, organization_id, title
     ) values (
       '91000000-0000-4000-8000-000000000304',
       '91000000-0000-4000-8000-000000000001', 'AAL1 document'
     ) $$,
  '42501', null,
  'an AAL1 manager cannot create a policy document through the Data API'
);

select pg_temp.act_as('91000000-0000-4000-8000-000000000101', 'aal2');
select lives_ok(
  $$ insert into public.policy_documents (
       id, organization_id, title
     ) values (
       '91000000-0000-4000-8000-000000000304',
       '91000000-0000-4000-8000-000000000001', 'AAL2 document'
     ) $$,
  'an AAL2 manager retains the intended policy-authoring path'
);

select pg_temp.act_as('91000000-0000-4000-8000-000000000101', 'aal1');
select throws_ok(
  $$ insert into public.policy_document_versions (
       id, policy_document_id, organization_id, version_number, storage_path,
       file_name, file_type, content_hash
     ) values (
       '91000000-0000-4000-8000-000000000314',
       '91000000-0000-4000-8000-000000000304',
       '91000000-0000-4000-8000-000000000001', 1,
       'aal1.pdf', 'aal1.pdf', 'application/pdf', repeat('e', 64)
     ) $$,
  '42501', null,
  'an AAL1 manager cannot insert a policy version directly'
);

select throws_ok(
  $$ insert into public.policy_attestation_campaigns (
       id, organization_id, policy_document_id, policy_document_version_id, name
     ) values (
       '91000000-0000-4000-8000-000000000403',
       '91000000-0000-4000-8000-000000000001',
       '91000000-0000-4000-8000-000000000301',
       '91000000-0000-4000-8000-000000000311', 'AAL1 campaign'
     ) $$,
  '42501', null,
  'an AAL1 manager cannot create an attestation campaign directly'
);

select pg_temp.act_as('91000000-0000-4000-8000-000000000101', 'aal2');
select throws_ok(
  $$ insert into public.policy_attestations (
       id, organization_id, facility_id, employee_id, campaign_id,
       policy_document_version_id, status, attested_at,
       document_version_hash, auth_method, ip_address, user_agent
     ) values (
       '91000000-0000-4000-8000-000000000501',
       '91000000-0000-4000-8000-000000000001',
       '91000000-0000-4000-8000-000000000011',
       '91000000-0000-4000-8000-000000000201',
       '91000000-0000-4000-8000-000000000401',
       '91000000-0000-4000-8000-000000000311', 'attested', now(),
       repeat('f', 64), 'forged', '203.0.113.8', 'forged-agent'
     ) $$,
  '23514', null,
  'a manager cannot insert a completed attestation with forged evidence'
);
reset role;

select throws_ok(
  $$ insert into public.policy_attestations (
       id, organization_id, facility_id, employee_id, campaign_id,
       policy_document_version_id
     ) values (
       '91000000-0000-4000-8000-000000000502',
       '91000000-0000-4000-8000-000000000002',
       '91000000-0000-4000-8000-000000000012',
       '91000000-0000-4000-8000-000000000202',
       '91000000-0000-4000-8000-000000000401',
       '91000000-0000-4000-8000-000000000313'
     ) $$,
  '23514', null,
  'an employee cannot be assigned to a campaign from another organization'
);

select pg_temp.act_as('91000000-0000-4000-8000-000000000101', 'aal2');
select lives_ok(
  $$ insert into public.policy_attestations (
       id, organization_id, facility_id, employee_id, campaign_id,
       policy_document_version_id, due_date
     ) values (
       '91000000-0000-4000-8000-000000000503',
       '91000000-0000-4000-8000-000000000002',
       '91000000-0000-4000-8000-000000000012',
       '91000000-0000-4000-8000-000000000201',
       '91000000-0000-4000-8000-000000000401',
       '91000000-0000-4000-8000-000000000312', date '1999-01-01'
     ) $$,
  'an AAL2 manager can create a pending assignment'
);
reset role;

select is(
  (select organization_id from public.policy_attestations
   where id = '91000000-0000-4000-8000-000000000503'),
  '91000000-0000-4000-8000-000000000001'::uuid,
  'the assignment organization is derived from the employee'
);
select is(
  (select facility_id from public.policy_attestations
   where id = '91000000-0000-4000-8000-000000000503'),
  '91000000-0000-4000-8000-000000000011'::uuid,
  'the assignment facility is derived from the employee'
);
select is(
  (select policy_document_version_id from public.policy_attestations
   where id = '91000000-0000-4000-8000-000000000503'),
  '91000000-0000-4000-8000-000000000311'::uuid,
  'the assignment version is derived from the campaign'
);
select is(
  (select due_date from public.policy_attestations
   where id = '91000000-0000-4000-8000-000000000503'),
  date '2026-08-15',
  'the assignment due date is derived from the campaign'
);
select results_eq(
  $$ select status, attested_at, document_version_hash, auth_method,
            ip_address, user_agent, reminder_sent_at
     from public.policy_attestations
     where id = '91000000-0000-4000-8000-000000000503' $$,
  $$ values ('pending'::text, null::timestamptz, null::text, null::text,
             null::text, null::text, null::timestamptz) $$,
  'new assignments contain no caller-authored completion evidence'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_policies
    where (schemaname, tablename, policyname) in (
      ('public', 'policy_documents', 'policy_documents_write'),
      ('public', 'policy_document_versions', 'policy_document_versions_write'),
      ('public', 'policy_document_versions', 'policy_document_versions_update'),
      ('public', 'policy_attestation_campaigns', 'policy_attestation_campaigns_write'),
      ('public', 'policy_attestation_campaigns', 'policy_attestation_campaigns_delete'),
      ('public', 'policy_attestations', 'policy_attestations_insert'),
      ('storage', 'objects', 'policy-documents write'),
      ('storage', 'objects', 'policy-documents delete')
    )
      and coalesce(with_check, qual) like '%identity_assurance_is_current%policy_document_admin%'
  ),
  8,
  'all policy-authoring Data API and Storage mutations enforce current assurance'
);

select * from finish();
rollback;
