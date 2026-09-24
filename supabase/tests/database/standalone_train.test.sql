begin;
select plan(16);
insert into public.organizations(id,name,slug,subscription_status,trial_ends_at,package_id)
select 'dd240000-0000-4000-8000-000000000001','Standalone Train test','standalone-train-test','trial',now()-interval '1 day',id
from public.packages where name='CareMetric Train';
insert into public.organizations(id,name,slug) values('dd240000-0000-4000-8000-000000000002','Other Train test','other-train-test');
insert into public.facilities(id,organization_id,name,facility_type) values
('dd240000-0000-4000-8000-000000000011','dd240000-0000-4000-8000-000000000001','Training PCH','PCH'),
('dd240000-0000-4000-8000-000000000012','dd240000-0000-4000-8000-000000000002','Other PCH','PCH');
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('dd240000-0000-4000-8000-000000000101','authenticated','authenticated','train-admin@test.local','x',now(),'{}','{}',now(),now());
select set_config('app.privileged_write','on',true);
insert into public.profiles(id,organization_id,email,first_name,last_name,role,is_active)
values('dd240000-0000-4000-8000-000000000101','dd240000-0000-4000-8000-000000000001','train-admin@test.local','Train','Admin','org_admin',true)
on conflict(id) do update set organization_id=excluded.organization_id,role=excluded.role,is_active=true;
insert into public.employees(id,organization_id,facility_id,first_name,last_name,job_title,status)
values('dd240000-0000-4000-8000-000000000021','dd240000-0000-4000-8000-000000000001','dd240000-0000-4000-8000-000000000011','Test','Student','Direct care','active');
select is(public.has_effective_entitlement('dd240000-0000-4000-8000-000000000001','modules.train'),false,'expired trial denies Train before independent grant');
insert into app_private.module_access_terms(id,organization_id,module_key,source,reason,granted_by)
values('dd240000-0000-4000-8000-000000000031','dd240000-0000-4000-8000-000000000001','modules.train','complimentary','Complimentary facility education','dd240000-0000-4000-8000-000000000101');
select is(public.has_effective_entitlement('dd240000-0000-4000-8000-000000000001','modules.train'),true,'independent Train survives expired trial');
select is(public.has_effective_entitlement('dd240000-0000-4000-8000-000000000001','modules.carebase'),false,'free Train does not grant CareBase');
update public.billing_accounts set billing_state='canceled',state_source='stripe' where organization_id='dd240000-0000-4000-8000-000000000001';
update public.organizations set subscription_status='canceled' where id='dd240000-0000-4000-8000-000000000001';
select is((select subscription_status from public.organizations where id='dd240000-0000-4000-8000-000000000001'),'active','paid cancellation preserves independent tenant identity');
select is(public.has_effective_entitlement('dd240000-0000-4000-8000-000000000001','modules.train'),true,'free Train survives canceled paid billing');
select set_config('request.jwt.claims',jsonb_build_object('sub','dd240000-0000-4000-8000-000000000101','role','authenticated','aal','aal2','iat',extract(epoch from now())::bigint)::text,true);
set local role authenticated;
select lives_ok($$ select public.save_training_workspace_item('profile','dd240000-0000-4000-8000-000000000011','dd240000-0000-4000-8000-000000000021','{"direct_care":true,"administrator":false,"specialty_unit":"none","duties":"Personal care assistance","first_work_date":"2026-01-01"}') $$,'Train administrator can record a confirmed duty profile');
select throws_ok($$ select public.save_training_workspace_item('profile','dd240000-0000-4000-8000-000000000012','dd240000-0000-4000-8000-000000000021','{}') $$,'42501',null,'cross-organization facility writes are refused');
select throws_ok($$ insert into public.training_evidence_events(employee_id) values('dd240000-0000-4000-8000-000000000021') $$,'42501',null,'direct evidence writes cannot bypass review rules');
select throws_ok($$ select public.save_training_workspace_item('event','dd240000-0000-4000-8000-000000000011','dd240000-0000-4000-8000-000000000021','{"title":"Course","completed_on":"2026-01-02","minutes":60,"delivery":"online","provider":"Provider","source_reference":"ref1","allocations":{"base":60,"special_annual":60}}') $$,'22023',null,'one event cannot earn double credit');
select lives_ok($$ select public.save_training_workspace_item('event','dd240000-0000-4000-8000-000000000011','dd240000-0000-4000-8000-000000000021','{"title":"Course","completed_on":"2026-01-02","minutes":60,"delivery":"online","provider":"Provider","source_reference":"ref1","topics":["supervised_practice"],"allocations":{"base":60}}') $$,'valid event is recorded pending review');
select is((select status from public.training_evidence_events where source_reference='ref1'),'pending','completion input cannot self-award verified credit');
select throws_ok($$ select public.save_training_workspace_item('review','dd240000-0000-4000-8000-000000000011','dd240000-0000-4000-8000-000000000021',jsonb_build_object('id',(select id from public.training_evidence_events where source_reference='ref1'),'status','verified','review_note','Checked supporting evidence')) $$,'22023',null,'online completion cannot replace observed practice');
select throws_ok($$ select public.manage_module_access_term('dd240000-0000-4000-8000-000000000001','modules.carebase','complimentary','Attempt self upgrade') $$,'42501',null,'tenant administrator cannot grant commercial modules');
reset role;
select set_config('request.jwt.claims','{}',true);
update public.organizations set subscription_status='suspended' where id='dd240000-0000-4000-8000-000000000001';
select is(public.has_effective_entitlement('dd240000-0000-4000-8000-000000000001','modules.train'),false,'administrative suspension overrides independent terms');
update public.organizations set subscription_status='active' where id='dd240000-0000-4000-8000-000000000001';
update app_private.module_access_terms set revoked_at=now() where id='dd240000-0000-4000-8000-000000000031';
select is(public.has_effective_entitlement('dd240000-0000-4000-8000-000000000001','modules.train'),false,'revocation restores provider-derived access');
select is((select permissive from pg_policies where schemaname='public' and tablename='residents' and policyname='resident_product_access'),'RESTRICTIVE','resident access requires a resident product at the database boundary');
select * from finish();
rollback;
