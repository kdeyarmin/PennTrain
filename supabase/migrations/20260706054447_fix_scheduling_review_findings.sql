-- Fixes for Copilot/Codex review findings on the scheduling feature (PR #39):
--
-- 1. schedules_select had no employee branch, so shift_assignments_select's employee-owned
--    "exists (select 1 from schedules ...)" subquery -- itself subject to schedules' own RLS --
--    could never succeed for an employee, meaning employees saw zero shifts on /me/schedule.
-- 2. is_own_employee_assigned_to_facility didn't check profiles.is_active, unlike every other
--    core RLS helper (current_role/current_org_id/is_platform_admin/is_assigned_to_facility/
--    owns_employee), so a deactivated user with a still-valid JWT kept read access.
-- 3. employees_select had no branch for an employee who is float-assigned (via
--    employee_facility_assignments) to a facility other than their primary one, so a facility_manager
--    scheduling that facility couldn't see the employee record at all (embedded select comes back
--    null, dropping them from every roster picker) -- defeating the point of the join table.
-- 4/5. shift_definitions.id FKs from employee_schedule_preferences/shift_assignments had no ON
--    DELETE action, so deleting a shift type (a button the setup UI offers) fails with an FK
--    violation once any preference/assignment references it.
-- 6. shift_assignments_write's WITH CHECK didn't verify employee_id is actually assigned to
--    facility_id via employee_facility_assignments, so a facility_manager could write a shift for
--    any employee in the org, not just ones assigned to the facility they manage.
-- 7. generate_schedule_assignments didn't filter out inactive shift types/employees or preferences
--    whose facility assignment was since removed, so auto-fill could keep scheduling stale roster
--    entries the UI itself no longer offers.
-- 8. clear_auto_filled_assignments deleted every source='auto_fill' + status='scheduled' row, even
--    ones a manager had since edited (unit/notes/etc.) but left "scheduled" -- not just untouched
--    rows as documented; updated_at = created_at reliably detects "never touched since insert".

alter policy schedules_select on public.schedules using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and ((select public.current_role()) in ('org_admin', 'auditor') or public.is_assigned_to_facility(facility_id)))
  or (status = 'published' and public.is_own_employee_assigned_to_facility(facility_id))
);

create or replace function public.is_own_employee_assigned_to_facility(p_facility_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.employee_facility_assignments efa
    join public.employees e on e.id = efa.employee_id
    join public.profiles p on p.id = e.profile_id
    where e.profile_id = (select auth.uid()) and efa.facility_id = p_facility_id and p.is_active
  );
$$;

alter policy employees_select on public.employees using (
  public.is_platform_admin()
  or (profile_id = (select auth.uid()))
  or (organization_id = (select public.current_org_id())
      and ((select public.current_role()) in ('org_admin', 'auditor')
           or public.is_assigned_to_facility(facility_id)
           or exists (
                select 1 from public.employee_facility_assignments efa
                where efa.employee_id = employees.id and public.is_assigned_to_facility(efa.facility_id)
              )))
);

alter table public.employee_schedule_preferences
  drop constraint employee_schedule_preferences_shift_definition_id_fkey,
  add constraint employee_schedule_preferences_shift_definition_id_fkey
    foreign key (shift_definition_id) references public.shift_definitions(id) on delete cascade;

alter table public.shift_assignments
  drop constraint shift_assignments_shift_definition_id_fkey,
  add constraint shift_assignments_shift_definition_id_fkey
    foreign key (shift_definition_id) references public.shift_definitions(id) on delete set null;

alter policy shift_assignments_write on public.shift_assignments using (
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

create or replace function public.generate_schedule_assignments(p_schedule_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_schedule public.schedules%rowtype;
  v_inserted integer := 0;
  v_skipped integer := 0;
  v_day date;
  v_pref record;
begin
  select * into v_schedule from public.schedules where id = p_schedule_id;
  if v_schedule is null then
    raise exception 'schedule not found';
  end if;

  if not (
    public.is_platform_admin()
    or (v_schedule.organization_id = public.current_org_id()
        and public.current_role() in ('org_admin', 'facility_manager')
        and public.is_assigned_to_facility(v_schedule.facility_id))
  ) then
    raise exception 'not authorized to edit this schedule';
  end if;

  if v_schedule.status <> 'draft' then
    raise exception 'only draft schedules can be auto-filled';
  end if;

  for v_day in select generate_series(v_schedule.period_start, v_schedule.period_end, interval '1 day')::date loop
    for v_pref in
      select distinct on (esp.employee_id)
        esp.employee_id, esp.unit_id, esp.shift_definition_id, sd.start_time, sd.end_time
      from public.employee_schedule_preferences esp
      join public.shift_definitions sd on sd.id = esp.shift_definition_id and sd.is_active
      join public.employees e on e.id = esp.employee_id and e.status = 'active'
      join public.employee_facility_assignments efa
        on efa.employee_id = esp.employee_id and efa.facility_id = esp.facility_id
      where esp.facility_id = v_schedule.facility_id
        and esp.is_active
        and extract(dow from v_day)::smallint = any (esp.days_of_week)
      order by esp.employee_id, esp.priority desc, esp.created_at
    loop
      begin
        insert into public.shift_assignments (
          organization_id, schedule_id, facility_id, employee_id, unit_id, shift_definition_id,
          shift_date, start_time, end_time, status, source
        ) values (
          v_schedule.organization_id, v_schedule.id, v_schedule.facility_id, v_pref.employee_id, v_pref.unit_id,
          v_pref.shift_definition_id, v_day, v_pref.start_time, v_pref.end_time, 'scheduled', 'auto_fill'
        );
        v_inserted := v_inserted + 1;
      exception when unique_violation then
        v_skipped := v_skipped + 1;
      end;
    end loop;
  end loop;

  return jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped);
end;
$$;

create or replace function public.clear_auto_filled_assignments(p_schedule_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_schedule public.schedules%rowtype;
  v_deleted integer;
begin
  select * into v_schedule from public.schedules where id = p_schedule_id;
  if v_schedule is null then
    raise exception 'schedule not found';
  end if;

  if not (
    public.is_platform_admin()
    or (v_schedule.organization_id = public.current_org_id()
        and public.current_role() in ('org_admin', 'facility_manager')
        and public.is_assigned_to_facility(v_schedule.facility_id))
  ) then
    raise exception 'not authorized to edit this schedule';
  end if;

  if v_schedule.status <> 'draft' then
    raise exception 'only draft schedules can be cleared';
  end if;

  delete from public.shift_assignments
    where schedule_id = p_schedule_id and source = 'auto_fill' and status = 'scheduled'
      and updated_at = created_at;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
