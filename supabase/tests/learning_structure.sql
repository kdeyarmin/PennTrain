-- Synthetic native completion transactions; no remote project or learner data.
begin;
select no_plan();

insert into public.organizations(id,name,slug) values('9e000000-0000-4000-8000-000000000001','Authoring fixture','draft-review-fixture');
insert into public.facilities(id,organization_id,name,facility_type) values
  ('9e000000-0000-4000-8000-000000000002','9e000000-0000-4000-8000-000000000001','Authoring facility','PCH');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
  created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change,email_change_token_current,reauthentication_token,is_sso_user,is_anonymous)
select '00000000-0000-0000-0000-000000000000',id,'authenticated','authenticated',email,'x',now(),'{}','{}',now(),now(),'','','','','','',false,false
from (values ('9e000000-0000-4000-8000-000000000003'::uuid,'draft-operator@test.local'),
  ('9e000000-0000-4000-8000-000000000004'::uuid,'draft-manager@test.local'),
  ('9e000000-0000-4000-8000-000000000005'::uuid,'draft-learner@test.local')) fixture(id,email);
select set_config('app.privileged_write','on',true);
update public.profiles set role='platform_admin',is_active=true where id='9e000000-0000-4000-8000-000000000003';
update public.profiles set role='org_admin',is_active=true,organization_id='9e000000-0000-4000-8000-000000000001' where id='9e000000-0000-4000-8000-000000000004';
update public.profiles set role='employee',is_active=true,organization_id='9e000000-0000-4000-8000-000000000001' where id='9e000000-0000-4000-8000-000000000005';
select set_config('app.privileged_write','',true);

insert into public.employees(id,organization_id,facility_id,profile_id,first_name,last_name,job_title,status) values
  ('9e000000-0000-4000-8000-000000000006','9e000000-0000-4000-8000-000000000001','9e000000-0000-4000-8000-000000000002','9e000000-0000-4000-8000-000000000005','Synthetic','Learner','Aide','active');
insert into public.courses(id,organization_id,title,status,estimated_duration_minutes,created_by) values
  ('9e000000-0000-4000-8000-000000000007',null,'Authoring course','draft',30,'9e000000-0000-4000-8000-000000000003');
insert into public.course_versions(id,course_id,organization_id,version_number,title,status) values
  ('9e000000-0000-4000-8000-000000000008','9e000000-0000-4000-8000-000000000007',null,1,'Authoring version','draft');
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


-- Explicit policy and media sentinels, created only inside this rollback fixture.
select set_config('app.privileged_write','on',true);
update public.course_versions set description='Complete retained version description',version_label='Revision A',
  credited_duration_rationale='Retain the native credited duration rationale',ai_generated=true,ai_reviewed_at=now(),
  ai_reviewed_by='9e000000-0000-4000-8000-000000000003' where id='9e000000-0000-4000-8000-000000000008';
update public.quizzes set max_attempts=null,shuffle_questions=true,shuffle_answers=true,reveals_answers_after_attempt=false
  where id='9e000000-0000-4000-8000-000000000011';
update public.quizzes set reveals_answers_after_attempt=true where id='9e000000-0000-4000-8000-000000000012';
update public.quiz_questions set points=101,topic_code='FIXTURE',topic_label='Synthetic topic'
  where id='9e000000-0000-4000-8000-000000000013';
insert into public.quiz_question_explanations(question_id,organization_id,explanation)
  values('9e000000-0000-4000-8000-000000000013',null,'A preserved synthetic explanation');
insert into public.course_blocks(id,course_version_id,organization_id,block_type,sort_order,title,body,video_url)
  values('9e000000-0000-4000-8000-000000000030','9e000000-0000-4000-8000-000000000008',null,'video',2,'Native video',
    '{"transcript":"Preserve accessible transcript","heygen":{"video_id":"paid-attempt-owned-by-source"},"estimated_minutes":3}',
    'course-videos/private-native-locator.mp4');
select set_config('app.privileged_write','',true);
insert into public.training_types(id,code,name,category) values
  ('9e000000-0000-4000-8000-000000000031','DRAFT_AUTO','Synthetic automatic','Synthetic'),
  ('9e000000-0000-4000-8000-000000000032','DRAFT_VERIFIED','Synthetic verified','Synthetic');
