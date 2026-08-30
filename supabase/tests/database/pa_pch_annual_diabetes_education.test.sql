-- The PA PCH Annual Diabetes Education course, end to end against the real seeded catalog course.
--
-- This deliberately does NOT build a fixture course: the point of the course is a set of promises
-- about the published content (exactly thirty examination questions, 90 percent, unlimited
-- attempts, a signed attestation, no competency step), and a fixture would test a copy of those
-- promises rather than the ones an employee actually receives.
--
-- Run with: supabase test db (requires the local Supabase Docker stack).

begin;
select plan(48);

-- ---------------------------------------------------------------------------
-- What the published course promises
-- ---------------------------------------------------------------------------

select results_eq(
  $$
    select c.status, cv.status, cv.version_label, c.recurrence_interval_days
    from public.courses c
    join public.course_versions cv on cv.id = c.current_version_id
    where c.organization_id is null and c.catalog_code = 'PA-PCH-DIABETES-ANNUAL'
  $$,
  $$ values ('published'::text, 'published'::text, '2026.2'::text, 365) $$,
  'the annual diabetes course ships ACTIVE, not as a draft awaiting approval'
);

select results_eq(
  $$
    select count(*)::integer
    from public.quiz_questions qq
    join public.quizzes q on q.id = qq.quiz_id
    join public.course_blocks cb on cb.id = q.course_block_id
    join public.courses c on c.current_version_id = cb.course_version_id
    where c.catalog_code = 'PA-PCH-DIABETES-ANNUAL' and q.quiz_kind = 'final_exam'
  $$,
  array[30],
  'the final examination contains exactly 30 questions -- not a bank sampled down to 30'
);

select results_eq(
  $$
    select q.passing_score_percent, q.max_attempts, q.shuffle_questions, q.shuffle_answers
    from public.quizzes q
    join public.course_blocks cb on cb.id = q.course_block_id
    join public.courses c on c.current_version_id = cb.course_version_id
    where c.catalog_code = 'PA-PCH-DIABETES-ANNUAL' and q.quiz_kind = 'final_exam'
  $$,
  $$ values (90, null::integer, true, true) $$,
  'the examination passes at 90 percent, allows unlimited attempts, and randomizes order'
);

-- 90 percent of 30 questions is 27 exactly, which is the pass mark the course claims.
select is(
  ceil(0.90 * 30)::integer,
  27,
  'a 90 percent threshold on 30 single-point questions is 27 correct'
);

select results_eq(
  $$
    select count(*)::integer, count(*) filter (where q.max_attempts is null)::integer
    from public.quizzes q
    join public.course_blocks cb on cb.id = q.course_block_id
    join public.courses c on c.current_version_id = cb.course_version_id
    where c.catalog_code = 'PA-PCH-DIABETES-ANNUAL' and q.quiz_kind = 'knowledge_check'
  $$,
  $$ values (12, 12) $$,
  'each of the twelve modules has a knowledge check, every one with unlimited retries'
);

select results_eq(
  $$
    select count(*)::integer
    from public.course_blocks cb
    join public.courses c on c.current_version_id = cb.course_version_id
    where c.catalog_code = 'PA-PCH-DIABETES-ANNUAL' and cb.block_type = 'attestation'
  $$,
  array[1],
  'the course ends in exactly one learner attestation step'
);

-- What this course must NOT contain. Named rather than counted so a failure says which one came
-- back. Scoped to the course itself: generic competency functionality elsewhere in the product is
-- untouched by this work, and asserting against it would be asserting the wrong thing.
select is(
  (
    select coalesce(string_agg(distinct spot, ', ' order by spot), '(none)')
    from (
      -- 'video' is presenter instruction -- Kevin talking over slides -- and is the opposite of a
      -- learner-recorded competency: nothing about it asks the learner to submit anything. The
      -- block vocabulary carries no learner-submission type at all (text, video, pdf, scorm, quiz,
      -- attestation), so this catches an unexpected block type rather than proving a negative; the
      -- competency, upload and review-queue absences are asserted against their own tables below.
      select 'unexpected block type: ' || cb.block_type as spot
      from public.course_blocks cb
      join public.courses c on c.current_version_id = cb.course_version_id
      where c.catalog_code = 'PA-PCH-DIABETES-ANNUAL'
        and cb.block_type not in ('text', 'video', 'quiz', 'attestation')
      union all
      select 'unreviewed AI content gate'
      from public.course_versions cv
      join public.courses c on c.current_version_id = cv.id
      where c.catalog_code = 'PA-PCH-DIABETES-ANNUAL' and cv.ai_generated
    ) findings
  ),
  '(none)',
  'the course is reading, knowledge checks and an attestation only -- no recording, upload or review step'
);

