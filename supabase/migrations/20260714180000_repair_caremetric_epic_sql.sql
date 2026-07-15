-- Forward-only repairs for objects introduced by the CareMetric operations epic.
-- The original migrations may already be applied, so fixes belong in a new migration.

revoke all on public.workforce_time_off_requests, public.shift_report_entries,
  public.shift_report_acknowledgements, public.notification_escalation_rules
  from public, anon, authenticated, service_role;
grant all on public.workforce_time_off_requests, public.shift_report_entries,
  public.shift_report_acknowledgements, public.notification_escalation_rules
  to service_role;
grant select on public.workforce_time_off_requests, public.shift_report_entries,
  public.shift_report_acknowledgements, public.notification_escalation_rules
  to authenticated;

create or replace function public.search_workspace(p_query text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_query text := trim(coalesce(p_query, ''));
  v_like text;
  v_role text;
  v_result jsonb;
begin
  if length(v_query) < 2 or length(v_query) > 100 then
    raise exception 'Search query must contain between 2 and 100 characters';
  end if;
  v_like := '%' || replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  v_role := public.current_role();

  with normalized as (
    select * from (
      select 'organizations'::text kind, o.id, o.name label, null::text subtitle, null::text status, null::uuid facility_id, null::text facility_name, '/admin/organizations/' || o.id::text route, 1 rank
      from public.organizations o where v_role = 'platform_admin' and o.name ilike v_like escape '\' limit 6
    ) s
    union all
    select * from (
      select 'facilities', f.id, f.name, null, case when f.is_active then 'active' else 'inactive' end, f.id, f.name,
        case when v_role = 'platform_admin' then '/admin/facilities/' else case when v_role = 'trainer' then '/trainer/facilities/' else '/app/facilities/' end end || f.id::text, 2
      from public.facilities f where f.name ilike v_like escape '\' or f.address ilike v_like escape '\' order by f.name limit 6
    ) s
    union all
    select * from (
      select 'employees', e.id, trim(e.first_name || ' ' || e.last_name), e.job_title, e.status, e.facility_id, f.name,
        case when v_role = 'platform_admin' then '/admin/employees/' else case when v_role = 'trainer' then '/trainer/employees/' else '/app/employees/' end end || e.id::text, 3
      from public.employees e left join public.facilities f on f.id = e.facility_id
      where v_role <> 'employee' and (e.first_name ilike v_like escape '\' or e.last_name ilike v_like escape '\' or e.email ilike v_like escape '\' or e.employee_number ilike v_like escape '\')
      order by e.last_name, e.first_name limit 8
    ) s
    union all
    select * from (
      select 'residents', r.id, trim(r.first_name || ' ' || r.last_name), coalesce('Room ' || nullif(r.room,''), null), r.status, r.facility_id, f.name,
        case when v_role = 'platform_admin' then '/admin/residents/' else '/app/residents/' end || r.id::text, 4
      from public.residents r left join public.facilities f on f.id = r.facility_id
      where v_role in ('platform_admin','org_admin','facility_manager','auditor') and (r.first_name ilike v_like escape '\' or r.last_name ilike v_like escape '\' or r.room ilike v_like escape '\')
      order by r.last_name, r.first_name limit 8
    ) s
    union all
    select * from (
      select 'incidents', i.id, initcap(replace(i.incident_type,'_',' ')), i.location_detail, i.status, i.facility_id, f.name,
        case when v_role = 'platform_admin' then '/admin/incidents/' else '/app/incidents/' end || i.id::text, 5
      from public.incidents i left join public.facilities f on f.id = i.facility_id
      where i.incident_type ilike v_like escape '\' or i.location_detail ilike v_like escape '\' or i.resident_identifier ilike v_like escape '\'
      order by i.occurred_at desc limit 6
    ) s
    union all
    select * from (
      select 'complaints', c.id, 'Complaint ' || c.complaint_number, initcap(replace(c.category,'_',' ')), c.status, c.facility_id, f.name,
        case when v_role = 'platform_admin' then '/admin/complaints/' else '/app/complaints/' end || c.id::text, 6
      from public.complaints c left join public.facilities f on f.id = c.facility_id
      where c.complaint_number ilike v_like escape '\' or c.category ilike v_like escape '\' or c.complainant_name ilike v_like escape '\'
      order by c.date_received desc limit 6
    ) s
    union all
    select * from (
      select 'violations', v.id, coalesce(v.citation_ref, 'DHS violation'), initcap(replace(v.severity,'_',' ')), v.status, v.facility_id, f.name,
        case when v_role = 'platform_admin' then '/admin/violations/' else '/app/violations/' end || v.id::text, 7
      from public.dhs_violations v left join public.facilities f on f.id = v.facility_id
      where v.citation_ref ilike v_like escape '\' or v.description ilike v_like escape '\'
      order by v.inspection_date desc limit 6
    ) s
    union all
    select * from (
      select 'inspection_items', ii.id, ii.label, ii.location_detail, ii.status, ii.facility_id, f.name,
        case when v_role = 'platform_admin' then '/admin/inspections/' else '/app/inspections/' end || ii.id::text, 8
      from public.inspection_items ii left join public.facilities f on f.id = ii.facility_id
      where ii.label ilike v_like escape '\' or ii.location_detail ilike v_like escape '\' or ii.serial_number ilike v_like escape '\'
      order by ii.next_due_date nulls last limit 6
    ) s
    union all
    select * from (
      select 'work_orders', w.id, w.work_order_number, w.location_detail, w.status, w.facility_id, f.name,
        case when v_role = 'platform_admin' then '/admin/work-orders/' else '/app/work-orders/' end || w.id::text, 9
      from public.work_orders w left join public.facilities f on f.id = w.facility_id
      where w.work_order_number ilike v_like escape '\' or w.problem_description ilike v_like escape '\' or w.location_detail ilike v_like escape '\'
      order by w.created_at desc limit 6
    ) s
    union all
    select * from (
      select 'documents', d.id, d.file_name, d.document_type, null::text, e.facility_id, f.name,
        '/app/documents', 10
      from public.training_documents d left join public.employees e on e.id = d.employee_id left join public.facilities f on f.id = e.facility_id
      where d.file_name ilike v_like escape '\' or d.document_type ilike v_like escape '\'
      order by d.created_at desc limit 6
    ) s
    union all
    select * from (
      select 'courses', c.id, c.title, c.category, c.status, null::uuid, null::text,
        case when v_role = 'platform_admin' then '/admin/courses/' else '/app/courses/' end || c.id::text, 11
      from public.courses c where v_role <> 'employee' and (c.title ilike v_like escape '\' or c.description ilike v_like escape '\') order by c.title limit 6
    ) s
    union all
    select * from (
      select 'my_training', ca.id, c.title, ca.status, ca.status, null::uuid, null::text, '/me/courses/' || ca.id::text, 12
      from public.course_assignments ca join public.courses c on c.id = ca.course_id
      where v_role = 'employee' and c.title ilike v_like escape '\' order by c.title limit 6
    ) s
    union all
    select * from (
      select 'certificates', cert.id, c.title || ' certificate', cert.credential_number, cert.pdf_status, e.facility_id, f.name,
        '/me/certificates', 13
      from public.certificates cert join public.courses c on c.id = cert.course_id left join public.employees e on e.id = cert.employee_id left join public.facilities f on f.id = e.facility_id
      where c.title ilike v_like escape '\' or cert.credential_number ilike v_like escape '\' order by cert.issued_at desc limit 6
    ) s
    union all
    select * from (
      select 'policies', p.id, p.title, p.category, null::text, null::uuid, null::text, '/app/policies', 14
      from public.policy_documents p where p.title ilike v_like escape '\' or p.description ilike v_like escape '\' order by p.title limit 6
    ) s
    union all
    select * from (
      select 'qapi_projects', q.id, q.title, q.project_number, q.status, q.facility_id, f.name, '/app/qapi/projects/' || q.id::text, 15
      from public.qapi_projects q left join public.facilities f on f.id = q.facility_id
      where q.title ilike v_like escape '\' or q.project_number ilike v_like escape '\' order by q.target_completion_date limit 6
    ) s
    union all
    select * from (
      select 'support_tickets', st.id, st.subject, initcap(replace(st.category,'_',' ')), st.status, null::uuid, null::text,
        case when v_role = 'platform_admin' then '/admin/support-tickets/' else '/app/help/tickets/' end || st.id::text, 16
      from public.support_tickets st where st.subject ilike v_like escape '\' order by st.last_message_at desc limit 6
    ) s
  )
  select jsonb_build_object(
    'items', coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'id', id, 'label', label, 'subtitle', subtitle, 'status', status, 'facilityId', facility_id, 'facilityName', facility_name, 'route', route) order by rank, label), '[]'::jsonb),
    'organizations', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', label)) from normalized where kind='organizations'), '[]'::jsonb),
    'profiles', '[]'::jsonb,
    'employees', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'first_name', split_part(label,' ',1), 'last_name', regexp_replace(label, '^\S+\s*', ''), 'organization_id', null)) from normalized where kind='employees'), '[]'::jsonb),
    'residents', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'first_name', split_part(label,' ',1), 'last_name', regexp_replace(label, '^\S+\s*', ''), 'facility_id', facility_id)) from normalized where kind='residents'), '[]'::jsonb),
    'courses', coalesce((select jsonb_agg(jsonb_build_object('assignmentId', id, 'title', label)) from normalized where kind='my_training'), '[]'::jsonb)
  ) into v_result from normalized;

  return coalesce(v_result, jsonb_build_object('items','[]'::jsonb,'organizations','[]'::jsonb,'profiles','[]'::jsonb,'employees','[]'::jsonb,'residents','[]'::jsonb,'courses','[]'::jsonb));
