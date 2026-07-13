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
-- already let an employee self-serve the rest of the training lifecycle.

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
    --
    -- Serializes concurrent bootstrap of that shared org/facility -- without this, two
    -- concurrent platform_admin self-enrolls could both miss the "does it exist" checks below
    -- and then both attempt the organizations insert, with the losing transaction aborting on
    -- organizations_slug_key's unique constraint instead of just reusing the winner's row.
    perform pg_advisory_xact_lock(hashtext('ensure_employee_record:internal-org-bootstrap'));

    select id into v_org_id from public.organizations where slug = 'caremetric-carebase-internal';
    if v_org_id is null then
      insert into public.organizations (name, slug, subscription_status)
      values ('CareMetric CareBase (Internal)', 'caremetric-carebase-internal', 'active')
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

  -- Matches ROLE_LABELS in src/pages/app/Users.tsx exactly -- this is the one place outside the
  -- frontend that renders a role as a human label, and a wording mismatch (e.g. "Facility
  -- Administrator" here vs. "Facility Manager" there) would show two different titles for the
  -- same account depending which page you look at.
  v_job_title := case v_profile.role
    when 'platform_admin' then 'Platform Admin'
    when 'org_admin' then 'Org Admin'
    when 'facility_manager' then 'Facility Manager'
    when 'trainer' then 'Trainer'
    when 'auditor' then 'Auditor'
    else 'Employee'
  end;

  -- status is deliberately 'inactive', not 'active': trigger_instantiate_requirements_on_employee_change()
  -- (pa_rulepack_requirement_auto_assignment_engine.sql) fires on every employees insert and calls
  -- instantiate_missing_requirements(), which only actually does anything `if v_emp.status = 'active'`.
  -- A self-provisioned administrative account (org_admin/auditor/platform_admin just trying a course,
  -- not a real hire) letting that engine run would create real "missing" employee_training_records
  -- and employee_credentials rows (Act 34 criminal history, TB screening) that count against the
  -- facility's actual regulatory compliance percentage and Survey Readiness reports -- exactly the
  -- numbers this app exists to report accurately for a real PA-licensed facility. 'inactive' skips
  -- that engine entirely; it does not block this account from taking its own course, since every RLS
  -- policy on course_assignments/course_progress/quiz_attempts gates on owns_employee() (which checks
  -- profiles.is_active, not employees.status), and enforce_employee_limit() still (correctly) counts
  -- this row against the org's plan seat limit regardless of status, same as a real hire would.
  insert into public.employees (
    organization_id, facility_id, profile_id, first_name, last_name, email, job_title, hire_date, status
  ) values (
    v_org_id, v_facility_id, p_profile_id, v_profile.first_name, v_profile.last_name, v_profile.email,
    v_job_title, v_profile.created_at::date, 'inactive'
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
  v_version_status text;
  v_version_ai_generated boolean;
  v_version_ai_reviewed_at timestamptz;
  v_assignment_id uuid;
begin
  -- Only call ensure_employee_record on an actual miss -- avoids a redundant profiles/employees
  -- round trip on every self-enroll for the common case (employee/facility_manager/trainer
  -- accounts, which already have a row from onboarding).
  select * into v_employee from public.employees where profile_id = auth.uid();
  if not found then
    perform public.ensure_employee_record(auth.uid());
    select * into v_employee from public.employees where profile_id = auth.uid();
    if not found then
      raise exception 'no employee record for current user' using errcode = 'insufficient_privilege';
    end if;
  end if;

  select * into v_course from public.courses where id = p_course_id;
  if not found or v_course.status <> 'published' or v_course.current_version_id is null then
    raise exception 'course is not available to enroll in' using errcode = 'invalid_parameter_value';
  end if;

  -- This function is security definer and bypasses courses_select RLS entirely -- without this
  -- check, a caller could pass the id of a course belonging to a *different* organization (one
  -- they could never see via the normal SELECT policy) and self-enroll in it anyway. Mirrors
  -- courses_select's own "organization_id is null or organization_id = current org" condition.
  if v_course.organization_id is not null and v_course.organization_id <> v_employee.organization_id then
    raise exception 'course is not available to enroll in' using errcode = 'invalid_parameter_value';
  end if;

  -- Mirrors validate_course_assignment_version()'s own insert-time check (published, and if
  -- AI-generated, review-complete) so a caller who reaches this via a course whose catalog entry
  -- is published but whose current version is still an unreviewed AI draft gets this same,
  -- expected error up front, instead of a raw trigger exception surfacing straight to the UI toast.
  select status, ai_generated, ai_reviewed_at
    into v_version_status, v_version_ai_generated, v_version_ai_reviewed_at
    from public.course_versions where id = v_course.current_version_id;
  if v_version_status is distinct from 'published' or (v_version_ai_generated and v_version_ai_reviewed_at is null) then
    raise exception 'course is not available to enroll in' using errcode = 'invalid_parameter_value';
  end if;

  -- Serializes concurrent self-enroll attempts for the same (employee, course) pair.
  -- course_assignments has no unique constraint on (employee_id, course_id) -- by design, an
  -- admin can legitimately re-assign the same course for a later retraining cycle -- so without
  -- this lock, two concurrent calls (double-click, a retried request, two open tabs) could both
  -- pass the "already enrolled?" check below and both insert.
  perform pg_advisory_xact_lock(hashtextextended(v_employee.id::text || ':' || p_course_id::text, 0));

  -- ORDER BY + LIMIT: if an admin-assigned row for this pair already exists (e.g. from a prior
  -- retraining cycle), this deterministically reuses the most recent one rather than an
  -- arbitrary row.
  select id into v_assignment_id
  from public.course_assignments
  where employee_id = v_employee.id and course_id = p_course_id
  order by assigned_at desc
  limit 1;

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
