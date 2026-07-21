-- Server-side summary for the Complaints list so its metric tiles can be computed over the whole
-- filtered facility scope while the list itself is served page by page. Mirrors
-- get_incident_list_summary: SECURITY INVOKER so the caller's own RLS scopes every count.
create or replace function public.get_complaint_list_summary(
  p_facility_id uuid default null,
  p_status text default null,
  p_category text default null,
  p_search text default null,
  p_exclude_status text default null
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  with filtered as (
    select c.*
    from public.complaints c
    where (p_facility_id is null or c.facility_id = p_facility_id)
      and (p_status is null or c.status = p_status)
      and (p_exclude_status is null or c.status <> p_exclude_status)
      and (p_category is null or c.category = p_category)
      and (
        nullif(btrim(p_search), '') is null
        or c.complaint_number ilike '%' || btrim(p_search) || '%'
        or c.category ilike '%' || btrim(p_search) || '%'
        or coalesce(c.complainant_name, '') ilike '%' || btrim(p_search) || '%'
      )
  )
  select jsonb_build_object(
    'total', count(*),
    'openCases', count(*) filter (where status <> 'closed'),
    'awaitingAcknowledgement', count(*) filter (where acknowledgement_date is null and status <> 'closed'),
    'highOrImminentRisk', count(*) filter (where immediate_risk in ('high', 'imminent') and status <> 'closed'),
    'incidentLinked', count(*) filter (where incident_id is not null)
  )
  from filtered;
$function$;
revoke all on function public.get_complaint_list_summary(uuid, text, text, text, text) from public, anon;
grant execute on function public.get_complaint_list_summary(uuid, text, text, text, text) to authenticated, service_role;
