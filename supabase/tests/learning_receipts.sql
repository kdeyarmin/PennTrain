-- Synthetic native completion transactions; no remote project or learner data.
begin;
select no_plan();

insert into public.organizations(id,name,slug) values('9e000000-0000-4000-8000-000000000001','Receipt fixture','receipt-fixture');
insert into public.facilities(id,organization_id,name,facility_type) values
  ('9e000000-0000-4000-8000-000000000002','9e000000-0000-4000-8000-000000000001','Receipt facility','PCH');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
  created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change,email_change_token_current,reauthentication_token,is_sso_user,is_anonymous)
select '00000000-0000-0000-0000-000000000000',id,'authenticated','authenticated',email,'x',now(),'{}','{}',now(),now(),'','','','','','',false,false
from (values ('9e000000-0000-4000-8000-000000000003'::uuid,'receipt-operator@test.local'),
  ('9e000000-0000-4000-8000-000000000004'::uuid,'receipt-manager@test.local'),
  ('9e000000-0000-4000-8000-000000000005'::uuid,'receipt-learner@test.local')) fixture(id,email);
select set_config('app.privileged_write','on',true);
update public.profiles set role='platform_admin',is_active=true where id='9e000000-0000-4000-8000-000000000003';
update public.profiles set role='org_admin',is_active=true,organization_id='9e000000-0000-4000-8000-000000000001' where id='9e000000-0000-4000-8000-000000000004';
update public.profiles set role='employee',is_active=true,organization_id='9e000000-0000-4000-8000-000000000001' where id='9e000000-0000-4000-8000-000000000005';
select set_config('app.privileged_write','',true);
insert into public.employees(id,organization_id,facility_id,profile_id,first_name,last_name,job_title,status) values
  ('9e000000-0000-4000-8000-000000000006','9e000000-0000-4000-8000-000000000001','9e000000-0000-4000-8000-000000000002','9e000000-0000-4000-8000-000000000005','Synthetic','Learner','Aide','active');
insert into public.courses(id,organization_id,title,status,estimated_duration_minutes,created_by) values
  ('9e000000-0000-4000-8000-000000000007',null,'Receipt course','draft',30,'9e000000-0000-4000-8000-000000000003');
insert into public.course_versions(id,course_id,organization_id,version_number,title,status) values
  ('9e000000-0000-4000-8000-000000000008','9e000000-0000-4000-8000-000000000007',null,1,'Receipt version','draft');
insert into public.course_blocks(id,course_version_id,organization_id,block_type,sort_order,title) values
  ('9e000000-0000-4000-8000-000000000009','9e000000-0000-4000-8000-000000000008',null,'quiz',0,'Final examination'),
  ('9e000000-0000-4000-8000-000000000010','9e000000-0000-4000-8000-000000000008',null,'quiz',1,'Knowledge check');
insert into public.quizzes(id,course_block_id,organization_id,title,quiz_kind,passing_score_percent) values
  ('9e000000-0000-4000-8000-000000000011','9e000000-0000-4000-8000-000000000009',null,'Final examination','final_exam',80),
  ('9e000000-0000-4000-8000-000000000012','9e000000-0000-4000-8000-000000000010',null,'Knowledge check','knowledge_check',80);
insert into public.quiz_questions(id,quiz_id,organization_id,question_text,question_type,sort_order) values
  ('9e000000-0000-4000-8000-000000000013','9e000000-0000-4000-8000-000000000011',null,'Choose the synthetic examination answer.','single_choice',0),
  ('9e000000-0000-4000-8000-000000000014','9e000000-0000-4000-8000-000000000012',null,'Choose the synthetic knowledge answer.','single_choice',0);
insert into public.quiz_answers(question_id,organization_id,answer_text,is_correct,sort_order)
select question_id,null,answer_text,is_correct,sort_order from
  (values ('9e000000-0000-4000-8000-000000000013'::uuid),('9e000000-0000-4000-8000-000000000014'::uuid)) questions(question_id)
  cross join (values ('Synthetic correct answer',true,0),('Synthetic distractor',false,1)) answers(answer_text,is_correct,sort_order);
select set_config('app.privileged_write','on',true);
update public.course_versions set status='published',published_at=now() where id='9e000000-0000-4000-8000-000000000008';
update public.courses set status='published',current_version_id='9e000000-0000-4000-8000-000000000008' where id='9e000000-0000-4000-8000-000000000007';
select set_config('app.privileged_write','',true);

