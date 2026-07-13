-- High-volume resident service delivery is intentionally separate from work_items.
-- work_items remains the administrative/compliance remediation engine; these tables retain
-- support-plan version lineage and immutable service-delivery history at operational volume.

create table public.resident_service_requirements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  resident_id uuid not null references public.residents(id) on delete restrict,
  source_assessment_form_id uuid not null references public.resident_assessment_forms(id) on delete restrict,
  source_plan_version integer not null,
  source_section text not null,
  source_key text not null,
  service_code text not null,
  service_name text not null,
  need_description text,
  special_instructions text not null,
  frequency text not null check (frequency in ('hourly', 'daily', 'weekly', 'monthly', 'other')),
  frequency_detail text,
  time_window_start time not null default '09:00',
  time_window_end time not null default '11:00',
  responsible_role text not null,
  unit_id uuid references public.facility_units(id) on delete set null,
  requires_two_staff boolean not null default false,
  documentation_mode text not null default 'every_task'
    check (documentation_mode in ('every_task', 'exception_only')),
  effective_from date not null,
  expires_on date,
  status text not null default 'active' check (status in ('active', 'superseded', 'canceled')),
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_assessment_form_id, source_section, source_key),
  check (time_window_end > time_window_start),
  check (expires_on is null or expires_on >= effective_from),
  check (status <> 'superseded' or superseded_at is not null)
);
create index resident_service_requirements_queue_idx
  on public.resident_service_requirements(organization_id, facility_id, resident_id, status, effective_from);

create table public.resident_service_task_instances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  resident_id uuid not null references public.residents(id) on delete restrict,
  requirement_id uuid not null references public.resident_service_requirements(id) on delete restrict,
  source_assessment_form_id uuid not null references public.resident_assessment_forms(id) on delete restrict,
  source_plan_version integer not null,
  service_name text not null,
  responsible_role text not null,
  unit_id uuid references public.facility_units(id) on delete set null,
  scheduled_start timestamptz not null,
  scheduled_end timestamptz not null,
  assigned_employee_id uuid references public.employees(id) on delete set null,
  second_employee_id uuid references public.employees(id) on delete set null,
  status text not null default 'scheduled' check (status in (
    'scheduled', 'completed', 'resident_refused', 'resident_unavailable',
    'not_completed', 'completed_late', 'completed_by_other', 'superseded'
  )),
  completed_by_employee_id uuid references public.employees(id) on delete set null,
  recorded_by_profile_id uuid references public.profiles(id) on delete set null,
  performed_at timestamptz,
  note text,
  supervisor_notified boolean not null default false,
  supervisor_notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (requirement_id, scheduled_start),
  check (scheduled_end > scheduled_start),
  check (
    (status in ('scheduled', 'superseded') and performed_at is null)
    or (status not in ('scheduled', 'superseded') and performed_at is not null)
  )
);
create index resident_service_tasks_staff_queue_idx
  on public.resident_service_task_instances(facility_id, assigned_employee_id, status, scheduled_start);
create index resident_service_tasks_resident_history_idx
  on public.resident_service_task_instances(resident_id, scheduled_start desc);

create table public.service_exception_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  exception_status text not null check (exception_status in (
    'resident_refused', 'resident_unavailable', 'not_completed', 'completed_late'
  )),
  threshold_count integer not null default 1 check (threshold_count between 1 and 100),
  lookback_days integer not null default 7 check (lookback_days between 1 and 90),
  action_target text not null check (action_target in (
    'supervisor', 'change_of_condition', 'support_plan_review', 'qapi'
  )),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (facility_id, exception_status, action_target)
);

create table public.service_task_alerts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  resident_id uuid not null references public.residents(id) on delete restrict,
  task_instance_id uuid not null references public.resident_service_task_instances(id) on delete restrict,
  rule_id uuid references public.service_exception_rules(id) on delete set null,
  alert_type text not null check (alert_type in (
    'missed_service', 'repeated_refusal', 'repeated_unavailability',
    'late_service_pattern', 'change_of_condition_review',
    'support_plan_review', 'qapi_review'
  )),
  severity text not null default 'warning' check (severity in ('info', 'warning', 'critical')),
  title text not null,
  message text not null,
  status text not null default 'open' check (status in ('open', 'acknowledged', 'resolved')),
  acknowledged_by uuid references public.profiles(id),
  acknowledged_at timestamptz,
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (task_instance_id, alert_type)
);
create index service_task_alerts_queue_idx
  on public.service_task_alerts(organization_id, facility_id, status, created_at desc);

