begin;
select plan(32);

select has_table('public','governed_content_revisions','governed revisions exist');
select has_table('public','policy_audience_rules','effective policy audiences exist');
select has_table('public','learning_packages','standards packages exist');
select has_table('public','learning_runtime_commits','normalized runtime commits exist');
select has_table('public','xapi_statements','xAPI statement receipts exist');
select has_table('public','lti_tool_registrations','LTI 1.3 registrations exist');
select has_table('public','learning_path_transition_events','adaptive transition evidence exists');
select has_table('public','offline_sync_receipts','offline sync receipts exist');
select has_function('public','sync_offline_learning_action',array['uuid','uuid','text','integer','integer','text','timestamp with time zone','jsonb'],'offline sync is a server command');
select ok(not has_function_privilege('anon','public.commit_learning_runtime_state(uuid,text,integer,jsonb)','EXECUTE'),'anonymous runtime commits are closed');
select ok(not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in('governed_content_assets','governed_content_revisions','learning_packages','learning_runtime_sessions','learning_runtime_commits','xapi_statements','lti_tool_registrations','learning_path_definitions','learning_path_versions','learning_path_assignments','offline_device_registrations','offline_content_manifests','offline_sync_receipts') and not c.relrowsecurity),'all Phase 4 exposed tables enable RLS');

insert into public.organizations(id,name,slug) values('44000000-0000-4000-8000-000000000001','Phase 4 Org','phase4-org');
insert into public.facilities(id,organization_id,name,facility_type) values('44000000-0000-4000-8000-000000000011','44000000-0000-4000-8000-000000000001','Phase 4 Facility','PCH');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change,email_change_token_current,reauthentication_token,is_sso_user,is_anonymous)
select '00000000-0000-0000-0000-000000000000',id,'authenticated','authenticated',email,'x',now(),'{}','{}',now(),now(),'','','','','','',false,false from (values
('44000000-0000-4000-8000-000000000101'::uuid,'p4-author@test.local'),
('44000000-0000-4000-8000-000000000102'::uuid,'p4-reviewer@test.local'),
('44000000-0000-4000-8000-000000000103'::uuid,'p4-learner@test.local')) v(id,email);
select set_config('app.privileged_write','on',true);
insert into public.profiles(id,organization_id,email,first_name,last_name,role,is_active) values
('44000000-0000-4000-8000-000000000101','44000000-0000-4000-8000-000000000001','p4-author@test.local','Content','Author','org_admin',true),
('44000000-0000-4000-8000-000000000102','44000000-0000-4000-8000-000000000001','p4-reviewer@test.local','Content','Reviewer','org_admin',true),
('44000000-0000-4000-8000-000000000103','44000000-0000-4000-8000-000000000001','p4-learner@test.local','Offline','Learner','employee',true)
on conflict(id) do update set organization_id=excluded.organization_id,email=excluded.email,first_name=excluded.first_name,last_name=excluded.last_name,role=excluded.role,is_active=true;
select set_config('app.privileged_write','off',true);
insert into public.employees(id,organization_id,facility_id,profile_id,employee_number,first_name,last_name,email,hire_date,job_title,status) values('44000000-0000-4000-8000-000000000201','44000000-0000-4000-8000-000000000001','44000000-0000-4000-8000-000000000011','44000000-0000-4000-8000-000000000103','P4-L','Offline','Learner','p4-learner@test.local',current_date-30,'Caregiver','active');
select set_config('app.privileged_write','on',true);
insert into public.courses(id,organization_id,title,status,created_by) values('44000000-0000-4000-8000-000000000301','44000000-0000-4000-8000-000000000001','Governed Course','draft','44000000-0000-4000-8000-000000000101');
insert into public.course_versions(id,course_id,organization_id,version_number,title,status) values('44000000-0000-4000-8000-000000000302','44000000-0000-4000-8000-000000000301','44000000-0000-4000-8000-000000000001',1,'Governed Course v1','draft');
insert into public.course_blocks(course_version_id,organization_id,block_type,sort_order,title,body) values('44000000-0000-4000-8000-000000000302','44000000-0000-4000-8000-000000000001','text',0,'Introduction','{"content":"Approved learner content"}');
update public.course_versions set status='published',published_at=now() where id='44000000-0000-4000-8000-000000000302';
update public.courses set current_version_id='44000000-0000-4000-8000-000000000302',status='published' where id='44000000-0000-4000-8000-000000000301';
insert into public.course_assignments(id,organization_id,facility_id,employee_id,course_id,course_version_id,status) values('44000000-0000-4000-8000-000000000303','44000000-0000-4000-8000-000000000001','44000000-0000-4000-8000-000000000011','44000000-0000-4000-8000-000000000201','44000000-0000-4000-8000-000000000301','44000000-0000-4000-8000-000000000302','assigned');
select set_config('app.privileged_write','off',true);
insert into public.governed_content_assets(id,organization_id,asset_type,source_id,title,owner_profile_id) values('44000000-0000-4000-8000-000000000401','44000000-0000-4000-8000-000000000001','course','44000000-0000-4000-8000-000000000301','Governed Course','44000000-0000-4000-8000-000000000101');

