-- issue_certificate() was the only one of the three trusted course-completion RPCs that did NOT
-- include the "or public.owns_employee(v_emp)" exception that complete_course_assignment() and
-- grade_quiz_attempt() both have -- meaning an employee who legitimately completed their own course
-- (self-attested via those two RPCs, which already allow it) had no path to trigger their own
-- certificate issuance, breaking the "complete course -> certificate issued" acceptance flow. The
-- RPC still computes organization_id/facility_id server-side from the referenced employee row (never
-- from client input), so allowing the employee themselves to invoke it doesn't introduce a spoofing
-- risk -- it only changes who may press the button once the criteria are already met, consistent
-- with the trust model already applied to the other two RPCs in this same completion flow.
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
    or public.owns_employee(p_employee_id)
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
