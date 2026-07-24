-- pgTAP coverage for the individually takeable PA DHS annual course catalog.
-- Run with: supabase test db supabase/tests/database/required_annual_individual_courses.test.sql

begin;
select plan(35);

select has_column(
  'public',
  'courses',
  'catalog_code',
  'courses expose a stable catalog code'
);

select has_column(
  'public',
  'courses',
  'recurrence_interval_days',
  'courses can define a self-enrollment recurrence interval'
);

select has_table(
  'public',
  'course_compliance_credits',
  'individual courses have a regulatory credit crosswalk'
);

select has_column(
  'public',
  'course_compliance_credits',
  'course_version_id',
  'regulatory credit mappings are pinned to an exact course version'
);

select has_table(
  'public',
  'course_completion_credits',
  'individual course completions have an assignment-specific credit ledger'
);

select results_eq(
  $$
    select c.catalog_code
    from public.courses c
    where c.organization_id is null
      and c.catalog_code is not null
      and (
        c.catalog_code like 'PA-DHS-%'
        or c.catalog_code like 'PA-PCH-%'
        or c.catalog_code like 'PA-ALR-%'
      )
    order by c.catalog_code
  $$,
  $$
    values
      ('PA-ALR-2800-236-DEMENTIA-SCU-STARTER'::text),
      ('PA-ALR-2800-236-INRBI-STARTER'::text),
      ('PA-ALR-2800-69-DEMENTIA-PART-1'::text),
      ('PA-ALR-2800-69-DEMENTIA-PART-2'::text),
      ('PA-ALR-ANNUAL-ASSESSED-NEEDS'::text),
      ('PA-ALR-ANNUAL-ASSISTED-LIVING-SERVICES'::text),
      ('PA-DHS-ANNUAL-DEMENTIA-COGNITIVE-NEURO'::text),
      ('PA-DHS-ANNUAL-EMERGENCY-PREP'::text),
      ('PA-DHS-ANNUAL-FALLS-PREVENTION'::text),
      ('PA-DHS-ANNUAL-FIRE-SAFETY-PREP'::text),
      ('PA-DHS-ANNUAL-INFECTION-IMMOBILITY'::text),
      ('PA-DHS-ANNUAL-MED-SELF-ADMIN'::text),
      ('PA-DHS-ANNUAL-MENTAL-ILLNESS-ID'::text),
      ('PA-DHS-ANNUAL-NEW-POPULATIONS'::text),
      ('PA-DHS-ANNUAL-OAPSA-REPORTING'::text),
      ('PA-DHS-ANNUAL-RESIDENT-RIGHTS'::text),
      ('PA-DHS-ANNUAL-SAFE-MANAGEMENT'::text),
      ('PA-DHS-STANDALONE-ABUSE-REPORTING'::text),
      ('PA-DHS-STANDALONE-FIRE-SAFETY'::text),
      ('PA-DHS-STANDALONE-RESIDENT-RIGHTS'::text),
      ('PA-PCH-2600-236-DEMENTIA-FOUNDATIONS'::text),
      ('PA-PCH-ANNUAL-ASSESSED-NEEDS'::text),
      ('PA-PCH-ANNUAL-PERSONAL-CARE-SERVICES'::text)
  $$,
  'the stable individual PA DHS catalog contains all 23 seeded courses'
);

select results_eq(
  $$
    select count(*)::integer
    from public.courses c
    left join public.course_versions cv on cv.id = c.current_version_id
    where c.organization_id is null
      and c.catalog_code is not null
      and (
        c.catalog_code like 'PA-DHS-%'
        or c.catalog_code like 'PA-PCH-%'
        or c.catalog_code like 'PA-ALR-%'
      )
      and (
        c.status <> 'published'
        or c.current_version_id is null
        or cv.status is distinct from 'published'
        or cv.published_at is null
        or c.recurrence_interval_days is distinct from 365
        or c.estimated_duration_minutes is null
        or c.estimated_duration_minutes <= 0
        or nullif(btrim(c.title), '') is null
        or nullif(btrim(c.description), '') is null
        or nullif(btrim(c.category), '') is null
      )
  $$,
  array[0],
  'every seeded individual course is published, annual, and catalog-ready'
);

