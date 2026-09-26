begin;
select plan(17);
select ok(has_function_privilege('authenticated','public.set_fhir_source_writeback(uuid,boolean,text,boolean)','EXECUTE'),'authenticated managers can reach the guarded command');
select ok(not has_function_privilege('anon','public.set_fhir_source_writeback(uuid,boolean,text,boolean)','EXECUTE'),'anonymous callers cannot enable outbound disclosure');
select ok(not has_function_privilege('authenticated','public.claim_fhir_writeback_batch(integer,integer,uuid[])','EXECUTE'),'browser callers cannot claim outbound deliveries');
insert into public.organizations(id,name,slug,subscription_status) values
('e5100000-0000-4000-8000-000000000001','Outbound A','outbound-auth-a','active'),
('e5100000-0000-4000-8000-000000000002','Outbound B','outbound-auth-b','active');
insert into public.facilities(id,organization_id,name,facility_type) values
('e5100000-0000-4000-8000-000000000011','e5100000-0000-4000-8000-000000000001','Outbound A','PCH');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change,email_change_token_current,reauthentication_token,is_sso_user,is_anonymous)
select '00000000-0000-0000-0000-000000000000',('e5100000-0000-4000-8000-00000000010'||n)::uuid,'authenticated','authenticated','outbound-'||n||'@test.local','x',now(),'{}','{}',now(),now(),'','','','','','',false,false from generate_series(1,3) n;
select set_config('app.privileged_write','on',true);
insert into public.profiles(id,organization_id,email,first_name,last_name,role,is_active)
select ('e5100000-0000-4000-8000-00000000010'||n)::uuid,
case when n=2 then 'e5100000-0000-4000-8000-000000000002'::uuid else 'e5100000-0000-4000-8000-000000000001'::uuid end,
'outbound-'||n||'@test.local','Outbound','User',case when n=3 then 'employee' else 'org_admin' end,true from generate_series(1,3) n
on conflict(id) do update set organization_id=excluded.organization_id,role=excluded.role,is_active=true;
select set_config('app.privileged_write','off',true);
insert into public.residents(id,organization_id,facility_id,first_name,last_name,admission_date,status,clinical_data_consent)
values('e5100000-0000-4000-8000-000000000201','e5100000-0000-4000-8000-000000000001','e5100000-0000-4000-8000-000000000011','Resident','Outbound',public.pa_today()-20,'active','granted');
insert into public.fhir_integration_sources(id,organization_id,facility_id,name,vendor_name,fhir_base_url,status,writeback_enabled,writeback_contract_reference,writeback_conditional_create_confirmed) values
('e5100000-0000-4000-8000-000000000301','e5100000-0000-4000-8000-000000000001','e5100000-0000-4000-8000-000000000011','Source A','FHIR vendor','https://ehr-a.example/fhir','active',false,null,false),
('e5100000-0000-4000-8000-000000000302','e5100000-0000-4000-8000-000000000001','e5100000-0000-4000-8000-000000000011','Source B','FHIR vendor','https://ehr-b.example/fhir','active',true,'Vendor contract B',true);
create function pg_temp.outbound_actor(p_id uuid,p_role text default 'authenticated',p_aal text default 'aal2') returns void language plpgsql as $$ begin
  reset role;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_id,'role',p_role,'aal',p_aal,'iat',extract(epoch from now())::bigint)::text,true);
  if p_role='service_role' then set local role service_role; else set local role authenticated; end if;
