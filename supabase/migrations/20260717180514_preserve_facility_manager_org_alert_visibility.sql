-- Splitting the former FOR ALL alert policy into command-specific write
-- policies removed its permissive SELECT path. Preserve the intended access
-- contract: facility managers can see alerts for assigned facilities and
-- organization-wide alerts that intentionally have no facility scope.
alter policy alerts_select
on public.alerts
using (
  (select public.is_platform_admin())
  or (
    organization_id = (select public.current_org_id())
    and (
      (select public.current_role()) in ('org_admin', 'auditor')
      or (
        (select public.current_role()) = 'facility_manager'
        and (
          facility_id is null
          or public.is_assigned_to_facility(facility_id)
        )
      )
      or (
        (select public.current_role()) = 'trainer'
        and public.is_assigned_to_facility(facility_id)
        and employee_credential_id is null
        and incident_notification_id is null
        and resident_compliance_item_id is null
        and not exists (
          select 1
          from public.corrective_actions action
          where action.id = alerts.corrective_action_id
            and action.incident_id is not null
        )
      )
    )
  )
);