select results_eq(
  $$
    select count(*)::integer
    from public.courses c
    where c.organization_id is null
      and c.catalog_code is not null
      and (
        not exists (
          select 1
          from public.course_blocks lesson
          where lesson.course_version_id = c.current_version_id
            and lesson.block_type = 'text'
            and nullif(btrim(lesson.body ->> 'content'), '') is not null
        )
        or not exists (
          select 1
          from public.course_blocks quiz_block
          join public.quizzes qz on qz.course_block_id = quiz_block.id
          join public.quiz_questions qq on qq.quiz_id = qz.id
          where quiz_block.course_version_id = c.current_version_id
            and quiz_block.block_type = 'quiz'
            and exists (
              select 1
              from public.quiz_answers qa
              where qa.question_id = qq.id
                and qa.is_correct
            )
            and exists (
              select 1
              from public.quiz_answers qa
              where qa.question_id = qq.id
                and not qa.is_correct
            )
        )
      )
  $$,
  array[0],
  'every seeded course has learner content and a gradeable knowledge check'
);

select results_eq(
  $$
    select tt.code, cc.credit_mode
    from public.courses c
    join public.course_compliance_credits cc on cc.course_id = c.id
    join public.training_types tt on tt.id = cc.training_type_id
    where c.catalog_code = 'PA-DHS-ANNUAL-MED-SELF-ADMIN'
      and cc.is_active
      and cc.course_version_id = c.current_version_id
    order by tt.code
  $$,
  $$
    values
      ('ALR-DIRECT-ANNUAL'::text, 'verified_only'::text),
      ('DIRECT-ANNUAL'::text, 'verified_only'::text)
  $$,
  'the shared medication-support course maps to both requirements without bypassing employer audience verification'
);

select results_eq(
  $$
    select
      count(*)::integer,
      count(*) filter (where cc.credit_mode = 'verified_only')::integer
    from public.courses c
    join public.course_compliance_credits cc on cc.course_id = c.id
    where c.catalog_code = 'PA-DHS-ANNUAL-FIRE-SAFETY-PREP'
      and cc.is_active
      and cc.course_version_id = c.current_version_id
  $$,
  $$ values (2, 2) $$,
  'fire-safety coverage is crosswalked for PCH and ALR but requires verification'
);

insert into public.organizations (id, name, slug)
values (
  '71000000-0000-4000-8000-000000000001',
  'Individual Annual Courses Test Org',
  'individual-annual-courses-test-org'
);

insert into public.facilities (id, organization_id, name, facility_type, state)
values (
  '71000000-0000-4000-8000-000000000011',
  '71000000-0000-4000-8000-000000000001',
  'Individual Annual Courses PCH',
  'PCH',
  'PA'
);

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change,
  email_change_token_current,
  reauthentication_token,
  is_sso_user,
  is_anonymous
)
select
  '00000000-0000-0000-0000-000000000000',
  fixture.id,
  'authenticated',
  'authenticated',
  fixture.email,
  'x',
  now(),
  '{}'::jsonb,
  '{}'::jsonb,
  now(),
  now(),
  '',
  '',
  '',
  '',
  '',
  '',
  false,
  false
from (values
  ('71000000-0000-4000-8000-000000000101'::uuid, 'individual-course-admin@test.local'),
  ('71000000-0000-4000-8000-000000000102'::uuid, 'individual-course-learner@test.local'),
  ('71000000-0000-4000-8000-000000000103'::uuid, 'individual-course-terminated@test.local')
) as fixture(id, email);

select set_config('app.privileged_write', 'on', true);

insert into public.profiles (
  id,
  organization_id,
  email,
  first_name,
  last_name,
  role,
  is_active
)
values
  (
    '71000000-0000-4000-8000-000000000101',
    '71000000-0000-4000-8000-000000000001',
    'individual-course-admin@test.local',
    'Annual',
    'Admin',
    'org_admin',
    true
  ),
  (
    '71000000-0000-4000-8000-000000000102',
    '71000000-0000-4000-8000-000000000001',
    'individual-course-learner@test.local',
    'Annual',
    'Learner',
    'employee',
    true
  ),
  (
    '71000000-0000-4000-8000-000000000103',
    '71000000-0000-4000-8000-000000000001',
    'individual-course-terminated@test.local',
    'Annual',
    'Terminated',
    'employee',
    true
  )
on conflict (id) do update set
  organization_id = excluded.organization_id,
  email = excluded.email,
  first_name = excluded.first_name,
  last_name = excluded.last_name,
  role = excluded.role,
  is_active = excluded.is_active;

select set_config('app.privileged_write', 'off', true);

