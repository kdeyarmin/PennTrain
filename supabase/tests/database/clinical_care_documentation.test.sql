begin;
select plan(28);

select has_table('public', 'clinical_care_plans', 'native care plans exist');
select has_table('public', 'clinical_assessments', 'native clinical assessments exist');
select has_table('public', 'clinical_progress_notes', 'native progress notes exist');
select has_table('public', 'clinical_progress_note_versions', 'append-only note versions exist');
select ok(not has_table_privilege('authenticated', 'public.clinical_progress_notes', 'UPDATE'),
  'browser roles cannot rewrite notes directly');
select ok(not has_table_privilege('anon', 'public.clinical_progress_notes', 'SELECT'),
  'anonymous callers cannot read notes');

insert into public.organizations(id, name, slug, subscription_status) values
  ('c1000000-0000-4000-8000-000000000001', 'Care Org A', 'care-org-a', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('c1000000-0000-4000-8000-000000000011', 'c1000000-0000-4000-8000-000000000001', 'Care Facility A1', 'PCH'),
  ('c1000000-0000-4000-8000-000000000012', 'c1000000-0000-4000-8000-000000000001', 'Care Facility A2', 'PCH');
insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', 'c1000000-0000-4000-8000-000000000101', 'authenticated', 'authenticated', 'c-admin@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', 'c1000000-0000-4000-8000-000000000102', 'authenticated', 'authenticated', 'c-emp1@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', 'c1000000-0000-4000-8000-000000000103', 'authenticated', 'authenticated', 'c-emp2@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', 'c1000000-0000-4000-8000-000000000104', 'authenticated', 'authenticated', 'c-auditor@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('c1000000-0000-4000-8000-000000000101', 'c1000000-0000-4000-8000-000000000001', 'c-admin@test.local', 'Cara', 'Admin', 'org_admin', true),
  ('c1000000-0000-4000-8000-000000000102', 'c1000000-0000-4000-8000-000000000001', 'c-emp1@test.local', 'Cody', 'Aide', 'employee', true),
  ('c1000000-0000-4000-8000-000000000103', 'c1000000-0000-4000-8000-000000000001', 'c-emp2@test.local', 'Cleo', 'Aide', 'employee', true),
  ('c1000000-0000-4000-8000-000000000104', 'c1000000-0000-4000-8000-000000000001', 'c-auditor@test.local', 'Cyd', 'Auditor', 'auditor', true)
on conflict(id) do update set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);
insert into public.employees(id, organization_id, facility_id, profile_id, first_name, last_name, email, job_title, hire_date, status) values
  ('c1000000-0000-4000-8000-000000000112', 'c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000011', 'c1000000-0000-4000-8000-000000000102', 'Cody', 'Aide', 'c-emp1@test.local', 'Direct Care Staff', current_date, 'active'),
  ('c1000000-0000-4000-8000-000000000113', 'c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000012', 'c1000000-0000-4000-8000-000000000103', 'Cleo', 'Aide', 'c-emp2@test.local', 'Direct Care Staff', current_date, 'active');
insert into public.residents(id, organization_id, facility_id, first_name, last_name, admission_date, status) values
  ('c1000000-0000-4000-8000-000000000301', 'c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000011', 'Cameron', 'Resident', current_date - 30, 'active'),
  ('c1000000-0000-4000-8000-000000000302', 'c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000012', 'Dana', 'Resident', current_date - 25, 'active');

create or replace function pg_temp.act_as(p_id uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_id, 'role', p_role, 'aal', 'aal1',
    'iat', extract(epoch from now())::bigint)::text, true);
  if p_role = 'service_role' then set local role service_role; else set local role authenticated; end if;
end $$;
create temporary table care_ids(key text primary key, id uuid) on commit drop;
grant all on care_ids to authenticated, service_role;

-- Employee documents a care plan, goal, and assessment ---------------------------------
select pg_temp.act_as('c1000000-0000-4000-8000-000000000102');
select lives_ok($$insert into care_ids(key, id) values ('plan', public.save_clinical_care_plan(
  'c1000000-0000-4000-8000-000000000301', 'Falls prevention', 'safety', 'active'))$$,
  'assigned employee can author a care plan');
select lives_ok($$select public.save_care_plan_goal(
  (select id from care_ids where key = 'plan'), 'Remain free of falls', 'No falls in 90 days', 'active')$$,
  'employee can add a measurable goal');
select lives_ok($$insert into care_ids(key, id) values ('assess', public.record_clinical_assessment(
  'c1000000-0000-4000-8000-000000000301', 'braden', now(), 18, 'mild'))$$,
  'employee can record a scored assessment');
