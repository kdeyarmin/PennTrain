-- Sixth-pass: DEFINER writers that still admitted FM/trainer without facility assignment.
--
-- 1. ensure_training_requirement_record -- sibling save_training_record requires assignment
-- 2. grade_quiz_attempt / get_quiz_review -- sibling quiz_attempt_answers RLS requires assignment

CREATE OR REPLACE FUNCTION public.ensure_training_requirement_record(p_employee_id uuid, p_training_type_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_org uuid; v_fac uuid;
begin
  select organization_id, facility_id into v_org, v_fac from public.employees where id = p_employee_id;
  if v_org is null then
    raise exception 'employee % not found', p_employee_id using errcode = 'no_data_found';
  end if;
  if not coalesce((
    public.is_platform_admin()
    or (
      v_org = public.current_org_id()
      and public.current_role() in ('org_admin','facility_manager','trainer')
      and public.is_assigned_to_facility(v_fac)
    )
  ), false) then
    raise exception 'not authorized' using errcode = 'insufficient_privilege';
  end if;

  insert into public.employee_training_records (organization_id, facility_id, employee_id, training_type_id, status, document_required)
  select v_org, v_fac, p_employee_id, tt.id, 'missing', tt.document_required
  from public.training_types tt
  where tt.id = p_training_type_id
    and not exists (
      select 1 from public.employee_training_records r
      where r.employee_id = p_employee_id and r.training_type_id = p_training_type_id
    );
end;
$function$;

create or replace function public.grade_quiz_attempt(p_attempt_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare
  v_quiz_id uuid;
  v_org uuid;
  v_emp uuid;
  v_facility uuid;
  v_pass integer;
  v_score numeric;
  v_submitted_at timestamptz;
  v_is_reviewer boolean;
begin
  select quiz_id, organization_id, employee_id, facility_id, submitted_at
    into v_quiz_id, v_org, v_emp, v_facility, v_submitted_at
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

create or replace function public.get_quiz_review(p_attempt_id uuid)
returns table(question_id uuid, answer_id uuid, answer_text text, is_correct boolean, explanation text)
language sql stable security definer set search_path to 'public' as $function$
  with target as (
    select att.id, att.employee_id, att.organization_id, att.facility_id, att.passed, att.submitted_at,
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
      or (
        t.organization_id = public.current_org_id()
        and public.current_role() in ('org_admin', 'facility_manager', 'trainer')
        and public.is_assigned_to_facility(t.facility_id)
      )
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