insert into public.employees (
  id,
  organization_id,
  facility_id,
  profile_id,
  employee_number,
  first_name,
  last_name,
  email,
  hire_date,
  job_title,
  status
)
values
  (
    '71000000-0000-4000-8000-000000000201',
    '71000000-0000-4000-8000-000000000001',
    '71000000-0000-4000-8000-000000000011',
    '71000000-0000-4000-8000-000000000102',
    'ANNUAL-COURSE-LEARNER',
    'Annual',
    'Learner',
    'individual-course-learner@test.local',
    current_date - 30,
    'Direct Care Staff',
    'active'
  ),
  (
    '71000000-0000-4000-8000-000000000202',
    '71000000-0000-4000-8000-000000000001',
    '71000000-0000-4000-8000-000000000011',
    '71000000-0000-4000-8000-000000000103',
    'ANNUAL-COURSE-TERMINATED',
    'Annual',
    'Terminated',
    'individual-course-terminated@test.local',
    current_date - 365,
    'Former Direct Care Staff',
    'terminated'
  );

select throws_ok(
  $$
    insert into public.course_assignments (
      organization_id,
      facility_id,
      employee_id,
      course_id,
      course_version_id
    )
    select
      '71000000-0000-4000-8000-000000000001'::uuid,
      '71000000-0000-4000-8000-000000000011'::uuid,
      '71000000-0000-4000-8000-000000000201'::uuid,
      c.id,
      c.current_version_id
    from public.courses c
    where c.organization_id is null
      and c.status = 'archived'
      and c.catalog_code is null
    order by c.title
    limit 1
  $$,
  '23514',
  'cannot create a new assignment for an archived or draft course',
  'an archived aggregate cannot receive a new assignment even through a direct insert'
);

select throws_ok(
  $$
    insert into public.course_assignments (
      organization_id,
      facility_id,
      employee_id,
      course_id,
      course_version_id
    )
    select
      '71000000-0000-4000-8000-000000000001'::uuid,
      '71000000-0000-4000-8000-000000000011'::uuid,
      '71000000-0000-4000-8000-000000000201'::uuid,
      c.id,
      cv.id
    from public.courses c
    join public.course_versions cv on cv.course_id = c.id
    where c.catalog_code = 'PA-DHS-ANNUAL-MED-SELF-ADMIN'
      and cv.id is distinct from c.current_version_id
    order by cv.version_number
    limit 1
  $$,
  '23514',
  'new assignments must use the course current version',
  'a superseded starter version cannot receive a new assignment through a direct insert'
);

create temporary table annual_course_test_ids (
  key text primary key,
  id uuid not null
) on commit drop;

grant all on annual_course_test_ids to authenticated;

create or replace function pg_temp.act_as(p_profile_id uuid)
returns void
language plpgsql
as $$
begin
  reset role;
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_profile_id::text, 'role', 'authenticated')::text,
    true
  );
  set local role authenticated;
end;
$$;

-- Negative mutation assertions must not corrupt fixtures when a guard is
-- temporarily absent. If the mutation succeeds, raise and catch a sentinel so
-- PostgreSQL rolls that mutation back while pgTAP still observes "no exception."
create or replace function pg_temp.try_guarded_mutation(p_sql text)
returns void
language plpgsql
as $$
begin
  begin
    execute p_sql;
    raise exception 'guarded mutation unexpectedly succeeded';
  exception
    when raise_exception then
      null;
  end;
end;
$$;

select pg_temp.act_as('71000000-0000-4000-8000-000000000101');

select lives_ok(
  $$
    select public.self_enroll_course(c.id)
    from public.courses c
    where c.catalog_code = 'PA-DHS-ANNUAL-MED-SELF-ADMIN'
  $$,
  'an active administrator can self-enroll through an inactive pseudo-employee record'
);

reset role;
select results_eq(
  $$
    select e.status
    from public.employees e
    where e.profile_id = '71000000-0000-4000-8000-000000000101'
  $$,
  $$ values ('inactive'::text) $$,
  'administrator course access does not activate the pseudo-employee in compliance reporting'
);

select pg_temp.act_as('71000000-0000-4000-8000-000000000103');

select throws_ok(
  $$
    select public.self_enroll_course(c.id)
    from public.courses c
    where c.catalog_code = 'PA-DHS-ANNUAL-MED-SELF-ADMIN'
  $$,
  '42501',
  'inactive or terminated employees may not self-enroll in courses',
  'a terminated employee cannot create a new course assignment'
);

reset role;
select pg_temp.act_as('71000000-0000-4000-8000-000000000102');

