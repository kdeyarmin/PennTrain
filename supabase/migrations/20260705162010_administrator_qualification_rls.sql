alter table public.administrator_profiles enable row level security;
alter table public.administrator_ce_entries enable row level security;

-- Self-service, unlike employee_credentials: an administrator maintains their own 100-hour
-- course record / CE log / NHA license the way any licensed professional keeps their own CE
-- file, with document evidence for audit backup. org_admin can also manage any administrator's
-- record org-wide (e.g. entering data on their behalf, or reviewing before an inspection).
create policy administrator_profiles_select on public.administrator_profiles for select to authenticated using (
  public.is_platform_admin()
  or profile_id = (select auth.uid())
  or (organization_id = (select public.current_org_id()) and (select public.current_role()) in ('org_admin','auditor'))
);

create policy administrator_profiles_insert on public.administrator_profiles for insert to authenticated with check (
  public.is_platform_admin()
  or profile_id = (select auth.uid())
  or (organization_id = (select public.current_org_id()) and (select public.current_role()) = 'org_admin')
);

create policy administrator_profiles_update on public.administrator_profiles for update to authenticated using (
  public.is_platform_admin()
  or profile_id = (select auth.uid())
  or (organization_id = (select public.current_org_id()) and (select public.current_role()) = 'org_admin')
) with check (
  public.is_platform_admin()
  or profile_id = (select auth.uid())
  or (organization_id = (select public.current_org_id()) and (select public.current_role()) = 'org_admin')
);

create policy administrator_profiles_delete on public.administrator_profiles for delete to authenticated using (
  public.is_platform_admin() or (organization_id = (select public.current_org_id()) and (select public.current_role()) = 'org_admin')
);

create policy administrator_ce_entries_select on public.administrator_ce_entries for select to authenticated using (
  public.is_platform_admin()
  or exists (select 1 from public.administrator_profiles ap where ap.id = administrator_ce_entries.administrator_profile_id and ap.profile_id = (select auth.uid()))
  or (organization_id = (select public.current_org_id()) and (select public.current_role()) in ('org_admin','auditor'))
);

create policy administrator_ce_entries_insert on public.administrator_ce_entries for insert to authenticated with check (
  public.is_platform_admin()
  or exists (select 1 from public.administrator_profiles ap where ap.id = administrator_ce_entries.administrator_profile_id and ap.profile_id = (select auth.uid()))
  or (organization_id = (select public.current_org_id()) and (select public.current_role()) = 'org_admin')
);

create policy administrator_ce_entries_delete on public.administrator_ce_entries for delete to authenticated using (
  public.is_platform_admin()
  or exists (select 1 from public.administrator_profiles ap where ap.id = administrator_ce_entries.administrator_profile_id and ap.profile_id = (select auth.uid()))
  or (organization_id = (select public.current_org_id()) and (select public.current_role()) = 'org_admin')
);
