begin;
select no_plan();

-- Disposable identities only. The transport tests separately validate the Hub ticket;
-- these tests exercise service-only database delegation and native business constraints.
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('ce250000-0000-4000-8000-000000000001','authenticated','authenticated','hub-training-operator@test.local','x',now(),'{}','{}',now(),now());
select set_config('app.privileged_write','on',true);
insert into public.profiles(id,role,email,first_name,last_name,is_active)
values('ce250000-0000-4000-8000-000000000001','platform_admin','hub-training-operator@test.local','Hub','Operator',true)
on conflict(id) do update set role='platform_admin',is_active=true;
insert into public.courses(id,title,status) values('ce250000-0000-4000-8000-000000000301','Original safety catalog','draft');
insert into public.course_versions(id,course_id,version_number,title)
values('ce250000-0000-4000-8000-000000000311','ce250000-0000-4000-8000-000000000301',1,'Original safety version');
insert into public.course_blocks(course_version_id,block_type,sort_order,title,body)
values('ce250000-0000-4000-8000-000000000311','text',0,'Lesson','{"content":"Hub training fixture instruction"}');
update public.course_versions set status='published',published_at=now() where id='ce250000-0000-4000-8000-000000000311';
update public.courses set status='published',current_version_id='ce250000-0000-4000-8000-000000000311' where id='ce250000-0000-4000-8000-000000000301';
select set_config('app.privileged_write','off',true);
create temp table training_hub_fixture(name text primary key,value jsonb);
grant all on training_hub_fixture to service_role;
create function pg_temp.training_read(p_operation text,p_org uuid,p_extra jsonb default '{}'::jsonb) returns jsonb language sql as $$
 select public.platform_admin_training('ce250000-0000-4000-8000-000000000001','ce250000-0000-4000-8000-000000000002','ce250000-0000-4000-8000-000000000003',
 now()-interval '1 hour',now()+interval '1 hour','jwt_aal2',jsonb_build_object('domain','training.v1','operation',p_operation,'organizationId',p_org)||case when p_operation='access.list' then '{"limit":25,"offset":0}'::jsonb else '{}'::jsonb end||p_extra);
$$;
create function pg_temp.training_apply(p_request uuid,p_action text,p_org uuid,p_parameters jsonb) returns jsonb language sql as $$
 select pg_temp.training_read('apply',p_org,jsonb_build_object('requestId',p_request,'action',p_action,'parameters',p_parameters,'reason','Reviewed training administration fixture'));
$$;
create function pg_temp.fixture(p_name text) returns jsonb language sql as $$select value from training_hub_fixture where name=p_name$$;
select ok(not has_function_privilege('authenticated','public.platform_admin_training(uuid,uuid,uuid,timestamptz,timestamptz,text,jsonb)','execute'),'native browser identities cannot call delegated training');
select ok(not has_function_privilege('anon','public.platform_admin_training(uuid,uuid,uuid,timestamptz,timestamptz,text,jsonb)','execute'),'anonymous identities cannot call delegated training');
select ok(has_function_privilege('service_role','public.platform_admin_training(uuid,uuid,uuid,timestamptz,timestamptz,text,jsonb)','execute'),'only backend service can transport verified delegation');
select ok(not has_function_privilege('service_role','app_private.provision_training_facility_core(uuid,uuid,text,text,text)','execute'),'service cannot call unaudited provisioning core directly');
select ok(not has_function_privilege('authenticated','app_private.training_admin_enrollment_report(uuid,uuid,text,text,text,date,date,integer,integer)','execute'),'private all-tenant report query is not a client RPC');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;

insert into training_hub_fixture values('provision',pg_temp.training_apply('ce250000-0000-4000-8000-000000000100','facilities.provision',null,
 '{"organizationName":"Hub training home","facilityName":"First PCH","facilityType":"PCH"}'));
