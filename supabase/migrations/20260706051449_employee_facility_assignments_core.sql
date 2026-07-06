-- Additive multi-facility support for the employee roster: employees.facility_id remains the
-- employee's home/primary facility (compliance rules, RLS scoping, and every existing feature keep
-- working unchanged), while employee_facility_assignments is the new join table recording every
-- facility an employee can be scheduled at, mirroring the existing profile-level
-- facility_assignments table. This unblocks shift scheduling for float/cross-facility staff without
-- touching the compliance schema.

create table public.employee_facility_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  unique (employee_id, facility_id)
);
create index employee_facility_assignments_employee_id_idx on public.employee_facility_assignments(employee_id);
create index employee_facility_assignments_facility_id_idx on public.employee_facility_assignments(facility_id);
create index employee_facility_assignments_organization_id_idx on public.employee_facility_assignments(organization_id);
-- at most one primary facility per employee
create unique index employee_facility_assignments_one_primary_idx
  on public.employee_facility_assignments(employee_id) where is_primary;

-- Backfill: every existing employee's current facility becomes their primary assignment.
insert into public.employee_facility_assignments (organization_id, employee_id, facility_id, is_primary)
select organization_id, id, facility_id, true from public.employees
on conflict (employee_id, facility_id) do nothing;

-- Keep the primary assignment row in sync with employees.facility_id going forward (new hires and
-- facility reassignment). Reassignment does not delete the employee's prior facility assignments --
-- it only moves the is_primary flag -- so a transferred employee already scheduled elsewhere isn't
-- silently dropped from that facility; admins can remove stale assignments explicitly.
create or replace function public.sync_employee_primary_facility_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.employee_facility_assignments
    set is_primary = false
    where employee_id = new.id and facility_id <> new.facility_id and is_primary;

  insert into public.employee_facility_assignments (organization_id, employee_id, facility_id, is_primary)
  values (new.organization_id, new.id, new.facility_id, true)
  on conflict (employee_id, facility_id) do update
    set is_primary = true, organization_id = excluded.organization_id;

  return new;
end;
$$;

create trigger sync_employee_primary_facility_assignment
  after insert or update of facility_id, organization_id on public.employees
  for each row execute function public.sync_employee_primary_facility_assignment();

revoke all on function public.sync_employee_primary_facility_assignment() from public;

-- RLS helper: is the current user (any role) allowed to see/manage this employee at this facility --
-- i.e. is the employee actually assigned there, not just at their primary facility.
create or replace function public.is_employee_assigned_to_facility(p_employee_id uuid, p_facility_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.employee_facility_assignments efa
    where efa.employee_id = p_employee_id and efa.facility_id = p_facility_id
  );
$$;
grant execute on function public.is_employee_assigned_to_facility(uuid, uuid) to authenticated;

alter table public.employee_facility_assignments enable row level security;

create policy employee_facility_assignments_select on public.employee_facility_assignments for select to authenticated using (
  public.is_platform_admin()
  or exists (select 1 from public.employees e where e.id = employee_facility_assignments.employee_id and e.profile_id = (select auth.uid()))
  or (organization_id = (select public.current_org_id())
      and ((select public.current_role()) in ('org_admin','auditor') or public.is_assigned_to_facility(facility_id)))
);

create policy employee_facility_assignments_write on public.employee_facility_assignments for all to authenticated using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin','facility_manager')
      and public.is_assigned_to_facility(facility_id))
) with check (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin','facility_manager')
      and public.is_assigned_to_facility(facility_id))
);
