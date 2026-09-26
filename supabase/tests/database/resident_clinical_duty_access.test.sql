begin;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select ('d2270000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
insert into public.organizations(id,name,slug,subscription_status,trial_ends_at,package_id)
 select pg_temp.id(1),'Clinical duty scope','clinical-duty-scope','trial',now()-interval '1 day',id from public.packages where name='CareMetric Train';
insert into public.facilities(id,organization_id,name,facility_type) values(pg_temp.id(11),pg_temp.id(1),'Authorized ALF','ALR'),(pg_temp.id(12),pg_temp.id(1),'Unassigned ALF','ALR');
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 values(pg_temp.id(101),'authenticated','authenticated','clinical-duty-scope@test.local','x',now(),'{}','{}',now(),now());
select set_config('app.privileged_write','on',true);
insert into public.profiles(id,organization_id,email,first_name,last_name,role,is_active)
 values(pg_temp.id(101),pg_temp.id(1),'clinical-duty-scope@test.local','Clinical','Manager','facility_manager',true)
 on conflict(id) do update set organization_id=excluded.organization_id,role=excluded.role,is_active=true;
select set_config('app.privileged_write','off',true);
insert into public.facility_assignments(profile_id,facility_id) values(pg_temp.id(101),pg_temp.id(11));
insert into app_private.module_access_terms(organization_id,module_key,source,reason) values(pg_temp.id(1),'modules.train','complimentary','Clinical reader scope fixture');
insert into public.residents(id,organization_id,facility_id,first_name,last_name,admission_date) values(pg_temp.id(201),pg_temp.id(1),pg_temp.id(11),'Clinical','Resident',public.pa_today()),(pg_temp.id(202),pg_temp.id(1),pg_temp.id(12),'Other','Resident',public.pa_today());
insert into public.resident_regulatory_actions(organization_id,facility_id,resident_id,action_type,anchor_at,reason) values(pg_temp.id(1),pg_temp.id(11),pg_temp.id(201),'itemized_funds_account',now(),'Financial record remains separate');
insert into public.resident_documents(id,organization_id,facility_id,resident_id,file_name,file_type,storage_path)
 values(pg_temp.id(301),pg_temp.id(1),pg_temp.id(11),pg_temp.id(201),'tb-result.pdf','application/pdf',pg_temp.id(1)||'/'||pg_temp.id(11)||'/tb-result.pdf');
create temporary table clinical_ids(id uuid primary key) on commit drop;
insert into clinical_ids select id from public.resident_regulatory_actions where resident_id=pg_temp.id(201) and action_type='resident_tb_test';
grant select on clinical_ids to authenticated;
create function pg_temp.act_as(p_aal text default 'aal2') returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(101),'role','authenticated','aal',p_aal,'iat',extract(epoch from now())::bigint)::text,true); set local role authenticated; end $$;
create function pg_temp.direct_update(p_id uuid) returns integer language plpgsql as $$declare v_count integer; begin update public.resident_regulatory_actions set evidence='Unauthorized direct rewrite' where id=p_id; get diagnostics v_count=row_count; return v_count; end $$;
select pg_temp.act_as();
select throws_ok($$select * from public.get_resident_regulatory_actions(pg_temp.id(11),pg_temp.id(201))$$,'42501',null,'Train-only access cannot read resident clinical duties');
reset role;
insert into app_private.module_access_terms(organization_id,module_key,source,reason) values(pg_temp.id(1),'modules.carebase','contract','Resident operations independent of optional FHIR');
select pg_temp.act_as();
select is((select count(*)::integer from public.resident_regulatory_actions where resident_id=pg_temp.id(201) and action_type='resident_tb_test'),0,'direct table reads cannot bypass clinical access logging');
select is((select count(*)::integer from public.resident_regulatory_actions where resident_id=pg_temp.id(201) and action_type='itemized_funds_account'),1,'nonclinical notices retain their scoped read path');
select is((select count(*)::integer from public.get_resident_regulatory_actions(pg_temp.id(11),pg_temp.id(201))),2,'CareBase reader retrieves resident duties without optional FHIR entitlement');
reset role;
select is((select count(*)::integer from app_private.clinical_access_log where resident_id=pg_temp.id(201) and actor_profile_id=pg_temp.id(101) and clinical_domain='regulatory_duties'),1,'clinical read writes one access record for the resident');
select pg_temp.act_as();
select is((select count(*)::integer from public.get_resident_regulatory_actions(pg_temp.id(11))),2,'facility-wide reader also includes only scoped clinical duties');
select throws_ok($$select * from public.get_resident_regulatory_actions(pg_temp.id(12))$$,'42501',null,'reader rejects an unassigned facility');
select throws_ok($$select * from public.get_resident_regulatory_actions(pg_temp.id(11),pg_temp.id(202))$$,'42501',null,'reader rejects a resident from another facility');
select throws_ok($$insert into public.resident_regulatory_actions(organization_id,facility_id,resident_id,action_type,anchor_at,reason,details) values(pg_temp.id(1),pg_temp.id(11),pg_temp.id(201),'alf_exception_request',now(),'Direct clinical write','{}')$$,'42501',null,'clinical table writes cannot bypass the manager command');
select is(pg_temp.direct_update((select id from clinical_ids)),0,'direct clinical update cannot see or rewrite protected evidence');
select pg_temp.act_as('aal1');
select throws_ok($$select public.save_resident_clinical_duty(pg_temp.id(201),'resident_tb_test',jsonb_build_object('cycle','initial','document_id',pg_temp.id(301),'tb_result','negative'),'completed',(select id from clinical_ids),null,null,now(),'Actual negative test report')$$,'42501',null,'clinical management requires fresh identity assurance');
select pg_temp.act_as();
select throws_ok($$select public.save_resident_clinical_duty(pg_temp.id(202),'scu_admission','{}')$$,'42501',null,'clinical writer rejects an unassigned resident');
select lives_ok($$select public.save_resident_clinical_duty(pg_temp.id(201),'resident_tb_test',jsonb_build_object('cycle','initial','document_id',pg_temp.id(301),'tb_result','negative'),'completed',(select id from clinical_ids),null,null,now(),'Actual negative test report')$$,'manager can complete generated TB duty through the protected command');
select is((select count(*)::integer from public.get_resident_regulatory_actions(pg_temp.id(11),pg_temp.id(201)) where action_type='resident_tb_test'),2,'completed evidence and successor remain available through the logged reader');
reset role;
select is((select count(*)::integer from app_private.clinical_access_log where resident_id=pg_temp.id(201) and actor_profile_id=pg_temp.id(101) and clinical_domain='regulatory_duties'),3,'each reader request logs once even when two clinical rows share a resident');
select ok(not has_function_privilege('anon','public.get_resident_regulatory_actions(uuid,uuid,integer)','EXECUTE'),'anonymous clients cannot call the clinical reader');
select ok(not has_function_privilege('authenticated','app_private.assert_resident_regulatory_manager(uuid,uuid)','EXECUTE'),'the clinical manager guard is not itself an exposed bypass');
select * from finish();
rollback;