select set_config('app.privileged_write','on',true);
insert into public.course_compliance_credits(course_id,course_version_id,training_type_id,topic_code,credit_hours,credit_mode,citation_note,is_active)
  values('9e000000-0000-4000-8000-000000000007','9e000000-0000-4000-8000-000000000008','9e000000-0000-4000-8000-000000000031','FIXTURE.AUTO',0.5,'automatic','Synthetic automatic citation',true),
  ('9e000000-0000-4000-8000-000000000007','9e000000-0000-4000-8000-000000000008','9e000000-0000-4000-8000-000000000032','FIXTURE.VERIFIED',0.25,'verified_only','Synthetic facilitator citation',false);
select set_config('app.privileged_write','',true);
insert into public.course_assignments(id,organization_id,facility_id,employee_id,course_id,course_version_id,assigned_by)
  values('9e000000-0000-4000-8000-000000000060','9e000000-0000-4000-8000-000000000001','9e000000-0000-4000-8000-000000000002',
    '9e000000-0000-4000-8000-000000000006','9e000000-0000-4000-8000-000000000007','9e000000-0000-4000-8000-000000000008','9e000000-0000-4000-8000-000000000004');
select set_config('app.privileged_write','on',true);
insert into public.quiz_attempts(organization_id,facility_id,assignment_id,quiz_id,employee_id,attempt_number,score_percent,passed,submitted_at)
  values('9e000000-0000-4000-8000-000000000001','9e000000-0000-4000-8000-000000000002','9e000000-0000-4000-8000-000000000060',
    '9e000000-0000-4000-8000-000000000011','9e000000-0000-4000-8000-000000000006',1,40,false,now());
select set_config('app.privileged_write','',true);

create temporary table draft_fixture(label text primary key,value jsonb);
insert into draft_fixture values('source',(select to_jsonb(v) from public.course_versions v where id='9e000000-0000-4000-8000-000000000008'));

insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
  ('9e000000-0000-4000-8000-000000000070','9e000000-0000-4000-8000-000000000003',now()-interval '1 hour',now(),'aal1'),
  ('9e000000-0000-4000-8000-000000000071','9e000000-0000-4000-8000-000000000003',now()-interval '1 hour',now(),'aal1');
