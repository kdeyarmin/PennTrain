begin;
select plan(49);

select has_table('public', 'hris_import_runs', 'resumable HRIS runs exist');
select has_table('public', 'hris_import_exceptions', 'ambiguous import rows have an exception queue');
select has_table('public', 'employee_qualifications', 'effective qualifications exist');
select has_table('public', 'credential_renewal_submissions', 'human-reviewed OCR intake exists');
select has_table('public', 'training_session_registrations', 'capacity-controlled class registration exists');
select has_table('public', 'schedule_eligibility_decisions', 'eligibility decisions retain explanations');
select has_table('public', 'open_shift_opportunities', 'open-shift self-service exists');
select has_function('public', 'validate_hris_import_run', array['uuid'], 'HRIS validation is a governed command');
select has_function('public', 'approve_certification_attempt', array['uuid','text','text','text'], 'certification approval is server validated');
select ok(
  not has_function_privilege('anon',
    'public.stage_hris_import_row(uuid,integer,text,text,text,jsonb)', 'EXECUTE'),
  'anonymous callers cannot stage trusted HRIS rows'
);

insert into public.organizations(id, name, slug) values
  ('33000000-0000-4000-8000-000000000001', 'Phase 3 Org', 'phase3-org');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('33000000-0000-4000-8000-000000000011', '33000000-0000-4000-8000-000000000001', 'Phase 3 Facility', 'PCH');

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
)
select
  '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated',
  v.email, 'x', now(), '{}'::jsonb, '{}'::jsonb, now(), now(),
  '', '', '', '', '', '', false, false
from (values
  ('33000000-0000-4000-8000-000000000101'::uuid, 'p3-admin@test.local'),
  ('33000000-0000-4000-8000-000000000102'::uuid, 'p3-trainer@test.local'),
  ('33000000-0000-4000-8000-000000000103'::uuid, 'p3-worker-a@test.local'),
  ('33000000-0000-4000-8000-000000000104'::uuid, 'p3-worker-b@test.local')
) v(id, email);

select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('33000000-0000-4000-8000-000000000101', '33000000-0000-4000-8000-000000000001', 'p3-admin@test.local', 'Phase', 'Admin', 'org_admin', true),
  ('33000000-0000-4000-8000-000000000102', '33000000-0000-4000-8000-000000000001', 'p3-trainer@test.local', 'Phase', 'Trainer', 'trainer', true),
  ('33000000-0000-4000-8000-000000000103', '33000000-0000-4000-8000-000000000001', 'p3-worker-a@test.local', 'Worker', 'Alpha', 'employee', true),
  ('33000000-0000-4000-8000-000000000104', '33000000-0000-4000-8000-000000000001', 'p3-worker-b@test.local', 'Worker', 'Beta', 'employee', true)
on conflict (id) do update set organization_id=excluded.organization_id, email=excluded.email,
  first_name=excluded.first_name, last_name=excluded.last_name, role=excluded.role, is_active=true;
select set_config('app.privileged_write', 'off', true);

insert into public.facility_assignments(profile_id, facility_id) values
  ('33000000-0000-4000-8000-000000000102', '33000000-0000-4000-8000-000000000011');

insert into public.employees(
  id, organization_id, facility_id, profile_id, employee_number,
  first_name, last_name, email, hire_date, job_title, status, trainer_status
) values
  ('33000000-0000-4000-8000-000000000201', '33000000-0000-4000-8000-000000000001', '33000000-0000-4000-8000-000000000011', '33000000-0000-4000-8000-000000000103', 'P3-A', 'Worker', 'Alpha', 'p3-worker-a@test.local', current_date-100, 'Direct Care', 'active', false),
  ('33000000-0000-4000-8000-000000000202', '33000000-0000-4000-8000-000000000001', '33000000-0000-4000-8000-000000000011', '33000000-0000-4000-8000-000000000104', 'P3-B', 'Worker', 'Beta', 'p3-worker-b@test.local', current_date-80, 'Direct Care', 'active', false),
  ('33000000-0000-4000-8000-000000000203', '33000000-0000-4000-8000-000000000001', '33000000-0000-4000-8000-000000000011', '33000000-0000-4000-8000-000000000102', 'P3-T', 'Phase', 'Trainer', 'p3-trainer@test.local', current_date-200, 'Trainer', 'active', true);