select results_eq(
  $$
    select p.credential, p.content_version, tt.code
    from public.courses c
    join public.course_provider_profiles p on p.course_id = c.id
    join public.training_types tt on tt.id = c.renewal_training_type_id
    where c.catalog_code = 'PA-PCH-DIABETES-ANNUAL'
  $$,
  $$ values ('CDCES'::text, '2026.1'::text, 'DIABETES-EDU'::text) $$,
  'provider credential and the annual renewal requirement are recorded on the course'
);

-- ---------------------------------------------------------------------------
-- Credited duration versus delivered time
-- ---------------------------------------------------------------------------
--
-- The course credits four hours and its written v2026.1 takes that long; the video-led v2026.2
-- delivers the same curriculum in about an hour. That difference is a recorded provider
-- determination rather than a gap in the data, and the rules around it are what these four assert.

select results_eq(
  $$
    select c.estimated_duration_minutes,
           public.get_course_version_designed_minutes(cv.id),
           cv.credited_duration_rationale is not null
    from public.courses c
    join public.course_versions cv on cv.course_id = c.id and cv.version_label = '2026.2'
    where c.catalog_code = 'PA-PCH-DIABETES-ANNUAL'
  $$,
  $$ values (240, 60, true) $$,
  'the course credits 240 minutes while its video version delivers in 60, with a rationale on file'
);

select is(
  (
    select count(*)::integer
    from public.course_versions cv
    join public.courses c on c.id = cv.course_id
    where c.catalog_code = 'PA-PCH-DIABETES-ANNUAL'
      and cv.version_label = '2026.1'
      and (cv.credited_duration_rationale is not null
           or public.get_course_version_designed_minutes(cv.id) <> c.estimated_duration_minutes)
  ),
  0,
  'the written version still matches its catalog duration exactly and needs no rationale'
);

-- The exemption is opt-in, and withdrawing it brings the strict rule straight back rather than
-- leaving the standard permanently loosened for this course.
select set_config('app.privileged_write', 'on', true);

-- The update is its own statement on purpose: a function called from the same statement that
-- writes the row reads the pre-update snapshot and would report on the rationale still being there.
update public.course_versions set credited_duration_rationale = null
where version_label = '2026.2'
  and course_id = (select id from public.courses where catalog_code = 'PA-PCH-DIABETES-ANNUAL');

select ok(
  (
    select array_to_string(public.get_comprehensive_course_version_issues(cv.id), ' ')
      like '%must equal the catalog duration%'
    from public.course_versions cv
    join public.courses c on c.id = cv.course_id
    where c.catalog_code = 'PA-PCH-DIABETES-ANNUAL' and cv.version_label = '2026.2'
  ),
  'withdrawing the rationale restores exact equality as a publish blocker'
);

-- Restore it, then prove the exemption only ever shortens delivery.
update public.course_versions
set credited_duration_rationale = repeat('Recorded training provider determination for this version. ', 2)
where version_label = '2026.2'
  and course_id = (select id from public.courses where catalog_code = 'PA-PCH-DIABETES-ANNUAL');
update public.courses set estimated_duration_minutes = 30
where catalog_code = 'PA-PCH-DIABETES-ANNUAL';

select ok(
  (
    select array_to_string(public.get_comprehensive_course_version_issues(cv.id), ' ')
      like '%exceeds the catalog duration%'
    from public.course_versions cv
    join public.courses c on c.id = cv.course_id
    where c.catalog_code = 'PA-PCH-DIABETES-ANNUAL' and cv.version_label = '2026.2'
  ),
  'a rationale can shorten delivery but never let the steps exceed what the course credits'
);

-- Put the catalog back before the learner fixtures run against it.
update public.courses set estimated_duration_minutes = 240
where catalog_code = 'PA-PCH-DIABETES-ANNUAL';

-- ---------------------------------------------------------------------------
-- The compliance-credit duration exemption
-- ---------------------------------------------------------------------------
--
-- Separate from the content standard above: two triggers hold the rule that a course may not
-- credit more hours than its catalog duration covers, one watching the duration and one watching
-- the credit. This course is exempt from both, by the training provider's decision, so it can
-- credit four hours against however long it actually runs. These six assert that the exemption
-- reaches both triggers, stops at this course, and is the only thing holding either of them open.

