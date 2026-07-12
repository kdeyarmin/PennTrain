-- Auto-fill: populate a draft schedule from each employee's typical shift/unit pattern
-- (employee_schedule_preferences), skipping any date an employee is already assigned (manual
-- entries always win). This is the "reduce manually arranging the schedule" feature -- a manager
-- creates an empty schedule, clicks Auto-Fill, and only has to touch the exceptions.
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
      join public.shift_definitions sd on sd.id = esp.shift_definition_id
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
revoke all on function public.generate_schedule_assignments(uuid) from public;
grant execute on function public.generate_schedule_assignments(uuid) to authenticated;

-- Safety valve to go with auto-fill: wipe only the untouched auto-generated rows (never a manually
-- created/edited/confirmed shift) so a manager can tweak preferences and re-run cleanly.
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
    where schedule_id = p_schedule_id and source = 'auto_fill' and status = 'scheduled';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
revoke all on function public.clear_auto_filled_assignments(uuid) from public;
grant execute on function public.clear_auto_filled_assignments(uuid) to authenticated;

-- Publish: flips a schedule visible to employees (shift_assignments_select requires the parent
-- schedule to be 'published' for an employee's own-record branch).
create or replace function public.publish_schedule(p_schedule_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_schedule public.schedules%rowtype;
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
    raise exception 'not authorized to publish this schedule';
  end if;

  update public.schedules set status = 'published', published_at = now() where id = p_schedule_id;
end;
$$;
revoke all on function public.publish_schedule(uuid) from public;
grant execute on function public.publish_schedule(uuid) to authenticated;

-- Unpublish: pull a schedule back to draft (e.g. to fix a mistake before employees act on it).
create or replace function public.unpublish_schedule(p_schedule_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_schedule public.schedules%rowtype;
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
    raise exception 'not authorized to unpublish this schedule';
  end if;

  update public.schedules set status = 'draft', published_at = null where id = p_schedule_id;
end;
$$;
revoke all on function public.unpublish_schedule(uuid) from public;
grant execute on function public.unpublish_schedule(uuid) to authenticated;
