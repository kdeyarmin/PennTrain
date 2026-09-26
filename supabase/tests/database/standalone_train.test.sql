begin;
-- Lifecycle effective dates use the Pennsylvania calendar. UTC is already tomorrow
-- during evening CI runs, so CURRENT_DATE must use the same calendar as the RPC.
set local timezone = 'America/New_York';
select no_plan();
insert into public.organizations(id,name,slug,subscription_status,trial_ends_at,package_id)
select 'dd240000-0000-4000-8000-000000000001','Standalone Train test','standalone-train-test','trial',now()-interval '1 day',id
from public.packages where name='CareMetric Train';
insert into public.organizations(id,name,slug) values('dd240000-0000-4000-8000-000000000002','Other Train test','other-train-test');
insert into public.facilities(id,organization_id,name,facility_type) values
('dd240000-0000-4000-8000-000000000011','dd240000-0000-4000-8000-000000000001','Training PCH','PCH'),
('dd240000-0000-4000-8000-000000000012','dd240000-0000-4000-8000-000000000002','Other PCH','PCH');
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('dd240000-0000-4000-8000-000000000101','authenticated','authenticated','train-admin@test.local','x',now(),'{}','{}',now(),now());
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values('dd240000-0000-4000-8000-000000000102','authenticated','authenticated','train-platform@test.local','x',now(),'{}','{}',now(),now());
select set_config('app.privileged_write','on',true);
insert into public.profiles(id,organization_id,email,first_name,last_name,role,is_active)
values('dd240000-0000-4000-8000-000000000101','dd240000-0000-4000-8000-000000000001','train-admin@test.local','Train','Admin','org_admin',true)
on conflict(id) do update set organization_id=excluded.organization_id,role=excluded.role,is_active=true;
insert into public.profiles(id,email,first_name,last_name,role,is_active) values('dd240000-0000-4000-8000-000000000102','train-platform@test.local','Platform','Owner','platform_admin',true) on conflict(id) do update set role=excluded.role,is_active=true;
insert into public.employees(id,organization_id,facility_id,first_name,last_name,job_title,status)
values('dd240000-0000-4000-8000-000000000021','dd240000-0000-4000-8000-000000000001','dd240000-0000-4000-8000-000000000011','Test','Student','Direct care','active');
insert into public.residents(id,organization_id,facility_id,first_name,last_name,admission_date)
values('dd240000-0000-4000-8000-000000000091','dd240000-0000-4000-8000-000000000001','dd240000-0000-4000-8000-000000000011','Retained','Resident',current_date-20);
select is(public.has_effective_entitlement('dd240000-0000-4000-8000-000000000001','modules.train'),false,'expired trial denies Train before independent grant');
insert into app_private.module_access_terms(id,organization_id,module_key,source,reason,granted_by)
values('dd240000-0000-4000-8000-000000000031','dd240000-0000-4000-8000-000000000001','modules.train','complimentary','Complimentary facility education','dd240000-0000-4000-8000-000000000101');
select is(public.has_effective_entitlement('dd240000-0000-4000-8000-000000000001','modules.train'),true,'independent Train survives expired trial');
select is(public.has_effective_entitlement('dd240000-0000-4000-8000-000000000001','modules.carebase'),false,'free Train does not grant CareBase');
update public.billing_accounts set billing_state='canceled',provider_state='canceled',state_source='stripe' where organization_id='dd240000-0000-4000-8000-000000000001';
update public.organizations set subscription_status='canceled' where id='dd240000-0000-4000-8000-000000000001';
select is((select subscription_status from public.organizations where id='dd240000-0000-4000-8000-000000000001'),'active','paid cancellation preserves independent tenant identity');
select is(public.has_effective_entitlement('dd240000-0000-4000-8000-000000000001','modules.train'),true,'free Train survives canceled paid billing');
select set_config('request.jwt.claims',jsonb_build_object('sub','dd240000-0000-4000-8000-000000000101','role','authenticated','aal','aal2','iat',extract(epoch from now())::bigint)::text,true);
set local role authenticated;

