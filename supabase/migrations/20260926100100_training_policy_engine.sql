-- One source-capped, facility-year calculation for core rollups and Train.
create function public.staff_training_period(p_employee_id uuid,p_as_of date default null,p_administrator boolean default false)
returns jsonb language sql stable set search_path='' as $$
with chosen as (
 select e.hire_date,coalesce(t.hire_date,t.first_work_date,e.hire_date) hired,coalesce(p_as_of,public.pa_today()) today,
   case when p_administrator then coalesce(y.administrator_year_basis,'fixed') else coalesce(y.year_basis,'fixed') end basis,
   case when p_administrator then coalesce(y.administrator_year_start,'01-01') else coalesce(y.year_start,'01-01') end month_day,
   coalesce(s.annual_grace_days,15) grace
 from public.employees e left join public.training_staff_profiles t on t.employee_id=e.id
 left join public.staff_regulatory_policies s on s.facility_id=e.facility_id
 left join lateral(select * from public.training_facility_policies y where y.facility_id=e.facility_id
   and y.effective_from<=coalesce(p_as_of,public.pa_today()) order by y.effective_from desc,y.created_at desc,id desc limit 1)y on true
 where e.id=p_employee_id
), anchor as (
 select *,extract(year from today)::integer yr,
   case when basis='anniversary' then to_char(hired,'MM-DD') else month_day end md from chosen
), years as (
 select *,make_date(yr,split_part(md,'-',1)::integer,least(split_part(md,'-',2)::integer,
   extract(day from (make_date(yr,split_part(md,'-',1)::integer,1)+interval '1 month - 1 day'))::integer)) current_start from anchor
), period as (
 select *,case when current_start<=today then yr else yr-1 end sy from years
), dates as (
 select *,make_date(sy,split_part(md,'-',1)::integer,least(split_part(md,'-',2)::integer,
   extract(day from (make_date(sy,split_part(md,'-',1)::integer,1)+interval '1 month - 1 day'))::integer)) starts,
   make_date(sy+1,split_part(md,'-',1)::integer,least(split_part(md,'-',2)::integer,
   extract(day from (make_date(sy+1,split_part(md,'-',1)::integer,1)+interval '1 month - 1 day'))::integer))-1 ends from period
)
select jsonb_build_object('start',starts,'end',ends,'graceThrough',ends+grace,'basis',basis,'referenceMonthDay',md,
 'partialFirstYear',hired is null or hired>starts,'hireDate',hired,'documented',exists(select 1 from public.training_facility_policies p
   join public.employees e on e.facility_id=p.facility_id where e.id=p_employee_id and p.effective_from<=today)) from dates;
$$;
revoke all on function public.staff_training_period(uuid,date,boolean) from public,anon;
grant execute on function public.staff_training_period(uuid,date,boolean) to authenticated,service_role;

create function public.staff_eligible_training_minutes(p_employee_id uuid,p_bucket text,p_from date,p_through date)
returns numeric language plpgsql stable set search_path='' as $$
declare v record; facility_kind text; allow_ojt boolean; total numeric:=0; credited numeric; med numeric:=360; rescue numeric:=240;
 online numeric:=case when p_bucket='administrator' then 720 else 1000000 end; ojt numeric;
