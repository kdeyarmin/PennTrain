-- Priority 8: make the existing qualification engine visible to schedulers, enforce it on
-- every assignment path, and replace census-only staffing estimates with service workload.

alter table public.shift_assignments
  add column if not exists eligibility_decision_id uuid
  references public.schedule_eligibility_decisions(id) on delete restrict;

create index if not exists shift_assignments_eligibility_decision_idx
  on public.shift_assignments(eligibility_decision_id)
  where eligibility_decision_id is not null;

create table if not exists public.service_workload_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  unit_id uuid references public.facility_units(id) on delete cascade,
  shift_definition_id uuid not null references public.shift_definitions(id) on delete cascade,
  minimum_staff integer not null default 1 check (minimum_staff between 0 and 100),
  minimum_medication_qualified_staff integer not null default 0 check (minimum_medication_qualified_staff between 0 and 100),
  minimum_insulin_qualified_staff integer not null default 0 check (minimum_insulin_qualified_staff between 0 and 100),
  minimum_first_aid_cpr_staff integer not null default 0 check (minimum_first_aid_cpr_staff between 0 and 100),
  minimum_trainer_supervisor_staff integer not null default 0 check (minimum_trainer_supervisor_staff between 0 and 100),
  secured_unit_coverage_required boolean not null default false,
  escort_reserve_staff integer not null default 0 check (escort_reserve_staff between 0 and 100),
  required_qualification_keys text[] not null default array[]::text[],
  required_credential_types text[] not null default array[]::text[],
  notes text,
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (facility_id, unit_id, shift_definition_id)
);

create index service_workload_profiles_scope_idx
  on public.service_workload_profiles(facility_id, unit_id, shift_definition_id);
create trigger set_updated_at before update on public.service_workload_profiles
for each row execute function public.set_updated_at();

alter table public.service_workload_profiles enable row level security;
create policy service_workload_profiles_select on public.service_workload_profiles
for select to authenticated using (
  (select public.is_platform_admin())
  or (
    organization_id = (select public.current_org_id())
    and (
      (select public.current_role()) in ('org_admin', 'auditor')
      or ((select public.current_role()) = 'facility_manager' and (select public.is_assigned_to_facility(facility_id)))
    )
  )
);
create policy service_workload_profiles_manage on public.service_workload_profiles
for all to authenticated using (
  (select public.identity_assurance_is_current('workforce_admin'))
  and (
    (select public.is_platform_admin())
    or (
      organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin', 'facility_manager')
      and (select public.is_assigned_to_facility(facility_id))
    )
  )
) with check (
  (select public.identity_assurance_is_current('workforce_admin'))
  and (
    (select public.is_platform_admin())
    or (
      organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin', 'facility_manager')
      and (select public.is_assigned_to_facility(facility_id))
    )
  )
);

revoke all on table public.service_workload_profiles from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.service_workload_profiles to authenticated;
grant all on table public.service_workload_profiles to service_role;

