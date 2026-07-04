-- get_advisors (security, ERROR) flagged quiz_answer_choices as a "Security Definer View": a plain
-- view with no security_invoker=true implicitly runs as its owner, bypassing quiz_answers' author-only
-- RLS -- which was the deliberate point (letting a learner read answer *choices* without is_correct,
-- which base-table RLS otherwise hides entirely). security_invoker=true is not viable here: it would
-- make the view subject to quiz_answers' author-only SELECT policy, returning zero rows for a learner
-- and defeating the view's purpose. Converting to an explicit SECURITY DEFINER function is the
-- Supabase-idiomatic fix for this exact lint -- it matches verify_certificate()/grade_quiz_attempt()
-- already in this project, which draw only the already-accepted WARN "anon/authenticated can execute"
-- lint, not this ERROR. Takes p_quiz_id (not p_question_id) so a client can fetch all choices for a
-- quiz being taken in one RPC call.
drop view if exists public.quiz_answer_choices;

create or replace function public.get_quiz_answer_choices(p_quiz_id uuid)
returns table (
  id          uuid,
  question_id uuid,
  answer_text text,
  sort_order  integer
)
language sql stable security definer set search_path to 'public' as $function$
  select a.id, a.question_id, a.answer_text, a.sort_order
  from public.quiz_answers a
  join public.quiz_questions q on q.id = a.question_id
  where q.quiz_id = p_quiz_id
    and ( (select public.is_platform_admin())
          or a.organization_id is null
          or a.organization_id = (select public.current_org_id()) )
  order by a.sort_order;
$function$;
revoke all on function public.get_quiz_answer_choices(uuid) from public;
grant execute on function public.get_quiz_answer_choices(uuid) to authenticated;
