begin;
select no_plan();
select ok(not has_table_privilege('service_role','app_private.learning_package_originals','INSERT'),'original evidence has no direct service grant');
select ok(not has_function_privilege('authenticated','public.record_learning_package_artifact(uuid,text,integer,text,integer,text,text)','EXECUTE'),'browser cannot invent verified artifact evidence');
select ok(not has_function_privilege('anon','public.prepare_native_learning_package_operation(jsonb)','EXECUTE'),'anonymous callers cannot prepare uploads');
select ok(not has_function_privilege('authenticated','public.prepare_delegated_learning_package_operation(uuid,uuid,uuid,timestamptz,timestamptz,text,jsonb)','EXECUTE'),'browser cannot manufacture Hub authority');

insert into public.organizations(id,name,slug,subscription_status) values
 ('22000000-0000-4000-8000-000000000010','Package fixture','package-ingestion-fixture','active'),
 ('22000000-0000-4000-8000-000000000011','Other package fixture','package-ingestion-other','active');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
 created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change,email_change_token_current,reauthentication_token,is_sso_user,is_anonymous)
select '00000000-0000-0000-0000-000000000000',id,'authenticated','authenticated',email,'x',now(),'{}','{}',now(),now(),'','','','','','',false,false
from (values ('22000000-0000-4000-8000-000000000001'::uuid,'package-operator@test.local'),
 ('22000000-0000-4000-8000-000000000002'::uuid,'package-trainer@test.local')) fixture(id,email);
select set_config('app.privileged_write','on',true);
update public.profiles set role='platform_admin',is_active=true where id='22000000-0000-4000-8000-000000000001';
update public.profiles set role='trainer',is_active=true,organization_id='22000000-0000-4000-8000-000000000010' where id='22000000-0000-4000-8000-000000000002';
select set_config('app.privileged_write','',true);
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('22000000-0000-4000-8000-000000000003','22000000-0000-4000-8000-000000000001',now()-interval '1 hour',now(),'aal2'),
 ('22000000-0000-4000-8000-000000000004','22000000-0000-4000-8000-000000000002',now()-interval '1 hour',now(),'aal2'),
 ('22000000-0000-4000-8000-000000000005','22000000-0000-4000-8000-000000000001',now()-interval '1 minute',now(),'aal2');
insert into public.courses(id,organization_id,title,status,created_by) values
 ('22000000-0000-4000-8000-000000000020',null,'Global package draft','draft','22000000-0000-4000-8000-000000000001'),
 ('22000000-0000-4000-8000-000000000021','22000000-0000-4000-8000-000000000010','Tenant package draft','draft','22000000-0000-4000-8000-000000000001'),
 ('22000000-0000-4000-8000-000000000022','22000000-0000-4000-8000-000000000011','Other tenant draft','draft','22000000-0000-4000-8000-000000000001');
insert into public.course_versions(id,course_id,organization_id,version_number,title,status) values
 ('22000000-0000-4000-8000-000000000030','22000000-0000-4000-8000-000000000020',null,1,'Global version','draft'),
 ('22000000-0000-4000-8000-000000000031','22000000-0000-4000-8000-000000000021','22000000-0000-4000-8000-000000000010',1,'Tenant version','draft'),
 ('22000000-0000-4000-8000-000000000032','22000000-0000-4000-8000-000000000022','22000000-0000-4000-8000-000000000011',1,'Other version','draft');

create temporary table package_fixture(label text primary key,value jsonb);
grant all on package_fixture to authenticated,service_role;
create function pg_temp.package_actor(p_trainer boolean default false,p_new_session boolean default false) returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','aal','aal2','sub',
 case when p_trainer then '22000000-0000-4000-8000-000000000002' else '22000000-0000-4000-8000-000000000001' end,
 'session_id',case when p_trainer then '22000000-0000-4000-8000-000000000004' when p_new_session then '22000000-0000-4000-8000-000000000005' else '22000000-0000-4000-8000-000000000003' end)::text,true);
$$;
create function pg_temp.package_upload_request(p_request uuid,p_version uuid default '22000000-0000-4000-8000-000000000030',p_hash text default repeat('a',64)) returns jsonb language sql as $$
 select jsonb_build_object('operation','upload','requestId',p_request,'versionId',p_version,
   'sourceRevision',public.get_native_learning_package_context(p_version,null)->>'sourceRevision','reason','Synthetic original upload',
   'standard','scorm_1_2','sourceSha256',p_hash,'sourceBytes',128);
$$;

