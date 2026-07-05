-- Backfilled from the live "CM Train" database (project xsqobvvreaovwibxwyvv) after this
-- repo's local supabase/migrations/ was discovered to have drifted from production -- this
-- migration and the five that follow it (through 20260704240000) were applied directly and
-- never committed. Supabase's migration history only records version + name, not the original
-- SQL, so the content below was reconstructed from the live schema/function/trigger definitions
-- via pg_get_functiondef and catalog introspection rather than recovered verbatim. It reproduces
-- the current live end state exactly (verified against pg_proc/pg_trigger/information_schema).
--
-- Adds a per-question "explanation" shown to a learner after they submit a quiz attempt, plus a
-- get_quiz_review() RPC to fetch it (and the answer key) once -- and only once -- an attempt has
-- been submitted. See the 20260704240000 migration for a defense-in-depth gap this introduced
-- that was found during reconstruction and is intentionally left unresolved pending a design
-- decision (explanation has no RLS role restriction the way quiz_answers.is_correct does).

alter table public.quiz_questions add column explanation text;

-- If a question is edited down to true_false/single_choice after having multiple correct
-- answers marked (only valid for multiple_choice), keep the lowest sort_order correct answer
-- and clear the rest -- otherwise grade_quiz_attempt's set-equality check against
-- selected_answer_ids could never be satisfied by a single selection.
create or replace function public.normalize_answers_on_question_type_change()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare v_keep_id uuid;
begin
  if new.question_type = 'multiple_choice' then
    return new;
  end if;

  select id into v_keep_id from public.quiz_answers
  where question_id = new.id and is_correct
  order by sort_order
  limit 1;

  update public.quiz_answers
  set is_correct = false
  where question_id = new.id
    and is_correct
    and (v_keep_id is null or id <> v_keep_id);

  return new;
end;
$function$;

create trigger normalize_answers_on_type_change after update on public.quiz_questions
  for each row execute function public.normalize_answers_on_question_type_change();

-- Returns the answer key + explanation for a submitted attempt. Visible to: platform admins;
-- org_admin/facility_manager/trainer in the attempt's own org; or the employee who took it, but
-- only once they've passed or exhausted their attempts (so a still-in-progress learner can't use
-- this to see the answer key mid-quiz on a later attempt).
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
$function$;

grant execute on function public.get_quiz_review(uuid) to authenticated;
