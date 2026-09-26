-- A current annual plan can explicitly reuse an unfinished prior-year assignment.
-- Keep its original owner, deadline and historical year while including the exact
-- resolved assignment in the enrolled plan's reporting year. EXISTS preserves one
-- row per assignment even when multiple plans reuse it. Invoker RLS and explicit
-- organization/facility/employee identity retain the original reporting scope.

create or replace function public.get_training_progress_report(
  p_organization_id uuid,
  p_facility_id uuid default null,
  p_course_search text default '',
  p_status text default 'all',
  p_date_basis text default 'assigned',
  p_date_from date default null,
  p_date_through date default null,
  p_limit integer default 50,
  p_offset integer default 0,
  p_employee_id uuid default null,
  p_plan_id uuid default null,
  p_purpose text default 'all',
  p_department text default '',
  p_training_year integer default null,
  p_deadline text default 'all'
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
    or p_date_basis is null or p_date_basis not in ('assigned','completed','certificate','due')
    or p_limit is null or (p_limit not between 1 and 500 and p_limit <> 10000)
    or p_purpose not in ('all','required','optional') or p_purpose is null
    or p_deadline not in ('all','overdue','due_soon') or p_deadline is null
    or (p_training_year is not null and p_training_year not between 1990 and 2200)
    or length(coalesce(p_department,''))>200
    or p_offset is null or p_offset < 0 or (p_limit=10000 and p_offset<>0)
    or length(coalesce(p_course_search,'')) > 200
    or (p_date_from is not null and p_date_through is not null and p_date_from > p_date_through) then
    raise exception 'Invalid training report filters' using errcode='22023';
  end if;

  with enrollment as materialized (
    select a.id, a.employee_id,
      coalesce(nullif(btrim(concat_ws(' ',e.first_name,e.last_name)),''),'Student record '||a.employee_id::text) as student,
      a.facility_id, f.name as facility, a.course_id, coalesce(cv.title,c.title,'Course unavailable') as course,
      (a.is_required or public.training_assignment_is_required(a.id)) as is_required,a.is_required as assignment_is_required,a.assignment_origin,a.training_plan_id,plan.name as plan_name,plan.training_year,
      e.department,coalesce(cv.version_label,'v'||cv.version_number::text) as course_version,
      coalesce(credits.hours,0) as credit_hours,
      a.status, a.assigned_at, a.due_date, a.completed_at,
      case when a.status='completed' then 100 else coalesce(cp.percent_complete,0) end as percent_complete,
      cert.id as certificate_id, cert.credential_number, cert.issued_at as certificate_issued_at,
      cert.pdf_status as certificate_pdf_status,
      case p_date_basis when 'completed' then (a.completed_at at time zone 'America/New_York')::date
        when 'due' then a.due_date
        when 'certificate' then (cert.issued_at at time zone 'America/New_York')::date
        else (a.assigned_at at time zone 'America/New_York')::date end as filter_date
    from public.course_assignments a
    left join public.training_plans plan on plan.id=a.training_plan_id
    left join lateral(select max(credit_hours) as hours from public.course_completion_credits cc where cc.course_assignment_id=a.id) credits on true
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
      and (p_employee_id is null or a.employee_id=p_employee_id)
      and (p_plan_id is null or a.training_plan_id=p_plan_id or exists(select 1 from public.training_plan_enrollments n
        where n.training_plan_id=p_plan_id and n.employee_id=a.employee_id and n.resolved_assignments->>a.course_id::text=a.id::text))
      and (p_purpose='all' or (a.is_required or public.training_assignment_is_required(a.id))=(p_purpose='required'))
      and (coalesce(p_department,'')='' or e.department=p_department)
      and (p_training_year is null or coalesce(plan.training_year,extract(year from coalesce(a.due_date,(a.assigned_at at time zone 'America/New_York')::date))::integer)=p_training_year
        or exists(select 1 from public.training_plan_enrollments n
          join public.training_plans resolved_plan on resolved_plan.id=n.training_plan_id
          where n.employee_id=a.employee_id and n.organization_id=a.organization_id and n.facility_id=a.facility_id
            and resolved_plan.organization_id=n.organization_id and resolved_plan.facility_id=n.facility_id
            and resolved_plan.training_year=p_training_year
            and n.resolved_assignments->>a.course_id::text=a.id::text))
      and (p_deadline='all' or (a.status not in ('completed','canceled','paused') and
        ((p_deadline='overdue' and a.due_date<public.pa_today()) or (p_deadline='due_soon' and a.due_date between public.pa_today() and public.pa_today()+7))))
      and (p_status='all'  or a.status=p_status)
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
    'required_total',count(*) filter(where is_required and status<>'canceled'),
    'required_completed',count(*) filter(where is_required and status='completed'),
    'optional_total',count(*) filter(where not is_required and status<>'canceled'),
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

revoke all on function public.get_training_progress_report(uuid,uuid,text,text,text,date,date,integer,integer,uuid,uuid,text,text,integer,text) from public,anon;
grant execute on function public.get_training_progress_report(uuid,uuid,text,text,text,date,date,integer,integer,uuid,uuid,text,text,integer,text) to authenticated;

create or replace function public.get_training_roster_progress(p_facility_id uuid,p_search text default '',p_state text default 'all',
  p_training_year integer default null,p_limit integer default 50,p_offset integer default 0)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_org uuid; v_result jsonb;
begin
  select organization_id into v_org from public.facilities where id=p_facility_id;
  if v_org is null then raise exception 'Facility is outside your access' using errcode='42501'; end if;
  -- Apply report authorization without executing an unrelated enrollment scan.
  if auth.uid() is null or not public.current_session_unlocked()
    or not coalesce(public.current_role() in ('platform_admin','org_admin','facility_manager','trainer','auditor'),false) then
    raise exception 'Training reporting access required' using errcode='42501';
  end if;
  -- Full staff exports use the same assurance policy as the training evidence workspace.
  -- Trainers/auditors retain their configured policy; privileged sessions must still be fresh.
  perform public.assert_identity_assurance('compliance_profile_admin');
  if v_org is null or (not public.is_platform_admin() and v_org is distinct from public.current_org_id())
    or not exists(select 1 from public.organizations where id=v_org) then
    raise exception 'Organization is outside your access' using errcode='42501';
  end if;
  if not public.is_platform_admin() and not exists(select 1 from public.get_effective_entitlements()
    where feature_key in ('modules.train','modules.carebase') and is_entitled) then
    raise exception 'Training reporting access required' using errcode='42501';
  end if;
  if p_facility_id is not null and not exists(select 1 from public.facilities
    where id=p_facility_id and organization_id=v_org) then
    raise exception 'Facility is outside your access' using errcode='42501';
  end if;
  if p_limit is null or p_limit not between 1 and 200 or p_offset is null or p_offset<0
    or length(coalesce(p_search,''))>200 or p_state is null
    or p_state not in ('all','exempt','no_assignments','overdue','due_soon','complete','in_progress','not_started','plan_attention','needs_invite','needs_activation')
    or (p_training_year is not null and p_training_year not between 1990 and 2200) then
    raise exception 'Invalid staff progress filters' using errcode='22023'; end if;
  with plan_progress as materialized (
    select (entry->>'employee_id')::uuid as employee_id,
      bool_or((entry->>'needs_reapply')::boolean or (entry->>'unresolved')::integer>0 ) as attention,
      bool_or((entry->>'required')::integer>(entry->>'completed')::integer) as incomplete
    from public.training_plans p cross join lateral jsonb_array_elements(public.get_training_plan_progress(p.id)) entry
    where p.facility_id=p_facility_id and (p_training_year is null or p.training_year=p_training_year)
    group by (entry->>'employee_id')::uuid
  ), assignment_rows as materialized (
    -- Evaluate assignment RLS and effective purpose once for the facility. Historical
    -- canceled rows cannot contribute to any dashboard metric and are excluded early.
    select ca.employee_id,ca.status,ca.due_date,
      (ca.is_required or public.training_assignment_is_required(ca.id)) as required
    from public.course_assignments ca left join public.training_plans tp on tp.id=ca.training_plan_id
    where ca.facility_id=p_facility_id and ca.status<>'canceled' and (p_training_year is null or
      coalesce(tp.training_year,extract(year from coalesce(ca.due_date,(ca.assigned_at at time zone 'America/New_York')::date))::integer)=p_training_year
      or exists(select 1 from public.training_plan_enrollments n
        join public.training_plans resolved_plan on resolved_plan.id=n.training_plan_id
        where n.employee_id=ca.employee_id and n.organization_id=ca.organization_id and n.facility_id=ca.facility_id
          and resolved_plan.organization_id=n.organization_id and resolved_plan.facility_id=n.facility_id
          and resolved_plan.training_year=p_training_year
          and n.resolved_assignments->>ca.course_id::text=ca.id::text))
  ), assignment_totals as materialized (
    select employee_id,count(*) filter(where required) as required_total,
      count(*) filter(where required and status='completed') as required_completed,
      count(*) filter(where not required) as optional_total,
      count(*) filter(where required and status not in ('completed','paused') and due_date<public.pa_today()) as overdue,
      count(*) filter(where required and status not in ('completed','paused') and due_date between public.pa_today() and public.pa_today()+7) as due_soon,
      count(*) filter(where required and status in ('in_progress','overdue')) as started,
      min(due_date) filter(where required and status not in ('completed','paused')) as next_due
    from assignment_rows group by employee_id
  ), roster as materialized (
    select e.id as employee_id,e.first_name,e.last_name,concat_ws(' ',e.first_name,e.last_name) as student,e.email,e.department,e.profile_id,
      invite.id as invitation_id,invite.last_sent_at,invite.last_error,
      exemption.reason as exemption_reason,exemption.training_year as exemption_year,
      case when invite.accepted_at is not null then 'activated' when e.email is null or btrim(e.email)='' then 'needs_email'
        when invite.status is not null then invite.status when e.profile_id is not null then 'linked' else 'not_invited' end as account_status,
      coalesce(a.required_total,0) as required_total,coalesce(a.required_completed,0) as required_completed,
      coalesce(a.optional_total,0) as optional_total,coalesce(a.overdue,0) as overdue,coalesce(a.due_soon,0) as due_soon,a.next_due,
      coalesce(pp.attention,false) as plan_attention,
      case when coalesce(a.overdue,0)>0 then 'overdue' when coalesce(pp.attention,false) then 'plan_attention'
        when coalesce(a.required_total,0)=0 and exemption.id is not null and not coalesce(pp.incomplete,false) then 'exempt'
        when coalesce(a.required_total,0)=0 then 'no_assignments'
        when a.required_total=a.required_completed and not coalesce(pp.incomplete,false) then 'complete' when a.due_soon>0 then 'due_soon'
        when a.started>0 or a.required_completed>0 then 'in_progress' else 'not_started' end as state
    from public.employees e
    left join lateral(select i.* from public.user_invitation_lifecycle i where i.organization_id=e.organization_id
      and (i.employee_id=e.id or (i.invited_user_id=e.profile_id and i.invited_role='employee'))
      order by i.last_sent_at desc,i.id limit 1) invite on true
    left join public.training_assignment_exemptions exemption on exemption.employee_id=e.id and exemption.facility_id=e.facility_id
      and exemption.training_year=coalesce(p_training_year,extract(year from public.pa_today())::int)
    left join plan_progress pp on pp.employee_id=e.id
    left join assignment_totals a on a.employee_id=e.id
    where e.facility_id=p_facility_id and e.status='active'
  ), searched as materialized (
    select * from roster where coalesce(p_search,'')='' or strpos(lower(student||' '||coalesce(email,'')),lower(p_search))>0
  ), filtered as materialized (
    select * from searched where p_state='all' or state=p_state
      or (p_state='due_soon' and due_soon>0) or (p_state='overdue' and overdue>0)
      or (p_state='plan_attention' and plan_attention)
      or (p_state='needs_invite' and account_status in ('needs_email','not_invited'))
      or (p_state='needs_activation' and account_status not in ('activated','needs_email','not_invited'))
  ), page as (select * from filtered order by student,employee_id limit p_limit offset p_offset)
  select jsonb_build_object('total',(select count(*) from filtered),'active_staff',count(*),
    'setup',jsonb_build_object(
      'profile_complete',(select coalesce(nullif(btrim(address),'') is not null and nullif(btrim(license_number),'') is not null
        and nullif(btrim(phone),'') is not null and nullif(btrim(administrator_name),'') is not null,false) from public.facilities where id=p_facility_id),
      'has_policy',exists(select 1 from public.training_facility_policies where facility_id=p_facility_id and effective_from<=public.pa_today()),
      'staff_count',(select count(*) from roster),
      'plan_count',(select count(*) from public.training_plans where facility_id=p_facility_id),
      'assigned_staff',(select count(*) from roster where required_total>0)),
    'exempt',count(*) filter(where state='exempt'),'no_assignments',count(*) filter(where state='no_assignments'),'overdue',count(*) filter(where overdue>0),
    'due_soon',count(*) filter(where due_soon>0),'complete',count(*) filter(where state='complete'),
    'plan_attention',count(*) filter(where plan_attention),
    'needs_invite',count(*) filter(where account_status in ('needs_email','not_invited')),
    'needs_activation',count(*) filter(where account_status not in ('activated','needs_email','not_invited')),
    'rows',coalesce((select jsonb_agg(to_jsonb(page) order by student,employee_id) from page),'[]')) into v_result from searched;
  return v_result;
end;
$$;
revoke all on function public.get_training_roster_progress(uuid,text,text,integer,integer,integer) from public,anon;
grant execute on function public.get_training_roster_progress(uuid,text,text,integer,integer,integer) to authenticated;
