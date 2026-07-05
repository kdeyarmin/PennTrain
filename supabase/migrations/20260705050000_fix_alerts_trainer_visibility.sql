-- Codex/Copilot review finding (P1): alerts_select predates this branch's new alert types and
-- grants read access via is_assigned_to_facility(facility_id) alone, which doesn't distinguish
-- trainer from facility_manager. So even though employee_credentials/incidents/
-- incident_notifications tables themselves correctly exclude trainer, a trainer could still read
-- the *alert* rows derived from them (credential_expiring, incident_notification_overdue, and
-- incident-linked corrective_action_overdue) through this shared table, leaking the same
-- information the underlying RLS was designed to withhold (e.g. an alert title like "Act 34
-- Criminal History Clearance -- Jane Doe").
--
-- Fix: give trainer a narrower branch that excludes exactly those three alert shapes, keyed off
-- the FK columns already on the row (no join needed except for corrective_action_id, which can
-- point at either an incident, still excluded, or an inspection event, still allowed for trainer
-- per inspection_items' own RLS). org_admin/auditor (org-wide) and facility_manager (assigned
-- facility, all alert types) are unchanged.
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
