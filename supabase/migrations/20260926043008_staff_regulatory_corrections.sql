-- REG37(b,d,f,g): corrections supported by both DHS RCGs, revised August 1, 2021.
-- https://www.pa.gov/agencies/dhs/resources/licensing/pch-alr-licensing/pch-alr-compliance-guides
-- Do not turn undocumented historical training into completed evidence.
alter table public.administrator_profiles
  add column department_orientation_completed_date date,
  add column department_orientation_document_path text,
  add column dementia_initial_completed_date date,
  add column dementia_initial_hours numeric check (dementia_initial_hours >= 0),
  add column dementia_initial_document_path text,
  add column dementia_annual_completed_date date,
  add column dementia_annual_hours numeric check (dementia_annual_hours >= 0),
  add column dementia_annual_document_path text;

update public.onboarding_checklist_templates
set applies_to_track = 'all'
where organization_id is null and code = 'ORIENT-40HR';
update public.onboarding_checklist_templates
set is_active = false
where organization_id is null and code = 'RAPID-ORIENT';
update public.onboarding_checklist_templates
set deadline_value = 0
where organization_id is null and code in ('DAY1-FIRE-EP','BGCHECK-INITIATED');

-- A briefing already completed stays in the audit trail. It is not substituted for the
-- statutory orientation. Add that pending evidence request for each rapid-track employee.
do $$
declare v_employee record;
begin
  for v_employee in select e.id from public.employees e
    join public.facilities f on f.id=e.facility_id
    where f.facility_type in ('PCH','ALR') and e.worker_type in ('agency','substitute','volunteer')
      and e.status not in ('terminated','inactive')
  loop
    perform public.instantiate_employee_onboarding_checklist(v_employee.id);
  end loop;
end $$;
update public.employee_onboarding_items i
set is_blocking = false, status=i.status,
    notes = concat_ws(E'\n', i.notes, 'Superseded by the full 40-scheduled-work-hour orientation; briefing evidence retained.')
from public.onboarding_checklist_templates t
where i.template_id=t.id and t.organization_id is null and t.code='RAPID-ORIENT';

update public.employee_onboarding_items i
set due_date=coalesce(p.first_work_date,e.hire_date)
from public.onboarding_checklist_templates t, public.employees e
left join public.training_staff_profiles p on p.employee_id=e.id
where i.template_id=t.id and i.employee_id=e.id and t.organization_id is null
  and t.code in ('DAY1-FIRE-EP','BGCHECK-INITIATED') and i.status='pending';

-- Rebase day-one dates on the recorded first work day when it becomes available. Hire
-- date is only the existing fallback; a change in the Train duty profile must update it.
create or replace function public.refresh_onboarding_first_work_day()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  update public.employee_onboarding_items i set due_date=coalesce(new.first_work_date,
    (select e.hire_date from public.employees e where e.id=new.employee_id))
  from public.onboarding_checklist_templates t
  where i.employee_id=new.employee_id and i.template_id=t.id and t.organization_id is null
    and t.code in ('DAY1-FIRE-EP','BGCHECK-INITIATED') and i.status='pending';
  return new;
end $$;
revoke all on function public.refresh_onboarding_first_work_day() from public,anon,authenticated;
create trigger refresh_onboarding_first_work_day after insert or update of first_work_date
on public.training_staff_profiles for each row execute function public.refresh_onboarding_first_work_day();

update public.training_types set citation_note =
  '55 Pa. Code 2600.64(c)-(d) / 2800.64(c)-(d): 24 annual hours from approved sources. The approved initial course fulfills the first year. Both DHS RCGs permit up to 12 online hours, up to 6 medication-training hours and up to 4 first aid / CPR / obstructed-airway hours, with a documented employer-selected training year.'
where organization_id is null and code='ADMIN-ANNUAL';

