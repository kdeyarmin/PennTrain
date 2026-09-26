begin;
select plan(16);

select is((select applies_to_track from public.onboarding_checklist_templates where organization_id is null and code='ORIENT-40HR'),'all','the statutory 40-hour orientation covers agency, substitutes and volunteers');
select is((select deadline_value::integer from public.onboarding_checklist_templates where organization_id is null and code='DAY1-FIRE-EP'),0,'fire orientation is due on day one, not the following day');
select is((select deadline_value::integer from public.onboarding_checklist_templates where organization_id is null and code='BGCHECK-INITIATED'),0,'checks must be initiated by the first work day');
select ok(not has_function_privilege('authenticated','public.schedule_emergency_coverage(uuid)','EXECUTE'),'the census helper cannot bypass the schedule authorization gate');
select ok(not has_function_privilege('authenticated','public.staff_emergency_qualification_mask(uuid,timestamp with time zone,timestamp with time zone)','EXECUTE'),'individual staff evidence helper is not exposed');

insert into public.organizations(id,name,slug) values ('a2370000-0000-4000-8000-000000000001','Staff regulatory tests','staff-regulatory-tests');
insert into public.facilities(id,organization_id,name,facility_type) values
('a2370000-0000-4000-8000-000000000011','a2370000-0000-4000-8000-000000000001','Emergency coverage','PCH');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change,email_change_token_current,reauthentication_token,is_sso_user,is_anonymous)
values ('00000000-0000-0000-0000-000000000000','a2370000-0000-4000-8000-000000000101','authenticated','authenticated','staff-regulatory@test.local','x',now(),'{}','{}',now(),now(),'','','','','','',false,false);
select set_config('app.privileged_write','on',true);
insert into public.profiles(id,organization_id,email,first_name,last_name,role,is_active)
values ('a2370000-0000-4000-8000-000000000101','a2370000-0000-4000-8000-000000000001','staff-regulatory@test.local','Staff','Admin','org_admin',true)
on conflict(id) do update set organization_id=excluded.organization_id,role=excluded.role;
select set_config('app.privileged_write','off',true);
insert into public.employees(id,organization_id,facility_id,first_name,last_name,worker_type,hire_date) values
('a2370000-0000-4000-8000-000000000021','a2370000-0000-4000-8000-000000000001','a2370000-0000-4000-8000-000000000011','First','Aid','agency','2026-01-01'),
('a2370000-0000-4000-8000-000000000022','a2370000-0000-4000-8000-000000000001','a2370000-0000-4000-8000-000000000011','CPR','Airway','regular','2026-01-01');
select ok(exists(select 1 from public.employee_onboarding_items i join public.onboarding_checklist_templates t on t.id=i.template_id where i.employee_id='a2370000-0000-4000-8000-000000000021' and t.code='ORIENT-40HR' and i.is_blocking),'agency staff receive the full orientation evidence request');
select ok(exists(select 1 from public.employee_credentials where employee_id='a2370000-0000-4000-8000-000000000021' and credential_type='tb_screening' and citation_topic_id is null),'retained facility-policy TB screening is not attributed to criminal-history regulation');
insert into public.training_staff_profiles(employee_id,organization_id,facility_id,duties,first_work_date,confirmed_by) values
('a2370000-0000-4000-8000-000000000021','a2370000-0000-4000-8000-000000000001','a2370000-0000-4000-8000-000000000011','Personal care','2026-01-03','a2370000-0000-4000-8000-000000000101');
select is((select i.due_date from public.employee_onboarding_items i join public.onboarding_checklist_templates t on t.id=i.template_id where i.employee_id='a2370000-0000-4000-8000-000000000021' and t.code='DAY1-FIRE-EP'),'2026-01-03'::date,'a documented first work date supersedes the hire-date fallback');
update public.training_staff_profiles set first_work_date=null where employee_id='a2370000-0000-4000-8000-000000000021';
select is((select i.due_date from public.employee_onboarding_items i join public.onboarding_checklist_templates t on t.id=i.template_id where i.employee_id='a2370000-0000-4000-8000-000000000021' and t.code='DAY1-FIRE-EP'),'2026-01-01'::date,'clearing a first-work date restores hire-date fallback instead of erasing the deadline');
insert into public.training_evidence_events(organization_id,facility_id,employee_id,title,completed_on,minutes,delivery,provider,source_reference,provider_qualification,topics,valid_until,created_by,status,review_note) values
('a2370000-0000-4000-8000-000000000001','a2370000-0000-4000-8000-000000000011','a2370000-0000-4000-8000-000000000021','First aid certificate','2026-01-03',120,'external','Certified trainer','first-aid-cert','Current trainer certificate',array['first_aid'],'2027-01-03','a2370000-0000-4000-8000-000000000101','verified','Certificate reviewed'),
('a2370000-0000-4000-8000-000000000001','a2370000-0000-4000-8000-000000000011','a2370000-0000-4000-8000-000000000022','CPR airway certificate','2026-01-03',120,'hybrid','Certified trainer','cpr-airway-cert','Current trainer certificate',array['cpr','airway'],'2027-01-03','a2370000-0000-4000-8000-000000000101','verified','Skills session reviewed');
select is(public.staff_emergency_qualification_mask('a2370000-0000-4000-8000-000000000021','2026-09-26 08:00-04','2026-09-26 16:00-04'),1,'first aid alone does not imply CPR or airway');
select is(public.staff_emergency_qualification_mask('a2370000-0000-4000-8000-000000000022','2026-09-26 08:00-04','2026-09-26 16:00-04'),6,'CPR with airway retains both skills');
insert into public.residents(organization_id,facility_id,first_name,last_name,admission_date,status)
select 'a2370000-0000-4000-8000-000000000001','a2370000-0000-4000-8000-000000000011','Resident',n::text,'2026-01-01','active' from generate_series(1,36) n;
insert into public.schedules(id,organization_id,facility_id,period_start,period_end) values
('a2370000-0000-4000-8000-000000000031','a2370000-0000-4000-8000-000000000001','a2370000-0000-4000-8000-000000000011','2026-09-26','2026-09-26');
-- Coverage is a read-side test; authorization of assigning shifts is covered separately.
alter table public.shift_assignments disable trigger enforce_shift_assignment_eligibility;
insert into public.shift_assignments(organization_id,schedule_id,facility_id,employee_id,shift_date,start_time,end_time)
select 'a2370000-0000-4000-8000-000000000001','a2370000-0000-4000-8000-000000000031','a2370000-0000-4000-8000-000000000011',id,'2026-09-26','08:00','16:00'
from public.employees where id in ('a2370000-0000-4000-8000-000000000021','a2370000-0000-4000-8000-000000000022');
alter table public.shift_assignments enable trigger enforce_shift_assignment_eligibility;
select is(jsonb_array_length(public.schedule_emergency_coverage('a2370000-0000-4000-8000-000000000031')),3,'coverage includes the unstaffed intervals before and after the shift');
select is((public.schedule_emergency_coverage('a2370000-0000-4000-8000-000000000031')->1->>'required')::integer,1,'36 PCH residents require one in each skill group');
select ok((public.schedule_emergency_coverage('a2370000-0000-4000-8000-000000000031')->1 @> '{"first_aid":1,"cpr_airway":1}'),'the RCG permits separate first-aid and CPR/airway staff');
select is((public.schedule_emergency_coverage('a2370000-0000-4000-8000-000000000031')->0->>'first_aid')::integer,0,'an unstaffed interval has no invented coverage');
update public.facilities set facility_type='ALR' where id='a2370000-0000-4000-8000-000000000011';
select is((public.schedule_emergency_coverage('a2370000-0000-4000-8000-000000000031')->1->>'required')::integer,2,'36 ALF residents require two in each skill group');
select * from finish();
rollback;
