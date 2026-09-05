-- pgTAP coverage for 20260905120000: the regulatory gates that lived only in React (I14).
--
-- Each case is the same shape -- do through PostgREST, as a signed-in user, what the product does
-- through an RPC -- and each one worked before this migration. Run with: supabase test db.

begin;
select plan(18);

insert into public.organizations(id, name, slug) values
  ('d1000000-0000-4000-8000-000000000001', 'Gates Org', 'ui-only-gates-org');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('d1000000-0000-4000-8000-000000000011', 'd1000000-0000-4000-8000-000000000001', 'Gates Facility', 'PCH');

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', 'd1000000-0000-4000-8000-000000000021', 'authenticated',
   'authenticated', 'gates-admin@test.local', 'x', now(), '{}'::jsonb, '{}'::jsonb, now(), now(),
   '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', 'd1000000-0000-4000-8000-000000000022', 'authenticated',
   'authenticated', 'gates-manager@test.local', 'x', now(), '{}'::jsonb, '{}'::jsonb, now(), now(),
   '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', 'd1000000-0000-4000-8000-000000000023', 'authenticated',
   'authenticated', 'gates-learner@test.local', 'x', now(), '{}'::jsonb, '{}'::jsonb, now(), now(),
   '', '', '', '', '', '', false, false);

select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('d1000000-0000-4000-8000-000000000021', 'd1000000-0000-4000-8000-000000000001',
   'gates-admin@test.local', 'Avery', 'Admin', 'org_admin', true),
  ('d1000000-0000-4000-8000-000000000022', 'd1000000-0000-4000-8000-000000000001',
   'gates-manager@test.local', 'Morgan', 'Manager', 'facility_manager', true),
  ('d1000000-0000-4000-8000-000000000023', 'd1000000-0000-4000-8000-000000000001',
   'gates-learner@test.local', 'Lee', 'Learner', 'employee', true)
on conflict (id) do update set organization_id = excluded.organization_id,
  role = excluded.role, is_active = true;
insert into public.employees(id, organization_id, facility_id, first_name, last_name, email, job_title, status, profile_id)
values ('d1000000-0000-4000-8000-000000000031', 'd1000000-0000-4000-8000-000000000001',
        'd1000000-0000-4000-8000-000000000011', 'Morgan', 'Manager', 'gates-manager@test.local',
        'Facility Manager', 'active', 'd1000000-0000-4000-8000-000000000022');
-- The learner is an `employee`: a facility_manager can read peer results anyway, so testing the
-- elimination attack against one would prove nothing about the gate.
insert into public.employees(id, organization_id, facility_id, first_name, last_name, email, job_title, status, profile_id)
values ('d1000000-0000-4000-8000-000000000032', 'd1000000-0000-4000-8000-000000000001',
        'd1000000-0000-4000-8000-000000000011', 'Lee', 'Learner', 'gates-learner@test.local',
        'Direct Care Aide', 'active', 'd1000000-0000-4000-8000-000000000023');
insert into public.residents(id, organization_id, facility_id, first_name, last_name, status, admission_date)
values ('d1000000-0000-4000-8000-000000000041', 'd1000000-0000-4000-8000-000000000001',
        'd1000000-0000-4000-8000-000000000011', 'Rowan', 'Resident', 'active', current_date - 30);
insert into public.incidents(
  id, organization_id, facility_id, incident_type, severity, narrative, occurred_at, status
) values (
  'd1000000-0000-4000-8000-000000000051', 'd1000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000011', 'significant_injury', 'moderate', 'Fall in the dayroom.',
  now() - interval '2 days', 'investigating'
);
insert into public.dhs_violations(
  id, organization_id, facility_id, citation_ref, description, severity, status, inspection_date,
  poc_due_date
) values (
  'd1000000-0000-4000-8000-000000000061', 'd1000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000011', '2600.56(a)', 'Staff training records incomplete.',
  'moderate', 'open', current_date - 5, current_date + 25
);
insert into public.resident_documents(
  id, organization_id, facility_id, resident_id, document_label,
  storage_path, file_name, file_type
) values (
  'd1000000-0000-4000-8000-000000000071', 'd1000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000011', 'd1000000-0000-4000-8000-000000000041',
  'Hospital discharge summary', 'gates/discharge.pdf', 'discharge.pdf', 'application/pdf'
);
select set_config('app.privileged_write', 'off', true);

create or replace function pg_temp.act_as(p_profile_id uuid)
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_profile_id, 'role', 'authenticated', 'aal', 'aal2'
  )::text, true);
  execute 'set local role authenticated';
end;
$$;