select set_config('request.jwt.claims',jsonb_build_object('sub','dd240000-0000-4000-8000-000000000101','role','authenticated','aal','aal1','iat',extract(epoch from now())::bigint)::text,true);
select throws_ok($$ select public.save_training_workspace_item('profile','dd240000-0000-4000-8000-000000000011','dd240000-0000-4000-8000-000000000021','{}') $$,'42501',null,'unverified manager session cannot write training records');
select set_config('request.jwt.claims',jsonb_build_object('sub','dd240000-0000-4000-8000-000000000101','role','authenticated','aal','aal2','iat',extract(epoch from now()-interval '9 hours')::bigint)::text,true);
select throws_ok($$ select public.save_training_workspace_item('profile','dd240000-0000-4000-8000-000000000011','dd240000-0000-4000-8000-000000000021','{}') $$,'42501',null,'stale manager session cannot write training records');
select set_config('request.jwt.claims',jsonb_build_object('sub','dd240000-0000-4000-8000-000000000101','role','authenticated','aal','aal2','iat',extract(epoch from now())::bigint)::text,true);
select throws_ok($$ select public.get_change_event_resident_options() $$,'42501',null,'Train-only administrator cannot read the resident directory via definer RPC');
select throws_ok($$ select public.get_resident_administrative_packet('dd240000-0000-4000-8000-000000000091') $$,'42501',null,'Train-only administrator cannot read resident packets via definer RPC');
select is((select count(*)::integer from public.get_clinical_chart_resident_options()),0,'Train-only administrator cannot read clinical resident options');
select is((select count(*)::integer from public.get_clinical_chart_resident_photos()),0,'Train-only administrator cannot read resident photo paths');

select throws_ok($$ select public.get_my_shift_workspace() $$,'42501',null,'Train-only caller cannot read the operational shift workspace');
select throws_ok($$ select public.start_resident_assessment_form('dd240000-0000-4000-8000-000000000091','initial') $$,'42501',null,'Train-only caller cannot start a resident assessment');
select throws_ok($$ select public.get_schedule_service_workload('dd240000-0000-4000-8000-000000000091') $$,'42501',null,'Train-only caller cannot read resident workload through a schedule RPC');
select is((select count(*)::integer from public.residents),0,'retained resident is hidden by direct table RLS');
reset role;
insert into app_private.module_access_terms(id,organization_id,module_key,source,reason)
values('dd240000-0000-4000-8000-000000000039','dd240000-0000-4000-8000-000000000001','modules.carebase','contract','Positive resident product access control');
set local role authenticated;
select is((select count(*)::integer from public.get_change_event_resident_options()),1,'resident product restores the same-tenant directory');
select lives_ok($$ select public.get_resident_administrative_packet('dd240000-0000-4000-8000-000000000091') $$,'resident product restores the scoped administrative packet');
reset role;
update app_private.module_access_terms set revoked_at=now() where id='dd240000-0000-4000-8000-000000000039';
set local role authenticated;
select lives_ok($$ select public.save_training_workspace_item('profile','dd240000-0000-4000-8000-000000000011','dd240000-0000-4000-8000-000000000021','{"direct_care":true,"administrator":false,"specialty_unit":"none","duties":"Personal care assistance","first_work_date":"2026-01-01"}') $$,'Train administrator can record a confirmed duty profile');
select lives_ok($$ select public.get_training_workspace('dd240000-0000-4000-8000-000000000011') $$,'Train workspace reads use authenticated grants and facility RLS');

select ok(not has_function_privilege('authenticated','public.current_training_audience_status(uuid,uuid)','EXECUTE'),'the internal audience helper remains unavailable to browser callers');
select ok(not (select prosecdef from pg_proc where oid='public.staff_training_credit_allocation(uuid,text,date,date,jsonb,jsonb,numeric)'::regprocedure),'annual-credit allocation retains invoker row-level security');
reset role;
insert into public.employees(id,organization_id,facility_id,first_name,last_name,job_title,status)
values('dd240000-0000-4000-8000-000000000022','dd240000-0000-4000-8000-000000000002','dd240000-0000-4000-8000-000000000012','Other','Student','Direct care','active');
insert into public.training_types(id,code,name,category,state,applies_to_facility_type,renewal_interval_days,hour_bucket,audience_verification_required)
values('dd240000-0000-4000-8000-000000000041','ALLOC-AUDIENCE','Audience-gated fixture','annual','PA','BOTH',365,'general_annual',true);
update public.employee_training_records set completion_date=current_date,hours=2,status='compliant',approval_status='approved'
where employee_id in ('dd240000-0000-4000-8000-000000000021','dd240000-0000-4000-8000-000000000022')
 and training_type_id='dd240000-0000-4000-8000-000000000041';
