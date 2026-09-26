begin;
select no_plan();
insert into public.organizations(id,name,slug,subscription_status) values
('a2380000-0000-4000-8000-000000000001','Retention A','retention-a','active'),
('a2380000-0000-4000-8000-000000000002','Retention B','retention-b','active');
insert into public.facilities(id,organization_id,name,facility_type) values
('a2380000-0000-4000-8000-000000000011','a2380000-0000-4000-8000-000000000001','Retention PCH','PCH'),
('a2380000-0000-4000-8000-000000000012','a2380000-0000-4000-8000-000000000001','Retention ALF','ALR');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change,email_change_token_current,reauthentication_token,is_sso_user,is_anonymous)
select '00000000-0000-0000-0000-000000000000',('a2380000-0000-4000-8000-00000000010'||i)::uuid,'authenticated','authenticated','retention-'||i||'@test.local','x',now(),'{}','{}',now(),now(),'','','','','','',false,false from generate_series(1,2) i;
select set_config('app.privileged_write','on',true);
insert into public.profiles(id,organization_id,email,first_name,last_name,role,is_active)
select ('a2380000-0000-4000-8000-00000000010'||i)::uuid,('a2380000-0000-4000-8000-00000000000'||i)::uuid,'retention-'||i||'@test.local','Admin',i::text,'org_admin',true from generate_series(1,2) i
on conflict(id) do update set organization_id=excluded.organization_id,role=excluded.role,is_active=true;
select set_config('app.privileged_write','off',true);
insert into public.residents(id,organization_id,facility_id,first_name,last_name,status,admission_date,discharge_date,date_of_birth)
select ('a2380000-0000-4000-8000-00000000002'||i)::uuid,'a2380000-0000-4000-8000-000000000001',
case when i=2 then 'a2380000-0000-4000-8000-000000000012'::uuid else 'a2380000-0000-4000-8000-000000000011'::uuid end,
'Resident',i::text,case when i=1 then 'active' when i=6 then 'deceased' else 'discharged' end,
(public.pa_today()-interval '5 years')::date,
case when i=1 then null when i=2 then (public.pa_today()-interval '3 years')::date+1 else (public.pa_today()-interval '3 years')::date end,
case when i=4 then null else '1940-01-01'::date end from generate_series(1,6) i;
insert into public.resident_documents(id,organization_id,facility_id,resident_id,storage_path,file_name,file_type)
select ('a2380000-0000-4000-8000-00000000003'||i)::uuid,'a2380000-0000-4000-8000-000000000001','a2380000-0000-4000-8000-000000000011',
('a2380000-0000-4000-8000-00000000002'||i)::uuid,'a2380000-0000-4000-8000-000000000001/a2380000-0000-4000-8000-000000000011/retained-'||i||'.pdf','Retained.pdf','application/pdf' from generate_series(1,4) i;
insert into public.resident_compliance_items(id,organization_id,facility_id,resident_id,item_type)
select ('a2380000-0000-4000-8000-00000000004'||i)::uuid,'a2380000-0000-4000-8000-000000000001','a2380000-0000-4000-8000-000000000011',
('a2380000-0000-4000-8000-00000000002'||i)::uuid,'medical_evaluation' from generate_series(1,6) i;

select throws_ok($$delete from public.resident_documents where id='a2380000-0000-4000-8000-000000000031'$$,'23514',null,'active PCH resident document cannot be deleted even when unreferenced');
select throws_ok($$delete from public.resident_compliance_items where id='a2380000-0000-4000-8000-000000000041'$$,'23514',null,'direct child compliance deletion is retained');
select throws_ok($$delete from public.residents where id='a2380000-0000-4000-8000-000000000021'$$,'23514',null,'privileged resident purge cannot bypass active-record retention');
select throws_ok($$delete from public.resident_documents where id='a2380000-0000-4000-8000-000000000032'$$,'23514',null,'ALF record cannot be destroyed the day before the three-year anniversary');
select throws_ok($$update public.resident_documents set resident_id='a2380000-0000-4000-8000-000000000023' where id='a2380000-0000-4000-8000-000000000031'$$,'23514',null,'reparenting cannot substitute an older discharged resident');
select throws_ok($$update public.resident_documents set storage_path=storage_path||'.new' where id='a2380000-0000-4000-8000-000000000031'$$,'23514',null,'rewriting the metadata path cannot release retained original bytes');
select throws_ok($$delete from public.resident_documents where id='a2380000-0000-4000-8000-000000000034'$$,'23514',null,'birth date is required to produce a complete destruction log');
select is((select count(*)::integer from app_private.resident_record_destructions),0,'failed deletions leave no false destruction entries');

-- A correction cannot shorten the observed retention period; historical scopes
-- continue to apply if the facility is moved or reclassified.
update public.residents set discharge_date=(public.pa_today()-interval '4 years')::date where id='a2380000-0000-4000-8000-000000000022';
select throws_ok($$delete from public.resident_compliance_items where id='a2380000-0000-4000-8000-000000000042'$$,'23514',null,'backdating a discharge cannot shorten a recorded retention period');
update public.facilities set facility_type='NH' where id='a2380000-0000-4000-8000-000000000012';
select throws_ok($$delete from public.resident_compliance_items where id='a2380000-0000-4000-8000-000000000042'$$,'23514',null,'facility reclassification cannot strip a retained ALF record of its protection');

