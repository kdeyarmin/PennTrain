-- SECTION 3 — TRIGGER FUNCTIONS (RLS helper, scope-stamping, column protection)

create or replace function public.owns_employee(p_employee_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $function$
  select exists (
    select 1 from public.employees e
    where e.id = p_employee_id and e.profile_id = auth.uid()
  );
$function$;

create or replace function public.stamp_scope_from_employee()
returns trigger language plpgsql set search_path to 'public' as $function$
declare v_org uuid; v_fac uuid;
begin
  select organization_id, facility_id into v_org, v_fac from public.employees where id = new.employee_id;
  if v_org is null then
    raise exception 'employee % not found', new.employee_id using errcode = 'foreign_key_violation';
  end if;
  new.organization_id := v_org;
  new.facility_id     := v_fac;
  return new;
end;
$function$;

create or replace function public.stamp_org_from_employee()
returns trigger language plpgsql set search_path to 'public' as $function$
declare v_org uuid;
begin
  select organization_id into v_org from public.employees where id = new.employee_id;
  if v_org is null then
    raise exception 'employee % not found', new.employee_id using errcode = 'foreign_key_violation';
  end if;
  new.organization_id := v_org;
  return new;
end;
$function$;

create or replace function public.stamp_quiz_attempt_from_assignment()
returns trigger language plpgsql set search_path to 'public' as $function$
declare v_org uuid; v_fac uuid; v_emp uuid; v_assign_ver uuid; v_quiz_ver uuid;
begin
  select organization_id, facility_id, employee_id, course_version_id
    into v_org, v_fac, v_emp, v_assign_ver
    from public.course_assignments where id = new.assignment_id;
  if v_org is null then
    raise exception 'assignment % not found', new.assignment_id using errcode = 'foreign_key_violation';
  end if;
  new.organization_id := v_org;
  new.facility_id     := v_fac;
  new.employee_id     := v_emp;
  select cb.course_version_id into v_quiz_ver
    from public.quizzes qz
    join public.course_blocks cb on cb.id = qz.course_block_id
   where qz.id = new.quiz_id;
  if v_quiz_ver is distinct from v_assign_ver then
    raise exception 'quiz % does not belong to the assigned training content version %', new.quiz_id, v_assign_ver
      using errcode = 'check_violation';
  end if;
  return new;
end;
$function$;

create or replace function public.protect_course_assignment_fields()
returns trigger language plpgsql set search_path to 'public' as $function$
begin
  if public.is_platform_admin() or coalesce(current_setting('app.privileged_write', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.status := 'assigned';
    new.completed_at := null;
  else
    new.status := old.status;
    new.completed_at := old.completed_at;
  end if;
  return new;
end;
$function$;

create or replace function public.protect_quiz_attempt_fields()
returns trigger language plpgsql set search_path to 'public' as $function$
begin
  if public.is_platform_admin() or coalesce(current_setting('app.privileged_write', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.score_percent := null;
    new.passed := null;
  else
    new.score_percent := old.score_percent;
    new.passed := old.passed;
  end if;
  return new;
end;
$function$;

create or replace function public.protect_quiz_attempt_answer_fields()
returns trigger language plpgsql set search_path to 'public' as $function$
begin
  if public.is_platform_admin() or coalesce(current_setting('app.privileged_write', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.is_correct := null;
  else
    new.is_correct := old.is_correct;
  end if;
  return new;
end;
$function$;

create or replace function public.protect_certificate_write()
returns trigger language plpgsql set search_path to 'public' as $function$
begin
  if public.is_platform_admin() or coalesce(current_setting('app.privileged_write', true), '') = 'on' then
    return case tg_op when 'DELETE' then old else new end;
  end if;
  raise exception 'certificates are not directly writable by clients; use issue_certificate() / service role'
    using errcode = 'insufficient_privilege';
end;
$function$;


-- SECTION 3B — ATTACH TRIGGERS (updated_at, scope-stamp, protection, audit)

create trigger set_updated_at before update on public.courses               for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.course_assignments    for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.course_progress       for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.quiz_attempts         for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.training_plans        for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.competency_templates  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.competency_records    for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.certificates          for each row execute function public.set_updated_at();

create trigger stamp_scope before insert on public.course_assignments for each row execute function public.stamp_scope_from_employee();
create trigger stamp_scope before insert on public.quiz_attempts      for each row execute function public.stamp_quiz_attempt_from_assignment();
create trigger stamp_scope before insert on public.competency_records for each row execute function public.stamp_org_from_employee();

create trigger protect_fields before insert or update on public.course_assignments   for each row execute function public.protect_course_assignment_fields();
create trigger protect_fields before insert or update on public.quiz_attempts         for each row execute function public.protect_quiz_attempt_fields();
create trigger protect_fields before insert or update on public.quiz_attempt_answers  for each row execute function public.protect_quiz_attempt_answer_fields();
create trigger protect_write  before insert or update or delete on public.certificates for each row execute function public.protect_certificate_write();

create trigger audit_log after insert or update or delete on public.courses              for each row execute function public.audit_log_trigger();
create trigger audit_log after insert or update or delete on public.course_assignments   for each row execute function public.audit_log_trigger();
create trigger audit_log after insert or update or delete on public.certificates         for each row execute function public.audit_log_trigger();
create trigger audit_log after insert or update or delete on public.competency_records   for each row execute function public.audit_log_trigger();
create trigger audit_log after insert or update or delete on public.training_plans       for each row execute function public.audit_log_trigger();
create trigger audit_log after insert or update or delete on public.competency_templates for each row execute function public.audit_log_trigger();


-- SECTION 3C — COURSE-VERSION IMMUTABILITY LOCK (review data-model-fitness Gap 1, Major)

create or replace function public.course_version_is_published(p_version_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $function$
  select coalesce(
    (select v.status = 'published' from public.course_versions v where v.id = p_version_id),
    false);
$function$;

create or replace function public.lock_published_course_version()
returns trigger language plpgsql set search_path to 'public' as $function$
begin
  if public.is_platform_admin() then
    return case tg_op when 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    if old.status = 'published' then
      raise exception 'cannot delete published (immutable) course version %; create a new version', old.id
        using errcode = '0A000';
    end if;
    return old;
  end if;
  if old.status = 'published' then
    raise exception 'course version % is published and immutable; create a new version to make changes', old.id
      using errcode = '0A000';
  end if;
  return new;
end;
$function$;

create or replace function public.lock_published_course_block()
returns trigger language plpgsql set search_path to 'public' as $function$
declare v_ver uuid;
begin
  if public.is_platform_admin() then
    return case tg_op when 'DELETE' then old else new end;
  end if;
  v_ver := case when tg_op = 'DELETE' then old.course_version_id else new.course_version_id end;
  if public.course_version_is_published(v_ver) then
    raise exception 'course_block belongs to published (immutable) course version %; create a new version to edit', v_ver
      using errcode = '0A000';
  end if;
  return case tg_op when 'DELETE' then old else new end;
end;
$function$;

create or replace function public.enforce_quiz_block_rules()
returns trigger language plpgsql set search_path to 'public' as $function$
declare v_ver uuid; v_type text; v_block uuid;
begin
  if public.is_platform_admin() then
    return case tg_op when 'DELETE' then old else new end;
  end if;
  v_block := case when tg_op = 'DELETE' then old.course_block_id else new.course_block_id end;
  select cb.course_version_id, cb.block_type into v_ver, v_type
    from public.course_blocks cb where cb.id = v_block;
  if public.course_version_is_published(v_ver) then
    raise exception 'quiz belongs to published (immutable) course version %; create a new version to edit', v_ver
      using errcode = '0A000';
  end if;
  if tg_op <> 'DELETE' and v_type is distinct from 'quiz' then
    raise exception 'a quiz may only attach to a course_block of block_type = ''quiz'' (block % is %)',
      v_block, coalesce(v_type, '<missing>') using errcode = 'check_violation';
  end if;
  return case tg_op when 'DELETE' then old else new end;
end;
$function$;

create or replace function public.lock_published_quiz_question()
returns trigger language plpgsql set search_path to 'public' as $function$
declare v_ver uuid; v_quiz uuid;
begin
  if public.is_platform_admin() then
    return case tg_op when 'DELETE' then old else new end;
  end if;
  v_quiz := case when tg_op = 'DELETE' then old.quiz_id else new.quiz_id end;
  select cb.course_version_id into v_ver
    from public.quizzes qz
    join public.course_blocks cb on cb.id = qz.course_block_id
   where qz.id = v_quiz;
  if public.course_version_is_published(v_ver) then
    raise exception 'quiz_question belongs to published (immutable) course version %; create a new version to edit', v_ver
      using errcode = '0A000';
  end if;
  return case tg_op when 'DELETE' then old else new end;
end;
$function$;

create or replace function public.lock_published_quiz_answer()
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
    raise exception 'quiz_answer belongs to published (immutable) course version %; create a new version to edit', v_ver
      using errcode = '0A000';
  end if;
  return case tg_op when 'DELETE' then old else new end;
end;
$function$;

create trigger lock_published    before update or delete           on public.course_versions for each row execute function public.lock_published_course_version();
create trigger lock_published    before insert or update or delete on public.course_blocks    for each row execute function public.lock_published_course_block();
create trigger enforce_quiz_rules before insert or update or delete on public.quizzes          for each row execute function public.enforce_quiz_block_rules();
create trigger lock_published    before insert or update or delete on public.quiz_questions   for each row execute function public.lock_published_quiz_question();
create trigger lock_published    before insert or update or delete on public.quiz_answers     for each row execute function public.lock_published_quiz_answer();
