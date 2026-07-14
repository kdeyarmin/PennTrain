-- Stable resident-centered read models. Each source table keeps its own RLS policy;
-- the security-invoker functions only compose rows the caller can already see.

create or replace function public.get_resident_timeline(
  p_resident_id uuid,
  p_limit integer default 100
)
returns table(
  occurred_at timestamptz,
  event_type text,
  title text,
  status text,
  detail text,
  href text,
  source_id uuid
)
language sql
stable
security invoker
set search_path = ''
as $function$
  select event.occurred_at, event.event_type, event.title, event.status,
    event.detail, event.href, event.source_id
  from (
    select i.occurred_at, 'incident'::text as event_type,
      'Incident: ' || replace(i.incident_type, '_', ' ') as title,
      i.status, left(i.narrative, 500) as detail,
      '/app/incidents/' || i.id::text as href, i.id as source_id
    from public.incidents i where i.resident_id = p_resident_id

    union all
    select c.identified_at, 'change_of_condition',
      'Condition change: ' || replace(c.category, '_', ' '), c.status,
      left(c.immediate_observations, 500), '/app/change-of-condition/' || c.id::text, c.id
    from public.resident_change_events c where c.resident_id = p_resident_id

    union all
    select coalesce(s.performed_at, s.scheduled_start), 'resident_service',
      'Service: ' || s.service_name, s.status, left(s.note, 500),
      '/app/services', s.id
    from public.resident_service_task_instances s where s.resident_id = p_resident_id

    union all
    select co.created_at, 'complaint', 'Complaint: ' || replace(co.category, '_', ' '),
      co.status, left(co.description, 500), '/app/complaints/' || co.id::text, co.id
    from public.complaints co where co.resident_id = p_resident_id

    union all
    select rc.updated_at, 'compliance', 'Compliance: ' || replace(rc.item_type, '_', ' '),
      rc.status, left(rc.notes, 500), '/app/residents/' || rc.resident_id::text, rc.id
    from public.resident_compliance_items rc where rc.resident_id = p_resident_id

    union all
    select d.occurred_at, 'dietary', 'Dietary: ' || replace(d.event_type, '_', ' '),
      null::text, left(d.summary, 500), '/app/dietary-operations?resident=' || d.resident_id::text, d.id
    from public.dietary_operations_history d where d.resident_id = p_resident_id

    union all
    select f.created_at, 'financial', 'Financial: ' || replace(f.event_type, '_', ' '),
      null::text, left(f.summary, 500), '/app/resident-finance?resident=' || f.resident_id::text, f.id
    from public.resident_financial_history f where f.resident_id = p_resident_id
  ) event
  order by event.occurred_at desc, event.source_id
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
$function$;

create or replace function public.get_resident_360_snapshot(p_resident_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_resident public.residents%rowtype;
  v_result jsonb;
begin
  select * into v_resident from public.residents where id = p_resident_id;
  if not found then raise exception 'Resident was not found or is outside caller scope' using errcode = 'P0002'; end if;

  select jsonb_build_object(
    'generatedAt', now(),
    'residentId', v_resident.id,
    'openRisks', jsonb_build_object(
      'incidents', (select count(*) from public.incidents i where i.resident_id = v_resident.id and i.status <> 'closed'),
      'conditionChanges', (select count(*) from public.resident_change_events c where c.resident_id = v_resident.id and c.status <> 'closed'),
      'complaints', (select count(*) from public.complaints c where c.resident_id = v_resident.id and c.status <> 'closed'),
      'complianceGaps', (select count(*) from public.resident_compliance_items c where c.resident_id = v_resident.id and c.status in ('missing','due_soon','expired'))
    ),
    'serviceDelivery', jsonb_build_object(
      'dueNext24Hours', (select count(*) from public.resident_service_task_instances s where s.resident_id = v_resident.id and s.status = 'scheduled' and s.scheduled_start between now() and now() + interval '24 hours'),
      'exceptionsLast7Days', (select count(*) from public.resident_service_task_instances s where s.resident_id = v_resident.id and s.status in ('resident_refused','resident_unavailable','not_completed','completed_late') and coalesce(s.performed_at, s.scheduled_start) >= now() - interval '7 days')
    ),
    'finance', jsonb_build_object(
      'balance', coalesce((select sum(case when t.entry_side = 'debit' then t.amount else -t.amount end) from public.resident_financial_transactions t where t.resident_id = v_resident.id), 0),
      'lastPostedAt', (select max(t.posted_at) from public.resident_financial_transactions t where t.resident_id = v_resident.id)
    ),
    'dietary', jsonb_build_object(
      'profileUpdatedAt', (select max(p.updated_at) from public.resident_dietary_profiles p where p.resident_id = v_resident.id),
      'openWeightMonitoring', (select count(*) from public.weight_monitoring_assignments w where w.resident_id = v_resident.id and w.active)
    )
  ) into v_result;
  return v_result;
end;
$function$;

revoke all on function public.get_resident_timeline(uuid,integer) from public, anon;
revoke all on function public.get_resident_360_snapshot(uuid) from public, anon;
grant execute on function public.get_resident_timeline(uuid,integer) to authenticated, service_role;
grant execute on function public.get_resident_360_snapshot(uuid) to authenticated, service_role;