-- The legacy eligibility engine remains the shared base for claims, swaps, and training. This
-- shift-specific wrapper adds unit requirements, hard unavailability, rest rules, and strict
-- override scope validation without changing those established call signatures.
create or replace function public.evaluate_shift_assignment_eligibility(
  p_employee_id uuid,
  p_facility_id uuid,
  p_unit_id uuid,
  p_shift_definition_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_exclude_assignment_ids uuid[] default array[]::uuid[]
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_required_qualifications text[] := array[]::text[];
  v_required_credentials text[] := array[]::text[];
  v_required_training_types uuid[] := array[]::uuid[];
  v_result jsonb;
  v_blocks text[] := array[]::text[];
  v_warnings text[] := array[]::text[];
  v_valid_override_ids uuid[] := array[]::uuid[];
  v_override_id uuid;
  v_override public.schedule_eligibility_overrides%rowtype;
  v_policy public.schedule_eligibility_policies%rowtype;
  v_snapshot jsonb;
  v_outcome text;
  v_previous_end timestamptz;
  v_next_start timestamptz;
begin
  select
    coalesce(array_agg(distinct q) filter (where q is not null), array[]::text[]),
    coalesce(array_agg(distinct c) filter (where c is not null), array[]::text[]),
    coalesce(array_agg(distinct t) filter (where t is not null), array[]::uuid[])
  into v_required_qualifications, v_required_credentials, v_required_training_types
  from public.shift_eligibility_requirements r
  left join lateral unnest(r.required_qualification_keys) q on true
  left join lateral unnest(r.required_credential_types) c on true
  left join lateral unnest(r.required_training_type_ids) t on true
  where r.facility_id = p_facility_id
    and r.shift_definition_id = p_shift_definition_id
    and r.is_active;

  select
    array(select distinct x from unnest(v_required_qualifications || coalesce(w.required_qualification_keys, array[]::text[])) x),
    array(select distinct x from unnest(v_required_credentials || coalesce(w.required_credential_types, array[]::text[])) x)
  into v_required_qualifications, v_required_credentials
  from public.service_workload_profiles w
  where w.facility_id = p_facility_id
    and w.shift_definition_id = p_shift_definition_id
    and w.unit_id is not distinct from p_unit_id;

  v_required_qualifications := coalesce(v_required_qualifications, array[]::text[]);
  v_required_credentials := coalesce(v_required_credentials, array[]::text[]);

  v_result := public.evaluate_schedule_eligibility(
    p_employee_id, p_facility_id, p_starts_at, p_ends_at,
    v_required_qualifications, v_required_credentials, v_required_training_types,
    coalesce(p_exclude_assignment_ids, array[]::uuid[])
  );
  v_blocks := array(select jsonb_array_elements_text(v_result->'hardBlocks'));
  v_warnings := array(select jsonb_array_elements_text(v_result->'warnings'));

  -- Availability is a hard scheduling constraint. An explicit manager override may authorize it,
  -- but a warning alone must never let a direct insert schedule unavailable staff.
  if 'outside_availability' = any(v_warnings) then
    v_warnings := array_remove(v_warnings, 'outside_availability');
    v_blocks := array_append(v_blocks, 'employee_unavailable');
  end if;

  select * into v_policy from public.schedule_eligibility_policies
  where organization_id = (select e.organization_id from public.employees e where e.id = p_employee_id);
  if not found then v_policy.minimum_rest_hours := 8; end if;

  select max(
    s.shift_date + s.end_time
      + case when s.end_time <= s.start_time then interval '1 day' else interval '0' end
  ) into v_previous_end
  from public.shift_assignments s
  where s.employee_id = p_employee_id
    and s.id <> all(coalesce(p_exclude_assignment_ids, array[]::uuid[]))
    and s.status in ('scheduled', 'confirmed', 'completed')
    and s.shift_date + s.end_time
      + case when s.end_time <= s.start_time then interval '1 day' else interval '0' end <= p_starts_at;

  select min(s.shift_date + s.start_time) into v_next_start
  from public.shift_assignments s
  where s.employee_id = p_employee_id
    and s.id <> all(coalesce(p_exclude_assignment_ids, array[]::uuid[]))
    and s.status in ('scheduled', 'confirmed')
    and s.shift_date + s.start_time >= p_ends_at;

  if (v_previous_end is not null and p_starts_at - v_previous_end < v_policy.minimum_rest_hours * interval '1 hour')
     or (v_next_start is not null and v_next_start - p_ends_at < v_policy.minimum_rest_hours * interval '1 hour') then
    v_blocks := array_append(v_blocks, 'insufficient_rest');
  end if;

  -- Revalidate every override selected by the legacy engine. Facility overrides apply only to
  -- this facility; shift overrides apply only to this exact shift definition.
  foreach v_override_id in array coalesce(
    array(select jsonb_array_elements_text(v_result->'appliedOverrideIds'))::uuid[],
    array[]::uuid[]
  ) loop
    select * into v_override from public.schedule_eligibility_overrides where id = v_override_id;
    if v_override.block_code not in ('lifecycle_inactive', 'confirmed_exclusion', 'facility_not_assigned', 'schedule_conflict')
       and (
         (v_override.scope_type = 'facility' and (v_override.scope_id is null or v_override.scope_id = p_facility_id))
         or (v_override.scope_type = 'shift' and v_override.scope_id = p_shift_definition_id)
       ) then
      v_valid_override_ids := array_append(v_valid_override_ids, v_override_id);
    else
      v_blocks := array_append(v_blocks, v_override.block_code);
    end if;
  end loop;

  -- Apply valid shift-scoped overrides to blocks introduced by this wrapper (availability/rest)
  -- or left unresolved by the shared engine.
  for v_override in
    select o.* from public.schedule_eligibility_overrides o
    where o.employee_id = p_employee_id and o.facility_id = p_facility_id
      and o.scope_type = 'shift' and o.scope_id = p_shift_definition_id
      and o.revoked_at is null and o.effective_from <= p_starts_at and o.expires_at >= p_ends_at
  loop
    if v_override.block_code = any(v_blocks)
       and v_override.block_code not in ('lifecycle_inactive', 'confirmed_exclusion', 'facility_not_assigned', 'schedule_conflict') then
      v_blocks := array_remove(v_blocks, v_override.block_code);
      if not v_override.id = any(v_valid_override_ids) then
        v_valid_override_ids := array_append(v_valid_override_ids, v_override.id);
      end if;
    end if;
  end loop;

  v_blocks := array(select distinct x from unnest(v_blocks) x order by x);
  v_warnings := array(select distinct x from unnest(v_warnings) x order by x);
  v_outcome := case
    when cardinality(v_blocks) > 0 then 'blocked'
    when cardinality(v_warnings) > 0 or cardinality(v_valid_override_ids) > 0 then 'warning'
    else 'eligible'
  end;
  v_snapshot := coalesce(v_result->'sourceSnapshot', '{}'::jsonb) || jsonb_build_object(
    'unitId', p_unit_id,
    'shiftDefinitionId', p_shift_definition_id,
    'requiredQualificationKeys', to_jsonb(v_required_qualifications),
    'requiredCredentialTypes', to_jsonb(v_required_credentials),
    'requiredTrainingTypeIds', to_jsonb(v_required_training_types),
    'minimumRestHours', v_policy.minimum_rest_hours,
    'previousShiftEndsAt', v_previous_end,
    'nextShiftStartsAt', v_next_start
  );
  return jsonb_build_object(
    'outcome', v_outcome,
    'hardBlocks', to_jsonb(v_blocks),
    'warnings', to_jsonb(v_warnings),
    'appliedOverrideIds', to_jsonb(v_valid_override_ids),
    'sourceSnapshot', v_snapshot,
    'sourceChecksumSha256', encode(extensions.digest(convert_to(v_snapshot::text, 'utf8'), 'sha256'), 'hex')
  );
end;
$$;

create or replace function public.preview_shift_assignment_candidates(
  p_schedule_id uuid,
  p_shift_date date,
  p_shift_definition_id uuid,
  p_unit_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_schedule public.schedules%rowtype;
  v_shift public.shift_definitions%rowtype;
  v_employee record;
  v_starts timestamptz;
  v_ends timestamptz;
  v_result jsonb;
  v_candidates jsonb[] := array[]::jsonb[];
begin
  select * into v_schedule from public.schedules where id = p_schedule_id;
  if not found then raise exception 'Schedule not found' using errcode = 'P0002'; end if;
  if not (
    public.is_platform_admin()
    or (v_schedule.organization_id = public.current_org_id()
      and public.current_role() in ('org_admin', 'facility_manager', 'auditor')
      and public.is_assigned_to_facility(v_schedule.facility_id))
  ) then raise exception 'Not authorized to preview this schedule' using errcode = '42501'; end if;
  if p_shift_date < v_schedule.period_start or p_shift_date > v_schedule.period_end then
    raise exception 'Shift date is outside the schedule period' using errcode = '22023';
  end if;
  select * into v_shift from public.shift_definitions
  where id = p_shift_definition_id and facility_id = v_schedule.facility_id and is_active;
  if not found then raise exception 'Shift definition is not active for this facility' using errcode = '22023'; end if;
  if p_unit_id is not null and not exists (
    select 1 from public.facility_units u where u.id = p_unit_id and u.facility_id = v_schedule.facility_id and u.is_active
  ) then raise exception 'Unit is not active for this facility' using errcode = '22023'; end if;
  v_starts := p_shift_date + v_shift.start_time;
  v_ends := p_shift_date + v_shift.end_time
    + case when v_shift.end_time <= v_shift.start_time then interval '1 day' else interval '0' end;
  for v_employee in
    select e.id, e.first_name, e.last_name, e.job_title
    from public.employee_facility_assignments a
    join public.employees e on e.id = a.employee_id
    where a.facility_id = v_schedule.facility_id
    order by e.last_name, e.first_name
  loop
    v_result := public.evaluate_shift_assignment_eligibility(
      v_employee.id, v_schedule.facility_id, p_unit_id, p_shift_definition_id,
      v_starts, v_ends, array[]::uuid[]
    );
    v_candidates := array_append(v_candidates, v_result || jsonb_build_object(
      'employeeId', v_employee.id,
      'employeeName', btrim(v_employee.first_name || ' ' || v_employee.last_name),
      'jobTitle', v_employee.job_title
    ));
  end loop;
  return to_jsonb(v_candidates);
end;
$$;

create or replace function public.assign_employee_to_shift(
  p_schedule_id uuid,
  p_employee_id uuid,
  p_shift_date date,
  p_shift_definition_id uuid,
  p_unit_id uuid default null,
  p_notes text default null
)
returns public.shift_assignments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_schedule public.schedules%rowtype;
  v_shift public.shift_definitions%rowtype;
  v_assignment public.shift_assignments%rowtype;
begin
  select * into v_schedule from public.schedules where id = p_schedule_id for update;
  if not found then raise exception 'Schedule not found' using errcode = 'P0002'; end if;
  if not (
    public.is_platform_admin()
    or (v_schedule.organization_id = public.current_org_id()
      and public.current_role() in ('org_admin', 'facility_manager')
      and public.is_assigned_to_facility(v_schedule.facility_id))
  ) then raise exception 'Not authorized to edit this schedule' using errcode = '42501'; end if;
  if v_schedule.status <> 'draft' then raise exception 'Only draft schedules can be edited' using errcode = '55000'; end if;
  if p_shift_date < v_schedule.period_start or p_shift_date > v_schedule.period_end then
    raise exception 'Shift date is outside the schedule period' using errcode = '22023';
  end if;
  if not public.is_employee_assigned_to_facility(p_employee_id, v_schedule.facility_id) then
    raise exception 'Employee is not assigned to this facility' using errcode = '23514';
  end if;
  select * into v_shift from public.shift_definitions
  where id = p_shift_definition_id and facility_id = v_schedule.facility_id and is_active;
  if not found then raise exception 'Shift definition is not active for this facility' using errcode = '22023'; end if;
  if p_unit_id is not null and not exists (
    select 1 from public.facility_units u where u.id = p_unit_id and u.facility_id = v_schedule.facility_id and u.is_active
  ) then raise exception 'Unit is not active for this facility' using errcode = '22023'; end if;
  insert into public.shift_assignments(
    organization_id, schedule_id, facility_id, employee_id, unit_id,
    shift_definition_id, shift_date, start_time, end_time, status, source, notes
  ) values (
    v_schedule.organization_id, v_schedule.id, v_schedule.facility_id, p_employee_id, p_unit_id,
    v_shift.id, p_shift_date, v_shift.start_time, v_shift.end_time, 'scheduled', 'manual', nullif(btrim(p_notes), '')
  ) returning * into v_assignment;
  return v_assignment;
end;
$$;

drop trigger if exists enforce_shift_assignment_eligibility on public.shift_assignments;
create or replace function app_private.enforce_shift_assignment_eligibility()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_starts timestamptz;
  v_ends timestamptz;
  v_decision_id uuid;
begin
  if tg_op = 'UPDATE'
    and new.employee_id = old.employee_id and new.facility_id = old.facility_id
    and new.unit_id is not distinct from old.unit_id
    and new.shift_definition_id is not distinct from old.shift_definition_id
    and new.shift_date = old.shift_date and new.start_time = old.start_time and new.end_time = old.end_time then
    return new;
  end if;
  if new.source = 'swap' and exists (
    select 1 from public.shift_swap_requests r
    where r.status = 'pending' and r.decided_by = auth.uid()
      and r.requester_decision_id is not null and r.target_decision_id is not null
      and (r.requester_assignment_id = new.id or r.target_assignment_id = new.id)
  ) then return new; end if;
  v_starts := new.shift_date + new.start_time;
  v_ends := new.shift_date + new.end_time
    + case when new.end_time <= new.start_time then interval '1 day' else interval '0' end;
  v_result := public.evaluate_shift_assignment_eligibility(
    new.employee_id, new.facility_id, new.unit_id, new.shift_definition_id,
    v_starts, v_ends,
    case when tg_op = 'UPDATE' then array[new.id] else array[]::uuid[] end
  );
  if v_result->>'outcome' = 'blocked' then
    raise exception 'Shift assignment blocked by eligibility: %', v_result->'hardBlocks' using errcode = '23514';
  end if;
  v_decision_id := app_private.persist_schedule_eligibility_decision(
    new.employee_id, new.facility_id, 'manager_assignment', 'shift', new.id,
    v_starts, v_ends, v_result
  );
  new.eligibility_decision_id := v_decision_id;
  return new;
end;
$$;
create trigger enforce_shift_assignment_eligibility
before insert or update of employee_id, facility_id, unit_id, shift_definition_id, shift_date, start_time, end_time
on public.shift_assignments
for each row execute function app_private.enforce_shift_assignment_eligibility();

-- Direct browser inserts are intentionally closed. All manual assignments use the RPC above;
-- auto-fill and swap functions still execute as their security-definer owners and hit the trigger.
revoke insert on table public.shift_assignments from authenticated;
drop policy if exists shift_assignments_write on public.shift_assignments;
create policy shift_assignments_update on public.shift_assignments
for update to authenticated using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
    and (select public.current_role()) in ('org_admin', 'facility_manager')
    and public.is_assigned_to_facility(facility_id))
) with check (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
    and (select public.current_role()) in ('org_admin', 'facility_manager')
    and public.is_assigned_to_facility(facility_id)
    and public.is_employee_assigned_to_facility(employee_id, facility_id))
);
create policy shift_assignments_delete on public.shift_assignments
for delete to authenticated using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
    and (select public.current_role()) in ('org_admin', 'facility_manager')
    and public.is_assigned_to_facility(facility_id))
);

