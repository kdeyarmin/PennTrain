-- The search box is a search box, not a wildcard console.
--
-- 20260724190003_escape_work_item_search_wildcards.sql fixed this for the two work-queue
-- functions, but the same raw interpolation was left in four other list-summary routines:
-- get_incident_list_summary, get_resident_list_summary, get_complaint_list_summary, and
-- get_survey_day_staff_roster. Each built `ilike '%' || btrim(p_search) || '%'` straight from the
-- caller's text, so '%', '_' and '\' were still read as LIKE metacharacters:
--
--   * a bare '%' matched every row -- the metric tiles then reported the *unfiltered* totals while
--     the operator believed they were reading a filtered view;
--   * '_' matched any single character, so 'P_ain' silently matched 'Plain';
--   * a trailing '\' could consume the closing '%' of the generated pattern.
--
-- Confirmed against a local stack before this migration: get_resident_list_summary(facility, null,
-- '%') reported 3 of 3 residents when exactly one resident's name literally contained a percent
-- sign.
--
-- Each function below is replaced with the same signature, SECURITY INVOKER + caller-RLS behavior,
-- ordering, and jsonb envelope it already had. The only change is that %, _ and \ in the search
-- term are escaped and matched literally. Backslash is doubled first, or the escapes added for %
-- and _ would themselves be escaped. Postgres LIKE uses '\' as its default escape character, so no
-- explicit ESCAPE clause is required -- this matches 20260724190003 exactly.

