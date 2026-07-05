-- Facility inspections & equipment: fire drills, generator/extinguisher/sprinkler checks,
-- emergency-preparedness plan reviews. Physical-plant compliance is graded on the same clock as
-- staff training (a missed drill or a stale generator test is just as citable in a survey), so
-- this reuses the exact renewal-interval-and-alert shape training_types/employee_training_records
-- already has, just pointed at a facility-scoped subject instead of an employee.
--
-- `inspection_items` is a single registry covering both physical equipment (generator, fire
-- extinguisher, alarm/sprinkler) AND recurring procedural requirements (fire-drill program,
-- emergency-prep-plan review) as rows distinguished by item_kind -- every inspection_events row
-- references exactly one inspection_items row, so the alert/dedup grouping key is always "one
-- alert per open inspection_item_id," never per-employee, without a second registry table or
-- special-cased alert logic.

create table public.inspection_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id),
  item_kind text not null check (item_kind in ('equipment','procedural')),
  item_type text not null check (item_type in (
    'generator','fire_extinguisher','fire_alarm_system','sprinkler_system','smoke_detector',
    'emergency_lighting','elevator','other_equipment',
    'fire_drill_program','emergency_prep_plan_review','other_procedural')),
  label text not null,
  location_detail text,
  manufacturer text,
  model_number text,
  serial_number text,
  install_date date,
  inspection_interval_days integer not null,
  last_inspected_date date,
  next_due_date date,
  status text not null default 'missing' check (status in ('compliant','due_soon','expired','missing')),
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index inspection_items_org_idx on public.inspection_items(organization_id);
create index inspection_items_facility_idx on public.inspection_items(facility_id);

create trigger set_updated_at before update on public.inspection_items
  for each row execute function public.set_updated_at();

create trigger audit_log after insert or update or delete on public.inspection_items
  for each row execute function public.audit_log_trigger();

create table public.inspection_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id),
  inspection_item_id uuid not null references public.inspection_items(id) on delete cascade,
  performed_date date not null,
  performed_by text not null,
  performed_by_profile_id uuid references public.profiles(id),
  result text not null check (result in ('pass','fail','deficiency_noted')),
  deficiency_notes text,
  follow_up_required boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index inspection_events_org_idx on public.inspection_events(organization_id);
create index inspection_events_item_idx on public.inspection_events(inspection_item_id);

create trigger set_updated_at before update on public.inspection_events
  for each row execute function public.set_updated_at();

create trigger audit_log after insert or update or delete on public.inspection_events
  for each row execute function public.audit_log_trigger();

create or replace function public.stamp_scope_from_inspection_item()
returns trigger language plpgsql set search_path to 'public' as $function$
declare v_org uuid; v_fac uuid;
begin
  select organization_id, facility_id into v_org, v_fac from public.inspection_items where id = new.inspection_item_id;
  if v_org is null then
    raise exception 'inspection item % not found', new.inspection_item_id using errcode = 'foreign_key_violation';
  end if;
  new.organization_id := v_org;
  new.facility_id := v_fac;
  return new;
end;
$function$;

create trigger stamp_scope before insert or update on public.inspection_events
  for each row execute function public.stamp_scope_from_inspection_item();
