-- A plan_of_correction_versions row embeds the full dhs_violations row plus every
-- corrective action (submit_plan_of_correction builds the snapshot from to_jsonb of
-- both). The parent table's SELECT policy (20260705173134) deliberately scopes
-- facility_manager reads to assigned facilities and admits no trainer at all -- but
-- 20260801021000's plan_of_correction_versions_select listed facility_manager in the
-- unconditioned role list AND carried a bare is_assigned_to_facility branch, so an
-- unassigned FM (or a trainer assigned to the facility) could read snapshots of
-- violations the parent policy denies them. list_plan_of_correction_versions repeated
-- the same predicate behind SECURITY DEFINER. Same class as 20260806020000's
-- write-side fix (assert_can_manage_violation, packet list RPCs), applied to the
-- read side: both predicates now mirror dhs_violations_select exactly.

drop policy if exists plan_of_correction_versions_select on public.plan_of_correction_versions;
create policy plan_of_correction_versions_select on public.plan_of_correction_versions
  for select to authenticated using (
    (select public.is_platform_admin())
    or (
      organization_id = (select public.current_org_id())
      and (
        (select public.current_role()) in ('org_admin', 'auditor')
        or (
          (select public.current_role()) = 'facility_manager'
          and public.is_assigned_to_facility(facility_id)
        )
      )
    )
  );

create or replace function public.list_plan_of_correction_versions(p_violation_id uuid)
returns setof public.plan_of_correction_versions
language plpgsql stable security definer set search_path = ''
as $$
declare v public.dhs_violations%rowtype;
begin
  select * into v from public.dhs_violations where id = p_violation_id;
  if not found then raise exception 'Violation not found' using errcode = 'P0002'; end if;
  if not (
    public.is_platform_admin()
    or (v.organization_id = public.current_org_id() and (
      public.current_role() in ('org_admin', 'auditor')
      or (public.current_role() = 'facility_manager' and public.is_assigned_to_facility(v.facility_id))))
  ) then raise exception 'Not authorized' using errcode = '42501'; end if;
  return query select * from public.plan_of_correction_versions
  where violation_id = p_violation_id order by version_number desc;
end;
$$;
