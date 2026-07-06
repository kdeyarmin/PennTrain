-- Forward-fix (review findings): three compounding gaps let a learner defeat quiz integrity
-- entirely by bypassing the UI and calling supabase-js/PostgREST directly:
--
-- 1. quizzes.max_attempts is enforced only by the frontend's Retake-Quiz button -- nothing in RLS
--    or a trigger stops a caller from inserting arbitrarily many quiz_attempts rows for the same
--    (assignment_id, quiz_id), even once max_attempts is reached.
-- 2. grade_quiz_attempt() never checks whether the attempt is already submitted, and
--    quiz_attempt_answers_update has no restriction requiring the parent quiz_attempts.submitted_at
--    to be null -- so after failing attempt #1, a learner can directly
--    `.from('quiz_attempt_answers').update({selected_answer_ids:[...]})` the same still-submitted
--    attempt's rows for every question still marked incorrect, then call
--    `rpc('grade_quiz_attempt', ...)` again to recompute is_correct/score_percent/passed on the SAME
--    row -- repeating indefinitely until every answer is correct. Since attempt_number never
--    changes, this entirely bypasses max_attempts (which only limits the number of quiz_attempts
--    ROWS, not re-grading a single row).
-- 3. get_quiz_review()'s attempt_count CTE counts ALL quiz_attempts rows for the assignment+quiz --
--    submitted or not -- so a learner can pad the count with extra unsubmitted (junk) attempt rows
--    to make `ac.used >= max_attempts` true on a still-failed, still-retriable attempt, and use that
--    to read every correct answer/explanation via get_quiz_review before ever exhausting a real
--    attempt -- defeating the "reveal answers only once retries are truly exhausted" design.
--
-- Fix all three together: cap quiz_attempts inserts at max_attempts for non-privileged callers,
-- block grade_quiz_attempt() from re-grading an already-submitted attempt for the owning employee,
-- restrict quiz_attempt_answers_update so the owning employee can only edit answers while the
-- parent attempt is unsubmitted, and count only submitted attempts toward "exhausted my retries".

-- 1. Attempt cap, enforced server-side. Skipped for platform_admin/org_admin/facility_manager/
-- trainer (an admin manually creating/adjusting an attempt on a learner's behalf -- e.g. a
-- make-up attempt -- is a deliberate, out-of-band decision this trigger shouldn't block).
create or replace function public.enforce_quiz_attempt_cap()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_max integer;
  v_used integer;
begin
  if public.is_platform_admin() or (select public.current_role()) in ('org_admin','facility_manager','trainer') then
    return new;
  end if;

  select max_attempts into v_max from public.quizzes where id = new.quiz_id;
  if v_max is null then
    return new;
  end if;

  select count(*) into v_used
  from public.quiz_attempts
  where assignment_id = new.assignment_id and quiz_id = new.quiz_id;

  if v_used >= v_max then
    raise exception 'maximum of % attempt(s) already used for this quiz', v_max
      using errcode = 'check_violation';
  end if;

  return new;
end;
$function$;

create trigger enforce_quiz_attempt_cap before insert on public.quiz_attempts
  for each row execute function public.enforce_quiz_attempt_cap();
revoke all on function public.enforce_quiz_attempt_cap() from public, anon, authenticated;

-- 2. grade_quiz_attempt(): reject re-grading an attempt the OWNING employee already submitted.
-- org_admin/facility_manager/trainer/platform_admin retain the ability to re-grade intentionally
-- (e.g. after correcting a data issue), since they're trusted reviewers, not the test-taker.
create or replace function public.grade_quiz_attempt(p_attempt_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_quiz_id uuid; v_org uuid; v_emp uuid; v_pass integer; v_score numeric; v_submitted_at timestamptz; v_is_reviewer boolean;
begin
  select quiz_id, organization_id, employee_id, submitted_at into v_quiz_id, v_org, v_emp, v_submitted_at
  from public.quiz_attempts where id = p_attempt_id;
  if v_quiz_id is null then
    raise exception 'attempt % not found', p_attempt_id using errcode = 'no_data_found';
  end if;

  v_is_reviewer := public.is_platform_admin()
    or (v_org = public.current_org_id() and public."current_role"() in ('org_admin','facility_manager','trainer'));

  if not (v_is_reviewer or public.owns_employee(v_emp)) then
    raise exception 'not authorized' using errcode = 'insufficient_privilege';
  end if;

  if v_submitted_at is not null and not v_is_reviewer then
    raise exception 'quiz attempt % has already been submitted and graded', p_attempt_id
      using errcode = 'check_violation';
  end if;

  select passing_score_percent into v_pass from public.quizzes where id = v_quiz_id;
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
revoke all on function public.grade_quiz_attempt(uuid) from public, anon, authenticated;
grant execute on function public.grade_quiz_attempt(uuid) to authenticated;

-- 3. quiz_attempt_answers_update: the owning employee may only edit their own answers while the
-- attempt is still unsubmitted (i.e. before they've clicked "Submit" / before grade_quiz_attempt()
-- has run). org_admin/facility_manager/trainer/platform_admin are untouched.
alter policy quiz_attempt_answers_update on public.quiz_attempt_answers
using (
  exists (select 1 from public.quiz_attempts qa
          where qa.id = quiz_attempt_answers.attempt_id
            and ( (select public.is_platform_admin())
                  or (public.owns_employee(qa.employee_id) and qa.submitted_at is null)
                  or (qa.organization_id = (select public.current_org_id())
                      and (select public."current_role"()) in ('org_admin','facility_manager','trainer')
                      and public.is_assigned_to_facility(qa.facility_id)) ))
)
with check (
  exists (select 1 from public.quiz_attempts qa
          where qa.id = quiz_attempt_answers.attempt_id
            and ( (select public.is_platform_admin())
                  or (public.owns_employee(qa.employee_id) and qa.submitted_at is null)
                  or (qa.organization_id = (select public.current_org_id())
                      and (select public."current_role"()) in ('org_admin','facility_manager','trainer')
                      and public.is_assigned_to_facility(qa.facility_id)) ))
);

-- 4. get_quiz_review(): only a genuinely SUBMITTED attempt counts toward "exhausted every retry" --
-- an unsubmitted placeholder row (which a learner can otherwise insert for free, up to the new cap
-- above) must not be usable to fake exhaustion and unlock the correct-answer key early.
create or replace function public.get_quiz_review(p_attempt_id uuid)
returns table(question_id uuid, answer_id uuid, answer_text text, is_correct boolean, explanation text)
language sql stable security definer set search_path to 'public' as $function$
  with target as (
    select att.id, att.employee_id, att.organization_id, att.passed, att.submitted_at,
           att.assignment_id, att.quiz_id, qz.max_attempts
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
      or (t.organization_id = public.current_org_id()
          and public."current_role"() in ('org_admin', 'facility_manager', 'trainer'))
      or (
        public.owns_employee(t.employee_id)
        and (t.passed = true or (t.max_attempts is not null and ac.used >= t.max_attempts))
      )
    )
  order by a.sort_order;
$function$;

revoke execute on function public.get_quiz_review(uuid) from public;
revoke execute on function public.get_quiz_review(uuid) from anon;
grant execute on function public.get_quiz_review(uuid) to authenticated;
