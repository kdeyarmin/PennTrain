begin;
select plan(10);

-- A plan_of_correction_versions row is a snapshot of the whole violation plus its
-- corrective actions, so it must not be readable more widely than dhs_violations
-- itself: org_admin and auditor org-wide, facility_manager only where assigned,
-- and no trainer at all -- 20260705173134's model, which 20260810100000 makes the
-- versions table and its list RPC follow. Before that fix, any FM in the org (and
-- any facility-assigned role, trainers included) could read the snapshot.

insert into public.organizations (id, name, slug) values
  ('9b000000-0000-4000-8000-000000000001', 'POC Read Scope Org', 'poc-read-scope-org');

insert into public.facilities (id, organization_id, name, facility_type) values
  ('9b000000-0000-4000-8000-000000000011', '9b000000-0000-4000-8000-000000000001', 'POC Scope Facility A', 'PCH'),
  ('9b000000-0000-4000-8000-000000000012', '9b000000-0000-4000-8000-000000000001', 'POC Scope Facility B', 'PCH');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
)
select
  '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated',
  v.email, 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false
from (values
  ('9b000000-0000-4000-8000-000000000101'::uuid, 'poc-scope-admin@test.local'),
  ('9b000000-0000-4000-8000-000000000102'::uuid, 'poc-scope-auditor@test.local'),
  ('9b000000-0000-4000-8000-000000000103'::uuid, 'poc-scope-fm-a@test.local'),
  ('9b000000-0000-4000-8000-000000000104'::uuid, 'poc-scope-fm-b@test.local'),
  ('9b000000-0000-4000-8000-000000000105'::uuid, 'poc-scope-trainer-b@test.local')
) as v(id, email);

select set_config('app.privileged_write', 'on', true);
insert into public.profiles (id, organization_id, email, first_name, last_name, role, is_active) values
  ('9b000000-0000-4000-8000-000000000101', '9b000000-0000-4000-8000-000000000001', 'poc-scope-admin@test.local', 'Scope', 'Admin', 'org_admin', true),
  ('9b000000-0000-4000-8000-000000000102', '9b000000-0000-4000-8000-000000000001', 'poc-scope-auditor@test.local', 'Scope', 'Auditor', 'auditor', true),
  ('9b000000-0000-4000-8000-000000000103', '9b000000-0000-4000-8000-000000000001', 'poc-scope-fm-a@test.local', 'Scope', 'Manager A', 'facility_manager', true),
  ('9b000000-0000-4000-8000-000000000104', '9b000000-0000-4000-8000-000000000001', 'poc-scope-fm-b@test.local', 'Scope', 'Manager B', 'facility_manager', true),
  ('9b000000-0000-4000-8000-000000000105', '9b000000-0000-4000-8000-000000000001', 'poc-scope-trainer-b@test.local', 'Scope', 'Trainer B', 'trainer', true)
on conflict (id) do update set
  organization_id = excluded.organization_id,
  role = excluded.role,
  is_active = excluded.is_active;
select set_config('app.privileged_write', 'off', true);

-- Manager A covers facility A only; Manager B and the trainer cover facility B,
-- where the violation lives.
insert into public.facility_assignments (profile_id, facility_id) values
  ('9b000000-0000-4000-8000-000000000103', '9b000000-0000-4000-8000-000000000011'),
  ('9b000000-0000-4000-8000-000000000104', '9b000000-0000-4000-8000-000000000012'),
  ('9b000000-0000-4000-8000-000000000105', '9b000000-0000-4000-8000-000000000012');

insert into public.dhs_violations (
  id, organization_id, facility_id, citation_ref, inspection_date, description, status
) values (
  '9b000000-0000-4000-8000-000000000201', '9b000000-0000-4000-8000-000000000001',
  '9b000000-0000-4000-8000-000000000012', '2600.25(a)', public.pa_today() - 10,
  'Citation detail that must stay inside the assigned facility', 'poc_submitted'
);

insert into public.plan_of_correction_versions (
  id, organization_id, facility_id, violation_id, version_number, snapshot
) values (
  '9b000000-0000-4000-8000-000000000301', '9b000000-0000-4000-8000-000000000001',
  '9b000000-0000-4000-8000-000000000012', '9b000000-0000-4000-8000-000000000201', 1,
  '{"violation": {"description": "Citation detail that must stay inside the assigned facility"}}'::jsonb
);

create or replace function pg_temp.act_as(p_profile_id uuid)
returns void
language plpgsql
as $$
begin
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', p_profile_id,
      'role', 'authenticated',
      'aal', 'aal2',
      'iat', extract(epoch from now())::bigint
    )::text,
    true
  );
  set local role authenticated;
end
$$;

-- The assigned facility manager keeps both read paths.
select pg_temp.act_as('9b000000-0000-4000-8000-000000000104');
select is(
  (select count(*)::int from public.plan_of_correction_versions
   where violation_id = '9b000000-0000-4000-8000-000000000201'),
  1,
  'a facility manager assigned to the facility reads the POC version'
);
select is(
  (select count(*)::int from public.list_plan_of_correction_versions('9b000000-0000-4000-8000-000000000201')),
  1,
  'and the list RPC returns it to them'
);

-- A facility manager assigned elsewhere gets neither -- exactly what
-- dhs_violations_select already denies them on the parent row.
select pg_temp.act_as('9b000000-0000-4000-8000-000000000103');
select is(
  (select count(*)::int from public.plan_of_correction_versions
   where violation_id = '9b000000-0000-4000-8000-000000000201'),
  0,
  'a facility manager assigned to a different facility reads no snapshot rows'
);
select throws_ok(
  $$ select * from public.list_plan_of_correction_versions('9b000000-0000-4000-8000-000000000201') $$,
  '42501', null,
  'and the list RPC refuses them'
);

-- A trainer assigned to the violation's own facility is still out: the parent
-- policy admits no trainer, so neither may the snapshot of it.
select pg_temp.act_as('9b000000-0000-4000-8000-000000000105');
select is(
  (select count(*)::int from public.plan_of_correction_versions
   where violation_id = '9b000000-0000-4000-8000-000000000201'),
  0,
  'a trainer assigned to the facility reads no snapshot rows'
);
select throws_ok(
  $$ select * from public.list_plan_of_correction_versions('9b000000-0000-4000-8000-000000000201') $$,
  '42501', null,
  'and the list RPC refuses the trainer too'
);

-- Org-wide roles keep their org-wide read, matching the parent policy.
select pg_temp.act_as('9b000000-0000-4000-8000-000000000101');
select is(
  (select count(*)::int from public.plan_of_correction_versions
   where violation_id = '9b000000-0000-4000-8000-000000000201'),
  1,
  'the org admin reads the POC version without a facility assignment'
);
select is(
  (select count(*)::int from public.list_plan_of_correction_versions('9b000000-0000-4000-8000-000000000201')),
  1,
  'and the list RPC returns it to the org admin'
);

select pg_temp.act_as('9b000000-0000-4000-8000-000000000102');
select is(
  (select count(*)::int from public.plan_of_correction_versions
   where violation_id = '9b000000-0000-4000-8000-000000000201'),
  1,
  'the auditor reads the POC version without a facility assignment'
);
select is(
  (select count(*)::int from public.list_plan_of_correction_versions('9b000000-0000-4000-8000-000000000201')),
  1,
  'and the list RPC returns it to the auditor'
);

select * from finish();
rollback;