select is(pg_temp.fixture('provision')->'result'->>'organizationId','ce250000-0000-4000-8000-000000000100','Hub provisioning returns the requested organization');
select is((pg_temp.fixture('provision')->>'replayed')::boolean,false,'first provisioning records a new receipt');
select is((pg_temp.training_apply('ce250000-0000-4000-8000-000000000100','facilities.provision',null,
 '{"organizationName":"Hub training home","facilityName":"First PCH","facilityType":"PCH"}')->>'replayed')::boolean,true,'identical provisioning retry reuses receipt');
select throws_ok($$select pg_temp.training_apply('ce250000-0000-4000-8000-000000000100','facilities.provision',null,
 '{"organizationName":"Changed request","facilityName":"First PCH","facilityType":"PCH"}')$$,'40001',null,'request ID cannot create a different facility');
select is((pg_temp.training_read('facilities.list','ce250000-0000-4000-8000-000000000100','{"limit":25,"offset":0,"search":""}')->>'total')::int,1,'provisioning retry never creates a second facility');
select is(pg_temp.training_read('access.list','ce250000-0000-4000-8000-000000000100')->'items'->0->>'moduleKey','modules.train','complimentary provisioning grants only Train');
insert into training_hub_fixture values('other',pg_temp.training_apply('ce250000-0000-4000-8000-000000000101','facilities.provision',null,
 '{"organizationName":"Other training home","facilityName":"Second ALF","facilityType":"ALR"}'));
insert into training_hub_fixture values('student',pg_temp.training_apply('ce250000-0000-4000-8000-000000000200','students.create','ce250000-0000-4000-8000-000000000100',
 jsonb_build_object('facilityId',pg_temp.fixture('provision')->'result'->>'facilityId','firstName','First','lastName','Student','email','student@test.local','jobTitle','Aide','hireDate','2025-01-01')));
select is((pg_temp.training_read('students.list','ce250000-0000-4000-8000-000000000100',jsonb_build_object('facilityId',pg_temp.fixture('provision')->'result'->>'facilityId','limit',25,'offset',0,'search','','status','all'))->>'total')::int,1,'Hub can read its explicitly selected roster');
select is((pg_temp.training_apply('ce250000-0000-4000-8000-000000000200','students.create','ce250000-0000-4000-8000-000000000100',
 jsonb_build_object('facilityId',pg_temp.fixture('provision')->'result'->>'facilityId','firstName','First','lastName','Student','email','student@test.local','jobTitle','Aide','hireDate','2025-01-01'))->>'replayed')::boolean,true,'student creation is idempotent');
select throws_ok($$select pg_temp.training_read('students.list','ce250000-0000-4000-8000-000000000101',jsonb_build_object('facilityId',pg_temp.fixture('provision')->'result'->>'facilityId','limit',25,'offset',0,'search','','status','all'))$$,'42501',null,'roster facility must belong to selected organization');
select throws_ok($$select pg_temp.training_apply('ce250000-0000-4000-8000-000000000202','students.update','ce250000-0000-4000-8000-000000000101',
 jsonb_build_object('employeeId',pg_temp.fixture('student')->'result'->>'employeeId','firstName','Changed','lastName','Student','email','student@test.local','jobTitle','Aide'))$$,'42501',null,'student changes cannot cross the selected organization');
select lives_ok($$select pg_temp.training_apply('ce250000-0000-4000-8000-000000000203','students.update','ce250000-0000-4000-8000-000000000100',
 jsonb_build_object('employeeId',pg_temp.fixture('student')->'result'->>'employeeId','firstName','Updated','lastName','Student','email','student@test.local','jobTitle','Direct care aide'))$$,'Hub can correct permitted roster fields');
select is((pg_temp.training_read('courses.list','ce250000-0000-4000-8000-000000000100','{"limit":25,"offset":0,"search":"Original safety"}')->'items'->0->>'versionId'),'ce250000-0000-4000-8000-000000000311','course picker returns an assignable published native version');
insert into training_hub_fixture values('assignment',pg_temp.training_apply('ce250000-0000-4000-8000-000000000400','enrollments.assign','ce250000-0000-4000-8000-000000000100',
 jsonb_build_object('employeeId',pg_temp.fixture('student')->'result'->>'employeeId','courseId','ce250000-0000-4000-8000-000000000301','versionId','ce250000-0000-4000-8000-000000000311','dueDate',null)));