-- A bit for each independently established skill: first aid=1, CPR=2, airway=4.
-- Qualifying medical personnel satisfy all three. Arbitrary qualification labels are
-- not evidence that every skill is present; verified Train certificates are also read.
-- Both RCGs 63(a) explicitly allow separate first-aid and CPR/airway staff. Their
-- 63(c) discussion lists CNA, LPN, RN, physician and EMT with credentials in good standing.
create or replace function public.staff_emergency_qualification_mask(p_employee_id uuid,p_start timestamptz,p_end timestamptz)
returns integer language sql stable set search_path='' as $$
  with credentials as (
    select 7 as mask from public.employee_credentials c
    where c.employee_id=p_employee_id and c.credential_type in ('rn_license','lpn_license','nurse_aide_registry')
      and c.status in ('compliant','due_soon') and c.verified_at is not null
      and (c.issue_date is null or c.issue_date <= (p_start at time zone 'America/New_York')::date)
      and (c.expiration_date is null or c.expiration_date >= ((p_end-interval '1 microsecond') at time zone 'America/New_York')::date)
  ), qualifications as (
    select case cd.qualification_key
      when 'first_aid' then 1 when 'cpr' then 2 when 'obstructed_airway' then 4 when 'airway' then 4
      when 'first_aid_cpr' then 3 when 'cpr_airway' then 6 when 'first_aid_cpr_airway' then 7
      when 'physician_license' then 7 when 'emt_certification' then 7 else 0 end as mask
    from public.employee_qualifications eq join public.certification_definitions cd on cd.id=eq.certification_definition_id
    where eq.employee_id=p_employee_id and eq.state='active' and cd.is_active and eq.effective_from<=p_start
      and (eq.effective_to is null or eq.effective_to>=p_end) and (eq.expires_at is null or eq.expires_at>=p_end)
  ), evidence as (
    select (case when 'first_aid'=any(e.topics) then 1 else 0 end)
      | (case when 'cpr'=any(e.topics) then 2 else 0 end)
      | (case when 'airway'=any(e.topics) then 4 else 0 end) as mask
    from public.training_evidence_events e where e.employee_id=p_employee_id and e.status='verified'
      and e.delivery<>'online' and e.completed_on <= (p_start at time zone 'America/New_York')::date
      and e.valid_until >= ((p_end-interval '1 microsecond') at time zone 'America/New_York')::date
  ) select coalesce(bit_or(mask),0) from (select * from credentials union all select * from qualifications union all select * from evidence) all_evidence;
$$;
revoke all on function public.staff_emergency_qualification_mask(uuid,timestamptz,timestamptz) from public,anon,authenticated;

-- Every interval in the schedule is represented, including overnight and unstaffed
-- gaps. This is a planning check against the current active census; it does not assert
-- that staff actually attended, nor invent resident absence/return times.
create or replace function public.schedule_emergency_coverage(p_schedule_id uuid)
returns jsonb language sql stable set search_path='' as $$
  with scope as (
    select s.*,f.facility_type,
      s.period_start::timestamp at time zone 'America/New_York' as starts,
      (s.period_end+1)::timestamp at time zone 'America/New_York' as ends,
      (select count(*) from public.residents r where r.facility_id=s.facility_id and r.status='active') as census
    from public.schedules s join public.facilities f on f.id=s.facility_id
    where s.id=p_schedule_id and f.facility_type in ('PCH','ALR')
  ), assignments as (
    select distinct a.employee_id,
      (a.shift_date+a.start_time) at time zone 'America/New_York' as starts,
      (a.shift_date+a.end_time+case when a.end_time<=a.start_time then interval '1 day' else interval '0 day' end)
        at time zone 'America/New_York' as ends
    from public.shift_assignments a
    join scope s on s.facility_id=a.facility_id where a.status in ('scheduled','confirmed')
      and a.shift_date between s.period_start-1 and s.period_end
  ), boundaries as (
    select starts as moment from scope union select ends from scope
    union select greatest(a.starts,s.starts) from assignments a cross join scope s where a.ends>s.starts and a.starts<s.ends
    union select least(a.ends,s.ends) from assignments a cross join scope s where a.ends>s.starts and a.starts<s.ends
  ), intervals as (
    select moment as starts,lead(moment) over(order by moment) as ends from boundaries
  ), coverage as (
    select i.starts,i.ends,s.census,
      ceil(s.census::numeric/case when s.facility_type='PCH' then 50 else 35 end)::integer as required,
      count(distinct a.employee_id) filter(where (q.mask & 1)=1)::integer as first_aid,
      count(distinct a.employee_id) filter(where (q.mask & 6)=6)::integer as cpr_airway
    from intervals i cross join scope s
    left join assignments a on a.starts<=i.starts and a.ends>=i.ends
    left join lateral (select public.staff_emergency_qualification_mask(a.employee_id,i.starts,i.ends) as mask) q on true
    where i.ends is not null and i.ends>i.starts
    group by i.starts,i.ends,s.census,s.facility_type
  ) select coalesce(jsonb_agg(to_jsonb(c) order by c.starts),'[]'::jsonb) from coverage c;
$$;
revoke all on function public.schedule_emergency_coverage(uuid) from public,anon,authenticated;

