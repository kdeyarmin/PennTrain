-- E2/E5: server-backed list read models and live alert/notification delivery.
--
-- The views are security-invoker views so the underlying table RLS policies remain
-- the authorization boundary. They add only list-specific derived fields; writes
-- continue to target the base tables through the existing mutations/RPCs.

create or replace view public.alert_list_rows
with (security_invoker = true)
as
select
  a.*,
  case a.severity
    when 'critical' then 0
    when 'warning' then 1
    when 'info' then 2
    else 99
  end as severity_rank
from public.alerts a;

create or replace view public.incident_list_rows
with (security_invoker = true)
as
select
  i.*,
  btrim(
    coalesce(i.incident_type, '') || ' ' ||
    coalesce(i.location_detail, '') || ' ' ||
    coalesce(i.narrative, '') || ' ' ||
    coalesce(i.resident_identifier_snapshot, '') || ' ' ||
    coalesce(i.resident_identifier, '') || ' ' ||
    coalesce(r.first_name, '') || ' ' ||
    coalesce(r.last_name, '') || ' ' ||
    coalesce(r.last_name, '') || ' ' ||
    coalesce(r.first_name, '') || ' ' ||
    coalesce(r.room, '')
  ) as search_text
from public.incidents i
left join public.residents r on r.id = i.resident_id;

create or replace view public.resident_roster_rows
with (security_invoker = true)
as
select
  r.*,
  btrim(
    coalesce(r.first_name, '') || ' ' ||
    coalesce(r.last_name, '') || ' ' ||
    coalesce(r.last_name, '') || ' ' ||
    coalesce(r.first_name, '') || ' ' ||
    coalesce(r.room, '')
  ) as search_text,
  compliance.worst_status as compliance_worst_status,
  coalesce(compliance.open_count, 0)::bigint as compliance_open_count
from public.residents r
left join lateral (
  select
    (array_agg(
      item.status
      order by case item.status
        when 'expired' then 0
        when 'missing' then 1
        when 'due_soon' then 2
        when 'compliant' then 3
        when 'not_applicable' then 4
        else 99
      end
    ))[1] as worst_status,
    count(*) filter (
      where item.status in ('expired', 'missing', 'due_soon')
    ) as open_count
  from public.resident_compliance_items item
  where item.resident_id = r.id
) compliance on true;

revoke all on table
  public.alert_list_rows,
  public.incident_list_rows,
  public.resident_roster_rows
from public, anon;
grant select on table
  public.alert_list_rows,
  public.incident_list_rows,
  public.resident_roster_rows
to authenticated, service_role;

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
  with filtered as (
    select incident.*
    from public.incident_list_rows incident
    where (p_facility_id is null or incident.facility_id = p_facility_id)
      and (p_resident_id is null or incident.resident_id = p_resident_id)
      and (p_severity is null or incident.severity = p_severity)
      and (p_status is null or incident.status = p_status)
      and (
        nullif(btrim(p_search), '') is null
        or incident.search_text ilike '%' || btrim(p_search) || '%'
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
  with filtered as (
    select resident.*
    from public.resident_roster_rows resident
    where (p_facility_id is null or resident.facility_id = p_facility_id)
      and (p_status is null or resident.status = p_status)
      and (
        nullif(btrim(p_search), '') is null
        or resident.search_text ilike '%' || btrim(p_search) || '%'
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

revoke all on function public.get_incident_list_summary(uuid, uuid, text, text, text, date)
from public, anon;
revoke all on function public.get_resident_list_summary(uuid, text, text, date)
from public, anon;
grant execute on function public.get_incident_list_summary(uuid, uuid, text, text, text, date)
to authenticated, service_role;
grant execute on function public.get_resident_list_summary(uuid, text, text, date)
to authenticated, service_role;

-- PostgreSQL publications do not support ADD TABLE IF NOT EXISTS, so guard each
-- addition. Keeping the base tables in the publication lets the browser subscribe
-- with profile_id/organization_id filters while RLS still scopes delivered rows.
do $migration$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'alerts'
  ) then
    alter publication supabase_realtime add table public.alerts;
  end if;
end
$migration$;
