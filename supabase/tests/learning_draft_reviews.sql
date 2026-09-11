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

insert into draft_fixture values('patchParameters',pg_temp.params('{"version":{"title":"Edited title","description":null},"blocks":[{"blockId":"9e000000-0000-4000-8000-000000000080","content":"Changed lesson","estimatedMinutes":5}]}'::jsonb));
insert into draft_fixture values('patch',pg_temp.execute('9e000000-0000-4000-8000-000000000082',(select value from draft_fixture where label='patchParameters')));
select is((select title from public.course_versions where id=pg_temp.draft_id()),'Edited title','native metadata form uses shared patch core');
select is((select body from public.course_blocks where id='9e000000-0000-4000-8000-000000000080'),'{"content":"Changed lesson","estimated_minutes":5,"native_extra":{"retained":true}}'::jsonb,'patch merges editable text and preserves unknown native metadata');
select ok((select video_url='course-videos/private-native-locator.mp4' from public.course_blocks where course_version_id=pg_temp.draft_id() and block_type='video'),'native media locator unchanged');
select is((select value->>'sourceRevision' from draft_fixture where label='patch'),pg_temp.revision(),'apply response contains resulting canonical revision');
select ok((pg_temp.execute('9e000000-0000-4000-8000-000000000082',(select value from draft_fixture where label='patchParameters'))->>'replayed')::boolean,'lost response retry returns one immutable applied result');
select is((select count(*) from app_private.platform_admin_commands where request_id='9e000000-0000-4000-8000-000000000082'),1::bigint,'same native retry creates one command');
select throws_ok($$select pg_temp.execute('9e000000-0000-4000-8000-000000000082',pg_temp.params('{"version":{"title":"Different intent"}}'))$$,
  '40001','Request identifier already has different inputs.','changed intent cannot reuse a command identifier');
select throws_ok($$select pg_temp.execute(gen_random_uuid(),(select value from draft_fixture where label='patchParameters'))$$,
  '40001','Source changed since review.','a fresh request cannot silently refresh the captured source revision');
select throws_ok($$select pg_temp.execute(gen_random_uuid(),pg_temp.params('{"blocks":[{"blockId":"9e000000-0000-4000-8000-000000000080","video_url":"replacement"}]}'))$$,
  '22023','Draft text contains an excluded credential field.','closed patch refuses a media locator');
select throws_ok($$select pg_temp.execute(gen_random_uuid(),pg_temp.params('{"version":{"ai_reviewed_at":"2026-09-11"}}'))$$,
  '22023','Invalid editable version fields.','closed patch refuses approval injection');
select throws_ok($$select pg_temp.execute(gen_random_uuid(),pg_temp.params('{"blocks":[{"blockId":"9e000000-0000-4000-8000-000000000030","content":"Cross-version edit"}]}'))$$,
  '42501','Block is outside this global draft.','closed patch rejects a source-version block');
select throws_ok($$select pg_temp.execute(gen_random_uuid(),pg_temp.params('{"blocks":[{"blockId":"9e000000-0000-4000-8000-000000000080","transcript":"Wrong type"}]}'))$$,
  '22023','Field does not match this block type.','body field must match existing native block type');

