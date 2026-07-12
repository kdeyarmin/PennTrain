-- security definer RPCs backing AI curriculum generation. Modeled directly on the hand-written
-- multi-table insert pattern in 20260704234451_seed_required_inservice_courses.sql
-- (course -> course_versions -> course_blocks -> quizzes -> quiz_questions -> quiz_answers, plus
-- quiz_question_explanations), parameterized from JSONB instead of hardcoded literals, and on the
-- RPC style established in 20260704073418_group_c_rpcs.sql (plpgsql, security definer,
-- set search_path to 'public', explicit authorization check that raises insufficient_privilege,
-- revoke/grant at the bottom).
--
-- Expected shape of p_draft:
-- {
--   "title": text, "description": text, "category": text,
--   "estimated_duration_minutes": integer,
--   "modules": [
--     {
--       "block_type": "text" | "video" | "quiz",
--       "title": text,
--       "content": text,           -- for block_type = 'text'
--       "script": text,            -- for block_type = 'video'
--       "quiz": {                  -- optional, attaches a sibling quiz block right after this module
--         "title": text,
--         "passing_score_percent": integer (default 80),
--         "questions": [
--           {
--             "question_text": text, "question_type": text, "points": integer,
--             "explanation": text,  -- optional
--             "answers": [ { "answer_text": text, "is_correct": boolean } ]
--           }
--         ]
--       }
--     }
--   ]
-- }
--
-- Video-type modules store their AI-authored narration under course_blocks.body.script -- a new
-- sibling key next to the existing body.heygen job-state key written later by the HeyGen pipeline.
--
-- DEVIATION FROM SPEC: the plan puts `course_versions.ai_generated` in a later migration
-- (add_course_ai_generation_review_gate.sql), but this RPC must set ai_generated=true on every
-- row it inserts. Adding the column here, ahead of the review-gate trigger migration, avoids a
-- migration that references a column that doesn't exist yet. The review-gate migration adds the
-- remaining two review-tracking columns (ai_reviewed_at/ai_reviewed_by) and the enforcement
-- trigger; it no longer re-adds ai_generated.
alter table public.course_versions add column ai_generated boolean not null default false;

create or replace function public.create_course_from_ai_draft(p_draft jsonb, p_generation_id uuid)
returns table(course_id uuid, course_version_id uuid)
language plpgsql security definer set search_path to 'public' as $function$
declare
  v_course_id uuid;
  v_version_id uuid;
  v_block_id uuid;
  v_quiz_id uuid;
  v_question_id uuid;
  v_module jsonb;
  v_quiz jsonb;
  v_question jsonb;
  v_answer jsonb;
  v_sort_order integer;