set local role authenticated;
select is((public.staff_training_credit_allocation('dd240000-0000-4000-8000-000000000021','general_annual',current_date,current_date)->>'total')::numeric,120::numeric,
 'authenticated Train allocation reads approved audience evidence for its visible employee');
select is((public.staff_training_credit_allocation('dd240000-0000-4000-8000-000000000022','general_annual',current_date,current_date)->>'total')::numeric,0::numeric,
 'annual allocation cannot disclose another tenant employee credits');
reset role;
update public.employee_training_records set status='not_applicable' where employee_id='dd240000-0000-4000-8000-000000000021'
 and training_type_id='dd240000-0000-4000-8000-000000000041';
set local role authenticated;
select is((public.staff_training_credit_allocation('dd240000-0000-4000-8000-000000000021','general_annual',current_date,current_date)->>'total')::numeric,0::numeric,
 'the scoped lookup still excludes an inapplicable audience decision');

select throws_ok($$ select public.get_training_workspace('dd240000-0000-4000-8000-000000000012') $$,'42501',null,'workspace cannot read a different tenant facility');
select throws_ok($$ select public.save_training_workspace_item('profile','dd240000-0000-4000-8000-000000000012','dd240000-0000-4000-8000-000000000021','{}') $$,'42501',null,'cross-organization facility writes are refused');
select throws_ok($$ insert into public.training_evidence_events(employee_id) values('dd240000-0000-4000-8000-000000000021') $$,'42501',null,'direct evidence writes cannot bypass review rules');
select throws_ok($$ select public.save_training_workspace_item('event','dd240000-0000-4000-8000-000000000011','dd240000-0000-4000-8000-000000000021','{"title":"Course","completed_on":"2026-01-02","minutes":60,"delivery":"online","provider":"Provider","source_reference":"ref1","allocations":{"base":60,"special_annual":60}}') $$,'22023',null,'one event cannot earn double credit');
select lives_ok($$ select public.save_training_workspace_item('event','dd240000-0000-4000-8000-000000000011','dd240000-0000-4000-8000-000000000021','{"title":"Course","completed_on":"2026-01-02","minutes":60,"delivery":"online","provider":"Provider","source_reference":"ref1","topics":["supervised_practice"],"allocations":{"base":60}}') $$,'valid event is recorded pending review');
select is((select status from public.training_evidence_events where source_reference='ref1'),'pending','completion input cannot self-award verified credit');
select throws_ok($$ select public.save_training_workspace_item('review','dd240000-0000-4000-8000-000000000011','dd240000-0000-4000-8000-000000000021',jsonb_build_object('id',(select id from public.training_evidence_events where source_reference='ref1'),'status','verified','review_note','Checked supporting evidence')) $$,'22023',null,'online completion cannot replace observed practice');
select lives_ok($$ select public.save_training_workspace_item('event','dd240000-0000-4000-8000-000000000011','dd240000-0000-4000-8000-000000000021','{"title":"Fire safety video","completed_on":"2026-01-02","minutes":60,"delivery":"online","provider":"Fire safety expert","provider_qualification":"Expert video author credentials reviewed","source_reference":"fire-online","topics":["fire"],"allocations":{"base":60}}') $$,'fire video completion can be retained as unverified evidence');
select throws_ok($$ select public.save_training_workspace_item('review','dd240000-0000-4000-8000-000000000011','dd240000-0000-4000-8000-000000000021',jsonb_build_object('id',(select id from public.training_evidence_events where source_reference='fire-online'),'status','verified','review_note','Video author qualification checked')) $$,'22023','Annual fire training needs qualified instructor delivery; video requires a trained on-site instructor. Record classroom, hybrid or documented external evidence','a qualified video author does not replace the required on-site fire instructor');
select throws_ok($$ select public.save_training_workspace_item('profile','dd240000-0000-4000-8000-000000000011','dd240000-0000-4000-8000-000000000021','{"applicability":{"annual_common":"yes"}}') $$,'22023',null,'audience applicability requires explicit boolean decisions');
select lives_ok($$ select public.save_training_workspace_item('event','dd240000-0000-4000-8000-000000000011','dd240000-0000-4000-8000-000000000021','{"title":"Rights instruction","completed_on":"2026-01-02","minutes":60,"delivery":"classroom","provider":"Provider","source_reference":"ref2","topics":["rights"],"allocations":{"base":60}}') $$,'ordinary evidence can be recorded');
select lives_ok($$ select public.save_training_workspace_item('review','dd240000-0000-4000-8000-000000000011','dd240000-0000-4000-8000-000000000021',jsonb_build_object('id',(select id from public.training_evidence_events where source_reference='ref2'),'status','verified','review_note','Checked attendance and content')) $$,'reviewer can verify supported ordinary evidence');
select lives_ok($$ select public.save_training_workspace_item('plan','dd240000-0000-4000-8000-000000000011','dd240000-0000-4000-8000-000000000021','{"title":"Rights instruction","duties_snapshot":"Personal care","scheduled_at":"2026-01-02T10:00:00-05:00","duration_minutes":60,"location":"Training room","requirement_keys":["rights"]}') $$,'annual plan retains staff duties and scheduled delivery');

