-- Shift scheduling core: facility units/wings and shift-time templates ("typical shifts"), each
-- employee's typical shift/unit pattern (used to auto-fill new schedules and cut down manual
-- arranging), a per-facility schedule period, and the actual day-by-day shift assignments.

create table public.facility_units (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (facility_id, name)
);
create index facility_units_facility_id_idx on public.facility_units(facility_id);
create trigger set_updated_at before update on public.facility_units
  for each row execute function public.set_updated_at();

create table public.shift_definitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  name text not null,
  start_time time not null,
  end_time time not null,
  color text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (facility_id, name)
);
create index shift_definitions_facility_id_idx on public.shift_definitions(facility_id);
create trigger set_updated_at before update on public.shift_definitions
  for each row execute function public.set_updated_at();

-- Each row is one recurring pattern for an employee (e.g. "Mon/Wed/Fri, Day shift, Wing A"); an
-- employee can have several rows to cover a mixed weekly pattern. Used by generate_schedule_assignments
-- to auto-fill a new schedule instead of managers dragging every cell by hand.
create table public.employee_schedule_preferences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  unit_id uuid references public.facility_units(id) on delete set null,
  shift_definition_id uuid not null references public.shift_definitions(id),
  days_of_week smallint[] not null,
  priority integer not null default 0,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employee_schedule_preferences_days_valid check (
    days_of_week <@ array[0,1,2,3,4,5,6]::smallint[] and array_length(days_of_week, 1) > 0
  )
);
create index employee_schedule_preferences_employee_id_idx on public.employee_schedule_preferences(employee_id);
create index employee_schedule_preferences_facility_id_idx on public.employee_schedule_preferences(facility_id);
create trigger set_updated_at before update on public.employee_schedule_preferences
  for each row execute function public.set_updated_at();

create or replace function public.validate_employee_schedule_preference()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.employee_facility_assignments efa
    where efa.employee_id = new.employee_id and efa.facility_id = new.facility_id
  ) then
    raise exception 'employee is not assigned to this facility';
  end if;
  if new.unit_id is not null and not exists (
    select 1 from public.facility_units u where u.id = new.unit_id and u.facility_id = new.facility_id
  ) then
    raise exception 'unit does not belong to this facility';
  end if;
  if not exists (
    select 1 from public.shift_definitions sd where sd.id = new.shift_definition_id and sd.facility_id = new.facility_id
  ) then
    raise exception 'shift definition does not belong to this facility';
  end if;
  return new;
end;
$$;
create trigger validate_employee_schedule_preference
  before insert or update on public.employee_schedule_preferences
  for each row execute function public.validate_employee_schedule_preference();
revoke all on function public.validate_employee_schedule_preference() from public;

-- A schedule is one published/draft period (typically a week) for one facility.
create table public.schedules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  title text,
  period_start date not null,
  period_end date not null,
  status text not null default 'draft' check (status in ('draft', 'published')),
  created_by uuid references public.profiles(id),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint schedules_period_valid check (period_end >= period_start)
);
create index schedules_facility_id_idx on public.schedules(facility_id);
create index schedules_organization_id_idx on public.schedules(organization_id);
create trigger set_updated_at before update on public.schedules
  for each row execute function public.set_updated_at();

-- One employee's shift on one date within one schedule. The unique constraint deliberately caps an
-- employee at one shift per calendar date across every facility/schedule (no double shifts / no
-- same-day float between two facilities in v1) -- the simplest rule that fully prevents accidental
-- double-booking; start_time/end_time are copied from shift_definitions at assignment time so later
-- edits to a shift template don't retroactively rewrite already-scheduled history.
create table public.shift_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  schedule_id uuid not null references public.schedules(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  unit_id uuid references public.facility_units(id) on delete set null,
  shift_definition_id uuid references public.shift_definitions(id),
  shift_date date not null,
  start_time time not null,
  end_time time not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'confirmed', 'completed', 'called_off', 'no_show')),
  source text not null default 'manual' check (source in ('manual', 'auto_fill')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, shift_date)
);
create index shift_assignments_schedule_id_idx on public.shift_assignments(schedule_id);
create index shift_assignments_facility_id_idx on public.shift_assignments(facility_id);
create index shift_assignments_employee_id_idx on public.shift_assignments(employee_id);
create index shift_assignments_shift_date_idx on public.shift_assignments(shift_date);
create trigger set_updated_at before update on public.shift_assignments
  for each row execute function public.set_updated_at();