select is(
  (
    select credited_duration_check_exempt
    from public.courses where catalog_code = 'PA-PCH-DIABETES-ANNUAL'
  ),
  true,
  'the annual diabetes course is exempt from the credited-duration checks'
);

select is(
  (
    select count(*)::integer from public.courses
    where credited_duration_check_exempt
      and catalog_code is distinct from 'PA-PCH-DIABETES-ANNUAL'
  ),
  0,
  'and no other course in the catalog is'
);

-- Drop the catalog duration to the hour the video version actually takes, then hang a four-hour
-- crosswalk on it: the exact arrangement both triggers exist to reject.
update public.courses set estimated_duration_minutes = 60
where catalog_code = 'PA-PCH-DIABETES-ANNUAL';

select lives_ok(
  $$
    insert into public.course_compliance_credits
      (course_id, course_version_id, training_type_id, topic_code, credit_hours,
       credit_mode, citation_note)
    select c.id, cv.id, tt.id, 'DIABETES', 4.00, 'verified_only',
           '55 Pa. Code 2600.190(b)'
    from public.courses c
    join public.course_versions cv on cv.course_id = c.id and cv.version_label = '2026.2'
    join public.training_types tt on tt.code = 'DIABETES-EDU' and tt.organization_id is null
    where c.catalog_code = 'PA-PCH-DIABETES-ANNUAL'
  $$,
  'an exempt course may carry a four-hour credit against a sixty-minute catalog duration'
);

select lives_ok(
  $$
    update public.courses set estimated_duration_minutes = 60
    where catalog_code = 'PA-PCH-DIABETES-ANNUAL'
  $$,
  'and its duration stays writable with that credit active'
);

-- The flag buys exactly one thing: crediting more hours than the duration covers. It is not a
-- licence to carry an active credit against no duration at all, which is broken data rather than
-- a decision anybody made.
select throws_ok(
  $$
    update public.courses set estimated_duration_minutes = 0
    where catalog_code = 'PA-PCH-DIABETES-ANNUAL'
  $$,
  '23514',
  'course duration cannot be shorter than an active compliance credit',
  'but an exempt course still cannot drop to a zero duration while a credit is active'
);

-- Withdraw the exemption and both guards come straight back, which is what makes this a flag on
-- one course rather than a hole in the rule.
update public.courses set credited_duration_check_exempt = false
where catalog_code = 'PA-PCH-DIABETES-ANNUAL';

select throws_ok(
  $$
    update public.courses set estimated_duration_minutes = 60
    where catalog_code = 'PA-PCH-DIABETES-ANNUAL'
  $$,
  '23514',
  'course duration cannot be shorter than an active compliance credit',
  'without it, validate_course_duration_for_compliance_credit rejects the same write'
);

delete from public.course_compliance_credits cc
using public.courses c
where cc.course_id = c.id and c.catalog_code = 'PA-PCH-DIABETES-ANNUAL';

select throws_ok(
  $$
    insert into public.course_compliance_credits
      (course_id, course_version_id, training_type_id, topic_code, credit_hours,
       credit_mode, citation_note)
    select c.id, cv.id, tt.id, 'DIABETES', 4.00, 'verified_only',
           '55 Pa. Code 2600.190(b)'
    from public.courses c
    join public.course_versions cv on cv.course_id = c.id and cv.version_label = '2026.2'
    join public.training_types tt on tt.code = 'DIABETES-EDU' and tt.organization_id is null
    where c.catalog_code = 'PA-PCH-DIABETES-ANNUAL'
  $$,
  '23514',
  $msg$course compliance credit 4.00 hours exceeds the course's designed duration of 60 minutes$msg$,
  'and validate_course_compliance_credit rejects the same credit'
);

-- Restore the course exactly as the catalog ships it before the learner fixtures run.
update public.courses set credited_duration_check_exempt = true
where catalog_code = 'PA-PCH-DIABETES-ANNUAL';
update public.courses set estimated_duration_minutes = 240
where catalog_code = 'PA-PCH-DIABETES-ANNUAL';
select set_config('app.privileged_write', 'off', true);

-- ---------------------------------------------------------------------------
-- The video version's renders
-- ---------------------------------------------------------------------------
--
-- v2026.2 carries twelve rendered HeyGen jobs, each now resolved: an id, a completed status, and
-- the storage path the poller re-hosted to. The sequencing that got here mattered -- the seed
-- carried narration and a null URL so no player could ship before its object existed, the wiring
-- added the ids, and only the publish step records the finished URLs -- but what has to hold now
-- is the end state, because a published version with a missing id or URL is a dead video.

