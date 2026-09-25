-- Synthetic native completion transactions; no remote project or learner data.
begin;
select no_plan();

insert into public.organizations(id,name,slug) values('9f000000-0000-4000-8000-000000000001','Authoring fixture','authoring-fixture');
insert into public.facilities(id,organization_id,name,facility_type) values
  ('9f000000-0000-4000-8000-000000000002','9f000000-0000-4000-8000-000000000001','Authoring facility','PCH');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
  created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change,email_change_token_current,reauthentication_token,is_sso_user,is_anonymous)
select '00000000-0000-0000-0000-000000000000',id,'authenticated','authenticated',email,'x',now(),'{}','{}',now(),now(),'','','','','','',false,false
from (values ('9f000000-0000-4000-8000-000000000003'::uuid,'authoring-operator@test.local'),
  ('9f000000-0000-4000-8000-000000000004'::uuid,'authoring-manager@test.local'),
  ('9f000000-0000-4000-8000-000000000005'::uuid,'authoring-learner@test.local')) fixture(id,email);
select set_config('app.privileged_write','on',true);
update public.profiles set role='platform_admin',is_active=true where id='9f000000-0000-4000-8000-000000000003';
update public.profiles set role='org_admin',is_active=true,organization_id='9f000000-0000-4000-8000-000000000001' where id='9f000000-0000-4000-8000-000000000004';
update public.profiles set role='employee',is_active=true,organization_id='9f000000-0000-4000-8000-000000000001' where id='9f000000-0000-4000-8000-000000000005';
select set_config('app.privileged_write','',true);

insert into public.employees(id,organization_id,facility_id,profile_id,first_name,last_name,job_title,status) values
  ('9f000000-0000-4000-8000-000000000006','9f000000-0000-4000-8000-000000000001','9f000000-0000-4000-8000-000000000002','9f000000-0000-4000-8000-000000000005','Synthetic','Learner','Aide','active');
insert into public.courses(id,organization_id,title,status,estimated_duration_minutes,created_by) values
  ('9f000000-0000-4000-8000-000000000007',null,'Authoring course','draft',30,'9f000000-0000-4000-8000-000000000003');
insert into public.course_versions(id,course_id,organization_id,version_number,title,status) values
  ('9f000000-0000-4000-8000-000000000008','9f000000-0000-4000-8000-000000000007',null,1,'Authoring version','draft');
insert into public.course_blocks(id,course_version_id,organization_id,block_type,sort_order,title) values
  ('9f000000-0000-4000-8000-000000000009','9f000000-0000-4000-8000-000000000008',null,'quiz',0,'Final examination'),
  ('9f000000-0000-4000-8000-000000000010','9f000000-0000-4000-8000-000000000008',null,'quiz',1,'Knowledge check');
insert into public.quizzes(id,course_block_id,organization_id,title,quiz_kind,passing_score_percent) values
  ('9f000000-0000-4000-8000-000000000011','9f000000-0000-4000-8000-000000000009',null,'Final examination','final_exam',80),
  ('9f000000-0000-4000-8000-000000000012','9f000000-0000-4000-8000-000000000010',null,'Knowledge check','knowledge_check',80);
insert into public.quiz_questions(id,quiz_id,organization_id,question_text,question_type,sort_order) values
  ('9f000000-0000-4000-8000-000000000013','9f000000-0000-4000-8000-000000000011',null,'Choose the synthetic examination answer.','single_choice',0),
  ('9f000000-0000-4000-8000-000000000014','9f000000-0000-4000-8000-000000000012',null,'Choose the synthetic knowledge answer.','single_choice',0);
insert into public.quiz_answers(question_id,organization_id,answer_text,is_correct,sort_order)
select question_id,null,answer_text,is_correct,sort_order from
  (values ('9f000000-0000-4000-8000-000000000013'::uuid),('9f000000-0000-4000-8000-000000000014'::uuid)) questions(question_id)
  cross join (values ('Synthetic correct answer',true,0),('Synthetic distractor',false,1)) answers(answer_text,is_correct,sort_order);
select set_config('app.privileged_write','on',true);
update public.course_versions set status='published',published_at=now() where id='9f000000-0000-4000-8000-000000000008';
update public.courses set status='published',current_version_id='9f000000-0000-4000-8000-000000000008' where id='9f000000-0000-4000-8000-000000000007';
select set_config('app.privileged_write','',true);