select set_config('request.jwt.claims','{"sub":"9e000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"9e000000-0000-4000-8000-000000000070"}',true);
insert into draft_fixture values('draft',to_jsonb(public.clone_course_version('9e000000-0000-4000-8000-000000000008','9e000000-0000-4000-8000-000000000007',2,'Governed editing draft')));
create function pg_temp.draft_id() returns uuid language sql as $$select (value#>>'{}')::uuid from draft_fixture where label='draft'$$;
create function pg_temp.revision() returns text language sql as $$select encode(extensions.digest(app_private.learning_source_payload('9e000000-0000-4000-8000-000000000007',pg_temp.draft_id()),'sha256'),'hex')$$;
create function pg_temp.params(p_patch jsonb default null) returns jsonb language sql as $$
  select jsonb_build_object('versionId',pg_temp.draft_id(),'sourceRevision',pg_temp.revision()) ||
    case when p_patch is null then '{"reviewed":true}'::jsonb else jsonb_build_object('patch',p_patch) end
$$;
create function pg_temp.execute(p_request uuid,p_parameters jsonb,p_action text default 'learning.patchDraft') returns jsonb language sql as $$
  select public.execute_native_learning_draft_command(p_request,p_action,'9e000000-0000-4000-8000-000000000007',p_parameters,'Reviewed synthetic draft definitions')
$$;
create function pg_temp.review() returns jsonb language sql as $$select pg_temp.execute(gen_random_uuid(),pg_temp.params(),'learning.reviewDraft')$$;
create function pg_temp.review_absent() returns boolean language sql as $$
  select ai_reviewed_at is null and ai_reviewed_by is null and not exists(select 1 from app_private.learning_draft_reviews where version_id=pg_temp.draft_id() and revoked_at is null)
  from public.course_versions where id=pg_temp.draft_id()
$$;

insert into public.course_blocks(id,course_version_id,organization_id,block_type,sort_order,title,body) values
  ('9e000000-0000-4000-8000-000000000080',pg_temp.draft_id(),null,'text',3,'Editable lesson','{"content":"Original lesson","estimated_minutes":4,"native_extra":{"retained":true}}');
insert into public.course_provider_profiles(course_id,provider_full_name,review_notes)
  values('9e000000-0000-4000-8000-000000000007','Synthetic provider','Initial policy');
insert into public.learning_packages(id,course_version_id,standard_type,storage_path,content_sha256,compressed_bytes,entry_point,validation_status,validated_at,immutable_at)
  values('9e000000-0000-4000-8000-000000000081',pg_temp.draft_id(),'scorm_1_2','synthetic/review.zip',repeat('b',64),50,'index.html','accepted',now(),now());

select ok(not has_table_privilege('service_role','app_private.learning_draft_reviews','SELECT'),'service cannot read raw review evidence');
select ok(not has_function_privilege('service_role','public.execute_native_learning_draft_command(uuid,text,uuid,jsonb,text)','EXECUTE'),'service cannot impersonate a native browser');
select ok(not has_function_privilege('authenticated','app_private.review_learning_draft_core(uuid,text,uuid,text)','EXECUTE'),'browser cannot forge review evidence through core');
select ok(not has_function_privilege('anon','public.get_native_learning_draft_source(uuid)','EXECUTE'),'anonymous source denied');
select is(public.get_native_learning_draft_source('9e000000-0000-4000-8000-000000000008'),null::jsonb,'legacy source does not silently opt into the draft editor');
select is(public.get_native_learning_draft_source(pg_temp.draft_id())->>'sourceRevision',pg_temp.revision(),'native source hashes the exact displayed bytes');
select ok(pg_temp.review_absent(),'clone starts without any review evidence');
select throws_ok($$update public.course_versions set ai_reviewed_at=now(),ai_reviewed_by='9e000000-0000-4000-8000-000000000003' where id=pg_temp.draft_id()$$,
  '42501','Use the exact-draft review action.','direct timestamp writer cannot fabricate review');
select throws_ok($$update public.course_versions set ai_generated=false where id=pg_temp.draft_id()$$,
  '42501','A governed AI draft cannot remove its review requirement.','AI flag downgrade cannot remove review policy');

create function pg_temp.sparams(p_changes jsonb) returns jsonb language sql as $$
  select jsonb_build_object('versionId',pg_temp.draft_id(),'sourceRevision',pg_temp.revision(),'changes',p_changes)
$$;
create function pg_temp.structure(p_changes jsonb) returns jsonb language sql as $$
  select pg_temp.execute(gen_random_uuid(),pg_temp.sparams(p_changes),'learning.editStructure')
$$;
create function pg_temp.sid(p_number integer) returns uuid language sql immutable as $$
  select ('9f000000-0000-4000-8000-'||lpad(p_number::text,12,'0'))::uuid
$$;
create function pg_temp.quiz_changes() returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('operation','configureQuiz','blockId',pg_temp.sid(1),'quizId',pg_temp.sid(2),'title','Synthetic new quiz',
    'kind','knowledge_check','passingScore',80,'maxAttempts',null,'shuffleQuestions',true,'shuffleAnswers',true,'revealsAnswersAfterAttempt',true))
$$;
create function pg_temp.question_change() returns jsonb language sql as $$
  select jsonb_build_object('operation','saveQuestion','quizId',pg_temp.sid(2),'questionId',pg_temp.sid(3),'prompt','Choose the synthetic correct answer.',
    'type','single_choice','points',101,'topicCode','SYNTHETIC','topicLabel','Synthetic topic','explanation','The reviewed author explanation.',
    'answers',jsonb_build_array(jsonb_build_object('answerId',pg_temp.sid(4),'text','Synthetic correct answer','correct',true),
      jsonb_build_object('answerId',pg_temp.sid(5),'text','Synthetic distractor','correct',false)),'removedAnswerIds','[]'::jsonb)
$$;

select ok(not has_function_privilege('authenticated','app_private.learning_structure_model(uuid,jsonb)','EXECUTE'),'authenticated cannot invoke raw model');
select ok(not has_function_privilege('service_role','app_private.edit_learning_structure_core(uuid,jsonb)','EXECUTE'),'service role cannot invoke raw writer');
select ok(not has_function_privilege('anon','public.execute_native_learning_draft_command(uuid,text,uuid,jsonb,text)','EXECUTE'),'anonymous cannot invoke native structure wrapper');
select pg_temp.review();
insert into draft_fixture values('reviewBefore',(select jsonb_agg(to_jsonb(r)) from app_private.learning_draft_reviews r where version_id=pg_temp.draft_id()));
insert into draft_fixture values('structureParameters',pg_temp.sparams(jsonb_build_array(jsonb_build_object('operation','addLesson','blockId',pg_temp.sid(1),'blockType','quiz','title','New quiz lesson','body','{}'::jsonb))));
insert into draft_fixture values('structurePreview',public.preview_native_learning_draft_command(pg_temp.sid(10),'learning.editStructure','9e000000-0000-4000-8000-000000000007',
  (select value from draft_fixture where label='structureParameters'),'Reviewed a new quiz definition'));