insert into annual_course_test_ids (key, id)
select 'medication', public.self_enroll_course(c.id)
from public.courses c
where c.catalog_code = 'PA-DHS-ANNUAL-MED-SELF-ADMIN';

select results_eq(
  $$
    select public.self_enroll_course(c.id)
    from public.courses c
    where c.catalog_code = 'PA-DHS-ANNUAL-MED-SELF-ADMIN'
  $$,
  $$ select id from annual_course_test_ids where key = 'medication' $$,
  'same-cycle self-enrollment reuses the open assignment'
);

-- Exercise the database immutability trigger directly. A learner UPDATE is
-- intentionally hidden by RLS (zero affected rows), which is also safe but
-- cannot prove that the trigger rejects a write from an actor who can reach it.
reset role;
select set_config('app.privileged_write', 'off', true);

select throws_ok(
  $test$
    select pg_temp.try_guarded_mutation($mutation$
      update public.course_assignments ca
      set course_id = replacement.id,
          course_version_id = replacement.current_version_id
      from public.courses replacement
      where ca.id = (select id from annual_course_test_ids where key = 'medication')
        and replacement.catalog_code = 'PA-DHS-ANNUAL-FIRE-SAFETY-PREP'
    $mutation$)
  $test$,
  '55000',
  'course assignment learner, scope, course, and version are immutable',
  'a started assignment cannot be repointed to a different course and version'
);

reset role;
select pg_temp.act_as('71000000-0000-4000-8000-000000000102');

select throws_ok(
  $$
    select public.complete_course_assignment(
      (select id from annual_course_test_ids where key = 'medication')
    )
  $$,
  '23514',
  'This course has not been started yet -- open it and work through at least one lesson before marking it complete.',
  'a learner cannot complete comprehensive content before starting it'
);

reset role;
select set_config('app.privileged_write', 'on', true);

insert into public.course_progress (
  assignment_id,
  percent_complete,
  started_at,
  last_block_id
)
select
  ca.id,
  100,
  now() - interval '46 minutes',
  cb.id
from public.course_assignments ca
join public.course_blocks cb on cb.course_version_id = ca.course_version_id
where ca.id = (select id from annual_course_test_ids where key = 'medication')
order by cb.sort_order desc, cb.id desc
limit 1;

-- The comprehensive completion validator checks assessments before applied
-- responses. Seed the passing assessment first so the next assertion reaches
-- the response-specific gate it is intended to cover.
insert into public.quiz_attempts (
  organization_id,
  facility_id,
  assignment_id,
  quiz_id,
  employee_id,
  attempt_number,
  score_percent,
  passed,
  submitted_at
)
select
  ca.organization_id,
  ca.facility_id,
  ca.id,
  qz.id,
  ca.employee_id,
  1,
  100,
  true,
  now()
from public.course_assignments ca
join public.course_blocks cb on cb.course_version_id = ca.course_version_id
join public.quizzes qz on qz.course_block_id = cb.id
where ca.id = (select id from annual_course_test_ids where key = 'medication')
  and cb.block_type = 'quiz';

select set_config('app.privileged_write', 'off', true);
select pg_temp.act_as('71000000-0000-4000-8000-000000000102');

select throws_ok(
  $$
    select public.complete_course_assignment(
      (select id from annual_course_test_ids where key = 'medication')
    )
  $$,
  '23514',
  'Comprehensive training requires a written response for every applied scenario and practice step.',
  'a learner must respond to every applied activity before completion'
);

reset role;
select set_config('app.privileged_write', 'on', true);

update public.course_progress cp
set learning_tools = jsonb_build_object(
  'notes',
  (
    select coalesce(
      jsonb_object_agg(cb.id::text, 'I would apply the required steps, document the outcome, and notify the correct person.'),
      '{}'::jsonb
    )
    from public.course_blocks cb
    where cb.course_version_id = ca.course_version_id
      and cb.body ->> 'activity_type' in ('scenario', 'practice')
  )
)
from public.course_assignments ca
where ca.id = cp.assignment_id
  and ca.id = (select id from annual_course_test_ids where key = 'medication');

select set_config('app.privileged_write', 'off', true);
select pg_temp.act_as('71000000-0000-4000-8000-000000000102');

select lives_ok(
  $$
    select public.complete_course_assignment(
      (select id from annual_course_test_ids where key = 'medication')
    )
  $$,
  'the learner can complete the fully timed medication-support course'
);

