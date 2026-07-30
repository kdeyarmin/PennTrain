-- Explainable 30/60/90-day workforce readiness forecast.
--
-- The existing employee readiness verdict answers whether a person is eligible now. This RPC looks
-- forward without inventing a separate compliance model: it uses the current credential and training
-- records already maintained by the compliance engine, attributes each projected risk to the exact
-- record and date, and reports the first horizon in which the employee needs action.

create or replace function public.get_workforce_readiness_forecast(p_facility_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_today date := public.pa_today();
begin
  -- Interactive callers use the same manager/facility authorization as the Value Center. The daily
  -- maintenance worker runs as service_role and therefore has no auth.uid(); for that path derive the
  -- organization from the facility itself rather than failing the user-session guard. No caller may
  -- choose an organization independently of the facility id.
  if current_user in ('postgres', 'service_role', 'supabase_admin') then
    select f.organization_id into v_org
    from public.facilities f
    where f.id = p_facility_id and f.is_active;
    if v_org is null then
      raise exception 'Active facility was not found' using errcode = 'P0002';
    end if;
  else
    v_org := app_private.assert_product_value_manager(p_facility_id);
  end if;

  return (
    with facility_employees as (
      select distinct e.id, e.first_name, e.last_name, e.job_title, e.department,
        e.cleared_for_unsupervised_duty
      from public.employees e
      left join public.employee_facility_assignments efa
        on efa.employee_id = e.id and efa.facility_id = p_facility_id
      where e.organization_id = v_org
        and e.status = 'active'
        and (e.facility_id = p_facility_id or efa.id is not null)
    ),
    current_credentials as (
      select distinct on (c.employee_id, c.credential_type)
        c.id, c.employee_id, c.credential_type,
        coalesce(nullif(btrim(c.credential_label), ''), initcap(replace(c.credential_type, '_', ' '))) as label,
        c.status, c.expiration_date, c.warning_days
      from public.employee_credentials c
      join facility_employees e on e.id = c.employee_id
      order by c.employee_id, c.credential_type,
        c.expiration_date desc nulls last, c.updated_at desc, c.id desc
    ),
    current_training as (
      select distinct on (r.employee_id, r.training_type_id)
        r.id, r.employee_id, r.training_type_id, t.name as label,
        r.status, r.due_date, r.completion_date
      from public.employee_training_records r
      join facility_employees e on e.id = r.employee_id
      join public.training_types t on t.id = r.training_type_id
      order by r.employee_id, r.training_type_id,
        (r.status = 'missing') asc,
        r.completion_date desc nulls last,
        r.due_date desc nulls last,
        r.updated_at desc,
        r.id desc
    ),
    risk_events as (
      select
        c.employee_id,
        'credential'::text as risk_type,
        c.id as source_id,
        c.label,
        c.expiration_date as risk_date,
        case
          when c.status in ('expired', 'missing') then 'current_blocker'
          when c.expiration_date is not null and c.expiration_date < v_today then 'current_blocker'
          else 'expires'
        end as reason,
        (c.status in ('expired', 'missing') or (c.expiration_date is not null and c.expiration_date < v_today)) as current_blocker,
        '/app/credentials'::text as href
      from current_credentials c
      where c.status in ('expired', 'missing')
         or (c.expiration_date is not null and c.expiration_date <= v_today + 90)

      union all

      select
        r.employee_id,
        'training'::text,
        r.id,
        r.label,
        r.due_date,
        case
          when r.status in ('expired', 'missing') then 'current_blocker'
          when r.due_date is not null and r.due_date < v_today then 'current_blocker'
          else 'due'
        end,
        (r.status in ('expired', 'missing') or (r.due_date is not null and r.due_date < v_today)),
        '/app/training-matrix'::text
      from current_training r
      where r.status in ('expired', 'missing')
         or (r.due_date is not null and r.due_date <= v_today + 90)

      union all

      select
        e.id,
        'duty_clearance'::text,
        e.id,
        'Unsupervised-duty clearance'::text,
        v_today,
        'supervision_required'::text,
        true,
        concat('/app/employees/', e.id)::text
      from facility_employees e
      where not e.cleared_for_unsupervised_duty
    ),
    employee_risks as (
      select
        e.id as employee_id,
        concat(e.first_name, ' ', e.last_name) as employee_name,
        e.job_title,
        e.department,
        min(coalesce(r.risk_date, v_today)) as first_risk_date,
        bool_or(r.current_blocker) as current_blocker,
        jsonb_agg(
          jsonb_build_object(
            'type', r.risk_type,
            'sourceId', r.source_id,
            'label', r.label,
            'riskDate', r.risk_date,
            'reason', r.reason,
            'currentBlocker', r.current_blocker,
            'href', r.href
          )
          order by r.current_blocker desc, r.risk_date nulls first, r.label
        ) as reasons
      from facility_employees e
      join risk_events r on r.employee_id = e.id
      group by e.id, e.first_name, e.last_name, e.job_title, e.department
    ),
    horizon_values(days) as (values (30), (60), (90))
    select jsonb_build_object(
      'facilityId', p_facility_id,
      'asOf', v_today,
      'activeEmployees', (select count(*) from facility_employees),
      'currentBlockers', (
        select count(*) from employee_risks er where er.current_blocker
      ),
      'horizons', (
        select jsonb_agg(
          jsonb_build_object(
            'days', h.days,
            'through', v_today + h.days,
            'employeesAtRisk', (
              select count(distinct r.employee_id)
              from risk_events r
              where r.current_blocker or r.risk_date <= v_today + h.days
            ),
            'credentialEvents', (
              select count(*) from risk_events r
              where r.risk_type = 'credential'
                and (r.current_blocker or r.risk_date <= v_today + h.days)
            ),
            'trainingEvents', (
              select count(*) from risk_events r
              where r.risk_type = 'training'
                and (r.current_blocker or r.risk_date <= v_today + h.days)
            )
          ) order by h.days
        ) from horizon_values h
      ),
      'risks', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'employeeId', er.employee_id,
            'employeeName', er.employee_name,
            'jobTitle', er.job_title,
            'department', er.department,
            'firstRiskDate', er.first_risk_date,
            'currentBlocker', er.current_blocker,
            'reasons', er.reasons
          )
          order by er.current_blocker desc, er.first_risk_date, er.employee_name
        )
        from (select * from employee_risks order by current_blocker desc, first_risk_date limit 150) er
      ), '[]'::jsonb),
      'method', 'Current credential and training records projected against the Pennsylvania facility day. Missing or expired records remain blockers; future dates are attributed to their source record.',
      'generatedAt', now()
    )
  );
end;
$$;

revoke all on function public.get_workforce_readiness_forecast(uuid) from public, anon;
grant execute on function public.get_workforce_readiness_forecast(uuid) to authenticated, service_role;

comment on function public.get_workforce_readiness_forecast(uuid) is
  'Returns an explainable 30/60/90-day readiness forecast for active employees assigned to one facility. Interactive callers are manager-scoped; the service-role maintenance worker derives scope only from the facility.';