create or replace function public.get_incident_list_summary(
  p_facility_id uuid default null,
  p_resident_id uuid default null,
  p_severity text default null,
  p_status text default null,
  p_search text default null,
  p_today date default current_date
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
    where (p_facility_id is null or incident.facility_id = p_facility_id)
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

create or replace function public.get_resident_list_summary(
  p_facility_id uuid default null,
  p_status text default null,
  p_search text default null,
  p_today date default current_date
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
    select resident.*
    from public.resident_roster_rows resident
    cross join search s
    where (p_facility_id is null or resident.facility_id = p_facility_id)
      and (p_status is null or resident.status = p_status)
      and (
        s.raw is null
        or resident.search_text ilike s.pattern
      )
  ), item_summary as (
    select
      count(distinct item.resident_id) filter (
        where item.status in ('expired', 'missing', 'due_soon')
      ) as residents_with_open_items,
      count(*) filter (where item.status = 'expired') as expired_items,
      count(*) filter (where item.status = 'missing') as missing_items,
      count(*) filter (where item.status = 'due_soon') as due_soon_items,
      count(*) filter (
        where item.due_date between p_today and p_today + 14
          and item.status not in ('compliant', 'not_applicable')
      ) as due_within_14_days
    from public.resident_compliance_items item
    join filtered resident on resident.id = item.resident_id
  )
  select jsonb_build_object(
    'residents', (select count(*) from filtered),
    'activeResidents', (select count(*) from filtered where status = 'active'),
    'residentsWithOpenItems', coalesce(item_summary.residents_with_open_items, 0),
    'expiredItems', coalesce(item_summary.expired_items, 0),
    'missingItems', coalesce(item_summary.missing_items, 0),
    'dueSoonItems', coalesce(item_summary.due_soon_items, 0),
    'dueWithin14Days', coalesce(item_summary.due_within_14_days, 0),
    'newestAdmissionResidentId', (
      select id from filtered order by admission_date desc nulls last, id limit 1
    )
  )
  from item_summary;
$function$;

create or replace function public.get_complaint_list_summary(
  p_organization_id uuid default null,
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
  with search as (
    select
      nullif(btrim(p_search), '') as raw,
      '%' || replace(replace(replace(nullif(btrim(p_search), ''), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pattern
  ),
  filtered as (
    select c.*
    from public.complaints c
    cross join search s
    where (p_organization_id is null or c.organization_id = p_organization_id)
      and (p_facility_id is null or c.facility_id = p_facility_id)
      and (p_status is null or c.status = p_status)
      and (p_exclude_status is null or c.status <> p_exclude_status)
      and (p_category is null or c.category = p_category)
      and (
        s.raw is null
        or c.complaint_number ilike s.pattern
        or c.category ilike s.pattern
        or coalesce(c.complainant_name, '') ilike s.pattern
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

-- The Survey Day roster is plpgsql and reads its search term twice (once to count/summarize, once
-- to page). Escaping once into v_pattern keeps both reads on the same literal-match semantics --
-- a count that disagreed with its own page would be worse than either alone, and Survey Day is
-- exactly when an operator cannot afford to doubt the number on the screen.
create or replace function public.get_survey_day_staff_roster(p_session_id uuid, p_search text default null, p_page integer default 1, p_page_size integer default 25)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_session public.survey_day_sessions%rowtype;
  v_facility uuid;
  v_limit integer := least(greatest(coalesce(p_page_size, 25), 1), 100);
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_pattern text := '%' || replace(replace(replace(nullif(btrim(coalesce(p_search, '')), ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  v_total integer;
  v_summary jsonb;
  v_rows jsonb;
begin
  select * into v_session from public.survey_day_sessions where id = p_session_id;
  if not found then raise exception 'Survey Day session not found or outside caller scope' using errcode = 'P0002'; end if;
  v_facility := v_session.facility_id;

  with base as (
    select
      e.id,
      e.first_name || ' ' || e.last_name as name,
      e.job_title,
      case when exists (
        select 1 from public.employee_training_records tr
        where tr.employee_id = e.id and tr.facility_id = v_facility and tr.status in ('expired', 'due_soon', 'missing')
      ) then 'attention' else 'ready' end as training_state,
      case when exists (
        select 1 from public.employee_credentials c
        where c.employee_id = e.id and c.facility_id = v_facility and c.status in ('expired', 'due_soon', 'missing')
      ) then 'attention' else 'ready' end as credential_state,
      case
        when exists (select 1 from public.employee_background_check_profiles b where b.employee_id = e.id and b.suitability_determination = 'not_suitable') then 'attention'
        when not exists (select 1 from public.employee_background_check_profiles b where b.employee_id = e.id and b.suitability_determination in ('suitable', 'suitable_with_conditions')) then 'unknown'
        else 'ready'
      end as background_state,
      case when exists (
        select 1 from public.exclusion_screening_matches m
        where m.employee_id = e.id and m.status in ('pending_review', 'confirmed_exclusion')
      ) then 'attention' else 'ready' end as exclusion_state
    from public.employees e
    where e.facility_id = v_facility
      and e.status = 'active'
      and (v_search is null or (e.first_name || ' ' || e.last_name || ' ' || coalesce(e.job_title, '')) ilike v_pattern)
  ),
  scored as (
    select b.*,
      case when 'attention' in (training_state, credential_state, exclusion_state) or background_state <> 'ready'
           then 'attention' else 'ready' end as overall_flag
    from base b
  )
  select
    count(*)::integer,
    jsonb_build_object(
      'total', count(*),
      'ready', count(*) filter (where overall_flag = 'ready'),
      'attention', count(*) filter (where overall_flag = 'attention')
    )
  into v_total, v_summary
  from scored;

  with base as (
    select
      e.id,
      e.first_name || ' ' || e.last_name as name,
      e.job_title,
      case when exists (
        select 1 from public.employee_training_records tr
        where tr.employee_id = e.id and tr.facility_id = v_facility and tr.status in ('expired', 'due_soon', 'missing')
      ) then 'attention' else 'ready' end as training_state,
      case when exists (
        select 1 from public.employee_credentials c
        where c.employee_id = e.id and c.facility_id = v_facility and c.status in ('expired', 'due_soon', 'missing')
      ) then 'attention' else 'ready' end as credential_state,
      case
        when exists (select 1 from public.employee_background_check_profiles b where b.employee_id = e.id and b.suitability_determination = 'not_suitable') then 'attention'
        when not exists (select 1 from public.employee_background_check_profiles b where b.employee_id = e.id and b.suitability_determination in ('suitable', 'suitable_with_conditions')) then 'unknown'
        else 'ready'
      end as background_state,
      case when exists (
        select 1 from public.exclusion_screening_matches m
        where m.employee_id = e.id and m.status in ('pending_review', 'confirmed_exclusion')
      ) then 'attention' else 'ready' end as exclusion_state
    from public.employees e
    where e.facility_id = v_facility
      and e.status = 'active'
      and (v_search is null or (e.first_name || ' ' || e.last_name || ' ' || coalesce(e.job_title, '')) ilike v_pattern)
  ),
  scored as (
    select b.*,
      case when 'attention' in (training_state, credential_state, exclusion_state) or background_state <> 'ready'
           then 'attention' else 'ready' end as overall_flag
    from base b
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'employeeId', id,
    'name', name,
    'jobTitle', job_title,
    'trainingState', training_state,
    'credentialState', credential_state,
    'backgroundState', background_state,
    'exclusionState', exclusion_state,
    'overallFlag', overall_flag,
    'route', '/app/employees/' || id
  ) order by name, id), '[]'::jsonb)
  into v_rows
  from (select * from scored order by name, id limit v_limit offset (v_page - 1) * v_limit) page;

  return jsonb_build_object('rows', v_rows, 'count', v_total, 'summary', v_summary, 'page', v_page, 'pageSize', v_limit);
end;
$$;

revoke all on function public.get_incident_list_summary(uuid, uuid, text, text, text, date) from public, anon;
grant execute on function public.get_incident_list_summary(uuid, uuid, text, text, text, date) to authenticated, service_role;
revoke all on function public.get_resident_list_summary(uuid, text, text, date) from public, anon;
grant execute on function public.get_resident_list_summary(uuid, text, text, date) to authenticated, service_role;
revoke all on function public.get_complaint_list_summary(uuid, uuid, text, text, text, text) from public, anon;
grant execute on function public.get_complaint_list_summary(uuid, uuid, text, text, text, text) to authenticated, service_role;
revoke all on function public.get_survey_day_staff_roster(uuid, text, integer, integer) from public, anon;
grant execute on function public.get_survey_day_staff_roster(uuid, text, integer, integer) to authenticated;