-- Explicit policy and media sentinels, created only inside this rollback fixture.
select set_config('app.privileged_write','on',true);
update public.course_versions set description='Complete retained version description',version_label='Revision A',
  credited_duration_rationale='Retain the native credited duration rationale',ai_generated=true,ai_reviewed_at=now(),
  ai_reviewed_by='9f000000-0000-4000-8000-000000000003' where id='9f000000-0000-4000-8000-000000000008';
update public.quizzes set max_attempts=null,shuffle_questions=true,shuffle_answers=true,reveals_answers_after_attempt=false
  where id='9f000000-0000-4000-8000-000000000011';
update public.quizzes set reveals_answers_after_attempt=true where id='9f000000-0000-4000-8000-000000000012';
update public.quiz_questions set points=101,topic_code='FIXTURE',topic_label='Synthetic topic'
  where id='9f000000-0000-4000-8000-000000000013';
insert into public.quiz_question_explanations(question_id,organization_id,explanation)
  values('9f000000-0000-4000-8000-000000000013',null,'A preserved synthetic explanation');
insert into public.course_blocks(id,course_version_id,organization_id,block_type,sort_order,title,body,video_url)
  values('9f000000-0000-4000-8000-000000000030','9f000000-0000-4000-8000-000000000008',null,'video',2,'Native video',
    '{"transcript":"Preserve accessible transcript","heygen":{"video_id":"paid-attempt-owned-by-source"},"estimated_minutes":3}',
    'course-videos/private-native-locator.mp4');
select set_config('app.privileged_write','',true);
insert into public.training_types(id,code,name,category) values
  ('9f000000-0000-4000-8000-000000000031','AUTHORING_AUTO','Synthetic automatic','Synthetic'),
  ('9f000000-0000-4000-8000-000000000032','AUTHORING_VERIFIED','Synthetic verified','Synthetic');
select set_config('app.privileged_write','on',true);
insert into public.course_compliance_credits(course_id,course_version_id,training_type_id,topic_code,credit_hours,credit_mode,citation_note,is_active)
  values('9f000000-0000-4000-8000-000000000007','9f000000-0000-4000-8000-000000000008','9f000000-0000-4000-8000-000000000031','FIXTURE.AUTO',0.5,'automatic','Synthetic automatic citation',true),
  ('9f000000-0000-4000-8000-000000000007','9f000000-0000-4000-8000-000000000008','9f000000-0000-4000-8000-000000000032','FIXTURE.VERIFIED',0.25,'verified_only','Synthetic facilitator citation',false);
select set_config('app.privileged_write','',true);
insert into public.course_assignments(id,organization_id,facility_id,employee_id,course_id,course_version_id,assigned_by)
  values('9f000000-0000-4000-8000-000000000060','9f000000-0000-4000-8000-000000000001','9f000000-0000-4000-8000-000000000002',
    '9f000000-0000-4000-8000-000000000006','9f000000-0000-4000-8000-000000000007','9f000000-0000-4000-8000-000000000008','9f000000-0000-4000-8000-000000000004');
select set_config('app.privileged_write','on',true);
insert into public.quiz_attempts(organization_id,facility_id,assignment_id,quiz_id,employee_id,attempt_number,score_percent,passed,submitted_at)
  values('9f000000-0000-4000-8000-000000000001','9f000000-0000-4000-8000-000000000002','9f000000-0000-4000-8000-000000000060',
    '9f000000-0000-4000-8000-000000000011','9f000000-0000-4000-8000-000000000006',1,40,false,now());
select set_config('app.privileged_write','',true);

create temporary table authoring_fixture(label text primary key,value jsonb);
insert into authoring_fixture values('source',(select to_jsonb(v) from public.course_versions v where id='9f000000-0000-4000-8000-000000000008'));
select ok(not has_function_privilege('anon','public.clone_course_version(uuid,uuid,integer,text,uuid)','EXECUTE'),'anonymous caller cannot clone');
select ok(not has_function_privilege('service_role','app_private.clone_course_version_core(uuid,uuid,uuid,uuid,integer,text,text)','EXECUTE'),'service cannot bypass the delegated authority wrapper');
select ok(not has_function_privilege('authenticated','app_private.assert_learning_authoring_ready(uuid)','EXECUTE')
  and not has_function_privilege('service_role','app_private.assert_learning_authoring_ready(uuid)','EXECUTE'),'trusted readiness context has no public or service entry point');
