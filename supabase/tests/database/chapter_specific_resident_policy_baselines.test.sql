begin;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$
  select ('b9270000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
insert into public.organizations(id,name,slug,subscription_status)
values(pg_temp.id(1),'Chapter resident policy tests','chapter-resident-policy-tests','active');
insert into public.facilities(id,organization_id,name,facility_type) values
  (pg_temp.id(11),pg_temp.id(1),'PCH baseline','PCH'),
  (pg_temp.id(12),pg_temp.id(1),'ALR baseline','ALR');
insert into public.facilities(id,organization_id,name,facility_type,resident_regulatory_policy) values
  (pg_temp.id(13),pg_temp.id(1),'Recorded ALR policy','ALR',
  '{"alf_admission_grace_days":0,"alf_contract_timing":"before_admission","revision_grace_days":0,"medication_reportability":"all_events","decision_reason":"Recorded earlier facility targets","decided_at":"2026-09-01T12:00:00Z"}');

select is((select resident_regulatory_policy->>'alf_contract_timing' from public.facilities where id=pg_temp.id(12)),
  'within_24_hours','new ALR facility uses the 2800.22(a)(5) contract window');
select is((select resident_regulatory_policy->>'medication_reportability' from public.facilities where id=pg_temp.id(11)),
  'statutory_errors','PCH does not presume all medication events are statutory errors');
select is((select resident_regulatory_policy->>'revision_grace_days' from public.facilities where id=pg_temp.id(12)),
  '5','new ALR recurring plan revisions include the RCG grace');
select is((select resident_regulatory_policy->>'alf_contract_timing' from public.facilities where id=pg_temp.id(13)),
  'before_admission','an explicit earlier contract policy is preserved');

insert into public.residents(id,organization_id,facility_id,first_name,last_name,admission_date,status) values
  (pg_temp.id(21),pg_temp.id(1),pg_temp.id(11),'PCH','Resident',public.pa_today(),'active'),
  (pg_temp.id(22),pg_temp.id(1),pg_temp.id(12),'ALR','Resident',public.pa_today(),'active');
select is((select due_date from public.resident_compliance_items where resident_id=pg_temp.id(21) and item_type='initial_assessment_15day'),
  public.pa_today()+15,'PCH initial assessment is after admission');
select is((select due_date from public.resident_compliance_items where resident_id=pg_temp.id(22) and item_type='initial_assessment_15day'),
  public.pa_today(),'standard ALR initial assessment is due by admission');
select is((select grace_period_days from public.resident_compliance_items where resident_id=pg_temp.id(22) and item_type='support_plan_30day'),
  0,'ALR initial final support plan does not receive recurring revision grace');
insert into public.resident_compliance_items(organization_id,facility_id,resident_id,item_type,due_date,triggered_by_item_id)
select organization_id,facility_id,resident_id,'support_plan_30day',public.pa_today()+30,id
from public.resident_compliance_items where resident_id in (pg_temp.id(21),pg_temp.id(22)) and item_type='initial_assessment_15day';
select is((select count(*)::integer from public.resident_compliance_items where resident_id in (pg_temp.id(21),pg_temp.id(22))
  and item_type='support_plan_30day' and triggered_by_item_id is not null and grace_period_days=5),
  2,'both chapters recurring revisions use their RCG grace without changing initial plan deadlines');

insert into public.incidents(id,organization_id,facility_id,incident_type,occurred_at,narrative,pathway_key,pathway_answers) values
  (pg_temp.id(31),pg_temp.id(1),pg_temp.id(11),'medication_error',now(),'Intercepted staff near miss','medication_event',
    '{"event_kind":"near_miss","administration_by":"staff","error_category":"wrong_dose"}'),
  (pg_temp.id(32),pg_temp.id(1),pg_temp.id(12),'medication_error',now(),'Actual staff wrong dose','medication_event',
    '{"event_kind":"actual_error","administration_by":"staff","error_category":"wrong_dose"}'),
  (pg_temp.id(33),pg_temp.id(1),pg_temp.id(13),'medication_error',now(),'Additional facility reporting policy','medication_event',
    '{"event_kind":"near_miss","administration_by":"staff","error_category":"wrong_dose"}');
select is((select reportability_status from public.incidents where id=pg_temp.id(31)),
  'pending_review','a near miss needs review without an automatic statutory report');
select is((select count(*)::integer from public.incident_notifications where incident_id=pg_temp.id(31) and notification_type='state_hotline'),
  0,'near miss does not automatically create a DHS report deadline');
select is((select reportability_status from public.incidents where id=pg_temp.id(32)),
  'reportable','actual staff prescription error is still reportable by default');
select is((select count(*)::integer from public.incident_notifications where incident_id=pg_temp.id(32) and notification_type='state_hotline'),
  1,'actual error still creates the DHS report obligation');
select is((select reportability_status from public.incidents where id=pg_temp.id(33)),
  'reportable','an explicitly chosen additional reporting policy remains effective');
select * from finish();
rollback;
