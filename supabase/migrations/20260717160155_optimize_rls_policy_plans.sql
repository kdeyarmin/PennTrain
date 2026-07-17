-- Cache stable auth/scope helpers once per statement instead of reevaluating
-- them for every candidate row in the app's high-traffic operational tables.

alter policy employee_onboarding_items_select
on public.employee_onboarding_items
using (
  (select public.is_platform_admin())
  or exists (
    select 1
    from public.employees employee
    where employee.id = employee_onboarding_items.employee_id
      and employee.profile_id = (select auth.uid())
  )
  or (
    organization_id = (select public.current_org_id())
    and (
      (select public.current_role()) in ('org_admin', 'auditor')
      or public.is_assigned_to_facility(facility_id)
    )
  )
);

alter policy workforce_time_off_select
on public.workforce_time_off_requests
using (
  (select public.is_platform_admin())
  or (
    organization_id = (select public.current_org_id())
    and (
      (select public.current_role()) in ('org_admin', 'auditor')
      or public.is_assigned_to_facility(facility_id)
      or exists (
        select 1
        from public.employees employee
        where employee.id = workforce_time_off_requests.employee_id
          and employee.profile_id = (select auth.uid())
      )
    )
  )
);

alter policy shift_report_select
on public.shift_report_entries
using (
  (select public.is_platform_admin())
  or (
    organization_id = (select public.current_org_id())
    and (
      (select public.current_role()) in ('org_admin', 'auditor')
      or public.is_assigned_to_facility(facility_id)
      or author_profile_id = (select auth.uid())
      or follow_up_owner_profile_id = (select auth.uid())
    )
  )
);

alter policy shift_report_ack_select
on public.shift_report_acknowledgements
using (
  (select public.is_platform_admin())
  or profile_id = (select auth.uid())
  or exists (
    select 1
    from public.shift_report_entries entry
    where entry.id = shift_report_acknowledgements.shift_report_entry_id
      and entry.organization_id = (select public.current_org_id())
      and (
        (select public.current_role()) in ('org_admin', 'auditor')
        or public.is_assigned_to_facility(entry.facility_id)
      )
  )
);

-- The original FOR ALL policy also counted as a second permissive SELECT
-- policy. Split it by write command so reads have one clear authorization path
-- while preserving the same USING/WITH CHECK semantics for mutations.
drop policy alerts_write on public.alerts;

create policy alerts_insert
on public.alerts for insert to authenticated
with check (
  (select public.is_platform_admin())
  or (
    organization_id = (select public.current_org_id())
    and (select public.current_role()) in ('org_admin', 'facility_manager')
    and (facility_id is null or public.is_assigned_to_facility(facility_id))
  )
);

create policy alerts_update
on public.alerts for update to authenticated
using (
  (select public.is_platform_admin())
  or (
    organization_id = (select public.current_org_id())
    and (select public.current_role()) in ('org_admin', 'facility_manager')
    and (facility_id is null or public.is_assigned_to_facility(facility_id))
  )
)
with check (
  (select public.is_platform_admin())
  or (
    organization_id = (select public.current_org_id())
    and (select public.current_role()) in ('org_admin', 'facility_manager')
    and (facility_id is null or public.is_assigned_to_facility(facility_id))
  )
);

create policy alerts_delete
on public.alerts for delete to authenticated
using (
  (select public.is_platform_admin())
  or (
    organization_id = (select public.current_org_id())
    and (select public.current_role()) in ('org_admin', 'facility_manager')
    and (facility_id is null or public.is_assigned_to_facility(facility_id))
  )
);