create or replace function pg_temp.act_as(p_profile_id uuid, p_aal text default 'aal2', p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_profile_id, 'role', p_role, 'aal', p_aal,
    'iat', extract(epoch from now())::bigint
  )::text, true);
  if p_role = 'service_role' then set local role service_role;
  else set local role authenticated; end if;
end;
$$;

create temporary table p3_ids(key text primary key, id uuid) on commit drop;
grant all on table p3_ids to authenticated, service_role;

select pg_temp.act_as('33000000-0000-4000-8000-000000000101');
insert into public.hris_source_systems(
  id, organization_id, source_key, display_name, provider_type, status, created_by
) values (
  '33000000-0000-4000-8000-000000000301', '33000000-0000-4000-8000-000000000001',
  'test.hris', 'Phase 3 HRIS', 'api', 'active', '33000000-0000-4000-8000-000000000101'
);
insert into p3_ids values ('run', public.create_hris_import_run(
  '33000000-0000-4000-8000-000000000301', 'phase3-import-0001', 'delta', 'cursor-1', repeat('a',64), 2
));
select is(
  public.create_hris_import_run('33000000-0000-4000-8000-000000000301', 'phase3-import-0001', 'delta', 'cursor-1', repeat('a',64), 2),
  (select id from p3_ids where key='run'),
  'repeating an import request returns the canonical run'
);

select pg_temp.act_as('00000000-0000-0000-0000-000000000000', 'aal2', 'service_role');
insert into p3_ids values ('row-new', public.stage_hris_import_row(
  (select id from p3_ids where key='run'), 1, 'external-person-new', 'external-job-new', repeat('b',64),
  jsonb_build_object('facilityId','33000000-0000-4000-8000-000000000011','employeeNumber','P3-NEW','firstName','Imported','lastName','Worker','email','imported@test.local','jobTitle','Caregiver','hireDate',current_date::text,'status','active')
));
select is(
  public.stage_hris_import_row(
    (select id from p3_ids where key='run'), 1, 'external-person-new', 'external-job-new', repeat('b',64),
    jsonb_build_object('facilityId','33000000-0000-4000-8000-000000000011','employeeNumber','P3-NEW','firstName','Imported','lastName','Worker','email','imported@test.local','jobTitle','Caregiver','hireDate',current_date::text,'status','active')
  ),
  (select id from p3_ids where key='row-new'),
  'resuming an identical HRIS row is idempotent'
);
select throws_ok(
  $$ select public.stage_hris_import_row(
    (select id from p3_ids where key='run'), 1, 'external-person-new', 'external-job-new', repeat('c',64),
    '{"facilityId":"33000000-0000-4000-8000-000000000011"}'::jsonb
  ) $$,
  '23505', null, 'resuming a row with different content is rejected'
);
insert into p3_ids values ('row-candidate', public.stage_hris_import_row(
  (select id from p3_ids where key='run'), 2, 'external-person-a', 'external-job-a', repeat('d',64),
  jsonb_build_object('facilityId','33000000-0000-4000-8000-000000000011','employeeNumber','P3-A','firstName','Worker','lastName','Alpha','email','p3-worker-a@test.local','jobTitle','Direct Care','hireDate',(current_date-100)::text,'status','active')
));