insert into draft_fixture values('preReviewRevision',to_jsonb(pg_temp.revision()));
insert into draft_fixture values('review',pg_temp.review());
select ok(not pg_temp.review_absent(),'explicit human review records active evidence');
select ok((select reviewed_source_revision=(select value#>>'{}' from draft_fixture where label='preReviewRevision') and material_revision=app_private.learning_material_revision(version_id)
  and actor_id='9e000000-0000-4000-8000-000000000003' and authentication_method='native_session'
  from app_private.learning_draft_reviews where version_id=pg_temp.draft_id() and revoked_at is null),'proof binds reviewed raw SHA, material SHA and actual native actor/method');
select ok((select value->>'sourceRevision' from draft_fixture where label='review')<> (select value#>>'{}' from draft_fixture where label='preReviewRevision'),'review response reports the new source including approval time');
select lives_ok($$select app_private.assert_learning_draft_review(pg_temp.draft_id())$$,'review timestamp normalization preserves material equality');
select throws_ok($$update app_private.learning_draft_reviews set actor_id='9e000000-0000-4000-8000-000000000004' where version_id=pg_temp.draft_id() and revoked_at is null$$,
  '42501','Draft review evidence is immutable.','evidence attribution cannot be rewritten');
select throws_ok($$update public.course_versions set title='Unreviewed simultaneous title',status='published',published_at=now() where id=pg_temp.draft_id()$$,
  '23514','Save and review definition changes before publishing.','direct native publication cannot bundle an unreviewed definition edit');
select lives_ok($$select app_private.assert_learning_draft_review(pg_temp.draft_id())$$,'failed simultaneous publication leaves prior review intact');

-- Every source definition family invalidates proof; timestamp-only maintenance does not.
update public.course_provider_profiles set updated_at=clock_timestamp() where course_id='9e000000-0000-4000-8000-000000000007';
select lives_ok($$select app_private.assert_learning_draft_review(pg_temp.draft_id())$$,'provider timestamp-only maintenance preserves material review');
update public.course_versions set description='Native version edit' where id=pg_temp.draft_id();
select ok(pg_temp.review_absent(),'native version writer invalidates approval');
select pg_temp.review();
update public.course_blocks set body=body||'{"content":"Native block edit"}' where id='9e000000-0000-4000-8000-000000000080';
select ok(pg_temp.review_absent(),'native block writer invalidates approval');
select pg_temp.review();
update public.quizzes set max_attempts=7 where course_block_id in(select id from public.course_blocks where course_version_id=pg_temp.draft_id());
select ok(pg_temp.review_absent(),'native quiz policy writer invalidates approval');
select pg_temp.review();
update public.quiz_questions set question_text=question_text||' Revised.' where quiz_id in(select q.id from public.quizzes q join public.course_blocks b on b.id=q.course_block_id where b.course_version_id=pg_temp.draft_id());
select ok(pg_temp.review_absent(),'native question writer invalidates approval');
select pg_temp.review();
update public.quiz_answers set answer_text=answer_text||' Revised.' where question_id in(select z.id from public.quiz_questions z join public.quizzes q on q.id=z.quiz_id join public.course_blocks b on b.id=q.course_block_id where b.course_version_id=pg_temp.draft_id());
select ok(pg_temp.review_absent(),'native answer writer invalidates approval');
select pg_temp.review();
update public.quiz_question_explanations set explanation='Revised explanation' where question_id in(select z.id from public.quiz_questions z join public.quizzes q on q.id=z.quiz_id join public.course_blocks b on b.id=q.course_block_id where b.course_version_id=pg_temp.draft_id());
select ok(pg_temp.review_absent(),'native explanation writer invalidates approval');
select pg_temp.review();
update public.course_compliance_credits set citation_note='Revised credit policy' where course_version_id=pg_temp.draft_id();
select ok(pg_temp.review_absent(),'native credit writer invalidates approval');
select pg_temp.review();
update public.course_provider_profiles set review_notes='Revised provider policy' where course_id='9e000000-0000-4000-8000-000000000007';
select ok(pg_temp.review_absent(),'native provider writer invalidates approval');
select pg_temp.review();
select public.quarantine_learning_package('9e000000-0000-4000-8000-000000000081','Synthetic draft artifact withdrawal');
select ok(pg_temp.review_absent(),'native package quarantine invalidates draft approval');
select pg_temp.review();
update public.courses set title='Revised course-level title' where id='9e000000-0000-4000-8000-000000000007';
select ok(pg_temp.review_absent(),'native course policy writer invalidates approval');

-- Transaction rollback removes edits, proof and ledger together.
insert into draft_fixture values('beforeRollback',to_jsonb(pg_temp.revision()));
insert into draft_fixture values('reviewCount',to_jsonb((select count(*) from app_private.learning_draft_reviews where version_id=pg_temp.draft_id())));
savepoint draft_rollback;
select pg_temp.execute('9e000000-0000-4000-8000-000000000083',pg_temp.params('{"version":{"description":"Rolled back text"}}'));
select pg_temp.review();
rollback to savepoint draft_rollback;
select is(pg_temp.revision(),(select value#>>'{}' from draft_fixture where label='beforeRollback'),'transaction rollback restores exact source');
select is((select count(*) from app_private.platform_admin_commands where request_id='9e000000-0000-4000-8000-000000000083'),0::bigint,'rollback leaves no applied command');
select is((select count(*) from app_private.learning_draft_reviews where version_id=pg_temp.draft_id()),(select (value#>>'{}')::bigint from draft_fixture where label='reviewCount'),'rollback leaves no review proof');

-- Fresh-session and current actor checks precede all mutation and replay.
select set_config('request.jwt.claims','{"sub":"9e000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"9e000000-0000-4000-8000-000000000071"}',true);
select throws_ok($$select public.apply_native_learning_draft_command((select (value->>'commandId')::uuid from draft_fixture where label='patch'),(select preview_digest from app_private.platform_admin_commands where request_id='9e000000-0000-4000-8000-000000000082'))$$,
  '42501','Preview belongs to another operation or administrator session.','same admin in another session cannot recover someone else session command');
update auth.sessions set created_at=now()-interval '9 hours' where id='9e000000-0000-4000-8000-000000000071';
select throws_ok($$select public.get_native_learning_draft_source(pg_temp.draft_id())$$,'28000','Sign in again before editing or approving a governed draft.','old actual session cannot obtain a fresh review snapshot');
select set_config('request.jwt.claims','{"sub":"9e000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"9e000000-0000-4000-8000-000000000070"}',true);
update auth.users set banned_until=now()+interval '1 hour' where id='9e000000-0000-4000-8000-000000000003';
select throws_ok($$select pg_temp.execute('9e000000-0000-4000-8000-000000000082',(select value from draft_fixture where label='patchParameters'))$$,
  '42501','Current native administrator required.','banned actor cannot recover an old applied receipt');
update auth.users set banned_until=null where id='9e000000-0000-4000-8000-000000000003';

-- The delegated Hub path has the same source-CAS and evidence implementation.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
create function pg_temp.hub_preview(p_patch jsonb default null) returns jsonb language sql as $$
 select public.preview_learning_authoring_command('9e000000-0000-4000-8000-000000000003','9e000000-0000-4000-8000-000000000090',
 '9e000000-0000-4000-8000-000000000091',now()-interval '1 hour',now()+interval '7 hours',gen_random_uuid(),
 case when p_patch is null then 'learning.reviewDraft' else 'learning.patchDraft' end,'9e000000-0000-4000-8000-000000000007',pg_temp.params(p_patch),'Reviewed synthetic Hub draft policy','app_sms')
$$;
create function pg_temp.hub_apply(p_preview jsonb) returns jsonb language sql as $$
 select public.apply_learning_authoring_command('9e000000-0000-4000-8000-000000000003','9e000000-0000-4000-8000-000000000090',
 '9e000000-0000-4000-8000-000000000091',now()-interval '1 hour',now()+interval '7 hours',(p_preview->>'commandId')::uuid,p_preview->>'previewDigest','app_sms')
$$;
insert into draft_fixture values('hubPatch',pg_temp.hub_preview('{"version":{"title":"Hub edited title"}}'));
select is((select value->'after' from draft_fixture where label='hubPatch'),
 (select (value->'before'-'sourceRevision')||'{"title":"Hub edited title","aiReviewRequired":true}'::jsonb from draft_fixture where label='hubPatch'),'patch preview exactly preserves draft identities and reports new review requirement');
select pg_temp.hub_apply((select value from draft_fixture where label='hubPatch'));
select ok(pg_temp.review_absent(),'delegated patch never manufactures review');
insert into draft_fixture values('hubReview',pg_temp.hub_preview());
select is((select value->'after' from draft_fixture where label='hubReview'),
 (select (value->'before'-'sourceRevision')||'{"aiReviewRequired":false}'::jsonb from draft_fixture where label='hubReview'),'review preview only changes review requirement');
select pg_temp.hub_apply((select value from draft_fixture where label='hubReview'));
select is((select authentication_method from app_private.learning_draft_reviews where version_id=pg_temp.draft_id() and revoked_at is null),'app_sms','delegated proof records actual SMS authority without claiming AAL2');
select ok((pg_temp.hub_apply((select value from draft_fixture where label='hubReview'))->>'replayed')::boolean,'delegated review replay cannot create a second approval');
select is((select count(*) from public.course_assignments where course_version_id=pg_temp.draft_id()),0::bigint,'editing/review never creates assignments');
select is((select count(*) from public.quiz_attempts a join public.quizzes q on q.id=a.quiz_id join public.course_blocks b on b.id=q.course_block_id where b.course_version_id=pg_temp.draft_id()),0::bigint,'editing/review never clones attempts or learner history');
select is((select to_jsonb(v) from public.course_versions v where id='9e000000-0000-4000-8000-000000000008'),(select value from draft_fixture where label='source'),'original published version remains immutable');

-- Publication remains a distinct native business operation. A later provider
-- correction or emergency artifact quarantine must retain its existing authority.
select set_config('request.jwt.claims','{"sub":"9e000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"9e000000-0000-4000-8000-000000000070"}',true);
insert into public.learning_packages(id,course_version_id,standard_type,storage_path,content_sha256,compressed_bytes,entry_point,validation_status,validated_at,immutable_at)
  values('9e000000-0000-4000-8000-000000000092',pg_temp.draft_id(),'scorm_1_2','synthetic/published.zip',repeat('c',64),50,'index.html','accepted',now(),now());
select pg_temp.review();
select lives_ok($$select public.publish_course_version(pg_temp.draft_id())$$,'native publication accepts exact approved material through existing quality checks');
select lives_ok($$select public.quarantine_learning_package('9e000000-0000-4000-8000-000000000092','Synthetic published artifact withdrawal')$$,'published artifact emergency quarantine remains available');
select lives_ok($$update public.course_provider_profiles set review_notes='Post-publication provider correction' where course_id='9e000000-0000-4000-8000-000000000007'$$,'provider maintenance remains available after publication');

select * from finish();
rollback;
