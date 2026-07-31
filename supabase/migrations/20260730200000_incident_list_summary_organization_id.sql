-- Platform-admin "Viewing as org" support for incident list summary cards.
-- The list query already accepts organization_id client-side; the summary RPC
-- did not, so platform admins (who bypass RLS) saw all-tenant totals mixed with
-- a single-org list. Mirror get_complaint_list_summary's p_organization_id.

drop function if exists public.get_incident_list_summary(uuid, uuid, text, text, text, date);

create function public.get_incident_list_summary(
  p_facility_id uuid default null,
  p_resident_id uuid default null,
  p_severity text default null,
  p_status text default null,
  p_search text default null,
  p_today date default current_date,
  p_organization_id uuid default null
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  with search as (
    select
      nullif(btrim(p_search), '') as raw,
      '%' || replace(replace(replace(nullif(btrim(p_search), ''), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pattern
  ),
  filtered as (
    select incident.*
    from public.incident_list_rows incident
    cross join search s
    where (p_organization_id is null or incident.organization_id = p_organization_id)
      and (p_facility_id is null or incident.facility_id = p_facility_id)
      and (p_resident_id is null or incident.resident_id = p_resident_id)
      and (p_severity is null or incident.severity = p_severity)
      and (p_status is null or incident.status = p_status)
      and (
        s.raw is null
        or incident.search_text ilike s.pattern
      )
  )
  select jsonb_build_object(
    'total', count(*),
    'open', count(*) filter (where status <> 'closed'),
    'criticalOpen', count(*) filter (where status <> 'closed' and severity = 'critical'),
    'majorOrCritical', count(*) filter (where severity in ('major', 'critical')),
    'reportedLast7Days', count(*) filter (
      where occurred_at >= p_today::timestamptz - interval '7 days'
        and occurred_at < (p_today + 1)::timestamptz
    ),
    'reportedLast30Days', count(*) filter (
      where occurred_at >= p_today::timestamptz - interval '30 days'
        and occurred_at < (p_today + 1)::timestamptz
    ),
    'oldestOpenIncidentId', (
      select id from filtered where status <> 'closed'
      order by occurred_at, id limit 1
    ),
    'topIncidentType', (
      select incident_type from filtered
      group by incident_type order by count(*) desc, incident_type limit 1
    )
  )
  from filtered;
$function$;

revoke all on function public.get_incident_list_summary(uuid, uuid, text, text, text, date, uuid)
  from public, anon;
grant execute on function public.get_incident_list_summary(uuid, uuid, text, text, text, date, uuid)
  to authenticated, service_role;

comment on function public.get_incident_list_summary(uuid, uuid, text, text, text, date, uuid) is
  'Incident list KPI cards. SECURITY INVOKER so caller RLS applies; optional p_organization_id scopes platform-admin viewing-as-org.';