set local role authenticated;
select pg_temp.package_actor();
insert into package_fixture values('request',pg_temp.package_upload_request('22000000-0000-4000-8000-000000000040'));
insert into package_fixture values('plan',public.prepare_native_learning_package_operation((select value from package_fixture where label='request')));
select is((select value->>'operation' from package_fixture where label='plan'),'upload','prepares original upload');
select is((select value->'source'->>'bucket' from package_fixture where label='plan'),'learning-package-originals','new source uses private original bucket');
select ok((select value->>'originalPath' like 'global/22000000-0000-4000-8000-000000000020/%' from package_fixture where label='plan'),'global upload is course-owned without a facility');
select throws_ok($$select public.finish_native_learning_package_operation((select (value->>'operationId')::uuid from package_fixture where label='plan'))$$,'42501',null,'cannot finish without trusted byte evidence');
select throws_ok($$select public.prepare_native_learning_package_operation((select value||'{"storagePath":"foreign/file.zip"}'::jsonb from package_fixture where label='request'))$$,'22023',null,'client cannot choose an existing foreign storage path');
select throws_ok($$select public.prepare_native_learning_package_operation((select jsonb_set(value,'{reason}','"Different operation reason"') from package_fixture where label='request'))$$,'40001',null,'same request ID binds exact input');
select throws_ok($$select public.accept_learning_package('22000000-0000-4000-8000-000000000099',null,'Bypass attempted by client')$$,'42501',null,'legacy direct acceptance cannot bypass runtime proof');
reset role;
select is((select count(*) from public.learning_packages where course_version_id='22000000-0000-4000-8000-000000000030'),0::bigint,'prepare does not register a package');
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select public.record_learning_package_artifact((select (value->>'operationId')::uuid from package_fixture where label='plan'),repeat('a',64),128);
select throws_ok($$select public.record_learning_package_artifact((select (value->>'operationId')::uuid from package_fixture where label='plan'),repeat('b',64),128)$$,'40001',null,'observed original hash cannot change');
set local role authenticated;
select pg_temp.package_actor();
select is(public.get_native_learning_package_context('22000000-0000-4000-8000-000000000030',null)->'intents'->'items'->0->>'state','staged','context exposes verified staged evidence');
select is(public.get_native_learning_package_context('22000000-0000-4000-8000-000000000030',null)->'intents'->'items'->0->>'canFinishThisSession','true','context permits original current session finalization');
select pg_temp.package_actor(false,true);
select is(public.get_native_learning_package_context('22000000-0000-4000-8000-000000000030',null)->'intents'->'items'->0->>'canFinishThisSession','false','fresh session may inspect but cannot adopt old write authority');
select pg_temp.package_actor();
insert into package_fixture values('registered',public.finish_native_learning_package_operation((select (value->>'operationId')::uuid from package_fixture where label='plan')));
select is((select value->>'status' from package_fixture where label='registered'),'pending','byte evidence registers pending package only');
select is(public.prepare_native_learning_package_operation((select value from package_fixture where label='request'))->'result',(select value from package_fixture where label='registered'),'lost registration response returns same receipt');
select is(public.get_native_learning_package_context('22000000-0000-4000-8000-000000000030',null)->'intents'->'items'->0->>'sourceRevision',(select value->>'sourceRevision' from package_fixture where label='request'),'context keeps immutable pre-commit source revision');
select is(public.get_native_learning_package_context('22000000-0000-4000-8000-000000000030',null)->'intents'->'items'->0->'result'->>'sourceRevision',(select value->>'sourceRevision' from package_fixture where label='registered'),'committed receipt keeps exact post-commit source revision');
reset role;
select ok((select organization_id is null from public.learning_packages where id=(select (value->>'packageId')::uuid from package_fixture where label='plan')),'registered package keeps NULL global organization');
select is((select content_sha256 from app_private.learning_package_originals where package_id=(select (value->>'packageId')::uuid from package_fixture where label='plan')),repeat('a',64),'original SHA stored separately');
select throws_ok($$update app_private.learning_package_originals set content_sha256=repeat('b',64)$$,'42501',null,'original evidence immutable');
set local role authenticated;
select pg_temp.package_actor(false,true);
select is(public.get_native_learning_package_operation('22000000-0000-4000-8000-000000000040')->>'status','committed','fresh actual session can recover own committed receipt');
select throws_ok($$select public.finish_native_learning_package_operation((select (value->>'operationId')::uuid from package_fixture where label='plan'))$$,'42501',null,'fresh session cannot replay old write grant');
select pg_temp.package_actor();
insert into package_fixture values('accept_request',jsonb_build_object('operation','accept','requestId','22000000-0000-4000-8000-000000000041',
 'packageId',(select value->>'packageId' from package_fixture where label='registered'),
 'sourceRevision',public.get_native_learning_package_context('22000000-0000-4000-8000-000000000030',null)->>'sourceRevision',
 'entryPoint','index.html','reason','Synthetic authored package review','bridgeSha256',repeat('c',64)));