begin
 select fac.facility_type,coalesce(p.alf_ojt_allowed,false) into facility_kind,allow_ojt from public.employees e
 join public.facilities fac on fac.id=e.facility_id left join public.staff_regulatory_policies p on p.facility_id=e.facility_id where e.id=p_employee_id;
 if facility_kind is null then return 0; end if;
 ojt:=case when p_bucket='general_annual' and facility_kind='PCH' then 360 when p_bucket='general_annual' and facility_kind='ALR' and allow_ojt then 1000000 else 0 end;
 for v in
  with sources as (
   select 'event:'||e.id id,e.completed_on as completed_day,e.delivery,
    case when p_bucket='general_annual' then greatest(0,e.minutes-coalesce((e.allocations->>'special_initial')::numeric,0)
      -coalesce((e.allocations->>'special_annual')::numeric,0)-coalesce((e.allocations->>'dementia_initial')::numeric,0)-coalesce((e.allocations->>'dementia_annual')::numeric,0))
      else coalesce((e.allocations->>case p_bucket when 'administrator' then 'administrator' when 'alr_dementia' then 'dementia_annual' else 'special_annual' end)::numeric,0) end minutes,
    e.topics&&array['medication_authorization','medication_practicum','medication_trainer'] medication,
    e.topics&&array['first_aid','cpr','airway'] resuscitation
   from public.training_evidence_events e where e.employee_id=p_employee_id and e.status='verified' and e.completed_on between p_from and p_through
   union all
   select 'record:'||r.id,r.completion_date,case when r.completion_method='on_the_job' then 'ojt' else coalesce(r.completion_method,'external') end,
    coalesce(r.hours,0)*60,tt.code in ('MED-INIT','MED-RENEW','TRAINER-CERT'),tt.code~'(CPR|FIRST.?AID|AIRWAY)'
   from public.employee_training_records r join public.training_types tt on tt.id=r.training_type_id
   join public.employees e on e.id=r.employee_id join public.facilities fac on fac.id=e.facility_id
   where r.employee_id=p_employee_id and r.completion_date between p_from and p_through and r.status not in ('pending_review','not_applicable')
    and coalesce(r.approval_status,'approved')='approved' and tt.is_active and tt.state=coalesce(fac.state,'PA')
    and tt.applies_to_facility_type in ('BOTH',fac.facility_type)
    and (not tt.audience_verification_required or public.current_training_audience_status(r.employee_id,tt.id) not in ('pending_review','not_applicable'))
    and (tt.hour_bucket=p_bucket or (p_bucket='administrator' and tt.code='ADMIN-ANNUAL')
      or (p_bucket='general_annual' and (tt.code in ('ORIENT','MED-INIT','MED-RENEW','TRAINER-CERT','DIABETES-EDU','FIRE-SAFETY','ABUSE-REPORT','RESIDENT-RIGHTS','INFECTION') or tt.code~'(CPR|FIRST.?AID|AIRWAY)')))
    and not exists(select 1 from public.training_evidence_events te where te.legacy_record_id=r.id and te.status='verified')
   union all
   -- A topic may be mapped to several regulatory types. Its immutable course credit is earned once.
   select 'course:'||cc.course_assignment_id||':'||cc.topic_code,min((cc.credited_at at time zone 'America/New_York')::date),'online',
    max(cc.credit_hours)*60,bool_or(tt.code in ('MED-INIT','MED-RENEW','TRAINER-CERT')),bool_or(tt.code~'(CPR|FIRST.?AID|AIRWAY)')
   from public.course_completion_credits cc join public.training_types tt on tt.id=cc.training_type_id
   join public.employees e on e.id=cc.employee_id join public.facilities fac on fac.id=e.facility_id
   where cc.employee_id=p_employee_id and (cc.credited_at at time zone 'America/New_York')::date between p_from and p_through
    and tt.is_active and tt.state=coalesce(fac.state,'PA') and tt.applies_to_facility_type in ('BOTH',fac.facility_type)
    and (not tt.audience_verification_required or public.current_training_audience_status(cc.employee_id,tt.id) not in ('pending_review','not_applicable'))
    and (tt.hour_bucket=p_bucket or (p_bucket='administrator' and tt.code='ADMIN-ANNUAL')
      or (p_bucket='general_annual' and (tt.code in ('ORIENT','MED-INIT','MED-RENEW','TRAINER-CERT','DIABETES-EDU','FIRE-SAFETY','ABUSE-REPORT','RESIDENT-RIGHTS','INFECTION') or tt.code~'(CPR|FIRST.?AID|AIRWAY)')))
    and not exists(select 1 from public.training_evidence_events te where te.course_assignment_id=cc.course_assignment_id and te.status='verified')
   group by cc.course_assignment_id,cc.topic_code
  ) select * from sources order by (delivery in ('online','ojt')), (medication::integer+resuscitation::integer),completed_day,id
 loop
  if v.delivery='online' and v.resuscitation then continue; end if;
  credited:=least(v.minutes,case when v.medication then med else 1000000 end,case when v.resuscitation then rescue else 1000000 end,
    case when v.delivery='online' then online else 1000000 end,case when v.delivery='ojt' then ojt else 1000000 end);
  total:=total+credited;
  if v.medication then med:=med-credited; end if; if v.resuscitation then rescue:=rescue-credited; end if;
  if v.delivery='online' then online:=online-credited; end if; if v.delivery='ojt' then ojt:=ojt-credited; end if;
 end loop;
 return total;
end $$;
revoke all on function public.staff_eligible_training_minutes(uuid,text,date,date) from public,anon;
grant execute on function public.staff_eligible_training_minutes(uuid,text,date,date) to authenticated,service_role;

create function public.get_staff_training_summary(p_employee_id uuid,p_as_of date default null)
returns jsonb language plpgsql stable set search_path='' as $$
declare period jsonb; previous jsonb; a jsonb; today date:=coalesce(p_as_of,public.pa_today()); f text; result jsonb; hours numeric;
 previous_hours numeric; late_credit numeric; required numeric; previous_start date; py integer; pm integer; pd integer;
