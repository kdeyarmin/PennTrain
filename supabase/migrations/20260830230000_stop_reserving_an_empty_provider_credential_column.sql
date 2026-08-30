-- Stop reserving a column for a field that is deliberately empty.
--
-- The provider directed that the certificate name Dr. Kevin Deyarmin, ND, MSW, CHPCA, NCG and
-- carry no separate professional title, credential, credential number, issuing organization or
-- expiration date (20260830220000). The certificate PDF and /verify already omit an absent
-- credential rather than printing a blank, and so does the per-employee history card -- but the
-- compliance report did not. It rendered a "Provider Credential" column filled with `--` on every
-- row, in the report and in its CSV export, which is the same as printing the emptiness.
--
-- The column is removed rather than blanked. A placeholder in a compliance export invites the
-- reader to wonder what should have been there; an absent column does not. The provider's name,
-- post-nominals included, is already in the Training Provider column beside it.
--
-- Nothing is dropped from course_provider_profiles: those columns stay available to any course
-- whose provider does record a separate credential, and this course simply has none to show.

create or replace function public.generate_diabetes_training_compliance_report(
  p_facility_id uuid default null,
  p_status text default null,
  p_search text default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 1000);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_status text := nullif(btrim(coalesce(p_status, '')), '');
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_today date := public.pa_today();
  v_headers jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_summary jsonb;
  v_total bigint := 0;
  v_current bigint := 0;
  v_due_soon bigint := 0;
  v_urgent bigint := 0;
  v_expired bigint := 0;
  v_in_progress bigint := 0;
  v_not_started bigint := 0;
  v_exam_not_passed bigint := 0;
