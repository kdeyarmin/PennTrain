-- One enrollment is one assignment, including annual repeat enrollments. All joins retain
-- caller RLS; selecting an organization is a filter, never an impersonation mechanism.
create function public.get_training_enrollment_report(
  p_organization_id uuid,
  p_facility_id uuid default null,
  p_course_search text default '',
  p_status text default 'all',
  p_date_basis text default 'assigned',
  p_date_from date default null,
  p_date_through date default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null or not public.current_session_unlocked()
    or not coalesce(public.current_role() in ('platform_admin','org_admin','facility_manager','trainer','auditor'),false) then
    raise exception 'Training reporting access required' using errcode='42501';
  end if;
  -- Full staff exports use the same assurance policy as the training evidence workspace.
  -- Trainers/auditors retain their configured policy; privileged sessions must still be fresh.
  perform public.assert_identity_assurance('compliance_profile_admin');
  if p_organization_id is null or (not public.is_platform_admin() and p_organization_id is distinct from public.current_org_id())
    or not exists(select 1 from public.organizations where id=p_organization_id) then
    raise exception 'Organization is outside your access' using errcode='42501';
  end if;
  if not public.is_platform_admin() and not exists(select 1 from public.get_effective_entitlements()
    where feature_key in ('modules.train','modules.carebase') and is_entitled) then
    raise exception 'Training reporting access required' using errcode='42501';
  end if;
  if p_facility_id is not null and not exists(select 1 from public.facilities
    where id=p_facility_id and organization_id=p_organization_id) then
    raise exception 'Facility is outside your access' using errcode='42501';
  end if;
  if p_status is null or p_status not in ('all','assigned','in_progress','completed','overdue','paused','canceled')
    or p_date_basis is null or p_date_basis not in ('assigned','completed','certificate')
    or p_limit is null or (p_limit not between 1 and 500 and p_limit <> 10000)
    or p_offset is null or p_offset < 0 or (p_limit=10000 and p_offset<>0)
    or length(coalesce(p_course_search,'')) > 200
    or (p_date_from is not null and p_date_through is not null and p_date_from > p_date_through) then
    raise exception 'Invalid training report filters' using errcode='22023';
  end if;

  with enrollment as materialized (
    select a.id, a.employee_id,
      coalesce(nullif(btrim(concat_ws(' ',e.first_name,e.last_name)),''),'Student record '||a.employee_id::text) as student,
      a.facility_id, f.name as facility, a.course_id, coalesce(cv.title,c.title,'Course unavailable') as course,
      a.status, a.assigned_at, a.due_date, a.completed_at,
      case when a.status='completed' then 100 else coalesce(cp.percent_complete,0) end as percent_complete,
      cert.id as certificate_id, cert.credential_number, cert.issued_at as certificate_issued_at,
      cert.pdf_status as certificate_pdf_status,
      case p_date_basis when 'completed' then (a.completed_at at time zone 'America/New_York')::date
        when 'certificate' then (cert.issued_at at time zone 'America/New_York')::date
        else (a.assigned_at at time zone 'America/New_York')::date end as filter_date
    from public.course_assignments a
    -- Historical assignments remain in their original facility after a staff transfer.
    -- Preserve authorized assignment rows even when current employee RLS hides the profile.
    left join public.employees e on e.id=a.employee_id and e.organization_id=a.organization_id
    join public.facilities f on f.id=a.facility_id and f.organization_id=a.organization_id
    left join public.courses c on c.id=a.course_id
    left join public.course_versions cv on cv.id=a.course_version_id and cv.course_id=a.course_id
    left join public.course_progress cp on cp.assignment_id=a.id
    -- The assignment FK is unique; do not join by employee/course, which duplicates annual renewals.
    left join public.certificates cert on cert.course_assignment_id=a.id
      and cert.organization_id=a.organization_id and cert.employee_id=a.employee_id
    where a.organization_id=p_organization_id
      and (p_facility_id is null or a.facility_id=p_facility_id)
      and (p_status='all' or a.status=p_status)
      and (btrim(coalesce(p_course_search,''))='' or strpos(lower(coalesce(cv.title,c.title,'')),lower(btrim(p_course_search)))>0)
  ), filtered as materialized (
    select * from enrollment where filter_date is not null
      and (p_date_from is null or filter_date >= p_date_from)
      and (p_date_through is null or filter_date <= p_date_through)
  ), page as (
    select * from filtered order by assigned_at desc,id limit p_limit offset p_offset
  )
  select jsonb_build_object(
    'organization_name',(select name from public.organizations where id=p_organization_id),
    'facility_name',(select name from public.facilities where id=p_facility_id),
    'generated_at',now(),'date_basis',p_date_basis,'limit',p_limit,'offset',p_offset,
    'total',count(*),'students',count(distinct employee_id),
    'completed',count(*) filter(where status='completed'),
    'in_progress',count(*) filter(where status='in_progress'),
    'not_started',count(*) filter(where status='assigned'),
    'canceled',count(*) filter(where status='canceled'),
    'completion_denominator',count(*) filter(where status<>'canceled'),
    'certificates',count(certificate_id),
    -- The reserved export size reads its complete result in this one MVCC snapshot.
    -- Avoid constructing a large partial payload when the result exceeds the export bound.
    'rows',case when p_limit=10000 and count(*)>10000 then '[]'::jsonb
      else coalesce((select jsonb_agg(to_jsonb(page) order by assigned_at desc,id) from page),'[]'::jsonb) end
  ) into v_result from filtered;
  if p_limit=10000 and (v_result->>'total')::bigint>10000 then
    raise exception 'This report exceeds 10,000 enrollments. Narrow the dates, course or facility before exporting; no partial report was created.' using errcode='54000';
  end if;
  return v_result;
end;
$$;
comment on function public.get_training_enrollment_report(uuid,uuid,text,text,text,date,date,integer,integer) is
  'RLS-scoped enrollment, completion, progress and issued-certificate report. Totals cover the entire filtered set, not the current page. Exports use one snapshot and reject more than 10,000 matching enrollments. Dates use Pennsylvania calendar days. Canceled enrollments are excluded from the completion denominator.';
revoke all on function public.get_training_enrollment_report(uuid,uuid,text,text,text,date,date,integer,integer) from public,anon;
grant execute on function public.get_training_enrollment_report(uuid,uuid,text,text,text,date,date,integer,integer) to authenticated;