select is((pg_temp.fixture('assignment')->'result'->>'alreadyAssigned')::boolean,false,'first course enrollment creates native assignment');
select is((pg_temp.training_apply('ce250000-0000-4000-8000-000000000401','enrollments.assign','ce250000-0000-4000-8000-000000000100',
 jsonb_build_object('employeeId',pg_temp.fixture('student')->'result'->>'employeeId','courseId','ce250000-0000-4000-8000-000000000301','versionId','ce250000-0000-4000-8000-000000000311','dueDate',null))->'result'->>'alreadyAssigned')::boolean,true,'another request cannot duplicate an open enrollment');
insert into training_hub_fixture values('reportOperation',jsonb_build_object('facilityId',null,'courseSearch','Original safety','status','all','dateBasis','assigned','dateFrom',null,'dateThrough',null,'limit',10000,'offset',0));
select is((pg_temp.training_read('enrollments.report','ce250000-0000-4000-8000-000000000100',pg_temp.fixture('reportOperation'))->>'total')::int,1,'central report uses selected organization and full filtered totals');
select is(pg_temp.training_read('enrollments.report','ce250000-0000-4000-8000-000000000100',pg_temp.fixture('reportOperation'))->'rows'->0->>'course','Original safety version','central report preserves assigned-version title');
select is((pg_temp.training_read('enrollments.report','ce250000-0000-4000-8000-000000000101',pg_temp.fixture('reportOperation'))->>'total')::int,0,'another organization has no leaked enrollment rows');

-- Record a legitimate course completion under a real native operator fixture.
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub','ce250000-0000-4000-8000-000000000001','role','authenticated','aal','aal2','iat',extract(epoch from now())::bigint)::text,true);
select lives_ok($$select public.complete_course_assignment((pg_temp.fixture('assignment')->'result'->>'assignmentId')::uuid)$$,'production completion creates real certificate evidence');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select is((pg_temp.training_read('enrollments.report','ce250000-0000-4000-8000-000000000100',pg_temp.fixture('reportOperation'))->>'certificates')::int,1,'Hub reports the real issued certificate');
insert into training_hub_fixture values('certificate',pg_temp.training_read('enrollments.report','ce250000-0000-4000-8000-000000000100',pg_temp.fixture('reportOperation'))->'rows'->0->'certificate_id');
select is(pg_temp.training_read('certificates.read','ce250000-0000-4000-8000-000000000100',jsonb_build_object('certificateId',pg_temp.fixture('certificate')))->>'status','pending','certificate read reports queued artifact state without manufacturing a URL');
select throws_ok($$select pg_temp.training_read('certificates.read','ce250000-0000-4000-8000-000000000101',jsonb_build_object('certificateId',pg_temp.fixture('certificate')))$$,'P0002',null,'certificate cannot be read under another organization');
select throws_ok($$select pg_temp.training_apply('ce250000-0000-4000-8000-000000000402','enrollments.cancel','ce250000-0000-4000-8000-000000000100',jsonb_build_object('assignmentId',pg_temp.fixture('assignment')->'result'->>'assignmentId'))$$,'55000',null,'Hub cannot cancel immutable completed enrollment');
insert into training_hub_fixture values('renewal',pg_temp.training_apply('ce250000-0000-4000-8000-000000000403','enrollments.assign','ce250000-0000-4000-8000-000000000100',
 jsonb_build_object('employeeId',pg_temp.fixture('student')->'result'->>'employeeId','courseId','ce250000-0000-4000-8000-000000000301','versionId','ce250000-0000-4000-8000-000000000311','dueDate',null)));