-- An unrelated course, wrong day or insufficient duration cannot fulfill a plan.
select lives_ok($$ select public.save_training_workspace_item('plan','dd240000-0000-4000-8000-000000000011','dd240000-0000-4000-8000-000000000021','{"title":"Annual fire instruction","duties_snapshot":"Personal care","scheduled_at":"2026-01-02T10:00:00-05:00","duration_minutes":60,"location":"Training room","requirement_keys":["fire"]}') $$,'fire plan can be scheduled');
select throws_ok($$ select public.save_training_workspace_item('plan_complete','dd240000-0000-4000-8000-000000000011','dd240000-0000-4000-8000-000000000021',jsonb_build_object('id',(select id from public.training_annual_schedule where title='Annual fire instruction'),'event_id',(select id from public.training_evidence_events where source_reference='ref2'))) $$,'22023',null,'rights evidence cannot fulfill annual fire instruction');
reset role;
update public.training_annual_schedule set scheduled_at=scheduled_at+interval '1 day' where title='Rights instruction';
set local role authenticated;
select throws_ok($$ select public.save_training_workspace_item('plan_complete','dd240000-0000-4000-8000-000000000011','dd240000-0000-4000-8000-000000000021',jsonb_build_object('id',(select id from public.training_annual_schedule where title='Rights instruction'),'event_id',(select id from public.training_evidence_events where source_reference='ref2'))) $$,'22023',null,'matching topics on the wrong scheduled day do not fulfill the plan');
reset role;
update public.training_annual_schedule set scheduled_at=scheduled_at-interval '1 day',duration_minutes=90 where title='Rights instruction';
set local role authenticated;
select throws_ok($$ select public.save_training_workspace_item('plan_complete','dd240000-0000-4000-8000-000000000011','dd240000-0000-4000-8000-000000000021',jsonb_build_object('id',(select id from public.training_annual_schedule where title='Rights instruction'),'event_id',(select id from public.training_evidence_events where source_reference='ref2'))) $$,'22023',null,'insufficient event duration does not fulfill the plan');
reset role;
update public.training_annual_schedule set duration_minutes=60 where title='Rights instruction';
set local role authenticated;
select lives_ok($$ select public.save_training_workspace_item('plan_complete','dd240000-0000-4000-8000-000000000011','dd240000-0000-4000-8000-000000000021',jsonb_build_object('id',(select id from public.training_annual_schedule where title='Rights instruction'),'event_id',(select id from public.training_evidence_events where source_reference='ref2'))) $$,'verified student evidence fulfills a plan');
select lives_ok($$ select public.save_training_workspace_item('review','dd240000-0000-4000-8000-000000000011','dd240000-0000-4000-8000-000000000021',jsonb_build_object('id',(select id from public.training_evidence_events where source_reference='ref2'),'status','void','review_note','Incorrect completion date; replacing evidence')) $$,'incorrect verified evidence can be voided with an audit basis');
select is((select completed_event_id from public.training_annual_schedule where title='Rights instruction'),null::uuid,'voiding evidence reopens the linked plan rather than leaving false fulfillment');
select lives_ok($$ select public.save_training_workspace_item('lifecycle','dd240000-0000-4000-8000-000000000011','dd240000-0000-4000-8000-000000000021',jsonb_build_object('transition','leave','effective_on',current_date,'reason','Approved staff leave for training lifecycle test')) $$,'Train administrator can manage shared staff leave without a Workforce license');
select is((select status from public.employees where id='dd240000-0000-4000-8000-000000000021'),'on_leave','staff leave changes the shared employee state');
select lives_ok($$ select public.save_training_workspace_item('lifecycle','dd240000-0000-4000-8000-000000000011','dd240000-0000-4000-8000-000000000021',jsonb_build_object('transition','return','effective_on',current_date,'reason','Approved return from staff leave')) $$,'Train administrator can restore active staff after leave');
select is((select status from public.employees where id='dd240000-0000-4000-8000-000000000021'),'active','return restores the shared employee state');
select lives_ok($$ select public.save_training_workspace_item('shift','dd240000-0000-4000-8000-000000000011','dd240000-0000-4000-8000-000000000021','{"starts_at":"2026-01-01T08:00:00-05:00","ends_at":"2026-01-01T16:00:00-05:00","source_reference":"Verified initial schedule"}') $$,'initial scheduled shift can be recorded');
select lives_ok($$ select public.save_training_workspace_item('shift','dd240000-0000-4000-8000-000000000011','dd240000-0000-4000-8000-000000000021',jsonb_build_object('id',(select id from public.training_work_shifts where employee_id='dd240000-0000-4000-8000-000000000021'),'starts_at','2026-01-01T08:00:00-05:00','ends_at','2026-01-01T18:00:00-05:00','source_reference','Corrected against original ten-hour schedule')) $$,'shift correction preserves its identity and audit history');
select is((select extract(epoch from ends_at-starts_at)::integer from public.training_work_shifts where employee_id='dd240000-0000-4000-8000-000000000021'),36000,'corrected duration is used for the scheduled-hour deadline');
select throws_ok($$ select public.save_training_workspace_item('shift','dd240000-0000-4000-8000-000000000011','dd240000-0000-4000-8000-000000000021','{"starts_at":"2026-01-01T16:00:00-05:00","ends_at":"2026-01-01T20:00:00-05:00","source_reference":"Overlapping schedule"}') $$,'22023',null,'overlapping shift hours cannot be double counted');
select lives_ok($$ select public.save_training_workspace_item('plan_cancel','dd240000-0000-4000-8000-000000000011','dd240000-0000-4000-8000-000000000021',jsonb_build_object('id',(select id from public.training_annual_schedule where title='Rights instruction'))) $$,'an unfulfilled plan can be canceled rather than deleted');
select ok((select canceled_at is not null from public.training_annual_schedule where title='Rights instruction'),'canceled annual plan remains in its history');
select throws_ok($$ select public.manage_module_access_term('dd240000-0000-4000-8000-000000000001','modules.carebase','complimentary','Attempt self upgrade') $$,'42501',null,'tenant administrator cannot grant commercial modules');
reset role;
-- Exercise the real platform action. A lifecycle transaction intentionally clears the
-- privileged-write flag, so a raw fixture UPDATE would now be reverted by the column guard.
select set_config('request.jwt.claims',jsonb_build_object('sub','dd240000-0000-4000-8000-000000000102','role','authenticated','aal','aal2','iat',extract(epoch from now())::bigint)::text,true);
set local role authenticated;
select lives_ok($$ select public.set_organization_suspension('dd240000-0000-4000-8000-000000000001',true,'Administrative suspension test') $$,'platform suspension uses the guarded organization and billing transaction');
select is(public.has_effective_entitlement('dd240000-0000-4000-8000-000000000001','modules.train'),false,'administrative suspension overrides independent terms');
select lives_ok($$ select public.set_organization_suspension('dd240000-0000-4000-8000-000000000001',false,'Approved reactivation test') $$,'platform can lift the administrative suspension');
select is(public.has_effective_entitlement('dd240000-0000-4000-8000-000000000001','modules.train'),true,'reactivation restores the independent Train term');
reset role;
select set_config('request.jwt.claims','{}',true);