begin
 select fac.facility_type into f from public.employees e join public.facilities fac on fac.id=e.facility_id where e.id=p_employee_id;
 if f is null then return null; end if;
 period:=public.staff_training_period(p_employee_id,today,false); a:=public.staff_training_period(p_employee_id,today,true);
 py:=extract(year from (period->>'start')::date)::integer-1; pm:=split_part(period->>'referenceMonthDay','-',1)::integer; pd:=split_part(period->>'referenceMonthDay','-',2)::integer;
 previous_start:=make_date(py,pm,least(pd,extract(day from (make_date(py,pm,1)+interval '1 month - 1 day'))::integer));
 previous:=period||jsonb_build_object('start',previous_start,'end',(period->>'start')::date-1,
   'graceThrough',(period->>'start')::date-1+((period->>'graceThrough')::date-(period->>'end')::date),
   'partialFirstYear',(period->>'hireDate')::date is null or (period->>'hireDate')::date>previous_start);
 required:=case when f='ALR' then 16 else 12 end;
 hours:=public.staff_eligible_training_minutes(p_employee_id,'general_annual',(period->>'start')::date,today)/60;
 previous_hours:=public.staff_eligible_training_minutes(p_employee_id,'general_annual',(previous->>'start')::date,(previous->>'end')::date)/60;
 late_credit:=case when coalesce((previous->>'partialFirstYear')::boolean,true) then 0 else least(greatest(0,required-previous_hours),
   greatest(0,public.staff_eligible_training_minutes(p_employee_id,'general_annual',(previous->>'start')::date,least(today,(previous->>'graceThrough')::date))/60-previous_hours)) end;
 -- Hours completed in the grace window repair the preceding year's deficit once;
 -- they cannot also fill the new year's denominator.
 previous_hours:=previous_hours+late_credit;
 hours:=greatest(0,hours-late_credit);
 result:=period||jsonb_build_object('completedHours',hours,'requiredHours',required,
  'previousPeriod',previous,'previousCompletedHours',previous_hours,'graceHoursAllocatedToPrevious',late_credit,
  'previousYearOverdue',not coalesce((previous->>'partialFirstYear')::boolean,true) and today>(previous->>'graceThrough')::date and previous_hours<required,
  'previousAlrDementiaHours',public.staff_eligible_training_minutes(p_employee_id,'alr_dementia',(previous->>'start')::date,(previous->>'end')::date)/60,
  'previousSpecialUnitHours',public.staff_eligible_training_minutes(p_employee_id,'sdcu_dementia',(previous->>'start')::date,(previous->>'end')::date)/60,
  'administratorPeriod',a,'administratorHours',public.staff_eligible_training_minutes(p_employee_id,'administrator',(a->>'start')::date,today)/60,
  'alrDementiaHours',public.staff_eligible_training_minutes(p_employee_id,'alr_dementia',(period->>'start')::date,today)/60,
  'specialUnitHours',public.staff_eligible_training_minutes(p_employee_id,'sdcu_dementia',(period->>'start')::date,today)/60);
 return result;
end $$;
revoke all on function public.get_staff_training_summary(uuid,date) from public,anon;
grant execute on function public.get_staff_training_summary(uuid,date) to authenticated,service_role;

