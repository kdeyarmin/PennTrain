begin;
select no_plan();
insert into public.organizations(id,name,slug) values('a2380000-0000-4000-8000-000000000001','Staff policy tests','staff-policy-tests');
insert into public.facilities(id,organization_id,name,facility_type) values('a2380000-0000-4000-8000-000000000011','a2380000-0000-4000-8000-000000000001','Policy PCH','PCH');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change,email_change_token_current,reauthentication_token,is_sso_user,is_anonymous)
values('00000000-0000-0000-0000-000000000000','a2380000-0000-4000-8000-000000000101','authenticated','authenticated','staff-policy@test.local','x',now(),'{}','{}',now(),now(),'','','','','','',false,false);
select set_config('app.privileged_write','on',true);
insert into public.profiles(id,organization_id,email,first_name,last_name,role,is_active) values
('a2380000-0000-4000-8000-000000000101','a2380000-0000-4000-8000-000000000001','staff-policy@test.local','Policy','Admin','org_admin',true)
on conflict(id) do update set organization_id=excluded.organization_id,role=excluded.role;
select set_config('app.privileged_write','off',true);
insert into public.employees(id,organization_id,facility_id,first_name,last_name,job_title,hire_date) values
('a2380000-0000-4000-8000-000000000021','a2380000-0000-4000-8000-000000000001','a2380000-0000-4000-8000-000000000011','Clock','Test','Direct care','2026-01-01'),
('a2380000-0000-4000-8000-000000000022','a2380000-0000-4000-8000-000000000001','a2380000-0000-4000-8000-000000000011','Partial','Year','Direct care','2026-11-01'),
('a2380000-0000-4000-8000-000000000023','a2380000-0000-4000-8000-000000000001','a2380000-0000-4000-8000-000000000011','Full','Year','Direct care','2020-01-01');
select ok(not exists(select 1 from public.employee_credentials where employee_id='a2380000-0000-4000-8000-000000000021' and credential_type='tb_screening'),'staff TB is not auto-required by either chapter');
select ok(exists(select 1 from public.employee_onboarding_items i join public.onboarding_checklist_templates t on t.id=i.template_id where i.employee_id='a2380000-0000-4000-8000-000000000021' and t.code='PCH-ADL-COMPETENCY' and i.status='pending' and i.is_blocking),'PCH independent ADL needs evidence');
select is((select applies_to_facility_type from public.onboarding_checklist_templates where code='CPR-BEFORE-CARE' and organization_id is null),'ALR','before-care CPR is an ALF default');
select is((select deadline_basis from public.onboarding_checklist_templates where code='ALR-18HR-INITIAL' and organization_id is null),'none','ALF initial training gates unsupervised service, not an invented90 days');
insert into public.employee_background_check_profiles(organization_id,facility_id,employee_id,pa_resident_two_years,provisional_start_date,psp_requested_on,fbi_requested_on,non_disqualification_statement_signed,supervision_attestation_confirmed)
values('a2380000-0000-4000-8000-000000000001','a2380000-0000-4000-8000-000000000011','a2380000-0000-4000-8000-000000000021',null,'2026-01-01','2026-01-01','2026-01-01',true,true);
select is(public.oapsa_duty_status('a2380000-0000-4000-8000-000000000021','2026-01-31')->>'bar',null,'PSP remains provisional through day30');
select is(public.oapsa_duty_status('a2380000-0000-4000-8000-000000000021','2026-02-01')->>'reason','PSP 30-day provisional clock expired','nonresident/unknown PSP does not get90 days');
update public.employee_credentials set issue_date='2026-01-05',status='compliant' where employee_id='a2380000-0000-4000-8000-000000000021' and credential_type='act34_criminal_history';
select is(public.oapsa_duty_status('a2380000-0000-4000-8000-000000000021','2026-02-15')->>'clearancesOnFile','false','unknown residency never treats PSP alone as all checks');
select is(public.oapsa_duty_status('a2380000-0000-4000-8000-000000000021','2026-04-01')->>'bar',null,'FBI remains provisional through day90');
select is(public.oapsa_duty_status('a2380000-0000-4000-8000-000000000021','2026-04-02')->>'reason','FBI 90-day provisional clock expired','FBI has its independent90-day deadline');
update public.employee_credentials set issue_date='2026-03-01',status='compliant' where employee_id='a2380000-0000-4000-8000-000000000021' and credential_type='act73_fbi_fingerprint';
select is(public.oapsa_duty_status('a2380000-0000-4000-8000-000000000021','2026-04-02')->>'clearancesOnFile','true','received required checks end provisional tracking');
select is((select policy_renewal_due_date from public.employee_credentials where employee_id='a2380000-0000-4000-8000-000000000021' and credential_type='act34_criminal_history'),'2031-01-05'::date,'five-year policy renewal uses issue date');
select is((select expiration_date from public.employee_credentials where employee_id='a2380000-0000-4000-8000-000000000021' and credential_type='act34_criminal_history'),null::date,'policy recurrence preserves original expiration evidence');
update public.employee_credentials set issue_date=null,status='missing' where employee_id='a2380000-0000-4000-8000-000000000021' and credential_type='act34_criminal_history';
update public.employee_background_check_profiles set psp_requested_on='2026-01-02' where employee_id='a2380000-0000-4000-8000-000000000021';
select is(public.oapsa_duty_status('a2380000-0000-4000-8000-000000000021','2026-01-15')->>'requestsOnTime','false','late clearance requests cannot establish provisional work');
select ok(not has_function_privilege('anon','public.save_staff_regulatory_settings(uuid,uuid,jsonb)','EXECUTE'),'anonymous policy writes are denied');
select throws_ok($$select public.save_staff_regulatory_settings('a2380000-0000-4000-8000-000000000011',null,'{}')$$,'42501',null,'policy RPC requires an authenticated manager');
select ok(not has_function_privilege('authenticated','public.schedule_staff_care_coverage(uuid)','EXECUTE'),'staff coverage cannot bypass schedule scope authorization');
select is((public.get_staff_training_summary('a2380000-0000-4000-8000-000000000022','2026-12-15')->>'partialFirstYear')::boolean,true,'November hire does not owe a full partial calendar year');
select is((public.get_staff_training_summary('a2380000-0000-4000-8000-000000000023','2026-01-16')->>'previousYearOverdue')::boolean,true,'rollover does not erase the preceding full-year deficiency');
insert into public.training_facility_policies(organization_id,facility_id,effective_from,year_basis,year_start,administrator_year_basis,administrator_year_start,policy_reference,created_by)
values('a2380000-0000-4000-8000-000000000001','a2380000-0000-4000-8000-000000000011','2026-01-01','fixed','07-01','fixed','07-01','Fiscal-year policy','a2380000-0000-4000-8000-000000000101');
select is(public.staff_training_period('a2380000-0000-4000-8000-000000000023','2026-06-30')->>'start','2025-07-01','core reads the documented fiscal year');
select is(public.staff_training_period('a2380000-0000-4000-8000-000000000023','2026-06-30')->>'graceThrough','2026-07-15','15-day grace follows the actual training-year end');
insert into public.training_evidence_events(organization_id,facility_id,employee_id,title,completed_on,minutes,delivery,provider,source_reference,provider_qualification,topics,allocations,status,created_by)
values
('a2380000-0000-4000-8000-000000000001','a2380000-0000-4000-8000-000000000011','a2380000-0000-4000-8000-000000000023','Medication course','2026-02-01',600,'classroom','Approved trainer','med-course','Current trainer',array['medication_authorization'],'{"base":600}','verified','a2380000-0000-4000-8000-000000000101'),
('a2380000-0000-4000-8000-000000000001','a2380000-0000-4000-8000-000000000011','a2380000-0000-4000-8000-000000000023','First aid skills','2026-02-02',360,'classroom','Approved trainer','first-aid','Current instructor',array['first_aid','cpr','airway'],'{"base":360}','verified','a2380000-0000-4000-8000-000000000101'),
('a2380000-0000-4000-8000-000000000001','a2380000-0000-4000-8000-000000000011','a2380000-0000-4000-8000-000000000023','Orientation','2026-02-03',120,'classroom','Approved trainer','orientation','Qualified source',array['facility_orientation'],'{"initial":120}','verified','a2380000-0000-4000-8000-000000000101');
select is(public.staff_eligible_training_minutes('a2380000-0000-4000-8000-000000000023','general_annual','2025-07-01','2026-06-30'),720::numeric,'6h medication +4h emergency +2h orientation credit exactly12h');
select is((public.get_staff_training_summary('a2380000-0000-4000-8000-000000000023','2026-06-30')->>'completedHours')::numeric,12::numeric,'core summary and Train use the same numerator');
select throws_ok($$update public.employee_onboarding_items i set status='completed' from public.onboarding_checklist_templates t where i.template_id=t.id and t.code='PCH-ADL-COMPETENCY' and i.employee_id='a2380000-0000-4000-8000-000000000021'$$,'23514',null,'a checkbox cannot bypass missing ADL evidence');
-- A grace-period source is allocated before the following year's source caps.
insert into public.employees(id,organization_id,facility_id,first_name,last_name,job_title,hire_date)
values('a2380000-0000-4000-8000-000000000024','a2380000-0000-4000-8000-000000000001','a2380000-0000-4000-8000-000000000011','Grace','Allocation','Direct care','2020-01-01');
insert into public.training_evidence_events(organization_id,facility_id,employee_id,title,completed_on,minutes,delivery,provider,source_reference,provider_qualification,topics,allocations,status,created_by)
select 'a2380000-0000-4000-8000-000000000001','a2380000-0000-4000-8000-000000000011','a2380000-0000-4000-8000-000000000024',
 title,completed_on,minutes,'classroom','Approved trainer',title,'Current instructor',topics,allocations,'verified','a2380000-0000-4000-8000-000000000101'