create or replace function public.get_schedule_service_workload(p_schedule_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_schedule public.schedules%rowtype;
  v_summary jsonb;
  v_rows jsonb;
begin
  select * into v_schedule from public.schedules where id = p_schedule_id;
  if not found then raise exception 'Schedule not found' using errcode = 'P0002'; end if;
  if not (
    public.is_platform_admin()
    or (v_schedule.organization_id = public.current_org_id()
      and public.current_role() in ('org_admin', 'facility_manager', 'auditor')
      and public.is_assigned_to_facility(v_schedule.facility_id))
  ) then raise exception 'Not authorized to view service workload' using errcode = '42501'; end if;

  select jsonb_build_object(
    'activeResidents', count(*) filter (where r.status = 'active'),
    'securedUnitResidents', count(*) filter (where r.status = 'active' and (r.sdcu or ru.secured))
  ) into v_summary
  from public.residents r
  left join public.facility_beds b on b.id = r.bed_id
  left join public.facility_rooms fr on fr.id = b.room_id
  left join public.residential_units ru on ru.id = fr.residential_unit_id
  where r.facility_id = v_schedule.facility_id;

  select v_summary || jsonb_build_object(
    'supportPlanServices', count(*),
    'twoPersonTransfers', count(*) filter (where req.requires_two_staff),
    'escorts', count(*) filter (where lower(task.service_name || ' ' || req.service_code) like '%escort%'),
    'safetyChecks', count(*) filter (where lower(task.service_name || ' ' || req.service_code) similar to '%(safety|check|round)%'),
    'appointmentTransportationDemand', count(*) filter (
      where lower(task.service_name || ' ' || req.service_code) similar to '%(appointment|transport)%'
    )
  ) into v_summary
  from public.resident_service_task_instances task
  join public.resident_service_requirements req on req.id = task.requirement_id
  where task.facility_id = v_schedule.facility_id
    and task.status <> 'superseded'
    and task.scheduled_start < (v_schedule.period_end + 1)::timestamptz
    and task.scheduled_end > v_schedule.period_start::timestamptz;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.shift_date, x.unit_name, x.shift_name), '[]'::jsonb)
  into v_rows
  from (
    select
      d::date as shift_date,
      w.id as workload_profile_id,
      w.unit_id,
      coalesce(u.name, 'Facility-wide') as unit_name,
      w.shift_definition_id,
      sd.name as shift_name,
      w.minimum_staff,
      w.minimum_medication_qualified_staff,
      w.minimum_insulin_qualified_staff,
      w.minimum_first_aid_cpr_staff,
      w.minimum_trainer_supervisor_staff,
      w.secured_unit_coverage_required,
      w.escort_reserve_staff,
      count(sa.id) filter (where sa.status in ('scheduled', 'confirmed'))::integer as scheduled_staff,
      count(sa.id) filter (where sa.status in ('scheduled', 'confirmed') and e.administers_medications)::integer as medication_qualified_staff,
      count(sa.id) filter (where sa.status in ('scheduled', 'confirmed') and exists (
        select 1 from public.employee_qualifications eq
        join public.certification_definitions cd on cd.id = eq.certification_definition_id
        where eq.employee_id = e.id and eq.state = 'active'
          and eq.effective_from <= d::date + sd.start_time
          and (eq.effective_to is null or eq.effective_to > d::date + sd.start_time)
          and (eq.expires_at is null or eq.expires_at > d::date + sd.start_time)
          and cd.qualification_key similar to '%(insulin|diabetes)%'
      ))::integer as insulin_qualified_staff,
      count(sa.id) filter (where sa.status in ('scheduled', 'confirmed') and exists (
        select 1 from public.employee_qualifications eq
        join public.certification_definitions cd on cd.id = eq.certification_definition_id
        where eq.employee_id = e.id and eq.state = 'active'
          and eq.effective_from <= d::date + sd.start_time
          and (eq.effective_to is null or eq.effective_to > d::date + sd.start_time)
          and (eq.expires_at is null or eq.expires_at > d::date + sd.start_time)
          and cd.qualification_key similar to '%(first.aid|cpr)%'
      ))::integer as first_aid_cpr_staff,
      count(sa.id) filter (where sa.status in ('scheduled', 'confirmed')
        and (e.trainer_status or lower(coalesce(e.job_title, '')) similar to '%(supervisor|manager|administrator)%'))::integer
        as trainer_supervisor_staff
    from public.service_workload_profiles w
    join public.shift_definitions sd on sd.id = w.shift_definition_id
    left join public.facility_units u on u.id = w.unit_id
    cross join lateral generate_series(v_schedule.period_start, v_schedule.period_end, interval '1 day') d
    left join public.shift_assignments sa on sa.schedule_id = v_schedule.id
      and sa.shift_date = d::date and sa.shift_definition_id = w.shift_definition_id
      and sa.unit_id is not distinct from w.unit_id
    left join public.employees e on e.id = sa.employee_id
    where w.facility_id = v_schedule.facility_id
    group by d, w.id, u.name, sd.name
  ) x;
  return v_summary || jsonb_build_object(
    'coverageRows', v_rows,
    'coverageGapCount', (
      select count(*) from jsonb_array_elements(v_rows) row
      where (row->>'scheduled_staff')::integer < (row->>'minimum_staff')::integer
        or (row->>'medication_qualified_staff')::integer < (row->>'minimum_medication_qualified_staff')::integer
        or (row->>'insulin_qualified_staff')::integer < (row->>'minimum_insulin_qualified_staff')::integer
        or (row->>'first_aid_cpr_staff')::integer < (row->>'minimum_first_aid_cpr_staff')::integer
        or (row->>'trainer_supervisor_staff')::integer < (row->>'minimum_trainer_supervisor_staff')::integer
    )
  );
