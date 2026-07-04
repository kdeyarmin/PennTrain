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
$function$;

-- ---------------------------------------------------------------------------
-- 2. (Codex, P2) notifications_select let platform_admin read every profile's
--    notifications, but the header hooks (unfiltered list/count) and the
--    mark-read RPCs (profile_id = auth.uid() only) both assume "whatever RLS
--    returns is mine" -- so a platform_admin session would show a system-wide
--    unread count, deep links for random employees, and "Mark all read"
--    could never clear it. This is a personal inbox, not an oversight tool;
--    scope it strictly to the caller regardless of role.
-- ---------------------------------------------------------------------------
alter policy notifications_select on public.notifications using (
  profile_id = (select auth.uid())
);

-- ---------------------------------------------------------------------------
-- 3. (Copilot) course_feedback_insert checked the referenced course_assignment
--    by employee_id/course_id but not organization_id, relying on an unstated
--    invariant that a profile's org always matches its linked employee's org.
--    Check it explicitly instead.
-- ---------------------------------------------------------------------------
alter policy course_feedback_insert on public.course_feedback with check (
  public.owns_employee(employee_id)
  and organization_id = (select public.current_org_id())
  and exists (
    select 1 from public.course_assignments ca
    where ca.id = course_feedback.course_assignment_id
      and ca.employee_id = course_feedback.employee_id
      and ca.course_id = course_feedback.course_id
      and ca.organization_id = course_feedback.organization_id
      and ca.status = 'completed'
  )
);

-- ---------------------------------------------------------------------------
-- 4. (Copilot) notify_training_alert mapped purely on alert_type text, but
--    practicum alerts reuse the training-record alert_type values ('overdue',
--    'due_30'), so a practicum alert was forwarded as notification_type
--    'training_expired'/'training_due_soon' -- mislabeling it. Gate on the
--    actual foreign key present on the row instead of alert_type alone, and
--    add distinct practicum notification types.
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint notifications_notification_type_check;
alter table public.notifications add constraint notifications_notification_type_check
  check (notification_type in (
    'course_assigned', 'quiz_graded', 'certificate_issued', 'training_due_soon', 'training_expired',
    'competency_recorded', 'missing_document', 'certificate_expiring',
    'practicum_due_soon', 'practicum_expired'
  ));

create or replace function public.notify_training_alert()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare v_profile_id uuid; v_notification_type text;
begin
  v_notification_type := case
    when new.alert_type = 'missing_document' then 'missing_document'
    when new.alert_type = 'certificate_expiring' then 'certificate_expiring'
    when new.practicum_id is not null and new.alert_type = 'overdue' then 'practicum_expired'
    when new.practicum_id is not null
         and new.alert_type in ('due_90', 'due_60', 'due_30', 'due_14', 'due_7') then 'practicum_due_soon'
    when new.training_record_id is not null and new.alert_type = 'overdue' then 'training_expired'
    when new.training_record_id is not null
         and new.alert_type in ('due_90', 'due_60', 'due_30', 'due_14', 'due_7') then 'training_due_soon'
    else null
  end;
  if new.employee_id is null or v_notification_type is null then
    return new;
  end if;
  select profile_id into v_profile_id from public.employees where id = new.employee_id;
  if v_profile_id is null then return new; end if;
  insert into public.notifications (organization_id, profile_id, notification_type, title, body, link)
  values (new.organization_id, v_profile_id, v_notification_type, new.title, new.message, '/me');
  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5. (Codex, P2) The quiz builder lets an author change a question's type
--    (e.g. multiple_choice -> single_choice) without normalizing its answer
--    key. grade_quiz_attempt compares the learner's selection against every
--    is_correct answer; if two were marked correct under multiple_choice and
--    the type changes to single_choice/true_false (whose UI only allows one
--    selection), the question becomes impossible to answer correctly. Enforce
--    this at the DB level (any client path that changes the type is covered),
--    not just in QuizBuilder's save handler: keep at most one is_correct
--    answer (lowest sort_order) whenever a question's type becomes anything
--    other than multiple_choice.
-- ---------------------------------------------------------------------------
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
  for each row
  when (new.question_type is distinct from old.question_type)
  execute function public.normalize_answers_on_question_type_change();
