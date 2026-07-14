-- Platform Usability and Trust: one RLS-scoped workspace search contract for the command palette.
-- SECURITY INVOKER keeps each table's existing RLS policies as the authorization boundary; this
-- function only normalizes labels, routes, statuses, and facility context so the browser does not
-- issue many independent broad queries or expose protected narratives/answer keys.
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
      select 'facilities', f.id, f.name, null, f.status, f.id, f.name,
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
      select 'residents', r.id, trim(r.first_name || ' ' || r.last_name), coalesce('Room ' || nullif(r.room_number,''), null), r.status, r.facility_id, f.name,
        case when v_role = 'platform_admin' then '/admin/residents/' else '/app/residents/' end || r.id::text, 4
      from public.residents r left join public.facilities f on f.id = r.facility_id
      where v_role in ('platform_admin','org_admin','facility_manager','auditor') and (r.first_name ilike v_like escape '\' or r.last_name ilike v_like escape '\' or r.room_number ilike v_like escape '\')
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

revoke all on function public.search_workspace(text) from public, anon;
grant execute on function public.search_workspace(text) to authenticated;

create index if not exists facilities_name_workspace_search_idx on public.facilities using gin (name extensions.gin_trgm_ops);
create index if not exists incidents_type_workspace_search_idx on public.incidents using gin (incident_type extensions.gin_trgm_ops);
create index if not exists complaints_number_workspace_search_idx on public.complaints using gin (complaint_number extensions.gin_trgm_ops);
create index if not exists dhs_violations_citation_workspace_search_idx on public.dhs_violations using gin (citation_ref extensions.gin_trgm_ops);
create index if not exists inspection_items_label_workspace_search_idx on public.inspection_items using gin (label extensions.gin_trgm_ops);
create index if not exists work_orders_number_workspace_search_idx on public.work_orders using gin (work_order_number extensions.gin_trgm_ops);
create index if not exists training_documents_file_workspace_search_idx on public.training_documents using gin (file_name extensions.gin_trgm_ops);
create index if not exists policy_documents_title_workspace_search_idx on public.policy_documents using gin (title extensions.gin_trgm_ops);
create index if not exists qapi_projects_title_workspace_search_idx on public.qapi_projects using gin (title extensions.gin_trgm_ops);
create index if not exists support_tickets_subject_workspace_search_idx on public.support_tickets using gin (subject extensions.gin_trgm_ops);
