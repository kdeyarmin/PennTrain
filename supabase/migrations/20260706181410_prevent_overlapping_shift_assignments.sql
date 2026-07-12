-- Forward-fix (review finding): shift_assignments' only double-booking guard is
-- `unique (employee_id, shift_date)`, keyed on the shift's start calendar date -- so an
-- overnight/cross-midnight shift (start_time > end_time, e.g. 23:00-07:00) lets an employee be
-- booked into two genuinely overlapping shifts at two different facilities, as long as the second
-- shift's shift_date differs from the first.
--
-- Example: Facility A assigns Employee X a "Night" shift 23:00-07:00 on shift_date=D (running
-- 23:00 D -> 07:00 D+1). Facility B (X is float-assigned there) separately assigns X an "Early"
-- shift 06:00-14:00 on shift_date=D+1. Both inserts succeed under the existing unique constraint
-- (different (employee_id, shift_date) pairs), even though X is contractually double-booked from
-- 06:00-07:00 on D+1 at two facilities simultaneously -- an impossible schedule payroll/compliance
-- would never catch.
--
-- Fix with a trigger rather than a GiST exclusion constraint (simpler, no new extension, and
-- consistent with this schema's existing validate_employee_schedule_preference()-style
-- before-insert-or-update checks): compute each shift's real start/end instant (accounting for
-- overnight wraparound) and reject an insert/update whose interval overlaps any other shift already
-- on the books for the same employee, regardless of shift_date or facility. The existing
-- unique(employee_id, shift_date) constraint is left in place -- it's still the documented v1
-- "one shift per calendar date" limitation for same-day cases; this trigger is the additional net
-- that catches the cross-midnight case that constraint alone cannot.
create or replace function public.prevent_shift_assignment_overlap()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_new_start timestamp;
  v_new_end timestamp;
  v_conflict record;
begin
  if new.status = 'called_off' then
    return new;
  end if;

  v_new_start := new.shift_date::timestamp + new.start_time;
  v_new_end := case
    when new.end_time > new.start_time then new.shift_date::timestamp + new.end_time
    else (new.shift_date + 1)::timestamp + new.end_time
  end;

  select sa.id, sa.shift_date into v_conflict
  from public.shift_assignments sa
  where sa.employee_id = new.employee_id
    and sa.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
    and sa.status <> 'called_off'
    and sa.shift_date between new.shift_date - 1 and new.shift_date + 1
    and (
      sa.shift_date::timestamp + sa.start_time,
      case when sa.end_time > sa.start_time then sa.shift_date::timestamp + sa.end_time
           else (sa.shift_date + 1)::timestamp + sa.end_time end
    ) overlaps (v_new_start, v_new_end)
  limit 1;

  if v_conflict.id is not null then
    raise exception 'employee % already has an overlapping shift on %', new.employee_id, v_conflict.shift_date
      using errcode = 'exclusion_violation';
  end if;

  return new;
end;
$function$;

create trigger prevent_shift_assignment_overlap
  before insert or update on public.shift_assignments
  for each row execute function public.prevent_shift_assignment_overlap();

revoke all on function public.prevent_shift_assignment_overlap() from public, anon, authenticated;

-- generate_schedule_assignments()'s per-day auto-fill loop only ever caught `unique_violation` from
-- the pre-existing unique(employee_id, shift_date) constraint, treating it as "already has a shift
-- that day, skip". The new overlap trigger above raises a distinct `exclusion_violation` for the
-- cross-midnight case (e.g. an employee's typical pattern for day D+1 would collide with a manual
-- overnight entry starting on day D) -- without also catching it here, that one conflict would abort
-- the entire auto-fill run instead of being counted as a normal, expected skip like every other
-- already-scheduled day.
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
      exception when unique_violation or exclusion_violation then
        v_skipped := v_skipped + 1;
      end;
    end loop;
  end loop;

  return jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped);
end;
$$;