select pg_temp.act_as('33000000-0000-4000-8000-000000000101');
select is(
  public.validate_hris_import_run((select id from p3_ids where key='run'))->>'status',
  'blocked', 'a duplicate candidate blocks automatic import application'
);
select results_eq(
  $$ select match_status, merge_decision from public.hris_import_rows where id=(select id from p3_ids where key='row-candidate') $$,
  $$ values ('candidate'::text, null::text) $$,
  'a deterministic candidate remains visible without an automatic merge'
);
select lives_ok(
  $$ select public.set_hris_import_row_decision(
    (select id from p3_ids where key='row-candidate'), 'link',
    '33000000-0000-4000-8000-000000000201', 'Reviewed matching employee number and email'
  ) $$,
  'an administrator records the explicit merge decision'
);
select results_eq(
  $$ select (x->>'applied')::integer, (x->>'failed')::integer from public.apply_hris_import_batch((select id from p3_ids where key='run'),100) x $$,
  $$ values (2,0) $$,
  'the reviewed import applies both rows through governed workforce projection'
);
select results_eq(
  $$ select (x->>'applied')::integer from public.apply_hris_import_batch((select id from p3_ids where key='run'),100) x $$,
  $$ values (0) $$,
  'replaying the applied import creates no duplicate employees'
);
select is((select count(*)::integer from public.employees where employee_number='P3-NEW'),1,
  'the imported employee is created exactly once');
select is((select count(*)::integer from public.hris_identity_links where source_system_id='33000000-0000-4000-8000-000000000301'),2,
  'external person and employment identifiers reconcile to retained links');
select is((select status from public.hris_import_runs where id=(select id from p3_ids where key='run')),'applied',
  'the import run reaches an applied reconciled state');

reset role;
insert into public.certification_definitions(
  id, organization_id, qualification_key, name, default_validity_days,
  renewal_window_days, created_by
) values (
  '33000000-0000-4000-8000-000000000401', '33000000-0000-4000-8000-000000000001',
  'direct-care', 'Direct Care Qualified', 365, 60, '33000000-0000-4000-8000-000000000101'
);
insert into public.certification_definition_versions(
  id, certification_definition_id, version_number, lifecycle_state, criteria,
  criteria_checksum_sha256, effective_from, authored_by, published_by, published_at
) values (
  '33000000-0000-4000-8000-000000000402', '33000000-0000-4000-8000-000000000401',
  1, 'published', '{"minimumScore":100}', repeat('1',64), now()-interval '1 day',
  '33000000-0000-4000-8000-000000000101', '33000000-0000-4000-8000-000000000101', now()-interval '1 day'
);
insert into public.certification_checklist_items(
  id, certification_version_id, item_key, prompt, evidence_required, signature_required
) values (
  '33000000-0000-4000-8000-000000000403', '33000000-0000-4000-8000-000000000402',
  'observe', 'Observe direct care competency', true, true
);
insert into public.assessor_qualifications(
  organization_id, certification_definition_id, assessor_profile_id,
  effective_from, evidence, approved_by
) values (
  '33000000-0000-4000-8000-000000000001', '33000000-0000-4000-8000-000000000401',
  '33000000-0000-4000-8000-000000000101', now()-interval '1 day', '{"license":"A-1"}',
  '33000000-0000-4000-8000-000000000101'
);
insert into public.certification_attempts(
  id, organization_id, facility_id, employee_id, certification_version_id,
  assessor_profile_id, status, created_by
) values (
  '33000000-0000-4000-8000-000000000404', '33000000-0000-4000-8000-000000000001',
  '33000000-0000-4000-8000-000000000011', '33000000-0000-4000-8000-000000000201',
  '33000000-0000-4000-8000-000000000402', '33000000-0000-4000-8000-000000000101',
  'submitted', '33000000-0000-4000-8000-000000000101'
);
insert into public.certification_attempt_items(
  certification_attempt_id, checklist_item_id, result, evidence,
  evidence_checksum_sha256, signed_at
) values (
  '33000000-0000-4000-8000-000000000404', '33000000-0000-4000-8000-000000000403',
  'met', '{"observation":"met"}', repeat('2',64), now()
);

select pg_temp.act_as('33000000-0000-4000-8000-000000000103');
select throws_ok(
  $$ select public.approve_certification_attempt(
    '33000000-0000-4000-8000-000000000404','passed','Employee cannot self approve',repeat('3',64)
  ) $$,
  '42501', null, 'an employee cannot approve another assessor assignment'
);
select pg_temp.act_as('33000000-0000-4000-8000-000000000101');
insert into p3_ids values ('qualification', public.approve_certification_attempt(
  '33000000-0000-4000-8000-000000000404','passed','Observed every published checklist criterion',repeat('3',64)
));
select ok((select id is not null from p3_ids where key='qualification'),
  'qualified assessor approval issues an effective qualification');