alter table public.resident_service_requirements enable row level security;
alter table public.resident_service_task_instances enable row level security;
alter table public.service_exception_rules enable row level security;
alter table public.service_task_alerts enable row level security;

create policy resident_service_requirements_select on public.resident_service_requirements
for select to authenticated
using (
  public.is_platform_admin()
  or (
    organization_id = (select public.current_org_id())
    and (
      (select public.current_role()) in ('org_admin', 'auditor')
      or (
        (select public.current_role()) = 'facility_manager'
        and public.is_assigned_to_facility(facility_id)
      )
    )
  )
);

create policy resident_service_tasks_select on public.resident_service_task_instances
for select to authenticated
using (
  public.is_platform_admin()
  or (
    organization_id = (select public.current_org_id())
    and (
      (select public.current_role()) in ('org_admin', 'auditor')
      or (
        (select public.current_role()) = 'facility_manager'
        and public.is_assigned_to_facility(facility_id)
      )
      or (
        (select public.current_role()) = 'employee'
        and exists (
          select 1 from public.employees e
          where e.profile_id = (select auth.uid())
            and e.status = 'active'
            and e.facility_id = resident_service_task_instances.facility_id
            and (
              resident_service_task_instances.assigned_employee_id is null
              or resident_service_task_instances.assigned_employee_id = e.id
            )
        )
      )
    )
  )
);

create policy service_exception_rules_select on public.service_exception_rules
for select to authenticated
using (
  public.is_platform_admin()
  or (
    organization_id = (select public.current_org_id())
    and (
      (select public.current_role()) in ('org_admin', 'auditor')
      or (
        (select public.current_role()) = 'facility_manager'
        and public.is_assigned_to_facility(facility_id)
      )
    )
  )
);

create policy service_task_alerts_select on public.service_task_alerts
for select to authenticated
using (
  public.is_platform_admin()
  or (
    organization_id = (select public.current_org_id())
    and (
      (select public.current_role()) in ('org_admin', 'auditor')
      or (
        (select public.current_role()) = 'facility_manager'
        and public.is_assigned_to_facility(facility_id)
      )
    )
  )
);

revoke all on public.resident_service_requirements,
  public.resident_service_task_instances,
  public.service_exception_rules,
  public.service_task_alerts
from public, anon, authenticated, service_role;
grant all on public.resident_service_requirements,
  public.resident_service_task_instances,
  public.service_exception_rules,
  public.service_task_alerts
to service_role;
grant select on public.resident_service_requirements,
  public.resident_service_task_instances,
  public.service_exception_rules,
  public.service_task_alerts
to authenticated;

create or replace function app_private.humanize_service_key(p_key text)
returns text
language sql
immutable
set search_path = ''
as $$
  select initcap(
    regexp_replace(
      replace(coalesce(p_key, 'resident service'), '_', ' '),
      '([a-z0-9])([A-Z])',
      '\1 \2',
      'g'
    )
  )
$$;
revoke all on function app_private.humanize_service_key(text)
  from public, anon, authenticated, service_role;

create or replace function app_private.service_effective_date(p_form public.resident_assessment_forms)
returns date
language plpgsql
stable
set search_path = ''
as $$
declare
  v_candidate text := p_form.content #>> '{assessmentInfo,lastSupportPlanDate}';
begin
  begin
    if nullif(v_candidate, '') is not null then return v_candidate::date; end if;
  exception when others then
    null;
  end;
  return coalesce(p_form.finalized_at::date, current_date);
end;
$$;
revoke all on function app_private.service_effective_date(public.resident_assessment_forms)
  from public, anon, authenticated, service_role;

