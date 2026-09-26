begin;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$
  select ('ac260000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$$;
insert into public.organizations(id,name,slug,subscription_status,trial_ends_at,package_id)
select pg_temp.id(1),'Notice security test','notice-security-test','trial',now()-interval '1 day',id
from public.packages where name='CareMetric Train';
insert into public.organizations(id,name,slug) values(pg_temp.id(2),'Other notice tenant','notice-security-other');
insert into public.facilities(id,organization_id,name,facility_type) values
(pg_temp.id(11),pg_temp.id(1),'First notice facility','PCH'),(pg_temp.id(12),pg_temp.id(2),'Other notice facility','PCH');
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values(pg_temp.id(101),'authenticated','authenticated','notice-security@test.local','x',now(),'{}','{}',now(),now());
select set_config('app.privileged_write','on',true);
insert into public.profiles(id,organization_id,email,first_name,last_name,role,is_active)
values(pg_temp.id(101),pg_temp.id(1),'notice-security@test.local','Notice','Manager','org_admin',true)
on conflict(id) do update set organization_id=excluded.organization_id,role=excluded.role,is_active=true;
select set_config('app.privileged_write','off',true);
insert into public.facility_assignments(profile_id,facility_id) values(pg_temp.id(101),pg_temp.id(11));
insert into app_private.module_access_terms(organization_id,module_key,source,reason)
values(pg_temp.id(1),'modules.train','complimentary','Notice boundary test');
insert into public.resident_regulatory_actions(id,organization_id,facility_id,action_type,recipient_role,anchor_at,reason) values
(pg_temp.id(201),pg_temp.id(1),pg_temp.id(11),'closure_department_notice','department',now()+interval '90 days','Facility closure planned'),
(pg_temp.id(202),pg_temp.id(2),pg_temp.id(12),'closure_department_notice','department',now()+interval '90 days','Other tenant closure planned');

select is((select audit_mode from app_private.audit_entity_manifest where table_name='resident_regulatory_actions'),'row_trigger','notice evidence declares its actual row-audit coverage');
select ok(exists(select 1 from public.audit_logs where entity_type='resident_regulatory_actions' and entity_id=pg_temp.id(201)::text),'creating a notice produces audit evidence');
select is((select module_key from app_private.product_module_resources where resource_schema='public' and resource_name='resident_regulatory_actions'),'modules.carebase','resident notices belong to CareBase operations');
select is((select count(*)::integer from pg_policy where polrelid='public.resident_regulatory_actions'::regclass and not polpermissive
  and polname in ('product_module_entitlement','sms_mfa_session_required','impersonation_session_lifetime')),3,'all standard restrictive access policies cover notice evidence');
select ok(not has_schema_privilege('authenticated','app_private','USAGE'),'client cannot resolve private-schema internals');

select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(101),'role','authenticated','aal','aal2','iat',extract(epoch from now())::bigint)::text,true);
set local role authenticated;
select is((select count(*)::integer from public.resident_regulatory_actions),0,'Train-only manager cannot read retained notice data');
select throws_ok($$insert into public.resident_regulatory_actions(organization_id,facility_id,action_type,recipient_role,anchor_at,reason)
values(pg_temp.id(1),pg_temp.id(11),'closure_department_notice','department',now()+interval '90 days','Unauthorized module write')$$,
'42501',null,'Train-only manager cannot create notices by bypassing the UI');
select throws_ok($$select app_private.inspection_interval_maximum('smoke_detector')$$,'42501',null,'private helper is not exposed through schema lookup');
reset role;
insert into app_private.module_access_terms(organization_id,module_key,source,reason)
values(pg_temp.id(1),'modules.carebase','contract','Positive resident module control');
set local role authenticated;
select is((select count(*)::integer from public.resident_regulatory_actions),1,'CareBase restores same-tenant notices while excluding the other tenant');
select lives_ok($$insert into public.resident_regulatory_actions(organization_id,facility_id,action_type,recipient_role,anchor_at,reason)
values(pg_temp.id(1),pg_temp.id(11),'closure_department_notice','department',now()+interval '90 days','Authorized module write')$$,
'authorized notice writes still work with all restrictive policies');
select lives_ok($$insert into public.inspection_items(organization_id,facility_id,item_kind,item_type,label,inspection_interval_days)
values(pg_temp.id(1),pg_temp.id(11),'equipment','smoke_detector','Bound helper check',30)$$,
'stored inspection CHECK executes its bound helper without private-schema USAGE');
select throws_ok($$insert into public.inspection_items(organization_id,facility_id,item_kind,item_type,label,inspection_interval_days)
values(pg_temp.id(1),pg_temp.id(11),'equipment','smoke_detector','Out-of-range check',60)$$,
'23514',null,'private schema isolation preserves interval enforcement');
reset role;
select is((select count(*)::integer from public.incident_notification_rules where incident_type in ('sexual_abuse','serious_bodily_injury','suspicious_death') and notification_type in ('written_law_enforcement','written_protective_services') and citation='6 Pa. Code 15.152(a)(3)' and due_hours=48),6,'each severe OAPSA category retains two separate statutory written-report duties');
select is((select count(*)::integer from public.incident_notification_rules where incident_type in ('sexual_abuse','serious_bodily_injury','suspicious_death') and notification_type='written_report' and citation='55 Pa. Code 2600.16(d) / 2800.16(d) (48-hour internal target)' and note like '%immediately following the conclusion of the investigation%'),3,'all three severe categories retain the Department final-report duty and label its internal reminder honestly');
select * from finish();
rollback;
