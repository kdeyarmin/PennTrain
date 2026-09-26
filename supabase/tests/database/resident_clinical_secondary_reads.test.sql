begin;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select ('d2290000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
insert into public.organizations(id,name,slug,subscription_status) values(pg_temp.id(1),'Clinical secondary reads','clinical-secondary-reads','active');
insert into public.facilities(id,organization_id,name,facility_type) values(pg_temp.id(11),pg_temp.id(1),'Clinical audit ALF','ALR');
insert into app_private.module_access_terms(organization_id,module_key,source,reason) values(pg_temp.id(1),'modules.carebase','contract','Resident clinical boundary fixture');
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 values(pg_temp.id(101),'authenticated','authenticated','clinical-secondary@test.local','x',now(),'{}','{}',now(),now());
select set_config('app.privileged_write','on',true);
insert into public.profiles(id,organization_id,email,first_name,last_name,role,is_active)
 values(pg_temp.id(101),pg_temp.id(1),'clinical-secondary@test.local','Clinical','Auditor','auditor',true)
 on conflict(id) do update set organization_id=excluded.organization_id,role=excluded.role,is_active=true;
select set_config('app.privileged_write','off',true);
insert into public.residents(id,organization_id,facility_id,first_name,last_name,admission_date,clinical_data_consent) values
 (pg_temp.id(201),pg_temp.id(1),pg_temp.id(11),'Granted','Resident',public.pa_today(),'granted'),
 (pg_temp.id(202),pg_temp.id(1),pg_temp.id(11),'Revoked','Resident',public.pa_today(),'revoked');
insert into public.resident_regulatory_actions(organization_id,facility_id,resident_id,action_type,anchor_at,reason)
 select pg_temp.id(1),pg_temp.id(11),pg_temp.id(n),'itemized_funds_account',now(),'Financial statement evidence' from generate_series(201,202)n;
create function pg_temp.act_as(p_role text default 'authenticated') returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(101),'role',p_role,'aal','aal2','iat',extract(epoch from now())::bigint)::text,true);
 if p_role='service_role' then set local role service_role; else set local role authenticated; end if;
end $$;
select pg_temp.act_as();
select is((select count(*)::integer from public.audit_logs where entity_type='resident_regulatory_actions' and new_values->>'action_type'='resident_tb_test'),0,'general audit reader cannot recover clinical payload through insert snapshots');
select is((select count(*)::integer from public.audit_logs where entity_type='resident_regulatory_actions' and new_values->>'action_type'='itemized_funds_account'),2,'financial audit evidence remains available to the same scoped auditor');
select is((select count(*)::integer from public.resident_regulatory_actions where action_type='resident_tb_test'),0,'direct mixed-table reads remain closed for clinical duties');
select is((select count(*)::integer from public.get_resident_regulatory_actions(pg_temp.id(11)) where action_type='resident_tb_test'),2,'authorized internal clinical reader still retrieves both residents regardless of external disclosure choice');
reset role;
select is((select count(*)::integer from app_private.clinical_access_log where actor_profile_id=pg_temp.id(101) and clinical_domain='regulatory_duties'),2,'clinical reader logs each resident before exposing the protected payload');
select is((select count(*)::integer from public.audit_logs where entity_type='resident_regulatory_actions' and new_values->>'action_type'='resident_tb_test'),2,'restricted audit snapshots are retained unchanged');
select ok(not exists(select 1 from public.audit_logs where entity_type='resident_regulatory_actions' and new_values->>'action_type'='resident_tb_test' and (new_values->>'reason' is null or event_hash is null)),'retained clinical audit evidence keeps its full source payload and integrity hash');
select pg_temp.act_as('service_role');
select is((select count(*)::integer from public.export_organization_table(pg_temp.id(1),'resident_regulatory_actions') row),3,'export includes two financial records and only the consented clinical record');
select is((select count(*)::integer from public.export_organization_table(pg_temp.id(1),'resident_regulatory_actions') row where row->>'action_type'='resident_tb_test' and row->>'resident_id'=pg_temp.id(201)::text),1,'consented resident clinical duty is included');
select is((select count(*)::integer from public.export_organization_table(pg_temp.id(1),'resident_regulatory_actions') row where row->>'action_type'='resident_tb_test' and row->>'resident_id'=pg_temp.id(202)::text),0,'revoked clinical disclosure excludes the mixed-table payload');
select is((select count(*)::integer from public.export_organization_table(pg_temp.id(1),'audit_logs') row where row->>'entity_type'='resident_regulatory_actions' and row->'new_values'->>'action_type'='resident_tb_test'),1,'clinical audit copies obey the same export disclosure rule');
select is((select count(*)::integer from public.export_organization_table(pg_temp.id(1),'audit_logs') row where row->>'entity_type'='resident_regulatory_actions' and row->'new_values'->>'action_type'='itemized_funds_account'),2,'financial audit exports remain complete');
select is((select rows_withheld from public.export_organization_consent_withholding(pg_temp.id(1)) where table_name='resident_regulatory_actions'),1::bigint,'archive declares its withheld clinical duty');
select is((select rows_withheld from public.export_organization_consent_withholding(pg_temp.id(1)) where table_name='audit_logs'),1::bigint,'archive declares its withheld clinical audit copy');
reset role;
-- UPDATE snapshots must not reopen the same path through old_values.
update public.resident_regulatory_actions set details=details||'{"clinical_note":"Updated sensitive finding"}' where resident_id=pg_temp.id(202) and action_type='resident_tb_test';
select pg_temp.act_as();
select is((select count(*)::integer from public.audit_logs where entity_type='resident_regulatory_actions' and old_values->>'action_type'='resident_tb_test'),0,'audit reader cannot recover prior clinical values from update snapshots');
select pg_temp.act_as('service_role');
select is((select count(*)::integer from public.export_organization_table(pg_temp.id(1),'audit_logs') row where row->>'entity_type'='resident_regulatory_actions' and (row->'old_values'->>'resident_id'=pg_temp.id(202)::text or row->'new_values'->>'resident_id'=pg_temp.id(202)::text) and (row->'old_values'->>'action_type'='resident_tb_test' or row->'new_values'->>'action_type'='resident_tb_test')),0,'revoked clinical updates cannot leak through either audit snapshot');
select * from finish();
rollback;