-- 1-3. The approval gate was passable by writing the column that proves it.
select pg_temp.act_as('d1000000-0000-4000-8000-000000000021');
select throws_ok(
  $$update public.incidents set administrator_approved_at = now()
    where id = 'd1000000-0000-4000-8000-000000000051'$$,
  '42501',
  null,
  'an administrator cannot approve an investigation by writing the approval column'
);
select throws_ok(
  $$update public.incidents set reportability_status = 'not_reportable'
    where id = 'd1000000-0000-4000-8000-000000000051'$$,
  '42501',
  null,
  'reportability cannot be set by writing the column -- it carries a rationale and a deadline anchor'
);
-- The closure gate still refuses, which is the point: with approval unwritable, closing is too.
select throws_ok(
  $$update public.incidents set status = 'closed', final_report_submitted_at = now()
    where id = 'd1000000-0000-4000-8000-000000000051'$$,
  '23514',
  null,
  'and so an incident still cannot be closed without a real approval'
);

-- An ordinary investigation write is untouched: the guard fires on change, not on presence.
select lives_ok(
  $$update public.incidents
    set investigation_findings = 'Reviewed the dayroom.',
        administrator_approved_at = administrator_approved_at
    where id = 'd1000000-0000-4000-8000-000000000051'$$,
  'a full-row update carrying an unchanged approval column still works'
);

-- 4-6. Closure stamps, and reopening.
reset role;
select set_config('app.privileged_write', 'on', true);
update public.incidents
set administrator_approved_at = now(), administrator_approved_by = 'd1000000-0000-4000-8000-000000000021',
    final_report_submitted_at = now()
where id = 'd1000000-0000-4000-8000-000000000051';
select set_config('app.privileged_write', 'off', true);

select pg_temp.act_as('d1000000-0000-4000-8000-000000000021');
select lives_ok(
  $$update public.incidents set status = 'closed'
    where id = 'd1000000-0000-4000-8000-000000000051'$$,
  'with a real approval recorded, the incident closes'
);
select ok(
  (select closed_at is not null and closed_by_profile_id = 'd1000000-0000-4000-8000-000000000021'
   from public.incidents where id = 'd1000000-0000-4000-8000-000000000051'),
  'closing stamps closed_at and who closed it -- nothing wrote either column before'
);

select pg_temp.act_as('d1000000-0000-4000-8000-000000000022');
select throws_ok(
  $$update public.incidents set status = 'investigating'
    where id = 'd1000000-0000-4000-8000-000000000051'$$,
  '42501',
  null,
  'a facility manager cannot reopen a closed incident'
);

select pg_temp.act_as('d1000000-0000-4000-8000-000000000021');
select lives_ok(
  $$update public.incidents set status = 'investigating'
    where id = 'd1000000-0000-4000-8000-000000000051'$$,
  'an organization administrator can reopen it -- new information is a real thing'
);
select ok(
  (select closed_at is null and closed_by_profile_id is null
   from public.incidents where id = 'd1000000-0000-4000-8000-000000000051'),
  'reopening clears the closure stamps rather than leaving a row that claims to be both'
);

-- 7-9. The plan-of-correction ladder.
select throws_ok(
  $$update public.dhs_violations set status = 'verified'
    where id = 'd1000000-0000-4000-8000-000000000061'$$,
  '42501',
  null,
  'a violation cannot be marked verified by writing status -- that is POC_LIFECYCLE rule 5'
);
select throws_ok(
  $$update public.dhs_violations set status = 'poc_submitted'
    where id = 'd1000000-0000-4000-8000-000000000061'$$,
  '42501',
  null,
  'nor moved to poc_submitted without a plan of correction'
);
select lives_ok(
  $$update public.dhs_violations set surveyor_name = 'K. Inspector'
    where id = 'd1000000-0000-4000-8000-000000000061'$$,
  'the descriptive fields the violations page actually writes are unaffected'
);

-- 10-11. Deleting a resident, and deleting evidence.
select is(
  (select count(*)::integer from public.residents where id = 'd1000000-0000-4000-8000-000000000041'),
  1,
  'the resident is there to begin with'
);
delete from public.residents where id = 'd1000000-0000-4000-8000-000000000041';
select is(
  (select count(*)::integer from public.residents where id = 'd1000000-0000-4000-8000-000000000041'),
  1,
  'an org_admin DELETE removes no rows -- 31 cascades, including finalized assessments, no longer fire'
);

reset role;
select set_config('app.privileged_write', 'on', true);
insert into public.hospital_transfer_episodes(
  id, organization_id, facility_id, resident_id, reason, destination, transfer_time,
  transport_method, discharge_document_id
) values (
  'd1000000-0000-4000-8000-000000000081', 'd1000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000011', 'd1000000-0000-4000-8000-000000000041',
  'Evaluation after a fall', 'County General', now() - interval '3 days', 'ambulance',
  'd1000000-0000-4000-8000-000000000071'
);
select set_config('app.privileged_write', 'off', true);

select throws_ok(
  $$delete from public.resident_documents where id = 'd1000000-0000-4000-8000-000000000071'$$,
  '23503',
  null,
  'a discharge summary cited by an episode cannot be deleted out from under it'
);

