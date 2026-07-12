create or replace function public.current_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.current_org_id() returns uuid
language sql stable security definer set search_path = public as $$
  select organization_id from public.profiles where id = auth.uid();
$$;

create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'platform_admin');
$$;

create or replace function public.is_assigned_to_facility(target_facility_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select
    public.is_platform_admin()
    or (select role from public.profiles where id = auth.uid()) in ('org_admin','auditor')
    or exists (
      select 1 from public.facility_assignments fa
      where fa.profile_id = auth.uid() and fa.facility_id = target_facility_id
    );
$$;

grant execute on function public.current_role() to authenticated;
grant execute on function public.current_org_id() to authenticated;
grant execute on function public.is_platform_admin() to authenticated;
<<<<<<< HEAD
grant execute on function public.is_assigned_to_facility(uuid) to authenticated;
=======
grant execute on function public.is_assigned_to_facility(uuid) to authenticated;
>>>>>>> origin/main