create or replace function pg_temp.act_as(p_id uuid) returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claims',jsonb_build_object('sub',p_id,'role','authenticated','aal','aal2','iat',extract(epoch from now())::bigint)::text,true); set local role authenticated; end $$;
create temporary table p4_ids(key text primary key,id uuid) on commit drop; grant all on p4_ids to authenticated,service_role;

select pg_temp.act_as('44000000-0000-4000-8000-000000000101');
insert into p4_ids values('revision',public.create_governed_content_revision('44000000-0000-4000-8000-000000000401','44000000-0000-4000-8000-000000000302','Material clinical update',true,'reassign','{"title":"Governed Course v1","blocks":[{"type":"text"}]}'::jsonb));
select is((select state from public.governed_content_revisions where id=(select id from p4_ids where key='revision')),'draft','new governed revision starts in draft');
select lives_ok($$select public.submit_governed_content_revision((select id from p4_ids where key='revision'),'[]'::jsonb)$$,'author can submit validated revision');
select throws_ok($$select public.review_governed_content_revision((select id from p4_ids where key='revision'),'approve','Self approval attempt')$$,'42501',null,'author cannot approve own protected publication');

select pg_temp.act_as('44000000-0000-4000-8000-000000000102');
select lives_ok($$select public.review_governed_content_revision((select id from p4_ids where key='revision'),'approve','Independent clinical review complete')$$,'independent reviewer approves revision');
select lives_ok($$select public.publish_governed_content_revision((select id from p4_ids where key='revision'),'Approved for controlled release')$$,'reviewer may publish independently from author');
select is((select current_published_revision_id from public.governed_content_assets where id='44000000-0000-4000-8000-000000000401'),(select id from p4_ids where key='revision'),'learners resolve the stable published revision');
reset role;
select throws_ok($$update public.governed_content_revisions set snapshot='{"tampered":true}' where id=(select id from p4_ids where key='revision')$$,'55000',null,'published snapshot is immutable');
select pg_temp.act_as('44000000-0000-4000-8000-000000000102');
select is((select count(*)::integer from public.governed_content_publication_events where revision_id=(select id from p4_ids where key='revision')),3,'submission review and publication evidence is retained');

reset role;
insert into public.learning_packages(id,organization_id,course_version_id,standard_type,storage_path,content_sha256,compressed_bytes,expanded_bytes,entry_point,validation_status,validation_results,validated_at,immutable_at) values('44000000-0000-4000-8000-000000000501','44000000-0000-4000-8000-000000000001','44000000-0000-4000-8000-000000000302','scorm_2004_4th','phase4/package.zip',repeat('a',64),1000,5000,'index.html','accepted','[]',now(),now());
insert into public.learning_runtime_sessions(id,organization_id,package_id,assignment_id,employee_id,registration_key,runtime_standard,launch_nonce_sha256,expires_at) values('44000000-0000-4000-8000-000000000502','44000000-0000-4000-8000-000000000001','44000000-0000-4000-8000-000000000501','44000000-0000-4000-8000-000000000303','44000000-0000-4000-8000-000000000201','phase4-registration','scorm_2004_4th',repeat('b',64),now()+interval '2 hours');

select pg_temp.act_as('44000000-0000-4000-8000-000000000103');
insert into p4_ids values('commit',public.commit_learning_runtime_state('44000000-0000-4000-8000-000000000502','commit-0001',1,'{"progress":0.5,"completionStatus":"incomplete","successStatus":"unknown","suspendData":"bookmark","sessionTimeSeconds":60}'::jsonb));
select is(public.commit_learning_runtime_state('44000000-0000-4000-8000-000000000502','commit-0001',1,'{"progress":0.5,"completionStatus":"incomplete","successStatus":"unknown"}'::jsonb),(select id from p4_ids where key='commit'),'SCORM replay returns canonical commit');
select is((select count(*)::integer from public.learning_runtime_commits where runtime_session_id='44000000-0000-4000-8000-000000000502'),1,'SCORM replay cannot duplicate progress');
select throws_ok($$select public.commit_learning_runtime_state('44000000-0000-4000-8000-000000000502','commit-0002',3,'{"progress":0.6}'::jsonb)$$,'40001',null,'out-of-order SCORM commits conflict');
select is(public.ingest_xapi_statement('44000000-0000-4000-8000-000000000511','44000000-0000-4000-8000-000000000502','44000000-0000-4000-8000-000000000201','https://adlnet.gov/expapi/verbs/progressed','https://caremetrictrain.com/course/governed','{}','{}',now()),public.ingest_xapi_statement('44000000-0000-4000-8000-000000000511','44000000-0000-4000-8000-000000000502','44000000-0000-4000-8000-000000000201','https://adlnet.gov/expapi/verbs/progressed','https://caremetrictrain.com/course/governed','{}','{}',now()),'xAPI statement replay is idempotent');
select throws_ok($$select public.ingest_xapi_statement(gen_random_uuid(),'44000000-0000-4000-8000-000000000502','44000000-0000-4000-8000-000000000999','https://example.com/verb','https://example.com/object','{}','{}',now())$$,'42501',null,'xAPI actor must match runtime registration');