select lives_ok($$select public.finalize_clinical_assessment((select id from care_ids where key = 'assess'))$$,
  'a draft assessment can be finalized');
select is((select status from public.clinical_assessments where id = (select id from care_ids where key = 'assess')),
  'final', 'finalized assessment is locked as final');
select throws_ok($$select public.finalize_clinical_assessment((select id from care_ids where key = 'assess'))$$,
  '55000', null, 'a finalized assessment cannot be finalized again');

-- Progress note sign-and-lock lifecycle ------------------------------------------------
select lives_ok($$insert into care_ids(key, id) values ('note', public.save_clinical_progress_note(
  'c1000000-0000-4000-8000-000000000301', 'nursing', 'Resident resting comfortably.', now()))$$,
  'employee can draft a progress note');
select lives_ok($$select public.sign_clinical_progress_note((select id from care_ids where key = 'note'))$$,
  'employee can sign their draft note');
select is((select status from public.clinical_progress_notes where id = (select id from care_ids where key = 'note')),
  'signed', 'signed note is locked');
select throws_ok($$select public.save_clinical_progress_note(
  'c1000000-0000-4000-8000-000000000301', 'nursing', 'Edited body', now(),
  null, null, (select id from care_ids where key = 'note'))$$,
  '55000', null, 'a signed note cannot be edited through save -- only amended');
select lives_ok($$select public.amend_clinical_progress_note(
  (select id from care_ids where key = 'note'), 'Clarify observation', 'Resident resting comfortably; no distress noted.')$$,
  'a signed note can be amended');
select is((select status from public.clinical_progress_notes where id = (select id from care_ids where key = 'note')),
  'amended', 'amended note reflects the new status');
select is((select count(*)::integer from public.clinical_progress_note_versions
  where note_id = (select id from care_ids where key = 'note')), 2,
  'signature and amendment are both retained as append-only versions');

-- Access matrix ------------------------------------------------------------------------
select pg_temp.act_as('c1000000-0000-4000-8000-000000000103');
select throws_ok($$select public.save_clinical_progress_note(
  'c1000000-0000-4000-8000-000000000301', 'nursing', 'From another facility', now())$$,
  '42501', null, 'an employee at another facility cannot document this resident');
select pg_temp.act_as('c1000000-0000-4000-8000-000000000104');
select throws_ok($$select public.save_clinical_progress_note(
  'c1000000-0000-4000-8000-000000000301', 'nursing', 'Auditor note', now())$$,
  '42501', null, 'an auditor cannot author clinical notes');
select is((select count(*)::integer from public.clinical_progress_notes
  where resident_id = 'c1000000-0000-4000-8000-000000000301'), 1,
  'an auditor can read the resident notes');

-- Retraction requires a manager --------------------------------------------------------
select pg_temp.act_as('c1000000-0000-4000-8000-000000000102');
select throws_ok($$select public.retract_clinical_progress_note((select id from care_ids where key = 'note'), 'Wrong resident')$$,
  '42501', null, 'a frontline employee cannot retract a note');
select pg_temp.act_as('c1000000-0000-4000-8000-000000000101');
select lives_ok($$select public.retract_clinical_progress_note((select id from care_ids where key = 'note'), 'Documented on the wrong resident')$$,
  'a manager can retract a note as entered-in-error');

-- Append-only note evidence ------------------------------------------------------------
reset role;
select throws_ok($$delete from public.clinical_progress_note_versions
  where note_id = (select id from care_ids where key = 'note')$$,
  '55000', null, 'note version evidence cannot be deleted');

-- Cross-facility authorization: a facility-scoped caller cannot edit another facility's
-- plan/note by passing one of their own residents plus a foreign plan/note id.
select pg_temp.act_as('c1000000-0000-4000-8000-000000000103');
select lives_ok($$insert into care_ids(key, id) values ('plan_a2', public.save_clinical_care_plan(
  'c1000000-0000-4000-8000-000000000302', 'A2 plan', 'safety', 'active'))$$,
  'the A2 employee can author a care plan for their own resident');
select throws_ok($$select public.save_clinical_care_plan(
  'c1000000-0000-4000-8000-000000000302', 'Hijack', 'safety', 'active',
  null, null, null, (select id from care_ids where key = 'plan'))$$,
  '42501', null,
  'an A2 employee cannot update an A1 resident''s care plan via a cross-facility id');
select throws_ok($$select public.save_clinical_progress_note(
  'c1000000-0000-4000-8000-000000000302', 'nursing', 'Hijack body', now(),
  null, null, (select id from care_ids where key = 'note'))$$,
  '42501', null,
  'an A2 employee cannot edit an A1 resident''s note via a cross-facility id');

select * from finish();
rollback;
