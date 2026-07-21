-- Server-side summary for the Confidential Reports list so its triage tiles can be computed over the
-- whole facility scope while the intake list is served page by page. SECURITY INVOKER so the caller's
-- own RLS (which already hides drafts from facility managers) scopes every count.
create or replace function public.get_confidential_intake_list_summary(
  p_organization_id uuid default null,
  p_facility_id uuid default null
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  with filtered as (
    select c.*
    from public.confidential_incident_intakes c
    where (p_organization_id is null or c.organization_id = p_organization_id)
      and (p_facility_id is null or c.facility_id = p_facility_id)
  )
  select jsonb_build_object(
    'total', count(*),
    'awaitingTriage', count(*) filter (where status = 'submitted'),
    'investigating', count(*) filter (where status in ('triage', 'investigating', 'review')),
    'criticalOpen', count(*) filter (where severity = 'critical' and status not in ('closed', 'retained'))
  )
  from filtered;
$function$;
revoke all on function public.get_confidential_intake_list_summary(uuid, uuid) from public, anon;
grant execute on function public.get_confidential_intake_list_summary(uuid, uuid) to authenticated, service_role;