-- complete_course_assignment() uses a transaction-local trusted-write flag for
-- its atomic status transition. A real RPC request ends that transaction; this
-- pgTAP file deliberately keeps many simulated requests in one transaction, so
-- reproduce the request boundary before testing post-completion immutability.
reset role;
select set_config('app.privileged_write', 'off', true);
select pg_temp.act_as('71000000-0000-4000-8000-000000000102');

select results_eq(
  $$
    select count(*)::integer
    from public.course_completion_credits cc
    where cc.course_assignment_id = (
      select id from annual_course_test_ids where key = 'medication'
    )
  $$,
  array[0],
  'course completion alone creates no regulatory credit before employer verification'
);

select is(
  (
    select count(*)::integer
    from public.employee_training_records r
    join public.training_types tt on tt.id = r.training_type_id
    where r.employee_id = '71000000-0000-4000-8000-000000000201'
      and tt.code = 'DIRECT-ANNUAL'
      and r.completion_date is not null
  ),
  0,
  'verified-only course completion does not mark the employee requirement complete'
);

select results_eq(
  $$
    select status
    from public.course_assignments
    where id = (select id from annual_course_test_ids where key = 'medication')
  $$,
  $$ values ('completed'::text) $$,
  'the course assignment still records completed learning evidence'
);

select throws_ok(
  $test$
    select pg_temp.try_guarded_mutation($mutation$
      update public.course_progress
      set learning_tools = '{}'::jsonb,
          percent_complete = 1
      where assignment_id = (select id from annual_course_test_ids where key = 'medication')
    $mutation$)
  $test$,
  '55000',
  'completed course progress evidence is immutable',
  'completed progress and applied responses cannot be rewritten during review'
);

reset role;
select pg_temp.act_as('71000000-0000-4000-8000-000000000101');

select throws_ok(
  $test$
    select pg_temp.try_guarded_mutation($mutation$
      delete from public.quiz_attempts
      where assignment_id = (select id from annual_course_test_ids where key = 'medication')
    $mutation$)
  $test$,
  '55000',
  'completed course quiz evidence is immutable',
  'a manager cannot delete passed quiz evidence after completion'
);

select throws_ok(
  $test$
    select pg_temp.try_guarded_mutation($mutation$
      delete from public.course_assignments
      where id = (select id from annual_course_test_ids where key = 'medication')
    $mutation$)
  $test$,
  '55000',
  'completed course assignment evidence is immutable',
  'a manager cannot delete a completed assignment and detach its evidence'
);

reset role;
select pg_temp.act_as('71000000-0000-4000-8000-000000000102');

select results_eq(
  $$
    select public.self_enroll_course(c.id)
    from public.courses c
    where c.catalog_code = 'PA-DHS-ANNUAL-MED-SELF-ADMIN'
  $$,
  $$ select id from annual_course_test_ids where key = 'medication' $$,
  'same-cycle self-enrollment reuses the completed recurring assignment'
);

insert into annual_course_test_ids (key, id)
select 'verified_only', public.self_enroll_course(c.id)
from public.courses c
where c.catalog_code = 'PA-DHS-ANNUAL-FIRE-SAFETY-PREP';

select throws_ok(
  $test$
    select pg_temp.try_guarded_mutation($mutation$
      update public.course_progress
      set assignment_id = (select id from annual_course_test_ids where key = 'verified_only')
      where assignment_id = (select id from annual_course_test_ids where key = 'medication')
    $mutation$)
  $test$,
  '55000',
  'course progress assignment is immutable',
  'completed progress cannot be reparented to an open assignment'
);

select throws_ok(
  $test$
    select pg_temp.try_guarded_mutation($mutation$
      update public.quiz_attempts
      set assignment_id = (select id from annual_course_test_ids where key = 'verified_only')
      where assignment_id = (select id from annual_course_test_ids where key = 'medication')
    $mutation$)
  $test$,
  '55000',
  'quiz attempt assignment, quiz, learner, scope, and sequence are immutable',
  'passed quiz evidence cannot be reparented from a completed assignment to an open one'
);

reset role;
select set_config('app.privileged_write', 'on', true);

insert into public.course_progress (
  assignment_id,
  percent_complete,
  started_at,
  last_block_id,
  learning_tools
)
select
  ca.id,
  100,
  now() - interval '6 minutes',
  cb.id,
  jsonb_build_object(
    'notes',
    (
      select coalesce(
        jsonb_object_agg(applied.id::text, 'I would follow the facility procedure, protect the people present, and report the result.'),
        '{}'::jsonb
      )
      from public.course_blocks applied
      where applied.course_version_id = ca.course_version_id
        and applied.body ->> 'activity_type' in ('scenario', 'practice')
    )
  )
