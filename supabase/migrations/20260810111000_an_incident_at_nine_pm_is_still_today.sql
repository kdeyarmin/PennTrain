-- The incident KPI cards ended "today" at UTC midnight -- 8 PM in Pennsylvania.
--
-- get_incident_list_summary bounded its 7- and 30-day windows with `p_today::timestamptz` and
-- `(p_today + 1)::timestamptz`. On hosted Supabase (TimeZone = UTC) a date-to-timestamptz cast
-- lands at midnight UTC, which is 20:00 EDT / 19:00 EST the same Pennsylvania evening -- so an
-- incident logged at 21:00 ET tonight sits in the list below the cards but is missing from
-- 'Reported last 7 days' until the UTC day rolls over, and week-old evening incidents linger in
-- the count one day too long. This is the exact pattern public.pa_midnight() was created to
-- eliminate (20260727020000), and the client-side twin of this computation already fixed it
-- (incidentAnalytics.ts) -- but the filter here has carried the UTC cast unchanged since the
-- function's creation in 20260717031000: the 20260727 sweeps replaced `current_date` reads and
-- `timestamptz::date` casts, and a date PARAMETER cast to timestamptz matched neither.
--
-- Two changes, same signature otherwise:
--   * the window bounds go through public.pa_midnight(), so a facility day runs midnight to
--     midnight in Pennsylvania;
--   * `p_today` now defaults to null and falls back to public.pa_today() -- the old default
--     `current_date` lived in the function SIGNATURE, where the prosrc ratchet in
--     pa_day_is_the_facility_day.test.sql cannot see it, and meant any caller omitting p_today
--     was querying tomorrow's window all evening.
--
-- Rollback: recreate from 20260730200000.

drop function if exists public.get_incident_list_summary(uuid, uuid, text, text, text, date, uuid);

create function public.get_incident_list_summary(
  p_facility_id uuid default null,
  p_resident_id uuid default null,
  p_severity text default null,
  p_status text default null,
  p_search text default null,
  p_today date default null,
  p_organization_id uuid default null
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  with today as (
    select coalesce(p_today, public.pa_today()) as d
  ),
  search as (
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
      where occurred_at >= public.pa_midnight(t.d - 7)
        and occurred_at < public.pa_midnight(t.d + 1)
    ),
    'reportedLast30Days', count(*) filter (
      where occurred_at >= public.pa_midnight(t.d - 30)
        and occurred_at < public.pa_midnight(t.d + 1)
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
  from filtered
  cross join today t;
$function$;

revoke all on function public.get_incident_list_summary(uuid, uuid, text, text, text, date, uuid)
  from public, anon;
grant execute on function public.get_incident_list_summary(uuid, uuid, text, text, text, date, uuid)
  to authenticated, service_role;

comment on function public.get_incident_list_summary(uuid, uuid, text, text, text, date, uuid) is
  'Incident list KPI cards. SECURITY INVOKER so caller RLS applies; optional p_organization_id scopes platform-admin viewing-as-org. Recency windows are Pennsylvania calendar days via pa_midnight().';
