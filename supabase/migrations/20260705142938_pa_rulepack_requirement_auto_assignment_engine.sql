-- PA rulepack / requirement auto-assignment engine, per ROADMAP.md Tier 2.3: nothing today
-- creates a "missing" requirement row for an employee who simply hasn't been given one yet, so
-- compliance percentages silently overstate (a facility with 20 employees and 5 recorded trainings
-- can show 100% "compliant" on those 5, while the other 15 never even appear). This instantiates
-- missing employee_training_records / practicums / employee_credentials shells on hire, on role
-- change (facility reassignment, med-admin or trainer designation), and when a new training_type
-- is created that applies to existing staff -- consuming the training_types.applies_to_* metadata
-- that already existed but was never read by anything.

-- State dimension: every training_type is implicitly Pennsylvania-only today. Adding the column
-- now (rather than waiting for a second state) means a future state's rulepack is just new rows
-- with a different `state` value, not new matching code -- the engine below already joins on it.
alter table public.training_types add column state text not null default 'PA';

-- Core instantiator: idempotent (NOT EXISTS-guarded) for one employee, safe to call repeatedly
-- from any of the triggers below or a manual backfill. Only ever inserts a 'missing' shell --
-- never touches an existing row of any status, so a record already tracked (including a
-- previously-completed or manually-marked not_applicable one) is left alone.
create or replace function public.instantiate_missing_requirements(p_employee_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_emp record;
begin
  select e.id, e.organization_id, e.facility_id, e.status, e.administers_medications, e.trainer_status,
         f.facility_type, coalesce(f.state, 'PA') as facility_state
    into v_emp
  from public.employees e
  join public.facilities f on f.id = e.facility_id
  where e.id = p_employee_id;

  if v_emp.id is null or v_emp.status <> 'active' then
    return;
  end if;

  insert into public.employee_training_records (organization_id, facility_id, employee_id, training_type_id, status, document_required)
  select v_emp.organization_id, v_emp.facility_id, v_emp.id, tt.id, 'missing', tt.document_required
  from public.training_types tt
  where tt.is_active
    and tt.state = v_emp.facility_state
    and (tt.organization_id is null or tt.organization_id = v_emp.organization_id)
    and (tt.applies_to_facility_type = 'BOTH' or tt.applies_to_facility_type = v_emp.facility_type)
    and (coalesce(tt.applies_to_administers_meds, false) = false or v_emp.administers_medications)
    and (coalesce(tt.applies_to_trainers, false) = false or v_emp.trainer_status)
    and not exists (
      select 1 from public.employee_training_records r
      where r.employee_id = v_emp.id and r.training_type_id = tt.id
    );

  if v_emp.administers_medications then
    insert into public.practicums (organization_id, facility_id, employee_id, practicum_year, status)
    select v_emp.organization_id, v_emp.facility_id, v_emp.id, extract(year from current_date)::int, 'missing'
    where not exists (
      select 1 from public.practicums p
      where p.employee_id = v_emp.id and p.practicum_year = extract(year from current_date)::int
    );
  end if;

  -- Universal-for-everyone credential shells (55 Pa. Code Section 2600.51/2800.51 PSP check;
  -- standard direct-care TB/health screening). The FBI-check (Act 73) residency-conditional flag
  -- and the other role-specific credential types (RN/LPN license, nurse aide registry) are Tier
  -- 2.7's job, not this engine's -- no employee field exists yet to gate them correctly.
  insert into public.employee_credentials (organization_id, facility_id, employee_id, credential_type, status)
  select v_emp.organization_id, v_emp.facility_id, v_emp.id, ct.credential_type, 'missing'
  from (values ('act34_criminal_history'), ('tb_screening')) as ct(credential_type)
  where not exists (
    select 1 from public.employee_credentials c
    where c.employee_id = v_emp.id and c.credential_type = ct.credential_type
  );
end;
$$;
revoke all on function public.instantiate_missing_requirements(uuid) from public, anon, authenticated;

-- Fires on hire (INSERT) and on the role-change signals this schema actually has: facility
-- reassignment (which can change facility_type and therefore which training_types apply),
-- med-admin designation, trainer designation, or a return from inactive/terminated to active.
create or replace function public.trigger_instantiate_requirements_on_employee_change()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if tg_op = 'INSERT' then
    perform public.instantiate_missing_requirements(new.id);
  elsif tg_op = 'UPDATE' and (
    new.facility_id is distinct from old.facility_id
    or new.administers_medications is distinct from old.administers_medications
    or new.trainer_status is distinct from old.trainer_status
    or (new.status = 'active' and old.status is distinct from 'active')
  ) then
    perform public.instantiate_missing_requirements(new.id);
  end if;
  return new;
end;
$$;
revoke all on function public.trigger_instantiate_requirements_on_employee_change() from public, anon, authenticated;

create trigger instantiate_requirements after insert or update on public.employees
  for each row execute function public.trigger_instantiate_requirements_on_employee_change();

-- Fires when a new training_type is created (a new requirement) that applies to existing staff --
-- e.g. an org adds a custom training type, or a future state rulepack ships new system-default
-- rows -- so compliance scores don't wait for the next time each affected employee happens to be
-- touched by the trigger above.
create or replace function public.trigger_instantiate_requirements_on_new_training_type()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_employee_id uuid;
begin
  if not new.is_active then
    return new;
  end if;
  for v_employee_id in
    select e.id from public.employees e
    join public.facilities f on f.id = e.facility_id
    where e.status = 'active'
      and (new.organization_id is null or e.organization_id = new.organization_id)
      and coalesce(f.state, 'PA') = new.state
      and (new.applies_to_facility_type = 'BOTH' or new.applies_to_facility_type = f.facility_type)
      and (coalesce(new.applies_to_administers_meds, false) = false or e.administers_medications)
      and (coalesce(new.applies_to_trainers, false) = false or e.trainer_status)
  loop
    perform public.instantiate_missing_requirements(v_employee_id);
  end loop;
  return new;
end;
$$;
revoke all on function public.trigger_instantiate_requirements_on_new_training_type() from public, anon, authenticated;

create trigger instantiate_requirements_on_new_type after insert on public.training_types
  for each row execute function public.trigger_instantiate_requirements_on_new_training_type();

-- Client-facing RPC: applying a training-plan item that targets a training_type (rather than a
-- course) previously did nothing at all (silently counted as "skipped" -- see
-- useApplyTrainingPlanToEmployee in useTrainingPlans.ts). A training plan is a deliberately curated
-- assignment, so this doesn't re-check facility-type/meds/trainer applicability the way the general
-- engine above does -- the admin explicitly chose to put this training type on this plan and apply
-- it to this employee.
create or replace function public.ensure_training_requirement_record(p_employee_id uuid, p_training_type_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_org uuid; v_fac uuid;
begin
  select organization_id, facility_id into v_org, v_fac from public.employees where id = p_employee_id;
  if v_org is null then
    raise exception 'employee % not found', p_employee_id using errcode = 'no_data_found';
  end if;
  if not (
    public.is_platform_admin()
    or (v_org = public.current_org_id() and public.current_role() in ('org_admin','facility_manager','trainer'))
  ) then
    raise exception 'not authorized' using errcode = 'insufficient_privilege';
  end if;

  insert into public.employee_training_records (organization_id, facility_id, employee_id, training_type_id, status, document_required)
  select v_org, v_fac, p_employee_id, tt.id, 'missing', tt.document_required
  from public.training_types tt
  where tt.id = p_training_type_id
    and not exists (
      select 1 from public.employee_training_records r
      where r.employee_id = p_employee_id and r.training_type_id = p_training_type_id
    );
end;
$$;
revoke all on function public.ensure_training_requirement_record(uuid, uuid) from public, anon;
grant execute on function public.ensure_training_requirement_record(uuid, uuid) to authenticated;

-- Keep the hour-bucket rollup's facility-type match state-consistent with the rest of the engine
-- now that training_types carries a state column.
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

  with bucket_years as (
    select extract(year from current_date)::int as training_year
  ),
  employee_bucket_candidates as (
    select e.id as employee_id, e.organization_id, e.facility_id, f.facility_type,
           coalesce(f.state, 'PA') as facility_state, bt.bucket_type
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
     and tt.state = ebc.facility_state
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

-- One-time backfill so the current roster benefits immediately rather than only future
-- hires/changes.
select public.instantiate_missing_requirements(id) from public.employees where status = 'active';