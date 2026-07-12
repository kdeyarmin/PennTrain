-- SECTION 4 — quiz_answers.is_correct READ SHIELD (security-barrier view)
create view public.quiz_answer_choices with (security_barrier = true) as
  select a.id, a.question_id, a.answer_text, a.sort_order
  from public.quiz_answers a
  where (select public.is_platform_admin())
     or a.organization_id is null
     or a.organization_id = (select public.current_org_id());

revoke all on public.quiz_answer_choices from anon, public;
grant select on public.quiz_answer_choices to authenticated;