select results_eq(
  $$
    select count(*)::integer,
           count(*) filter (where cb.body->'heygen'->>'video_id' is not null)::integer,
           count(*) filter (where cb.body->'heygen'->>'status' = 'completed')::integer,
           count(*) filter (where cb.video_url is not null)::integer
    from public.course_blocks cb
    join public.course_versions cv on cv.id = cb.course_version_id
    join public.courses c on c.id = cv.course_id
    where c.catalog_code = 'PA-PCH-DIABETES-ANNUAL'
      and cv.version_label = '2026.2'
      and cb.block_type = 'video'
  $$,
  $$ values (12, 12, 12, 12) $$,
  'all twelve video blocks carry a render id, a completed job and a storage path'
);

-- Wiring the ids on must not have disturbed the narration or the step minutes the comprehensive
-- standard measures -- body is merged, never replaced.
select is(
  (
    select count(*)::integer
    from public.course_blocks cb
    join public.course_versions cv on cv.id = cb.course_version_id
    join public.courses c on c.id = cv.course_id
    where c.catalog_code = 'PA-PCH-DIABETES-ANNUAL'
      and cv.version_label = '2026.2'
      and cb.block_type = 'video'
      and (length(cb.body->>'script') < 100
           or (cb.body->>'estimated_minutes')::integer not between 1 and 120)
  ),
  0,
  'and each kept its narration and its step minutes'
);

-- ---------------------------------------------------------------------------
-- Fixture: one organization, one learner, one assignment
-- ---------------------------------------------------------------------------

insert into public.organizations (id, name, slug) values
  ('d1a0e7e5-0000-4000-8000-000000000001', 'Diabetes Education Test Org', 'diabetes-education-test-org'),
  ('d1a0e7e5-0000-4000-8000-0000000000f1', 'Diabetes Education Other Org', 'diabetes-education-other-org');

insert into public.facilities (id, organization_id, name, facility_type, state) values
  ('d1a0e7e5-0000-4000-8000-000000000002', 'd1a0e7e5-0000-4000-8000-000000000001', 'Diabetes Test PCH', 'PCH', 'PA'),
  ('d1a0e7e5-0000-4000-8000-0000000000f2', 'd1a0e7e5-0000-4000-8000-0000000000f1', 'Other Org PCH', 'PCH', 'PA');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
)
select
  '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated',
  v.email, 'x', now(), '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '', '', '', false, false
from (values
  ('d1a0e7e5-0000-4000-8000-000000000003'::uuid, 'diabetes-admin@test.local'),
  ('d1a0e7e5-0000-4000-8000-000000000004'::uuid, 'diabetes-learner@test.local'),
  ('d1a0e7e5-0000-4000-8000-0000000000f3'::uuid, 'diabetes-other-admin@test.local')
) as v(id, email);

select set_config('app.privileged_write', 'on', true);

insert into public.profiles (id, organization_id, email, first_name, last_name, role, is_active) values
  ('d1a0e7e5-0000-4000-8000-000000000003', 'd1a0e7e5-0000-4000-8000-000000000001', 'diabetes-admin@test.local', 'Dee', 'Admin', 'org_admin', true),
  ('d1a0e7e5-0000-4000-8000-000000000004', 'd1a0e7e5-0000-4000-8000-000000000001', 'diabetes-learner@test.local', 'Dana', 'Learner', 'employee', true),
  ('d1a0e7e5-0000-4000-8000-0000000000f3', 'd1a0e7e5-0000-4000-8000-0000000000f1', 'diabetes-other-admin@test.local', 'Otto', 'Other', 'org_admin', true)
on conflict (id) do update set
  organization_id = excluded.organization_id,
  email = excluded.email,
  role = excluded.role,
  is_active = excluded.is_active;

select set_config('app.privileged_write', 'off', true);

insert into public.employees (
  id, organization_id, facility_id, profile_id, first_name, last_name, job_title, status,
  administers_medications, administers_insulin
) values (
  'd1a0e7e5-0000-4000-8000-000000000005',
  'd1a0e7e5-0000-4000-8000-000000000001',
  'd1a0e7e5-0000-4000-8000-000000000002',
  'd1a0e7e5-0000-4000-8000-000000000004',
  'Dana', 'Learner', 'Resident Aide', 'active', true, true
);