-- 16-18. A failed examination must not tell the learner which questions they missed.
reset role;
select set_config('app.privileged_write', 'on', true);
insert into public.courses(id, organization_id, title, status, created_by)
values ('d1000000-0000-4000-8000-000000000091', 'd1000000-0000-4000-8000-000000000001',
        'Annual Fire Safety', 'draft', 'd1000000-0000-4000-8000-000000000021');
insert into public.course_versions(id, course_id, organization_id, version_number, title, status)
values ('d1000000-0000-4000-8000-000000000092', 'd1000000-0000-4000-8000-000000000091',
        'd1000000-0000-4000-8000-000000000001', 1, 'Annual Fire Safety v1', 'draft');
insert into public.course_blocks(id, course_version_id, organization_id, block_type, sort_order, title, body)
values ('d1000000-0000-4000-8000-000000000099', 'd1000000-0000-4000-8000-000000000092',
        'd1000000-0000-4000-8000-000000000001', 'text', 0, 'Introduction',
        '{"content":"Evacuation routes"}'),
       ('d1000000-0000-4000-8000-000000000093', 'd1000000-0000-4000-8000-000000000092',
        'd1000000-0000-4000-8000-000000000001', 'quiz', 1, 'Final Exam', '{}'::jsonb);
-- An examination with attempts to spare: exactly the state the elimination attack needs.
insert into public.quizzes(id, course_block_id, title, quiz_kind, max_attempts)
values ('d1000000-0000-4000-8000-000000000095', 'd1000000-0000-4000-8000-000000000093',
        'Final Exam', 'final_exam', 3);
insert into public.quiz_questions(id, quiz_id, question_text, question_type, sort_order)
values ('d1000000-0000-4000-8000-000000000096', 'd1000000-0000-4000-8000-000000000095',
        'Where is the nearest pull station?', 'multiple_choice', 0);
insert into public.quiz_answers(question_id, answer_text, is_correct, sort_order) values
  ('d1000000-0000-4000-8000-000000000096', 'By the stairwell', true, 0),
  ('d1000000-0000-4000-8000-000000000096', 'In the pantry', false, 1);
update public.course_versions set status = 'published', published_at = now()
  where id = 'd1000000-0000-4000-8000-000000000092';
update public.courses set current_version_id = 'd1000000-0000-4000-8000-000000000092', status = 'published'
  where id = 'd1000000-0000-4000-8000-000000000091';
insert into public.course_assignments(id, organization_id, facility_id, employee_id, course_id, course_version_id, status)
values ('d1000000-0000-4000-8000-000000000094', 'd1000000-0000-4000-8000-000000000001',
        'd1000000-0000-4000-8000-000000000011', 'd1000000-0000-4000-8000-000000000032',
        'd1000000-0000-4000-8000-000000000091', 'd1000000-0000-4000-8000-000000000092', 'in_progress');
insert into public.quiz_attempts(
  id, organization_id, facility_id, assignment_id, quiz_id, employee_id, attempt_number,
  submitted_at, passed, score_percent
) values (
  'd1000000-0000-4000-8000-000000000097', 'd1000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000011', 'd1000000-0000-4000-8000-000000000094',
  'd1000000-0000-4000-8000-000000000095', 'd1000000-0000-4000-8000-000000000032', 1,
  now(), false, 40
);
insert into public.quiz_attempt_answers(id, attempt_id, question_id, is_correct)
values ('d1000000-0000-4000-8000-000000000098', 'd1000000-0000-4000-8000-000000000097',
        'd1000000-0000-4000-8000-000000000096', false);
select set_config('app.privileged_write', 'off', true);

select pg_temp.act_as('d1000000-0000-4000-8000-000000000023');
select is(
  (select count(*)::integer from public.quiz_attempt_answers
   where attempt_id = 'd1000000-0000-4000-8000-000000000097'),
  0,
  'after failing an exam with attempts left, the learner cannot see which questions they missed'
);

reset role;
select set_config('app.privileged_write', 'on', true);
update public.quiz_attempts set attempt_number = 3
  where id = 'd1000000-0000-4000-8000-000000000097';
select set_config('app.privileged_write', 'off', true);
select pg_temp.act_as('d1000000-0000-4000-8000-000000000023');
select is(
  (select count(*)::integer from public.quiz_attempt_answers
   where attempt_id = 'd1000000-0000-4000-8000-000000000097'),
  1,
  'on the last allowed attempt there is nothing left to game, so the review opens'
);

reset role;
select set_config('app.privileged_write', 'on', true);
update public.quiz_attempts set attempt_number = 1, submitted_at = null, passed = null, score_percent = null
  where id = 'd1000000-0000-4000-8000-000000000097';
select set_config('app.privileged_write', 'off', true);
select pg_temp.act_as('d1000000-0000-4000-8000-000000000023');
select is(
  (select count(*)::integer from public.quiz_attempt_answers
   where attempt_id = 'd1000000-0000-4000-8000-000000000097'),
  1,
  'and an attempt still in progress stays readable, so resuming a half-finished quiz still works'
);

select * from finish();
rollback;
