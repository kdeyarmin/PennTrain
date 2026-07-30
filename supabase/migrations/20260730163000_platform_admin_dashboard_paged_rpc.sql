-- Replace AdminDashboard's unbounded table reads with bounded RPC payloads.
-- Keep this platform-admin-only and additive to existing dashboard RPCs.

create or replace function public.get_platform_admin_dashboard_page(
  p_limit integer default 5,
  p_offset integer default 0,
  p_organizations_limit integer default 20,
  p_organizations_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (timezone('America/New_York', now()))::date;
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform_admin may view platform admin dashboard data'
      using errcode = '42501';
  end if;

  return jsonb_build_object(
    'openSupportTickets', (
      select count(*)
      from public.support_tickets
      where status = 'open'
    ),
    'missingOrgContacts', (
      select count(*)
      from public.organizations
      where contact_email is null
        or btrim(contact_email) = ''
        or contact_name is null
        or btrim(contact_name) = ''
    ),
    'facilitiesMissingLicense', (
      select count(*)
      from public.facilities
      where license_number is null or btrim(license_number) = ''
    ),
    'facilitiesMissingAddress', (
      select count(*)
      from public.facilities
      where address is null
        or btrim(address) = ''
        or city is null
        or btrim(city) = ''
        or state is null
        or btrim(state) = ''
        or zip is null
        or btrim(zip) = ''
    ),
    'organizationsWithoutAdmin', (
      select count(*)
      from public.organizations o
      where not exists (
        select 1
        from public.profiles p
        where p.organization_id = o.id
          and p.role = 'org_admin'
          and p.is_active
      )
    ),
    'trainingPlansCount', (
      select count(*)
      from public.training_plans
    ),
    'atRiskOrganizations', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', o.id,
          'name', o.name,
          'plan_name', o.plan_name,
          'subscription_status', o.subscription_status
        )
      )
      from (
        select id, name, plan_name, subscription_status
        from public.organizations
        where subscription_status in ('past_due', 'suspended', 'trial')
        order by
          case subscription_status
            when 'suspended' then 0
            when 'past_due' then 1
            when 'trial' then 2
            else 3
          end,
          name
        limit greatest(1, p_limit)
        offset greatest(0, p_offset)
      ) as o
    ), '[]'::jsonb),
    'organizationsPage', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', o.id,
          'name', o.name,
          'plan_name', o.plan_name,
          'subscription_status', o.subscription_status
        )
      )
      from (
        select id, name, plan_name, subscription_status
        from public.organizations
        order by name
        limit greatest(1, p_organizations_limit)
        offset greatest(0, p_organizations_offset)
      ) as o
    ), '[]'::jsonb),
    'tenantHealthScores', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', row_data.id,
          'name', row_data.name,
          'score', row_data.score,
          'facilityCount', row_data.facility_count,
          'employeeCount', row_data.employee_count,
          'adminCount', row_data.admin_count
        )
      )
      from (
        select
          o.id,
          o.name,
          fc.facility_count,
          ec.employee_count,
          ac.admin_count,
          greatest(
            0,
            100
            - (case when o.subscription_status = 'past_due' then 25 else 0 end)
            - (case when o.subscription_status = 'suspended' then 45 else 0 end)
            - (case when o.subscription_status = 'trial' then 5 else 0 end)
            - (case when fc.facility_count = 0 then 20 else 0 end)
            - (case when ec.employee_count = 0 then 15 else 0 end)
            - (case when ac.admin_count = 0 then 20 else 0 end)
            - (case when o.contact_email is null or btrim(o.contact_email) = '' then 10 else 0 end)
          )::int as score
        from public.organizations o
        left join lateral (
          select count(*)::int as facility_count
          from public.facilities f
          where f.organization_id = o.id
        ) as fc on true
        left join lateral (
          select count(*)::int as employee_count
          from public.employees e
          where e.organization_id = o.id and e.status = 'active'
        ) as ec on true
        left join lateral (
          select count(*)::int as admin_count
          from public.profiles p
          where p.organization_id = o.id and p.role = 'org_admin' and p.is_active
        ) as ac on true
        order by score asc, o.name asc
        limit greatest(1, p_limit)
        offset greatest(0, p_offset)
      ) as row_data
    ), '[]'::jsonb),
    'inspectionReadinessScores', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', row_data.id,
          'name', row_data.name,
          'score', row_data.score,
          'outstandingItems', row_data.outstanding_items,
          'facilityIncidents', row_data.facility_incidents,
          'facilityViolations', row_data.facility_violations,
          'facilityOverdueActions', row_data.facility_overdue_actions
        )
      )
      from (
        select
          f.id,
          f.name,
          oi.outstanding_items,
          inc.facility_incidents,
          vio.facility_violations,
          capa.facility_overdue_actions,
          greatest(
            0,
            100
            - (oi.outstanding_items * 10)
            - (inc.facility_incidents * 8)
            - (vio.facility_violations * 15)
            - (capa.facility_overdue_actions * 12)
          )::int as score
        from public.facilities f
        left join lateral (
          select count(*)::int as outstanding_items
          from public.inspection_items i
          where i.facility_id = f.id
            and i.is_active
            and coalesce(i.status, '') in ('expired', 'due_soon', 'missing')
        ) as oi on true
        left join lateral (
          select count(*)::int as facility_incidents
          from public.incidents i
          where i.facility_id = f.id
            and i.status is distinct from 'closed'
        ) as inc on true
        left join lateral (
          select count(*)::int as facility_violations
          from public.dhs_violations v
          where v.facility_id = f.id
            and v.status is distinct from 'verified'
        ) as vio on true
        left join lateral (
          select count(*)::int as facility_overdue_actions
          from public.corrective_actions a
          where a.facility_id = f.id
            and a.status is distinct from 'completed'
            and a.status is distinct from 'cancelled'
            and a.due_date is not null
            and a.due_date < v_today
        ) as capa on true
        order by score asc, f.name asc
        limit greatest(1, p_limit)
        offset greatest(0, p_offset)
      ) as row_data
    ), '[]'::jsonb),
    'complianceTimelineItems', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', item_id,
          'label', label,
          'date', item_date,
          'href', href,
          'status', status,
          'icon', icon
        )
      )
      from (
        select *
        from (
          select
            ('incident-' || i.id)::text as item_id,
            (case when i.incident_type is not null and btrim(i.incident_type) <> ''
              then 'Incident: ' || i.incident_type
              else 'Incident opened'
            end)::text as label,
            coalesce(i.occurred_at, i.created_at) as item_date,
            ('/admin/incidents/' || i.id)::text as href,
            coalesce(i.status, 'open')::text as status,
            'incident'::text as icon
          from public.incidents i
          union all
          select
            ('violation-' || v.id)::text as item_id,
            (case when v.citation_ref is not null and btrim(v.citation_ref) <> ''
              then 'Violation: ' || v.citation_ref
              else 'Violation / POC'
            end)::text as label,
            coalesce(v.inspection_date::timestamptz, v.created_at) as item_date,
            coalesce('/admin/facilities/' || v.facility_id, '/admin/alerts')::text as href,
            coalesce(v.status, 'open')::text as status,
            'violation'::text as icon
          from public.dhs_violations v
          union all
          select
            ('alert-' || a.id)::text as item_id,
            coalesce(a.title, 'Alert')::text as label,
            a.created_at as item_date,
            '/admin/alerts'::text as href,
            coalesce(a.severity, 'open')::text as status,
            'alert'::text as icon
          from public.alerts a
          union all
          select
            ('action-' || c.id)::text as item_id,
            coalesce(c.description, 'Corrective action')::text as label,
            coalesce(c.due_date::timestamptz, c.created_at) as item_date,
            coalesce('/admin/facilities/' || c.facility_id, '/admin/alerts')::text as href,
            coalesce(c.status, 'open')::text as status,
            'corrective_action'::text as icon
          from public.corrective_actions c
        ) as combined
        order by item_date desc nulls last
        limit greatest(1, p_limit)
        offset greatest(0, p_offset)
      ) as rows
    ), '[]'::jsonb),
    'coursesNeedingAttention', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'courseId', row_data.course_id,
          'title', row_data.title,
          'count', row_data.assignment_count
        )
      )
      from (
        select
          ca.course_id,
          coalesce(c.title, 'Untitled course') as title,
          count(*)::int as assignment_count
        from public.course_assignments ca
        left join public.courses c on c.id = ca.course_id
        where ca.status is distinct from 'completed'
        group by ca.course_id, c.title
        order by assignment_count desc, title asc
        limit greatest(1, p_limit)
        offset greatest(0, p_offset)
      ) as row_data
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_platform_admin_dashboard_page(integer, integer, integer, integer)
  from public, anon;
grant execute on function public.get_platform_admin_dashboard_page(integer, integer, integer, integer)
  to authenticated;