create function pg_temp.assignment_id(n integer) returns uuid language sql immutable as $$
  select ('9e000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$$;
create function pg_temp.assign(n integer) returns uuid language sql as $$
  insert into public.course_assignments(id,organization_id,facility_id,employee_id,course_id,course_version_id,assigned_by)
  values(pg_temp.assignment_id(n),'9e000000-0000-4000-8000-000000000001','9e000000-0000-4000-8000-000000000002',
    '9e000000-0000-4000-8000-000000000006','9e000000-0000-4000-8000-000000000007','9e000000-0000-4000-8000-000000000008','9e000000-0000-4000-8000-000000000004') returning id;
$$;
create function pg_temp.complete(n integer) returns void language plpgsql as $$
declare prior_claims text:=coalesce(current_setting('request.jwt.claims',true),'{}');
begin
  perform set_config('request.jwt.claims','{"sub":"9e000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
  perform public.complete_course_assignment(pg_temp.assignment_id(n));
  set constraints capture_prospective_learning_completion immediate;
  set constraints capture_prospective_learning_completion deferred;
  perform set_config('app.privileged_write','',true);
  perform set_config('request.jwt.claims',prior_claims,true);
end;
$$;
create function pg_temp.fail_completion(n integer) returns void language plpgsql as $$
begin
  perform pg_temp.complete(n);
  raise exception 'Synthetic completion transaction rollback';
end;
$$;

select ok(not has_function_privilege('authenticated','public.provision_learning_receipt_mapping(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text)','EXECUTE'),'native browser cannot forge bridge mappings');
select ok(not has_table_privilege('service_role','app_private.learning_completion_evidence','UPDATE'),'service credential cannot rewrite immutable evidence directly');
select pg_temp.assign(101);
select lives_ok($$select pg_temp.complete(101)$$,'ordinary historical completion still uses the native writer');
select is((select count(*) from app_private.learning_receipt_outbox),0::bigint,'unbound completion produces no bridge receipt');

create temporary table receipt_fixture(label text primary key,value text);
insert into receipt_fixture values('revision',encode(extensions.digest(app_private.learning_source_payload('9e000000-0000-4000-8000-000000000007','9e000000-0000-4000-8000-000000000008'),'sha256'),'hex'));
grant select on receipt_fixture to service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select lives_ok($$select public.provision_learning_receipt_mapping('9e000000-0000-4000-8000-000000000003','9e000000-0000-4000-8000-000000000020',
  '9e000000-0000-4000-8000-000000000001','9e000000-0000-4000-8000-000000000006','9e000000-0000-4000-8000-000000000021','9e000000-0000-4000-8000-000000000022',
  '9e000000-0000-4000-8000-000000000007','9e000000-0000-4000-8000-000000000008',(select value from receipt_fixture where label='revision'))$$,'explicit reviewed mapping is accepted');
reset role;
select is((select count(*) from app_private.learning_assignment_bindings),0::bigint,'creating a mapping never backfills historical assignments');
select pg_temp.assign(102);
select is((select count(*) from app_private.learning_assignment_bindings where assignment_id=pg_temp.assignment_id(102)),1::bigint,'future assignment receives one policy binding');
select throws_ok($$select pg_temp.fail_completion(102)$$,'P0001','Synthetic completion transaction rollback','completion failure aborts the same evidence transaction');
select is((select status from public.course_assignments where id=pg_temp.assignment_id(102)),'assigned','rollback restores native assignment status');
select is((select count(*) from public.certificates where course_assignment_id=pg_temp.assignment_id(102)),0::bigint,'rollback retains no certificate');
select is((select count(*) from app_private.learning_completion_evidence where assignment_id=pg_temp.assignment_id(102)),0::bigint,'rollback retains no bridge evidence');
select is((select count(*) from app_private.learning_receipt_outbox where assignment_id=pg_temp.assignment_id(102)),0::bigint,'rollback retains no outbox receipt');
select lives_ok($$select pg_temp.complete(102)$$,'retry completes after the failed transaction');
select is((select state from app_private.learning_receipt_outbox where assignment_id=pg_temp.assignment_id(102)),'pending','matching policy produces pending evidence');
select lives_ok($$select pg_temp.complete(102)$$,'native completion replay remains successful');
select is((select count(*) from app_private.learning_receipt_outbox where assignment_id=pg_temp.assignment_id(102)),1::bigint,'replay cannot duplicate the central receipt');

select pg_temp.assign(103);
select set_config('app.privileged_write','on',true);
insert into public.quiz_attempts(organization_id,facility_id,assignment_id,quiz_id,employee_id,attempt_number,score_percent,passed,submitted_at)
select '9e000000-0000-4000-8000-000000000001','9e000000-0000-4000-8000-000000000002',pg_temp.assignment_id(103),quiz_id,
  '9e000000-0000-4000-8000-000000000006',attempt,score,passed,now()
from (values ('9e000000-0000-4000-8000-000000000011'::uuid,1,40,false),
  ('9e000000-0000-4000-8000-000000000011'::uuid,2,80,true),('9e000000-0000-4000-8000-000000000012'::uuid,1,100,true)) fixture(quiz_id,attempt,score,passed);
select set_config('app.privileged_write','',true);
select lives_ok($$select pg_temp.complete(103)$$,'native writer completes examination evidence');
select is((select (payload::jsonb->>'finalExamScore')::numeric from app_private.learning_receipt_outbox where assignment_id=pg_temp.assignment_id(103)),80::numeric,'receipt uses passed final examination rather than a higher knowledge-check score');
select is((select jsonb_array_length(evidence->'quizAttempts') from app_private.learning_completion_evidence where assignment_id=pg_temp.assignment_id(103)),3,'native evidence preserves both failed and passed attempts');
select ok((select not(payload::jsonb ? 'quizAttempts') and not(payload like '%receipt-learner%') from app_private.learning_receipt_outbox where assignment_id=pg_temp.assignment_id(103)),'outbound receipt contains hashes rather than learner answers or account email');
select ok((select payload_sha256=encode(extensions.digest(payload,'sha256'),'hex') from app_private.learning_receipt_outbox where assignment_id=pg_temp.assignment_id(103)),'outbound digest binds exact immutable payload bytes');

select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select throws_ok($$select public.acknowledge_learning_receipt('9e000000-0000-4000-8000-000000000003',
  (select (value->>'eventId')::uuid from jsonb_array_elements(public.list_learning_receipt_outbox('9e000000-0000-4000-8000-000000000003',25)) value where value->>'payload' like '%000000000103%'),repeat('b',64))$$,
  '40001','Receipt cannot be acknowledged.','acknowledgement requires the exact delivered payload digest');
reset role;
select public.acknowledge_learning_receipt('9e000000-0000-4000-8000-000000000003',id,payload_sha256)
  from app_private.learning_receipt_outbox where assignment_id=pg_temp.assignment_id(103);
select is((select state from app_private.learning_receipt_outbox where assignment_id=pg_temp.assignment_id(103)),'delivered','successful Hub commit can be acknowledged');
select public.retract_learning_receipt('9e000000-0000-4000-8000-000000000003',pg_temp.assignment_id(103),1);
select is((select max(sequence) from app_private.learning_receipt_outbox where assignment_id=pg_temp.assignment_id(103)),2,'withdrawal follows delivered completion with the next sequence');
select public.retract_learning_receipt('9e000000-0000-4000-8000-000000000003',pg_temp.assignment_id(103),1);
select is((select count(*) from app_private.learning_receipt_outbox where assignment_id=pg_temp.assignment_id(103)),2::bigint,'withdrawal replay creates no second event');
select is((select count(*) from public.certificates where course_assignment_id=pg_temp.assignment_id(103)),1::bigint,'central withdrawal leaves the earned native certificate intact');
select public.retract_learning_receipt('9e000000-0000-4000-8000-000000000003',pg_temp.assignment_id(102),1);
select is((select count(*) from app_private.learning_receipt_outbox where assignment_id=pg_temp.assignment_id(102) and state='pending'),1::bigint,'withdrawing an undelivered completion leaves only its tombstone pending');
select is((select kind from app_private.learning_receipt_outbox where assignment_id=pg_temp.assignment_id(102) and state='pending'),'retracted','withdrawal dominates a completion not yet sent');

select pg_temp.assign(104);
update public.courses set title='Changed source policy after assignment' where id='9e000000-0000-4000-8000-000000000007';
select lives_ok($$select pg_temp.complete(104)$$,'source policy drift does not erase valid native completion');
select is((select quarantine_reason from app_private.learning_receipt_outbox where assignment_id=pg_temp.assignment_id(104)),'policy_drift','source policy drift is quarantined');
select ok((select assignment_revision<>completion_revision from app_private.learning_assignment_bindings b
  join app_private.learning_completion_evidence e on e.assignment_id=b.assignment_id where b.assignment_id=pg_temp.assignment_id(104)),'both assignment-time and completion-time policy revisions remain available');
update public.courses set title='Receipt course' where id='9e000000-0000-4000-8000-000000000007';
select pg_temp.assign(105);
select public.revoke_learning_receipt_mapping('9e000000-0000-4000-8000-000000000003','9e000000-0000-4000-8000-000000000020');
select lives_ok($$select pg_temp.complete(105)$$,'revoked bridge mapping does not break native completion');
select is((select quarantine_reason from app_private.learning_receipt_outbox where assignment_id=pg_temp.assignment_id(105)),'mapping_disabled','completion after mapping revocation remains quarantined');
select pg_temp.assign(106);
select is((select count(*) from app_private.learning_assignment_bindings where assignment_id=pg_temp.assignment_id(106)),0::bigint,'disabled mapping cannot bind future assignments');
select lives_ok($$select pg_temp.complete(106)$$,'future unbound completion remains native');
select is((select count(*) from app_private.learning_receipt_outbox where assignment_id=pg_temp.assignment_id(106)),0::bigint,'unbound completion after disable creates no central receipt');

select * from finish();
rollback;
