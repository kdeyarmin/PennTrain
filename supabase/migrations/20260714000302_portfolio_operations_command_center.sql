-- Portfolio operations oversight for the PCH / ALF command center.
--
-- Each facility snapshot is resolved through get_operations_command_center(),
-- which is SECURITY INVOKER and therefore preserves every source table's RLS.
-- The outer function only discovers facilities already visible to the current
-- reporting role and rolls those snapshots into one ranked portfolio view.

create or replace function public.get_portfolio_operations_command_center()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
with authorized as (
  select auth_ctx.organization_id
  from (select public.current_org_id() as organization_id, public.current_role() as role) auth_ctx
  where auth_ctx.role in ('org_admin', 'auditor', 'facility_manager')
    and auth_ctx.organization_id is not null
),
scoped_facilities as (
  select f.id, f.organization_id, f.name, f.facility_type
  from public.facilities f
  join authorized a on a.organization_id = f.organization_id
  where f.is_active
    and f.facility_type in ('PCH', 'ALR')
    and (
      public.current_role() in ('org_admin', 'auditor')
      or (
        public.current_role() = 'facility_manager'
        and public.is_assigned_to_facility(f.id)
      )
    )
),
snapshots as materialized (
  select f.*, public.get_operations_command_center(f.id) as snapshot
  from scoped_facilities f
),
facility_metrics as (
  select
    s.id,
    s.organization_id,
    s.name,
    s.facility_type,
    s.snapshot->'signals' as signals,
    s.snapshot->'workQueue' as work_queue,
    coalesce((s.snapshot->'workQueue'->>'openCount')::integer, 0) as open_work,
    coalesce((s.snapshot->'workQueue'->>'urgentCount')::integer, 0) as urgent_work,
    coalesce((s.snapshot->'workQueue'->>'overdueCount')::integer, 0) as overdue_work,
    coalesce((s.snapshot->'workQueue'->>'unassignedCount')::integer, 0) as unassigned_work,
    coalesce((s.snapshot->'workQueue'->>'pendingApprovalCount')::integer, 0) as pending_approval_work,
    coalesce((s.snapshot->'signals'->>'activeEmergencyEvents')::integer, 0) as active_emergency_events,
    coalesce((s.snapshot->'signals'->>'emergencyUnaccounted')::integer, 0) as emergency_unaccounted,
    coalesce((s.snapshot->'signals'->>'highRiskWorkOrders')::integer, 0) as high_risk_work_orders,
    coalesce((s.snapshot->'signals'->>'residentReadinessGaps')::integer, 0) as resident_readiness_gaps,
    coalesce((s.snapshot->'signals'->>'workforceGaps')::integer, 0) as workforce_gaps,
    coalesce((s.snapshot->'signals'->>'medicationFollowUps')::integer, 0) as medication_follow_ups,
    coalesce((s.snapshot->'signals'->>'incidentComplaintOpen')::integer, 0) as incident_complaint_open,
    coalesce((s.snapshot->'signals'->>'overdueCorrectiveActions')::integer, 0) as overdue_corrective_actions,
    coalesce((s.snapshot->'signals'->>'overduePolicyAttestations')::integer, 0) as overdue_policy_attestations,
    coalesce((s.snapshot->'signals'->>'activeResidents')::integer, 0) as active_residents
  from snapshots s
  where s.snapshot is not null
),
ranked_facilities as (
  select
    m.*,
    (
      m.urgent_work * 8
      + m.overdue_work * 5
      + m.unassigned_work * 2
      + m.pending_approval_work
      + m.active_emergency_events * 10
      + m.emergency_unaccounted * 12
      + m.high_risk_work_orders * 8
      + m.resident_readiness_gaps * 3
      + m.workforce_gaps * 2
      + m.medication_follow_ups * 5
      + m.incident_complaint_open * 2
      + m.overdue_corrective_actions * 4
      + m.overdue_policy_attestations * 3
    )::integer as risk_score,
    case
      when m.active_emergency_events > 0
        or m.emergency_unaccounted > 0
        or m.high_risk_work_orders > 0
        or m.urgent_work > 0 then 'critical'
      when m.overdue_work > 0
        or m.unassigned_work > 0
        or m.pending_approval_work > 0
        or m.resident_readiness_gaps > 0
        or m.workforce_gaps > 0
        or m.medication_follow_ups > 0
        or m.incident_complaint_open > 0
        or m.overdue_corrective_actions > 0
        or m.overdue_policy_attestations > 0 then 'attention'
      else 'ready'
    end as readiness_status
  from facility_metrics m
),
portfolio_summary as (
  select
    count(*)::integer as facility_count,
    count(*) filter (where readiness_status = 'critical')::integer as critical_facilities,
    count(*) filter (where readiness_status = 'attention')::integer as attention_facilities,
    count(*) filter (where readiness_status = 'ready')::integer as ready_facilities,
    coalesce(sum(open_work), 0)::integer as open_work,
    coalesce(sum(urgent_work), 0)::integer as urgent_work,
    coalesce(sum(overdue_work), 0)::integer as overdue_work,
    coalesce(sum(unassigned_work), 0)::integer as unassigned_work,
    coalesce(sum(active_emergency_events), 0)::integer as active_emergency_events,
    coalesce(sum(emergency_unaccounted), 0)::integer as emergency_unaccounted,
    coalesce(sum(high_risk_work_orders), 0)::integer as high_risk_work_orders,
    coalesce(sum(resident_readiness_gaps), 0)::integer as resident_readiness_gaps,
    coalesce(sum(workforce_gaps), 0)::integer as workforce_gaps,
    coalesce(sum(active_residents), 0)::integer as active_residents
  from ranked_facilities
),
facility_list as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'facility', jsonb_build_object(
      'id', r.id,
      'organizationId', r.organization_id,
      'name', r.name,
      'facilityType', r.facility_type
    ),
    'readinessStatus', r.readiness_status,
    'riskScore', r.risk_score,
    'signals', r.signals,
    'workQueue', r.work_queue
  ) order by
    case r.readiness_status when 'critical' then 0 when 'attention' then 1 else 2 end,
    r.risk_score desc,
    r.name), '[]'::jsonb) as value
  from ranked_facilities r
)
select jsonb_build_object(
  'organizationId', a.organization_id,
  'summary', jsonb_build_object(
    'facilityCount', p.facility_count,
    'criticalFacilities', p.critical_facilities,
    'attentionFacilities', p.attention_facilities,
    'readyFacilities', p.ready_facilities,
    'openWork', p.open_work,
    'urgentWork', p.urgent_work,
    'overdueWork', p.overdue_work,
    'unassignedWork', p.unassigned_work,
    'activeEmergencyEvents', p.active_emergency_events,
    'emergencyUnaccounted', p.emergency_unaccounted,
    'highRiskWorkOrders', p.high_risk_work_orders,
    'residentReadinessGaps', p.resident_readiness_gaps,
    'workforceGaps', p.workforce_gaps,
    'activeResidents', p.active_residents
  ),
  'facilities', l.value,
  'generatedAt', now()
)
from authorized a
cross join portfolio_summary p
cross join facility_list l;
$$;

revoke all on function public.get_portfolio_operations_command_center() from public, anon;
grant execute on function public.get_portfolio_operations_command_center() to authenticated, service_role;

comment on function public.get_portfolio_operations_command_center() is
  'Returns a ranked caller-visible PCH/ALF portfolio operations snapshot without bypassing source RLS.';
