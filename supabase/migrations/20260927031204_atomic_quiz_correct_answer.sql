-- A radio-button selection is one change to the answer key, not independent
-- requests to unset the old answer and set the new one. Serialize selections
-- against question/type changes and keep all existing RLS and content triggers.
create function public.set_quiz_correct_answer(p_question_id uuid, p_answer_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_version_id uuid;
  v_status text;
  v_question_type text;
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'Only platform administrators can edit quiz answer keys.' using errcode = '42501';
  end if;

  -- Use the same outer version lock order as governed authoring/publication.
  select v.id, v.status into v_version_id, v_status
  from public.quiz_questions q
  join public.quizzes z on z.id = q.quiz_id
  join public.course_blocks b on b.id = z.course_block_id
  join public.course_versions v on v.id = b.course_version_id
  where q.id = p_question_id
  for update of v;
  if not found then
    raise exception 'Quiz question was not found.' using errcode = 'P0002';
  end if;
  if v_status <> 'draft' then
    raise exception 'Only draft quiz answer keys can be edited.' using errcode = '0A000';
  end if;

  select q.question_type into v_question_type
  from public.quiz_questions q
  join public.quizzes z on z.id = q.quiz_id
  join public.course_blocks b on b.id = z.course_block_id
  where q.id = p_question_id and b.course_version_id = v_version_id
  for update of q;
  if not found then
    raise exception 'Quiz question changed while saving. Reload and retry.' using errcode = '40001';
  end if;
  if v_question_type not in ('single_choice', 'true_false') then
    raise exception 'Select individual correct choices for a multiple-choice question.' using errcode = '22023';
  end if;

  perform 1 from public.quiz_answers
  where id = p_answer_id and question_id = p_question_id for update;
  if not found then
    raise exception 'The selected answer does not belong to this question.' using errcode = '22023';
  end if;

  update public.quiz_answers
  set is_correct = (id = p_answer_id)
  where question_id = p_question_id and is_correct is distinct from (id = p_answer_id);
end;
$$;
revoke all on function public.set_quiz_correct_answer(uuid, uuid) from public, anon, service_role;
grant execute on function public.set_quiz_correct_answer(uuid, uuid) to authenticated;
