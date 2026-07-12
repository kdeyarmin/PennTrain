-- Protective triggers: block privilege escalation via direct table writes
-- (role/org changes should go through the trusted admin-update-user Edge Function in Phase 4;
--  until then, only platform_admin can change these fields directly).
create or replace function public.protect_profile_privileged_fields()
returns trigger language plpgsql as $$
begin
  if not public.is_platform_admin() then
    new.role := old.role;
    new.organization_id := old.organization_id;
    new.is_active := old.is_active;
  end if;
  return new;
end;
$$;
create trigger protect_privileged_fields before update on public.profiles
  for each row execute function public.protect_profile_privileged_fields();

create or replace function public.protect_organization_subscription_fields()
returns trigger language plpgsql as $$
begin
  if not public.is_platform_admin() then
    new.subscription_status := old.subscription_status;
    new.package_id := old.package_id;
    new.max_facilities := old.max_facilities;
    new.max_users := old.max_users;
  end if;
  return new;
end;
$$;
create trigger protect_subscription_fields before update on public.organizations
  for each row execute function public.protect_organization_subscription_fields();

-- packages
alter table public.packages enable row level security;
create policy packages_select on public.packages for select to authenticated using (
  is_active or public.is_platform_admin()
);
create policy packages_write on public.packages for all to authenticated using (
  public.is_platform_admin()
) with check (
  public.is_platform_admin()
);

-- organizations
alter table public.organizations enable row level security;
create policy organizations_select on public.organizations for select to authenticated using (
  public.is_platform_admin() or id = (select public.current_org_id())
);
create policy organizations_insert on public.organizations for insert to authenticated with check (
  public.is_platform_admin()
);
create policy organizations_update on public.organizations for update to authenticated using (
  public.is_platform_admin() or (id = (select public.current_org_id()) and (select public.current_role()) = 'org_admin')
) with check (
  public.is_platform_admin() or (id = (select public.current_org_id()) and (select public.current_role()) = 'org_admin')
);
create policy organizations_delete on public.organizations for delete to authenticated using (
  public.is_platform_admin()
);

-- organization_settings
alter table public.organization_settings enable row level security;
create policy organization_settings_select on public.organization_settings for select to authenticated using (
  public.is_platform_admin() or organization_id = (select public.current_org_id())
);
create policy organization_settings_write on public.organization_settings for all to authenticated using (
  public.is_platform_admin() or (organization_id = (select public.current_org_id()) and (select public.current_role()) in ('org_admin','facility_manager'))
) with check (
  public.is_platform_admin() or (organization_id = (select public.current_org_id()) and (select public.current_role()) in ('org_admin','facility_manager'))
);

-- facilities (low-sensitivity directory data: readable org-wide, writes restricted)
alter table public.facilities enable row level security;
create policy facilities_select on public.facilities for select to authenticated using (
  public.is_platform_admin() or organization_id = (select public.current_org_id())
);
create policy facilities_insert on public.facilities for insert to authenticated with check (
  public.is_platform_admin() or (organization_id = (select public.current_org_id()) and (select public.current_role()) = 'org_admin')
);
create policy facilities_update on public.facilities for update to authenticated using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and ((select public.current_role()) = 'org_admin' or public.is_assigned_to_facility(id)))
) with check (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and ((select public.current_role()) = 'org_admin' or public.is_assigned_to_facility(id)))
);
create policy facilities_delete on public.facilities for delete to authenticated using (
  public.is_platform_admin() or (organization_id = (select public.current_org_id()) and (select public.current_role()) = 'org_admin')
);

-- profiles (directory readable org-wide; self-row always readable; self-write limited to safe columns)
alter table public.profiles enable row level security;
create policy profiles_select on public.profiles for select to authenticated using (
  public.is_platform_admin() or id = auth.uid() or organization_id = (select public.current_org_id())
);
create policy profiles_update on public.profiles for update to authenticated using (
  public.is_platform_admin() or id = auth.uid()
) with check (
  public.is_platform_admin() or id = auth.uid()
);
revoke update on public.profiles from authenticated;
grant update (first_name, last_name, phone) on public.profiles to authenticated;
grant update on public.profiles to authenticated; -- platform_admin path (protected by trigger + policy for privileged cols)

-- facility_assignments
alter table public.facility_assignments enable row level security;
create policy facility_assignments_select on public.facility_assignments for select to authenticated using (
  public.is_platform_admin()
  or profile_id = auth.uid()
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'org_admin'
             and exists (select 1 from public.facilities f where f.id = facility_assignments.facility_id and f.organization_id = p.organization_id))
);
create policy facility_assignments_write on public.facility_assignments for all to authenticated using (
  public.is_platform_admin()
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'org_admin'
             and exists (select 1 from public.facilities f where f.id = facility_assignments.facility_id and f.organization_id = p.organization_id))
) with check (
  public.is_platform_admin()
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'org_admin'
             and exists (select 1 from public.facilities f where f.id = facility_assignments.facility_id and f.organization_id = p.organization_id))
);

-- employees
alter table public.employees enable row level security;
create policy employees_select on public.employees for select to authenticated using (
  public.is_platform_admin()
  or profile_id = auth.uid()
  or (organization_id = (select public.current_org_id())
      and ((select public.current_role()) in ('org_admin','auditor') or public.is_assigned_to_facility(facility_id)))
);
create policy employees_insert on public.employees for insert to authenticated with check (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin','facility_manager')
      and public.is_assigned_to_facility(facility_id))
);
create policy employees_update on public.employees for update to authenticated using (
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
create policy employees_delete on public.employees for delete to authenticated using (
  public.is_platform_admin() or (organization_id = (select public.current_org_id()) and (select public.current_role()) = 'org_admin')
<<<<<<< HEAD
);
=======
);
>>>>>>> origin/main
