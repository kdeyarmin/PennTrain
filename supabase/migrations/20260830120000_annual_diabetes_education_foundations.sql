-- Foundations for an asynchronous annual course that ends in an automatic certificate.
--
-- The PA Personal Care Home annual diabetes education course (55 Pa. Code Section 2600.190(b)
-- and (c)) is an ASYNCHRONOUS course: the learner works through it alone, passes a written
-- final examination, signs an attestation, and the certificate issues automatically. There is
-- no recorded skills competency, no video submission, and no educator review after completion.
-- Four capabilities the existing LMS did not have are what this migration adds, all of them
-- general rather than diabetes-specific:
--
--   1. A learner attestation step ('attestation' course block + course_learner_attestations),
--      so a course can require a signed statement before it completes.
--   2. Per-quiz behavior flags (quiz_kind, shuffle_questions, shuffle_answers,
--      reveals_answers_after_attempt) so one course version can carry both short module
--      knowledge checks with immediate feedback and a randomized final examination.
--   3. A renewal bridge (courses.renewal_training_type_id) that advances an employee's
--      recurring training requirement on completion. Unlike the legacy courses.training_type_id
--      bridge -- which the individual-catalog contract forbids for cataloged courses
--      (comprehensive_annual_course_catalog.test.sql) -- and unlike course_compliance_credits,
--      which credits annual HOURS, this records the renewal CLOCK for a requirement whose
--      required_hours is zero.
--   4. Training-provider metadata (course_provider_profiles) recorded for regulatory
--      documentation, editable by an authorized administrator, and deliberately NOT a
--      publication gate.
--
-- Nothing here changes an existing published course. Every column is additive with a default
-- that reproduces today's behavior.

-- ---------------------------------------------------------------------------
-- 1. Attestation blocks
-- ---------------------------------------------------------------------------

alter table public.course_blocks
  drop constraint course_blocks_block_type_check;
alter table public.course_blocks
  add constraint course_blocks_block_type_check
  check (block_type in ('text', 'video', 'pdf', 'scorm', 'quiz', 'attestation'));

comment on column public.course_blocks.block_type is
  'text/video/pdf/scorm/quiz deliver content; attestation asks the learner to sign a statement stored in body->>attestation_text at body->>attestation_version, and blocks completion until they do.';

create table public.course_learner_attestations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  course_assignment_id uuid not null references public.course_assignments(id) on delete cascade,
  course_id uuid not null references public.courses(id),
  course_version_id uuid not null references public.course_versions(id),
  course_block_id uuid not null references public.course_blocks(id),
  attestation_version text not null,
  attestation_text text not null check (length(btrim(attestation_text)) >= 40),
  attested_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint course_learner_attestations_assignment_block_uk
    unique (course_assignment_id, course_block_id)
);

comment on table public.course_learner_attestations is
  'One signed learner attestation per assignment and attestation block. The exact statement text and its version are copied in at signing time so a later course revision cannot rewrite what a learner actually attested to.';

create index course_learner_attestations_employee_idx
  on public.course_learner_attestations(employee_id, attested_at desc);
create index course_learner_attestations_org_idx
  on public.course_learner_attestations(organization_id, attested_at desc);

alter table public.course_learner_attestations enable row level security;

-- Read follows the same shape as quiz_attempts: the learner who signed, staff assigned to the
-- facility, org admins and auditors. There is deliberately NO client write policy -- signing
-- goes through record_course_attestation(), which copies the statement from the published
-- block rather than trusting text sent by the browser.
create policy course_learner_attestations_select
  on public.course_learner_attestations for select to authenticated
  using (
    (select public.is_platform_admin())
    or public.owns_employee(employee_id)
    or (
      organization_id = (select public.current_org_id())
      and (
        (select public."current_role"()) in ('org_admin', 'auditor')
        or public.is_assigned_to_facility(facility_id)
      )
    )
  );

revoke all on table public.course_learner_attestations from public, anon, authenticated;
grant select on table public.course_learner_attestations to authenticated;
grant all on table public.course_learner_attestations to service_role;

create trigger audit_log
  after insert or update or delete on public.course_learner_attestations
  for each row execute function public.audit_log_trigger();

-- ---------------------------------------------------------------------------
-- 2. Per-quiz behavior
-- ---------------------------------------------------------------------------

alter table public.quizzes
  add column quiz_kind text not null default 'assessment'
    constraint quizzes_quiz_kind_check
    check (quiz_kind in ('assessment', 'knowledge_check', 'final_exam')),
  add column shuffle_questions boolean not null default false,
  add column shuffle_answers boolean not null default false,
  add column reveals_answers_after_attempt boolean not null default false;

comment on column public.quizzes.quiz_kind is
  'assessment is the historical single end-of-course quiz. knowledge_check is a short in-module check that does not contribute to a final examination score. final_exam is the graded examination whose score appears on the certificate and the regulatory training record.';
comment on column public.quizzes.reveals_answers_after_attempt is
  'When true, get_quiz_review() returns the correct answer and explanation to the learner after any graded attempt. Intended for formative knowledge checks with immediate feedback; leave false for a scored examination so retakes still test recall.';

-- A knowledge check whose whole purpose is immediate feedback must not also be the place a
-- learner harvests the examination answer key, so the flag is confined to knowledge checks.
alter table public.quizzes
  add constraint quizzes_immediate_reveal_is_formative_check
  check (not reveals_answers_after_attempt or quiz_kind = 'knowledge_check');

alter table public.quiz_questions
  add column topic_code text
    constraint quiz_questions_topic_code_check
    check (topic_code is null or topic_code ~ '^[A-Z0-9][A-Z0-9._-]*$'),
  add column topic_label text;

comment on column public.quiz_questions.topic_code is
  'Stable machine-readable content area for a question, so a failed attempt can report which areas to review without revealing which answer was right.';
comment on column public.quiz_questions.topic_label is
  'Learner-facing name of the content area named by topic_code, e.g. the module title it was drawn from.';

-- An attempt has to record the threshold it was judged against, not merely point at the quiz. A
-- passing score is configurable (and every change to one is audited below), so an attempt row that
-- resolved its threshold through quizzes.passing_score_percent would silently restate history the
-- next time an administrator moved it -- a 2026 attempt reading as a pass or a fail under a 2027
-- rule. Stamped at insert and used by grading, so the number in the row is the number that decided.
alter table public.quiz_attempts
  add column passing_score_percent_at_attempt integer
    constraint quiz_attempts_passing_score_at_attempt_check
    check (passing_score_percent_at_attempt is null
           or passing_score_percent_at_attempt between 0 and 100);

comment on column public.quiz_attempts.passing_score_percent_at_attempt is
  'The passing threshold in effect when this attempt was started, copied from the quiz. Null on attempts that predate this column; grading falls back to the quiz''s current value for those.';

create or replace function public.stamp_quiz_attempt_passing_score()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  select q.passing_score_percent into new.passing_score_percent_at_attempt
  from public.quizzes q
  where q.id = new.quiz_id;
  return new;
end;
$function$;

revoke all on function public.stamp_quiz_attempt_passing_score()
  from public, anon, authenticated, service_role;

create trigger stamp_quiz_attempt_passing_score
  before insert on public.quiz_attempts
  for each row execute function public.stamp_quiz_attempt_passing_score();

-- Backfill is deliberate and lossless in the only direction it can be: for existing attempts the
-- quiz's current threshold is the only threshold there has ever been, because nothing could change
-- one before this migration and the audit trigger below.
update public.quiz_attempts qa
set passing_score_percent_at_attempt = q.passing_score_percent
from public.quizzes q
where q.id = qa.quiz_id and qa.passing_score_percent_at_attempt is null;