create or replace function app_private.insert_service_requirement(
  p_form public.resident_assessment_forms,
  p_section text,
  p_key text,
  p_answer jsonb,
  p_kind text,
  p_effective_from date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan text := btrim(coalesce(p_answer->>'planDescription', ''));
  v_need text;
  v_frequency text := lower(coalesce(nullif(p_answer->>'planFrequency', ''), 'daily'));
  v_role text := coalesce(
    nullif(p_answer->>'planResponsibleParty', ''),
    nullif(p_answer->>'planResponsiblePartyOther', ''),
    'DCS'
  );
  v_id uuid;
begin
  if v_plan = '' then return null; end if;
  if p_kind = 'degree' and coalesce((p_answer->>'planNotApplicable')::boolean, false) then
    return null;
  end if;
  if p_kind = 'simple' and not coalesce((p_answer->>'applicable')::boolean, true) then
    return null;
  end if;
  if v_frequency not in ('hourly', 'daily', 'weekly', 'monthly', 'other') then
    v_frequency := 'other';
  end if;
  v_need := coalesce(
    nullif(p_answer->>'serviceNeedDescription', ''),
    nullif(p_answer->>'needsDescription', ''),
    nullif(p_answer->>'description', '')
  );
  insert into public.resident_service_requirements (
    organization_id, facility_id, resident_id, source_assessment_form_id,
    source_plan_version, source_section, source_key, service_code, service_name,
    need_description, special_instructions, frequency, frequency_detail,
    responsible_role, effective_from
  ) values (
    p_form.organization_id, p_form.facility_id, p_form.resident_id, p_form.id,
    p_form.version_number, p_section, p_key, p_section || '.' || p_key,
    app_private.humanize_service_key(p_key), v_need, v_plan, v_frequency,
    nullif(p_answer->>'planFrequencyOther', ''), v_role, p_effective_from
  )
  on conflict (source_assessment_form_id, source_section, source_key) do nothing
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function app_private.insert_service_requirement(
  public.resident_assessment_forms, text, text, jsonb, text, date
) from public, anon, authenticated, service_role;

create or replace function public.generate_resident_service_tasks(
  p_from date default current_date,
  p_through date default current_date + 14,
  p_requirement_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_requirement public.resident_service_requirements%rowtype;
  v_day date;
  v_hour integer;
  v_start timestamptz;
  v_inserted integer := 0;
  v_rows integer;
begin
  if p_through < p_from or p_through > p_from + 45 then
    raise exception 'Service task generation range must be between 0 and 45 days' using errcode = '22023';
  end if;
  for v_requirement in
    select *
    from public.resident_service_requirements r
    where r.status = 'active'
      and (p_requirement_id is null or r.id = p_requirement_id)
      and r.effective_from <= p_through
      and (r.expires_on is null or r.expires_on >= p_from)
  loop
    v_day := greatest(p_from, v_requirement.effective_from);
    while v_day <= least(p_through, coalesce(v_requirement.expires_on, p_through)) loop
      if v_requirement.frequency = 'hourly' then
        v_hour := extract(hour from v_requirement.time_window_start)::integer;
        while v_hour < extract(hour from v_requirement.time_window_end)::integer loop
          v_start := v_day + make_interval(hours => v_hour);
          insert into public.resident_service_task_instances (
            organization_id, facility_id, resident_id, requirement_id,
            source_assessment_form_id, source_plan_version, service_name,
            responsible_role, unit_id, scheduled_start, scheduled_end
          ) values (
            v_requirement.organization_id, v_requirement.facility_id, v_requirement.resident_id,
            v_requirement.id, v_requirement.source_assessment_form_id,
            v_requirement.source_plan_version, v_requirement.service_name,
            v_requirement.responsible_role, v_requirement.unit_id,
            v_start, v_start + interval '1 hour'
          ) on conflict (requirement_id, scheduled_start) do nothing;
          get diagnostics v_rows = row_count;
          v_inserted := v_inserted + v_rows;
          v_hour := v_hour + 1;
        end loop;
      elsif v_requirement.frequency = 'daily'
        or (v_requirement.frequency = 'weekly' and extract(isodow from v_day) = 1)
        or (v_requirement.frequency = 'monthly' and extract(day from v_day) = 1)
        or (v_requirement.frequency = 'other' and v_day = v_requirement.effective_from) then
        v_start := v_day + v_requirement.time_window_start;
        insert into public.resident_service_task_instances (
          organization_id, facility_id, resident_id, requirement_id,
          source_assessment_form_id, source_plan_version, service_name,
          responsible_role, unit_id, scheduled_start, scheduled_end
        ) values (
          v_requirement.organization_id, v_requirement.facility_id, v_requirement.resident_id,
          v_requirement.id, v_requirement.source_assessment_form_id,
          v_requirement.source_plan_version, v_requirement.service_name,
          v_requirement.responsible_role, v_requirement.unit_id,
          v_start, v_day + v_requirement.time_window_end
        ) on conflict (requirement_id, scheduled_start) do nothing;
        get diagnostics v_rows = row_count;
        v_inserted := v_inserted + v_rows;
      end if;
      v_day := v_day + 1;
    end loop;
  end loop;
  return v_inserted;
end;
$$;
revoke all on function public.generate_resident_service_tasks(date, date, uuid)
  from public, anon, authenticated;
grant execute on function public.generate_resident_service_tasks(date, date, uuid)
  to service_role;

create or replace function public.materialize_service_requirements_from_assessment_form(p_form_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_form public.resident_assessment_forms%rowtype;
  v_effective date;
  v_entry record;
  v_count integer;
begin
  select * into v_form
  from public.resident_assessment_forms
  where id = p_form_id
  for update;
  if not found or v_form.status <> 'finalized' then
    raise exception 'Only a finalized support plan can create service requirements' using errcode = '22023';
  end if;
  v_effective := app_private.service_effective_date(v_form);

  update public.resident_service_requirements
  set status = 'superseded',
      expires_on = greatest(effective_from, v_effective - 1),
      superseded_at = now(),
      updated_at = now()
  where resident_id = v_form.resident_id
    and source_assessment_form_id <> v_form.id
    and status = 'active';

  update public.resident_service_task_instances
  set status = 'superseded', updated_at = now()
  where resident_id = v_form.resident_id
    and source_assessment_form_id <> v_form.id
    and status = 'scheduled'
    and scheduled_start::date >= v_effective;

  for v_entry in select key, value from jsonb_each(coalesce(v_form.content #> '{section1,items}', '{}')) loop
    perform app_private.insert_service_requirement(v_form, 'personal_care', v_entry.key, v_entry.value, 'degree', v_effective);
  end loop;
  for v_entry in
    select key, value from jsonb_each(jsonb_build_object(
      'supervision', coalesce(v_form.content #> '{section1,supervision}', '{}'),
      'mobility', coalesce(v_form.content #> '{section1,mobility}', '{}'),
      'medications', coalesce(v_form.content #> '{section1,medications}', '{}')
    ))
  loop
    perform app_private.insert_service_requirement(v_form, 'personal_care', v_entry.key, v_entry.value, 'simple', v_effective);
  end loop;
  for v_entry in select key, value from jsonb_each(coalesce(v_form.content #> '{section2,sensory}', '{}')) loop
    perform app_private.insert_service_requirement(v_form, 'sensory', v_entry.key, v_entry.value, 'simple', v_effective);
  end loop;
  for v_entry in select key, value from jsonb_each(coalesce(v_form.content #> '{section3,items}', '{}')) loop
    perform app_private.insert_service_requirement(v_form, 'behavioral', v_entry.key, v_entry.value, 'degree', v_effective);
  end loop;
  for v_entry in select key, value from jsonb_each(coalesce(v_form.content #> '{section4,items}', '{}')) loop
    perform app_private.insert_service_requirement(v_form, 'social', v_entry.key, v_entry.value, 'simple', v_effective);
  end loop;
  for v_entry in
    select 'physical_' || (ordinality - 1)::text as key, value
    from jsonb_array_elements(coalesce(v_form.content #> '{section2,physicalDiagnoses}', '[]')) with ordinality
    union all
    select 'dental_' || (ordinality - 1)::text, value
    from jsonb_array_elements(coalesce(v_form.content #> '{section2,dental}', '[]')) with ordinality
    union all
    select 'dietary_' || (ordinality - 1)::text, value
    from jsonb_array_elements(coalesce(v_form.content #> '{section2,dietary}', '[]')) with ordinality
    union all
    select 'behavioral_' || (ordinality - 1)::text, value
    from jsonb_array_elements(coalesce(v_form.content #> '{section3,psychologicalDiagnoses}', '[]')) with ordinality
  loop
    perform app_private.insert_service_requirement(v_form, 'resident_specific', v_entry.key, v_entry.value, 'diagnosis', v_effective);
  end loop;

  select count(*)::integer into v_count
  from public.resident_service_requirements
  where source_assessment_form_id = v_form.id;
  perform public.generate_resident_service_tasks(
    greatest(current_date, v_effective),
    greatest(current_date, v_effective) + 14,
    null
  );
  return v_count;
end;
$$;
revoke all on function public.materialize_service_requirements_from_assessment_form(uuid)
  from public, anon, authenticated;
grant execute on function public.materialize_service_requirements_from_assessment_form(uuid)
  to service_role;

create or replace function app_private.materialize_finalized_support_plan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'finalized' and old.status is distinct from new.status then
    perform public.materialize_service_requirements_from_assessment_form(new.id);
  end if;
  return new;
end;
$$;
revoke all on function app_private.materialize_finalized_support_plan()
  from public, anon, authenticated, service_role;
create trigger materialize_finalized_support_plan
after update of status on public.resident_assessment_forms
for each row execute function app_private.materialize_finalized_support_plan();

create or replace function public.update_resident_service_requirement(
  p_requirement_id uuid,
  p_frequency text,
  p_frequency_detail text,
  p_time_window_start time,
  p_time_window_end time,
  p_responsible_role text,
  p_unit_id uuid,
  p_special_instructions text,
  p_requires_two_staff boolean,
  p_documentation_mode text,
  p_expires_on date
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_requirement public.resident_service_requirements%rowtype;
begin
  select * into v_requirement
  from public.resident_service_requirements
  where id = p_requirement_id for update;
  if not found then raise exception 'Service requirement not found' using errcode = 'P0002'; end if;
  perform app_private.assert_phase5_manager(v_requirement.organization_id, v_requirement.facility_id);
  if v_requirement.status <> 'active'
    or p_frequency not in ('hourly', 'daily', 'weekly', 'monthly', 'other')
    or p_time_window_end <= p_time_window_start
    or length(btrim(coalesce(p_responsible_role, ''))) < 1
    or length(btrim(coalesce(p_special_instructions, ''))) < 1
    or p_documentation_mode not in ('every_task', 'exception_only')
    or (p_expires_on is not null and p_expires_on < v_requirement.effective_from) then
    raise exception 'Invalid service requirement configuration' using errcode = '22023';
  end if;
  if p_unit_id is not null and not exists (
    select 1 from public.facility_units u
    where u.id = p_unit_id and u.facility_id = v_requirement.facility_id
  ) then
    raise exception 'Unit is outside requirement facility' using errcode = '22023';
  end if;
  update public.resident_service_requirements
  set frequency = p_frequency,
      frequency_detail = nullif(btrim(p_frequency_detail), ''),
      time_window_start = p_time_window_start,
      time_window_end = p_time_window_end,
      responsible_role = btrim(p_responsible_role),
      unit_id = p_unit_id,
      special_instructions = btrim(p_special_instructions),
      requires_two_staff = p_requires_two_staff,
      documentation_mode = p_documentation_mode,
      expires_on = p_expires_on,
      updated_at = now()
  where id = p_requirement_id;
  update public.resident_service_task_instances
  set status = 'superseded', updated_at = now()
  where requirement_id = p_requirement_id
    and status = 'scheduled'
    and scheduled_start > now();
  perform public.generate_resident_service_tasks(current_date, current_date + 14, p_requirement_id);
  return true;
end;
$$;

create or replace function app_private.evaluate_service_task_exception(
  p_task public.resident_service_task_instances
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule public.service_exception_rules%rowtype;
  v_count integer;
  v_alert_type text;
begin
  if p_task.status not in ('resident_refused', 'resident_unavailable', 'not_completed', 'completed_late') then
    return;
  end if;
  for v_rule in
    select * from public.service_exception_rules
    where facility_id = p_task.facility_id
      and exception_status = p_task.status
      and is_active
  loop
    select count(*)::integer into v_count
    from public.resident_service_task_instances t
    where t.resident_id = p_task.resident_id
      and t.status = p_task.status
      and t.performed_at >= now() - make_interval(days => v_rule.lookback_days);
    if v_count >= v_rule.threshold_count then
      v_alert_type := case
        when v_rule.action_target = 'change_of_condition' then 'change_of_condition_review'
        when v_rule.action_target = 'support_plan_review' then 'support_plan_review'
        when v_rule.action_target = 'qapi' then 'qapi_review'
        when p_task.status = 'resident_refused' then 'repeated_refusal'
        when p_task.status = 'resident_unavailable' then 'repeated_unavailability'
        when p_task.status = 'completed_late' then 'late_service_pattern'
        else 'missed_service'
      end;
      insert into public.service_task_alerts (
        organization_id, facility_id, resident_id, task_instance_id, rule_id,
        alert_type, severity, title, message
      ) values (
        p_task.organization_id, p_task.facility_id, p_task.resident_id, p_task.id,
        v_rule.id, v_alert_type,
        case when p_task.status = 'not_completed' then 'critical' else 'warning' end,
        case when p_task.status = 'not_completed' then 'Resident service not completed'
             else 'Resident service exception threshold reached' end,
        p_task.service_name || ': ' || replace(p_task.status, '_', ' ')
          || ' occurred ' || v_count || ' time(s) in ' || v_rule.lookback_days || ' days. '
          || 'Route for ' || replace(v_rule.action_target, '_', ' ') || '.'
      ) on conflict (task_instance_id, alert_type) do nothing;
    end if;
  end loop;
end;
$$;
revoke all on function app_private.evaluate_service_task_exception(
  public.resident_service_task_instances
) from public, anon, authenticated, service_role;

create or replace function public.record_resident_service_task(
  p_task_id uuid,
  p_status text,
  p_note text default null,
  p_supervisor_notified boolean default false,
  p_second_employee_id uuid default null
)
returns public.resident_service_task_instances
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.resident_service_task_instances%rowtype;
  v_requirement public.resident_service_requirements%rowtype;
  v_employee public.employees%rowtype;
  v_is_manager boolean;
  v_result_status text;
begin
  select * into v_task from public.resident_service_task_instances where id = p_task_id for update;
  if not found then raise exception 'Service task not found' using errcode = 'P0002'; end if;
  if v_task.status <> 'scheduled' then
    raise exception 'Only scheduled service tasks can be recorded' using errcode = '55000';
  end if;
  select * into v_requirement from public.resident_service_requirements where id = v_task.requirement_id;
  select * into v_employee from public.employees e
  where e.profile_id = auth.uid() and e.status = 'active';
  v_is_manager := public.is_platform_admin()
    or (
      public.current_org_id() = v_task.organization_id
      and public.current_role() in ('org_admin', 'facility_manager')
      and (
        public.current_role() <> 'facility_manager'
        or public.is_assigned_to_facility(v_task.facility_id)
      )
    );
  if not v_is_manager and (
    v_employee.id is null
    or v_employee.facility_id <> v_task.facility_id
    or (v_task.assigned_employee_id is not null and v_task.assigned_employee_id <> v_employee.id)
  ) then
    raise exception 'Service task is outside caller scope' using errcode = '42501';
  end if;
  if p_status not in (
    'completed', 'resident_refused', 'resident_unavailable',
    'not_completed', 'completed_by_other'
  ) then
    raise exception 'Invalid service task outcome' using errcode = '22023';
  end if;
  if p_status <> 'completed'
    and length(btrim(coalesce(p_note, ''))) < 3 then
    raise exception 'Service exceptions require a note' using errcode = '22023';
  end if;
  if v_requirement.requires_two_staff and p_second_employee_id is null then
    raise exception 'This service requires two authorized staff members' using errcode = '22023';
  end if;
  if p_second_employee_id is not null and not exists (
    select 1 from public.employees e
    where e.id = p_second_employee_id
      and e.organization_id = v_task.organization_id
      and e.facility_id = v_task.facility_id
      and e.status = 'active'
      and (v_employee.id is null or e.id <> v_employee.id)
  ) then
    raise exception 'Second staff member is not an active employee at this facility' using errcode = '22023';
  end if;
  v_result_status := case
    when p_status = 'completed' and now() > v_task.scheduled_end then 'completed_late'
    else p_status
  end;
  update public.resident_service_task_instances
  set status = v_result_status,
      assigned_employee_id = coalesce(assigned_employee_id, v_employee.id),
      completed_by_employee_id = v_employee.id,
      recorded_by_profile_id = auth.uid(),
      second_employee_id = p_second_employee_id,
      performed_at = now(),
      note = nullif(btrim(p_note), ''),
      supervisor_notified = p_supervisor_notified,
      supervisor_notified_at = case when p_supervisor_notified then now() else null end,
      updated_at = now()
  where id = v_task.id
  returning * into v_task;
  perform app_private.evaluate_service_task_exception(v_task);
  return v_task;
end;
$$;

create or replace function public.assign_resident_service_task(
  p_task_id uuid,
  p_employee_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.resident_service_task_instances%rowtype;
begin
  select * into v_task from public.resident_service_task_instances where id = p_task_id for update;
  if not found then raise exception 'Service task not found' using errcode = 'P0002'; end if;
  perform app_private.assert_phase5_manager(v_task.organization_id, v_task.facility_id);
  if v_task.status <> 'scheduled' or not exists (
    select 1 from public.employees e
    where e.id = p_employee_id
      and e.organization_id = v_task.organization_id
      and e.facility_id = v_task.facility_id
      and e.status = 'active'
  ) then
    raise exception 'Task can only be assigned to active staff at its facility' using errcode = '22023';
  end if;
  update public.resident_service_task_instances
  set assigned_employee_id = p_employee_id, updated_at = now()
  where id = p_task_id;
  return true;
end;
$$;

create or replace function public.get_service_task_available_staff(p_task_id uuid)
returns table (employee_id uuid, employee_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_task public.resident_service_task_instances%rowtype;
  v_employee public.employees%rowtype;
  v_role text := public.current_role();
begin
  select * into v_task from public.resident_service_task_instances where id = p_task_id;
  if not found then raise exception 'Service task not found' using errcode = 'P0002'; end if;
  select * into v_employee from public.employees e
  where e.profile_id = auth.uid() and e.status = 'active';
  if not (
    public.is_platform_admin()
    or (
      public.current_org_id() = v_task.organization_id
      and (
        v_role = 'org_admin'
        or (v_role = 'facility_manager' and public.is_assigned_to_facility(v_task.facility_id))
        or (
          v_role = 'employee'
          and v_employee.facility_id = v_task.facility_id
          and (v_task.assigned_employee_id is null or v_task.assigned_employee_id = v_employee.id)
        )
      )
    )
  ) then
    raise exception 'Service task is outside caller scope' using errcode = '42501';
  end if;
  return query
  select e.id, e.first_name || ' ' || e.last_name
  from public.employees e
  where e.organization_id = v_task.organization_id
    and e.facility_id = v_task.facility_id
    and e.status = 'active'
    and (v_employee.id is null or e.id <> v_employee.id)
  order by e.last_name, e.first_name;
end;
$$;

create or replace function public.upsert_service_exception_rule(
  p_facility_id uuid,
  p_exception_status text,
  p_threshold_count integer,
  p_lookback_days integer,
  p_action_target text,
  p_is_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_facility public.facilities%rowtype;
  v_id uuid;
begin
  select * into v_facility from public.facilities where id = p_facility_id;
  if not found then raise exception 'Facility not found' using errcode = 'P0002'; end if;
  perform app_private.assert_phase5_manager(v_facility.organization_id, v_facility.id);
  if p_exception_status not in (
    'resident_refused', 'resident_unavailable', 'not_completed', 'completed_late'
  ) or p_threshold_count not between 1 and 100
    or p_lookback_days not between 1 and 90
    or p_action_target not in (
      'supervisor', 'change_of_condition', 'support_plan_review', 'qapi'
    ) then
    raise exception 'Invalid service exception rule' using errcode = '22023';
  end if;
  insert into public.service_exception_rules (
    organization_id, facility_id, exception_status, threshold_count,
    lookback_days, action_target, is_active
  ) values (
    v_facility.organization_id, v_facility.id, p_exception_status,
    p_threshold_count, p_lookback_days, p_action_target, p_is_active
  )
  on conflict (facility_id, exception_status, action_target) do update
  set threshold_count = excluded.threshold_count,
      lookback_days = excluded.lookback_days,
      is_active = excluded.is_active,
      updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.get_resident_service_task_queue(
  p_from timestamptz default date_trunc('day', now()),
  p_through timestamptz default date_trunc('day', now()) + interval '1 day',
  p_facility_id uuid default null,
  p_status text default null
)
returns table (
  id uuid,
  organization_id uuid,
  facility_id uuid,
  facility_name text,
  resident_id uuid,
  resident_name text,
  resident_room text,
  requirement_id uuid,
  source_assessment_form_id uuid,
  source_plan_version integer,
  service_name text,
  special_instructions text,
  responsible_role text,
  unit_name text,
  requires_two_staff boolean,
  documentation_mode text,
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  assigned_employee_id uuid,
  assigned_employee_name text,
  status text,
  note text,
  supervisor_notified boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_role text := public.current_role();
begin
  if auth.uid() is null or p_through <= p_from or p_through > p_from + interval '45 days' then
    raise exception 'Invalid service queue request' using errcode = '22023';
  end if;
  select * into v_employee from public.employees e
  where e.profile_id = auth.uid() and e.status = 'active';
  return query
  select
    t.id, t.organization_id, t.facility_id, f.name,
    t.resident_id, r.first_name || ' ' || r.last_name, r.room,
    t.requirement_id, t.source_assessment_form_id, t.source_plan_version,
    t.service_name, req.special_instructions, t.responsible_role, u.name,
    req.requires_two_staff, req.documentation_mode,
    t.scheduled_start, t.scheduled_end, t.assigned_employee_id,
    case when ae.id is null then null else ae.first_name || ' ' || ae.last_name end,
    t.status, t.note, t.supervisor_notified
  from public.resident_service_task_instances t
  join public.resident_service_requirements req on req.id = t.requirement_id
  join public.residents r on r.id = t.resident_id
  join public.facilities f on f.id = t.facility_id
  left join public.facility_units u on u.id = t.unit_id
  left join public.employees ae on ae.id = t.assigned_employee_id
  where t.scheduled_start >= p_from
    and t.scheduled_start < p_through
    and (p_facility_id is null or t.facility_id = p_facility_id)
    and (p_status is null or t.status = p_status)
    and (
      public.is_platform_admin()
      or (
        t.organization_id = public.current_org_id()
        and (
          v_role in ('org_admin', 'auditor')
          or (v_role = 'facility_manager' and public.is_assigned_to_facility(t.facility_id))
          or (
            v_role = 'employee'
            and v_employee.facility_id = t.facility_id
            and (t.assigned_employee_id is null or t.assigned_employee_id = v_employee.id)
          )
        )
      )
    )
  order by t.scheduled_start, r.last_name, r.first_name, t.service_name;
end;
$$;

create or replace function public.resolve_service_task_alert(
  p_alert_id uuid,
  p_status text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alert public.service_task_alerts%rowtype;
begin
  select * into v_alert from public.service_task_alerts where id = p_alert_id for update;
  if not found then raise exception 'Service alert not found' using errcode = 'P0002'; end if;
  perform app_private.assert_phase5_manager(v_alert.organization_id, v_alert.facility_id);
  if p_status not in ('acknowledged', 'resolved') then
    raise exception 'Invalid service alert status' using errcode = '22023';
  end if;
  update public.service_task_alerts
  set status = p_status,
      acknowledged_by = case when p_status = 'acknowledged' then auth.uid() else acknowledged_by end,
      acknowledged_at = case when p_status = 'acknowledged' then now() else acknowledged_at end,
      resolved_by = case when p_status = 'resolved' then auth.uid() else resolved_by end,
      resolved_at = case when p_status = 'resolved' then now() else resolved_at end
  where id = p_alert_id;
  return true;
end;
$$;

revoke all on function public.update_resident_service_requirement(
  uuid, text, text, time, time, text, uuid, text, boolean, text, date
), public.record_resident_service_task(uuid, text, text, boolean, uuid),
public.get_resident_service_task_queue(timestamptz, timestamptz, uuid, text),
public.resolve_service_task_alert(uuid, text),
public.assign_resident_service_task(uuid, uuid),
public.get_service_task_available_staff(uuid),
public.upsert_service_exception_rule(uuid, text, integer, integer, text, boolean)
from public, anon, authenticated, service_role;
grant execute on function public.update_resident_service_requirement(
  uuid, text, text, time, time, text, uuid, text, boolean, text, date
), public.record_resident_service_task(uuid, text, text, boolean, uuid),
public.get_resident_service_task_queue(timestamptz, timestamptz, uuid, text),
public.resolve_service_task_alert(uuid, text),
public.assign_resident_service_task(uuid, uuid),
public.get_service_task_available_staff(uuid),
public.upsert_service_exception_rule(uuid, text, integer, integer, text, boolean)
to authenticated;

insert into public.service_exception_rules (
  organization_id, facility_id, exception_status, threshold_count, lookback_days, action_target
)
select f.organization_id, f.id, rule.exception_status, rule.threshold_count, rule.lookback_days, rule.action_target
from public.facilities f
cross join (values
  ('not_completed', 1, 1, 'supervisor'),
  ('resident_refused', 3, 7, 'support_plan_review'),
  ('resident_unavailable', 3, 7, 'change_of_condition'),
  ('completed_late', 3, 7, 'qapi')
) as rule(exception_status, threshold_count, lookback_days, action_target)
on conflict (facility_id, exception_status, action_target) do nothing;

create or replace function app_private.seed_service_exception_rules_for_facility()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.service_exception_rules (
    organization_id, facility_id, exception_status, threshold_count, lookback_days, action_target
  ) values
    (new.organization_id, new.id, 'not_completed', 1, 1, 'supervisor'),
    (new.organization_id, new.id, 'resident_refused', 3, 7, 'support_plan_review'),
    (new.organization_id, new.id, 'resident_unavailable', 3, 7, 'change_of_condition'),
    (new.organization_id, new.id, 'completed_late', 3, 7, 'qapi')
  on conflict (facility_id, exception_status, action_target) do nothing;
  return new;
end;
$$;
revoke all on function app_private.seed_service_exception_rules_for_facility()
  from public, anon, authenticated, service_role;
create trigger seed_service_exception_rules_for_facility
after insert on public.facilities
for each row execute function app_private.seed_service_exception_rules_for_facility();

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'generate-resident-service-tasks-daily';
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
  perform cron.schedule(
    'generate-resident-service-tasks-daily',
    '10 2 * * *',
    'select public.generate_resident_service_tasks(current_date, current_date + 14, null)'
  );
end
$$;