insert into public.course_assignments (
  id, organization_id, facility_id, employee_id, course_id, course_version_id, assigned_by
)
select
  'd1a0e7e5-0000-4000-8000-000000000008',
  'd1a0e7e5-0000-4000-8000-000000000001',
  'd1a0e7e5-0000-4000-8000-000000000002',
  'd1a0e7e5-0000-4000-8000-000000000005',
  c.id,
  c.current_version_id,
  'd1a0e7e5-0000-4000-8000-000000000003'
from public.courses c
where c.catalog_code = 'PA-PCH-DIABETES-ANNUAL';

create or replace function pg_temp.act_as(p_profile_id uuid) returns void as $$
begin
  reset role;
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_profile_id::text, 'role', 'authenticated')::text,
    true
  );
  set local role authenticated;
end;
$$ language plpgsql;

-- Choosing WHICH answer to submit needs the key, which quiz_answers RLS deliberately hides from
-- an employee. That lookup is the only definer step; the attempt and answer rows below are still
-- written by the learner under their own policies, which is the thing worth proving.
create or replace function pg_temp.pick_answer(p_question uuid, p_correct boolean)
returns uuid
language sql
security definer
set search_path = 'public'
as $$
  select a.id from public.quiz_answers a
  where a.question_id = p_question and a.is_correct = p_correct
  order by a.sort_order limit 1;
$$;

-- Answer a quiz, getting exactly p_correct questions right. Returns the graded attempt id.
-- Written as a loop rather than 30 literal inserts so the test exercises whatever the published
-- examination actually contains.
create or replace function pg_temp.take_quiz(p_quiz_id uuid, p_correct integer)
returns uuid as $$
declare
  v_attempt uuid;
  v_next integer;
  v_index integer := 0;
  v_question record;
  v_answer uuid;
begin
  select coalesce(max(attempt_number), 0) + 1 into v_next
  from public.quiz_attempts
  where assignment_id = 'd1a0e7e5-0000-4000-8000-000000000008' and quiz_id = p_quiz_id;

  insert into public.quiz_attempts (assignment_id, quiz_id, attempt_number)
  values ('d1a0e7e5-0000-4000-8000-000000000008', p_quiz_id, v_next)
  returning id into v_attempt;

  for v_question in
    select id from public.quiz_questions where quiz_id = p_quiz_id order by sort_order
  loop
    v_index := v_index + 1;
    v_answer := pg_temp.pick_answer(v_question.id, v_index <= p_correct);

    insert into public.quiz_attempt_answers (attempt_id, question_id, selected_answer_ids)
    values (v_attempt, v_question.id, array[v_answer]);
  end loop;

  perform public.grade_quiz_attempt(v_attempt);
  return v_attempt;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------
-- The learner works the course
-- ---------------------------------------------------------------------------

select pg_temp.act_as('d1a0e7e5-0000-4000-8000-000000000004');

select lives_ok(
  $$ select public.start_course_assignment('d1a0e7e5-0000-4000-8000-000000000008') $$,
  'the learner can start the course without anyone authorizing it'
);

select results_eq(
  $$ select status from public.course_assignments where id = 'd1a0e7e5-0000-4000-8000-000000000008' $$,
  array['in_progress'],
  'starting the course moves the assignment to in_progress'
);

-- Module progress is the learner's own write (start_course_assignment only moves the status),
-- and it is monotonic.
insert into public.course_progress (assignment_id, percent_complete, last_block_id)
select
  'd1a0e7e5-0000-4000-8000-000000000008',
  60,
  (select cb.id from public.course_blocks cb
   join public.course_assignments ca on ca.course_version_id = cb.course_version_id
   where ca.id = 'd1a0e7e5-0000-4000-8000-000000000008'
   order by cb.sort_order limit 1);

select results_eq(
  $$ select percent_complete from public.course_progress
     where assignment_id = 'd1a0e7e5-0000-4000-8000-000000000008' $$,
  array[60],
  'module progress is tracked against the assignment'
);

-- Two elapsed-time gates apply, and the comprehensive one is the binding one: base completion
-- wants 10 percent of the catalog duration, while require_comprehensive_self_completion() wants
-- the FULL designed engagement time -- 240 minutes for this course. Both are measured against
-- course_progress.started_at, which protect_course_progress_timing stamps to now(). Backdate past
-- the larger of the two the way trusted server code would, so the assertions below are about the
-- examination and the attestation rather than about waiting four hours.
select set_config('app.privileged_write', 'on', true);
update public.course_progress
set started_at = now() - interval '5 hours'
where assignment_id = 'd1a0e7e5-0000-4000-8000-000000000008';
select set_config('app.privileged_write', 'off', true);