-- Grading judges an attempt against the threshold stamped on it, falling back to the quiz only if
-- the stamp is somehow absent. Everything else about this function is unchanged from
-- 20260806040000_training_and_quiz_writers_stay_in_facility.sql.
create or replace function public.grade_quiz_attempt(p_attempt_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare
  v_quiz_id uuid;
  v_org uuid;
  v_emp uuid;
  v_facility uuid;
  v_pass integer;
  v_stamped integer;
  v_score numeric;
  v_submitted_at timestamptz;
  v_is_reviewer boolean;
begin
  select quiz_id, organization_id, employee_id, facility_id, submitted_at,
         passing_score_percent_at_attempt
    into v_quiz_id, v_org, v_emp, v_facility, v_submitted_at, v_stamped
  from public.quiz_attempts where id = p_attempt_id;
  if v_quiz_id is null then
    raise exception 'attempt % not found', p_attempt_id using errcode = 'no_data_found';
  end if;

  v_is_reviewer := public.is_platform_admin()
    or (
      v_org = public.current_org_id()
      and public.current_role() in ('org_admin','facility_manager','trainer')
      and public.is_assigned_to_facility(v_facility)
    );

  if not (v_is_reviewer or public.owns_employee(v_emp)) then
    raise exception 'not authorized' using errcode = 'insufficient_privilege';
  end if;

  if v_submitted_at is not null and not v_is_reviewer then
    raise exception 'quiz attempt % has already been submitted and graded', p_attempt_id
      using errcode = 'check_violation';
  end if;

  select coalesce(v_stamped, q.passing_score_percent) into v_pass
  from public.quizzes q where q.id = v_quiz_id;
  perform set_config('app.privileged_write', 'on', true);

  update public.quiz_attempt_answers aa
     set is_correct = (
       (select coalesce(array_agg(distinct a.id order by a.id), '{}'::uuid[])
          from public.quiz_answers a where a.question_id = aa.question_id and a.is_correct)
       =
       (select coalesce(array_agg(distinct x order by x), '{}'::uuid[])
          from unnest(aa.selected_answer_ids) as x)
       and exists (select 1 from public.quiz_answers a2
                    where a2.question_id = aa.question_id and a2.is_correct)
     )
   where aa.attempt_id = p_attempt_id;

  select round(
           100.0 * coalesce((
             select sum(q.points)
               from public.quiz_attempt_answers aa
               join public.quiz_questions q on q.id = aa.question_id
              where aa.attempt_id = p_attempt_id and aa.is_correct
           ), 0)
           / nullif((select sum(q2.points) from public.quiz_questions q2 where q2.quiz_id = v_quiz_id), 0),
           2)
    into v_score;
  v_score := coalesce(v_score, 0);

  update public.quiz_attempts
     set score_percent = v_score,
         passed        = (v_score >= v_pass),
         submitted_at  = coalesce(submitted_at, now())
   where id = p_attempt_id;
end;
$function$;

revoke all on function public.grade_quiz_attempt(uuid) from public, anon;
grant execute on function public.grade_quiz_attempt(uuid) to authenticated;

-- version_number is the ordinal the schema already enforces uniqueness on; a course catalog also
-- needs the label a certificate and an inspection report print ("2026.1"), and that label has to
-- stay attached to the exact version a historical completion was taken against.
alter table public.course_versions
  add column version_label text;

comment on column public.course_versions.version_label is
  'Human-readable published version identifier such as 2026.1, printed on certificates and regulatory training records. Null falls back to v<version_number>.';

-- ---------------------------------------------------------------------------
-- 3. Immediate feedback on formative knowledge checks
-- ---------------------------------------------------------------------------
--
-- get_quiz_review() previously withheld the key from a learner until they passed or ran out of
-- attempts. That is right for an examination and wrong for a knowledge check, where explaining
-- the answer IS the teaching. The examination branch is unchanged: an unlimited-attempt exam
-- never reaches "attempts exhausted", so an exam key stays hidden until the learner passes.
create or replace function public.get_quiz_review(p_attempt_id uuid)
returns table(question_id uuid, answer_id uuid, answer_text text, is_correct boolean, explanation text)
language sql stable security definer set search_path to 'public' as $function$
  with target as (
    select att.id, att.employee_id, att.organization_id, att.facility_id, att.passed, att.submitted_at,
           att.assignment_id, att.quiz_id, qz.max_attempts, qz.reveals_answers_after_attempt
    from public.quiz_attempts att
    join public.quizzes qz on qz.id = att.quiz_id
    where att.id = p_attempt_id
  ),
  attempt_count as (
    select count(*) as used
    from public.quiz_attempts a2
    join target t on a2.assignment_id = t.assignment_id and a2.quiz_id = t.quiz_id
    where a2.submitted_at is not null
  )
  select a.question_id, a.id, a.answer_text, a.is_correct, qe.explanation
  from public.quiz_answers a
  join public.quiz_questions q on q.id = a.question_id
  left join public.quiz_question_explanations qe on qe.question_id = q.id
  join target t on q.quiz_id = t.quiz_id
  cross join attempt_count ac
  where t.submitted_at is not null
    and (
      public.is_platform_admin()
      or (
        t.organization_id = public.current_org_id()
        and public.current_role() in ('org_admin', 'facility_manager', 'trainer')
        and public.is_assigned_to_facility(t.facility_id)
      )
      or (
        public.owns_employee(t.employee_id)
        and (
          t.passed = true
          or t.reveals_answers_after_attempt
          or (t.max_attempts is not null and ac.used >= t.max_attempts)
        )
      )
    )
  order by a.sort_order;
$function$;

revoke execute on function public.get_quiz_review(uuid) from public;
revoke execute on function public.get_quiz_review(uuid) from anon;
grant execute on function public.get_quiz_review(uuid) to authenticated;

-- Which content areas a failed examination attempt should send the learner back to. Returns
-- counts only -- never which question, never which answer -- so it is safe to show after a
-- failed attempt on an unlimited-retry examination.
create or replace function public.get_quiz_attempt_topic_review(p_attempt_id uuid)
returns table(topic_code text, topic_label text, questions integer, incorrect integer)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with target as (
    select att.id, att.employee_id, att.organization_id, att.facility_id, att.submitted_at
    from public.quiz_attempts att
    where att.id = p_attempt_id
  )
  select
    coalesce(q.topic_code, 'GENERAL')::text,
    coalesce(q.topic_label, 'Course content')::text,
    count(*)::integer,
    count(*) filter (where aa.is_correct is not true)::integer
  from public.quiz_attempt_answers aa
  join public.quiz_questions q on q.id = aa.question_id
  join target t on true
  where aa.attempt_id = p_attempt_id
    and t.submitted_at is not null
    and (
      public.is_platform_admin()
      or public.owns_employee(t.employee_id)
      or (
        t.organization_id = public.current_org_id()
        and public.current_role() in ('org_admin', 'facility_manager', 'trainer', 'auditor')
        and public.is_assigned_to_facility(t.facility_id)
      )
    )
  group by coalesce(q.topic_code, 'GENERAL'), coalesce(q.topic_label, 'Course content')
  order by 4 desc, 2;
$function$;

comment on function public.get_quiz_attempt_topic_review(uuid) is
  'Per-content-area right/wrong counts for one graded attempt. Reveals no question text and no answer key, so a learner can be told what to review after a failed attempt on an unlimited-retry examination.';

revoke all on function public.get_quiz_attempt_topic_review(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_quiz_attempt_topic_review(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Recording an attestation
-- ---------------------------------------------------------------------------

create or replace function public.record_course_attestation(
  p_assignment_id uuid,
  p_block_id uuid
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_assignment public.course_assignments%rowtype;
  v_block public.course_blocks%rowtype;
  v_text text;
  v_version text;
  v_id uuid;
begin
  select * into v_assignment from public.course_assignments where id = p_assignment_id;
  if v_assignment.id is null then
    raise exception 'assignment % not found', p_assignment_id using errcode = 'no_data_found';
  end if;

  -- Only the learner signs. An administrator cannot attest on someone else's behalf: the whole
  -- point of the statement is that the person who took the training is making it.
  if not public.owns_employee(v_assignment.employee_id) then
    raise exception 'only the assigned learner can sign this attestation'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_block from public.course_blocks where id = p_block_id;
  if v_block.id is null or v_block.course_version_id is distinct from v_assignment.course_version_id then
    raise exception 'attestation step % does not belong to this training assignment', p_block_id
      using errcode = 'check_violation';
  end if;

  if v_block.block_type <> 'attestation' then
    raise exception 'course step % is not an attestation step', p_block_id
      using errcode = 'check_violation';
  end if;

  v_text := btrim(coalesce(v_block.body ->> 'attestation_text', ''));
  v_version := btrim(coalesce(v_block.body ->> 'attestation_version', ''));
  if length(v_text) < 40 or v_version = '' then
    raise exception 'attestation step % has no published statement to sign', p_block_id
      using errcode = 'check_violation';
  end if;

  -- The signature is the act, not the text: the statement and its version are copied from the
  -- published (immutable) course block rather than accepted from the caller.
  insert into public.course_learner_attestations (
    organization_id, facility_id, employee_id, course_assignment_id,
    course_id, course_version_id, course_block_id,
    attestation_version, attestation_text
  )
  values (
    v_assignment.organization_id,
    v_assignment.facility_id,
    v_assignment.employee_id,
    v_assignment.id,
    v_assignment.course_id,
    v_assignment.course_version_id,
    v_block.id,
    v_version,
    v_text
  )
  on conflict (course_assignment_id, course_block_id) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id
    from public.course_learner_attestations
    where course_assignment_id = p_assignment_id and course_block_id = p_block_id;
  end if;

  return v_id;
end;
$function$;

comment on function public.record_course_attestation(uuid, uuid) is
  'Records the assigned learner signing one attestation step, copying the statement text and version from the published course block. Idempotent: re-signing returns the original signature rather than restating it.';

revoke all on function public.record_course_attestation(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.record_course_attestation(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. The renewal bridge
-- ---------------------------------------------------------------------------

alter table public.courses
  add column renewal_training_type_id uuid references public.training_types(id);

comment on column public.courses.renewal_training_type_id is
  'Recurring requirement whose renewal clock a completion of this course restarts. Distinct from training_type_id (the legacy all-in-one hours bridge, which cataloged courses must not use) and from course_compliance_credits (annual HOURS credit): this records the completion date, examination score, and certificate number against a requirement whose required_hours may be zero, and lets recalculate_compliance_core derive due_date, status, and the existing due-soon/overdue alert ladder without a second notification framework.';

create index courses_renewal_training_type_idx
  on public.courses(renewal_training_type_id)
  where renewal_training_type_id is not null;

-- Insulin handling is a per-employee fact this schema did not record. Without it the annual
-- diabetes requirement could only be all-staff or nobody: 20260706181350 removed
-- applies_to_administers_meds from DIABETES-EDU precisely because it was creating a permanent
-- missing shell for every medication-administration employee, most of whom never touch insulin.
alter table public.employees
  add column administers_insulin boolean not null default false;

comment on column public.employees.administers_insulin is
  'Employer-recorded fact that this employee administers insulin or provides diabetes-related care, gating the annual diabetes education requirement. Defaults to false so no employee is auto-assigned until an administrator says so.';

alter table public.training_types
  add column applies_to_administers_insulin boolean not null default false;

comment on column public.training_types.applies_to_administers_insulin is
  'When true, this requirement is instantiated only for employees whose administers_insulin flag is set, the same way applies_to_administers_meds narrows to medication-administration staff.';

update public.training_types
set applies_to_administers_insulin = true,
    description = 'Required within the past 12 months for staff who administer insulin or provide diabetes-related care.',
    citation_note = '55 Pa. Code Section 2600.190(b) and (c) -- diabetes patient education program completed within the preceding 12 months before a staff person may administer insulin, and annually thereafter. Configurable sample, not legal advice.'
where code = 'DIABETES-EDU' and organization_id is null;

create or replace function public.instantiate_missing_requirements(p_employee_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_emp record;
begin
  select e.id, e.organization_id, e.facility_id, e.status, e.administers_medications,
         e.administers_insulin, e.trainer_status,
         f.facility_type, coalesce(f.state, 'PA') as facility_state
    into v_emp
  from public.employees e
  join public.facilities f on f.id = e.facility_id
  where e.id = p_employee_id;

  if v_emp.id is null or v_emp.status <> 'active' then
    return;
  end if;

  insert into public.employee_training_records (
    organization_id,
    facility_id,
    employee_id,
    training_type_id,
    status,
    document_required
  )
  select
    v_emp.organization_id,
    v_emp.facility_id,
    v_emp.id,
    tt.id,
    case when tt.audience_verification_required then 'pending_review' else 'missing' end,
    tt.document_required
  from public.training_types tt
  where tt.is_active
    and tt.state = v_emp.facility_state
    and (tt.organization_id is null or tt.organization_id = v_emp.organization_id)
    and (tt.applies_to_facility_type = 'BOTH' or tt.applies_to_facility_type = v_emp.facility_type)
    and (coalesce(tt.applies_to_administers_meds, false) = false or v_emp.administers_medications)
    and (coalesce(tt.applies_to_administers_insulin, false) = false or v_emp.administers_insulin)
    and (coalesce(tt.applies_to_trainers, false) = false or v_emp.trainer_status)
    and not exists (
      select 1
      from public.employee_training_records r
      where r.employee_id = v_emp.id
        and r.training_type_id = tt.id
    );

  if v_emp.administers_medications then
    insert into public.practicums (
      organization_id,
      facility_id,
      employee_id,
      practicum_year,
      status
    )
    select
      v_emp.organization_id,
      v_emp.facility_id,
      v_emp.id,
      extract(year from public.pa_today())::integer,
      'missing'
    where not exists (
      select 1
      from public.practicums p
      where p.employee_id = v_emp.id
        and p.practicum_year = extract(year from public.pa_today())::integer
    );
  end if;

  insert into public.employee_credentials (
    organization_id,
    facility_id,
    employee_id,
    credential_type,
    status
  )
  select
    v_emp.organization_id,
    v_emp.facility_id,
    v_emp.id,
    ct.credential_type,
    'missing'
  from (values ('act34_criminal_history'), ('tb_screening')) as ct(credential_type)
  where not exists (
    select 1
    from public.employee_credentials c
    where c.employee_id = v_emp.id
      and c.credential_type = ct.credential_type
  );
end;
$function$;

revoke all on function public.instantiate_missing_requirements(uuid)
  from public, anon, authenticated, service_role;

-- The gate above is only half the wiring. instantiate_missing_requirements() now narrows on
-- administers_insulin, but the trigger that CALLS it on an employee edit listed only facility,
-- medication-administration, trainer and status as the signals worth reacting to. Flagging an
-- existing employee -- the ordinary case, since insulin duties are assigned to people already on
-- the roster far more often than to new hires -- would therefore change the flag and instantiate
-- nothing, and the requirement would appear only whenever some unrelated field happened to move.
-- A legally targeted staff member would be missing from every compliance view until then.
create or replace function public.trigger_instantiate_requirements_on_employee_change()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if tg_op = 'INSERT' then
    perform public.instantiate_missing_requirements(new.id);
  elsif tg_op = 'UPDATE' and (
    new.facility_id is distinct from old.facility_id
    or new.administers_medications is distinct from old.administers_medications
    or new.administers_insulin is distinct from old.administers_insulin
    or new.trainer_status is distinct from old.trainer_status
    or (new.status = 'active' and old.status is distinct from 'active')
  ) then
    perform public.instantiate_missing_requirements(new.id);
  end if;
  return new;
end;
$function$;

revoke all on function public.trigger_instantiate_requirements_on_employee_change()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Training provider / clinical review metadata
-- ---------------------------------------------------------------------------

create table public.course_provider_profiles (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null unique references public.courses(id) on delete cascade,
  provider_full_name text not null check (length(btrim(provider_full_name)) > 0),
  professional_title text,
  credential text,
  credential_number text,
  credential_issuing_organization text,
  credential_expires_on date,
  course_author text,
  provider_signature_name text,
  provider_signature_recorded_at timestamptz,
  content_version text,
  last_clinical_review_date date,
  reviewed_by text,
  next_review_due date,
  regulation_review_date date,
  review_notes text,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint course_provider_profiles_review_window_check
    check (
      last_clinical_review_date is null
      or next_review_due is null
      or next_review_due >= last_clinical_review_date
    ),
  constraint course_provider_profiles_signature_pairing_check
    check ((provider_signature_name is null) = (provider_signature_recorded_at is null))
);

comment on table public.course_provider_profiles is
  'Training-provider and clinical-review metadata for a course, recorded for regulatory documentation and printed on the certificate. Deliberately NOT a publication gate: a course is active or archived on courses.status alone, and an out-of-date review here never blocks assignment or completion.';
comment on column public.course_provider_profiles.next_review_due is
  'Maintenance date only. A past date surfaces a review reminder to administrators; it does not withdraw the course or block a learner.';

alter table public.course_provider_profiles enable row level security;

-- Readable by any authenticated user who can already see the course -- the provider's name and
-- credential appear on the learner's own certificate, so hiding it from them would be strange.
-- Writable only by platform_admin, which is the role that authors courses at all
-- (20260705203242_restrict_course_authoring_to_platform_admin.sql).
create policy course_provider_profiles_select
  on public.course_provider_profiles for select to authenticated
  using (
    exists (
      select 1
      from public.courses c
      where c.id = course_provider_profiles.course_id
        and (
          (select public.is_platform_admin())
          or c.organization_id is null
          or c.organization_id = (select public.current_org_id())
        )
    )
  );

-- Three write policies rather than one `for all`: a `for all` policy is also a SELECT policy, and
-- a second permissive SELECT policy on the same table and role costs a policy evaluation on every
-- read for no behavioral gain -- platform_admin already passes the select policy above.
create policy course_provider_profiles_insert
  on public.course_provider_profiles for insert to authenticated
  with check ((select public.is_platform_admin()));

create policy course_provider_profiles_update
  on public.course_provider_profiles for update to authenticated
  using ((select public.is_platform_admin()))
  with check ((select public.is_platform_admin()));

create policy course_provider_profiles_delete
  on public.course_provider_profiles for delete to authenticated
  using ((select public.is_platform_admin()));

revoke all on table public.course_provider_profiles from public, anon, authenticated;
grant select, insert, update, delete on table public.course_provider_profiles to authenticated;
grant all on table public.course_provider_profiles to service_role;

create trigger set_updated_at before update on public.course_provider_profiles
  for each row execute function public.set_updated_at();

-- audit_log_trigger() reads new.organization_id, which a course-scoped catalog row does not
-- have; the owning course's organization (null for the system catalog) is the honest value.
create or replace function public.audit_course_provider_profile()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_org uuid;
  v_action text;
begin
  v_action := case tg_op when 'INSERT' then 'created' when 'UPDATE' then 'updated' else 'deleted' end;
  select c.organization_id into v_org
  from public.courses c
  where c.id = coalesce(new.course_id, old.course_id);

  insert into public.audit_logs (
    organization_id, actor_profile_id, entity_type, entity_id, action, old_values, new_values
  )
  values (
    v_org,
    auth.uid(),
    'course_provider_profiles',
    coalesce(new.id, old.id)::text,
    'course_provider_profiles_' || v_action,
    case when tg_op <> 'INSERT' then to_jsonb(old) else null end,
    case when tg_op <> 'DELETE' then to_jsonb(new) else null end
  );
  return coalesce(new, old);
end;
$function$;

revoke all on function public.audit_course_provider_profile() from public, anon, authenticated, service_role;

create trigger audit_course_provider_profile
  after insert or update or delete on public.course_provider_profiles
  for each row execute function public.audit_course_provider_profile();

create or replace function public.stamp_course_provider_profile_editor()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$function$;

create trigger stamp_course_provider_profile_editor
  before insert or update on public.course_provider_profiles
  for each row execute function public.stamp_course_provider_profile_editor();

-- ---------------------------------------------------------------------------
-- 7. A passing-score change is an audited event
-- ---------------------------------------------------------------------------
--
-- The 90 percent examination threshold is an internal course standard, not a figure Section
-- 2600.190 sets. An administrator may eventually be allowed to move it; whoever does, and to
-- what, has to be reconstructable afterwards -- which is why the record is written here rather
-- than in whichever screen happens to make the change.
create or replace function public.audit_quiz_scoring_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.passing_score_percent is not distinct from old.passing_score_percent
     and new.max_attempts is not distinct from old.max_attempts then
    return new;
  end if;

  insert into public.audit_logs (
    organization_id, actor_profile_id, entity_type, entity_id, action, old_values, new_values
  )
  values (
    new.organization_id,
    auth.uid(),
    'quizzes',
    new.id::text,
    'quiz_scoring_changed',
    jsonb_build_object(
      'passing_score_percent', old.passing_score_percent,
      'max_attempts', old.max_attempts
    ),
    jsonb_build_object(
      'passing_score_percent', new.passing_score_percent,
      'max_attempts', new.max_attempts
    )
  );
  return new;
end;
$function$;

revoke all on function public.audit_quiz_scoring_change() from public, anon, authenticated, service_role;

create trigger audit_quiz_scoring_change
  after update of passing_score_percent, max_attempts on public.quizzes
  for each row execute function public.audit_quiz_scoring_change();

-- ---------------------------------------------------------------------------
-- 8. Completion: attestation gate, certificate expiry, renewal record
-- ---------------------------------------------------------------------------

create or replace function public.complete_course_assignment(p_assignment_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_assignment public.course_assignments%rowtype;
  v_is_self boolean;
  v_was_completed boolean;
  v_course record;
  v_progress record;
  v_record_id uuid;
  v_certificate_id uuid;
  v_certificate_number text;
  v_min_seconds numeric;
  v_expires_at timestamptz;
  v_exam_score numeric;
  v_provider record;
begin
  -- This row lock is the concurrency boundary: only one transaction can transition and
  -- issue for an assignment at a time. Replays wait, then reuse the committed certificate.
  select ca.* into v_assignment
  from public.course_assignments ca
  where ca.id = p_assignment_id
  for update of ca;

  if v_assignment.id is null then
    raise exception 'assignment % not found', p_assignment_id using errcode = 'no_data_found';
  end if;

  v_is_self := public.owns_employee(v_assignment.employee_id);
  if not (
    public.is_platform_admin()
    or (
      v_assignment.organization_id = public.current_org_id()
      and (
        public."current_role"() = 'org_admin'
        or (
          public."current_role"() in ('facility_manager', 'trainer')
          and public.is_assigned_to_facility(v_assignment.facility_id)
        )
      )
    )
    or v_is_self
  ) then
    raise exception 'not authorized' using errcode = 'insufficient_privilege';
  end if;

  v_was_completed := v_assignment.status = 'completed';
  select * into v_course from public.courses where id = v_assignment.course_id;

  -- Pacing gates stay scoped to a learner's own first transition: they exist to stop somebody
  -- clicking through their own training, and applying them to a manager recording an in-person
  -- class on a non-comprehensive course would break a legitimate flow. A replay of an
  -- already-valid completion skips them so a missing certificate can be repaired without
  -- rewriting evidence dates.
  if v_is_self and not v_was_completed then
    select * into v_progress
    from public.course_progress
    where assignment_id = p_assignment_id;

    v_min_seconds := greatest(
      60,
      round(coalesce(v_course.estimated_duration_minutes, 0)::numeric * 60 * 0.10)
    );

    if v_progress.started_at is null then
      raise exception 'This course has not been started yet -- open it and work through at least one lesson before marking it complete.'
        using errcode = 'check_violation';
    end if;

    if extract(epoch from (now() - v_progress.started_at)) < v_min_seconds then
      raise exception 'This course needs to stay open for at least % minute(s) before it can be marked complete -- % minute(s) have elapsed so far.',
        ceil(v_min_seconds / 60.0),
        floor(extract(epoch from (now() - v_progress.started_at)) / 60.0)
        using errcode = 'check_violation', hint = 'Continue through the training content, then try again.';
    end if;

  end if;

  -- Evidence gates are wider on purpose. require_comprehensive_self_completion() already holds
  -- progress, the final step, applied responses and seat time against EVERY completer of a
  -- comprehensive version, whoever calls this. What it does not check is the two things this
  -- course's certificate actually claims: that the examination was passed and the attestation
  -- signed. Leaving those inside the self-only branch let an authorized org admin, facility
  -- manager or trainer call this RPC directly and mint a certificate -- and a DIABETES-EDU
  -- renewal record -- for a learner who failed the exam and signed nothing. The management UI
  -- hides Mark Complete for comprehensive versions, but a hidden button is not a boundary.
  --
  -- Scoped to comprehensive versions rather than all courses so manager-recorded completions of
  -- ordinary courses keep working exactly as before.
  if not v_was_completed and (
    v_is_self
    or exists (
      select 1 from public.course_versions cv
      where cv.id = v_assignment.course_version_id
        and cv.content_standard = 'comprehensive'
    )
  ) then
    if exists (
      select 1
      from public.course_blocks cb
      where cb.course_version_id = v_assignment.course_version_id
        and cb.block_type = 'quiz'
        and not exists (
          select 1
          from public.quizzes qz
          join public.quiz_attempts qa on qa.quiz_id = qz.id
          where qz.course_block_id = cb.id
            and qa.assignment_id = p_assignment_id
            and qa.passed = true
        )
    ) then
      raise exception 'This course has one or more quizzes that must be passed before it can be marked complete.'
        using errcode = 'check_violation', hint = 'Take (and pass) every quiz in this course, then try again.';
    end if;

    -- The attestation is the last requirement before a certificate exists, and it is a
    -- requirement of the same rank as passing the examination: no signature, no certificate.
    if exists (
      select 1
      from public.course_blocks cb
      where cb.course_version_id = v_assignment.course_version_id
        and cb.block_type = 'attestation'
        and not exists (
          select 1
          from public.course_learner_attestations la
          where la.course_assignment_id = p_assignment_id
            and la.course_block_id = cb.id
        )
    ) then
      raise exception 'This course requires a signed learner attestation before it can be marked complete.'
        using errcode = 'check_violation', hint = 'Open the attestation step, read the statement, and sign it.';
    end if;
  end if;

  perform set_config('app.privileged_write', 'on', true);

  -- Best examination score on this assignment: what the certificate prints and what the
  -- regulatory training record stores. Knowledge checks are formative and never counted.
  select max(qa.score_percent) into v_exam_score
  from public.quiz_attempts qa
  join public.quizzes qz on qz.id = qa.quiz_id
  join public.course_blocks cb on cb.id = qz.course_block_id
  where qa.assignment_id = p_assignment_id
    and cb.course_version_id = v_assignment.course_version_id
    and qz.quiz_kind = 'final_exam'
    and qa.passed = true;

  if not v_was_completed then
    update public.course_assignments
    set status = 'completed', completed_at = now()
    where id = p_assignment_id;

    -- The compliance bridge is transition-only. A retry must never move the evidence's
    -- completion date forward or add annual hours a second time.
    if v_course.training_type_id is not null then
      select id into v_record_id
      from public.employee_training_records
      where employee_id = v_assignment.employee_id
        and training_type_id = v_course.training_type_id
      order by due_date desc nulls last, completion_date desc nulls last, created_at desc
      limit 1
      for update;

      if v_record_id is not null then
        update public.employee_training_records
        set completion_date = public.pa_today(),
            status = 'compliant',
            completion_method = 'online',
            training_provider = 'CareMetric CareBase Training Suite',
            hours = round(coalesce(v_course.estimated_duration_minutes, 0) / 60.0, 2),
            notes = 'Auto-recorded on completion of course "' || v_course.title || '".'
        where id = v_record_id;
      else
        insert into public.employee_training_records (
          organization_id, facility_id, employee_id, training_type_id,
          completion_date, status, hours, completion_method, training_provider, notes
        )
        values (
          v_assignment.organization_id,
          v_assignment.facility_id,
          v_assignment.employee_id,
          v_course.training_type_id,
          public.pa_today(),
          'compliant',
          round(coalesce(v_course.estimated_duration_minutes, 0) / 60.0, 2),
          'online',
          'CareMetric CareBase Training Suite',
          'Auto-recorded on completion of course "' || v_course.title || '".'
        );
      end if;
    end if;
  end if;

  -- A recurring course's certificate carries the same expiry the requirement does, so the
  -- learner's own certificate list and the public verification page agree with the compliance
  -- dashboard instead of showing a document that never expires.
  v_expires_at := case
    when v_course.recurrence_interval_days is null then null
    else coalesce(v_assignment.completed_at, now()) + make_interval(days => v_course.recurrence_interval_days)
  end;

  insert into public.certificates (
    organization_id, facility_id, employee_id, course_id, course_assignment_id,
    issued_at, expires_at
  )
  values (
    v_assignment.organization_id,
    v_assignment.facility_id,
    v_assignment.employee_id,
    v_assignment.course_id,
    v_assignment.id,
    coalesce(v_assignment.completed_at, now()),
    v_expires_at
  )
  on conflict (course_assignment_id) do nothing
  returning id, credential_number into v_certificate_id, v_certificate_number;

  if v_certificate_id is null then
    select id, credential_number into v_certificate_id, v_certificate_number
    from public.certificates
    where course_assignment_id = p_assignment_id;
  end if;

  if v_certificate_id is null then
    raise exception 'certificate reconciliation failed for assignment %', p_assignment_id;
  end if;

  -- The renewal bridge. Written after the certificate exists so the requirement row can carry
  -- the certificate number an inspector would ask for, and only on the first transition so a
  -- replay never moves the annual clock forward.
  if not v_was_completed and v_course.renewal_training_type_id is not null then
    select p.provider_full_name, p.credential into v_provider
    from public.course_provider_profiles p
    where p.course_id = v_course.id;

    select id into v_record_id
    from public.employee_training_records
    where employee_id = v_assignment.employee_id
      and training_type_id = v_course.renewal_training_type_id
    order by due_date desc nulls last, completion_date desc nulls last, created_at desc
    limit 1
    for update;

    if v_record_id is not null then
      update public.employee_training_records
      set completion_date = public.pa_today(),
          status = 'compliant',
          completion_method = 'online',
          training_provider = coalesce(v_provider.provider_full_name, 'CareMetric CareBase Training Suite'),
          trainer_name = v_provider.provider_full_name,
          trainer_credentials = v_provider.credential,
          certificate_number = v_certificate_number,
          score = v_exam_score,
          hours = round(coalesce(v_course.estimated_duration_minutes, 0) / 60.0, 2),
          notes = 'Auto-recorded on completion of course "' || v_course.title || '".'
      where id = v_record_id;
    else
      insert into public.employee_training_records (
        organization_id, facility_id, employee_id, training_type_id,
        completion_date, status, hours, completion_method, training_provider,
        trainer_name, trainer_credentials, certificate_number, score, notes
      )
      values (
        v_assignment.organization_id,
        v_assignment.facility_id,
        v_assignment.employee_id,
        v_course.renewal_training_type_id,
        public.pa_today(),
        'compliant',
        round(coalesce(v_course.estimated_duration_minutes, 0) / 60.0, 2),
        'online',
        coalesce(v_provider.provider_full_name, 'CareMetric CareBase Training Suite'),
        v_provider.provider_full_name,
        v_provider.credential,
        v_certificate_number,
        v_exam_score,
        'Auto-recorded on completion of course "' || v_course.title || '".'
      );
    end if;
  end if;

  if not v_was_completed then
    perform public.recalculate_compliance_core(v_assignment.organization_id);
  end if;
end;
$function$;

revoke all on function public.complete_course_assignment(uuid) from public, anon;
grant execute on function public.complete_course_assignment(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Publication gates learn about the two new shapes
-- ---------------------------------------------------------------------------

create or replace function public.get_course_version_publish_issues(p_version_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_issues text[] := array[]::text[];
  v_exists boolean;
  v_label text;
  v_question_count integer;
  v_answer_count integer;
  v_correct_count integer;
  rec record;
begin
  if not public.is_platform_admin()
     and coalesce(current_setting('app.privileged_write', true), '') is distinct from 'on' then
    raise exception 'Only platform admins can inspect course publish readiness.'
      using errcode = 'insufficient_privilege';
  end if;

  select exists(select 1 from public.course_versions where id = p_version_id) into v_exists;
  if not v_exists then
    return array['Course version not found.'];
  end if;

  if not exists(select 1 from public.course_blocks where course_version_id = p_version_id) then
    return array['Add at least one content block before publishing.'];
  end if;

  for rec in
    select id, block_type, sort_order, title, body, video_url, document_id
      from public.course_blocks
     where course_version_id = p_version_id
     order by sort_order, created_at
  loop
    v_label := coalesce(nullif(btrim(rec.title), ''), 'Block ' || (rec.sort_order + 1));

    if rec.block_type = 'text' and coalesce(btrim(rec.body ->> 'content'), '') = '' then
      v_issues := array_append(v_issues, v_label || ': add lesson text.');
    end if;

    if rec.block_type = 'video' and coalesce(btrim(rec.video_url), '') = '' then
      v_issues := array_append(v_issues, v_label || ': add a finished video URL before publishing.');
    end if;

    if rec.block_type = 'video'
       and coalesce(btrim(coalesce(rec.body ->> 'transcript', rec.body ->> 'script')), '') = '' then
      v_issues := array_append(v_issues, v_label || ': add captions or transcript notes for accessibility.');
    end if;

    if rec.block_type in ('pdf', 'scorm') and rec.document_id is null then
      v_issues := array_append(v_issues, v_label || ': attach a document.');
    end if;

    if rec.block_type = 'quiz'
       and not exists(select 1 from public.quizzes where course_block_id = rec.id) then
      v_issues := array_append(v_issues, v_label || ': configure the quiz.');
    end if;

    -- An attestation step with no statement is a signature line over blank paper, and
    -- record_course_attestation() would reject every attempt to sign it.
    if rec.block_type = 'attestation'
       and length(coalesce(btrim(rec.body ->> 'attestation_text'), '')) < 40 then
      v_issues := array_append(v_issues, v_label || ': write the statement the learner is signing (at least 40 characters).');
    end if;

    if rec.block_type = 'attestation'
       and coalesce(btrim(rec.body ->> 'attestation_version'), '') = '' then
      v_issues := array_append(v_issues, v_label || ': set an attestation_version so a signed statement stays identifiable.');
    end if;
  end loop;

  for rec in
    select q.id, q.title, cb.title as block_title, cb.sort_order
      from public.quizzes q
      join public.course_blocks cb on cb.id = q.course_block_id
     where cb.course_version_id = p_version_id
     order by cb.sort_order
  loop
    select count(*) into v_question_count
      from public.quiz_questions
     where quiz_id = rec.id;

    if v_question_count = 0 then
      v_label := coalesce(nullif(btrim(rec.block_title), ''), rec.title, 'Block ' || (rec.sort_order + 1));
      v_issues := array_append(v_issues, v_label || ': add at least one question.');
    end if;
  end loop;

  for rec in
    select qq.id, qq.question_text, qq.question_type, cb.sort_order
      from public.quiz_questions qq
      join public.quizzes q on q.id = qq.quiz_id
      join public.course_blocks cb on cb.id = q.course_block_id
     where cb.course_version_id = p_version_id
     order by cb.sort_order, qq.sort_order
  loop
    select count(*), count(*) filter (where is_correct)
      into v_answer_count, v_correct_count
      from public.quiz_answers
     where question_id = rec.id;

    v_label := left(coalesce(nullif(btrim(rec.question_text), ''), 'Question'), 80);

    if v_answer_count < 2 then
      v_issues := array_append(v_issues, v_label || ': add at least two answer choices.');
    end if;

    if v_correct_count = 0 then
      v_issues := array_append(v_issues, v_label || ': mark at least one correct answer.');
    end if;

    if rec.question_type in ('single_choice', 'true_false') and v_correct_count > 1 then
      v_issues := array_append(v_issues, v_label || ': single-choice questions can have only one correct answer.');
    end if;
  end loop;

  return v_issues;
end;
$function$;

-- The comprehensive standard gains two things and loses none of its strength:
--
--   * 'attestation' joins the supported activity types, so a course can end in a signed
--     statement without dropping to the legacy standard.
--   * An UNLIMITED-attempt assessment is allowed. The old rule read "one to five allowed
--     attempts" and rejected max_attempts is null, which would have forced an annual
--     examination to lock a learner out after five tries -- an outcome that helps nobody and
--     that this course explicitly must not have. A cap, when set, is still bounded to 1-5, and
--     the passing score is still at least 80 percent.
create or replace function public.get_comprehensive_course_version_issues(p_version_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = 'public'
as $function$
declare
  v_issues text[] := array[]::text[];
  v_version public.course_versions%rowtype;
  v_course public.courses%rowtype;
  v_block_count integer;
  v_required_blocks integer;
  v_designed_minutes integer;
  v_question_count integer;
  v_required_questions integer;
begin
  if not public.is_platform_admin()
     and coalesce(current_setting('app.privileged_write', true), '') is distinct from 'on' then
    raise exception 'Only platform administrators can inspect comprehensive course publish readiness.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_version
  from public.course_versions
  where id = p_version_id;

  if not found then
    return array['Course version not found.'];
  end if;

  if v_version.content_standard <> 'comprehensive' then
    return v_issues;
  end if;

  select * into v_course
  from public.courses
  where id = v_version.course_id;

  if not found then
    return array['Owning course not found.'];
  end if;

  if coalesce(v_course.estimated_duration_minutes, 0) < 15 then
    v_issues := array_append(v_issues, 'Set a course duration of at least 15 minutes.');
  end if;

  if concat_ws(' ', v_course.title, v_course.description, v_version.title, v_version.description)
       ~* '\m(starter|placeholder|sample course|no-credit starter)\M' then
    v_issues := array_append(v_issues, 'Remove starter, placeholder, and sample-course language from a comprehensive version.');
  end if;

  select count(*) into v_block_count
  from public.course_blocks cb
  where cb.course_version_id = p_version_id;

  v_required_blocks := greatest(
    8,
    ceil(coalesce(v_course.estimated_duration_minutes, 0) / 45.0)::integer + 3
  );
  if v_block_count < v_required_blocks then
    v_issues := array_append(
      v_issues,
      format('Add at least %s sequenced learning steps for this duration.', v_required_blocks)
    );
  end if;

  if exists (
    select 1
    from public.course_blocks cb
    where cb.course_version_id = p_version_id
      and (
        cb.body is null
        or coalesce(cb.body ->> 'estimated_minutes', '')
          !~ '^([1-9]|[1-9][0-9]|1[01][0-9]|120)$'
      )
  ) then
    v_issues := array_append(v_issues, 'Every step needs 1-120 explicit estimated_minutes.');
  end if;

  if exists (
    select 1
    from public.course_blocks cb
    where cb.course_version_id = p_version_id
      and coalesce(btrim(cb.body ->> 'activity_type'), '') not in (
        'objectives',
        'instruction',
        'guided_instruction',
        'scenario',
        'practice',
        'facility_verification',
        'sources',
        'assessment',
        'attestation'
      )
  ) then
    v_issues := array_append(
      v_issues,
      'Every step needs a supported activity_type.'
    );
  end if;

  if exists (
    select 1
    from public.course_blocks cb
    where cb.course_version_id = p_version_id
      and cb.block_type = 'text'
      and length(coalesce(btrim(cb.body ->> 'content'), '')) < 120
  ) then
    v_issues := array_append(v_issues, 'Every written learning step needs at least 120 characters of substantive content.');
  end if;

  if exists (
    select 1
    from public.course_blocks cb
    where cb.course_version_id = p_version_id
      and cb.block_type = 'text'
      and cb.body ->> 'activity_type' in (
        'instruction', 'guided_instruction', 'scenario', 'practice',
        'facility_verification'
      )
      and cardinality(
        regexp_split_to_array(btrim(coalesce(cb.body ->> 'content', '')), E'\\s+')
      ) < greatest(
        80,
        4 * case
          when coalesce(cb.body ->> 'estimated_minutes', '')
            ~ '^([1-9]|[1-9][0-9]|1[01][0-9]|120)$'
            then (cb.body ->> 'estimated_minutes')::smallint
          else 0
        end
      )
  ) then
    v_issues := array_append(
      v_issues,
      'Expand long instruction and application steps so their learner-visible guidance and work are credible for the designed time.'
    );
  end if;

  if exists (
    select 1
    from public.course_blocks cb
    where cb.course_version_id = p_version_id
      and cb.body ->> 'activity_type' in ('scenario', 'practice')
      and coalesce(cb.body ->> 'content', '') ~* '(recommended response|correct answer)[[:space:]]*:'
  ) then
    v_issues := array_append(
      v_issues,
      'Withhold recommended responses and correct answers until after the learner completes applied work.'
    );
  end if;

  if not exists (
    select 1 from public.course_blocks cb
    where cb.course_version_id = p_version_id
      and cb.body ->> 'activity_type' = 'objectives'
  ) then
    v_issues := array_append(v_issues, 'Add a measurable learning-objectives step.');
  end if;

  if (
    select count(*) from public.course_blocks cb
    where cb.course_version_id = p_version_id
      and cb.body ->> 'activity_type' in (
        'instruction', 'guided_instruction', 'practice', 'facility_verification'
      )
  ) < 4 then
    v_issues := array_append(v_issues, 'Add at least four substantive instruction or guided-practice steps.');
  end if;

  if (
    select count(*) from public.course_blocks cb
    where cb.course_version_id = p_version_id
      and cb.body ->> 'activity_type' in ('scenario', 'practice')
  ) < 2 then
    v_issues := array_append(v_issues, 'Add at least two scenario or practice steps.');
  end if;

  if not exists (
    select 1 from public.course_blocks cb
    where cb.course_version_id = p_version_id
      and cb.body ->> 'activity_type' = 'sources'
  ) then
    v_issues := array_append(v_issues, 'Add a sources and scope step.');
  end if;

  if exists (
    select 1
    from public.course_blocks cb
    where cb.course_version_id = p_version_id
      and cb.body ->> 'activity_type' = 'sources'
      and (
        cb.block_type <> 'text'
        or length(coalesce(btrim(cb.body ->> 'content'), '')) < 160
        or coalesce(cb.body ->> 'content', '') !~* 'https?://[^[:space:]]+'
      )
  ) then
    v_issues := array_append(
      v_issues,
      'Add substantive source context and at least one http(s) citation to every sources step.'
    );
  end if;

  -- System catalog courses make regulatory claims for many organizations, so
  -- their authority must include a government-hosted primary source. An
  -- organization-authored comprehensive course still needs an http(s) source,
  -- but may properly cite its own official policy or a non-government standard.
  if v_course.organization_id is null and exists (
    select 1
    from public.course_blocks cb
    where cb.course_version_id = p_version_id
      and cb.body ->> 'activity_type' = 'sources'
      and coalesce(cb.body ->> 'content', '')
        !~* 'https?://([[:alnum:]-]+\.)*[[:alnum:]-]+\.gov([/:?#]|[[:space:]]|$)'
  ) then
    v_issues := array_append(
      v_issues,
      'System course sources must include an official government http(s) URL.'
    );
  end if;

  if not exists (
    select 1 from public.course_blocks cb
    where cb.course_version_id = p_version_id
      and cb.block_type = 'quiz'
      and cb.body ->> 'activity_type' = 'assessment'
  ) then
    v_issues := array_append(v_issues, 'Add a timed final assessment step.');
  end if;

  if exists (
    select 1
    from public.course_blocks cb
    where cb.course_version_id = p_version_id
      and cb.block_type = 'attestation'
      and (
        length(coalesce(btrim(cb.body ->> 'attestation_text'), '')) < 40
        or coalesce(btrim(cb.body ->> 'attestation_version'), '') = ''
      )
  ) then
    v_issues := array_append(
      v_issues,
      'Give every attestation step a statement of at least 40 characters and an attestation_version.'
    );
  end if;

  if exists (
    select 1
    from public.quizzes q
    join public.course_blocks cb on cb.id = q.course_block_id
    where cb.course_version_id = p_version_id
      and (
        q.passing_score_percent < 80
        or (q.max_attempts is not null and q.max_attempts not between 1 and 5)
      )
  ) then
    v_issues := array_append(
      v_issues,
      'Use an assessment passing score of at least 80 percent, and either unlimited attempts or a cap of one to five.'
    );
  end if;

  if exists (
    select 1
    from public.course_blocks cb
    where cb.course_version_id = p_version_id
    group by cb.sort_order
    having count(*) > 1
  ) then
    v_issues := array_append(v_issues, 'Course step sort orders must be unique.');
  end if;

  v_designed_minutes := public.get_course_version_designed_minutes(p_version_id);
  if v_designed_minutes is null then
    v_issues := array_append(
      v_issues,
      'Designed step time exceeds the supported course-duration range.'
    );
  elsif v_designed_minutes <> coalesce(v_course.estimated_duration_minutes, 0) then
    v_issues := array_append(
      v_issues,
      format(
        'Designed step time (%s minutes) must equal the catalog duration (%s minutes).',
        v_designed_minutes,
        coalesce(v_course.estimated_duration_minutes, 0)
      )
    );
  end if;

  select count(*) into v_question_count
  from public.quiz_questions qq
  join public.quizzes q on q.id = qq.quiz_id
  join public.course_blocks cb on cb.id = q.course_block_id
  where cb.course_version_id = p_version_id;

  v_required_questions := greatest(
    5,
    least(12, ceil(coalesce(v_course.estimated_duration_minutes, 0) / 60.0)::integer)
  );
  if v_question_count < v_required_questions then
    v_issues := array_append(
      v_issues,
      format('Add at least %s final-assessment questions for this duration.', v_required_questions)
    );
  end if;

  if exists (
    select 1
    from public.quiz_questions qq
    join public.quizzes q on q.id = qq.quiz_id
    join public.course_blocks cb on cb.id = q.course_block_id
    left join public.quiz_question_explanations qx on qx.question_id = qq.id
    where cb.course_version_id = p_version_id
      and length(coalesce(btrim(qx.explanation), '')) < 60
  ) then
    v_issues := array_append(v_issues, 'Every assessment question needs a useful answer explanation.');
  end if;

  if exists (
    select 1
    from public.quiz_questions qq
    join public.quizzes q on q.id = qq.quiz_id
    join public.course_blocks cb on cb.id = q.course_block_id
    where cb.course_version_id = p_version_id
      and length(btrim(qq.question_text)) < 25
  ) then
    v_issues := array_append(v_issues, 'Every assessment prompt needs at least 25 characters of context.');
  end if;

  if exists (
    select 1
    from public.quiz_answers qa
    join public.quiz_questions qq on qq.id = qa.question_id
    join public.quizzes q on q.id = qq.quiz_id
    join public.course_blocks cb on cb.id = q.course_block_id
    where cb.course_version_id = p_version_id
      and length(btrim(qa.answer_text)) < 15
  ) then
    v_issues := array_append(v_issues, 'Every assessment choice needs at least 15 characters of meaningful text.');
  end if;

  if exists (
    select 1
    from public.quiz_questions qq
    join public.quizzes q on q.id = qq.quiz_id
    join public.course_blocks cb on cb.id = q.course_block_id
    where cb.course_version_id = p_version_id
      and (
        (select count(*) from public.quiz_answers qa where qa.question_id = qq.id) <> 4
        or (select count(*) from public.quiz_answers qa where qa.question_id = qq.id and qa.is_correct) <> 1
        or (
          select count(distinct lower(btrim(qa.answer_text)))
          from public.quiz_answers qa
          where qa.question_id = qq.id
        ) <> 4
      )
  ) then
    v_issues := array_append(
      v_issues,
      'Every assessment question needs exactly four unique choices and one correct answer.'
    );
  end if;

  if exists (
    select 1
    from public.quizzes q
    join public.course_blocks cb on cb.id = q.course_block_id
    where cb.course_version_id = p_version_id
      and (select count(*) from public.quiz_questions qq where qq.quiz_id = q.id) >= 8
      and (
        select count(distinct lower(btrim(qa.answer_text)))
        from public.quiz_questions qq
        join public.quiz_answers qa on qa.question_id = qq.id
        where qq.quiz_id = q.id
          and not qa.is_correct
      ) < ceil(
        0.75 * (
          select count(*)
          from public.quiz_questions qq
          join public.quiz_answers qa on qa.question_id = qq.id
          where qq.quiz_id = q.id
            and not qa.is_correct
        )
      )
  ) then
    v_issues := array_append(
      v_issues,
      'Replace repeated generic distractors with plausible course-specific assessment choices.'
    );
  end if;

  if exists (
    select 1
    from public.quizzes q
    join public.course_blocks cb on cb.id = q.course_block_id
    where cb.course_version_id = p_version_id
      and (
        select count(*) from public.quiz_questions qq where qq.quiz_id = q.id
      ) >= 8
      and (
        select count(distinct qa.sort_order)
        from public.quiz_questions qq
        join public.quiz_answers qa on qa.question_id = qq.id and qa.is_correct
        where qq.quiz_id = q.id
      ) < 3
  ) then
    v_issues := array_append(v_issues, 'Vary correct-answer positions across at least three choices.');
  end if;

  return v_issues;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 10. Public verification carries the regulatory detail
-- ---------------------------------------------------------------------------
--
-- A surveyor scanning the QR code on a printed certificate should see the same facts the
-- certificate claims. Existing columns are returned unchanged and in the same order, so the
-- current /verify page keeps working while the new columns are additive.
--
-- Dropped first: adding output columns to a RETURNS TABLE signature is a return-type change,
-- which `create or replace` refuses (42P13). A dropped function takes its grants with it, so the
-- re-grant below is not optional.
drop function if exists public.verify_certificate(text);

create function public.verify_certificate(p_slug text)
returns table (
  employee_name       text,
  course_title        text,
  organization_name   text,
  issued_at           timestamptz,
  expires_at          timestamptz,
  is_valid            boolean,
  course_code         text,
  course_version      text,
  credential_number   text,
  final_exam_score    numeric,
  training_provider   text,
  provider_credential text
)
language sql stable security definer set search_path to 'public' as $function$
  select
    (e.first_name || ' ' || e.last_name)::text,
    c.title,
    o.name,
    cert.issued_at,
    cert.expires_at,
    (cert.expires_at is null or cert.expires_at > now()),
    c.catalog_code,
    cv.title_version,
    cert.credential_number,
    exam.score_percent,
    pp.provider_full_name,
    pp.credential
  from public.certificates cert
  join public.employees     e on e.id = cert.employee_id
  join public.courses       c on c.id = cert.course_id
  join public.organizations o on o.id = cert.organization_id
  left join public.course_provider_profiles pp on pp.course_id = c.id
  left join lateral (
    -- The version the learner actually took, not whatever the course points at today: a
    -- certificate issued in 2026 must keep saying 2026.1 after 2027.1 publishes.
    select coalesce(cvv.version_label, 'v' || cvv.version_number::text) as title_version
    from public.course_assignments ca
    join public.course_versions cvv on cvv.id = ca.course_version_id
    where ca.id = cert.course_assignment_id
  ) cv on true
  left join lateral (
    select max(qa.score_percent) as score_percent
    from public.quiz_attempts qa
    join public.quizzes qz on qz.id = qa.quiz_id
    where qa.assignment_id = cert.course_assignment_id
      and qz.quiz_kind = 'final_exam'
      and qa.passed = true
  ) exam on true
  where cert.slug = p_slug;
$function$;

revoke all on function public.verify_certificate(text) from public;
grant execute on function public.verify_certificate(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 11. Ratchets: module entitlement and audit manifest
-- ---------------------------------------------------------------------------

insert into app_private.product_module_resources (resource_schema, resource_name, module_key)
values
  ('public', 'course_provider_profiles', 'modules.train'),
  ('public', 'course_learner_attestations', 'modules.train')
on conflict (resource_schema, resource_name) do update set module_key = excluded.module_key;

create policy product_module_entitlement on public.course_provider_profiles
  as restrictive for all to authenticated
  using ((select app_private.has_product_module('modules.train')))
  with check ((select app_private.has_product_module('modules.train')));

create policy product_module_entitlement on public.course_learner_attestations
  as restrictive for all to authenticated
  using ((select app_private.has_product_module('modules.train')))
  with check ((select app_private.has_product_module('modules.train')));

insert into app_private.audit_entity_manifest (table_name, audit_mode, contains_regulated_data, rationale)
values
  (
    'course_provider_profiles',
    'domain_evidence',
    false,
    'Training-provider identity, credential, and clinical-review dates that a certificate and an '
    'inspection report reproduce as fact. Every insert, update, and delete writes an audit_logs row '
    'through audit_course_provider_profile(), which resolves the owning course''s organization '
    'because this catalog-scoped table has no organization_id of its own -- the one reason it is not '
    'the shared audit_log_trigger. No resident or employee personal data.'
  ),
  (
    'course_learner_attestations',
    'row_trigger',
    true,
    'The learner''s signed statement that they personally completed the training. Employee-keyed and '
    'append-only in practice -- there is no client write policy, only record_course_attestation() -- '
    'but a row trigger records any later administrative correction alongside the signature itself, '
    'which is the thing a surveyor would test.'
  )
on conflict (table_name) do nothing;
