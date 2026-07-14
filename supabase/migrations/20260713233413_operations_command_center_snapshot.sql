-- Post-priority integration phase: one facility-scoped operational snapshot.
--
-- The PCH / ALF Operations Center previously downloaded and aggregated six
-- domains in the browser. Newer resident-rights, emergency, maintenance, and
-- closed-loop work modules were therefore absent from the daily huddle view.
-- This SECURITY INVOKER RPC keeps every source query under its existing RLS
-- policy and returns only the selected facility's caller-visible records.

create or replace function public.get_operations_command_center(p_facility_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
with scoped_facility as (
  select f.id, f.organization_id, f.name, f.facility_type
  from public.facilities f
  where f.id = p_facility_id
    and (
      (select public.is_platform_admin())
      or (
        f.organization_id = (select public.current_org_id())
        and (
          (select public.current_role()) in ('org_admin', 'auditor')
          or (
            (select public.current_role()) = 'facility_manager'
            and public.is_assigned_to_facility(f.id)
          )
        )
      )
    )
),
open_work as (
  select w.*
  from public.work_items w
  join scoped_facility f on f.id = w.facility_id
  where w.state not in ('closed', 'canceled')
),
work_summary as (
  select
    count(*)::integer as open_count,
    count(*) filter (where priority = 'urgent')::integer as urgent_count,
    count(*) filter (where due_at < now())::integer as overdue_count,
    count(*) filter (where owner_profile_id is null)::integer as unassigned_count,
    count(*) filter (where state = 'pending_approval')::integer as pending_approval_count
  from open_work
),
signal_summary as (
  select
    (select count(*)::integer from public.employee_training_records r join scoped_facility f on f.id = r.facility_id where r.status in ('missing','expired'))
      + (select count(*)::integer from public.employee_credentials c join scoped_facility f on f.id = c.facility_id where c.status in ('missing','expired')) as workforce_gaps,
    (select count(*)::integer from public.resident_compliance_items r join scoped_facility f on f.id = r.facility_id where r.status in ('missing','due_soon','expired')) as resident_readiness_gaps,
    (select count(*)::integer from public.incidents i join scoped_facility f on f.id = i.facility_id where i.incident_type = 'medication_error' and i.status <> 'closed') as medication_follow_ups,
    (select count(*)::integer from public.incidents i join scoped_facility f on f.id = i.facility_id where i.status <> 'closed')
      + (select count(*)::integer from public.complaints c join scoped_facility f on f.id = c.facility_id where c.status <> 'closed') as incident_complaint_open,
    (select count(*)::integer from public.corrective_actions c join scoped_facility f on f.id = c.facility_id where c.status not in ('completed','cancelled') and c.due_date < current_date) as overdue_corrective_actions,
    (select count(*)::integer from public.policy_attestations p join scoped_facility f on f.id = p.facility_id where p.status = 'pending' and p.due_date < current_date) as overdue_policy_attestations,
    (select count(*)::integer from public.emergency_events e join scoped_facility f on f.id = e.facility_id where e.status in ('active','stabilized')) as active_emergency_events,
    (select count(*)::integer
       from public.emergency_event_residents r
       join public.emergency_events e on e.id = r.emergency_event_id
       join scoped_facility f on f.id = e.facility_id
      where e.status in ('active','stabilized') and r.accountability_status in ('expected','unaccounted'))
      + (select count(*)::integer
           from public.emergency_event_staff s
           join public.emergency_events e on e.id = s.emergency_event_id
           join scoped_facility f on f.id = e.facility_id
          where e.status in ('active','stabilized') and s.accountability_status in ('expected','unaccounted')) as emergency_unaccounted,
    (select count(*)::integer from public.work_orders w join scoped_facility f on f.id = w.facility_id where w.status not in ('verified','canceled')) as open_work_orders,
    (select count(*)::integer from public.work_orders w join scoped_facility f on f.id = w.facility_id where w.status not in ('verified','canceled') and (w.priority = 'emergency' or w.safety_risk in ('high','immediate_danger'))) as high_risk_work_orders,
    (select count(*)::integer from public.residents r join scoped_facility f on f.id = r.facility_id where r.status = 'active') as active_residents
),
source_breakdown as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'sourceType', grouped.source_type,
    'openCount', grouped.open_count,
    'urgentCount', grouped.urgent_count,
    'overdueCount', grouped.overdue_count,
    'unassignedCount', grouped.unassigned_count
  ) order by grouped.overdue_count desc, grouped.urgent_count desc, grouped.open_count desc, grouped.source_type), '[]'::jsonb) as value
  from (
    select source_type,
      count(*)::integer as open_count,
      count(*) filter (where priority = 'urgent')::integer as urgent_count,
      count(*) filter (where due_at < now())::integer as overdue_count,
      count(*) filter (where owner_profile_id is null)::integer as unassigned_count
    from open_work
    group by source_type
  ) grouped
),
attention_items as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', ranked.id,
    'title', ranked.title,
    'sourceType', ranked.source_type,
    'state', ranked.state,
    'priority', ranked.priority,
    'dueAt', ranked.due_at,
    'ownerProfileId', ranked.owner_profile_id
  ) order by ranked.rank_group, ranked.due_at, ranked.created_at), '[]'::jsonb) as value
  from (
    select w.*,
      case
        when w.priority = 'urgent' then 0
        when w.due_at < now() then 1
        when w.owner_profile_id is null then 2
        else 3
      end as rank_group
    from open_work w
    order by rank_group, w.due_at, w.created_at
    limit 12
  ) ranked
)
select jsonb_build_object(
  'facility', jsonb_build_object(
    'id', f.id,
    'organizationId', f.organization_id,
    'name', f.name,
    'facilityType', f.facility_type
  ),
  'signals', jsonb_build_object(
    'workforceGaps', s.workforce_gaps,
    'residentReadinessGaps', s.resident_readiness_gaps,
    'medicationFollowUps', s.medication_follow_ups,
    'incidentComplaintOpen', s.incident_complaint_open,
    'overdueCorrectiveActions', s.overdue_corrective_actions,
    'overduePolicyAttestations', s.overdue_policy_attestations,
    'activeEmergencyEvents', s.active_emergency_events,
    'emergencyUnaccounted', s.emergency_unaccounted,
    'openWorkOrders', s.open_work_orders,
    'highRiskWorkOrders', s.high_risk_work_orders,
    'activeResidents', s.active_residents
  ),
  'workQueue', jsonb_build_object(
    'openCount', w.open_count,
    'urgentCount', w.urgent_count,
    'overdueCount', w.overdue_count,
    'unassignedCount', w.unassigned_count,
    'pendingApprovalCount', w.pending_approval_count
  ),
  'sourceBreakdown', b.value,
  'attentionItems', a.value,
  'generatedAt', now()
)
from scoped_facility f
cross join work_summary w
cross join signal_summary s
cross join source_breakdown b
cross join attention_items a;
$$;

revoke all on function public.get_operations_command_center(uuid) from public, anon;
grant execute on function public.get_operations_command_center(uuid) to authenticated, service_role;
