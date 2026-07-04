-- SECTION 6 — SECURITY DEFINER RPCs (public verification + trusted mutators)

create or replace function public.verify_certificate(p_slug text)
returns table (
  employee_name     text,
  course_title      text,
  organization_name text,
  issued_at         timestamptz,
  expires_at        timestamptz,
  is_valid          boolean
)
language sql stable security definer set search_path to 'public' as $function$
  select
    (e.first_name || ' ' || e.last_name)::text,
    c.title,
    o.name,
    cert.issued_at,
    cert.expires_at,
    (cert.expires_at is null or cert.expires_at > now())
  from public.certificates cert
  join public.employees     e on e.id = cert.employee_id
  join public.courses       c on c.id = cert.course_id
  join public.organizations o on o.id = cert.organization_id
  where cert.slug = p_slug;
$function$;
revoke all on function public.verify_certificate(text) from public;
grant execute on function public.verify_certificate(text) to anon, authenticated;

create or replace function public.complete_course_assignment(p_assignment_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_org uuid; v_emp uuid;
begin
  select organization_id, employee_id into v_org, v_emp
  from public.course_assignments where id = p_assignment_id;
  if v_org is null then
    raise exception 'assignment % not found', p_assignment_id using errcode = 'no_data_found';
  end if;
  if not (
    public.is_platform_admin()
    or (v_org = public.current_org_id() and public."current_role"() in ('org_admin','facility_manager','trainer'))
    or public.owns_employee(v_emp)
  ) then
    raise exception 'not authorized' using errcode = 'insufficient_privilege';
  end if;
  perform set_config('app.privileged_write', 'on', true);
  update public.course_assignments
     set status = 'completed', completed_at = now()
   where id = p_assignment_id;
end;
$function$;
revoke all on function public.complete_course_assignment(uuid) from public;
grant execute on function public.complete_course_assignment(uuid) to authenticated;

create or replace function public.grade_quiz_attempt(p_attempt_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_quiz_id uuid; v_org uuid; v_emp uuid; v_pass integer; v_score numeric;
begin
  select quiz_id, organization_id, employee_id into v_quiz_id, v_org, v_emp
  from public.quiz_attempts where id = p_attempt_id;
  if v_quiz_id is null then
    raise exception 'attempt % not found', p_attempt_id using errcode = 'no_data_found';
  end if;
  if not (
    public.is_platform_admin()
    or (v_org = public.current_org_id() and public."current_role"() in ('org_admin','facility_manager','trainer'))
    or public.owns_employee(v_emp)
  ) then
    raise exception 'not authorized' using errcode = 'insufficient_privilege';
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
revoke all on function public.grade_quiz_attempt(uuid) from public;
grant execute on function public.grade_quiz_attempt(uuid) to authenticated;

create or replace function public.issue_certificate(
  p_employee_id          uuid,
  p_course_id            uuid,
  p_course_assignment_id uuid default null,
  p_expires_at           timestamptz default null
)
returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare v_org uuid; v_fac uuid; v_id uuid;
begin
  select organization_id, facility_id into v_org, v_fac from public.employees where id = p_employee_id;
  if v_org is null then
    raise exception 'employee % not found', p_employee_id using errcode = 'no_data_found';
  end if;
  if not (
    public.is_platform_admin()
    or (v_org = public.current_org_id() and public."current_role"() in ('org_admin','facility_manager','trainer'))
  ) then
    raise exception 'not authorized' using errcode = 'insufficient_privilege';
  end if;
  perform set_config('app.privileged_write', 'on', true);
  insert into public.certificates
    (organization_id, facility_id, employee_id, course_id, course_assignment_id, issued_at, expires_at)
  values
    (v_org, v_fac, p_employee_id, p_course_id, p_course_assignment_id, now(), p_expires_at)
  returning id into v_id;
  return v_id;
end;
$function$;
revoke all on function public.issue_certificate(uuid, uuid, uuid, timestamptz) from public;
grant execute on function public.issue_certificate(uuid, uuid, uuid, timestamptz) to authenticated;