from public.course_assignments ca
join public.course_blocks cb on cb.course_version_id = ca.course_version_id
where ca.id = (select id from annual_course_test_ids where key = 'verified_only')
order by cb.sort_order desc, cb.id desc
limit 1;

insert into public.quiz_attempts (
  organization_id,
  facility_id,
  assignment_id,
  quiz_id,
  employee_id,
  attempt_number,
  score_percent,
  passed,
  submitted_at
)
select
  ca.organization_id,
  ca.facility_id,
  ca.id,
  qz.id,
  ca.employee_id,
  1,
  100,
  true,
  now()
from public.course_assignments ca
join public.course_blocks cb on cb.course_version_id = ca.course_version_id
join public.quizzes qz on qz.course_block_id = cb.id
where ca.id = (select id from annual_course_test_ids where key = 'verified_only')
  and cb.block_type = 'quiz';

select set_config('app.privileged_write', 'off', true);
select pg_temp.act_as('71000000-0000-4000-8000-000000000102');

select throws_ok(
  $$
    select public.complete_course_assignment(
      (select id from annual_course_test_ids where key = 'verified_only')
    )
  $$,
  '23514',
  'Comprehensive training requires the full designed engagement time of 45 minute(s).',
  'a learner cannot click through verified-only comprehensive content before its full duration'
);

reset role;
select pg_temp.act_as('71000000-0000-4000-8000-000000000101');

select throws_ok(
  $$
    select public.complete_course_assignment(
      (select id from annual_course_test_ids where key = 'verified_only')
    )
  $$,
  '23514',
  'Comprehensive training requires the full designed engagement time of 45 minute(s).',
  'a manager cannot bypass comprehensive progress, work, assessment, or time evidence'
);

reset role;
select set_config('app.privileged_write', 'on', true);
update public.course_progress
set started_at = now() - interval '46 minutes'
where assignment_id = (select id from annual_course_test_ids where key = 'verified_only');
select set_config('app.privileged_write', 'off', true);
select pg_temp.act_as('71000000-0000-4000-8000-000000000101');

select lives_ok(
  $$
    select public.complete_course_assignment(
      (select id from annual_course_test_ids where key = 'verified_only')
    )
  $$,
  'the verified-only fire-safety assignment can complete as course evidence'
);

select results_eq(
  $$
    select count(*)::integer
    from public.course_completion_credits cc
    where cc.course_assignment_id = (
      select id from annual_course_test_ids where key = 'verified_only'
    )
  $$,
  array[0],
  'verified-only fire-safety completion does not create automatic regulatory credit'
);

reset role;
select set_config('app.privileged_write', 'on', true);

update public.course_assignments
set completed_at = now() - interval '340 days',
    completion_recorded_at = now() - interval '340 days'
where id = (select id from annual_course_test_ids where key = 'medication');

update public.course_completion_credits
set credited_at = now() - interval '340 days',
    training_year = extract(
      year from ((now() - interval '340 days') at time zone 'America/New_York')
    )::integer
where course_assignment_id = (select id from annual_course_test_ids where key = 'medication');

update public.certificates
set issued_at = now() - interval '340 days'
where course_assignment_id = (select id from annual_course_test_ids where key = 'medication');

select set_config('app.privileged_write', 'off', true);
select pg_temp.act_as('71000000-0000-4000-8000-000000000102');

select isnt(
  public.self_enroll_course(
    (
      select c.id
      from public.courses c
      where c.catalog_code = 'PA-DHS-ANNUAL-MED-SELF-ADMIN'
    )
  ),
  (select id from annual_course_test_ids where key = 'medication'),
  'the final 30-day renewal window creates a fresh annual assignment before expiration'
);

select results_eq(
  $$
    select
      count(*)::integer,
      count(*) filter (where ca.status = 'completed')::integer,
      count(*) filter (where ca.status = 'assigned' and ca.completed_at is null)::integer
    from public.course_assignments ca
    join public.courses c on c.id = ca.course_id
    where ca.employee_id = '71000000-0000-4000-8000-000000000201'
      and c.catalog_code = 'PA-DHS-ANNUAL-MED-SELF-ADMIN'
  $$,
  $$ values (2, 1, 1) $$,
  'renewal preserves prior completion evidence and opens one fresh assignment'
);

select * from finish();
rollback;