select ok(public.employee_has_active_qualification('33000000-0000-4000-8000-000000000201','direct-care',now()),
  'current qualification resolution consumes issued evidence');
select is(
  (select v.criteria_checksum_sha256 from public.employee_qualifications q
   join public.certification_definition_versions v on v.id=q.certification_version_id
   where q.id=(select id from p3_ids where key='qualification')),
  repeat('1',64), 'qualification history retains the exact checklist version checksum'
);
select lives_ok(
  $$ select public.set_employee_qualification_state((select id from p3_ids where key='qualification'),'suspended','Pending investigation review') $$,
  'qualification suspension is a governed lifecycle transition'
);
select ok(not public.employee_has_active_qualification('33000000-0000-4000-8000-000000000201','direct-care',now()),
  'a suspended qualification cannot satisfy operations');
select lives_ok(
  $$ select public.set_employee_qualification_state((select id from p3_ids where key='qualification'),'active','Investigation cleared qualification') $$,
  'qualification restoration retains lifecycle evidence'
);
select ok(public.employee_has_active_qualification('33000000-0000-4000-8000-000000000201','direct-care',now()),
  'a governed restoration becomes effective');

reset role;
insert into public.employee_credentials(
  id, organization_id, facility_id, employee_id, credential_type, status
) values (
  '33000000-0000-4000-8000-000000000501', '33000000-0000-4000-8000-000000000001',
  '33000000-0000-4000-8000-000000000011', '33000000-0000-4000-8000-000000000201',
  'other', 'missing'
);
insert into public.employee_credential_documents(
  id, organization_id, facility_id, employee_id, credential_id,
  storage_path, file_name, file_type, file_size, uploaded_by_profile_id
) values (
  '33000000-0000-4000-8000-000000000502', '33000000-0000-4000-8000-000000000001',
  '33000000-0000-4000-8000-000000000011', '33000000-0000-4000-8000-000000000201',
  '33000000-0000-4000-8000-000000000501', 'p3/test.pdf', 'renewal.pdf', 'application/pdf', 100,
  '33000000-0000-4000-8000-000000000103'
);
select pg_temp.act_as('33000000-0000-4000-8000-000000000103');
insert into p3_ids values ('renewal', public.create_credential_renewal_submission(
  '33000000-0000-4000-8000-000000000201','33000000-0000-4000-8000-000000000501',
  '33000000-0000-4000-8000-000000000502','other'
));
select ok((select id is not null from p3_ids where key='renewal'), 'employees can submit a supported renewal document');
select pg_temp.act_as('00000000-0000-0000-0000-000000000000','aal2','service_role');
select lives_ok(
  $$ select public.record_credential_renewal_extraction(
    (select id from p3_ids where key='renewal'),'clean','test-scanner','{"clean":true}',
    'test-ocr','v1','{"issuingAuthority":"Suggested Board","expirationDate":"2030-12-31"}',
    '{"issuingAuthority":0.98,"expirationDate":0.95}'
  ) $$,
  'trusted processors can record isolated scan and OCR suggestions'
);
reset role;
select is((select status from public.employee_credentials where id='33000000-0000-4000-8000-000000000501'),'missing',
  'OCR suggestions cannot approve or enforce a credential');
select pg_temp.act_as('33000000-0000-4000-8000-000000000101');
select is(
  public.review_credential_renewal_submission(
    (select id from p3_ids where key='renewal'),'approve',
    '{"issuingAuthority":"Human Confirmed Board","credentialNumber":"HC-100","issueDate":"2026-01-01","expirationDate":"2030-12-31"}',
    'Verified document against issuing authority'
  ),
  '33000000-0000-4000-8000-000000000501',
  'independent human review applies the confirmed credential fields'
);
select results_eq(
  $$ select status, human_confirmed_fields->>'issuingAuthority' from public.credential_renewal_submissions where id=(select id from p3_ids where key='renewal') $$,
  $$ values ('approved'::text,'Human Confirmed Board'::text) $$,
  'approved fields remain attributable to the human reviewer'
);
select ok(
  not has_function_privilege('service_role','public.review_credential_renewal_submission(uuid,text,jsonb,text)','EXECUTE'),
  'the OCR service cannot execute human approval'
);