from (values
 ('General prior year',date '2025-11-01',600,array['personal_care'],'{"base":600}'::jsonb),
 ('Grace medication',date '2026-07-01',120,array['medication_authorization'],'{"base":120}'::jsonb),
 ('Current medication',date '2026-08-01',360,array['medication_authorization'],'{"base":360}'::jsonb),
 ('Prior special unit',date '2025-11-01',300,array['dementia'],'{"special_annual":300}'::jsonb),
 ('Grace special unit',date '2026-07-01',60,array['dementia'],'{"special_annual":60}'::jsonb),
 ('Prior dementia',date '2025-11-01',60,array['dementia'],'{"dementia_annual":60}'::jsonb),
 ('Grace dementia',date '2026-07-01',60,array['dementia'],'{"dementia_annual":60}'::jsonb)
)v(title,completed_on,minutes,topics,allocations);
select is((public.get_staff_training_summary('a2380000-0000-4000-8000-000000000024','2026-08-31')->>'completedHours')::numeric,6::numeric,'prior-year medication repair does not consume the new-year six-hour cap');
select is((public.get_staff_training_summary('a2380000-0000-4000-8000-000000000024','2026-08-31')->>'previousCompletedHours')::numeric,12::numeric,'grace medication hours finish the prior year exactly once');
select is((public.get_staff_training_summary('a2380000-0000-4000-8000-000000000024','2026-08-31')->>'previousSpecialUnitHours')::numeric,6::numeric,'special-unit annual hours receive the selected grace period');
select is((public.get_staff_training_summary('a2380000-0000-4000-8000-000000000024','2026-08-31')->>'previousAlrDementiaHours')::numeric,2::numeric,'dementia annual hours receive the selected grace period');
select is((public.get_staff_training_summary('a2380000-0000-4000-8000-000000000024','2026-08-31')->>'specialUnitHours')::numeric,0::numeric,'special-unit grace hours are not counted twice');

