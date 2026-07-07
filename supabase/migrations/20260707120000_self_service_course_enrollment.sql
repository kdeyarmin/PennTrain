-- Everyone can take courses, not just the `employee` role.
--
-- Course progress/quizzes/certificates are all FK-anchored to `employees`, not `profiles`
-- (see course_assignments.employee_id, quiz_attempts.employee_id -- both `not null`), and
-- historically only `employee`, `facility_manager`, and `trainer` accounts ever got an
-- `employees` row (see seed.sql). `org_admin`/`auditor`/`platform_admin` had no row to hang an
-- assignment off of, so there was no way for those roles to actually take a course themselves.
--
-- ensure_employee_record() lazily provisions an `employees` row the first time an account
-- without one tries to self-enroll (anchoring org-less platform_admin accounts to a dedicated
-- internal org/facility so their training records never leak into a real customer's compliance
-- reporting) -- NOT eagerly on every profile creation. Employee onboarding already inserts a
-- purpose-built `employees` row itself (real hire_date, job_title, trainer_status, etc. --
-- see seed.sql's per-account inserts and the admin "add employee" flow); an eager
-- after-insert-on-profiles trigger would race that and fail on employees_profile_id_key's
-- uniqueness the moment both tried to insert for the same brand-new profile.
--
-- self_enroll_course() is the actual self-service RPC, letting any role start a published
-- course on their own, the same way start_course_assignment()/complete_course_assignment()
-- already let a learner self-serve the rest of the course lifecycle.

create or replace function public.ensure_employee_record(p_profile_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  v_profile   public.profiles;
  v_org_id    uuid;
  v_facility_id uuid;
  v_job_title text;
begin
  select * into v_profile from public.profiles where id = p_profile_id;
  if not found then
    return;
  end if;

  if exists (select 1 from public.employees where profile_id = p_profile_id) then
    return;
  end if;

  v_org_id := v_profile.organization_id;

  if v_org_id is null then
    -- platform_admin accounts aren't scoped to any customer organization -- anchor their
    -- own training record to a dedicated internal org/facility instead of a real tenant's,
    -- so it never surfaces in a customer's facility compliance reporting.
    select id into v_org_id from public.organizations where slug = 'caremetric-train-internal';
    if v_org_id is null then
      insert into public.organizations (name, slug, subscription_status)
      values ('CareMetric Train (Internal)', 'caremetric-train-internal', 'active')
      returning id into v_org_id;
    end if;

    select id into v_facility_id from public.facilities where organization_id = v_org_id order by created_at limit 1;
    if v_facility_id is null then
      insert into public.facilities (organization_id, name, facility_type)
      values (v_org_id, 'Platform', 'ALR')
      returning id into v_facility_id;
    end if;
  else
    -- Prefer a facility they're explicitly assigned to (mirrors how facility_manager/trainer
    -- employees rows are seeded today); fall back to the org's first facility as an anchor --
    -- employees.facility_id is not null, so course tracking needs some facility on file even for
    -- an org_admin/auditor whose real job spans every facility in the org.
    select fa.facility_id into v_facility_id
    from public.facility_assignments fa
    where fa.profile_id = p_profile_id
    order by fa.created_at
    limit 1;

    if v_facility_id is null then
      select id into v_facility_id from public.facilities where organization_id = v_org_id order by created_at limit 1;
    end if;
  end if;

  -- No facility exists at all for this org yet -- nothing to anchor an employees row to.
  -- (Rare: would mean an org with zero facilities.) Leave it for a later call once one exists.
  if v_facility_id is null then
    return;
  end if;

  v_job_title := case v_profile.role
    when 'platform_admin' then 'Platform Administrator'
    when 'org_admin' then 'Organization Administrator'
    when 'facility_manager' then 'Facility Administrator'
    when 'trainer' then 'Trainer'
    when 'auditor' then 'Auditor'
    else 'Staff'
  end;

  insert into public.employees (
    organization_id, facility_id, profile_id, first_name, last_name, email, job_title, hire_date, status
  ) values (
    v_org_id, v_facility_id, p_profile_id, v_profile.first_name, v_profile.last_name, v_profile.email,
    v_job_title, v_profile.created_at::date, 'active'
  )
  on conflict (profile_id) do nothing;
end;
$$;
revoke all on function public.ensure_employee_record(uuid) from public, anon, authenticated;

-- Self-service enrollment: course_assignments_insert RLS restricts direct inserts to
-- org_admin/facility_manager/trainer assigning *someone else* (see group_c_rls_policies.sql) --
-- there's deliberately no path for a bare employee/auditor to insert their own row. This RPC is
-- that path: security definer (like start_course_assignment), scoped to the caller's own
-- employee record, idempotent if they're already enrolled.
create or replace function public.self_enroll_course(p_course_id uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_employee public.employees;
  v_course   public.courses;
  v_assignment_id uuid;
begin
  perform public.ensure_employee_record(auth.uid());

  select * into v_employee from public.employees where profile_id = auth.uid();
  if not found then
    raise exception 'no employee record for current user' using errcode = 'insufficient_privilege';
  end if;

  select * into v_course from public.courses where id = p_course_id;
  if not found or v_course.status <> 'published' or v_course.current_version_id is null then
    raise exception 'course is not available to enroll in' using errcode = 'invalid_parameter_value';
  end if;

  select id into v_assignment_id
  from public.course_assignments
  where employee_id = v_employee.id and course_id = p_course_id;

  if v_assignment_id is not null then
    return v_assignment_id;
  end if;

  insert into public.course_assignments (
    organization_id, facility_id, employee_id, course_id, course_version_id, assigned_by
  ) values (
    v_employee.organization_id, v_employee.facility_id, v_employee.id, p_course_id,
    v_course.current_version_id, auth.uid()
  )
  returning id into v_assignment_id;

  return v_assignment_id;
end;
$$;
revoke all on function public.self_enroll_course(uuid) from public, anon;
grant execute on function public.self_enroll_course(uuid) to authenticated;