select set_config('request.jwt.claims',jsonb_build_object('sub','dd240000-0000-4000-8000-000000000102','role','authenticated','aal','aal2','iat',extract(epoch from now())::bigint)::text,true);
set local role authenticated;
select lives_ok($$ select public.manage_module_access_term('dd240000-0000-4000-8000-000000000001','modules.workforce','complimentary','Complimentary workforce for regression') $$,'grant a different independent module');
select lives_ok($$ select public.manage_module_access_term('dd240000-0000-4000-8000-000000000001','modules.workforce','complimentary','Revoke Train while Workforce stays',null,'dd240000-0000-4000-8000-000000000031') $$,'revoke the Train term with a different selected module');
reset role;
select is((select metadata->>'module' from public.audit_logs where action='module_access.revoked' and entity_id='dd240000-0000-4000-8000-000000000031'),'modules.train','revocation audits the stored module, not the selected UI module');
select is(public.has_effective_entitlement('dd240000-0000-4000-8000-000000000001','modules.workforce'),true,'Workforce-only independent membership is preserved');
select is(public.has_effective_entitlement('dd240000-0000-4000-8000-000000000001','modules.train'),false,'Workforce-only term does not restore package-derived Train after paid cancellation');
select set_config('test.workforce_term',(select id::text from app_private.module_access_terms where organization_id='dd240000-0000-4000-8000-000000000001' and module_key='modules.workforce'),true);
set local role authenticated;
select lives_ok($$ select public.manage_module_access_term('dd240000-0000-4000-8000-000000000001','modules.train','complimentary','Revoke the final independent term',null,current_setting('test.workforce_term')::uuid) $$,'revoke the final term through the owner RPC');
reset role;
select is((select subscription_status from public.organizations where id='dd240000-0000-4000-8000-000000000001'),'canceled','final revocation restores canceled membership');
select set_config('request.jwt.claims',jsonb_build_object('sub','dd240000-0000-4000-8000-000000000101','role','authenticated','aal','aal2','iat',extract(epoch from now())::bigint)::text,true);
set local role authenticated;
select is(public.current_role(),null::text,'canceled tenant no longer has a shared-shell role');
reset role;
select set_config('request.jwt.claims','{}',true);