-- Knowledge checks: fail one, then retry it, with no cap and nobody's permission.
select lives_ok(
  $$
    select pg_temp.take_quiz(q.id, 0)
    from public.quizzes q
    join public.course_blocks cb on cb.id = q.course_block_id
    join public.course_assignments ca on ca.course_version_id = cb.course_version_id
    where ca.id = 'd1a0e7e5-0000-4000-8000-000000000008'
      and q.quiz_kind = 'knowledge_check'
    order by cb.sort_order
    limit 1
  $$,
  'a knowledge check can be failed'
);

select lives_ok(
  $$
    select pg_temp.take_quiz(q.id, (select count(*)::integer from public.quiz_questions where quiz_id = q.id))
    from public.quizzes q
    join public.course_blocks cb on cb.id = q.course_block_id
    join public.course_assignments ca on ca.course_version_id = cb.course_version_id
    where ca.id = 'd1a0e7e5-0000-4000-8000-000000000008'
      and q.quiz_kind = 'knowledge_check'
    order by cb.sort_order
    limit 1
  $$,
  'and retried immediately, with no attempt cap and no administrator step'
);

-- Now pass every knowledge check.
do $$
declare
  v_quiz record;
begin
  for v_quiz in
    select q.id, (select count(*)::integer from public.quiz_questions qq where qq.quiz_id = q.id) as total
    from public.quizzes q
    join public.course_blocks cb on cb.id = q.course_block_id
    join public.course_assignments ca on ca.course_version_id = cb.course_version_id
    where ca.id = 'd1a0e7e5-0000-4000-8000-000000000008'
      and q.quiz_kind = 'knowledge_check'
      and not exists (
        select 1 from public.quiz_attempts a
        where a.assignment_id = ca.id and a.quiz_id = q.id and a.passed
      )
  loop
    perform pg_temp.take_quiz(v_quiz.id, v_quiz.total);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- The examination: 26 fails, 27 passes, retries are unlimited
-- ---------------------------------------------------------------------------

create temporary table exam_quiz on commit drop as
select q.id
from public.quizzes q
join public.course_blocks cb on cb.id = q.course_block_id
join public.course_assignments ca on ca.course_version_id = cb.course_version_id
where ca.id = 'd1a0e7e5-0000-4000-8000-000000000008' and q.quiz_kind = 'final_exam';

-- Each attempt is taken in its own statement: a volatile function called inside a SELECT's WHERE
-- clause runs under that statement's snapshot, so the row it inserts would be invisible to the
-- very query trying to read it back.
create temporary table exam_attempts (label text primary key, id uuid) on commit drop;

insert into exam_attempts values ('fail_26', pg_temp.take_quiz((select id from exam_quiz), 26));

select results_eq(
  $$
    select passed, score_percent::text
    from public.quiz_attempts
    where id = (select id from exam_attempts where label = 'fail_26')
  $$,
  $$ values (false, '86.67'::text) $$,
  '26 of 30 does not pass'
);

insert into exam_attempts values ('fail_20', pg_temp.take_quiz((select id from exam_quiz), 20));

select results_eq(
  $$
    select passed, score_percent::text
    from public.quiz_attempts
    where id = (select id from exam_attempts where label = 'fail_20')
  $$,
  $$ values (false, '66.67'::text) $$,
  'a second failed attempt is allowed immediately, with no lockout and no remediation state'
);

-- Certificate issuance is blocked while the examination is unpassed, whatever else is done.
select throws_ok(
  $$ select public.complete_course_assignment('d1a0e7e5-0000-4000-8000-000000000008') $$,
  '23514',
  null,
  'no certificate is issued while the examination is below the passing score'
);

insert into exam_attempts values ('pass_27', pg_temp.take_quiz((select id from exam_quiz), 27));

select results_eq(
  $$
    select passed, score_percent::text, passing_score_percent_at_attempt
    from public.quiz_attempts
    where id = (select id from exam_attempts where label = 'pass_27')
  $$,
  $$ values (true, '90.00'::text, 90) $$,
  '27 of 30 passes at exactly 90 percent, judged against the threshold stamped on the attempt'
);