create function app_private.refresh_staff_training_policy(p_organization_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare r record; years integer; grace integer; due date; period jsonb; summary jsonb;
begin
 for r in select tr.*,tt.code,tt.renewal_interval_days,tt.warning_days_default,sp.medication_course_years,
   coalesce(sp.trainer_recertification_years,3) trainer_years,coalesce(sp.annual_grace_days,15) grace
   from public.employee_training_records tr join public.training_types tt on tt.id=tr.training_type_id
   join public.facilities f on f.id=tr.facility_id left join public.staff_regulatory_policies sp on sp.facility_id=tr.facility_id
   where f.facility_type in ('PCH','ALR') and (p_organization_id is null or tr.organization_id=p_organization_id)
    and tr.status not in ('not_applicable','pending_review') and coalesce(tr.approval_status,'approved')='approved'
 loop
  years:=case when r.code in ('MED-INIT','MED-RENEW') then r.medication_course_years when r.code='TRAINER-CERT' then r.trainer_years
    when r.renewal_interval_days>=365 and r.renewal_interval_days%365=0 then r.renewal_interval_days/365 else null end;
  grace:=case when coalesce(years,0)>=1 then r.grace else 0 end;
  due:=case when r.completion_date is null then null when years is not null then (r.completion_date+make_interval(years=>years))::date+grace
    when r.code in ('MED-INIT','MED-RENEW') then null else r.completion_date+r.renewal_interval_days end;
  update public.employee_training_records set due_date=due,status=case when r.completion_date is null or r.completion_date>public.pa_today() then 'missing'
    when due is null then 'compliant' when due<public.pa_today() then 'expired' when due<=public.pa_today()+r.warning_days_default then 'due_soon' else 'compliant' end where id=r.id;
 end loop;
 for r in select b.id,b.employee_id,b.bucket_type,b.required_hours from public.employee_training_hour_buckets b
   join public.facilities f on f.id=b.facility_id where f.facility_type in ('PCH','ALR')
   and b.training_year=extract(year from public.pa_today())::integer and (p_organization_id is null or b.organization_id=p_organization_id)
 loop
  period:=public.staff_training_period(r.employee_id); summary:=public.get_staff_training_summary(r.employee_id);
  update public.employee_training_hour_buckets set completed_hours=coalesce((summary->>case r.bucket_type when 'general_annual' then 'completedHours' when 'alr_dementia' then 'alrDementiaHours' else 'specialUnitHours' end)::numeric,0),
   status=case when not coalesce((summary->'previousPeriod'->>'partialFirstYear')::boolean,true)
      and public.pa_today()>(summary->'previousPeriod'->>'graceThrough')::date
      and coalesce((summary->>case r.bucket_type when 'general_annual' then 'previousCompletedHours' when 'alr_dementia' then 'previousAlrDementiaHours' else 'previousSpecialUnitHours' end)::numeric,0)<r.required_hours then 'expired'
    when (period->>'partialFirstYear')::boolean then 'compliant'
    when coalesce((summary->>case r.bucket_type when 'general_annual' then 'completedHours' when 'alr_dementia' then 'alrDementiaHours' else 'specialUnitHours' end)::numeric,0)>=r.required_hours then 'compliant'
    when (period->>'graceThrough')::date-public.pa_today()<=90 then 'due_soon' else 'incomplete' end where id=r.id;
 end loop;
end $$;
revoke all on function app_private.refresh_staff_training_policy(uuid) from public,anon,authenticated;

-- Preserve the complete existing audience, alert and assignment engine. Apply the policy
-- calculation before alerts and again after it materializes the active annual buckets.
do $$ declare body text; marker text:='  update public.practicums p'; begin
 select pg_get_functiondef('public.recalculate_compliance_core(uuid)'::regprocedure) into body;
 if position(marker in body)=0 then raise exception 'Training engine practicum marker changed'; end if;
 body:=replace(body,marker,'  perform app_private.refresh_staff_training_policy(p_organization_id);'||E'\n'||marker);
 marker:='    status = excluded.status;';
 if position(marker in body)=0 then raise exception 'Training engine bucket marker changed'; end if;
 body:=replace(body,marker,marker||E'\n  perform app_private.refresh_staff_training_policy(p_organization_id);');
 execute body;
end $$;

update public.training_types set renewal_interval_days=null where organization_id is null and code in ('MED-INIT','MED-RENEW');
update public.training_types set renewal_interval_days=1095 where organization_id is null and code='TRAINER-CERT';

-- Surface the same summary and policy in Train without increasing its pagination limit.
do $$ declare body text; begin
 select pg_get_functiondef('public.get_training_workspace(uuid,uuid,integer,integer)'::regprocedure) into body;
 body:=replace(body,'''generated_at'',now()',
 $new$'staff_policy',(select to_jsonb(p) from public.staff_regulatory_policies p where p.facility_id=p_facility_id),
 'regulatory_profiles',coalesce((select jsonb_agg(to_jsonb(p)) from (select * from public.employee_regulatory_profiles where facility_id=p_facility_id and (p_employee_id is null or employee_id=p_employee_id) order by employee_id limit v_limit offset v_offset)p),'[]'),
 'annual_summaries',coalesce((select jsonb_object_agg(e.id,public.get_staff_training_summary(e.id)) from (select id from public.employees where facility_id=p_facility_id and (p_employee_id is null or id=p_employee_id) order by id limit v_limit offset v_offset)e),'{}'),
 'generated_at',now()$new$);
 if position('annual_summaries' in body)=0 then raise exception 'Training workspace marker changed'; end if;
 execute body;
 select pg_get_functiondef('public.save_training_workspace_item(text,uuid,uuid,jsonb)'::regprocedure) into body;
 body:=replace(body,'''medication_authorization'',''diabetes''','''medication_authorization'',''medication_practicum'',''medication_trainer'',''diabetes''');
 execute body;
end $$;
