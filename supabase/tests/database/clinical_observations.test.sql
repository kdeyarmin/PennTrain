begin;
select plan(19);

-- Structure + hardened grants -----------------------------------------------------------
select has_table('public', 'clinical_observations', 'native clinical observations table exists');
select has_table('public', 'clinical_observation_amendments', 'append-only observation amendments exist');
select ok(
  not has_table_privilege('authenticated', 'public.clinical_observations', 'UPDATE'),
  'browser roles cannot rewrite observations directly (writes go through RPCs)'
);
select ok(
  not has_table_privilege('anon', 'public.clinical_observations', 'SELECT'),
  'anonymous callers cannot read clinical observations'
);

-- Fixtures ------------------------------------------------------------------------------
insert into public.organizations(id, name, slug, subscription_status) values
  ('a1000000-0000-4000-8000-000000000001', 'Clinical Org A', 'clinical-org-a', 'active'),
  ('a1000000-0000-4000-8000-000000000002', 'Clinical Org B', 'clinical-org-b', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('a1000000-0000-4000-8000-000000000011', 'a1000000-0000-4000-8000-000000000001', 'Facility A1', 'PCH'),
  ('a1000000-0000-4000-8000-000000000012', 'a1000000-0000-4000-8000-000000000001', 'Facility A2', 'PCH'),
  ('a1000000-0000-4000-8000-000000000021', 'a1000000-0000-4000-8000-000000000002', 'Facility B1', 'PCH');

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-4000-8000-000000000101', 'authenticated', 'authenticated', 'a-admin@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-4000-8000-000000000102', 'authenticated', 'authenticated', 'a1-emp@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-4000-8000-000000000103', 'authenticated', 'authenticated', 'a2-emp@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-4000-8000-000000000104', 'authenticated', 'authenticated', 'a-auditor@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-4000-8000-000000000105', 'authenticated', 'authenticated', 'a-trainer@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-4000-8000-000000000201', 'authenticated', 'authenticated', 'b-admin@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false);

select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('a1000000-0000-4000-8000-000000000101', 'a1000000-0000-4000-8000-000000000001', 'a-admin@test.local', 'Ada', 'Admin', 'org_admin', true),
  ('a1000000-0000-4000-8000-000000000102', 'a1000000-0000-4000-8000-000000000001', 'a1-emp@test.local', 'Ann', 'Aide', 'employee', true),
  ('a1000000-0000-4000-8000-000000000103', 'a1000000-0000-4000-8000-000000000001', 'a2-emp@test.local', 'Al', 'Aide', 'employee', true),
  ('a1000000-0000-4000-8000-000000000104', 'a1000000-0000-4000-8000-000000000001', 'a-auditor@test.local', 'Ivy', 'Auditor', 'auditor', true),
  ('a1000000-0000-4000-8000-000000000105', 'a1000000-0000-4000-8000-000000000001', 'a-trainer@test.local', 'Tom', 'Trainer', 'trainer', true),
  ('a1000000-0000-4000-8000-000000000201', 'a1000000-0000-4000-8000-000000000002', 'b-admin@test.local', 'Bob', 'Admin', 'org_admin', true)
on conflict(id) do update set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);

