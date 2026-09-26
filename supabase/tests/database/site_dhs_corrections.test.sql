begin;
select plan(29);

insert into public.organizations (id,name,slug) values
 ('e3900000-0000-4000-8000-000000000001','Site Rules','site-rules-reg39');
insert into public.facilities (id,organization_id,name,facility_type) values
 ('e3900000-0000-4000-8000-000000000011','e3900000-0000-4000-8000-000000000001','Site PCH','PCH'),
 ('e3900000-0000-4000-8000-000000000012','e3900000-0000-4000-8000-000000000001','Other PCH','PCH');
insert into public.inspection_items (id,organization_id,facility_id,item_kind,item_type,label,inspection_interval_days) values
 ('e3900000-0000-4000-8000-000000000101','e3900000-0000-4000-8000-000000000001','e3900000-0000-4000-8000-000000000011','procedural','fire_drill_program','Monthly Drill',30),
 ('e3900000-0000-4000-8000-000000000102','e3900000-0000-4000-8000-000000000001','e3900000-0000-4000-8000-000000000011','equipment','smoke_detector','Hall Alarm',30),
 ('e3900000-0000-4000-8000-000000000103','e3900000-0000-4000-8000-000000000001','e3900000-0000-4000-8000-000000000012','equipment','smoke_detector','Other Hall Alarm',30),
 ('e3900000-0000-4000-8000-000000000104','e3900000-0000-4000-8000-000000000001','e3900000-0000-4000-8000-000000000011','equipment','fire_extinguisher','Extinguisher',365),
 ('e3900000-0000-4000-8000-000000000105','e3900000-0000-4000-8000-000000000001','e3900000-0000-4000-8000-000000000011','procedural','emergency_prep_plan_review','Emergency Plan',365),
 ('e3900000-0000-4000-8000-000000000106','e3900000-0000-4000-8000-000000000001','e3900000-0000-4000-8000-000000000011','equipment','carbon_monoxide_battery','CO Battery',365);

select is(public.inspection_item_next_due_date('smoke_detector',31,date '2026-01-31',date '2026-01-01'), date '2026-02-28','detector interval cannot skip February');
select is(public.inspection_item_next_due_date('private_water_coliform_test',92,date '2026-01-31',date '2026-01-01'), date '2026-04-30','private water uses at most three calendar months');
select throws_ok($$update public.inspection_items set inspection_interval_days=60 where id='e3900000-0000-4000-8000-000000000102'$$,'23514',null,'cannot configure a two-month detector schedule');
select lives_ok($$update public.inspection_items set inspection_interval_days=7 where id='e3900000-0000-4000-8000-000000000102'$$,'a stricter weekly schedule remains allowed');
select throws_ok($$insert into public.inspection_events(inspection_item_id,performed_date,performed_by,result,drill_time,is_sleeping_hours_drill)
 values('e3900000-0000-4000-8000-000000000101',public.pa_today(),'Inspector','pass','14:00',true)$$,'23514',null,'afternoon checkbox cannot satisfy sleeping-hours drill');
select throws_ok($$update public.inspection_items set sleeping_hours_start='22:00' where id='e3900000-0000-4000-8000-000000000101'$$,'23514',null,'custom sleeping hours require evidence');
select lives_ok($$update public.inspection_items set sleeping_hours_start='22:00',sleeping_hours_end='06:00',sleeping_hours_basis='Most residents sleep 10 PM to 6 AM; interviews and care records reviewed' where id='e3900000-0000-4000-8000-000000000101'$$,'documented custom window is allowed');

insert into public.inspection_events(id,inspection_item_id,performed_date,performed_by,result,drill_time,is_sleeping_hours_drill,
 evacuation_duration_seconds,residents_present_count,residents_evacuated_count,alarm_sounded,alarm_or_detector_operative,tested_alarm_item_ids)
values('e3900000-0000-4000-8000-000000000201','e3900000-0000-4000-8000-000000000101',public.pa_today(),'Inspector','pass','22:30',true,
 151,12,12,true,true,array['e3900000-0000-4000-8000-000000000102','e3900000-0000-4000-8000-000000000102']::uuid[]);
select is((select result from public.inspection_events where id='e3900000-0000-4000-8000-000000000201'),'deficiency_noted','a hand-selected pass cannot hide exceeding the default 150-second standard');
select ok((select evacuation_time_exceeded from public.inspection_events where id='e3900000-0000-4000-8000-000000000201'),'time finding is recorded');
select is((select count(*)::integer from public.inspection_events where inspection_item_id='e3900000-0000-4000-8000-000000000102'),1,'duplicate selected detector IDs produce only one test');
select is((select last_inspected_date from public.inspection_items where id='e3900000-0000-4000-8000-000000000102'),public.pa_today(),'working detector test counts even when evacuation took too long');
insert into public.inspection_events(inspection_item_id,performed_date,performed_by,result,drill_time,evacuation_duration_seconds,alarm_sounded,alarm_or_detector_operative)
 values('e3900000-0000-4000-8000-000000000101',public.pa_today(),'Inspector','pass','23:30',120,true,true);
