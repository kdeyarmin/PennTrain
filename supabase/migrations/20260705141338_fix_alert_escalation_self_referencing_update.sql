-- recalculate_compliance_core()'s escalations CTE joined alert_rank old_rank ON old_rank.alert_type
-- = a.alert_type inside the FROM-clause of an `update public.alerts a ... from computed c join
-- alert_rank ... join alert_rank ...` -- Postgres does not allow a FROM-list join to reference the
-- UPDATE target table (a) in its own ON clause; this raised "invalid reference to FROM-clause entry
-- for table 'a'" the moment any row actually needed escalating (never exercised when this was first
-- written and tested in 20260705061816/20260705141141, since no open alert in that test data needed
-- re-bucketing yet). Fixed by resolving the old/new rank comparison in a separate to_escalate CTE
-- that reads alerts as an ordinary FROM-clause table first, then the UPDATE just matches on alert id.
create or replace function public.recalculate_compliance_core(p_organization_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.employee_training_records r
  set
    due_date = case
      when r.completion_date is null or tt.renewal_interval_days is null then null
      else r.completion_date + tt.renewal_interval_days
    end,
    status = case
      when r.status in ('not_applicable','pending_review') then r.status
      when r.completion_date is null then 'missing'
      when tt.renewal_interval_days is null then 'compliant'
      when (r.completion_date + tt.renewal_interval_days) < current_date then 'expired'
      when (r.completion_date + tt.renewal_interval_days) <= current_date + tt.warning_days_default then 'due_soon'
      else 'compliant'
    end
  from public.training_types tt
  where r.training_type_id = tt.id
    and (p_organization_id is null or r.organization_id = p_organization_id);

  update public.practicums p
  set status = case
    when p.due_date is null then 'missing'
    when p.due_date < current_date then 'expired'
    when p.due_date <= current_date + p.reminder_days then 'due_soon'
    else 'compliant'
  end
  where (p_organization_id is null or p.organization_id = p_organization_id);

  with computed as (
    select
      r.id as training_record_id, r.organization_id, r.facility_id, r.employee_id,
      case
        when r.status = 'expired' then 'overdue'
        when r.due_date <= current_date + 7 then 'due_7'
        when r.due_date <= current_date + 14 then 'due_14'
        when r.due_date <= current_date + 30 then 'due_30'
        when r.due_date <= current_date + 60 then 'due_60'
        else 'due_90'
      end as computed_alert_type,
      case when r.status = 'expired' then 'critical' else 'warning' end as computed_severity,
      tt.name || ' — ' || e.first_name || ' ' || e.last_name as computed_title,
      case when r.status = 'expired'
        then tt.name || ' has expired for ' || e.first_name || ' ' || e.last_name
        else tt.name || ' is due soon for ' || e.first_name || ' ' || e.last_name
      end as computed_message
    from public.employee_training_records r
    join public.training_types tt on tt.id = r.training_type_id
    join public.employees e on e.id = r.employee_id
    where r.status in ('due_soon','expired')
      and (p_organization_id is null or r.organization_id = p_organization_id)
  ),
  alert_rank as (
    select unnest(array['due_90','due_60','due_30','due_14','due_7','overdue']) as alert_type,
           unnest(array[0,1,2,3,4,5]) as rank
  ),
  to_escalate as (
    select a.id as alert_id, c.computed_alert_type, c.computed_severity, c.computed_title, c.computed_message
    from computed c
    join public.alerts a on a.training_record_id = c.training_record_id and a.status = 'open'
    join alert_rank new_rank on new_rank.alert_type = c.computed_alert_type
    join alert_rank old_rank on old_rank.alert_type = a.alert_type
    where new_rank.rank > old_rank.rank
  ),
  escalations as (
    update public.alerts a
    set alert_type = te.computed_alert_type,
        severity = te.computed_severity,
        title = te.computed_title,
        message = te.computed_message
    from to_escalate te
    where a.id = te.alert_id
    returning a.training_record_id
  )
  insert into public.alerts (organization_id, facility_id, employee_id, training_record_id, alert_type, title, message, severity)
  select c.organization_id, c.facility_id, c.employee_id, c.training_record_id,
         c.computed_alert_type, c.computed_title, c.computed_message, c.computed_severity
  from computed c
  where not exists (
    select 1 from public.alerts a where a.training_record_id = c.training_record_id and a.status = 'open'
  );

  -- Annual-hours bucket rollup. Only the current calendar training_year is (re)computed here --
  -- past years are left frozen once the year ends. Scoped to active employees whose facility_type
  -- has an applicable hour_bucket training_type; an employee whose facility_type is e.g. 'NH' only
  -- ever gets a general_annual row (no dementia supplement exists for that setting today).
  with bucket_years as (
    select extract(year from current_date)::int as training_year
  ),
  employee_bucket_candidates as (
    select e.id as employee_id, e.organization_id, e.facility_id, f.facility_type, bt.bucket_type
    from public.employees e
    join public.facilities f on f.id = e.facility_id
    cross join (values ('general_annual'), ('alr_dementia'), ('sdcu_dementia')) as bt(bucket_type)
    where e.status = 'active'
      and (p_organization_id is null or e.organization_id = p_organization_id)
  ),
  applicable_types as (
    select distinct on (ebc.employee_id, ebc.bucket_type)
      ebc.employee_id, ebc.organization_id, ebc.facility_id, ebc.bucket_type, tt.required_hours
    from employee_bucket_candidates ebc
    join public.training_types tt
      on tt.hour_bucket = ebc.bucket_type
     and tt.is_active
     and (tt.applies_to_facility_type = ebc.facility_type or tt.applies_to_facility_type = 'BOTH')
     and (tt.organization_id is null or tt.organization_id = ebc.organization_id)
    order by ebc.employee_id, ebc.bucket_type, (tt.organization_id is not null) desc
  ),
  earned as (
    select
      at.employee_id, at.bucket_type,
      sum(case when r.completion_method is distinct from 'on_the_job' then coalesce(r.hours, 0) else 0 end) as non_ojt_hours,
      sum(case when r.completion_method = 'on_the_job' then coalesce(r.hours, 0) else 0 end) as ojt_hours_raw
    from applicable_types at
    join public.training_types tt2 on tt2.hour_bucket = at.bucket_type
      and (tt2.organization_id is null or tt2.organization_id = at.organization_id)
    join public.employee_training_records r
      on r.employee_id = at.employee_id
     and r.training_type_id = tt2.id
     and r.completion_date is not null
     and extract(year from r.completion_date)::int = (select training_year from bucket_years)
    group by at.employee_id, at.bucket_type
  )
  insert into public.employee_training_hour_buckets (
    organization_id, facility_id, employee_id, training_year, bucket_type, required_hours, completed_hours, ojt_hours, status
  )
  select
    at.organization_id, at.facility_id, at.employee_id, (select training_year from bucket_years), at.bucket_type,
    at.required_hours,
    coalesce(e.non_ojt_hours, 0) + least(coalesce(e.ojt_hours_raw, 0), case when at.bucket_type = 'general_annual' then 6 else 0 end),
    coalesce(e.ojt_hours_raw, 0),
    case
      when coalesce(e.non_ojt_hours, 0) + least(coalesce(e.ojt_hours_raw, 0), case when at.bucket_type = 'general_annual' then 6 else 0 end) >= at.required_hours
        then 'compliant'
      when (make_date((select training_year from bucket_years), 12, 31) - current_date) <= 90 then 'due_soon'
      else 'incomplete'
    end
  from applicable_types at
  left join earned e on e.employee_id = at.employee_id and e.bucket_type = at.bucket_type
  on conflict (employee_id, training_year, bucket_type) do update set
    organization_id = excluded.organization_id,
    facility_id = excluded.facility_id,
    required_hours = excluded.required_hours,
    completed_hours = excluded.completed_hours,
    ojt_hours = excluded.ojt_hours,
    status = excluded.status;
end;
$$;
revoke all on function public.recalculate_compliance_core(uuid) from public, anon, authenticated;
