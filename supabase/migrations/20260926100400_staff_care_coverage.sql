-- §57 personal care hours and §58 awake staff are separate from emergency certificates.
alter table public.residents add column mobility_needs boolean;
comment on column public.residents.mobility_needs is 'Assessed regulatory mobility needs for staffing/evacuation; null is unknown. SCU residents are counted with mobility needs under §238 regardless of this field.';
alter table public.shift_assignments add column awake_direct_care boolean;
alter table public.staff_regulatory_policies add column waking_start time not null default '07:00', add column waking_end time not null default '23:00',
 add constraint staff_waking_hours_positive check(waking_end>waking_start);
do $$ declare body text; marker text; begin
 select pg_get_functiondef('public.save_resident_care_profile(uuid,jsonb)'::regprocedure) into body;
 marker:='    care_profile_reviewed_at = now(),';
 if position(marker in body)=0 then raise exception 'Resident care profile marker changed'; end if;
 execute replace(body,marker,'    mobility_needs = case when p_profile ? ''mobility_needs'' then (p_profile->>''mobility_needs'')::boolean else mobility_needs end,'||E'\n'||marker);
 select pg_get_functiondef('public.get_resident_care_header(uuid)'::regprocedure) into body;
 marker:='''mobilitySummary'', v_resident.mobility_summary';
 if position(marker in body)=0 then raise exception 'Resident mobility header marker changed'; end if;
 execute replace(body,marker,'''mobilityNeeds'',v_resident.mobility_needs,'||marker);
 select pg_get_functiondef('public.save_staff_regulatory_settings(uuid,uuid,jsonb)'::regprocedure) into body;
 marker:='  return v_result;';
 execute replace(body,marker,$new$  if p_employee_id is null then
    update public.staff_regulatory_policies set waking_start=coalesce(nullif(p_data->>'waking_start','')::time,'07:00'),
      waking_end=coalesce(nullif(p_data->>'waking_end','')::time,'23:00') where facility_id=p_facility_id;
  end if;
  return v_result;$new$);
end $$;