end;
$$;

create or replace function public.get_resident_care_delivery_analytics(p_facility_id uuid, p_from date, p_through date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_fac public.facilities%rowtype;
begin
  select * into v_fac from public.facilities where id=p_facility_id;
  if not found then raise exception 'Facility not found' using errcode='P0002'; end if;
  if not (coalesce(auth.jwt()->>'role','')='service_role' or public.is_platform_admin() or (public.current_org_id()=v_fac.organization_id and (public.current_role() in ('org_admin','auditor') or public.is_assigned_to_facility(v_fac.id)))) then raise exception 'Analytics outside caller scope' using errcode='42501'; end if;
  return jsonb_build_object(
    'scope', jsonb_build_object('organizationId',v_fac.organization_id,'facilityId',v_fac.id,'from',p_from,'through',p_through,'dateBasis','scheduled_start / event timestamps'),
    'serviceCompletion', jsonb_build_object('numerator',(select count(*) from public.resident_service_task_instances t where t.facility_id=v_fac.id and t.scheduled_start::date between p_from and p_through and t.status in ('completed','completed_late','completed_by_other')),'denominator',(select count(*) from public.resident_service_task_instances t where t.facility_id=v_fac.id and t.scheduled_start::date between p_from and p_through and t.status <> 'superseded'),'definition','Completed service tasks divided by non-superseded scheduled service tasks.'),
    'serviceExceptions', jsonb_build_object('count',(select count(*) from public.resident_service_task_instances t where t.facility_id=v_fac.id and t.scheduled_start::date between p_from and p_through and t.status in ('resident_refused','resident_unavailable','not_completed','completed_late')),'definition','Service tasks recorded with exception statuses.'),
    'repeatedRefusals', jsonb_build_object('count',(select count(*) from (select resident_id, service_name from public.resident_service_task_instances t where t.facility_id=v_fac.id and t.scheduled_start::date between p_from and p_through and t.status='resident_refused' group by resident_id, service_name having count(*) >= 2) s),'definition','Resident/service pairs with two or more refusals in the reporting period.'),
    'changeOfConditionFrequency', jsonb_build_object('count',(select count(*) from public.resident_change_events c where c.facility_id=v_fac.id and c.identified_at::date between p_from and p_through),'definition','Change-of-condition events identified in the reporting period.'),
    'planReviewTimeliness', jsonb_build_object('overdue',(select count(*) from public.resident_support_plans p where p.facility_id=v_fac.id and p.state='effective' and p.review_due_date < current_date),'definition','Effective support plans with review due dates before today.'),
    'dmeInspectionStatus', jsonb_build_object('due',(select count(*) from public.resident_dme_items d where d.facility_id=v_fac.id and d.status in ('in_use','needs_repair') and d.inspection_frequency_days is not null and not exists (select 1 from public.resident_dme_history h where h.dme_item_id=d.id and h.event_type='inspected' and h.occurred_at >= now() - (d.inspection_frequency_days || ' days')::interval)),'definition','In-use DME items without an inspection recorded inside their configured frequency window.'),
    'hospitalReturnsOpenFollowUp', jsonb_build_object('count',(select count(*) from public.hospital_transfer_episodes h left join public.work_items w on w.id=h.return_work_item_id where h.facility_id=v_fac.id and h.return_time::date between p_from and p_through and h.status='returned' and coalesce(w.state,'open') <> 'closed'),'definition','Returned transfer episodes whose generated follow-up work is not closed.')
  );
end $$;

create or replace function public.get_enterprise_operations_control_plane(p_organization_id uuid default null, p_facility_id uuid default null, p_period_start date default (current_date - 30), p_period_end date default current_date)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid := coalesce(p_organization_id, public.current_org_id());
  v_role text := public.current_role();
  v_facilities integer := 0;
  v_metrics jsonb;
begin
  if v_org is null and not public.is_platform_admin() then
    raise exception 'Organization scope is required' using errcode='42501';
  end if;
  if not public.is_platform_admin() and (v_org is distinct from public.current_org_id() or v_role not in ('org_admin','facility_manager','auditor')) then
    raise exception 'Not authorized for enterprise operations summary' using errcode='42501';
  end if;
  if p_facility_id is not null and not (public.is_platform_admin() or public.is_assigned_to_facility(p_facility_id)) then
    raise exception 'Not authorized for facility summary' using errcode='42501';
  end if;

  select count(*) into v_facilities from public.facilities f where (v_org is null or f.organization_id = v_org) and (p_facility_id is null or f.id = p_facility_id);

  v_metrics := jsonb_build_object(
    'census', jsonb_build_object('value', coalesce((select count(*) from public.residents r where (v_org is null or r.organization_id = v_org) and (p_facility_id is null or r.facility_id = p_facility_id) and coalesce(r.status,'active') = 'active'),0), 'denominator', null, 'dateBasis', 'current status', 'includedStatuses', jsonb_build_array('active'), 'source', '/app/residents'),
    'trainingCompliance', jsonb_build_object('value', coalesce((select count(*) from public.employee_training_records etr join public.employees e on e.id = etr.employee_id where (v_org is null or e.organization_id = v_org) and (p_facility_id is null or e.facility_id = p_facility_id) and etr.status = 'compliant'),0), 'denominator', greatest(coalesce((select count(*) from public.employee_training_records etr join public.employees e on e.id = etr.employee_id where (v_org is null or e.organization_id = v_org) and (p_facility_id is null or e.facility_id = p_facility_id)),0),1), 'dateBasis', 'training record due/completed date', 'source', '/app/training-matrix'),
    'openIncidents', jsonb_build_object('value', coalesce((select count(*) from public.incidents i where (v_org is null or i.organization_id = v_org) and (p_facility_id is null or i.facility_id = p_facility_id) and coalesce(i.status,'open') not in ('closed','resolved')),0), 'denominator', null, 'dateBasis', 'incident created date', 'excludedStatuses', jsonb_build_array('closed','resolved'), 'source', '/app/incidents'),
    'openComplaints', jsonb_build_object('value', coalesce((select count(*) from public.complaints c where (v_org is null or c.organization_id = v_org) and (p_facility_id is null or c.facility_id = p_facility_id) and coalesce(c.status,'open') not in ('closed','resolved')),0), 'denominator', null, 'dateBasis', 'complaint received/created date', 'source', '/app/complaints'),
    'maintenanceRisk', jsonb_build_object('value', coalesce((select count(*) from public.work_orders w where (v_org is null or w.organization_id = v_org) and (p_facility_id is null or w.facility_id = p_facility_id) and coalesce(w.status,'open') not in ('verified','canceled')),0), 'denominator', null, 'dateBasis', 'work order due/created date', 'source', '/app/maintenance'),
    'notificationFailures', jsonb_build_object('value', coalesce((select count(*) from public.notification_deliveries nd where (v_org is null or nd.organization_id = v_org) and coalesce(nd.status,'') = 'failed'),0), 'denominator', null, 'dateBasis', 'last delivery attempt', 'source', '/admin/notifications')
  );

  return jsonb_build_object(
    'organizationId', v_org,
    'facilityId', p_facility_id,
    'facilityScope', case when p_facility_id is null then 'organization' else 'facility' end,
    'period', jsonb_build_object('start', p_period_start, 'end', p_period_end),
    'dataFreshness', now(),
    'facilityCount', v_facilities,
    'metricDefinitions', jsonb_build_array(
      jsonb_build_object('key','census','numerator','Active residents','denominator','Not percentage based','dateBasis','Current resident status','source','residents'),
      jsonb_build_object('key','trainingCompliance','numerator','Completed training records','denominator','All scoped training records; denominator is never allowed below 1','dateBasis','Training due/completion dates','source','employee_training_records'),
      jsonb_build_object('key','openIncidents','numerator','Incidents not closed/resolved','denominator','Not percentage based','dateBasis','Incident created date','source','incidents'),
      jsonb_build_object('key','notificationFailures','numerator','Failed/dead-letter deliveries','denominator','Not percentage based','dateBasis','Last delivery attempt','source','notification_deliveries')
    ),
    'metrics', v_metrics,
    'recentSnapshots', coalesce((select jsonb_agg(to_jsonb(s) order by s.as_of desc) from (select id, facility_id, period_start, period_end, as_of, checksum from public.enterprise_analytics_snapshots where (v_org is null or organization_id = v_org) and (p_facility_id is null or facility_id = p_facility_id) order by as_of desc limit 10) s), '[]'::jsonb),
    'integrationRecovery', coalesce((select jsonb_agg(to_jsonb(j) order by j.created_at desc) from (select id, provider_key, direction, object_type, status, attempt_count, retry_limit, last_attempt_at, last_success_at, source_count, accepted_count, rejected_count, validation_error_count, mapping_error_count, dead_letter_reason, created_at from public.enterprise_integration_jobs where (v_org is null or organization_id = v_org) and status in ('failed','partial','dead_letter','running') order by created_at desc limit 20) j), '[]'::jsonb),
    'importRecovery', coalesce((select jsonb_agg(to_jsonb(b) order by b.created_at desc) from (select id, import_type, status, total_rows, valid_rows, duplicate_rows, unmapped_rows, failed_rows, applied_rows, created_at from public.enterprise_import_batches where (v_org is null or organization_id = v_org) and status in ('preview','validated','running','partial','failed') order by created_at desc limit 20) b), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.search_workspace(text),
  public.get_resident_care_delivery_analytics(uuid,date,date),
  public.get_enterprise_operations_control_plane(uuid,uuid,date,date)
  from public, anon;
grant execute on function public.search_workspace(text),
  public.get_resident_care_delivery_analytics(uuid,date,date),
  public.get_enterprise_operations_control_plane(uuid,uuid,date,date)
  to authenticated;
