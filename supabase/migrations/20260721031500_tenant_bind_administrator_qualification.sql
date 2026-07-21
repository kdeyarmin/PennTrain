-- Bind administrator qualification self-service to the caller's active tenant.
-- Prior policies allowed a user to pair their own profile_id with another
-- organization_id. Keep the self-service workflow, but require both the profile
-- and tenant path to match the authenticated user's current organization.

create or replace function public.enforce_administrator_profile_tenant_match()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_org_id uuid;
begin
  select p.organization_id
  into v_profile_org_id
  from public.profiles p
  where p.id = new.profile_id;

  if v_profile_org_id is null then
    raise exception 'administrator profile owner was not found'
      using errcode = 'foreign_key_violation';
  end if;

  if new.organization_id <> v_profile_org_id then
    raise exception 'administrator profile organization must match profile organization'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_administrator_profile_tenant_match() from public, anon, authenticated;

drop trigger if exists enforce_administrator_profile_tenant_match on public.administrator_profiles;
create trigger enforce_administrator_profile_tenant_match
before insert or update of organization_id, profile_id on public.administrator_profiles
for each row execute function public.enforce_administrator_profile_tenant_match();

-- Recreate qualification RLS with self-service bound to both profile and tenant.
drop policy if exists administrator_profiles_select on public.administrator_profiles;
drop policy if exists administrator_profiles_insert on public.administrator_profiles;
drop policy if exists administrator_profiles_update on public.administrator_profiles;
drop policy if exists administrator_profiles_delete on public.administrator_profiles;

create policy administrator_profiles_select on public.administrator_profiles for select to authenticated using (
  public.is_platform_admin()
  or (profile_id = (select auth.uid()) and organization_id = (select public.current_org_id()))
  or (organization_id = (select public.current_org_id()) and (select public.current_role()) in ('org_admin','auditor'))
);

create policy administrator_profiles_insert on public.administrator_profiles for insert to authenticated with check (
  public.is_platform_admin()
  or (profile_id = (select auth.uid()) and organization_id = (select public.current_org_id()))
  or (organization_id = (select public.current_org_id()) and (select public.current_role()) = 'org_admin')
);

create policy administrator_profiles_update on public.administrator_profiles for update to authenticated using (
  public.is_platform_admin()
  or (profile_id = (select auth.uid()) and organization_id = (select public.current_org_id()))
  or (organization_id = (select public.current_org_id()) and (select public.current_role()) = 'org_admin')
) with check (
  public.is_platform_admin()
  or (profile_id = (select auth.uid()) and organization_id = (select public.current_org_id()))
  or (organization_id = (select public.current_org_id()) and (select public.current_role()) = 'org_admin')
);

create policy administrator_profiles_delete on public.administrator_profiles for delete to authenticated using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id()) and (select public.current_role()) = 'org_admin')
);

-- Recreate CE policies so self-service CE access follows the tenant-bound parent.
drop policy if exists administrator_ce_entries_select on public.administrator_ce_entries;
drop policy if exists administrator_ce_entries_insert on public.administrator_ce_entries;
drop policy if exists administrator_ce_entries_delete on public.administrator_ce_entries;

create policy administrator_ce_entries_select on public.administrator_ce_entries for select to authenticated using (
  public.is_platform_admin()
  or exists (
    select 1 from public.administrator_profiles ap
    where ap.id = administrator_ce_entries.administrator_profile_id
      and ap.profile_id = (select auth.uid())
      and ap.organization_id = (select public.current_org_id())
  )
  or (organization_id = (select public.current_org_id()) and (select public.current_role()) in ('org_admin','auditor'))
);

create policy administrator_ce_entries_insert on public.administrator_ce_entries for insert to authenticated with check (
  public.is_platform_admin()
  or exists (
    select 1 from public.administrator_profiles ap
    where ap.id = administrator_ce_entries.administrator_profile_id
      and ap.profile_id = (select auth.uid())
      and ap.organization_id = (select public.current_org_id())
  )
  or (organization_id = (select public.current_org_id()) and (select public.current_role()) = 'org_admin')
);

create policy administrator_ce_entries_delete on public.administrator_ce_entries for delete to authenticated using (
  public.is_platform_admin()
  or exists (
    select 1 from public.administrator_profiles ap
    where ap.id = administrator_ce_entries.administrator_profile_id
      and ap.profile_id = (select auth.uid())
      and ap.organization_id = (select public.current_org_id())
  )
  or (organization_id = (select public.current_org_id()) and (select public.current_role()) = 'org_admin')
);

-- Recreate document policies so self-service object access binds both path segments.
drop policy if exists "administrator-documents read" on storage.objects;
drop policy if exists "administrator-documents write" on storage.objects;
drop policy if exists "administrator-documents delete" on storage.objects;

create policy "administrator-documents read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'administrator-documents'
    and (
      public.is_platform_admin()
      or (
        (storage.foldername(name))[1] = (select public.current_org_id())::text
        and (storage.foldername(name))[2] = (select auth.uid())::text
      )
      or ((storage.foldername(name))[1] = (select public.current_org_id())::text and (select public.current_role()) in ('org_admin','auditor'))
    )
  );

create policy "administrator-documents write" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'administrator-documents'
    and (
      public.is_platform_admin()
      or (
        (storage.foldername(name))[1] = (select public.current_org_id())::text
        and (storage.foldername(name))[2] = (select auth.uid())::text
      )
      or ((storage.foldername(name))[1] = (select public.current_org_id())::text and (select public.current_role()) = 'org_admin')
    )
  );

create policy "administrator-documents delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'administrator-documents'
    and (
      public.is_platform_admin()
      or (
        (storage.foldername(name))[1] = (select public.current_org_id())::text
        and (storage.foldername(name))[2] = (select auth.uid())::text
      )
      or ((storage.foldername(name))[1] = (select public.current_org_id())::text and (select public.current_role()) = 'org_admin')
    )
  );
