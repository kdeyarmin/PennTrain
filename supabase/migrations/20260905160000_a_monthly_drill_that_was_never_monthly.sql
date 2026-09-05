-- Fire drills: a monthly cadence that was never monthly, and a six-month one nobody computed (I18).
--
-- 55 Pa. Code 2600.132 / 2800.132 require an unannounced fire drill in every month, and a drill
-- held during sleeping hours at least every six months. The product modelled the first as a
-- fire_drill_program inspection_item with inspection_interval_days = 30 and the second not at all.
--
-- A 30-day interval is not a month. Drill on January 31 and the recalc set the next due date to
-- March 2 -- so a facility could hold no drill at all in February, watch the item read "compliant"
-- the whole time, and be cited for the month it skipped. The drift compounds: twelve drills at
-- 30-day spacing span 360 days, which fits thirteen deadlines into twelve months in some years and
-- eleven in others. The rule is a calendar rule and has to be computed as one.
--
-- The sleeping-hours drill was worse: inspection_events.is_sleeping_hours_drill has existed since
-- 20260705054756, the detail page asks for it by name ("required every 6 months") and the tracker
-- PDF prints it -- and nothing anywhere derived a due date from it. A facility could go three years
-- without one and every screen in the product would say the fire drill program was current.
--
-- Both are fixed here as schedules, not as one-off reports, so the existing ladder (compliant ->
-- due_soon -> expired), the inspection_due alerts, the Survey Day checklist and the paged
-- compliance report all pick them up without knowing anything new.

------------------------------------------------------------------------------------------------
-- 1. The due-date rule, in one place
------------------------------------------------------------------------------------------------
-- Two callers roll an item forward (the AFTER INSERT trigger on inspection_events and the nightly
-- sweep), and before this they each carried the arithmetic inline. One function so a third caller
-- cannot invent a third rule.
create or replace function public.inspection_item_next_due_date(
  p_item_type text,
  p_interval_days integer,
  p_last_date date,
  p_anchor date
)
returns date
language sql
immutable
set search_path = ''
as $function$
  select case
    -- A drill is owed in every calendar month, so the deadline is the last day of the month AFTER
    -- the month the last drill fell in -- not that drill's date plus thirty days. With no drill on
    -- file the deadline is the end of the anchor's own month: the program exists, so this month's
    -- drill is already owed.
    when p_item_type = 'fire_drill_program' then
      case
        when p_last_date is not null
          then (date_trunc('month', p_last_date::timestamp) + interval '2 months' - interval '1 day')::date
        else (date_trunc('month', p_anchor::timestamp) + interval '1 month' - interval '1 day')::date
      end
    -- "At least every 6 months" is an elapsed-time rule rather than a calendar one, so this one is
    -- measured from the drill itself. A new program gets six months to hold its first.
    when p_item_type = 'sleeping_hours_fire_drill' then
      (coalesce(p_last_date, p_anchor) + interval '6 months')::date
    else coalesce(p_last_date, p_anchor) + p_interval_days
  end;
$function$;

comment on function public.inspection_item_next_due_date(text, integer, date, date) is
  'Next deadline for an inspection item: a calendar-month rule for fire drills (55 Pa. Code '
  '2600.132/2800.132 require a drill in every month, which a 30-day interval does not deliver), '
  'six calendar months for the sleeping-hours drill, and the item''s own interval for everything '
  'else. BACKLOG.md I18.';

-- Called only from inside recalculate_inspection_item_compliance, which is a definer: no client
-- reaches it directly, so it is not granted to authenticated.
revoke all on function public.inspection_item_next_due_date(text, integer, date, date)
  from public, anon, authenticated;
grant execute on function public.inspection_item_next_due_date(text, integer, date, date)
  to service_role;

------------------------------------------------------------------------------------------------
-- 2. The sleeping-hours drill as a derived item
------------------------------------------------------------------------------------------------
-- It is a second schedule over the same events, not a second thing to inspect: an aide logs one
-- drill on the program and ticks "sleeping hours". Modelling it as a derived inspection_item is
-- what makes it visible everywhere a schedule already is -- the Inspections list, the status
-- ladder, the alert, the Survey Day row, the compliance report -- with no consumer changed.
alter table public.inspection_items
  add column if not exists derived_from_inspection_item_id uuid
    references public.inspection_items(id) on delete cascade;

create index if not exists inspection_items_derived_from_idx
  on public.inspection_items(derived_from_inspection_item_id)
  where derived_from_inspection_item_id is not null;

alter table public.inspection_items drop constraint if exists inspection_items_item_type_check;
alter table public.inspection_items add constraint inspection_items_item_type_check
  check (item_type in (
    'generator','fire_extinguisher','fire_alarm_system','sprinkler_system','smoke_detector',
    'emergency_lighting','elevator','other_equipment',
    'fire_drill_program','emergency_prep_plan_review','other_procedural',
    'evacuation_time_letter','emergency_supply_check','sleeping_hours_fire_drill'));