select results_eq(
  $$
    select count(*)::integer, count(*) filter (where passed = false)::integer
    from public.quiz_attempts qa
    where qa.assignment_id = 'd1a0e7e5-0000-4000-8000-000000000008'
      and qa.quiz_id = (select id from exam_quiz)
  $$,
  $$ values (3, 2) $$,
  'every examination attempt is preserved -- unlimited retries never deletes an earlier one'
);

-- ---------------------------------------------------------------------------
-- Attestation and automatic issuance
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.complete_course_assignment('d1a0e7e5-0000-4000-8000-000000000008') $$,
  '23514',
  null,
  'the examination alone does not complete the course -- the attestation is still required'
);

select lives_ok(
  $$
    select public.record_course_attestation(
      'd1a0e7e5-0000-4000-8000-000000000008',
      (select cb.id
       from public.course_blocks cb
       join public.course_assignments ca on ca.course_version_id = cb.course_version_id
       where ca.id = 'd1a0e7e5-0000-4000-8000-000000000008' and cb.block_type = 'attestation')
    )
  $$,
  'the learner signs the attestation themselves'
);

select ok(
  (
    -- Derived from the version the learner was actually assigned rather than pinned to a literal:
    -- the claim is that the stored statement and version come from the published block, and
    -- hardcoding a version number tests the catalog's current contents instead of that mechanism.
    select la.attestation_text like 'I attest that I personally completed this training%'
       and la.attestation_version = 'PA-PCH-DIABETES-ANNUAL-' || cv.version_label
    from public.course_learner_attestations la
    join public.course_assignments ca on ca.id = la.course_assignment_id
    join public.course_versions cv on cv.id = ca.course_version_id
    where la.course_assignment_id = 'd1a0e7e5-0000-4000-8000-000000000008'
  ),
  'the signed statement and its version are stored from the published block, not from the client'
);

-- Finish the modules: 100 percent, the final step reached, and a written applied response on
-- every scenario and practice step, which is what the comprehensive standard asks a learner for.
update public.course_progress
set percent_complete = 100,
    last_block_id = (
      select cb.id from public.course_blocks cb
      join public.course_assignments ca on ca.course_version_id = cb.course_version_id
      where ca.id = 'd1a0e7e5-0000-4000-8000-000000000008'
      order by cb.sort_order desc, cb.id desc limit 1
    ),
    learning_tools = jsonb_build_object(
      'notes',
      (
        select coalesce(jsonb_object_agg(cb.id::text, repeat('Applied response for this step. ', 4)), '{}'::jsonb)
        from public.course_blocks cb
        join public.course_assignments ca on ca.course_version_id = cb.course_version_id
        where ca.id = 'd1a0e7e5-0000-4000-8000-000000000008'
          and cb.body ->> 'activity_type' in ('scenario', 'practice')
      ),
      'confidence', '{}'::jsonb
    )
where assignment_id = 'd1a0e7e5-0000-4000-8000-000000000008';

select lives_ok(
  $$ select public.complete_course_assignment('d1a0e7e5-0000-4000-8000-000000000008') $$,
  'with modules, knowledge checks, examination and attestation done, the course completes'
);

select results_eq(
  $$ select status from public.course_assignments where id = 'd1a0e7e5-0000-4000-8000-000000000008' $$,
  array['completed'],
  'course status is COMPLETE with no educator review in between'
);

select results_eq(
  $$ select count(*)::integer from public.certificates
     where course_assignment_id = 'd1a0e7e5-0000-4000-8000-000000000008' $$,
  array[1],
  'the certificate is issued automatically in the same transaction'
);

select results_eq(
  $$ select count(*)::integer from public.competency_records
     where employee_id = 'd1a0e7e5-0000-4000-8000-000000000005' $$,
  array[0],
  'the certificate was issued with no competency record -- no skills demonstration was required'
);

-- ---------------------------------------------------------------------------
-- Annual renewal
-- ---------------------------------------------------------------------------

select ok(
  (
    select (cert.expires_at at time zone 'America/New_York')::date
         = ((ca.completed_at at time zone 'America/New_York')::date + 365)
    from public.certificates cert
    join public.course_assignments ca on ca.id = cert.course_assignment_id
    where ca.id = 'd1a0e7e5-0000-4000-8000-000000000008'
  ),
  'the certificate expires twelve months after completion'
);