select ok((select evacuation_time_exceeded from public.inspection_events where id='e3900000-0000-4000-8000-000000000201'),'later successful drill does not erase the earlier finding');
select throws_ok($$update public.inspection_events set alarm_sounded=false where id='e3900000-0000-4000-8000-000000000201'$$,'23514',null,'generated alarm-test evidence cannot be silently rewritten');
select throws_ok($$insert into public.inspection_events(inspection_item_id,performed_date,performed_by,result,tested_alarm_item_ids)
 values('e3900000-0000-4000-8000-000000000101',public.pa_today(),'Inspector','pass',array['e3900000-0000-4000-8000-000000000103']::uuid[])$$,'23514',null,'a drill cannot credit another facility alarm');

insert into public.inspection_events(id,inspection_item_id,performed_date,performed_by,result)
 values('e3900000-0000-4000-8000-000000000204','e3900000-0000-4000-8000-000000000104',public.pa_today(),'Inspector','fail');
select throws_ok($$update public.inspection_events set result='pass' where id='e3900000-0000-4000-8000-000000000204'$$,'23514',null,'fail-to-pass cannot bypass the expert evidence guard');
select lives_ok($$update public.inspection_events set result='pass',fire_safety_expert_name='Qualified Inspector',fire_safety_expert_qualification='Fire safety expert qualification on file' where id='e3900000-0000-4000-8000-000000000204'$$,'expert identity and qualification permit approval');
select throws_ok($$update public.inspection_events set fire_safety_expert_name=null,regulatory_evidence_version=0 where id='e3900000-0000-4000-8000-000000000204'$$,'23514',null,'a modern pass cannot discard expert evidence or downgrade its validation version');
select throws_ok($$insert into public.inspection_events(inspection_item_id,performed_date,performed_by,result)
 values('e3900000-0000-4000-8000-000000000105',public.pa_today(),'Inspector','pass')$$,'23514',null,'annual emergency plan pass requires agency submission date');
select throws_ok($$insert into public.inspection_events(inspection_item_id,performed_date,performed_by,result)
 values('e3900000-0000-4000-8000-000000000106',public.pa_today(),'Inspector','pass')$$,'23514',null,'CO battery pass requires evidence');
select lives_ok($$insert into public.inspection_events(id,inspection_item_id,performed_date,performed_by,result,notes)
 values('e3900000-0000-4000-8000-000000000206','e3900000-0000-4000-8000-000000000106',public.pa_today(),'Inspector','pass','Battery replaced today and installation date labeled; alarm identifier Hall CO-1')$$,'CO battery replacement is recorded and scheduled');
select throws_ok($$update public.inspection_events set notes=null where id='e3900000-0000-4000-8000-000000000206'$$,'23514',null,'passing CO record cannot erase required evidence');
insert into public.inspection_events(id,inspection_item_id,performed_date,performed_by,result,alarm_or_detector_operative)
 values('e3900000-0000-4000-8000-000000000207','e3900000-0000-4000-8000-000000000101',public.pa_today(),'Inspector','pass',true);
select is((select result from public.inspection_events where id='e3900000-0000-4000-8000-000000000207'),'deficiency_noted','an unrecorded alarm activation cannot certify a passing drill');
select is((select regulatory_evidence_version::integer from public.inspection_events where id='e3900000-0000-4000-8000-000000000207'),1,'new records always receive the current validation version');
select ok((select qual like '%evacuation_time_exceeded%' from pg_policies where schemaname='public' and tablename='inspection_events' and policyname='inspection_events_delete'),'direct deletion cannot remove an observed time breach');

-- Reproduce a record created before these columns/validation existed.
alter table public.inspection_events disable trigger validate_regulatory_evidence;
insert into public.inspection_events(id,inspection_item_id,performed_date,performed_by,result,evacuation_duration_seconds,alarm_sounded,alarm_or_detector_operative)
 values('e3900000-0000-4000-8000-000000000208','e3900000-0000-4000-8000-000000000101',public.pa_today(),'Legacy inspector','fail',200,true,true);
alter table public.inspection_events enable trigger validate_regulatory_evidence;
update public.inspection_events set result='pass' where id='e3900000-0000-4000-8000-000000000208';
select is((select evacuation_limit_seconds from public.inspection_events where id='e3900000-0000-4000-8000-000000000208'),150,'a legacy failure gains the applicable fallback standard before validation');
select is((select result from public.inspection_events where id='e3900000-0000-4000-8000-000000000208'),'deficiency_noted','a 200-second legacy failure cannot become a pass through a NULL standard');
select ok((select evacuation_time_exceeded from public.inspection_events where id='e3900000-0000-4000-8000-000000000208'),'legacy correction retains the observed time breach');

insert into public.inspection_items(id,organization_id,facility_id,item_kind,item_type,label,inspection_interval_days)
 values('e3900000-0000-4000-8000-000000000107','e3900000-0000-4000-8000-000000000001','e3900000-0000-4000-8000-000000000011','equipment','smoke_detector','Second Hall Alarm',30);
select throws_ok($$insert into public.inspection_events(inspection_item_id,performed_date,performed_by,result,alarm_sounded,alarm_or_detector_operative,tested_alarm_item_ids)
 values('e3900000-0000-4000-8000-000000000101',public.pa_today(),'Inspector','pass',true,true,array['e3900000-0000-4000-8000-000000000102','e3900000-0000-4000-8000-000000000107']::uuid[])$$,
 '23514','A drill can credit one alarm or detector; record separate test results for additional devices','aggregate drill results cannot credit multiple devices');
select is((select count(*)::integer from public.inspection_events where inspection_item_id='e3900000-0000-4000-8000-000000000107'),0,'rejected aggregate test does not advance another device');

select * from finish();
rollback;
