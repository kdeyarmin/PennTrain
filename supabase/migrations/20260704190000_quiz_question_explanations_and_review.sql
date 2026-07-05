-- Quiz question authoring had hooks (useCreateQuizQuestion/useCreateQuizAnswer etc.)
-- but no UI ever built on top of them, and no way for a learner to review *why* an
-- answer was right or wrong after a graded attempt. This migration adds:
--
-- 1. quiz_questions.explanation -- optional author-written feedback text.
-- 2. get_quiz_review(p_attempt_id) -- a SECURITY DEFINER RPC that returns, for one
--    already-graded (submitted_at is not null) attempt the caller is allowed to see,
--    each answer choice's is_correct plus its question's explanation. This mirrors
--    get_quiz_answer_choices' pattern of shielding quiz_answers.is_correct behind a
--    function rather than base-table RLS, except gated on submitted_at so it can
--    never be used to peek at the key before/during an attempt.
--
-- Authorization mirrors grade_quiz_attempt: the owning employee, or an org_admin/
-- facility_manager/trainer in the attempt's organization, or a platform_admin.

alter table public.quiz_questions add column explanation text;

create or replace function public.get_quiz_review(p_attempt_id uuid)
returns table (
  question_id uuid,
  answer_id   uuid,
  answer_text text,
  is_correct  boolean,
  explanation text
)
language sql stable security definer set search_path to 'public' as $function$
  select a.question_id, a.id, a.answer_text, a.is_correct, q.explanation
  from public.quiz_answers a
  join public.quiz_questions q on q.id = a.question_id
  join public.quiz_attempts att on att.quiz_id = q.quiz_id
  where att.id = p_attempt_id
    and att.submitted_at is not null
    and (
      public.is_platform_admin()
      or public.owns_employee(att.employee_id)
      or (att.organization_id = public.current_org_id()
          and public."current_role"() in ('org_admin', 'facility_manager', 'trainer'))
    )
  order by a.sort_order;
$function$;
revoke all on function public.get_quiz_review(uuid) from public;
grant execute on function public.get_quiz_review(uuid) to authenticated;
