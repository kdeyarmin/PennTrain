-- Fixes for findings from automated PR review (Copilot + Codex) on this branch's
-- migrations. Each item below is independent; grouped into one migration only
-- because they all landed in the same review pass.

-- ---------------------------------------------------------------------------
-- 1. (Codex, P1, critical) get_quiz_review only gated on submitted_at, so a
--    learner could call the RPC directly (bypassing TakeQuiz's client-side
--    canRevealAnswers check) and read the answer key on a failed attempt with
--    retakes still remaining -- defeating the entire point of gating the
--    reveal on pass-or-exhausted. The gate must live in the function, not
--    just the UI. Admin/trainer/platform_admin viewers are unaffected -- the
--    integrity concern is specific to the learner viewing their OWN attempt,
--    and a reviewer needs full visibility regardless of retake status.
-- ---------------------------------------------------------------------------
create or replace function public.get_quiz_review(p_attempt_id uuid)
returns table (
  question_id uuid,
  answer_id   uuid,
  answer_text text,
  is_correct  boolean,
  explanation text
)
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
  )
  select a.question_id, a.id, a.answer_text, a.is_correct, q.explanation
  from public.quiz_answers a
  join public.quiz_questions q on q.id = a.question_id
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
$function$