-- Assign each source's grace-period minutes to the prior year before applying the
-- new year's caps. The same minutes cannot count twice or consume both years' caps.
-- The allocator is an invoker: employee and evidence RLS apply to every read.
create function public.staff_training_credit_allocation(p_employee_id uuid,p_bucket text,p_from date,p_through date,p_exclude jsonb default '{}',p_remaining jsonb default '{}',p_limit numeric default null)
returns jsonb language plpgsql stable set search_path='' as $$
declare v record; facility_kind text; allow_ojt boolean; total numeric:=0; credited numeric; med numeric:=least(360,greatest(0,coalesce((p_remaining->>'medication')::numeric,360))); rescue numeric:=least(240,greatest(0,coalesce((p_remaining->>'resuscitation')::numeric,240))); credits jsonb:='{}';
 online numeric:=case when p_bucket='administrator' then 720 else 1000000 end; ojt numeric;
begin
 select fac.facility_type,coalesce(p.alf_ojt_allowed,false) into facility_kind,allow_ojt from public.employees e
 join public.facilities fac on fac.id=e.facility_id left join public.staff_regulatory_policies p on p.facility_id=e.facility_id where e.id=p_employee_id;
 if facility_kind is null then return jsonb_build_object('total',0,'credits','{}'::jsonb,'remaining','{}'::jsonb); end if;
 ojt:=case when p_bucket='general_annual' and facility_kind='PCH' then 360 when p_bucket='general_annual' and facility_kind='ALR' and allow_ojt then 1000000 else 0 end;
 online:=least(online,greatest(0,coalesce((p_remaining->>'online')::numeric,online)));
 ojt:=least(ojt,greatest(0,coalesce((p_remaining->>'ojt')::numeric,ojt)));
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
  credited:=greatest(0,least(greatest(0,v.minutes-greatest(0,coalesce((p_exclude->>v.id)::numeric,0))),coalesce(p_limit,1000000)-total,case when v.medication then med else 1000000 end,case when v.resuscitation then rescue else 1000000 end,
    case when v.delivery='online' then online else 1000000 end,case when v.delivery='ojt' then ojt else 1000000 end));
  total:=total+credited;
  if credited>0 then credits:=credits||jsonb_build_object(v.id,credited); end if;
  if v.medication then med:=med-credited; end if; if v.resuscitation then rescue:=rescue-credited; end if;
  if v.delivery='online' then online:=online-credited; end if; if v.delivery='ojt' then ojt:=ojt-credited; end if;
 end loop;
 return jsonb_build_object('total',total,'credits',credits,'remaining',jsonb_build_object('medication',med,'resuscitation',rescue,'online',online,'ojt',ojt));
end $$;
revoke all on function public.staff_training_credit_allocation(uuid,text,date,date,jsonb,jsonb,numeric) from public,anon;
grant execute on function public.staff_training_credit_allocation(uuid,text,date,date,jsonb,jsonb,numeric) to authenticated,service_role;
create or replace function public.staff_eligible_training_minutes(p_employee_id uuid,p_bucket text,p_from date,p_through date)
returns numeric language sql stable set search_path='' as $$
 select (public.staff_training_credit_allocation(p_employee_id,p_bucket,p_from,p_through)->>'total')::numeric;
$$;

create or replace function public.get_staff_training_summary(p_employee_id uuid,p_as_of date default null)
returns jsonb language plpgsql stable set search_path='' as $$
declare period jsonb; previous jsonb; a jsonb; today date:=coalesce(p_as_of,public.pa_today()); f text; result jsonb; hours numeric;
 previous_hours numeric; late_credit numeric; required numeric; bucket record; prior_credits jsonb; repair_credits jsonb; current_credits jsonb; previous_start date; py integer; pm integer; pd integer;
begin
 select fac.facility_type into f from public.employees e join public.facilities fac on fac.id=e.facility_id where e.id=p_employee_id;
 if f is null then return null; end if;
 period:=public.staff_training_period(p_employee_id,today,false); a:=public.staff_training_period(p_employee_id,today,true);
 py:=extract(year from (period->>'start')::date)::integer-1; pm:=split_part(period->>'referenceMonthDay','-',1)::integer; pd:=split_part(period->>'referenceMonthDay','-',2)::integer;
 previous_start:=make_date(py,pm,least(pd,extract(day from (make_date(py,pm,1)+interval '1 month - 1 day'))::integer));
 previous:=period||jsonb_build_object('start',previous_start,'end',(period->>'start')::date-1,
   'graceThrough',(period->>'start')::date-1+((period->>'graceThrough')::date-(period->>'end')::date),
   'partialFirstYear',(period->>'hireDate')::date is null or (period->>'hireDate')::date>previous_start);
 result:=period||jsonb_build_object('previousPeriod',previous,'administratorPeriod',a,'requiredHours',case when f='ALR' then 16 else 12 end);
 for bucket in select * from (values
   ('general_annual',case when f='ALR' then 16 else 12 end,'completedHours','previousCompletedHours','previousYearOverdue'),
   ('alr_dementia',2,'alrDementiaHours','previousAlrDementiaHours','previousAlrDementiaOverdue'),
   ('sdcu_dementia',case when f='ALR' then 8 else 6 end,'specialUnitHours','previousSpecialUnitHours','previousSpecialUnitOverdue'),
   ('administrator',24,'administratorHours','previousAdministratorHours','previousAdministratorOverdue')
 ) as b(kind,required_hours,current_key,previous_key,overdue_key) loop
  if bucket.kind='administrator' then
   period:=a;
   py:=extract(year from (period->>'start')::date)::integer-1; pm:=split_part(period->>'referenceMonthDay','-',1)::integer; pd:=split_part(period->>'referenceMonthDay','-',2)::integer;
   previous_start:=make_date(py,pm,least(pd,extract(day from (make_date(py,pm,1)+interval '1 month - 1 day'))::integer));
   previous:=period||jsonb_build_object('start',previous_start,'end',(period->>'start')::date-1,
    'graceThrough',(period->>'start')::date-1+((period->>'graceThrough')::date-(period->>'end')::date),
    'partialFirstYear',(period->>'hireDate')::date is null or (period->>'hireDate')::date>previous_start);
  end if;
  prior_credits:=public.staff_training_credit_allocation(p_employee_id,bucket.kind,(previous->>'start')::date,(previous->>'end')::date);
  previous_hours:=(prior_credits->>'total')::numeric/60;
  repair_credits:=public.staff_training_credit_allocation(p_employee_id,bucket.kind,(period->>'start')::date,least(today,(previous->>'graceThrough')::date),
    '{}'::jsonb,prior_credits->'remaining',case when coalesce((previous->>'partialFirstYear')::boolean,true) then 0 else greatest(0,bucket.required_hours-previous_hours)*60 end);
  late_credit:=(repair_credits->>'total')::numeric/60;
  current_credits:=public.staff_training_credit_allocation(p_employee_id,bucket.kind,(period->>'start')::date,today,repair_credits->'credits');
  result:=result||jsonb_build_object(bucket.current_key,(current_credits->>'total')::numeric/60,bucket.previous_key,previous_hours+late_credit,
    bucket.overdue_key,not coalesce((previous->>'partialFirstYear')::boolean,true) and today>(previous->>'graceThrough')::date and previous_hours+late_credit<bucket.required_hours);
  if bucket.kind='general_annual' then result:=result||jsonb_build_object('graceHoursAllocatedToPrevious',late_credit); end if;
 end loop;
 return result;
end $$;

select public.recalculate_compliance_core(null);