insert into public.employees(
  id, organization_id, facility_id, profile_id, first_name, last_name, email, job_title, hire_date, status
) values
  ('a1000000-0000-4000-8000-000000000112', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000011', 'a1000000-0000-4000-8000-000000000102', 'Ann', 'Aide', 'a1-emp@test.local', 'Direct Care Staff', current_date, 'active'),
  ('a1000000-0000-4000-8000-000000000113', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000012', 'a1000000-0000-4000-8000-000000000103', 'Al', 'Aide', 'a2-emp@test.local', 'Direct Care Staff', current_date, 'active');

insert into public.residents(id, organization_id, facility_id, first_name, last_name, admission_date, status)
values ('a1000000-0000-4000-8000-000000000301', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000011', 'Rosa', 'Resident', current_date - 30, 'active');

create or replace function pg_temp.act_as(p_id uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_id, 'role', p_role, 'aal', 'aal1',
      'iat', extract(epoch from now())::bigint)::text, true);
  if p_role = 'service_role' then set local role service_role; else set local role authenticated; end if;
end $$;
create temporary table obs_ids(key text primary key, id uuid) on commit drop;
grant all on obs_ids to authenticated, service_role;

-- Employee charting at their assigned facility -----------------------------------------
select pg_temp.act_as('a1000000-0000-4000-8000-000000000102');
select lives_ok(
  $$insert into obs_ids(key, id) values ('bp', public.record_clinical_observation(
    'a1000000-0000-4000-8000-000000000301', 'blood_pressure', now(), 190, 125, null, 'mm[Hg]'))$$,
  'assigned employee can chart a blood-pressure observation'
);
select is(
  (select abnormal_flag from public.clinical_observations where id = (select id from obs_ids where key = 'bp')),
  'critical_high',
  'severe blood pressure is flagged critical_high server-side'
);
select lives_ok(
  $$insert into obs_ids(key, id) values ('hr', public.record_clinical_observation(
    'a1000000-0000-4000-8000-000000000301', 'heart_rate', now(), 115, null, null, '/min'))$$,
  'assigned employee can chart a heart-rate observation'
);
select is(
  (select abnormal_flag from public.clinical_observations where id = (select id from obs_ids where key = 'hr')),
  'high',
  'elevated heart rate is flagged high server-side'
);

-- Access matrix -------------------------------------------------------------------------
select pg_temp.act_as('a1000000-0000-4000-8000-000000000103');
select throws_ok(
  $$select public.record_clinical_observation(
    'a1000000-0000-4000-8000-000000000301', 'temperature', now(), 37, null, null, 'Cel')$$,
  '42501', null,
  'an employee assigned to a different facility cannot chart this resident'
);

select pg_temp.act_as('a1000000-0000-4000-8000-000000000104');
select throws_ok(
  $$select public.record_clinical_observation(
    'a1000000-0000-4000-8000-000000000301', 'temperature', now(), 37, null, null, 'Cel')$$,
  '42501', null,
  'an auditor cannot chart clinical data'
);
select lives_ok(
  $$select count(*) from public.get_resident_clinical_observations('a1000000-0000-4000-8000-000000000301')$$,
  'an auditor can read the resident clinical record'
);

select pg_temp.act_as('a1000000-0000-4000-8000-000000000105');
select throws_ok(
  $$select public.get_resident_clinical_observations('a1000000-0000-4000-8000-000000000301')$$,
  '42501', null,
  'a trainer cannot read clinical data'
);

select pg_temp.act_as('a1000000-0000-4000-8000-000000000201');
select throws_ok(
  $$select public.get_resident_clinical_observations('a1000000-0000-4000-8000-000000000301')$$,
  '42501', null,
  'an admin from another organization cannot read this resident'
);

-- Correction / retraction (FHIR entered-in-error) --------------------------------------
select pg_temp.act_as('a1000000-0000-4000-8000-000000000102');
select is(
  (select count(*)::integer from public.get_resident_clinical_observations('a1000000-0000-4000-8000-000000000301')),
  2,
  'both active observations are visible to the assigned employee'
);
select lives_ok(
  $$select public.amend_clinical_observation(
    (select id from obs_ids where key = 'bp'), 'entered_in_error',
    'Recorded on the wrong resident.')$$,
  'assigned employee can retract an observation as entered-in-error'
);
select is(
  (select count(*)::integer from public.get_resident_clinical_observations('a1000000-0000-4000-8000-000000000301')),
  1,
  'a retracted observation is excluded from the default read'
);
select is(
  (select count(*)::integer from public.clinical_observation_amendments
   where observation_id = (select id from obs_ids where key = 'bp')),
  1,
  'the retraction is preserved as an append-only amendment'
);

-- Append-only + access-log evidence -----------------------------------------------------
reset role;
select throws_ok(
  $$delete from public.clinical_observation_amendments
    where observation_id = (select id from obs_ids where key = 'bp')$$,
  '55000', null,
  'clinical amendment evidence cannot be deleted'
);
select ok(
  (select count(*) from app_private.clinical_access_log
   where resident_id = 'a1000000-0000-4000-8000-000000000301') > 0,
  'clinical reads are written to the HIPAA access log'
);

select * from finish();
rollback;