end;
$$;

revoke all on function public.evaluate_shift_assignment_eligibility(uuid,uuid,uuid,uuid,timestamptz,timestamptz,uuid[]),
  public.preview_shift_assignment_candidates(uuid,date,uuid,uuid),
  public.assign_employee_to_shift(uuid,uuid,date,uuid,uuid,text),
  public.get_schedule_service_workload(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.evaluate_shift_assignment_eligibility(uuid,uuid,uuid,uuid,timestamptz,timestamptz,uuid[]),
  public.preview_shift_assignment_candidates(uuid,date,uuid,uuid),
  public.assign_employee_to_shift(uuid,uuid,date,uuid,uuid,text),
  public.get_schedule_service_workload(uuid)
to authenticated;
grant execute on function public.evaluate_shift_assignment_eligibility(uuid,uuid,uuid,uuid,timestamptz,timestamptz,uuid[]),
  public.get_schedule_service_workload(uuid)
to service_role;

insert into app_private.audit_entity_manifest(table_name, audit_mode, contains_regulated_data, rationale)
values ('service_workload_profiles', 'row_trigger', true, 'Unit and shift service-workload and qualification requirements')
on conflict (table_name) do update set
  audit_mode = excluded.audit_mode,
  contains_regulated_data = excluded.contains_regulated_data,
  rationale = excluded.rationale;

create trigger audit_log after insert or update or delete on public.service_workload_profiles
for each row execute function public.audit_log_trigger();

comment on table public.service_workload_profiles is
  'Operational service workload coverage requirements. This is not a medical-acuity score.';
comment on column public.schedule_eligibility_overrides.granted_by is
  'Approver who authorized the bounded override; authority, reason, scope, and expiration are required alongside it.';
comment on function public.assign_employee_to_shift(uuid,uuid,date,uuid,uuid,text) is
  'Only browser-accessible path for a manual shift assignment; the eligibility trigger persists the decision and rejects hard blocks.';