reset role;
insert into public.training_types(
  id, organization_id, code, name, category, renewal_interval_days, required_hours
) values (
  '33000000-0000-4000-8000-000000000601','33000000-0000-4000-8000-000000000001',
  'P3-TRAIN','Phase 3 Training','orientation',365,2
);
insert into public.certification_definitions(
  id, organization_id, qualification_key, name, created_by
) values (
  '33000000-0000-4000-8000-000000000602','33000000-0000-4000-8000-000000000001',
  'trainer.p3-train','Qualified Phase 3 Trainer','33000000-0000-4000-8000-000000000101'
);
insert into public.certification_definition_versions(
  id, certification_definition_id, version_number, lifecycle_state, criteria,
  criteria_checksum_sha256, effective_from, authored_by, published_by, published_at
) values (
  '33000000-0000-4000-8000-000000000603','33000000-0000-4000-8000-000000000602',1,
  'published','{}',repeat('4',64),now()-interval '1 day','33000000-0000-4000-8000-000000000101',
  '33000000-0000-4000-8000-000000000101',now()-interval '1 day'
);
insert into public.training_classes(
  id, organization_id, facility_id, trainer_profile_id, training_type_id,
  class_name, class_date, starts_at, ends_at, duration_hours, status, capacity
) values (
  '33000000-0000-4000-8000-000000000604','33000000-0000-4000-8000-000000000001',
  '33000000-0000-4000-8000-000000000011','33000000-0000-4000-8000-000000000102',
  '33000000-0000-4000-8000-000000000601','Phase 3 Class',current_date+1,
  now()+interval '1 day',now()+interval '1 day 2 hours',2,'scheduled',1
);
select pg_temp.act_as('33000000-0000-4000-8000-000000000101');
select throws_ok(
  $$ select * from public.register_for_training_session('33000000-0000-4000-8000-000000000604','33000000-0000-4000-8000-000000000201') $$,
  '42501', null, 'an unqualified trainer cannot accept registrations'
);
reset role;
insert into public.employee_qualifications(
  id, organization_id, facility_id, employee_id, certification_definition_id,
  certification_version_id, state, issued_at, effective_from, approved_by
) values (
  '33000000-0000-4000-8000-000000000605','33000000-0000-4000-8000-000000000001',
  '33000000-0000-4000-8000-000000000011','33000000-0000-4000-8000-000000000203',
  '33000000-0000-4000-8000-000000000602','33000000-0000-4000-8000-000000000603',
  'active',now(),now()-interval '1 day','33000000-0000-4000-8000-000000000101'
);
select pg_temp.act_as('33000000-0000-4000-8000-000000000101');
create temporary table p3_registration_a on commit drop as
select * from public.register_for_training_session('33000000-0000-4000-8000-000000000604','33000000-0000-4000-8000-000000000201');
create temporary table p3_registration_b on commit drop as
select * from public.register_for_training_session('33000000-0000-4000-8000-000000000604','33000000-0000-4000-8000-000000000202');
select is((select registration_status from p3_registration_a),'registered','the first registration takes the locked capacity');
select is((select registration_status from p3_registration_b),'waitlisted','a concurrent-capacity loser enters a deterministic waitlist');

select is(
  public.evaluate_schedule_eligibility(
    '33000000-0000-4000-8000-000000000201','33000000-0000-4000-8000-000000000011',
    now()+interval '3 days',now()+interval '3 days 8 hours',array['direct-care'],array['other'],
    array['33000000-0000-4000-8000-000000000601'::uuid],array[]::uuid[]
  )->>'outcome',
  'blocked','missing approved training blocks schedule eligibility'
);
select ok(
  (public.evaluate_schedule_eligibility(
    '33000000-0000-4000-8000-000000000201','33000000-0000-4000-8000-000000000011',
    now()+interval '3 days',now()+interval '3 days 8 hours',array['direct-care'],array['other'],
    array['33000000-0000-4000-8000-000000000601'::uuid],array[]::uuid[]
  )->'hardBlocks') ? 'training:33000000-0000-4000-8000-000000000601',
  'eligibility explains the exact missing training source'
);