-- Keep the existing authorization gate and Train-module boundary intact. Add the
-- census-driven intervals to the response consumed by the schedule page.
do $$
declare v_definition text; v_old text;
begin
  select replace(pg_get_functiondef('public.get_schedule_service_workload(uuid)'::regprocedure),E'\r\n',E'\n') into v_definition;
  if position('return v_summary || jsonb_build_object(' in v_definition)=0 then
    raise exception 'get_schedule_service_workload return shape changed';
  end if;
  v_definition:=replace(v_definition,'return v_summary || jsonb_build_object(',
    'return v_summary || jsonb_build_object(''emergencyCoverageRows'',public.schedule_emergency_coverage(p_schedule_id),''emergencyCoverageBasis'',''Current active resident census; verify actual attendance and resident presence for each interval.'') || jsonb_build_object(');
  v_old := $old$count(sa.id) filter (where sa.status in ('scheduled', 'confirmed') and exists (
        select 1 from public.employee_qualifications eq
        join public.certification_definitions cd on cd.id = eq.certification_definition_id
        where eq.employee_id = e.id and eq.state = 'active'
          and eq.effective_from <= d::date + sd.start_time
          and (eq.effective_to is null or eq.effective_to > d::date + sd.start_time)
          and (eq.expires_at is null or eq.expires_at > d::date + sd.start_time)
          and cd.qualification_key similar to '%(first.aid|cpr)%'
      ))::integer as first_aid_cpr_staff$old$;
  v_old:=replace(v_old,E'\r\n',E'\n');
  if position(v_old in v_definition)=0 then raise exception 'Service workload first aid/CPR count changed'; end if;
  v_definition:=replace(v_definition,v_old,$new$least(
        count(distinct e.id) filter (where sa.status in ('scheduled','confirmed') and
          (public.staff_emergency_qualification_mask(e.id,
            (d::date+sd.start_time) at time zone 'America/New_York',
            (d::date+sd.end_time+case when sd.end_time<=sd.start_time then interval '1 day' else interval '0 day' end) at time zone 'America/New_York') & 1)=1),
        count(distinct e.id) filter (where sa.status in ('scheduled','confirmed') and
          (public.staff_emergency_qualification_mask(e.id,
            (d::date+sd.start_time) at time zone 'America/New_York',
            (d::date+sd.end_time+case when sd.end_time<=sd.start_time then interval '1 day' else interval '0 day' end) at time zone 'America/New_York') & 6)=6)
      )::integer as first_aid_cpr_staff$new$);
  execute v_definition;
end $$;

do $$
declare v_definition text;
begin
  select pg_get_functiondef('public.instantiate_employee_onboarding_checklist(uuid)'::regprocedure) into v_definition;
  if position('v_emp.hire_date + (tmpl.deadline_value' in v_definition)=0 then
    raise exception 'Onboarding date calculation changed';
  end if;
  v_definition:=replace(v_definition,
    'v_emp.hire_date + (tmpl.deadline_value',
    '(case when tmpl.organization_id is null and tmpl.code in (''DAY1-FIRE-EP'',''BGCHECK-INITIATED'') then coalesce((select p.first_work_date from public.training_staff_profiles p where p.employee_id=v_emp.id),v_emp.hire_date) else v_emp.hire_date end) + (tmpl.deadline_value');
  v_definition:=replace(v_definition,
    'if tmpl.deadline_basis = ''hire_date_days'' and v_emp.hire_date is not null then',
    'if tmpl.deadline_basis = ''hire_date_days'' and (v_emp.hire_date is not null or (tmpl.organization_id is null and tmpl.code in (''DAY1-FIRE-EP'',''BGCHECK-INITIATED'') and exists(select 1 from public.training_staff_profiles p where p.employee_id=v_emp.id))) then');
  execute v_definition;
end $$;

-- The retained TB credential is a facility policy choice, not a criminal-history
-- obligation under 2600.51 / 2800.51. Keep its evidence and clock while removing
-- the unsupported regulatory attribution.
do $$
declare v_definition text;
begin
  select pg_get_functiondef('public.auto_tag_employee_credential_citation_topic()'::regprocedure) into v_definition;
  if position('''tb_screening'', ' in v_definition)=0 then raise exception 'Credential citation mapping changed'; end if;
  execute replace(v_definition,'''tb_screening'', ','');
end $$;
update public.employee_credentials ec set citation_topic_id=null,
  credential_label=coalesce(credential_label,'TB Screening (facility policy)')
where ec.credential_type='tb_screening' and ec.citation_topic_id in (
  select id from public.dhs_citation_topics where category='Background Checks & Health Screening');
