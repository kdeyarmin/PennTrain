-- Server-side pagination for the Operational Work Queue (E2). The queue's list sort is
-- overdue-first, then priority (urgent > high > normal > low), then due date -- an ordering that
-- depends on "now" and on an enum rank, so it cannot be expressed with PostgREST .order() and must
-- be computed in SQL for pagination to stay globally correct across pages. Two SECURITY INVOKER
-- functions back the page: get_work_item_queue returns one sorted page plus the total match count,
-- and get_work_item_list_summary returns the whole-scope metric tiles. Both run under the caller's
-- own RLS (mirrors get_incident_list_summary / get_complaint_list_summary), so every count and row
-- is already tenant- and facility-scoped by the existing work_items policies.

-- One sorted, filtered page of work items with the same facility/owner/template embeds the list
-- renders, returned as jsonb {count, rows} so the generated types stay a simple Returns: Json
-- (no bespoke row type to keep in sync). The overdue predicate and due-window bound both use the
-- caller-supplied p_now so the tiles and the list agree on a single "now".
create or replace function public.get_work_item_queue(
  p_organization_id uuid default null,
  p_facility_id uuid default null,
  p_owner_profile_id uuid default null,
  p_owner_id uuid default null,
  p_state text default null,
  p_active_only boolean default false,
  p_priority text default null,
  p_source_type text default null,
  p_search text default null,
  p_now timestamptz default now(),
  p_overdue_only boolean default false,
  p_due_before timestamptz default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  with filtered as (
    select w.*
    from public.work_items w
    where (p_organization_id is null or w.organization_id = p_organization_id)
      and (p_facility_id is null or w.facility_id = p_facility_id)
      and (p_owner_profile_id is null or w.owner_profile_id = p_owner_profile_id)
      and (p_owner_id is null or w.owner_profile_id = p_owner_id)
      and (p_state is null or w.state = p_state)
      and (not p_active_only or w.state not in ('closed', 'canceled'))
      and (p_priority is null or w.priority = p_priority)
      and (p_source_type is null or w.source_type = p_source_type)
      and (
        not p_overdue_only
        or (w.state not in ('closed', 'canceled') and w.due_at < p_now)
      )
      and (p_due_before is null or w.due_at <= p_due_before)
      and (
        nullif(btrim(p_search), '') is null
        or w.title ilike '%' || btrim(p_search) || '%'
        or coalesce(w.description, '') ilike '%' || btrim(p_search) || '%'
      )
  ),
  page as (
    select *
    from filtered
    order by
      (case when state not in ('closed', 'canceled') and due_at < p_now then 0 else 1 end),
      (case priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 when 'low' then 3 else 4 end),
      due_at asc,
      id asc
    limit greatest(coalesce(p_limit, 25), 0)
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'count', (select count(*) from filtered),
    'rows', coalesce(
      (
        select jsonb_agg(
          to_jsonb(p) || jsonb_build_object(
            'facility', (
              select jsonb_build_object('id', f.id, 'name', f.name)
              from public.facilities f where f.id = p.facility_id
            ),
            'owner', (
              select jsonb_build_object('id', pr.id, 'first_name', pr.first_name, 'last_name', pr.last_name)
              from public.profiles pr where pr.id = p.owner_profile_id
            ),
            'template', (
              select jsonb_build_object(
                'id', t.id, 'name', t.name,
                'approval_required', t.approval_required,
                'required_evidence_types', t.required_evidence_types
              )
              from public.work_item_templates t where t.id = p.template_id
            )
          )
          order by
            (case when p.state not in ('closed', 'canceled') and p.due_at < p_now then 0 else 1 end),
            (case p.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 when 'low' then 3 else 4 end),
            p.due_at asc,
            p.id asc
        )
        from page p
      ),
      '[]'::jsonb
    )
  );
$function$;
revoke all on function public.get_work_item_queue(uuid, uuid, uuid, uuid, text, boolean, text, text, text, timestamptz, boolean, timestamptz, integer, integer) from public, anon;
grant execute on function public.get_work_item_queue(uuid, uuid, uuid, uuid, text, boolean, text, text, text, timestamptz, boolean, timestamptz, integer, integer) to authenticated, service_role;

-- Whole-scope metric tiles for the queue (Open / Overdue / Blocked / Pending approval). These
-- measure the current scope (org + facility + owner) plus the priority/source/search filters, but
-- deliberately not the state or due-window selection -- the tiles are *about* states, so filtering
-- their denominator by a chosen state would make them meaningless. This is the whole-dataset
-- behavior the E2 summary-card pattern is for.
create or replace function public.get_work_item_list_summary(
  p_organization_id uuid default null,
  p_facility_id uuid default null,
  p_owner_profile_id uuid default null,
  p_owner_id uuid default null,
  p_priority text default null,
  p_source_type text default null,
  p_search text default null,
  p_now timestamptz default now()
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  with filtered as (
    select w.*
    from public.work_items w
    where (p_organization_id is null or w.organization_id = p_organization_id)
      and (p_facility_id is null or w.facility_id = p_facility_id)
      and (p_owner_profile_id is null or w.owner_profile_id = p_owner_profile_id)
      and (p_owner_id is null or w.owner_profile_id = p_owner_id)
      and (p_priority is null or w.priority = p_priority)
      and (p_source_type is null or w.source_type = p_source_type)
      and (
        nullif(btrim(p_search), '') is null
        or w.title ilike '%' || btrim(p_search) || '%'
        or coalesce(w.description, '') ilike '%' || btrim(p_search) || '%'
      )
  )
  select jsonb_build_object(
    'total', count(*),
    'open', count(*) filter (where state not in ('closed', 'canceled')),
    'overdue', count(*) filter (where state not in ('closed', 'canceled') and due_at < p_now),
    'blocked', count(*) filter (where state = 'blocked'),
    'pendingApproval', count(*) filter (where state = 'pending_approval')
  )
  from filtered;
$function$;
revoke all on function public.get_work_item_list_summary(uuid, uuid, uuid, uuid, text, text, text, timestamptz) from public, anon;
grant execute on function public.get_work_item_list_summary(uuid, uuid, uuid, uuid, text, text, text, timestamptz) to authenticated, service_role;