select ok(
  (
    select r.status = 'compliant'
       and r.due_date = r.completion_date + 365
       and r.score = 90.00
       and r.certificate_number is not null
       and r.trainer_credentials = 'CDCES'
    from public.employee_training_records r
    join public.training_types tt on tt.id = r.training_type_id
    where r.employee_id = 'd1a0e7e5-0000-4000-8000-000000000005'
      and tt.code = 'DIABETES-EDU'
  ),
  'the annual requirement records the completion, examination score, credential and renewal date'
);

-- ---------------------------------------------------------------------------
-- Audit trail, historical versioning, tenant isolation
-- ---------------------------------------------------------------------------

reset role;

select ok(
  (
    select count(*) > 0
    from public.audit_logs
    where entity_type = 'course_learner_attestations'
      and organization_id = 'd1a0e7e5-0000-4000-8000-000000000001'
  ),
  'the attestation is written to the existing audit trail'
);

select pg_temp.act_as('d1a0e7e5-0000-4000-8000-000000000003');

select ok(
  (
    -- What has to hold is that every piece of evidence names ONE version -- the one the learner
    -- was assigned -- not that the version is any particular number. Pinning the number made this
    -- fail the moment v2026.2 published, which is drift in the test, not in the binding.
    select cv.status = 'published'
       and cv.course_id = c.id
       and la.attestation_version = 'PA-PCH-DIABETES-ANNUAL-' || cv.version_label
    from public.course_assignments ca
    join public.course_versions cv on cv.id = ca.course_version_id
    join public.courses c on c.id = ca.course_id
    join public.course_learner_attestations la on la.course_assignment_id = ca.id
    where ca.id = 'd1a0e7e5-0000-4000-8000-000000000008'
  ),
  'the completion stays bound to the exact course version it was taken against'
);

select results_eq(
  $$
    select count(*)::integer
    from public.get_employee_diabetes_training_history('d1a0e7e5-0000-4000-8000-000000000005')
  $$,
  array[1],
  'the employee training history exposes the annual completion'
);

select ok(
  (
    select (public.generate_diabetes_training_compliance_report(
      'd1a0e7e5-0000-4000-8000-000000000002', null, null, 100, 0
    ) ->> 'totalRows')::integer >= 1
  ),
  'the PA PCH Diabetes Training Compliance Report returns the learner'
);

-- A sandbox assignment must not be able to hide a real one. This learner's newest assignment is
-- in a sandbox facility the report never displays; if recency were ranked before that facility
-- set was narrowed, the sandbox row would win and the display join would then drop the employee
-- entirely -- a compliance report quietly reporting nobody to chase.
insert into public.facilities
  (id, organization_id, name, facility_type, state, is_sandbox, sandbox_seed_version) values
  ('d1a0e7e5-0000-4000-8000-000000000012', 'd1a0e7e5-0000-4000-8000-000000000001',
   'Diabetes Sandbox PCH', 'PCH', 'PA', true, 1);

insert into public.course_assignments (
  id, organization_id, facility_id, employee_id, course_id, course_version_id, assigned_by,
  assigned_at
)
select
  'd1a0e7e5-0000-4000-8000-000000000013',
  'd1a0e7e5-0000-4000-8000-000000000001',
  'd1a0e7e5-0000-4000-8000-000000000012',
  'd1a0e7e5-0000-4000-8000-000000000005',
  c.id,
  c.current_version_id,
  'd1a0e7e5-0000-4000-8000-000000000003',
  now() + interval '1 day'
from public.courses c
where c.catalog_code = 'PA-PCH-DIABETES-ANNUAL';

select ok(
  (
    select (public.generate_diabetes_training_compliance_report(null, null, null, 100, 0)
      ->> 'totalRows')::integer >= 1
  ),
  'and a newer sandbox assignment does not hide the learner from the all-facilities view'
);

reset role;
select pg_temp.act_as('d1a0e7e5-0000-4000-8000-0000000000f3');

select results_eq(
  $$
    select count(*)::integer from public.course_learner_attestations
    where course_assignment_id = 'd1a0e7e5-0000-4000-8000-000000000008'
  $$,
  array[0],
  'another organization cannot read this learner attestation'
);

select results_eq(
  $$
    select count(*)::integer from public.certificates
    where course_assignment_id = 'd1a0e7e5-0000-4000-8000-000000000008'
  $$,
  array[0],
  'another organization cannot read this certificate'
);

select is(
  (
    select (public.generate_diabetes_training_compliance_report(null, null, null, 100, 0)
      ->> 'totalRows')::integer
  ),
  0,
  'and the compliance report shows them nothing from the other tenant'
);

reset role;
select * from finish();
rollback;
