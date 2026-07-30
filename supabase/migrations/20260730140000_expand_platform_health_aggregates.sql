-- Expand get_platform_health with the pure KPI aggregates the AdminDashboard
-- currently computes by downloading full domain lists (credentials, incidents,
-- violations, corrective actions, courses, course_assignments, training_records,
-- policy_attestations, active employees). Existing keys are preserved; new keys
-- are additive so older clients keep working.
--
-- overdueTrainingRecords uses DISTINCT ON (employee_id, training_type_id) ordered
-- the same way selectCurrentTrainingRecords does on the client, so superseded
-- renewal rows do not inflate the past-due count.

create or replace function public.get_platform_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_today date := (timezone('America/New_York', now()))::date;
  v_soon date := (timezone('America/New_York', now()))::date + 30;
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform_admin may view platform health'
      using errcode = '42501';
  end if;

  select jsonb_build_object(
    'orgsByStatus', (
      select coalesce(jsonb_object_agg(subscription_status, cnt), '{}'::jsonb)
      from (
        select subscription_status, count(*) as cnt
        from public.organizations
        group by subscription_status
      ) as s
    ),
    'notificationDeliveriesPending', (
      select count(*)
      from public.notification_deliveries
      where status = 'pending'
    ),
    'notificationDeliveriesFailed', (
      select count(*)
      from public.notification_deliveries
      where status = 'failed'
    ),
    'aiGenerationsPending', (
      (
        select count(*)
        from public.course_ai_generations
        where status = 'pending'
          and created_at > now() - interval '30 days'
      )
      + (
        select count(*)
        from public.resident_assessment_ai_generations
        where status = 'pending'
          and created_at > now() - interval '30 days'
      )
    ),
    'aiGenerationsFailed', (
      (
        select count(*)
        from public.course_ai_generations
        where status = 'failed'
          and created_at > now() - interval '30 days'
      )
      + (
        select count(*)
        from public.resident_assessment_ai_generations
        where status = 'failed'
          and created_at > now() - interval '30 days'
      )
    ),
    'heygenJobsInProgress', (
      select count(*)
      from public.course_blocks
      where body->'heygen'->>'status' is not null
        and body->'heygen'->>'status' not in ('completed', 'failed')
    ),
    'systemJobsStale', (
      select count(*)
      from public.get_system_job_control_plane()
      where is_stale
    ),
    'systemJobsFailed', (
      select count(*)
      from public.get_system_job_control_plane()
      where last_status in ('failed', 'partial')
    ),
    'auditCoverageMissing', (
      select count(*)
      from public.get_audit_coverage()
      where not has_required_trigger
    ),
    'totalFacilities', (select count(*) from public.facilities),
    'totalEmployees', (select count(*) from public.employees),
    'totalCourses', (select count(*) from public.courses),

    -- Active-roster data-quality counts (AdminDashboard data quality center)
    'activeEmployees', (
      select count(*) from public.employees where status = 'active'
    ),
    'employeesMissingEmail', (
      select count(*) from public.employees
      where status = 'active' and (email is null or btrim(email) = '')
    ),
    'employeesMissingFacility', (
      select count(*) from public.employees
      where status = 'active' and facility_id is null
    ),

    -- Credential / clearance KPIs
    'expiredCredentials', (
      select count(*) from public.employee_credentials
      where expiration_date is not null and expiration_date < v_today
    ),
    'expiringCredentialsWithin30Days', (
      select count(*) from public.employee_credentials
      where expiration_date is not null
        and expiration_date >= v_today
        and expiration_date <= v_soon
    ),

    -- Incident / violation / CAPA KPIs
    'openIncidents', (
      select count(*) from public.incidents where status is distinct from 'closed'
    ),
    'openViolations', (
      select count(*) from public.dhs_violations where status is distinct from 'verified'
    ),
    'openCorrectiveActions', (
      select count(*) from public.corrective_actions
      where status is distinct from 'completed' and status is distinct from 'cancelled'
    ),
    'overdueCorrectiveActions', (
      select count(*) from public.corrective_actions
      where status is distinct from 'completed'
        and status is distinct from 'cancelled'
        and due_date is not null
        and due_date < v_today
    ),

    -- Training content / assignment KPIs
    'publishedCourses', (
      select count(*) from public.courses where status = 'published'
    ),
    'draftCourses', (
      select count(*) from public.courses where status is distinct from 'published'
    ),
    'incompleteCourseAssignments', (
      select count(*) from public.course_assignments where status is distinct from 'completed'
    ),
    'overdueCourseAssignments', (
      select count(*) from public.course_assignments
      where status is distinct from 'completed'
        and due_date is not null
        and due_date < v_today
    ),

    -- Current training records only (latest per employee + training type)
    'overdueTrainingRecords', (
      select count(*)
      from (
        select distinct on (employee_id, training_type_id)
          status, due_date
        from public.employee_training_records
        order by employee_id, training_type_id,
          due_date desc nulls last,
          completion_date desc nulls last,
          created_at desc nulls last
      ) as current_records
      where status in ('expired', 'due_soon')
        and due_date is not null
        and due_date < v_today
    ),

    -- Policy attestation KPIs
    'pendingPolicyAttestations', (
      select count(*) from public.policy_attestations where status = 'pending'
    ),
    'overduePolicyAttestations', (
      select count(*) from public.policy_attestations
      where status = 'pending'
        and due_date is not null
        and due_date < v_today
    ),

    'openAlerts', (
      select count(*) from public.alerts where status = 'open'
    )
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_platform_health()
  from public, anon;
grant execute on function public.get_platform_health()
  to authenticated;