end $$;
select pg_temp.outbound_actor('e5100000-0000-4000-8000-000000000102');
select throws_ok($$select public.set_fhir_source_writeback('e5100000-0000-4000-8000-000000000301',true,'Vendor contract A',true)$$,'42501',null,'cross-tenant source enablement is rejected');
select pg_temp.outbound_actor('e5100000-0000-4000-8000-000000000103');
select throws_ok($$select public.set_fhir_source_writeback('e5100000-0000-4000-8000-000000000301',true,'Vendor contract A',true)$$,'42501',null,'employee cannot enable outbound disclosure');
select pg_temp.outbound_actor('e5100000-0000-4000-8000-000000000101','authenticated','aal1');
select throws_ok($$select public.set_fhir_source_writeback('e5100000-0000-4000-8000-000000000301',true,'Vendor contract A',true)$$,'42501',null,'privileged enablement requires current identity assurance');
select pg_temp.outbound_actor('e5100000-0000-4000-8000-000000000101');
select throws_ok($$select public.set_fhir_source_writeback('e5100000-0000-4000-8000-000000000301',true,'Vendor contract A',false)$$,'22023',null,'vendor conditional-create support must be confirmed');
select throws_ok($$select public.set_fhir_source_writeback('e5100000-0000-4000-8000-000000000301',true,null,true)$$,'22023',null,'vendor contract evidence is required');
select lives_ok($$select public.set_fhir_source_writeback('e5100000-0000-4000-8000-000000000301',true,'  Vendor contract A  ',true)$$,'authorized manager enables a validated source');
select is((select writeback_contract_reference from public.fhir_integration_sources where id='e5100000-0000-4000-8000-000000000301'),'Vendor contract A','contract reference is stored without incidental whitespace');
reset role;
insert into public.fhir_writeback_queue(id,organization_id,facility_id,source_id,resident_id,fhir_patient_id,resource_type,origin_kind,origin_id,fhir_payload,target_url)
select ('e5100000-0000-4000-8000-00000000040'||n)::uuid,'e5100000-0000-4000-8000-000000000001','e5100000-0000-4000-8000-000000000011',
('e5100000-0000-4000-8000-00000000030'||n)::uuid,'e5100000-0000-4000-8000-000000000201','resident-201','Observation','clinical_observation',
('e5100000-0000-4000-8000-00000000050'||n)::uuid,'{"resourceType":"Observation"}',case when n=1 then 'https://ehr-a.example/fhir' else 'https://ehr-b.example/fhir' end from generate_series(1,2) n;
select pg_temp.outbound_actor('e5100000-0000-4000-8000-000000000000','service_role');
select is((select count(*)::integer from public.claim_fhir_writeback_batch(10,300,array['e5100000-0000-4000-8000-000000000301'::uuid])),1,'drain claims only a source with matching configured authorization');
select is((select status||':'||attempts from public.fhir_writeback_queue where id='e5100000-0000-4000-8000-000000000402'),'pending:0','unconfigured source remains pending without spending an attempt');
select is((select count(*)::integer from public.claim_fhir_writeback_batch(10,300,array[]::uuid[])),0,'an empty credential source list claims no rows');
select pg_temp.outbound_actor('e5100000-0000-4000-8000-000000000101');
select lives_ok($$select public.set_fhir_source_writeback('e5100000-0000-4000-8000-000000000302',false)$$,'manager can revoke write-back');
select is((select status from public.fhir_writeback_queue where id='e5100000-0000-4000-8000-000000000402'),'skipped','revocation withdraws pending deliveries');
reset role;
update public.fhir_writeback_queue set status='pending' where id='e5100000-0000-4000-8000-000000000401';
update public.facilities set clinical_enabled=false where id='e5100000-0000-4000-8000-000000000011';
select pg_temp.outbound_actor('e5100000-0000-4000-8000-000000000000','service_role');
select is((select count(*)::integer from public.claim_fhir_writeback_batch(10,300,array['e5100000-0000-4000-8000-000000000301'::uuid])),0,'disabling facility clinical operations blocks already-queued outbound delivery');
select pg_temp.outbound_actor('e5100000-0000-4000-8000-000000000101');
select lives_ok($$select public.set_fhir_source_writeback('e5100000-0000-4000-8000-000000000301',false)$$,'manager can revoke write-back after disabling clinical capability');
select * from finish();
rollback;