insert into package_fixture values('accept_plan',public.prepare_native_learning_package_operation((select value from package_fixture where label='accept_request')));
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select throws_ok($$select public.record_learning_package_artifact((select (value->>'operationId')::uuid from package_fixture where label='accept_plan'),repeat('a',64),128,repeat('d',64),200,'index.html',repeat('e',64))$$,'22023',null,'bridge evidence must match prepared identity');
select public.record_learning_package_artifact((select (value->>'operationId')::uuid from package_fixture where label='accept_plan'),repeat('a',64),128,repeat('d',64),200,'index.html',repeat('c',64));
reset role;
select set_config('app.privileged_write','on',true);
update public.profiles set is_active=false where id='22000000-0000-4000-8000-000000000001';
select set_config('app.privileged_write','',true);
set local role authenticated;
select pg_temp.package_actor();
select throws_ok($$select public.finish_native_learning_package_operation((select (value->>'operationId')::uuid from package_fixture where label='accept_plan'))$$,'42501',null,'revoked actor after upload cannot accept');
reset role;
select is((select validation_status from public.learning_packages where id=(select (value->>'packageId')::uuid from package_fixture where label='plan')),'pending','failed final authority leaves package pending');
select set_config('app.privileged_write','on',true);
update public.profiles set is_active=true where id='22000000-0000-4000-8000-000000000001';
select set_config('app.privileged_write','',true);
set local role authenticated;
select pg_temp.package_actor();
insert into package_fixture values('accepted',public.finish_native_learning_package_operation((select (value->>'operationId')::uuid from package_fixture where label='accept_plan')));
select is((select value->>'status' from package_fixture where label='accepted'),'accepted','current actor commits verified runtime');
select is((select value->>'sourceSha256' from package_fixture where label='accepted'),repeat('a',64),'source SHA remains original');
select is((select value->>'runtimeSha256' from package_fixture where label='accepted'),repeat('d',64),'runtime SHA distinct and explicit');
reset role;
select ok((select storage_path like 'managed/%' from public.learning_packages where id=(select (value->>'packageId')::uuid from package_fixture where label='plan')),'runtime pointer is a separate managed path');
select is((select content_sha256 from app_private.learning_package_originals where package_id=(select (value->>'packageId')::uuid from package_fixture where label='plan')),repeat('a',64),'acceptance cannot overwrite original hash');
select is((select metadata->>'authenticationMethod' from public.audit_logs where action='package_artifact_accepted' and entity_id=(select value->>'packageId' from package_fixture where label='plan')),'native_session','audit reports actual native method');
select throws_ok($$delete from app_private.learning_package_artifacts$$,'42501',null,'verified artifact evidence cannot be removed');

set local role authenticated;
select pg_temp.package_actor();
insert into package_fixture values('stale',public.prepare_native_learning_package_operation(pg_temp.package_upload_request('22000000-0000-4000-8000-000000000042','22000000-0000-4000-8000-000000000030',repeat('f',64))));
reset role;
update public.course_versions set title='Concurrent authored change' where id='22000000-0000-4000-8000-000000000030';
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select public.record_learning_package_artifact((select (value->>'operationId')::uuid from package_fixture where label='stale'),repeat('f',64),128);
set local role authenticated;
select pg_temp.package_actor();
select throws_ok($$select public.finish_native_learning_package_operation((select (value->>'operationId')::uuid from package_fixture where label='stale'))$$,'40001',null,'draft changes during upload fail final CAS');
select pg_temp.package_actor(true);
select throws_ok($$select public.get_native_learning_package_context('22000000-0000-4000-8000-000000000030',null)$$,'42501',null,'tenant trainer cannot target global course');
select throws_ok($$select public.get_native_learning_package_context('22000000-0000-4000-8000-000000000032',null)$$,'42501',null,'tenant trainer cannot target another tenant');
select lives_ok($$select public.get_native_learning_package_context('22000000-0000-4000-8000-000000000031',null)$$,'same-tenant trainer retains scoped authoring access');
reset role;
select is((select count(*) from public.learning_packages where course_version_id='22000000-0000-4000-8000-000000000030'),1::bigint,'rejected CAS adds no second package');

-- Existing canonical native registrations can still enter the common verified worker.
-- The global case must not inherit an operator's tenant or depend on a facility document.
insert into public.courses(id,organization_id,title,status,created_by) values
 ('22000000-0000-4000-8000-000000000023',null,'Legacy global package draft','draft','22000000-0000-4000-8000-000000000001');
insert into public.course_versions(id,course_id,organization_id,version_number,title,status) values
 ('22000000-0000-4000-8000-000000000033','22000000-0000-4000-8000-000000000023',null,1,'Legacy global version','draft');
