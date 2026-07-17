-- Move report calculation behind a bounded, RLS-preserving database API.
-- The browser now asks for one page of one report instead of downloading whole
-- operational tables and recreating every report definition locally.

create index employee_training_records_report_page_idx
  on public.employee_training_records(facility_id, due_date, status, employee_id);
create index practicums_report_page_idx
  on public.practicums(facility_id, due_date, status, employee_id);
create index training_documents_report_page_idx
  on public.training_documents(facility_id, created_at desc);
create index training_hour_buckets_report_page_idx
  on public.employee_training_hour_buckets(facility_id, training_year desc, employee_id);
create index employee_credentials_report_page_idx
  on public.employee_credentials(facility_id, expiration_date, status, employee_id);
create index incidents_report_page_idx
  on public.incidents(facility_id, occurred_at desc);
create index incident_notifications_report_page_idx
  on public.incident_notifications(facility_id, due_at desc, status);
create index inspection_items_report_page_idx
  on public.inspection_items(facility_id, next_due_date, status)
  where is_active;
create index employees_report_picker_idx
  on public.employees(facility_id, status, last_name, first_name)
  where not is_synthetic;

-- Keep auth.uid() out of the per-row policy execution plan on the employee table,
-- which is central to most reports and the server-side employee picker.
alter policy employees_select on public.employees using (
  public.is_platform_admin()
  or profile_id = (select auth.uid())
  or public.can_read_employee_peer_data(organization_id, facility_id)
  or (
    public.current_role() in ('facility_manager', 'trainer')
    and exists (
      select 1
      from public.employee_facility_assignments efa
      where efa.employee_id = employees.id
        and public.can_read_employee_peer_data(employees.organization_id, efa.facility_id)
    )
  )
);

