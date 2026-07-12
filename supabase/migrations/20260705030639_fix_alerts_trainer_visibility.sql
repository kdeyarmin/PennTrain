alter policy alerts_select on public.alerts using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and (
        (select public.current_role()) in ('org_admin','auditor')
        or ((select public.current_role()) = 'facility_manager' and public.is_assigned_to_facility(facility_id))
        or (
          (select public.current_role()) = 'trainer'
          and public.is_assigned_to_facility(facility_id)
          and employee_credential_id is null
          and incident_notification_id is null
          and not exists (
            select 1 from public.corrective_actions ca
            where ca.id = alerts.corrective_action_id and ca.incident_id is not null
          )
        )
      ))
);
