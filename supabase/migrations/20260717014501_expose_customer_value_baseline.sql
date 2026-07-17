-- Complete the customer-value read contract so the Value Center editor can
-- hydrate the organization baseline instead of replacing it with UI defaults.
create or replace function public.get_customer_value_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.current_org_id();
  v_baseline public.customer_value_baselines%rowtype;
  v_reports integer;
  v_mock_inspections integer;
  v_courses integer;
  v_closed_work integer;
  v_portal_messages integer;
  v_minutes numeric := 0;
begin
  if not public.is_platform_admin() and (v_org is null or public.current_role() not in ('org_admin', 'facility_manager', 'auditor')) then
    raise exception 'Value dashboard access denied' using errcode = '42501';
  end if;

  if public.is_platform_admin() and v_org is null then
    return jsonb_build_object('configured', false, 'reason', 'Select an organization to view customer value.');
  end if;

  select * into v_baseline
  from public.customer_value_baselines
  where organization_id = v_org;

  select count(*) into v_reports
  from public.product_events
  where organization_id = v_org
    and event_name in ('report_exported', 'payroll_exported')
    and occurred_at >= now() - interval '30 days';

  select count(*) into v_mock_inspections
  from public.product_events
  where organization_id = v_org
    and event_name = 'mock_inspection_completed'
    and occurred_at >= now() - interval '30 days';

  select count(*) into v_courses
  from public.course_assignments
  where organization_id = v_org
    and completed_at >= now() - interval '30 days';

  select count(*) into v_closed_work
  from public.work_items
  where organization_id = v_org
    and closed_at >= now() - interval '30 days';

  select count(*) into v_portal_messages
  from public.resident_portal_messages
  where organization_id = v_org
    and created_at >= now() - interval '30 days';

  if v_baseline.id is not null then
    v_minutes :=
      v_reports * coalesce((v_baseline.time_saving_assumptions->>'report_export_minutes')::numeric, 0)
      + v_mock_inspections * coalesce((v_baseline.time_saving_assumptions->>'mock_inspection_minutes')::numeric, 0)
      + v_courses * coalesce((v_baseline.time_saving_assumptions->>'course_completion_admin_minutes')::numeric, 0)
      + v_closed_work * coalesce((v_baseline.time_saving_assumptions->>'closed_work_item_minutes')::numeric, 0)
      + v_portal_messages * coalesce((v_baseline.time_saving_assumptions->>'portal_message_minutes')::numeric, 0);
  end if;

  return jsonb_build_object(
    'configured', v_baseline.id is not null,
    'periodDays', 30,
    'activity', jsonb_build_object(
      'reportExports', v_reports,
      'mockInspections', v_mock_inspections,
      'courseCompletions', v_courses,
      'closedWorkItems', v_closed_work,
      'portalMessages', v_portal_messages
    ),
    'estimatedHoursSaved', round(v_minutes / 60.0, 1),
    'estimatedLaborValue', round((v_minutes / 60.0) * coalesce(v_baseline.hourly_admin_cost, 0), 2),
    'hourlyAdminCost', coalesce(v_baseline.hourly_admin_cost, 0),
    'retiredSoftwareMonthlyCost', coalesce(v_baseline.legacy_monthly_software_cost, 0),
    'retiredTools', coalesce(v_baseline.retired_tools, '[]'::jsonb),
    'assumptions', coalesce(v_baseline.time_saving_assumptions, '{}'::jsonb),
    'baselineUpdatedAt', v_baseline.updated_at,
    'method', 'Customer-entered time and cost assumptions multiplied by recorded CareBase outcomes.',
    'generatedAt', now()
  );
end;
$$;

revoke all on function public.get_customer_value_dashboard()
from public, anon, authenticated, service_role;

grant execute on function public.get_customer_value_dashboard()
to authenticated, service_role;