create or replace function public.generate_paged_compliance_report(
  p_report_id text,
  p_facility_id uuid default null,
  p_employee_id uuid default null,
  p_date_from date default null,
  p_date_to date default null,
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
  v_headers jsonb := '[]'::jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_summary jsonb := '[]'::jsonb;
  v_total bigint := 0;
  v_total_employees bigint := 0;
  v_compliant bigint := 0;
  v_expired bigint := 0;
  v_due_soon bigint := 0;
  v_missing bigint := 0;
  v_other bigint := 0;
  v_score integer := 100;
  v_current_year integer := extract(year from current_date)::integer;
begin
  if p_report_id is null or p_report_id not in (
    'compliance-summary', 'facility-compliance', 'survey-readiness',
    'expired-training', 'due-soon', 'medication-administration',
    'training-matrix', 'practicum-status', 'annual-practicum',
    'annual-hours', 'training-hours', 'trainer-certification',
    'new-employee-training', 'employee-transcript',
    'expiring-certifications', 'missing-documents', 'document-audit',
    'overdue-training', 'credential-status', 'incident-log',
    'incident-notification-register', 'inspection-compliance'
  ) then
    raise exception 'Unsupported report id'
      using errcode = '22023';
  end if;

  if not public.current_profile_active()
     or public.current_role() not in ('org_admin', 'facility_manager', 'auditor') then
    raise exception 'Not authorized to generate compliance reports'
      using errcode = '42501';
  end if;

  -- Because this function is SECURITY INVOKER, this lookup also proves that the
  -- caller can see the requested facility through normal facilities RLS.
  if p_facility_id is not null and not exists (
    select 1
    from public.facilities f
    where f.id = p_facility_id
      and not f.is_sandbox
  ) then
    raise exception 'Facility is outside the caller scope'
      using errcode = '42501';
  end if;

  if p_date_from is not null and p_date_to is not null and p_date_from > p_date_to then
    raise exception 'The report start date must be on or before the end date'
      using errcode = '22023';
  end if;

  if p_report_id = 'compliance-summary' then
    select count(*)
      into v_total_employees
    from public.employees e
    join public.facilities f on f.id = e.facility_id and not f.is_sandbox
    where e.status = 'active'
      and not e.is_synthetic
      and (p_facility_id is null or e.facility_id = p_facility_id);

    select
      count(*) filter (where r.status in ('compliant', 'due_soon', 'expired', 'missing')),
      count(*) filter (where r.status = 'compliant'),
      count(*) filter (where r.status = 'expired'),
      count(*) filter (where r.status = 'due_soon')
      into v_total, v_compliant, v_expired, v_due_soon
    from public.employee_training_records r
    join public.facilities f on f.id = r.facility_id and not f.is_sandbox
    where (p_facility_id is null or r.facility_id = p_facility_id)
      and (p_date_from is null or r.due_date >= p_date_from)
      and (p_date_to is null or r.due_date <= p_date_to);

    v_score := case when v_total > 0 then round(v_compliant * 100.0 / v_total)::integer else 100 end;
    v_headers := '["Metric","Value"]'::jsonb;
    v_rows := jsonb_build_array(
      jsonb_build_array('Total Employees', v_total_employees::text),
      jsonb_build_array('Total Training Records', v_total::text),
      jsonb_build_array('Compliant Records', v_compliant::text),
      jsonb_build_array('Expired Records', v_expired::text),
      jsonb_build_array('Due Soon Records', v_due_soon::text),
      jsonb_build_array('Compliance Percentage', v_score::text || '%')
    );
    v_summary := jsonb_build_array(
      jsonb_build_object('label', 'Total Employees', 'value', v_total_employees),
      jsonb_build_object('label', 'Compliant', 'value', v_compliant, 'variant', 'success'),
      jsonb_build_object('label', 'Expired', 'value', v_expired, 'variant', case when v_expired > 0 then 'danger' else 'success' end),
      jsonb_build_object('label', 'Compliance', 'value', v_score::text || '%', 'variant', case when v_score >= 80 then 'success' when v_score >= 50 then 'warning' else 'danger' end)
    );
    v_total := 6;

  elsif p_report_id = 'facility-compliance' then
    with scored as (
      select
        f.id,
        f.name,
        f.facility_type,
        count(r.id) filter (where r.status in ('compliant', 'due_soon', 'expired', 'missing')) as total,
        count(r.id) filter (where r.status = 'compliant') as compliant,
        count(r.id) filter (where r.status = 'expired') as expired,
        count(r.id) filter (where r.status = 'due_soon') as due_soon
      from public.facilities f
      left join public.employee_training_records r
        on r.facility_id = f.id
       and (p_date_from is null or r.due_date >= p_date_from)
       and (p_date_to is null or r.due_date <= p_date_to)
      where not f.is_sandbox
        and (p_facility_id is null or f.id = p_facility_id)
      group by f.id, f.name, f.facility_type
    ), paged as (
      select *, case when total > 0 then round(compliant * 100.0 / total)::integer else 100 end as score
      from scored
      order by name, id
      limit v_limit offset v_offset
    )
    select
      (select count(*) from scored),
      coalesce((
        select jsonb_agg(jsonb_build_array(
          name,
          replace(facility_type, '_', ' '),
          total::text,
          compliant::text,
          expired::text,
          due_soon::text,
          score::text || '%'
        ) order by name, id)
        from paged
      ), '[]'::jsonb),
      coalesce((select round(avg(case when total > 0 then compliant * 100.0 / total else 100 end))::integer from scored), 100)
      into v_total, v_rows, v_score;
    v_headers := '["Facility","Type","Total Records","Compliant","Expired","Due Soon","Compliance %"]'::jsonb;
    v_summary := jsonb_build_array(
      jsonb_build_object('label', 'Facilities', 'value', v_total),
      jsonb_build_object('label', 'Avg Score', 'value', v_score::text || '%')
    );

  elsif p_report_id = 'survey-readiness' then
    select
      count(*) filter (where r.status in ('compliant', 'due_soon', 'expired', 'missing')),
      count(*) filter (where r.status = 'compliant'),
      count(*) filter (where r.status = 'expired'),
      count(*) filter (where r.status = 'missing' and r.document_required)
      into v_total, v_compliant, v_expired, v_missing
    from public.employee_training_records r
    join public.facilities f on f.id = r.facility_id and not f.is_sandbox
    where (p_facility_id is null or r.facility_id = p_facility_id)
      and (p_date_from is null or r.due_date >= p_date_from)
      and (p_date_to is null or r.due_date <= p_date_to);

    v_score := case when v_total > 0 then round(v_compliant * 100.0 / v_total)::integer else 100 end;

    select count(*)
      into v_total_employees
    from public.employees e
    join public.facilities f on f.id = e.facility_id and not f.is_sandbox
    where e.status = 'active'
      and not e.is_synthetic
      and (p_facility_id is null or e.facility_id = p_facility_id);

    -- Reuse scratch counters for the remaining readiness checks:
    -- due_soon=med-admin gaps, other=trainer gaps.
    select count(*)
      into v_due_soon
    from public.employee_training_records r
    join public.employees e on e.id = r.employee_id and e.administers_medications and e.status = 'active' and not e.is_synthetic
    join public.training_types t on t.id = r.training_type_id and t.is_active and t.applies_to_administers_meds
    join public.facilities f on f.id = r.facility_id and not f.is_sandbox
    where r.status in ('expired', 'missing')
      and (p_facility_id is null or r.facility_id = p_facility_id)
      and (p_date_from is null or r.due_date >= p_date_from)
      and (p_date_to is null or r.due_date <= p_date_to);

    select count(*)
      into v_other
    from public.employee_training_records r
    join public.employees e on e.id = r.employee_id and e.trainer_status and e.status = 'active' and not e.is_synthetic
    join public.training_types t on t.id = r.training_type_id and t.is_active and t.applies_to_trainers
    join public.facilities f on f.id = r.facility_id and not f.is_sandbox
    where r.status in ('expired', 'missing')
      and (p_facility_id is null or r.facility_id = p_facility_id)
      and (p_date_from is null or r.due_date >= p_date_from)
      and (p_date_to is null or r.due_date <= p_date_to);

    declare
      v_pending_practicums bigint;
      v_year_practicums bigint;
      v_critical_alerts bigint;
      v_med_admin_staff bigint;
      v_passes integer := 0;
      v_readiness integer;
    begin
      select
        count(*) filter (where p.practicum_year = v_current_year),
        count(*) filter (where p.practicum_year = v_current_year and p.status <> 'compliant')
        into v_year_practicums, v_pending_practicums
      from public.practicums p
      join public.facilities f on f.id = p.facility_id and not f.is_sandbox
      where (p_facility_id is null or p.facility_id = p_facility_id)
        and (p_date_from is null or p.due_date >= p_date_from)
        and (p_date_to is null or p.due_date <= p_date_to);

      select count(*) into v_critical_alerts
      from public.alerts a
      left join public.facilities f on f.id = a.facility_id
      where a.status = 'open' and a.severity = 'critical'
        and (a.facility_id is null or not coalesce(f.is_sandbox, false))
        and (p_facility_id is null or a.facility_id = p_facility_id);

      select count(*) into v_med_admin_staff
      from public.employees e
      join public.facilities f on f.id = e.facility_id and not f.is_sandbox
      where e.status = 'active' and e.administers_medications and not e.is_synthetic
        and (p_facility_id is null or e.facility_id = p_facility_id);

      v_passes :=
        (case when v_score >= 90 then 1 else 0 end) +
        (case when v_expired = 0 then 1 else 0 end) +
        (case when v_due_soon = 0 then 1 else 0 end) +
        (case when v_other = 0 then 1 else 0 end) +
        (case when v_pending_practicums = 0 then 1 else 0 end) +
        (case when v_missing = 0 then 1 else 0 end) +
        (case when v_critical_alerts = 0 then 1 else 0 end);
      v_readiness := round(v_passes * 100.0 / 7)::integer;

      v_headers := '["Check","Status","Detail"]'::jsonb;
      v_rows := jsonb_build_array(
        jsonb_build_array('Overall Training Compliance', case when v_score >= 90 then 'pass' when v_score >= 75 then 'warning' else 'fail' end, v_compliant::text || ' of ' || v_total::text || ' records compliant (' || v_score::text || '%)'),
        jsonb_build_array('Expired Training Records', case when v_expired = 0 then 'pass' else 'fail' end, v_expired::text || ' expired record(s) require immediate renewal'),
        jsonb_build_array('Medication Administration Training', case when v_due_soon = 0 then 'pass' else 'fail' end, v_due_soon::text || ' med admin training record(s) are expired or missing'),
        jsonb_build_array('Trainer Certification', case when v_other = 0 then 'pass' else 'fail' end, v_other::text || ' trainer certification record(s) are expired or missing'),
        jsonb_build_array('Annual Practicum Completion', case when v_pending_practicums = 0 then 'pass' else 'warning' end, v_pending_practicums::text || ' of ' || v_year_practicums::text || ' ' || v_current_year::text || ' practicums pending'),
        jsonb_build_array('Required Documentation', case when v_missing = 0 then 'pass' else 'warning' end, v_missing::text || ' record(s) missing required documentation'),
        jsonb_build_array('Open Critical Alerts', case when v_critical_alerts = 0 then 'pass' else 'fail' end, v_critical_alerts::text || ' open critical alert(s)')
      );
      v_summary := jsonb_build_array(
        jsonb_build_object('label', 'Readiness Score', 'value', v_readiness::text || '%', 'variant', case when v_readiness >= 80 then 'success' when v_readiness >= 50 then 'warning' else 'danger' end),
        jsonb_build_object('label', 'Compliance Score', 'value', v_score::text || '%', 'variant', case when v_score >= 80 then 'success' when v_score >= 50 then 'warning' else 'danger' end),
        jsonb_build_object('label', 'Active Staff', 'value', v_total_employees),
        jsonb_build_object('label', 'Med Admin Staff', 'value', v_med_admin_staff)
      );
      v_total := 7;
    end;

  elsif p_report_id in (
    'expired-training', 'due-soon', 'medication-administration',
    'trainer-certification', 'new-employee-training',
    'expiring-certifications', 'missing-documents'
  ) then
    with scoped as (
      select
        r.id,
        e.first_name,
        e.last_name,
        e.job_title,
        e.hire_date,
        t.name as training_type_name,
        r.completion_date,
        r.due_date,
        r.status
      from public.employee_training_records r
      join public.employees e on e.id = r.employee_id and not e.is_synthetic
      join public.training_types t on t.id = r.training_type_id
      join public.facilities f on f.id = r.facility_id and not f.is_sandbox
      where (p_facility_id is null or r.facility_id = p_facility_id)
        and (p_date_from is null or r.due_date >= p_date_from)
        and (p_date_to is null or r.due_date <= p_date_to)
        and case p_report_id
          when 'expired-training' then r.status = 'expired'
          when 'due-soon' then r.status = 'due_soon'
          when 'medication-administration' then e.status = 'active' and e.administers_medications and t.is_active and t.applies_to_administers_meds
          when 'trainer-certification' then e.status = 'active' and e.trainer_status and t.is_active and t.applies_to_trainers
          when 'new-employee-training' then e.status = 'active' and e.hire_date >= current_date - 90
          when 'expiring-certifications' then r.due_date between current_date and current_date + 90
          when 'missing-documents' then r.status = 'missing' and r.document_required
          else false
        end
    ), paged as (
      select * from scoped
      order by due_date nulls last, last_name, first_name, id
      limit v_limit offset v_offset
    )
    select
      (select count(*) from scoped),
      coalesce((
        select jsonb_agg(
          case when p_report_id in ('medication-administration', 'new-employee-training')
            then jsonb_build_array(first_name || ' ' || last_name, coalesce(job_title, ''), coalesce(hire_date::text, ''), training_type_name, coalesce(completion_date::text, ''), coalesce(due_date::text, ''), status)
            else jsonb_build_array(first_name || ' ' || last_name, coalesce(job_title, ''), training_type_name, coalesce(completion_date::text, ''), coalesce(due_date::text, ''), status)
          end
          order by due_date nulls last, last_name, first_name, id
        ) from paged
      ), '[]'::jsonb)
      into v_total, v_rows;

    v_headers := case when p_report_id in ('medication-administration', 'new-employee-training')
      then '["Employee","Job Title","Hire Date","Training Type","Completion","Due Date","Status"]'::jsonb
      else '["Employee","Job Title","Training Type","Completion Date","Due Date","Status"]'::jsonb
    end;
    v_summary := case p_report_id
      when 'expired-training' then jsonb_build_array(jsonb_build_object('label', 'Expired Records', 'value', v_total, 'variant', case when v_total > 0 then 'danger' else 'success' end))
      when 'due-soon' then jsonb_build_array(jsonb_build_object('label', 'Due Soon Records', 'value', v_total, 'variant', case when v_total > 0 then 'warning' else 'success' end))
      when 'expiring-certifications' then jsonb_build_array(jsonb_build_object('label', 'Expiring (90 days)', 'value', v_total, 'variant', case when v_total > 0 then 'warning' else 'success' end))
      when 'missing-documents' then jsonb_build_array(jsonb_build_object('label', 'Missing Documents', 'value', v_total, 'variant', case when v_total > 0 then 'warning' else 'success' end))
      when 'medication-administration' then jsonb_build_array(
        jsonb_build_object('label', 'Med Admin Staff', 'value', (select count(*) from public.employees e join public.facilities f on f.id=e.facility_id and not f.is_sandbox where e.status='active' and e.administers_medications and not e.is_synthetic and (p_facility_id is null or e.facility_id=p_facility_id))),
        jsonb_build_object('label', 'Training Records', 'value', v_total)
      )
      when 'trainer-certification' then jsonb_build_array(
        jsonb_build_object('label', 'Trainers', 'value', (select count(*) from public.employees e join public.facilities f on f.id=e.facility_id and not f.is_sandbox where e.status='active' and e.trainer_status and not e.is_synthetic and (p_facility_id is null or e.facility_id=p_facility_id))),
        jsonb_build_object('label', 'Training Records', 'value', v_total)
      )
      else jsonb_build_array(
        jsonb_build_object('label', 'New Employees', 'value', (select count(*) from public.employees e join public.facilities f on f.id=e.facility_id and not f.is_sandbox where e.status='active' and not e.is_synthetic and e.hire_date >= current_date - 90 and (p_facility_id is null or e.facility_id=p_facility_id))),
        jsonb_build_object('label', 'Training Records', 'value', v_total)
      )
    end;

  elsif p_report_id = 'training-matrix' then
    with matrix_types as materialized (
      select t.id, t.name, t.applies_to_facility_type, t.sort_order
      from public.training_types t
      where t.is_active
      order by t.sort_order, t.name, t.id
    ), scoped_employees as materialized (
      select e.id, e.first_name, e.last_name, e.job_title, f.facility_type
      from public.employees e
      join public.facilities f on f.id = e.facility_id and not f.is_sandbox
      where e.status = 'active'
        and not e.is_synthetic
        and (p_facility_id is null or e.facility_id = p_facility_id)
    ), paged_employees as (
      select * from scoped_employees
      order by last_name, first_name, id
      limit v_limit offset v_offset
    )
    select
      (select count(*) from scoped_employees),
      jsonb_build_array('Employee', 'Job Title') || coalesce((
        select jsonb_agg(to_jsonb(t.name) order by t.sort_order, t.name, t.id)
        from matrix_types t
      ), '[]'::jsonb),
      coalesce((
        select jsonb_agg(
          jsonb_build_array(e.first_name || ' ' || e.last_name, coalesce(e.job_title, '')) ||
          coalesce((
            select jsonb_agg(
              to_jsonb(coalesce(
                latest.status,
                case
                  when t.applies_to_facility_type not in ('BOTH', e.facility_type) then 'not_applicable'
                  else 'no_record'
                end
              ))
              order by t.sort_order, t.name, t.id
            )
            from matrix_types t
            left join lateral (
              select r.status
              from public.employee_training_records r
              where r.employee_id = e.id
                and r.training_type_id = t.id
              order by r.due_date desc nulls last, r.created_at desc, r.id desc
              limit 1
            ) latest on true
          ), '[]'::jsonb)
          order by e.last_name, e.first_name, e.id
        )
        from paged_employees e
      ), '[]'::jsonb),
      (select count(*) from matrix_types)
      into v_total, v_headers, v_rows, v_other;
    v_summary := jsonb_build_array(
      jsonb_build_object('label', 'Employees', 'value', v_total),
      jsonb_build_object('label', 'Training Types', 'value', v_other)
    );

  elsif p_report_id in ('practicum-status', 'annual-practicum') then
    with scoped as (
      select
        p.id,
        e.first_name,
        e.last_name,
        p.practicum_year,
        p.status,
        p.completion_date,
        p.due_date,
        p.observed_by,
        p.mar_review_completed,
        p.direct_observation_completed
      from public.practicums p
      join public.employees e on e.id = p.employee_id and not e.is_synthetic
      join public.facilities f on f.id = p.facility_id and not f.is_sandbox
      where (p_facility_id is null or p.facility_id = p_facility_id)
        and (p_date_from is null or p.due_date >= p_date_from)
        and (p_date_to is null or p.due_date <= p_date_to)
    ), paged as (
      select * from scoped
      order by due_date nulls last, last_name, first_name, id
      limit v_limit offset v_offset
    )
    select
      (select count(*) from scoped),
      (select count(*) from scoped where status = 'compliant'),
      coalesce((
        select jsonb_agg(
          case when p_report_id = 'annual-practicum'
            then jsonb_build_array(
              first_name || ' ' || last_name,
              practicum_year::text,
              status,
              coalesce(completion_date::text, ''),
              coalesce(observed_by, ''),
              case when mar_review_completed then 'Yes' else 'No' end,
              case when direct_observation_completed then 'Yes' else 'No' end
            )
            else jsonb_build_array(first_name || ' ' || last_name, practicum_year::text, status, coalesce(completion_date::text, ''))
          end
          order by due_date nulls last, last_name, first_name, id
        ) from paged
      ), '[]'::jsonb)
      into v_total, v_compliant, v_rows;

    if p_report_id = 'annual-practicum' then
      v_headers := '["Employee","Year","Status","Completion Date","Observed By","MAR Review","Direct Observation"]'::jsonb;
      v_summary := jsonb_build_array(
        jsonb_build_object('label', 'Total Required', 'value', v_total),
        jsonb_build_object('label', 'Completed', 'value', v_compliant, 'variant', 'success'),
        jsonb_build_object('label', 'Pending', 'value', v_total - v_compliant, 'variant', case when v_total - v_compliant > 0 then 'warning' else 'success' end)
      );
    else
      select count(*) into v_total_employees
      from public.employees e
      join public.facilities f on f.id = e.facility_id and not f.is_sandbox
      where e.status = 'active' and e.administers_medications and not e.is_synthetic
        and (p_facility_id is null or e.facility_id = p_facility_id);
      v_headers := '["Employee","Year","Status","Completion Date"]'::jsonb;
      v_summary := jsonb_build_array(
        jsonb_build_object('label', 'Med Admin Staff', 'value', v_total_employees),
        jsonb_build_object('label', 'Compliant', 'value', v_compliant, 'variant', 'success'),
        jsonb_build_object('label', 'Pending', 'value', v_total - v_compliant, 'variant', case when v_total - v_compliant > 0 then 'warning' else 'success' end)
      );
    end if;

  elsif p_report_id in ('annual-hours', 'training-hours') then
    with scoped as (
      select
        b.id,
        e.first_name,
        e.last_name,
        b.bucket_type,
        b.training_year,
        b.required_hours,
        b.completed_hours,
        b.status,
        b.employee_id
      from public.employee_training_hour_buckets b
      join public.employees e on e.id = b.employee_id and not e.is_synthetic
      join public.facilities f on f.id = b.facility_id and not f.is_sandbox
      where (p_facility_id is null or b.facility_id = p_facility_id)
        and (p_date_from is null or b.training_year >= extract(year from p_date_from)::integer)
        and (p_date_to is null or b.training_year <= extract(year from p_date_to)::integer)
        and (p_report_id <> 'annual-hours' or p_date_from is not null or p_date_to is not null or b.training_year = v_current_year)
    ), paged as (
      select * from scoped
      order by training_year desc, last_name, first_name, bucket_type, id
      limit v_limit offset v_offset
    )
    select
      (select count(*) from scoped),
      (select count(*) from scoped where status = 'compliant'),
      (select count(distinct employee_id) from scoped),
      coalesce((
        select jsonb_agg(jsonb_build_array(
          first_name || ' ' || last_name,
          case bucket_type when 'general_annual' then 'General Annual' when 'alr_dementia' then 'ALF Dementia (§2800.69)' when 'sdcu_dementia' then 'Secured Dementia Unit (§2600.236)' else bucket_type end,
          training_year::text,
          required_hours::text,
          completed_hours::text,
          greatest(0, required_hours - completed_hours)::text,
          status
        ) order by training_year desc, last_name, first_name, bucket_type, id)
        from paged
      ), '[]'::jsonb)
      into v_total, v_compliant, v_total_employees, v_rows;
    v_headers := '["Employee","Bucket","Year","Required Hours","Completed Hours","Remaining","Status"]'::jsonb;
    v_summary := jsonb_build_array(
      jsonb_build_object('label', 'Staff Tracked', 'value', v_total_employees),
      jsonb_build_object('label', 'Compliant Buckets', 'value', v_compliant, 'variant', 'success'),
      jsonb_build_object('label', 'Incomplete Buckets', 'value', v_total - v_compliant, 'variant', case when v_total - v_compliant > 0 then 'warning' else 'success' end)
    );

  elsif p_report_id = 'employee-transcript' then
    if p_employee_id is null or not exists (
      select 1
      from public.employees e
      join public.facilities f on f.id = e.facility_id and not f.is_sandbox
      where e.id = p_employee_id and not e.is_synthetic
        and (p_facility_id is null or e.facility_id = p_facility_id)
    ) then
      raise exception 'An employee in the caller scope is required for this report'
        using errcode = '22023';
    end if;

    with scoped as (
      select
        r.id,
        t.name as training_type_name,
        r.completion_date,
        r.due_date,
        r.status,
        r.trainer_name,
        r.hours,
        r.completion_method
      from public.employee_training_records r
      join public.training_types t on t.id = r.training_type_id
      where r.employee_id = p_employee_id
        and (p_date_from is null or r.due_date >= p_date_from)
        and (p_date_to is null or r.due_date <= p_date_to)
    ), paged as (
      select * from scoped
      order by due_date desc nulls last, id
      limit v_limit offset v_offset
    )
    select
      (select count(*) from scoped),
      coalesce((select jsonb_agg(jsonb_build_array(
        training_type_name,
        coalesce(completion_date::text, ''),
        coalesce(due_date::text, ''),
        status,
        coalesce(trainer_name, ''),
        coalesce(hours::text, ''),
        replace(coalesce(completion_method, ''), '_', ' ')
      ) order by due_date desc nulls last, id) from paged), '[]'::jsonb)
      into v_total, v_rows;

    select count(*) into v_other
    from public.practicums p
    where p.employee_id = p_employee_id
      and (p_date_from is null or p.due_date >= p_date_from)
      and (p_date_to is null or p.due_date <= p_date_to);

    select jsonb_build_array(
      jsonb_build_object('label', 'Employee', 'value', e.first_name || ' ' || e.last_name),
      jsonb_build_object('label', 'Training Records', 'value', v_total),
      jsonb_build_object('label', 'Practicums', 'value', v_other)
    ) into v_summary
    from public.employees e
    where e.id = p_employee_id;
    v_headers := '["Training Type","Completion Date","Due Date","Status","Trainer","Hours","Method"]'::jsonb;

  elsif p_report_id = 'document-audit' then
    with scoped as (
      select
        d.id,
        d.file_name,
        d.document_type,
        d.created_at,
        p.first_name as uploader_first_name,
        p.last_name as uploader_last_name,
        d.uploaded_by_profile_id
      from public.training_documents d
      join public.facilities f on f.id = d.facility_id and not f.is_sandbox
      left join public.profiles p on p.id = d.uploaded_by_profile_id
      where (p_facility_id is null or d.facility_id = p_facility_id)
        and (p_date_from is null or d.created_at >= p_date_from::timestamptz)
        and (p_date_to is null or d.created_at < (p_date_to + 1)::timestamptz)
    ), paged as (
      select * from scoped
      order by created_at desc, id
      limit v_limit offset v_offset
    )
    select
      (select count(*) from scoped),
      coalesce((select jsonb_agg(jsonb_build_array(
        file_name,
        document_type,
        case when uploaded_by_profile_id is null then '' else trim(coalesce(uploader_first_name, '') || ' ' || coalesce(uploader_last_name, '')) end,
        created_at::text
      ) order by created_at desc, id) from paged), '[]'::jsonb)
      into v_total, v_rows;

    select count(*) into v_missing
    from public.employee_training_records r
    join public.facilities f on f.id = r.facility_id and not f.is_sandbox
    where r.status = 'missing' and r.document_required
      and (p_facility_id is null or r.facility_id = p_facility_id)
      and (p_date_from is null or r.due_date >= p_date_from)
      and (p_date_to is null or r.due_date <= p_date_to);

    v_headers := '["File Name","Type","Uploaded By","Created"]'::jsonb;
    v_summary := jsonb_build_array(
      jsonb_build_object('label', 'Total Documents', 'value', v_total),
      jsonb_build_object('label', 'Records Need Docs', 'value', v_missing, 'variant', case when v_missing > 0 then 'warning' else 'success' end)
    );

  elsif p_report_id = 'overdue-training' then
    with scoped as (
      select
        'training:' || r.id::text as row_id,
        e.first_name,
        e.last_name,
        e.job_title,
        'Training'::text as item_kind,
        t.name as item_name,
        r.due_date,
        r.status
      from public.employee_training_records r
      join public.employees e on e.id = r.employee_id and not e.is_synthetic
      join public.training_types t on t.id = r.training_type_id
      join public.facilities f on f.id = r.facility_id and not f.is_sandbox
      where r.status = 'expired'
        and (p_facility_id is null or r.facility_id = p_facility_id)
        and (p_date_from is null or r.due_date >= p_date_from)
        and (p_date_to is null or r.due_date <= p_date_to)
      union all
      select
        'practicum:' || p.id::text,
        e.first_name,
        e.last_name,
        e.job_title,
        'Practicum',
        'Annual Practicum ' || p.practicum_year::text,
        p.due_date,
        p.status
      from public.practicums p
      join public.employees e on e.id = p.employee_id and not e.is_synthetic
      join public.facilities f on f.id = p.facility_id and not f.is_sandbox
      where p.status = 'expired'
        and (p_facility_id is null or p.facility_id = p_facility_id)
        and (p_date_from is null or p.due_date >= p_date_from)
        and (p_date_to is null or p.due_date <= p_date_to)
    ), paged as (
      select * from scoped
      order by due_date nulls last, last_name, first_name, row_id
      limit v_limit offset v_offset
    )
    select
      (select count(*) from scoped),
      coalesce((select jsonb_agg(jsonb_build_array(
        first_name || ' ' || last_name,
        coalesce(job_title, ''),
        item_kind,
        item_name,
        coalesce(due_date::text, ''),
        status
      ) order by due_date nulls last, last_name, first_name, row_id) from paged), '[]'::jsonb)
      into v_total, v_rows;
    v_headers := '["Employee","Job Title","Type","Item","Due Date","Status"]'::jsonb;
    v_summary := jsonb_build_array(
      jsonb_build_object('label', 'Overdue Items', 'value', v_total, 'variant', case when v_total > 0 then 'danger' else 'success' end)
    );

  elsif p_report_id = 'credential-status' then
    with scoped as (
      select
        c.id,
        e.first_name,
        e.last_name,
        c.credential_label,
        c.credential_type,
        c.credential_number,
        c.expiration_date,
        c.status
      from public.employee_credentials c
      join public.employees e on e.id = c.employee_id and not e.is_synthetic
      join public.facilities f on f.id = c.facility_id and not f.is_sandbox
      where (p_facility_id is null or c.facility_id = p_facility_id)
        and (p_date_from is null or c.expiration_date >= p_date_from)
        and (p_date_to is null or c.expiration_date <= p_date_to)
    ), paged as (
      select * from scoped
      order by expiration_date nulls last, last_name, first_name, id
      limit v_limit offset v_offset
    )
    select
      (select count(*) from scoped),
      (select count(*) from scoped where status = 'compliant'),
      (select count(*) from scoped where status = 'expired'),
      (select count(*) from scoped where status = 'due_soon'),
      coalesce((select jsonb_agg(jsonb_build_array(
        last_name || ', ' || first_name,
        coalesce(nullif(credential_label, ''), replace(credential_type, '_', ' ')),
        coalesce(credential_number, '—'),
        coalesce(expiration_date::text, 'No expiration'),
        status
      ) order by expiration_date nulls last, last_name, first_name, id) from paged), '[]'::jsonb)
      into v_total, v_compliant, v_expired, v_due_soon, v_rows;
    v_headers := '["Employee","Credential","Number","Expiration","Status"]'::jsonb;
    v_summary := jsonb_build_array(
      jsonb_build_object('label', 'Total Credentials', 'value', v_total),
      jsonb_build_object('label', 'Compliant', 'value', v_compliant, 'variant', 'success'),
      jsonb_build_object('label', 'Expired', 'value', v_expired, 'variant', case when v_expired > 0 then 'danger' else 'success' end),
      jsonb_build_object('label', 'Due Soon', 'value', v_due_soon, 'variant', case when v_due_soon > 0 then 'warning' else 'success' end)
    );

  elsif p_report_id = 'incident-log' then
    with scoped as (
      select i.id, i.occurred_at, f.name as facility_name, i.incident_type, i.severity, i.status
      from public.incidents i
      join public.facilities f on f.id = i.facility_id and not f.is_sandbox
      where (p_facility_id is null or i.facility_id = p_facility_id)
        and (p_date_from is null or i.occurred_at >= p_date_from::timestamptz)
        and (p_date_to is null or i.occurred_at < (p_date_to + 1)::timestamptz)
    ), paged as (
      select * from scoped
      order by occurred_at desc, id
      limit v_limit offset v_offset
    )
    select
      (select count(*) from scoped),
      (select count(*) from scoped where status <> 'closed'),
      (select count(*) from scoped where severity = 'critical'),
      coalesce((select jsonb_agg(jsonb_build_array(
        occurred_at::text,
        facility_name,
        replace(incident_type, '_', ' '),
        severity,
        status
      ) order by occurred_at desc, id) from paged), '[]'::jsonb)
      into v_total, v_other, v_expired, v_rows;
    v_headers := '["Occurred","Facility","Type","Severity","Status"]'::jsonb;
    v_summary := jsonb_build_array(
      jsonb_build_object('label', 'Total Incidents', 'value', v_total),
      jsonb_build_object('label', 'Open', 'value', v_other, 'variant', case when v_other > 0 then 'warning' else 'success' end),
      jsonb_build_object('label', 'Critical', 'value', v_expired, 'variant', case when v_expired > 0 then 'danger' else 'success' end)
    );

  elsif p_report_id = 'incident-notification-register' then
    with scoped as (
      select
        n.id,
        i.occurred_at,
        i.incident_type,
        f.name as facility_name,
        n.notification_type,
        n.due_at,
        n.completed_at,
        n.notification_method,
        n.recipient,
        n.reference_number,
        n.status
      from public.incident_notifications n
      join public.incidents i on i.id = n.incident_id
      join public.facilities f on f.id = i.facility_id and not f.is_sandbox
      where (p_facility_id is null or i.facility_id = p_facility_id)
        and (p_date_from is null or n.due_at >= p_date_from::timestamptz)
        and (p_date_to is null or n.due_at < (p_date_to + 1)::timestamptz)
    ), paged as (
      select * from scoped
      order by due_at desc, id
      limit v_limit offset v_offset
    )
    select
      (select count(*) from scoped),
      (select count(*) from scoped where status = 'completed'),
      (select count(*) from scoped where status = 'overdue'),
      coalesce((select jsonb_agg(jsonb_build_array(
        replace(incident_type, '_', ' ') || ' (' || occurred_at::date::text || ')',
        facility_name,
        replace(notification_type, '_', ' '),
        due_at::text,
        coalesce(completed_at::text, ''),
        coalesce(notification_method, ''),
        coalesce(recipient, ''),
        coalesce(reference_number, ''),
        status
      ) order by due_at desc, id) from paged), '[]'::jsonb)
      into v_total, v_compliant, v_expired, v_rows;
    v_headers := '["Incident","Facility","Notification Type","Due","Completed","Method","Recipient","Reference #","Status"]'::jsonb;
    v_summary := jsonb_build_array(
      jsonb_build_object('label', 'Total Notifications', 'value', v_total),
      jsonb_build_object('label', 'Completed', 'value', v_compliant, 'variant', 'success'),
      jsonb_build_object('label', 'Overdue', 'value', v_expired, 'variant', case when v_expired > 0 then 'danger' else 'success' end)
    );

  elsif p_report_id = 'inspection-compliance' then
    with scoped as (
      select i.id, f.name as facility_name, i.label, i.item_type, i.next_due_date, i.status
      from public.inspection_items i
      join public.facilities f on f.id = i.facility_id and not f.is_sandbox
      where i.is_active
        and (p_facility_id is null or i.facility_id = p_facility_id)
        and (p_date_from is null or i.next_due_date >= p_date_from)
        and (p_date_to is null or i.next_due_date <= p_date_to)
    ), paged as (
      select * from scoped
      order by next_due_date nulls last, facility_name, label, id
      limit v_limit offset v_offset
    )
    select
      (select count(*) from scoped),
      (select count(*) from scoped where status = 'compliant'),
      (select count(*) from scoped where status = 'expired'),
      (select count(*) from scoped where status = 'due_soon'),
      coalesce((select jsonb_agg(jsonb_build_array(
        facility_name,
        label,
        replace(item_type, '_', ' '),
        coalesce(next_due_date::text, '—'),
        status
      ) order by next_due_date nulls last, facility_name, label, id) from paged), '[]'::jsonb)
      into v_total, v_compliant, v_expired, v_due_soon, v_rows;
    v_headers := '["Facility","Item","Type","Next Due","Status"]'::jsonb;
    v_summary := jsonb_build_array(
      jsonb_build_object('label', 'Total Items', 'value', v_total),
      jsonb_build_object('label', 'Compliant', 'value', v_compliant, 'variant', 'success'),
      jsonb_build_object('label', 'Overdue', 'value', v_expired, 'variant', case when v_expired > 0 then 'danger' else 'success' end),
      jsonb_build_object('label', 'Due Soon', 'value', v_due_soon, 'variant', case when v_due_soon > 0 then 'warning' else 'success' end)
    );
  end if;

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

comment on function public.generate_paged_compliance_report(text, uuid, uuid, date, date, integer, integer)
is 'Generates one RLS-scoped compliance report page in Postgres so clients never download whole operational tables.';

revoke all on function public.generate_paged_compliance_report(text, uuid, uuid, date, date, integer, integer)
  from public, anon, authenticated;
grant execute on function public.generate_paged_compliance_report(text, uuid, uuid, date, date, integer, integer)
  to authenticated;