insert into storage.objects(bucket_id,name,metadata) values('learning-packages',
 'global/22000000-0000-4000-8000-000000000033/'||repeat('e',64)||'.zip','{"size":128}'::jsonb);
set local role authenticated;
select pg_temp.package_actor();
select throws_ok($$select public.register_learning_package('22000000-0000-4000-8000-000000000033','scorm_1_2',
 'global/22000000-0000-4000-8000-000000000033/'||repeat('e',64)||'.zip',repeat('e',64),52428801)$$,'22023',null,'legacy registration cannot advertise files above worker 50 MiB bound');
select throws_ok($$select public.register_learning_package('22000000-0000-4000-8000-000000000033','scorm_1_2',
 'global/22000000-0000-4000-8000-000000000033/'||repeat('e',64)||'.zip',repeat('e',64),128,'index.html','22000000-0000-4000-8000-000000000010')$$,'42501',null,'legacy global upload cannot borrow a tenant identity');
insert into package_fixture values('legacy_package',to_jsonb(public.register_learning_package('22000000-0000-4000-8000-000000000033','scorm_1_2',
 'global/22000000-0000-4000-8000-000000000033/'||repeat('e',64)||'.zip',repeat('e',64),128)));
insert into package_fixture values('legacy_plan',public.prepare_native_learning_package_operation(jsonb_build_object('operation','accept',
 'requestId','22000000-0000-4000-8000-000000000043','packageId',(select value#>>'{}' from package_fixture where label='legacy_package'),
 'sourceRevision',public.get_native_learning_package_context('22000000-0000-4000-8000-000000000033',null)->>'sourceRevision',
 'entryPoint','index.html','reason','Review canonical legacy source','bridgeSha256',repeat('c',64))));
reset role;
select ok((select organization_id is null from public.learning_packages where id=(select (value#>>'{}')::uuid from package_fixture where label='legacy_package')),'legacy global registration keeps NULL organization');
select is((select count(*) from public.audit_logs where entity_id=(select value#>>'{}' from package_fixture where label='legacy_package') and action='package_registered'),1::bigint,'legacy global registration emits native audit');
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select public.record_learning_package_artifact((select (value->>'operationId')::uuid from package_fixture where label='legacy_plan'),repeat('e',64),128,repeat('d',64),200,'index.html',repeat('c',64));
set local role authenticated;
select pg_temp.package_actor();
select is(public.finish_native_learning_package_operation((select (value->>'operationId')::uuid from package_fixture where label='legacy_plan'))->>'status','accepted','canonical legacy global package uses immutable common acceptance');
reset role;
select is((select content_sha256 from app_private.learning_package_originals where package_id=(select (value#>>'{}')::uuid from package_fixture where label='legacy_package')),repeat('e',64),'legacy original retained independently from accepted runtime');
insert into public.learning_packages(id,organization_id,course_version_id,standard_type,storage_bucket,storage_path,content_sha256,compressed_bytes,validation_status,created_by)
 values('22000000-0000-4000-8000-000000000060',null,'22000000-0000-4000-8000-000000000033','lti_1_3','learning-packages',
 'global/22000000-0000-4000-8000-000000000033/'||repeat('f',64)||'.zip',repeat('f',64),128,'pending','22000000-0000-4000-8000-000000000001');
set local role authenticated;
select pg_temp.package_actor();
select throws_ok($$select public.prepare_native_learning_package_operation(jsonb_build_object('operation','accept',
 'requestId','22000000-0000-4000-8000-000000000061','packageId','22000000-0000-4000-8000-000000000060',
 'sourceRevision',public.get_native_learning_package_context('22000000-0000-4000-8000-000000000033',null)->>'sourceRevision',
 'entryPoint',null,'reason','Unsupported LTI ZIP acceptance','bridgeSha256',repeat('c',64)))$$,'22023',null,'LTI tools never enter the ZIP runtime bridge');
do $$begin for i in 1..21 loop
 perform public.prepare_native_learning_package_operation(pg_temp.package_upload_request(gen_random_uuid()));
 end loop;end;$$;
select is(jsonb_array_length(public.get_native_learning_package_context('22000000-0000-4000-8000-000000000030',null)->'intents'->'items'),20,'context bounds recovery list to twenty actor-owned intents');
select is(public.get_native_learning_package_context('22000000-0000-4000-8000-000000000030',null)->'intents'->>'hasMore','true','context signals omitted older operations');
select pg_temp.package_actor(true);
select is(jsonb_array_length(public.get_native_learning_package_context('22000000-0000-4000-8000-000000000031',null)->'intents'->'items'),0,'another actor context exposes no foreign operations');
reset role;
select * from finish();
rollback;