select lives_ok($$select pg_temp.training_apply('ce250000-0000-4000-8000-000000000404','enrollments.cancel','ce250000-0000-4000-8000-000000000100',jsonb_build_object('assignmentId',pg_temp.fixture('renewal')->'result'->>'assignmentId'))$$,'Hub can close an open annual enrollment with its reason');
select is((pg_temp.training_read('enrollments.report','ce250000-0000-4000-8000-000000000100',pg_temp.fixture('reportOperation'))->>'completion_denominator')::int,1,'canceled annual enrollment does not inflate completion denominator');
insert into training_hub_fixture values('term',pg_temp.training_apply('ce250000-0000-4000-8000-000000000500','access.grant','ce250000-0000-4000-8000-000000000100',
 '{"moduleKey":"modules.workforce","source":"contract","endsAt":null}'));
select is(jsonb_array_length(pg_temp.training_read('access.list','ce250000-0000-4000-8000-000000000100')->'items'),2,'independent optional module term is recorded alongside free Train');
select throws_ok($$select pg_temp.training_apply('ce250000-0000-4000-8000-000000000501','access.revoke','ce250000-0000-4000-8000-000000000101',jsonb_build_object('termId',pg_temp.fixture('term')->'result'->>'termId'))$$,'22023',null,'module revocation cannot cross organization scope');
select is((pg_temp.training_read('access.list','ce250000-0000-4000-8000-000000000100','{"limit":1,"offset":1}')->>'total')::int,2,'module history totals cover every page');
select is(jsonb_array_length(pg_temp.training_read('access.list','ce250000-0000-4000-8000-000000000100','{"limit":1,"offset":1}')->'items'),1,'module history can be paged without silent truncation');
select lives_ok($$select pg_temp.training_apply('ce250000-0000-4000-8000-000000000502','access.revoke','ce250000-0000-4000-8000-000000000100',jsonb_build_object('termId',pg_temp.fixture('term')->'result'->>'termId'))$$,'module access can be revoked while retained history remains');
select lives_ok($$select pg_temp.training_apply('ce250000-0000-4000-8000-000000000600','students.setActive','ce250000-0000-4000-8000-000000000100',
 jsonb_build_object('employeeId',pg_temp.fixture('student')->'result'->>'employeeId','active',false,'effectiveDate',public.pa_today()))$$,'deactivation uses native employment termination transaction');
select is(pg_temp.training_read('students.list','ce250000-0000-4000-8000-000000000100',jsonb_build_object('facilityId',pg_temp.fixture('provision')->'result'->>'facilityId','limit',25,'offset',0,'search','','status','inactive'))->'items'->0->>'status','terminated','deactivation retains employee and lifecycle state');
select is((pg_temp.training_read('enrollments.report','ce250000-0000-4000-8000-000000000100',pg_temp.fixture('reportOperation'))->>'certificates')::int,1,'termination preserves the earned certificate');
select throws_ok($$select public.platform_admin_training('ce250000-0000-4000-8000-000000000001','ce250000-0000-4000-8000-000000000002','ce250000-0000-4000-8000-000000000003',now()-interval '9 hours',now()+interval '1 hour','jwt_aal2',
 '{"domain":"training.v1","operation":"access.list","organizationId":"ce250000-0000-4000-8000-000000000100"}')$$,'42501',null,'stale original Hub session is denied');
reset role;
select ok(exists(select 1 from public.audit_logs where actor_profile_id='ce250000-0000-4000-8000-000000000001' and action='hub.training.students.setActive' and metadata->>'hubUserId'='ce250000-0000-4000-8000-000000000002'),'central writes retain mapped actor and original Hub authority in audit');
select throws_ok($$update app_private.training_admin_commands set result='{}'$$,'42501',null,'completed command receipts cannot be rewritten');
select set_config('request.jwt.claims',jsonb_build_object('sub','ce250000-0000-4000-8000-000000000001','role','authenticated','aal','aal2','iat',extract(epoch from now())::bigint)::text,true);
select throws_ok($$select pg_temp.training_read('access.list','ce250000-0000-4000-8000-000000000100')$$,'42501',null,'even a real native platform JWT cannot masquerade as delegated service transport');
select * from finish();
rollback;
