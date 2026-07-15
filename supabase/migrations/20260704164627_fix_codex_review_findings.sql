-- Fixes for real issues found by an automated PR review pass:
--
-- 1. RLS helper functions ignored profiles.is_active entirely. Deactivating a user
--    (admin-update-user setting is_active=false) does not revoke their existing Supabase Auth
--    session/JWT, so until now a "deactivated" user retained full RLS access for as long as
--    their session lasted (refreshable indefinitely) because current_role()/current_org_id()/
--    is_platform_admin()/is_assigned_to_facility()/owns_employee() never checked is_active.
--    Fix: every helper now treats an inactive profile as having no role/org/ownership at all,
--    so RLS immediately locks out a deactivated user on their very next request, regardless of
--    how long their existing token remains cryptographically valid.
create or replace function public.current_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and is_active;
$$;

create or replace function public.current_org_id() returns uuid
language sql stable security definer set search_path = public as $$
  select organization_id from public.profiles where id = auth.uid() and is_active;
$$;

create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'platform_admin' and is_active);
$$;

create or replace function public.is_assigned_to_facility(target_facility_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select
    public.is_platform_admin()
    or (select role from public.profiles where id = auth.uid() and is_active) in ('org_admin','auditor')
    or exists (
      select 1 from public.facility_assignments fa
      join public.profiles p on p.id = fa.profile_id
      where fa.profile_id = auth.uid() and fa.facility_id = target_facility_id and p.is_active
    );
$$;

create or replace function public.owns_employee(p_employee_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $function$
  select exists (
    select 1 from public.employees e
    join public.profiles p on p.id = e.profile_id
    where e.id = p_employee_id and e.profile_id = auth.uid() and p.is_active
  );
$function$;

-- 2. facilities_update allowed `current_role() = 'org_admin' OR is_assigned_to_facility(id)` --
--    but is_assigned_to_facility() itself already returns true unconditionally for org_admin AND
--    auditor, plus any facility_manager/trainer with a real facility_assignments row. That OR
--    branch therefore let auditor (read-only everywhere else in this app) and assigned
--    trainers update facility rows directly via PostgREST, even though facilities_insert/delete
--    are or_admin-only and the frontend's own canManage check
--    (["platform_admin","org_admin"].includes(user.role)) never exposed facility editing to
--    anyone else. Fix: match insert/delete exactly -- org_admin only.
alter policy facilities_update on public.facilities using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id()) and (select public.current_role()) = 'org_admin')
) with check (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id()) and (select public.current_role()) = 'org_admin')
);

-- 3. competency_records only had its organization_id stamped server-side from the referenced
--    employee (stamp_org_from_employee) -- facility_id was left as whatever the client sent.
--    Since competency_records_insert's check validates is_assigned_to_facility(facility_id) against
--    that same client-supplied value, a facility_manager/trainer assigned to Facility A could set
--    facility_id=A while employee_id belongs to Facility B in the same org, attributing the record
--    to the wrong facility (corrupting facility-level compliance reporting). Fix: reuse the
--    existing stamp_scope_from_employee() trigger (already used by course_assignments) which
--    stamps both organization_id AND facility_id from the employee row, so RLS re-validates
--    against the real facility after the trigger runs, not the client's claim.
drop trigger stamp_scope on public.competency_records;
create trigger stamp_scope before insert on public.competency_records
  for each row execute function public.stamp_scope_from_employee();
drop function public.stamp_org_from_employee();

-- 4. issue_certificate()'s owns_employee() branch let an employee mint a certificate for ANY
--    p_course_id by calling the RPC directly (bypassing the UI), since the function never checked
--    that p_course_assignment_id existed, was completed, or matched the given employee/course --
--    it could even be left null. Fix: require a real, completed, matching course_assignment.
create or replace function public.issue_certificate(
  p_employee_id          uuid,
  p_course_id            uuid,
  p_course_assignment_id uuid default null,
  p_expires_at           timestamptz default null
)
returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare v_org uuid; v_fac uuid; v_id uuid; v_assignment_ok boolean;
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

  if p_course_assignment_id is null then
    raise exception 'course_assignment_id is required to issue a certificate' using errcode = 'invalid_parameter_value';
  end if;
  select exists (
    select 1 from public.course_assignments ca
    where ca.id = p_course_assignment_id
      and ca.employee_id = p_employee_id
      and ca.course_id = p_course_id
      and ca.status = 'completed'
  ) into v_assignment_ok;
  if not v_assignment_ok then
    raise exception 'course_assignment % is not a completed assignment of employee % for course %',
      p_course_assignment_id, p_employee_id, p_course_id using errcode = 'insufficient_privilege';
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