insert into app_private.audit_legal_holds(id,organization_id,facility_id,reason,created_by)
values('a2380000-0000-4000-8000-000000000051','a2380000-0000-4000-8000-000000000001','a2380000-0000-4000-8000-000000000011','Unresolved record audit','a2380000-0000-4000-8000-000000000101');
select throws_ok($$delete from public.resident_documents where id='a2380000-0000-4000-8000-000000000033'$$,'23514',null,'active audit hold blocks document deletion after three years');
select throws_ok($$delete from public.resident_compliance_items where id='a2380000-0000-4000-8000-000000000043'$$,'23514',null,'active audit hold blocks child compliance deletion');
select throws_ok($$delete from public.residents where id='a2380000-0000-4000-8000-000000000025'$$,'23514',null,'active audit hold blocks an otherwise eligible parent purge');
update app_private.audit_legal_holds set released_at=now(),released_by=created_by,release_reason='Audit resolved' where id='a2380000-0000-4000-8000-000000000051';
select lives_ok($$delete from public.resident_compliance_items where id='a2380000-0000-4000-8000-000000000043'$$,'release permits destruction on the exact three-calendar-year anniversary');
select ok((select completed_at is not null and resident_name='Resident 3' and record_number=resident_id::text and date_of_birth='1940-01-01' from app_private.resident_record_destructions where record_id='a2380000-0000-4000-8000-000000000043'),'completed child destruction snapshots required resident identity');
select lives_ok($$delete from public.resident_documents where id='a2380000-0000-4000-8000-000000000033'$$,'expired unreferenced document enters the existing durable cleanup workflow');
select ok((select completed_at is null from app_private.resident_record_destructions where record_id='a2380000-0000-4000-8000-000000000033'),'metadata removal is not yet actual file destruction');
select ok(exists(select 1 from app_private.resident_document_deletions where document_id='a2380000-0000-4000-8000-000000000033'),'document destruction retains its durable Storage cleanup receipt');

insert into public.data_import_jobs(id,organization_id,facility_id,domain,status,original_file_name,original_file_sha256,applied_at)
values('a2380000-0000-4000-8000-000000000061','a2380000-0000-4000-8000-000000000001','a2380000-0000-4000-8000-000000000011','residents','applied','fixture.csv',repeat('a',64),now());
insert into public.data_import_rows(organization_id,job_id,row_number,status,target_table,target_id,applied_at)
values('a2380000-0000-4000-8000-000000000001','a2380000-0000-4000-8000-000000000061',2,'applied','residents','a2380000-0000-4000-8000-000000000021',now());

select set_config('request.jwt.claims',jsonb_build_object('sub','a2380000-0000-4000-8000-000000000101','role','authenticated','aal','aal2')::text,true);
set local role authenticated;
select is((public.rollback_data_import_job('a2380000-0000-4000-8000-000000000061')->>'blocked')::integer,1,'import rollback reports active resident retention without aborting the job');
select is(public.confirm_resident_document_deletion('a2380000-0000-4000-8000-000000000033'),true,'confirmed absence of bytes completes destruction');
select is((select count(*)::integer from public.list_resident_record_destructions('a2380000-0000-4000-8000-000000000023')),2,'organization admin can read completed document and child destruction entries');
reset role;
select ok((select completed_at is not null from app_private.resident_record_destructions where record_id='a2380000-0000-4000-8000-000000000033'),'confirmed cleanup stamps the immutable destruction log');
select throws_ok($$update app_private.resident_record_destructions set resident_name='Rewritten' where record_id='a2380000-0000-4000-8000-000000000033'$$,'23514',null,'destruction identity cannot be rewritten');
select throws_ok($$delete from app_private.resident_record_destructions where record_id='a2380000-0000-4000-8000-000000000033'$$,'23514',null,'destruction history cannot be deleted');
select lives_ok($$delete from public.residents where id='a2380000-0000-4000-8000-000000000025'$$,'eligible parent purge and child cascades share the verified identity snapshot');
select ok(exists(select 1 from app_private.resident_record_destructions where record_table='residents' and record_id='a2380000-0000-4000-8000-000000000025') and exists(select 1 from app_private.resident_record_destructions where record_table='resident_compliance_items' and record_id='a2380000-0000-4000-8000-000000000045'),'parent and child destruction evidence survives the parent purge');
select lives_ok($$delete from public.resident_compliance_items where id='a2380000-0000-4000-8000-000000000046'$$,'the recorded death date observes the same three-year retention period');
select set_config('request.jwt.claims',jsonb_build_object('sub','a2380000-0000-4000-8000-000000000102','role','authenticated','aal','aal2')::text,true);
set local role authenticated;
select is((select count(*)::integer from public.list_resident_record_destructions('a2380000-0000-4000-8000-000000000023')),0,'another tenant cannot enumerate known resident destruction history');
reset role;
select ok(not has_table_privilege('authenticated','app_private.resident_record_destructions','SELECT'),'destruction snapshots remain private');
select ok(not has_function_privilege('anon','public.list_resident_record_destructions(uuid)','EXECUTE'),'anonymous callers cannot enumerate the destruction log');
select * from finish();
rollback;