-- The derived type only exists as a child, and no other type is ever a child. Stated as a
-- constraint so a hand-written insert cannot produce an orphan schedule that nothing rolls forward.
alter table public.inspection_items drop constraint if exists inspection_items_derived_shape_check;
alter table public.inspection_items add constraint inspection_items_derived_shape_check
  check ((item_type = 'sleeping_hours_fire_drill') = (derived_from_inspection_item_id is not null));

create or replace function app_private.sync_sleeping_hours_drill_item(p_program_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_program public.inspection_items%rowtype;
  v_child_id uuid;
begin
  select * into v_program from public.inspection_items where id = p_program_id;
  if not found or v_program.item_type <> 'fire_drill_program' then
    return null;
  end if;

  select id into v_child_id from public.inspection_items
  where derived_from_inspection_item_id = p_program_id
  limit 1;

  if v_child_id is null then
    -- Only worth opening for a live program. Deactivating the parent below is what retires it.
    if not v_program.is_active then
      return null;
    end if;
    insert into public.inspection_items (
      organization_id, facility_id, item_kind, item_type, label, location_detail,
      install_date, inspection_interval_days, is_active, notes,
      derived_from_inspection_item_id
    ) values (
      v_program.organization_id, v_program.facility_id, 'procedural', 'sleeping_hours_fire_drill',
      left(v_program.label, 150) || ' — sleeping-hours drill',
      v_program.location_detail, v_program.install_date,
      -- Cosmetic only: inspection_item_next_due_date computes this schedule in calendar months.
      -- 183 is recorded so a reader of the row is not told the interval is unknown.
      183, v_program.is_active,
      'Derived from the fire drill program. Log the drill on the program itself and tick '
        || '"sleeping hours" -- 55 Pa. Code 2600.132/2800.132 require one at least every six months.',
      p_program_id
    )
    returning id into v_child_id;
  else
    update public.inspection_items set
      facility_id = v_program.facility_id,
      label = left(v_program.label, 150) || ' — sleeping-hours drill',
      is_active = v_program.is_active,
      updated_at = now()
    where id = v_child_id
      and (facility_id is distinct from v_program.facility_id
        or label is distinct from left(v_program.label, 150) || ' — sleeping-hours drill'
        or is_active is distinct from v_program.is_active);
  end if;

  return v_child_id;
end;
$function$;

revoke all on function app_private.sync_sleeping_hours_drill_item(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.derive_sleeping_hours_drill_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.item_type = 'fire_drill_program' then
    perform app_private.sync_sleeping_hours_drill_item(new.id);
    perform public.recalculate_inspection_item_compliance(new.id);
  end if;
  return null;
end;
$function$;

-- A trigger function fires through the trigger mechanism, which performs no privilege check, so it
-- needs no EXECUTE grant. Leaving the default one in place would add it to the anon-reachable
-- SECURITY DEFINER surface -- the exact class 20260801065214 stripped nine functions out of, and
-- which tenant_isolation_invariants.test.sql holds at a fixed count.
revoke all on function public.derive_sleeping_hours_drill_item() from public, anon, authenticated;

drop trigger if exists derive_sleeping_hours_drill on public.inspection_items;
create trigger derive_sleeping_hours_drill
after insert or update of label, facility_id, is_active, item_type on public.inspection_items
for each row execute function public.derive_sleeping_hours_drill_item();

-- An event belongs to the program, never to the derived schedule. Without this an operator who
-- opened the derived item and logged a drill would move the six-month clock and leave the monthly
-- one untouched -- a record of a drill that the monthly cadence never saw.
create or replace function public.reject_event_on_derived_inspection_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare v_parent uuid;
begin
  select derived_from_inspection_item_id into v_parent
  from public.inspection_items where id = new.inspection_item_id;
  if v_parent is not null then
    raise exception 'Log this drill on the fire drill program itself and tick "sleeping hours"; the six-month schedule is derived from it'
      using errcode = '55000';
  end if;
  return new;
end;
$function$;

revoke all on function public.reject_event_on_derived_inspection_item() from public, anon, authenticated;

drop trigger if exists reject_event_on_derived_item on public.inspection_events;
create trigger reject_event_on_derived_item
before insert on public.inspection_events
for each row execute function public.reject_event_on_derived_inspection_item();

------------------------------------------------------------------------------------------------
-- 3. The recalc: one rule, and the derived schedule rolled forward with its parent
------------------------------------------------------------------------------------------------
-- Spliced from the deployed body. Three things change: the due date comes from
-- inspection_item_next_due_date, a derived item reads its parent's events (filtered to the
-- sleeping-hours ones), and every single-item predicate now also catches that item's children --
-- otherwise logging a drill would roll the program forward and leave the six-month schedule stale
-- until the nightly sweep.
create or replace function public.recalculate_inspection_item_compliance(p_inspection_item_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_pa_today date := public.pa_today();
begin
  -- Fleet-wide pass only: re-derive any sleeping-hours schedule that has gone missing. The trigger
  -- on inspection_items opens one with each program, but a row can still be deleted by hand, and a
  -- six-month cadence that quietly stops existing is the defect this migration is about.
  if p_inspection_item_id is null then
    perform app_private.sync_sleeping_hours_drill_item(i.id)
    from public.inspection_items i
    where i.item_type = 'fire_drill_program' and i.is_active;
  end if;

  update public.inspection_items i
  set
    last_inspected_date = h.last_date,
    next_due_date = public.inspection_item_next_due_date(
      i.item_type, i.inspection_interval_days, h.last_date,
      coalesce(i.install_date, public.pa_day(i.created_at)))
  from (
    select ii.id as inspection_item_id,
           max(e.performed_date) filter (
             where e.result = 'pass'
               and (ii.item_type <> 'sleeping_hours_fire_drill' or e.is_sleeping_hours_drill)
           ) as last_date
    from public.inspection_items ii
    -- A derived schedule has no events of its own; it reads the program's.
    left join public.inspection_events e
      on e.inspection_item_id = coalesce(ii.derived_from_inspection_item_id, ii.id)
    where p_inspection_item_id is null
       or ii.id = p_inspection_item_id
       or ii.derived_from_inspection_item_id = p_inspection_item_id
    group by ii.id
  ) h
  where h.inspection_item_id = i.id and i.is_active;

  update public.inspection_items i
  set status = case
    when i.next_due_date is null then 'missing'
    when i.next_due_date < v_pa_today then 'expired'
    when i.next_due_date <= v_pa_today + 30 then 'due_soon'
    else 'compliant'
  end
  where i.is_active
    and (p_inspection_item_id is null
      or i.id = p_inspection_item_id
      or i.derived_from_inspection_item_id = p_inspection_item_id);

  update public.alerts a
  set severity = 'critical',
      message = i.label || ' is overdue for inspection (was due ' || to_char(i.next_due_date, 'Mon DD, YYYY') || ')'
  from public.inspection_items i
  where a.inspection_item_id = i.id
    and a.status = 'open'
    and a.alert_type = 'inspection_due'
    and a.severity = 'warning'
    and i.status = 'expired'
    and (p_inspection_item_id is null
      or i.id = p_inspection_item_id
      or i.derived_from_inspection_item_id = p_inspection_item_id);

  insert into public.alerts (organization_id, facility_id, inspection_item_id, alert_type, title, message, severity)
  select
    i.organization_id, i.facility_id, i.id,
    'inspection_due',
    i.label || ' — ' || replace(i.item_type, '_', ' '),
    case when i.status = 'expired'
      then i.label || ' is overdue for inspection (was due ' || to_char(i.next_due_date, 'Mon DD, YYYY') || ')'
      else i.label || ' inspection is due ' || to_char(i.next_due_date, 'Mon DD, YYYY')
    end,
    case when i.status = 'expired' then 'critical' else 'warning' end
  from public.inspection_items i
  where i.is_active and i.status in ('due_soon','expired')
    and (p_inspection_item_id is null
      or i.id = p_inspection_item_id
      or i.derived_from_inspection_item_id = p_inspection_item_id)
    and not exists (
      select 1 from public.alerts a
      where a.inspection_item_id = i.id and a.status = 'open'
    );

  update public.alerts a
  set status = 'resolved', resolved_at = now()
  from public.inspection_items i
  where a.inspection_item_id = i.id
    and a.status = 'open'
    and a.alert_type = 'inspection_due'
    and (p_inspection_item_id is null
      or i.id = p_inspection_item_id
      or i.derived_from_inspection_item_id = p_inspection_item_id)
    and (not i.is_active or i.status not in ('due_soon','expired'));
end;
$function$;

revoke all on function public.recalculate_inspection_item_compliance(uuid)
  from public, anon, authenticated;
grant execute on function public.recalculate_inspection_item_compliance(uuid) to service_role;

------------------------------------------------------------------------------------------------
-- 4. Backfill: every existing fire drill program gets its sleeping-hours schedule
------------------------------------------------------------------------------------------------
do $$
declare v_id uuid;
begin
  for v_id in select id from public.inspection_items where item_type = 'fire_drill_program' loop
    perform app_private.sync_sleeping_hours_drill_item(v_id);
  end loop;
  perform public.recalculate_inspection_item_compliance();
end;
$$;

------------------------------------------------------------------------------------------------
-- 5. Survey Day: the entrance-conference rows say which schedule they are asking about
------------------------------------------------------------------------------------------------
-- 20260706181330 added item_types so each 'inspections' prompt could name the item types it is
-- actually about, and the frontend half never landed -- so all four rows still show the same
-- whole-table verdict. The fire-drill row now covers both cadences, and the 3-day supply row is
-- scoped at last: 20260706181330 left it unscoped because "inspection_items.item_type has no
-- distinct value for an emergency-supply check today", which stopped being true one day earlier
-- when 20260705054756 added 'emergency_supply_check'.
update public.entrance_conference_items
set item_types = array['fire_drill_program', 'sleeping_hours_fire_drill']
where data_source = 'inspections'
  and item_types = array['fire_drill_program'];

update public.entrance_conference_items
set item_types = array['emergency_supply_check']
where data_source = 'inspections'
  and item_types is null
  and prompt = '3-day emergency supply check current';