begin
  if not public.current_profile_active()
     or public.current_role() not in ('org_admin', 'facility_manager', 'auditor') then
    raise exception 'Not authorized to generate the diabetes training compliance report'
      using errcode = '42501';
  end if;

  if v_status is not null and v_status not in (
    'current', 'due_soon', 'urgent', 'expired', 'not_started', 'in_progress', 'exam_not_passed', 'completed'
  ) then
    raise exception 'Unsupported diabetes training compliance status filter'
      using errcode = '22023';
  end if;

  -- Because this function is SECURITY INVOKER, this lookup also proves that the caller can see
  -- the requested facility through normal facilities RLS.
  if p_facility_id is not null and not exists (
    select 1 from public.facilities f where f.id = p_facility_id and not f.is_sandbox
  ) then
    raise exception 'Facility is outside the caller scope'
      using errcode = '42501';
  end if;

  with course as (
    select c.id, c.title, c.catalog_code, c.recurrence_interval_days
    from public.courses c
    where c.organization_id is null
      and c.catalog_code = 'PA-PCH-DIABETES-ANNUAL'
  ),
  provider as (
    select p.provider_full_name
    from public.course_provider_profiles p
    join course c on c.id = p.course_id
  ),
  assignments as (
    select
      ca.id,
      ca.employee_id,
      ca.facility_id,
      ca.status,
      ca.completed_at,
      ca.course_version_id,
      -- Completed assignments outrank open ones (nulls LAST), which matters for the whole of
      -- every renewal window: self_enroll_course() lets a learner start next year's course 30
      -- days before this year's completion expires, and that new assignment has a null
      -- completed_at. Ranking nulls first would hand the report the open renewal and label
      -- somebody holding a valid, unexpired certificate as not_started -- a false
      -- non-compliance for thirty days a year, for every employee who renews on time.
      row_number() over (
        partition by ca.employee_id
        order by ca.completed_at desc nulls last, ca.assigned_at desc
      ) as recency
    from public.course_assignments ca
    join course c on c.id = ca.course_id
    -- Sandbox facilities are excluded HERE, before row_number(), not only at the display join.
    -- Ranking over a wider set than the report shows means an employee whose most recent
    -- assignment happens to be a sandbox one wins recency with a row the display join then drops,
    -- and the employee vanishes from a compliance report they belong on -- the one kind of error
    -- this report must not make, because a missing row reads as nobody to chase.
    join public.facilities sf on sf.id = ca.facility_id and not sf.is_sandbox
    where (p_facility_id is null or ca.facility_id = p_facility_id)
  ),
  latest as (
    select * from assignments where recency = 1
  ),
  detailed as (
    select
      e.last_name,
      e.first_name,
      (e.first_name || ' ' || e.last_name)::text as employee_name,
      e.employee_number,
      f.name as facility_name,
      c.title as course_title,
      coalesce(cv.version_label, 'v' || cv.version_number::text) as course_version,
      coalesce(pr.provider_full_name, 'CareMetric CareBase Training Suite') as training_provider,
      l.status as assignment_status,
      l.completed_at,
      cert.credential_number,
      cert.expires_at,
      exam.best_score,
      coalesce(exam.attempt_count, 0) as attempt_count,
      att.attested_at,
      case
        when l.status <> 'completed' and coalesce(exam.attempt_count, 0) = 0 and l.status = 'assigned'
          then 'not_started'
        when l.status <> 'completed' and coalesce(exam.passed_count, 0) = 0 and coalesce(exam.attempt_count, 0) > 0
          then 'exam_not_passed'
        when l.status <> 'completed'
          then 'in_progress'
        when cert.expires_at is null
          then 'current'
        when (cert.expires_at at time zone 'America/New_York')::date < v_today
          then 'expired'
        when (cert.expires_at at time zone 'America/New_York')::date <= v_today + 14
          then 'urgent'
        when (cert.expires_at at time zone 'America/New_York')::date <= v_today + 60
          then 'due_soon'
        else 'current'
      end as compliance_status
    from latest l
    join public.employees e on e.id = l.employee_id
    join public.facilities f on f.id = l.facility_id and not f.is_sandbox
    join public.course_versions cv on cv.id = l.course_version_id
    cross join course c
    left join provider pr on true
    left join public.certificates cert on cert.course_assignment_id = l.id
    left join lateral (
      select
        max(qa.score_percent) filter (where qa.passed) as best_score,
        count(*) filter (where qa.submitted_at is not null) as attempt_count,
        count(*) filter (where qa.passed) as passed_count
      from public.quiz_attempts qa
      join public.quizzes q on q.id = qa.quiz_id
      where qa.assignment_id = l.id and q.quiz_kind = 'final_exam'
    ) exam on true
    left join lateral (
      select max(la.attested_at) as attested_at
      from public.course_learner_attestations la
      where la.course_assignment_id = l.id
    ) att on true
    where not e.is_synthetic
  ),
  filtered as (
    select * from detailed
    where (
        v_status is null
        or (v_status = 'completed' and assignment_status = 'completed')
        or compliance_status = v_status
      )
      and (
        v_search is null
        or employee_name ilike '%' || v_search || '%'
        or coalesce(employee_number, '') ilike '%' || v_search || '%'
        or facility_name ilike '%' || v_search || '%'
      )
  ),
  paged as (
    select * from filtered
    order by last_name, first_name, employee_name
    limit v_limit offset v_offset
  )
  select
    (select count(*) from filtered),
    (select count(*) from filtered where compliance_status = 'current'),
    (select count(*) from filtered where compliance_status = 'due_soon'),
    (select count(*) from filtered where compliance_status = 'urgent'),
    (select count(*) from filtered where compliance_status = 'expired'),
    (select count(*) from filtered where compliance_status = 'in_progress'),
    (select count(*) from filtered where compliance_status = 'not_started'),
    (select count(*) from filtered where compliance_status = 'exam_not_passed'),
    coalesce((
      select jsonb_agg(jsonb_build_array(
        employee_name,
        coalesce(employee_number, '--'),
        facility_name,
        course_title,
        course_version,
        training_provider,
        coalesce((completed_at at time zone 'America/New_York')::date::text, '--'),
        case when best_score is null then '--' else best_score::text || '%' end,
        attempt_count::text,
        coalesce(credential_number, '--'),
        coalesce((expires_at at time zone 'America/New_York')::date::text, '--'),
        coalesce((attested_at at time zone 'America/New_York')::date::text, '--'),
        replace(compliance_status, '_', ' ')
      ) order by last_name, first_name, employee_name)
      from paged
    ), '[]'::jsonb)
    into v_total, v_current, v_due_soon, v_urgent, v_expired, v_in_progress, v_not_started,
         v_exam_not_passed, v_rows;

  v_headers := '["Employee","Employee Number","Facility","Course","Course Version","Training Provider","Completion Date","Final Exam Score","Exam Attempts","Certificate Number","Renewal Due","Attested","Status"]'::jsonb;

  v_summary := jsonb_build_array(
    jsonb_build_object('label', 'Assigned Staff', 'value', v_total),
    jsonb_build_object('label', 'Current', 'value', v_current, 'variant', 'success'),
    jsonb_build_object('label', 'Due within 60 days', 'value', v_due_soon,
      'variant', case when v_due_soon > 0 then 'warning' else 'success' end),
    jsonb_build_object('label', 'Due within 14 days', 'value', v_urgent,
      'variant', case when v_urgent > 0 then 'warning' else 'success' end),
    jsonb_build_object('label', 'Expired', 'value', v_expired,
      'variant', case when v_expired > 0 then 'danger' else 'success' end),
    jsonb_build_object('label', 'In progress', 'value', v_in_progress),
    jsonb_build_object('label', 'Not started', 'value', v_not_started,
      'variant', case when v_not_started > 0 then 'warning' else 'success' end),
    jsonb_build_object('label', 'Exam not yet passed', 'value', v_exam_not_passed,
      'variant', case when v_exam_not_passed > 0 then 'warning' else 'success' end)
  );

  return jsonb_build_object(
    'headers', v_headers,
    'rows', v_rows,
    'summaryCards', v_summary,
    'totalRows', v_total,
    'pageSize', v_limit,
    'pageOffset', v_offset,
    'hasMore', v_offset + jsonb_array_length(v_rows) < v_total,
    'generatedAt', now()
  );
end;
$function$;