reset role;
insert into public.learning_path_definitions(id,organization_id,name,status) values('44000000-0000-4000-8000-000000000601','44000000-0000-4000-8000-000000000001','Medication Path','published');
insert into public.learning_path_versions(id,path_definition_id,organization_id,version_number,state,definition,definition_sha256,published_by,published_at) values('44000000-0000-4000-8000-000000000602','44000000-0000-4000-8000-000000000601','44000000-0000-4000-8000-000000000001',1,'published','{"steps":[{"key":"foundation","prerequisites":[]},{"key":"assessment","prerequisites":["foundation"],"threshold":80},{"key":"remediation","prerequisites":["assessment"]}]}',repeat('c',64),'44000000-0000-4000-8000-000000000102',now());
update public.learning_path_definitions set current_version_id='44000000-0000-4000-8000-000000000602' where id='44000000-0000-4000-8000-000000000601';
insert into public.learning_path_assignments(id,organization_id,facility_id,employee_id,path_version_id) values('44000000-0000-4000-8000-000000000603','44000000-0000-4000-8000-000000000001','44000000-0000-4000-8000-000000000011','44000000-0000-4000-8000-000000000201','44000000-0000-4000-8000-000000000602');
select pg_temp.act_as('44000000-0000-4000-8000-000000000103');
select is(public.evaluate_learning_path('44000000-0000-4000-8000-000000000603',0,'{}')->'steps'->'assessment'->>'state','locked','prerequisite cannot be bypassed by direct evaluation');
select is(public.evaluate_learning_path('44000000-0000-4000-8000-000000000603',1,'{"foundation":{"completed":true},"assessment":{"score":75}}')->'steps'->'assessment'->>'state','remediated','below-threshold outcome deterministically selects remediation');
select throws_ok($$select public.evaluate_learning_path('44000000-0000-4000-8000-000000000603',1,'{}')$$,'40001',null,'stale adaptive state version conflicts');

reset role;
insert into public.offline_device_registrations(id,organization_id,profile_id,device_public_key,device_fingerprint_sha256,role_at_registration) values('44000000-0000-4000-8000-000000000701','44000000-0000-4000-8000-000000000001','44000000-0000-4000-8000-000000000103','test-public-key',repeat('d',64),'employee');
select pg_temp.act_as('44000000-0000-4000-8000-000000000103');
select is(public.sync_offline_learning_action('44000000-0000-4000-8000-000000000701','44000000-0000-4000-8000-000000000303','offline-action-0001',1,0,'progress',now(),'{"percentComplete":25}')->>'outcome','applied','first offline progress action applies');
select is(public.sync_offline_learning_action('44000000-0000-4000-8000-000000000701','44000000-0000-4000-8000-000000000303','offline-action-0001',1,0,'progress',now(),'{"percentComplete":25}')->>'outcome','duplicate','offline replay is visible and cannot duplicate progress');
select is((select count(*)::integer from public.offline_sync_receipts where device_id='44000000-0000-4000-8000-000000000701'),1,'one canonical offline receipt is retained');
reset role; update public.offline_device_registrations set status='revoked',wipe_required_at=now() where id='44000000-0000-4000-8000-000000000701';
select pg_temp.act_as('44000000-0000-4000-8000-000000000103');
select is(public.sync_offline_learning_action('44000000-0000-4000-8000-000000000701','44000000-0000-4000-8000-000000000303','offline-action-0002',2,0,'progress',now(),'{"percentComplete":50}')->>'outcome','wipe_required','revoked device receives a wipe-required outcome');
select ok(not has_table_privilege('authenticated','public.offline_sync_receipts','INSERT'),'offline clients cannot forge sync receipts directly');

select * from finish();
rollback;