select is(public.has_effective_entitlement('dd240000-0000-4000-8000-000000000001','modules.train'),false,'revocation restores provider-derived access');
select is((select permissive from pg_policies where schemaname='public' and tablename='residents' and policyname='resident_product_access'),'RESTRICTIVE','resident access requires a resident product at the database boundary');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select lives_ok($$ select public.configure_train_signup('dd240000-0000-4000-8000-000000000002',true) $$,'signup service can configure a fresh complimentary Train organization');
select is((select p.name from public.organizations o join public.packages p on p.id=o.package_id where o.id='dd240000-0000-4000-8000-000000000002'),'CareMetric Train','Train signup selects only the Train package');
select throws_ok($$ select public.configure_train_signup('dd240000-0000-4000-8000-000000000001',true) $$,'22023',null,'signup cannot change a claimed organization');
reset role;
select ok(not has_function_privilege('authenticated','public.configure_train_signup(uuid,boolean)','execute'),'self-service callers cannot directly grant free products');
select set_config('request.jwt.claims',jsonb_build_object('sub','dd240000-0000-4000-8000-000000000102','role','authenticated','aal','aal2','iat',extract(epoch from now())::bigint)::text,true);
set local role authenticated;
select lives_ok($$ select public.provision_training_facility('dd240000-0000-4000-8000-000000000003','Provisioned organization','Provisioned ALR','ALR') $$,'platform owner can provision complimentary training without a card');
select is(public.has_effective_entitlement('dd240000-0000-4000-8000-000000000003','modules.train'),true,'provisioning enables Train');
select is(public.has_effective_entitlement('dd240000-0000-4000-8000-000000000003','modules.carebase'),false,'provisioning does not enable operational modules');
select lives_ok($$ select public.provision_training_facility('dd240000-0000-4000-8000-000000000003','Provisioned organization','Provisioned ALR','ALR') $$,'provisioning request can safely be retried');
select is(jsonb_array_length(public.list_module_access_terms('dd240000-0000-4000-8000-000000000003')),1,'retry does not duplicate a grant');
select throws_ok($$ select public.provision_training_facility('dd240000-0000-4000-8000-000000000004','Unsupported facility','Not PCH or ALR','GH') $$,'22023',null,'initial free facility flow is restricted to PCH and ALR');
reset role;
select * from finish();
rollback;