select ok(not has_function_privilege('authenticated','public.apply_learning_authoring_command(uuid,uuid,uuid,timestamptz,timestamptz,uuid,text,text)','EXECUTE'),'browser cannot forge delegated apply');
select ok(not has_table_privilege('service_role','app_private.learning_authoring_package_dependencies','UPDATE'),'service cannot forge artifact resolution');
select set_config('request.jwt.claims','{"sub":"9f000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
select throws_ok($$select public.clone_course_version('9f000000-0000-4000-8000-000000000008','9f000000-0000-4000-8000-000000000007',2,'New draft')$$,
  '42501','Only platform admins can clone course versions.','learner cannot call native clone');
select set_config('request.jwt.claims','{"sub":"9f000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
insert into authoring_fixture values('draft',to_jsonb(public.clone_course_version('9f000000-0000-4000-8000-000000000008','9f000000-0000-4000-8000-000000000007',2,'New draft')));
create function pg_temp.draft_id() returns uuid language sql as $$select (value#>>'{}')::uuid from authoring_fixture where label='draft'$$;
select is((select to_jsonb(v) from public.course_versions v where id='9f000000-0000-4000-8000-000000000008'),(select value from authoring_fixture where label='source'),'source version is unchanged');
select is((select status from public.course_versions where id=pg_temp.draft_id()),'draft','native clone creates a draft');
select ok((select ai_generated and ai_reviewed_at is null and ai_reviewed_by is null and published_at is null from public.course_versions where id=pg_temp.draft_id()),'new draft never inherits AI review or publication');
select is((select jsonb_build_array(description,version_label,content_standard,credited_duration_rationale) from public.course_versions where id=pg_temp.draft_id()),
  (select jsonb_build_array(description,version_label,content_standard,credited_duration_rationale) from public.course_versions where id='9f000000-0000-4000-8000-000000000008'),'all version policy fields survive');
select is((select count(*) from public.course_blocks where course_version_id=pg_temp.draft_id()),3::bigint,'every source block is copied');
select ok((select body ? 'transcript' and not(body ? 'heygen') and video_url='course-videos/private-native-locator.mp4' from public.course_blocks where course_version_id=pg_temp.draft_id() and block_type='video'),'native locator and transcript survive without paid generation ownership');
select ok((select max_attempts is null and shuffle_questions and shuffle_answers and not reveals_answers_after_attempt and passing_score_percent=80
  from public.quizzes q join public.course_blocks b on b.id=q.course_block_id where b.course_version_id=pg_temp.draft_id() and q.quiz_kind='final_exam'),'final exam retry, score, kind and behavior policy are retained');
select ok((select reveals_answers_after_attempt from public.quizzes q join public.course_blocks b on b.id=q.course_block_id
  where b.course_version_id=pg_temp.draft_id() and q.quiz_kind='knowledge_check'),'formative answer reveal remains distinct from final examination policy');
select is((select count(*) from public.quiz_questions q join public.quizzes z on z.id=q.quiz_id join public.course_blocks b on b.id=z.course_block_id
  where b.course_version_id=pg_temp.draft_id() and q.points=101 and q.topic_code='FIXTURE' and q.topic_label='Synthetic topic'),1::bigint,'weighted question and topic policy survive');
select is((select count(*) from public.quiz_question_explanations e join public.quiz_questions q on q.id=e.question_id join public.quizzes z on z.id=q.quiz_id join public.course_blocks b on b.id=z.course_block_id where b.course_version_id=pg_temp.draft_id()),1::bigint,'explanations are copied with remapped question ids');
select is((select jsonb_agg(jsonb_build_array(training_type_id,topic_code,credit_hours,credit_mode,citation_note,is_active) order by training_type_id) from public.course_compliance_credits where course_version_id=pg_temp.draft_id()),
  (select jsonb_agg(jsonb_build_array(training_type_id,topic_code,credit_hours,credit_mode,citation_note,is_active) order by training_type_id) from public.course_compliance_credits where course_version_id='9f000000-0000-4000-8000-000000000008'),'active automatic and inactive verified credits survive losslessly');
select is((select count(*) from public.quiz_attempts a join public.quizzes z on z.id=a.quiz_id join public.course_blocks b on b.id=z.course_block_id where b.course_version_id=pg_temp.draft_id()),0::bigint,'new quiz definitions have no attempts');
select is((select count(*) from public.course_assignments where course_version_id=pg_temp.draft_id()),0::bigint,'new version has no assignments or inferred learner history');
select throws_ok($$select public.publish_course_version(pg_temp.draft_id())$$,'42501',
  'course_version '||pg_temp.draft_id()::text||' is AI-generated and has not been reviewed; mark it reviewed before publishing','native publisher still requires a new AI review');
select throws_ok($$select public.clone_course_version('9f000000-0000-4000-8000-000000000008','9f000000-0000-4000-8000-000000000007',2,'Retry draft')$$,
  '40001','Course versions changed; refresh before cloning','stale native version allocation cannot duplicate a draft');
update public.course_blocks set block_type='scorm' where course_version_id=pg_temp.draft_id() and block_type='video';
select throws_ok($$select app_private.assert_learning_authoring_packages(pg_temp.draft_id())$$,'23514',
  'A cloned SCORM draft requires its own accepted native runtime package before publication.','SCORM cannot publish an unlaunchable clone when the source had no global package dependency');
update public.course_blocks set block_type='video' where course_version_id=pg_temp.draft_id() and block_type='scorm';

-- Accepted source packages are dependencies, never copied acceptance records.
insert into public.learning_packages(id,course_version_id,standard_type,storage_path,content_sha256,compressed_bytes,entry_point,validation_status,validated_at,immutable_at)
  values('9f000000-0000-4000-8000-000000000040','9f000000-0000-4000-8000-000000000008','scorm_1_2','immutable/original.zip',repeat('a',64),50,'index.html','accepted',now(),now());
insert into authoring_fixture values('packageDraft',to_jsonb(public.clone_course_version('9f000000-0000-4000-8000-000000000008','9f000000-0000-4000-8000-000000000007',3,'Package draft')));
create function pg_temp.package_draft() returns uuid language sql as $$select (value#>>'{}')::uuid from authoring_fixture where label='packageDraft'$$;
select is((select count(*) from public.learning_packages where course_version_id=pg_temp.package_draft()),0::bigint,'no accepted package artifact is copied');
select is((select count(*) from app_private.learning_authoring_package_dependencies where version_id=pg_temp.package_draft() and replacement_package_id is null),1::bigint,'source package remains an unresolved dependency');
select throws_ok($$select app_private.assert_learning_authoring_packages(pg_temp.package_draft())$$,'23514',
  'Cloned package dependencies require separately registered and accepted replacement artifacts before publication.','unresolved dependency blocks publication');
select throws_ok($$select public.resolve_learning_authoring_package(pg_temp.package_draft(),'9f000000-0000-4000-8000-000000000040','9f000000-0000-4000-8000-000000000040')$$,'23514',
  'A separate accepted replacement artifact in this draft is required','source artifact cannot be reused as replacement');
insert into authoring_fixture values('incompleteClone',to_jsonb(public.clone_course_version(pg_temp.package_draft(),'9f000000-0000-4000-8000-000000000007',4,'Still incomplete')));
select is((select count(*) from app_private.learning_authoring_package_dependencies where version_id=(select(value#>>'{}')::uuid from authoring_fixture where label='incompleteClone')),1::bigint,'cloning an incomplete draft cannot discard its dependencies');
insert into public.learning_packages(id,course_version_id,standard_type,storage_path,content_sha256,compressed_bytes,entry_point,validation_status,validated_at,immutable_at)
  values('9f000000-0000-4000-8000-000000000041',pg_temp.package_draft(),'scorm_1_2','immutable/original.zip',repeat('b',64),50,'index.html','accepted',now(),now()),
    ('9f000000-0000-4000-8000-000000000042',pg_temp.package_draft(),'scorm_1_2','separate/replacement.zip',repeat('c',64),50,'index.html','accepted',now(),now());
select throws_ok($$select public.resolve_learning_authoring_package(pg_temp.package_draft(),'9f000000-0000-4000-8000-000000000040','9f000000-0000-4000-8000-000000000041')$$,'23514',
  'A separate accepted replacement artifact in this draft is required','re-registering the original storage path cannot satisfy artifact isolation');
select lives_ok($$select public.resolve_learning_authoring_package(pg_temp.package_draft(),'9f000000-0000-4000-8000-000000000040','9f000000-0000-4000-8000-000000000042')$$,'native operator can explicitly verify a separate accepted replacement');
select lives_ok($$select app_private.assert_learning_authoring_packages(pg_temp.package_draft())$$,'a separate accepted artifact resolves the package gate');
select public.quarantine_learning_package('9f000000-0000-4000-8000-000000000042','Synthetic replacement withdrawal');
select throws_ok($$select app_private.assert_learning_authoring_packages(pg_temp.package_draft())$$,'23514',
  'Cloned package dependencies require separately registered and accepted replacement artifacts before publication.','withdrawn acceptance blocks publication again');

-- Session-bound command preview/apply, drift, rollback and replay use the shared ledger.
create function pg_temp.preview(n integer,title text default 'Hub authored draft') returns jsonb language sql as $$
  select public.preview_learning_authoring_command('9f000000-0000-4000-8000-000000000003','9f000000-0000-4000-8000-000000000050',
    '9f000000-0000-4000-8000-000000000051',now()-interval '1 hour',now()+interval '7 hours',
    ('9f000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'learning.cloneVersion','9f000000-0000-4000-8000-000000000007',
    jsonb_build_object('versionId','9f000000-0000-4000-8000-000000000008','title',title,'sourceRevision',
      encode(extensions.digest(app_private.learning_source_payload('9f000000-0000-4000-8000-000000000007','9f000000-0000-4000-8000-000000000008'),'sha256'),'hex')),
    'Reviewed synthetic source policies','app_sms');
$$;
create function pg_temp.apply(preview jsonb) returns jsonb language sql as $$
  select public.apply_learning_authoring_command('9f000000-0000-4000-8000-000000000003','9f000000-0000-4000-8000-000000000050',
    '9f000000-0000-4000-8000-000000000051',now()-interval '1 hour',now()+interval '7 hours',(preview->>'commandId')::uuid,preview->>'previewDigest','app_sms');
$$;
create function pg_temp.rollback_apply(preview jsonb) returns void language plpgsql as $$
begin perform pg_temp.apply(preview); raise exception 'Synthetic authoring rollback'; end; $$;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select lives_ok($$select public.inspect_learning_authoring_course('9f000000-0000-4000-8000-000000000003','9f000000-0000-4000-8000-000000000050',
  '9f000000-0000-4000-8000-000000000051',now()-interval '1 hour',now()+interval '7 hours','9f000000-0000-4000-8000-000000000007','app_sms')$$,
  'actual restricted service role can invoke only the guarded source API');
reset role;
insert into authoring_fixture values('preview',pg_temp.preview(101));
select is(pg_temp.preview(101),(select value from authoring_fixture where label='preview'),'same intent returns the original immutable preview');
select throws_ok($$select pg_temp.preview(101,'Changed intent')$$,'40001','Request identifier already has different inputs','request id cannot change source intent');
select throws_ok($$select pg_temp.rollback_apply((select value from authoring_fixture where label='preview'))$$,'P0001','Synthetic authoring rollback','failed transaction aborts draft and command receipt together');
select is((select count(*) from public.course_versions where course_id='9f000000-0000-4000-8000-000000000007'),4::bigint,'rollback created no partial draft');
select ok((select applied_at is null from app_private.platform_admin_commands where id=(select(value->>'commandId')::uuid from authoring_fixture where label='preview')),'rollback leaves command unapplied');
insert into authoring_fixture values('result',pg_temp.apply((select value from authoring_fixture where label='preview')));
select is((select value->>'status' from authoring_fixture where label='result'),'draft','delegated apply creates a native draft');
select ok((pg_temp.apply((select value from authoring_fixture where label='preview'))->>'replayed')::boolean,'worker retry returns the same immutable result');
select is((select count(*) from public.course_versions where course_id='9f000000-0000-4000-8000-000000000007'),5::bigint,'apply replay creates no duplicate version');
select is((select metadata->>'authenticationMethod' from public.audit_logs where entity_type='central_learning_authoring' and entity_id=(select value->>'versionId' from authoring_fixture where label='result')),'app_sms','actual SMS assurance is audited without claiming AAL2');
insert into authoring_fixture values('driftPreview',pg_temp.preview(102));
select set_config('app.privileged_write','on',true);
update public.courses set description='Changed source policy after preview' where id='9f000000-0000-4000-8000-000000000007';
select set_config('app.privileged_write','',true);
select throws_ok($$select pg_temp.apply((select value from authoring_fixture where label='driftPreview'))$$,'40001','Source changed since review','course policy drift invalidates reviewed clone');
select is((select count(*) from public.certificates where course_assignment_id in(select id from public.course_assignments where course_id='9f000000-0000-4000-8000-000000000007')),0::bigint,'authoring does not issue certificates');
select throws_ok($$select public.apply_learning_authoring_command('9f000000-0000-4000-8000-000000000003','9f000000-0000-4000-8000-000000000050',
  '9f000000-0000-4000-8000-000000000059',now()-interval '1 hour',now()+interval '7 hours',
  (select(value->>'commandId')::uuid from authoring_fixture where label='preview'),(select value->>'previewDigest' from authoring_fixture where label='preview'),'app_sms')$$,
  '42501','Preview belongs to another operation or administrator session','a different current session cannot replay a command');
select throws_ok($$select public.inspect_learning_authoring_course('9f000000-0000-4000-8000-000000000003','9f000000-0000-4000-8000-000000000050',
  '9f000000-0000-4000-8000-000000000051',now()-interval '9 hours',now()+interval '1 hour','9f000000-0000-4000-8000-000000000007','app_sms')$$,
  '42501','Fresh Hub session required','database rejects stale SMS authority independently of HTTP');
create function pg_temp.source() returns jsonb language sql as $$
  select public.get_learning_authoring_source('9f000000-0000-4000-8000-000000000003','9f000000-0000-4000-8000-000000000050',
    '9f000000-0000-4000-8000-000000000051',now()-interval '1 hour',now()+interval '7 hours',
    '9f000000-0000-4000-8000-000000000007','9f000000-0000-4000-8000-000000000008','app_sms');
$$;
select ok(pg_temp.source()->>'sourceRevision'=encode(extensions.digest(pg_temp.source()->>'payload','sha256'),'hex'),'source endpoint binds the exact governed raw bytes');
select ok(not(pg_temp.source()->>'payload' like '%private-native-locator%') and not(pg_temp.source()->>'payload' like '%immutable/original.zip%'),'native source locators remain native');
select set_config('app.privileged_write','on',true);
update public.course_blocks set body=body||'{"playback_url":"synthetic excluded value"}' where id='9f000000-0000-4000-8000-000000000030';
select set_config('app.privileged_write','',true);
select throws_ok($$select pg_temp.source()$$,'42501','Source contains an excluded credential or storage field; review it in CareBase before exporting','excluded nested content fails before a payload is returned');
select set_config('app.privileged_write','on',true);
update public.course_blocks set body=body-'playback_url' where id='9f000000-0000-4000-8000-000000000030';
update public.course_blocks set body=body||'{"playback\u0054oken":"synthetic excluded value"}'::jsonb where id='9f000000-0000-4000-8000-000000000030';
select set_config('app.privileged_write','',true);
select throws_ok($$select pg_temp.source()$$,'42501','Source contains an excluded credential or storage field; review it in CareBase before exporting','escaped camel-case playback credentials are excluded before export');
select set_config('app.privileged_write','on',true);
update public.course_blocks set body=body-'playbackToken' where id='9f000000-0000-4000-8000-000000000030';
update public.profiles set is_active=false where id='9f000000-0000-4000-8000-000000000003';
select set_config('app.privileged_write','',true);
select throws_ok($$select pg_temp.source()$$,'42501','Delegation forbidden','native actor revocation invalidates source reads at the database');
select set_config('app.privileged_write','on',true);
update public.profiles set is_active=true where id='9f000000-0000-4000-8000-000000000003';
select set_config('app.privileged_write','',true);

-- Fresh native review is explicit; the delegated publisher reuses its existing rules.
select set_config('request.jwt.claims','{"sub":"9f000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
create function pg_temp.review_fixture() returns void language sql as $$
  select app_private.review_learning_draft_core('9f000000-0000-4000-8000-000000000003','native_session',pg_temp.draft_id(),
    encode(extensions.digest(app_private.learning_source_payload('9f000000-0000-4000-8000-000000000007',pg_temp.draft_id()),'sha256'),'hex'));
$$;
select pg_temp.review_fixture();
create function pg_temp.publish_failure(p_delegated boolean) returns jsonb language plpgsql as $$
begin
  if p_delegated then
    perform set_config('request.jwt.claims','{"role":"service_role"}',true);
    perform public.preview_learning_authoring_command('9f000000-0000-4000-8000-000000000003','9f000000-0000-4000-8000-000000000050',
      '9f000000-0000-4000-8000-000000000051',now()-interval '1 hour',now()+interval '7 hours',gen_random_uuid(),'learning.publishVersion',
      '9f000000-0000-4000-8000-000000000007',jsonb_build_object('versionId',pg_temp.draft_id(),'sourceRevision',
        encode(extensions.digest(app_private.learning_source_payload('9f000000-0000-4000-8000-000000000007',pg_temp.draft_id()),'sha256'),'hex')),
      'Compare the existing native publication rules','app_sms');
  else
    perform set_config('request.jwt.claims','{"sub":"9f000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
    perform public.publish_course_version(pg_temp.draft_id());
  end if;
  return jsonb_build_object('unexpectedSuccess',true);
exception when others then
  return jsonb_build_object('code',sqlstate,'message',sqlerrm,'trustedContext',coalesce(current_setting('app.privileged_write',true),''));
end;
$$;
update public.course_blocks set body='{}' where course_version_id=pg_temp.draft_id() and block_type='video';
select pg_temp.review_fixture();
select is(pg_temp.publish_failure(true),pg_temp.publish_failure(false),'delegated and native publication use identical transcript readiness rules');
select is(pg_temp.publish_failure(true)->>'code','23514','invalid content remains rejected rather than bypassed by trusted context');
select is(pg_temp.publish_failure(true)->>'trustedContext','','a failed readiness check restores its prior trusted context');
update public.course_blocks set body='{"transcript":"Preserve accessible transcript","estimated_minutes":3}' where course_version_id=pg_temp.draft_id() and block_type='video';
update public.course_versions set content_standard='comprehensive' where id=pg_temp.draft_id();
select pg_temp.review_fixture();
select is(pg_temp.publish_failure(true),pg_temp.publish_failure(false),'delegated and native publication use identical comprehensive curriculum rules');
select is(pg_temp.publish_failure(true)->>'code','23514','incomplete comprehensive curriculum cannot publish');
update public.course_versions set content_standard='legacy' where id=pg_temp.draft_id();
select pg_temp.review_fixture();
select set_config('request.jwt.claims','{"role":"service_role"}',true);
insert into authoring_fixture values('publishPreview',public.preview_learning_authoring_command(
  '9f000000-0000-4000-8000-000000000003','9f000000-0000-4000-8000-000000000050','9f000000-0000-4000-8000-000000000051',
  now()-interval '1 hour',now()+interval '7 hours','9f000000-0000-4000-8000-000000000103','learning.publishVersion',
  '9f000000-0000-4000-8000-000000000007',jsonb_build_object('versionId',pg_temp.draft_id(),'sourceRevision',
    encode(extensions.digest(app_private.learning_source_payload('9f000000-0000-4000-8000-000000000007',pg_temp.draft_id()),'sha256'),'hex')),
  'Reviewed native publication readiness','app_sms'));
select lives_ok($$select pg_temp.apply((select value from authoring_fixture where label='publishPreview'))$$,'reviewed native draft publishes through the shared current publisher');
select is((select current_version_id from public.courses where id='9f000000-0000-4000-8000-000000000007'),pg_temp.draft_id(),'native catalog selects the new published version');
select is((select status from public.course_versions where id='9f000000-0000-4000-8000-000000000008'),'published','old published version and its learner history remain intact');
select is((select count(*) from public.quiz_attempts where assignment_id='9f000000-0000-4000-8000-000000000060'),1::bigint,'publishing neither migrates nor duplicates old quiz attempts');
select is((select count(*) from app_private.learning_receipt_outbox),0::bigint,'authoring creates no synthetic completion receipt');
select is(coalesce(current_setting('app.privileged_write',true),''),'','publisher restores the previous privileged-write setting');
select set_config('request.jwt.claims','{"sub":"9f000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select lives_ok($$select public.publish_course_version(pg_temp.draft_id())$$,'native direct publication remains callable with the same ready course');
select finish();
rollback;
