begin;
select no_plan();
insert into public.organizations(id,name,slug,subscription_status) values
('aa260000-0000-4000-8000-000000000001','Resident regulatory tests','resident-regulatory-tests','active');
insert into public.facilities(id,organization_id,name,facility_type) values
('aa260000-0000-4000-8000-000000000011','aa260000-0000-4000-8000-000000000001','PCH','PCH'),
('aa260000-0000-4000-8000-000000000012','aa260000-0000-4000-8000-000000000001','ALF','ALR');
insert into public.incidents(id,organization_id,facility_id,incident_type,occurred_at,reported_at,narrative) values
('aa260000-0000-4000-8000-000000000101','aa260000-0000-4000-8000-000000000001','aa260000-0000-4000-8000-000000000011','food_poisoning',now(),now(),'Documented food poisoning requiring a Department report'),
('aa260000-0000-4000-8000-000000000102','aa260000-0000-4000-8000-000000000001','aa260000-0000-4000-8000-000000000012','food_poisoning',now(),now(),'Documented food poisoning requiring a Department report'),
('aa260000-0000-4000-8000-000000000103','aa260000-0000-4000-8000-000000000001','aa260000-0000-4000-8000-000000000011','medication_error',now(),now(),'Wrong medication administered by a staff member');
select is((select count(*)::integer from public.incident_notifications where incident_id='aa260000-0000-4000-8000-000000000101' and notification_type in ('resident_family','designated_person')),0,'PCH food poisoning does not receive ALF-only family duties');
select is((select count(*)::integer from public.incident_notifications where incident_id='aa260000-0000-4000-8000-000000000102' and notification_type in ('resident_family','designated_person') and due_at=now()),2,'ALF family and designated person each have an immediate notification');
select is((select due_at from public.incident_notifications where incident_id='aa260000-0000-4000-8000-000000000101' and notification_type='state_hotline'),now()+interval '24 hours','moderate food poisoning receives the 24-hour Department duty');
select is((select count(*)::integer from public.incident_notifications where incident_id='aa260000-0000-4000-8000-000000000103' and notification_type in ('resident','designated_person','prescriber') and due_at=now()),3,'PCH medication errors notify all three 188(b) recipients immediately');
select throws_ok($$insert into public.incidents(organization_id,facility_id,incident_type,occurred_at,narrative) values('aa260000-0000-4000-8000-000000000001','aa260000-0000-4000-8000-000000000011','inadequate_staffing',now(),'This ALF-only category cannot be used for a PCH')$$,'22023',null,'the ALF staffing category cannot bypass chapter scope through the API');
select is(app_private.incident_rule_due_at('2026-09-25 22:00:00+00',0,'same_business_day'),'2026-09-28 12:00:00+00'::timestamptz,'an after-hours Friday Aging report is reminded at Monday opening');
select is(app_private.incident_rule_due_at('2026-09-25 15:00:00+00',0,'same_business_day'),'2026-09-25 21:00:00+00'::timestamptz,'a daytime Aging report stays within that business day');
select ok(not has_function_privilege('authenticated','app_private.complete_resident_compliance_item_core(uuid,uuid,date)','EXECUTE'),'clients cannot bypass the final-plan review wrapper');
select has_function('public','complete_move_in_admission',array['uuid','text','date'],'admission accepts the actual first day of residence');
select throws_ok($$insert into public.incident_notifications(organization_id,facility_id,incident_id,notification_type,due_at,status,completed_at)
values('aa260000-0000-4000-8000-000000000001','aa260000-0000-4000-8000-000000000011','aa260000-0000-4000-8000-000000000103','prescriber',now(),'completed',now())$$,
'23514',null,'an already-completed insert cannot bypass prescriber response evidence');
update public.incident_notifications set status='completed',completed_at=now(),recipient='Prescribing practitioner',notes=notes||E'\nPractitioner requested monitoring and follow-up examination.'
where incident_id='aa260000-0000-4000-8000-000000000103' and notification_type='prescriber';
select throws_ok($$update public.incident_notifications set notes=null where incident_id='aa260000-0000-4000-8000-000000000103' and notification_type='prescriber'$$,
'23514',null,'completed prescriber evidence cannot be erased');
insert into public.employees(id,organization_id,facility_id,first_name,last_name,job_title,hire_date,status) values
('aa260000-0000-4000-8000-000000000201','aa260000-0000-4000-8000-000000000001','aa260000-0000-4000-8000-000000000011','First','Staff','Direct Care Staff',public.pa_today(),'active'),
('aa260000-0000-4000-8000-000000000202','aa260000-0000-4000-8000-000000000001','aa260000-0000-4000-8000-000000000011','Second','Staff','Direct Care Staff',public.pa_today(),'active');
insert into public.incidents(id,organization_id,facility_id,incident_type,occurred_at,narrative) values
('aa260000-0000-4000-8000-000000000104','aa260000-0000-4000-8000-000000000001','aa260000-0000-4000-8000-000000000011','other',now(),'An allegation awaiting classification');
insert into public.incident_staff_involved(organization_id,facility_id,incident_id,employee_id,involvement_type)
values('aa260000-0000-4000-8000-000000000001','aa260000-0000-4000-8000-000000000011','aa260000-0000-4000-8000-000000000104','aa260000-0000-4000-8000-000000000201','involved_party');
update public.incidents set incident_type='neglect_allegation' where id='aa260000-0000-4000-8000-000000000104';
select is((select count(*)::integer from public.incident_notifications where incident_id='aa260000-0000-4000-8000-000000000104' and notification_type='supervision_plan'),1,'reclassifying an event seeds supervision for already-linked accused staff');
update public.incident_notifications set status='completed',completed_at=now() where incident_id='aa260000-0000-4000-8000-000000000104' and notification_type='supervision_plan';
insert into public.incident_staff_involved(organization_id,facility_id,incident_id,employee_id,involvement_type)
values('aa260000-0000-4000-8000-000000000001','aa260000-0000-4000-8000-000000000011','aa260000-0000-4000-8000-000000000104','aa260000-0000-4000-8000-000000000202','involved_party');
select is((select count(*)::integer from public.incident_notifications where incident_id='aa260000-0000-4000-8000-000000000104' and notification_type='supervision_plan' and status='pending'),1,'a subsequently accused staff person gets a new duty while the first completion remains intact');
select * from finish();
rollback;