-- Self-service visibility helper: can the logged-in employee (not a manager) see this facility's data.
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
    where e.profile_id = (select auth.uid()) and efa.facility_id = p_facility_id
  );
$$;
grant execute on function public.is_own_employee_assigned_to_facility(uuid) to authenticated;

alter table public.facility_units enable row level security;
create policy facility_units_select on public.facility_units for select to authenticated using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and ((select public.current_role()) in ('org_admin', 'auditor') or public.is_assigned_to_facility(facility_id)))
  or public.is_own_employee_assigned_to_facility(facility_id)
);
create policy facility_units_write on public.facility_units for all to authenticated using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin', 'facility_manager')
      and public.is_assigned_to_facility(facility_id))
) with check (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin', 'facility_manager')
      and public.is_assigned_to_facility(facility_id))
);

alter table public.shift_definitions enable row level security;
create policy shift_definitions_select on public.shift_definitions for select to authenticated using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and ((select public.current_role()) in ('org_admin', 'auditor') or public.is_assigned_to_facility(facility_id)))
  or public.is_own_employee_assigned_to_facility(facility_id)
);
create policy shift_definitions_write on public.shift_definitions for all to authenticated using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin', 'facility_manager')
      and public.is_assigned_to_facility(facility_id))
) with check (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin', 'facility_manager')
      and public.is_assigned_to_facility(facility_id))
);

alter table public.employee_schedule_preferences enable row level security;
create policy employee_schedule_preferences_select on public.employee_schedule_preferences for select to authenticated using (
  public.is_platform_admin()
  or exists (select 1 from public.employees e where e.id = employee_schedule_preferences.employee_id and e.profile_id = (select auth.uid()))
  or (organization_id = (select public.current_org_id())
      and ((select public.current_role()) in ('org_admin', 'auditor') or public.is_assigned_to_facility(facility_id)))
);
create policy employee_schedule_preferences_write on public.employee_schedule_preferences for all to authenticated using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin', 'facility_manager')
      and public.is_assigned_to_facility(facility_id))
) with check (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin', 'facility_manager')
      and public.is_assigned_to_facility(facility_id))
);

alter table public.schedules enable row level security;
create policy schedules_select on public.schedules for select to authenticated using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and ((select public.current_role()) in ('org_admin', 'auditor') or public.is_assigned_to_facility(facility_id)))
);
create policy schedules_write on public.schedules for all to authenticated using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin', 'facility_manager')
      and public.is_assigned_to_facility(facility_id))
) with check (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin', 'facility_manager')
      and public.is_assigned_to_facility(facility_id))
);

alter table public.shift_assignments enable row level security;
create policy shift_assignments_select on public.shift_assignments for select to authenticated using (
  public.is_platform_admin()
  or (
    exists (select 1 from public.employees e where e.id = shift_assignments.employee_id and e.profile_id = (select auth.uid()))
    and exists (select 1 from public.schedules s where s.id = shift_assignments.schedule_id and s.status = 'published')
  )
  or (organization_id = (select public.current_org_id())
      and ((select public.current_role()) in ('org_admin', 'auditor') or public.is_assigned_to_facility(facility_id)))
);
create policy shift_assignments_write on public.shift_assignments for all to authenticated using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin', 'facility_manager')
      and public.is_assigned_to_facility(facility_id))
) with check (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin', 'facility_manager')
      and public.is_assigned_to_facility(facility_id))
);
