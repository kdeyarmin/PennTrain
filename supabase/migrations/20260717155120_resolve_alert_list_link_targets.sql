-- Resolve alert deep-link targets in the paged read model so the alert queue
-- does not download four entire related tables on every mount.
--
-- security_invoker keeps the underlying tables' RLS policies as the
-- authorization boundary. Related rows that the caller cannot read simply
-- produce null link targets through the left joins.

create or replace view public.alert_list_rows
with (security_invoker = true)
as
select
  a.*,
  coalesce(notification.incident_id, action.incident_id) as linked_incident_id,
  coalesce(a.inspection_item_id, inspection_event.inspection_item_id) as linked_inspection_item_id,
  compliance_item.resident_id as linked_resident_id
from public.alerts a
left join public.incident_notifications notification
  on notification.id = a.incident_notification_id
left join public.corrective_actions action
  on action.id = a.corrective_action_id
left join public.inspection_events inspection_event
  on inspection_event.id = action.inspection_event_id
left join public.resident_compliance_items compliance_item
  on compliance_item.id = a.resident_compliance_item_id;

revoke all on table public.alert_list_rows from public, anon;
grant select on table public.alert_list_rows to authenticated, service_role;