select is((select count(*) from public.course_blocks where id=pg_temp.sid(1)),0::bigint,'preview creates no lesson');
select is((select jsonb_agg(to_jsonb(r)) from app_private.learning_draft_reviews r where version_id=pg_temp.draft_id()),
  (select value from draft_fixture where label='reviewBefore'),'preview does not invalidate review');
select is((select value->'after' from draft_fixture where label='structurePreview'),
  (select (value->'before')-'sourceRevision'||'{"aiReviewRequired":true}'::jsonb from draft_fixture where label='structurePreview'),'preview after is precisely bounded and contains no answer key');
insert into draft_fixture values('structureApplied',public.apply_native_learning_draft_command((select (value->>'commandId')::uuid from draft_fixture where label='structurePreview'),
  (select value->>'previewDigest' from draft_fixture where label='structurePreview')));
select ok(pg_temp.review_absent(),'structure apply revokes exact prior approval');
select is((select block_type from public.course_blocks where id=pg_temp.sid(1)),'quiz','native shared writer creates quiz lesson');
select is((select value->>'sourceRevision' from draft_fixture where label='structureApplied'),pg_temp.revision(),'structure result binds canonical resulting source');
select is((public.get_native_learning_draft_source(pg_temp.draft_id())->>'payload')::jsonb#>>'{sourceVersionState}','draft','incomplete lesson remains readable through current native authority');
select is((select value->'quiz' from jsonb_array_elements((public.get_native_learning_draft_source(pg_temp.draft_id())->>'payload')::jsonb->'blocks') where value->>'id'=pg_temp.sid(1)::text),'null'::jsonb,'unconfigured draft quiz is represented explicitly as null');
select ok((public.apply_native_learning_draft_command((select (value->>'commandId')::uuid from draft_fixture where label='structurePreview'),
  (select value->>'previewDigest' from draft_fixture where label='structurePreview'))->>'replayed')::boolean,'unchanged uncertain apply retry returns one result');
select is((select count(*) from public.course_blocks where id=pg_temp.sid(1)),1::bigint,'retry creates no duplicate lesson');
select throws_ok($$select pg_temp.execute(gen_random_uuid(),(select value from draft_fixture where label='structureParameters'),'learning.editStructure')$$,
  '40001','Source changed since review.','stale captured source cannot create another structure command');

select pg_temp.structure(pg_temp.quiz_changes());
select is((select max_attempts from public.quizzes where id=pg_temp.sid(2)),null::integer,'unlimited attempts preserved');
select ok((select shuffle_questions and shuffle_answers and reveals_answers_after_attempt from public.quizzes where id=pg_temp.sid(2)),'all quiz policies explicitly applied');
select is((select jsonb_array_length(value#>'{quiz,questions}') from jsonb_array_elements((public.get_native_learning_draft_source(pg_temp.draft_id())->>'payload')::jsonb->'blocks') where value->>'id'=pg_temp.sid(1)::text),0,'configured quiz with no questions remains readable as draft');
select throws_ok($$select pg_temp.structure(jsonb_build_array((pg_temp.quiz_changes()->0)||'{"kind":"final_exam"}'::jsonb))$$,
  '22023','Invalid quiz policy.','assessment cannot enable immediate answer disclosure');
select pg_temp.structure(jsonb_build_array(pg_temp.question_change()));
select is((select points from public.quiz_questions where id=pg_temp.sid(3)),101,'weighted questions preserve native points above one hundred');
select is((select explanation from public.quiz_question_explanations where question_id=pg_temp.sid(3)),'The reviewed author explanation.','question and restricted explanation save together');
select is((select count(*) from public.quiz_answers where question_id=pg_temp.sid(3)),2::bigint,'complete answer set saved atomically');
select is((select count(*) from public.quiz_answers where question_id=pg_temp.sid(3) and is_correct),1::bigint,'single-choice key has exactly one correct answer');
select ok(pg_get_function_result('public.get_quiz_answer_choices(uuid)'::regprocedure) not like '%is_correct%','learner choices boundary does not expose answer key');

select throws_ok($$select pg_temp.structure(jsonb_build_array(pg_temp.question_change()||jsonb_build_object('answers',jsonb_build_array(
  jsonb_build_object('answerId',pg_temp.sid(4),'text','A','correct',true),jsonb_build_object('answerId',pg_temp.sid(6),'text','B','correct',false)))))$$,
  '40001','Review every removed answer explicitly.','omitting a previous answer requires explicit removal');
select pg_temp.structure(jsonb_build_array(pg_temp.question_change()||jsonb_build_object('answers',jsonb_build_array(
  jsonb_build_object('answerId',pg_temp.sid(4),'text','Updated distractor','correct',false),jsonb_build_object('answerId',pg_temp.sid(6),'text','Updated correct','correct',true)),
  'removedAnswerIds',jsonb_build_array(pg_temp.sid(5)))));
select is((select count(*) from public.quiz_answers where id=pg_temp.sid(5)),0::bigint,'explicit removed answer deleted');
select ok((select not is_correct from public.quiz_answers where id=pg_temp.sid(4)) and (select is_correct from public.quiz_answers where id=pg_temp.sid(6)),'correctness switch is one transaction');
select is((select count(*) from public.quiz_attempts where quiz_id=pg_temp.sid(2)),0::bigint,'authoring never creates quiz attempts');

savepoint structure_rollback;
select pg_temp.structure(jsonb_build_array(jsonb_build_object('operation','addLesson','blockId',pg_temp.sid(20),'blockType','text','title','Rollback lesson','body',jsonb_build_object('content','Rollback content'))));
rollback to savepoint structure_rollback;
select is((select count(*) from public.course_blocks where id=pg_temp.sid(20)),0::bigint,'transaction rollback removes all structure effects');
select throws_ok($$select pg_temp.structure(jsonb_build_array(jsonb_build_object('operation','addLesson','blockId',pg_temp.sid(20),'blockType','text','title','Atomic lesson','body','{}'::jsonb),
  jsonb_build_object('operation','removeQuestion','quizId',pg_temp.sid(2),'questionId',pg_temp.sid(999))))$$,
  '42501','Question is outside this quiz.','invalid later operation refuses whole batch');
select is((select count(*) from public.course_blocks where id=pg_temp.sid(20)),0::bigint,'invalid sequential batch leaves no partial lesson');
select throws_ok($$select pg_temp.structure(jsonb_build_array(jsonb_build_object('operation','removeLesson','blockId',pg_temp.sid(1),'removedQuestionIds','[]'::jsonb)))$$,
  '40001','Review every removed question explicitly.','quiz lesson removal cannot silently remove questions');

-- Source references remain pinned even when an unrelated legacy assignment
-- points at a governed question. Refuse the actual referent, not just version.
select set_config('app.privileged_write','on',true);
insert into public.quiz_attempt_answers(attempt_id,question_id,selected_answer_ids)
  select id,pg_temp.sid(3),array[pg_temp.sid(4)] from public.quiz_attempts where quiz_id='9e000000-0000-4000-8000-000000000011' limit 1;
select set_config('app.privileged_write','',true);
select throws_ok($$select pg_temp.structure(jsonb_build_array(jsonb_build_object('operation','removeQuestion','quizId',pg_temp.sid(2),'questionId',pg_temp.sid(3))))$$,
  '40001','This definition is bound to learner history. Clone a new version.','actual cross-version answer referent prevents destructive mutation');
select is((select count(*) from public.quiz_questions where id=pg_temp.sid(3)),1::bigint,'historical question retained');
select set_config('app.privileged_write','on',true);
delete from public.quiz_attempt_answers where question_id=pg_temp.sid(3);
select set_config('app.privileged_write','',true);

select pg_temp.structure(jsonb_build_array(jsonb_build_object('operation','removeLesson','blockId',pg_temp.sid(1),'removedQuestionIds',jsonb_build_array(pg_temp.sid(3)))));
select is((select count(*) from public.quiz_questions where id=pg_temp.sid(3)),0::bigint,'explicit reviewed lesson removal removes definitions only');
select is((select count(*) from public.course_completion_credits where course_version_id=pg_temp.draft_id()),0::bigint,'no completion credits generated');
select is((select to_jsonb(v) from public.course_versions v where id='9e000000-0000-4000-8000-000000000008'),(select value from draft_fixture where label='source'),'published source version remains byte-for-byte unchanged');
select * from finish();
rollback;