insert into p3_ids values ('attendance', public.record_training_attendance(
  (select registration_id from p3_registration_a),'attended',now(),now()+interval '2 hours',
  '{"method":"signed-roster"}',repeat('5',64),repeat('6',64)
));
select ok((select id is not null from p3_ids where key='attendance'),'signed attendance evidence is retained');
insert into p3_ids values ('completion', public.approve_training_session_completion(
  '33000000-0000-4000-8000-000000000604','Trainer and roster evidence reviewed'
));
select ok((select id is not null from p3_ids where key='completion'),'approved completion produces an idempotent receipt');
select is((select count(*)::integer from public.employee_training_records where employee_id='33000000-0000-4000-8000-000000000201' and training_type_id='33000000-0000-4000-8000-000000000601'),1,
  'attendance reconciles to one approved training record');
select is(
  public.approve_training_session_completion('33000000-0000-4000-8000-000000000604','Idempotent completion replay'),
  (select id from p3_ids where key='completion'),'replayed completion cannot double-credit attendance'
);
select ok(
  public.evaluate_schedule_eligibility(
    '33000000-0000-4000-8000-000000000201','33000000-0000-4000-8000-000000000011',
    now()+interval '3 days',now()+interval '3 days 8 hours',array['direct-care'],array['other'],
    array['33000000-0000-4000-8000-000000000601'::uuid],array[]::uuid[]
  )->>'outcome' in ('eligible','warning'),
  'human-approved qualification, credential, and training satisfy scheduling'
);

reset role;
insert into public.shift_definitions(id,organization_id,facility_id,name,start_time,end_time) values
  ('33000000-0000-4000-8000-000000000701','33000000-0000-4000-8000-000000000001','33000000-0000-4000-8000-000000000011','P3 Day','08:00','16:00');
insert into public.schedules(id,organization_id,facility_id,title,period_start,period_end,status,created_by) values
  ('33000000-0000-4000-8000-000000000702','33000000-0000-4000-8000-000000000001','33000000-0000-4000-8000-000000000011','P3 Open Shifts',current_date+3,current_date+9,'published','33000000-0000-4000-8000-000000000101');
insert into public.open_shift_opportunities(
  id, organization_id, schedule_id, facility_id, shift_definition_id,
  shift_date, start_time, end_time, slots, required_qualification_keys,
  required_credential_types, required_training_type_ids, status, claim_deadline, created_by
) values (
  '33000000-0000-4000-8000-000000000703','33000000-0000-4000-8000-000000000001',
  '33000000-0000-4000-8000-000000000702','33000000-0000-4000-8000-000000000011',
  '33000000-0000-4000-8000-000000000701',current_date+4,'08:00','16:00',1,
  array['direct-care'],array['other'],array['33000000-0000-4000-8000-000000000601'::uuid],
  'open',now()+interval '3 days','33000000-0000-4000-8000-000000000101'
);
select pg_temp.act_as('33000000-0000-4000-8000-000000000103');
create temporary table p3_claim on commit drop as
select * from public.claim_open_shift('33000000-0000-4000-8000-000000000703');
select is((select claim_status from p3_claim),'approved','an eligible employee atomically claims the open shift');
select is((select source from public.shift_assignments where id=(select shift_assignment_id from p3_claim)),'self_service',
  'the claimed shift is distinguishable and auditable');
select is(
  (select claim_id from public.claim_open_shift('33000000-0000-4000-8000-000000000703')),
  (select claim_id from p3_claim),'repeating the claim returns the canonical result'
);
reset role;
select throws_ok(
  $$ delete from public.schedule_eligibility_decisions where id=(select eligibility_decision_id from p3_claim) $$,
  '55000', null, 'eligibility decisions are append-only historical evidence'
);

select * from finish();
rollback;