insert into public.facilities(id,organization_id,name,facility_type) values('a2380000-0000-4000-8000-000000000012','a2380000-0000-4000-8000-000000000001','Float primary site','NH');
insert into public.employees(id,organization_id,facility_id,first_name,last_name,job_title,hire_date)
values('a2380000-0000-4000-8000-000000000025','a2380000-0000-4000-8000-000000000001','a2380000-0000-4000-8000-000000000012','Float','Worker','Direct care','2020-01-01');
insert into public.employee_facility_assignments(organization_id,facility_id,employee_id)
values('a2380000-0000-4000-8000-000000000001','a2380000-0000-4000-8000-000000000011','a2380000-0000-4000-8000-000000000025');
select ok(public.evaluate_schedule_eligibility('a2380000-0000-4000-8000-000000000025','a2380000-0000-4000-8000-000000000011',now()+interval '1 day',now()+interval '1 day 8 hours')->'hardBlocks' @> '["staff_qualification_evidence_missing"]'::jsonb,
 'qualification rules follow the assigned PCH even when the employee primary site is NH');
insert into public.employees(id,organization_id,facility_id,first_name,last_name,job_title)
values('a2380000-0000-4000-8000-000000000026','a2380000-0000-4000-8000-000000000001','a2380000-0000-4000-8000-000000000011','Unknown','Hire date','Direct care');
select is((public.staff_training_period('a2380000-0000-4000-8000-000000000026')->>'hireDateMissing')::boolean,true,'unknown employment date is reported explicitly');
select is((public.staff_training_period('a2380000-0000-4000-8000-000000000026')->>'partialFirstYear')::boolean,false,'missing date is not evidence of a partial first year');
insert into public.employee_credentials(id,organization_id,facility_id,employee_id,credential_type,issue_date,expiration_date)
values('a2380000-0000-4000-8000-000000000046','a2380000-0000-4000-8000-000000000001','a2380000-0000-4000-8000-000000000011','a2380000-0000-4000-8000-000000000026','tb_screening',public.pa_today()-30,public.pa_today()+365);
select is((select status from public.employee_credentials where id='a2380000-0000-4000-8000-000000000046'),'not_applicable','optional TB evidence is preserved without creating a chapter requirement');
insert into public.staff_regulatory_policies(facility_id,organization_id,staff_tb_required,policy_reference,updated_by)
values('a2380000-0000-4000-8000-000000000011','a2380000-0000-4000-8000-000000000001',true,'Employer TB policy adopted with prior dated evidence','a2380000-0000-4000-8000-000000000101');
select is((select status from public.employee_credentials where id='a2380000-0000-4000-8000-000000000046'),'compliant','enabling the employer TB policy immediately reuses existing valid evidence');
update public.staff_regulatory_policies set staff_tb_required=false where facility_id='a2380000-0000-4000-8000-000000000011';
select is((select issue_date from public.employee_credentials where id='a2380000-0000-4000-8000-000000000046'),public.pa_today()-30,'turning optional TB tracking off preserves its actual issue date');
select * from finish();
rollback;