begin
  if not public.is_platform_admin() then
    raise exception 'not authorized' using errcode = 'insufficient_privilege';
  end if;

  insert into public.courses (organization_id, title, description, category, status, estimated_duration_minutes, created_by)
  values (
    null,
    p_draft->>'title',
    p_draft->>'description',
    p_draft->>'category',
    'draft',
    nullif(p_draft->>'estimated_duration_minutes', '')::integer,
    auth.uid()
  )
  returning id into v_course_id;

  insert into public.course_versions (course_id, organization_id, version_number, status, ai_generated, title, description)
  values (
    v_course_id,
    null,
    1,
    'draft',
    true,
    p_draft->>'title',
    p_draft->>'description'
  )
  returning id into v_version_id;

  update public.courses set current_version_id = v_version_id where id = v_course_id;

  v_sort_order := 0;
  for v_module in select * from jsonb_array_elements(p_draft->'modules')
  loop
    v_sort_order := v_sort_order + 1;

    if v_module->>'block_type' = 'text' then
      insert into public.course_blocks (course_version_id, block_type, sort_order, title, body)
      values (v_version_id, 'text', v_sort_order, v_module->>'title',
        jsonb_build_object('content', v_module->>'content'))
      returning id into v_block_id;

    elsif v_module->>'block_type' = 'video' then
      insert into public.course_blocks (course_version_id, block_type, sort_order, title, body)
      values (v_version_id, 'video', v_sort_order, v_module->>'title',
        jsonb_build_object('script', v_module->>'script'))
      returning id into v_block_id;
    end if;

    if v_module ? 'quiz' then
      v_quiz := v_module->'quiz';
      v_sort_order := v_sort_order + 1;

      insert into public.course_blocks (course_version_id, block_type, sort_order, title)
      values (v_version_id, 'quiz', v_sort_order, coalesce(v_quiz->>'title', v_module->>'title'))
      returning id into v_block_id;

      insert into public.quizzes (course_block_id, organization_id, title, passing_score_percent)
      values (
        v_block_id,
        null,
        coalesce(v_quiz->>'title', v_module->>'title'),
        coalesce(nullif(v_quiz->>'passing_score_percent', '')::integer, 80)
      )
      returning id into v_quiz_id;

      declare
        v_q_sort integer := 0;
      begin
        for v_question in select * from jsonb_array_elements(v_quiz->'questions')
        loop
          v_q_sort := v_q_sort + 1;

          insert into public.quiz_questions (quiz_id, question_text, question_type, sort_order, points)
          values (
            v_quiz_id,
            v_question->>'question_text',
            coalesce(v_question->>'question_type', 'single_choice'),
            v_q_sort,
            coalesce(nullif(v_question->>'points', '')::integer, 1)
          )
          returning id into v_question_id;

          declare
            v_a_sort integer := 0;
          begin
            for v_answer in select * from jsonb_array_elements(v_question->'answers')
            loop
              v_a_sort := v_a_sort + 1;
              insert into public.quiz_answers (question_id, answer_text, is_correct, sort_order)
              values (
                v_question_id,
                v_answer->>'answer_text',
                coalesce((v_answer->>'is_correct')::boolean, false),
                v_a_sort
              );
            end loop;
          end;

          if v_question ? 'explanation' and length(trim(coalesce(v_question->>'explanation', ''))) > 0 then
            insert into public.quiz_question_explanations (question_id, organization_id, explanation)
            values (v_question_id, null, v_question->>'explanation');
          end if;
        end loop;
      end;
    end if;
  end loop;

  update public.course_ai_generations
     set course_id = v_course_id,
         course_version_id = v_version_id,
         status = 'completed'
   where id = p_generation_id;

  return query select v_course_id, v_version_id;
end;
$function$;

revoke all on function public.create_course_from_ai_draft(jsonb, uuid) from public;
grant execute on function public.create_course_from_ai_draft(jsonb, uuid) to authenticated;


-- Atomic quiz-question regeneration for the "regenerate with AI" flow (regenerate-course-block
-- Edge Function). quiz_answers.question_id and quiz_question_explanations.question_id both carry
-- `on delete cascade` back to quiz_questions (confirmed via information_schema.referential_constraints
-- before writing this function), so deleting quiz_questions for p_quiz_id is sufficient -- no
-- separate explicit delete of quiz_answers/quiz_question_explanations is needed.
create or replace function public.replace_quiz_questions(p_quiz_id uuid, p_questions jsonb)
returns void
language plpgsql security definer set search_path to 'public' as $function$
declare
  v_question jsonb;
  v_answer jsonb;
  v_question_id uuid;
  v_q_sort integer := 0;
  v_a_sort integer;
begin
  if not public.is_platform_admin() then
    raise exception 'not authorized' using errcode = 'insufficient_privilege';
  end if;

  delete from public.quiz_questions where quiz_id = p_quiz_id;

  for v_question in select * from jsonb_array_elements(p_questions)
  loop
    v_q_sort := v_q_sort + 1;

    insert into public.quiz_questions (quiz_id, question_text, question_type, sort_order, points)
    values (
      p_quiz_id,
      v_question->>'question_text',
      coalesce(v_question->>'question_type', 'single_choice'),
      v_q_sort,
      coalesce(nullif(v_question->>'points', '')::integer, 1)
    )
    returning id into v_question_id;

    v_a_sort := 0;
    for v_answer in select * from jsonb_array_elements(v_question->'answers')
    loop
      v_a_sort := v_a_sort + 1;
      insert into public.quiz_answers (question_id, answer_text, is_correct, sort_order)
      values (
        v_question_id,
        v_answer->>'answer_text',
        coalesce((v_answer->>'is_correct')::boolean, false),
        v_a_sort
      );
    end loop;

    if v_question ? 'explanation' and length(trim(coalesce(v_question->>'explanation', ''))) > 0 then
      insert into public.quiz_question_explanations (question_id, organization_id, explanation)
      values (v_question_id, null, v_question->>'explanation');
    end if;
  end loop;
end;
$function$;

revoke all on function public.replace_quiz_questions(uuid, jsonb) from public;
grant execute on function public.replace_quiz_questions(uuid, jsonb) to authenticated;
