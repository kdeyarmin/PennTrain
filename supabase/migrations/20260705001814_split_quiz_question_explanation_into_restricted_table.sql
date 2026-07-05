-- quiz_questions.explanation (added by 20260704190000_quiz_question_explanations_and_review.sql)
-- had no role restriction: quiz_questions_select allows any employee in the org to read the full
-- row (needed so learners can see question_text while taking a quiz), so explanation -- which
-- typically confirms/describes the correct answer -- was readable via a direct table query
-- before a learner ever attempted the quiz. Unlike quiz_answers.is_correct, this can't be fixed
-- with a column-level revoke: app-level roles (employee vs. org_admin/trainer) all map to the
-- same `authenticated` Postgres role, so a column grant can't distinguish between them the way
-- quiz_answers' row-level policy (restricted to org_admin/trainer/auditor) already does.
--
-- Splits explanation into its own table with the same row-level restriction as quiz_answers, so
-- get_quiz_review() remains the only sanctioned way for a learner to see it (already correctly
-- gated on submitted_at + passed/attempts-exhausted). At the time this migration was written, no
-- frontend code read or wrote quiz_questions.explanation; the QuizBuilder authoring UI and its
-- useQuizzes.ts hooks (useListQuizQuestions/useCreateQuizQuestion/useUpdateQuizQuestion) were
-- added later by a separately-merged PR and have since been updated to join/upsert/delete against
-- quiz_question_explanations instead of a plain column.

create table public.quiz_question_explanations (
  question_id     uuid primary key references public.quiz_questions(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  explanation     text not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

insert into public.quiz_question_explanations (question_id, organization_id, explanation)
select id, organization_id, explanation
from public.quiz_questions
where explanation is not null and length(trim(explanation)) > 0;

alter table public.quiz_questions drop column explanation;

create trigger set_updated_at before update on public.quiz_question_explanations
  for each row execute function public.set_updated_at();

alter table public.quiz_question_explanations enable row level security;

-- Every policy below checks the *owning question's* organization_id, not just the value the
-- caller put in the new/existing explanation row -- otherwise an org_admin/trainer could insert
-- an explanation row for any question_id they can merely see (including a null-org system-catalog
-- question, or one they simply guessed) by setting the row's own organization_id to their own
-- org. Since question_id is this table's primary key (one explanation per question, globally),
-- that row would then be joined into get_quiz_review for every tenant reviewing that question --
-- a cross-tenant leak/poisoning vector column-level organization_id checks alone don't catch.
create policy quiz_question_explanations_select on public.quiz_question_explanations for select to authenticated using (
  (select is_platform_admin())
  or (
    (select "current_role"()) in ('org_admin', 'trainer', 'auditor')
    and exists (
      select 1 from public.quiz_questions qq
      where qq.id = quiz_question_explanations.question_id
        and qq.organization_id = (select current_org_id())
    )
  )
);
create policy quiz_question_explanations_insert on public.quiz_question_explanations for insert to authenticated with check (
  (select is_platform_admin())
  or (
    (select "current_role"()) in ('org_admin', 'trainer')
    and organization_id = (select current_org_id())
    and exists (
      select 1 from public.quiz_questions qq
      where qq.id = quiz_question_explanations.question_id
        and qq.organization_id = (select current_org_id())
    )
  )
);
create policy quiz_question_explanations_update on public.quiz_question_explanations for update to authenticated
using (
  (select is_platform_admin())
  or (
    (select "current_role"()) in ('org_admin', 'trainer')
    and organization_id = (select current_org_id())
    and exists (
      select 1 from public.quiz_questions qq
      where qq.id = quiz_question_explanations.question_id
        and qq.organization_id = (select current_org_id())
    )
  )
)
with check (
  (select is_platform_admin())
  or (
    (select "current_role"()) in ('org_admin', 'trainer')
    and organization_id = (select current_org_id())
    and exists (
      select 1 from public.quiz_questions qq
      where qq.id = quiz_question_explanations.question_id
        and qq.organization_id = (select current_org_id())
    )
  )
);
create policy quiz_question_explanations_delete on public.quiz_question_explanations for delete to authenticated using (
  (select is_platform_admin())
  or (
    (select "current_role"()) in ('org_admin', 'trainer')
    and organization_id = (select current_org_id())
    and exists (
      select 1 from public.quiz_questions qq
      where qq.id = quiz_question_explanations.question_id
        and qq.organization_id = (select current_org_id())
    )
  )
);

-- Same immutable-once-published governance as quiz_questions/quiz_answers.
create or replace function public.lock_published_quiz_question_explanation()
returns trigger language plpgsql set search_path to 'public' as $function$
declare v_ver uuid; v_q uuid;
begin
  if public.is_platform_admin() then
    return case tg_op when 'DELETE' then old else new end;
  end if;
  v_q := case when tg_op = 'DELETE' then old.question_id else new.question_id end;
  select cb.course_version_id into v_ver
    from public.quiz_questions qq
    join public.quizzes qz on qz.id = qq.quiz_id
    join public.course_blocks cb on cb.id = qz.course_block_id
   where qq.id = v_q;
  if public.course_version_is_published(v_ver) then
    raise exception 'quiz_question_explanation belongs to published (immutable) course version %; create a new version to edit', v_ver
      using errcode = '0A000';
  end if;
  return case tg_op when 'DELETE' then old else new end;
end;
$function$;
create trigger lock_published before insert or update or delete on public.quiz_question_explanations
  for each row execute function public.lock_published_quiz_question_explanation();

-- Point get_quiz_review() at the new table instead of the dropped column.
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