create function public.schedule_staff_care_coverage(p_schedule_id uuid)
returns jsonb language sql stable set search_path='' as $$
with scope as (
 select s.*,f.facility_type,coalesce(p.waking_start,'07:00') waking_start,coalesce(p.waking_end,'23:00') waking_end,
   count(r.id)::integer census,count(r.id) filter(where r.sdcu or r.mobility_needs is true)::integer mobility,
   count(r.id) filter(where not r.sdcu and r.mobility_needs is null)::integer unknown_mobility
 from public.schedules s join public.facilities f on f.id=s.facility_id left join public.staff_regulatory_policies p on p.facility_id=f.id
 left join public.residents r on r.facility_id=f.id and r.status='active'
 where s.id=p_schedule_id and f.facility_type in ('PCH','ALR') group by s.id,f.facility_type,p.waking_start,p.waking_end
), assignments as (
 select a.id,a.employee_id,e.first_name||' '||e.last_name employee_name,a.awake_direct_care,p.birth_date,p.role_category,
   (a.shift_date+a.start_time) at time zone 'America/New_York' starts,
   (a.shift_date+a.end_time+case when a.end_time<=a.start_time then interval '1 day' else interval '0 day' end) at time zone 'America/New_York' ends
 from public.shift_assignments a join scope s on s.id=a.schedule_id and s.facility_id=a.facility_id join public.employees e on e.id=a.employee_id
 left join public.employee_regulatory_profiles p on p.employee_id=e.id where a.status in ('scheduled','confirmed')
), days as (select d::date as day,s.* from scope s cross join lateral generate_series(s.period_start::timestamp,s.period_end::timestamp,interval '1 day')d),
 boundaries as (
 select day::timestamp at time zone 'America/New_York' moment from days
 union select (period_end+1)::timestamp at time zone 'America/New_York' from scope
 union select (day+waking_start) at time zone 'America/New_York' from days
 union select (day+waking_end) at time zone 'America/New_York' from days
 union select starts from assignments union select ends from assignments
), intervals as (select moment starts,lead(moment) over(order by moment) ends from boundaries),
 coverage as (
 select i.starts,i.ends,s.census,s.mobility,s.unknown_mobility,
   count(distinct a.employee_id) filter(where a.role_category='direct_care')::integer direct_staff,
   count(distinct a.employee_id) filter(where a.role_category='direct_care' and a.awake_direct_care is true)::integer awake_staff,
   count(distinct a.employee_id) filter(where a.role_category='direct_care' and a.birth_date<=((i.starts at time zone 'America/New_York')::date-interval '21 years')::date)::integer adult21_staff,
   count(distinct a.employee_id) filter(where a.role_category is null or a.role_category='unknown' or (a.role_category='direct_care' and a.awake_direct_care is null))::integer unknown_staff,
   s.facility_type='ALR' or s.census>=16 all_must_be_awake,
   case when s.census=0 then 0 when s.facility_type='ALR' or s.census>=16 or s.mobility>0 or s.unknown_mobility>0 then 1 else 0 end awake_minimum,
   (i.starts at time zone 'America/New_York')::time>=s.waking_start and (i.ends at time zone 'America/New_York')::time<=s.waking_end
     and (i.ends at time zone 'America/New_York')::time<>'00:00' waking
 from intervals i cross join scope s left join assignments a on a.starts<=i.starts and a.ends>=i.ends
 where i.ends>i.starts and i.starts>=s.period_start::timestamp at time zone 'America/New_York'
   and i.ends<=(s.period_end+1)::timestamp at time zone 'America/New_York'
 group by i.starts,i.ends,s.census,s.mobility,s.unknown_mobility,s.facility_type,s.waking_start,s.waking_end
), daily as (
 select (starts at time zone 'America/New_York')::date as day,max(census+mobility) required_hours,max(unknown_mobility) unknown_mobility,
   round(sum(extract(epoch from ends-starts)/3600*awake_staff),2) available_hours,
   round(sum(case when waking then extract(epoch from ends-starts)/3600*awake_staff else 0 end),2) waking_hours
 from coverage group by (starts at time zone 'America/New_York')::date
)
select jsonb_build_object('intervals',coalesce((select jsonb_agg(to_jsonb(c) order by starts) from coverage c),'[]'),
 'days',coalesce((select jsonb_agg(to_jsonb(d) order by day) from daily d),'[]'),
 'assignments',coalesce((select jsonb_agg(to_jsonb(a) order by starts,employee_name) from assignments a),'[]'),
 'basis','Current active census and assessed mobility needs; SCU residents count with mobility needs. Confirm resident presence, awake availability and actual attendance. Unknown mobility leaves the care-hour denominator incomplete. Waking hours follow the recorded facility policy.');
$$;
revoke all on function public.schedule_staff_care_coverage(uuid) from public,anon,authenticated;

create function public.record_shift_awake_coverage(p_assignment_id uuid,p_awake boolean)
returns void language plpgsql security definer set search_path='' as $$
declare a public.shift_assignments;
begin
 select * into a from public.shift_assignments where id=p_assignment_id for update;
 if auth.uid() is null or not public.current_session_unlocked() or a.id is null
   or not coalesce(public.current_role() in ('platform_admin','org_admin','facility_manager'),false)
   or not (public.is_platform_admin() or (a.organization_id=public.current_org_id() and public.is_assigned_to_facility(a.facility_id)))
   or not app_private.has_product_module('modules.carebase') then
   raise exception 'Scheduling manager access required' using errcode='42501'; end if;
 perform public.assert_identity_assurance('operational_admin');
 update public.shift_assignments set awake_direct_care=p_awake where id=a.id;
end $$;
revoke all on function public.record_shift_awake_coverage(uuid,boolean) from public,anon;
grant execute on function public.record_shift_awake_coverage(uuid,boolean) to authenticated;

do $$ declare body text; begin
 select pg_get_functiondef('public.get_schedule_service_workload(uuid)'::regprocedure) into body;
 if position('return v_summary || jsonb_build_object(' in body)=0 then raise exception 'Workload coverage return marker changed'; end if;
 execute replace(body,'return v_summary || jsonb_build_object(',
  'return v_summary || jsonb_build_object(''staffCareCoverage'',public.schedule_staff_care_coverage(p_schedule_id)) || jsonb_build_object(');
end $$;
