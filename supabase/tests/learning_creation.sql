-- Synthetic creation lifecycle only. The entire fixture is rolled back.
begin;
select no_plan();
create function pg_temp.cid(n integer) returns uuid language sql immutable as $$select ('ace00000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
insert into public.organizations(id,name,slug) values(pg_temp.cid(10),'Creation fixture organization','creation-fixture');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
  created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change,email_change_token_current,reauthentication_token,is_sso_user,is_anonymous)
select '00000000-0000-0000-0000-000000000000',pg_temp.cid(n),'authenticated','authenticated','creation-'||n||'@test.local','x',now(),'{}','{}',now(),now(),'','','','','','',false,false
  from generate_series(1,3) n;
select set_config('app.privileged_write','on',true);
update public.profiles set role='platform_admin',is_active=true where id in(pg_temp.cid(1),pg_temp.cid(2));
update public.profiles set role='employee',is_active=true,organization_id=pg_temp.cid(10) where id=pg_temp.cid(3);
select set_config('app.privileged_write','',true);
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
  (pg_temp.cid(100),pg_temp.cid(1),now()-interval '1 hour',now(),'aal1'),
  (pg_temp.cid(101),pg_temp.cid(1),now()-interval '1 hour',now(),'aal1'),
  (pg_temp.cid(102),pg_temp.cid(2),now()-interval '1 hour',now(),'aal1'),
  (pg_temp.cid(103),pg_temp.cid(3),now()-interval '1 hour',now(),'aal1');
create function pg_temp.actor(p_user integer default 1,p_session integer default 100) returns void language sql as $$
  select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.cid(p_user),'role','authenticated','session_id',pg_temp.cid(p_session))::text,true);
$$;
select pg_temp.actor();
insert into public.training_types(id,organization_id,code,name,category,is_active) values
  (pg_temp.cid(11),null,'CREATE_ACTIVE','AAA active creation type','Fixture',true),
  (pg_temp.cid(12),null,'CREATE_INACTIVE','AAA inactive creation type','Fixture',false),
  (pg_temp.cid(13),pg_temp.cid(10),'CREATE_TENANT','AAA tenant creation type','Fixture',true);
create temporary table creation_fixture(label text primary key,value jsonb);
create function pg_temp.cparams(p_version integer default 31,p_type integer default 11) returns jsonb language sql as $$
  select jsonb_build_object('versionId',upper(pg_temp.cid(p_version)::text),'course',jsonb_build_object('title','Care practice curriculum','description',null,
    'category','Safety','estimatedDurationMinutes',16,'trainingTypeId',case when p_type is null then null else pg_temp.cid(p_type) end),
    'version',jsonb_build_object('title','Care practice first draft','description','Human entered draft'));
$$;
create function pg_temp.create_course(p_course integer,p_version integer,p_request integer) returns jsonb language sql as $$
  select public.execute_native_learning_draft_command(pg_temp.cid(p_request),'learning.createCourse',pg_temp.cid(p_course),pg_temp.cparams(p_version),'Reviewed new course definitions');
$$;
create function pg_temp.crevision(p_course integer default 30,p_version integer default 31) returns text language sql as $$
  select encode(extensions.digest(app_private.learning_source_payload(pg_temp.cid(p_course),pg_temp.cid(p_version)),'sha256'),'hex');
$$;

select ok(not has_function_privilege('authenticated','app_private.create_governed_learning_course_core(uuid,uuid,jsonb)','EXECUTE'),'authenticated cannot bypass creation ledger');
select ok(not has_function_privilege('service_role','app_private.learning_creation_status(uuid,uuid,uuid,uuid,uuid)','EXECUTE'),'service cannot bypass creation-status actor wrapper');
select ok(not has_function_privilege('anon','public.get_native_learning_creation_options(integer)','EXECUTE'),'anonymous cannot read creation options');
insert into creation_fixture values('options',public.get_native_learning_creation_options(0));
select ok((select value->'trainingTypes' @> jsonb_build_array(jsonb_build_object('id',pg_temp.cid(11),'label','AAA active creation type')) from creation_fixture where label='options'),'options contain current global ID and actual label');
select ok(not (select value::text like '%'||pg_temp.cid(12)::text||'%' or value::text like '%'||pg_temp.cid(13)::text||'%' from creation_fixture where label='options'),'inactive and tenant training types excluded');
select throws_ok($$select public.get_native_learning_creation_options(-1)$$,'22023','Invalid creation options page.','negative options page rejected');
-- More rows than the maximum page boundary prove arbitrary valid offsets never advertise an invalid next page.
insert into public.training_types(id,code,name,category,is_active)
select pg_temp.cid(10000+n),'CREATE_PAGE_'||n,'ZZZ creation page '||lpad(n::text,5,'0'),'Fixture',true from generate_series(1,10060) n;
select is(public.get_native_learning_creation_options(9900)->>'nextOffset','10000','last reachable page remains available');
select is(public.get_native_learning_creation_options(9950)->'nextOffset','null'::jsonb,'nonaligned last page never advertises an invalid offset');
select is(public.get_native_learning_creation_options(10000)->'nextOffset','null'::jsonb,'maximum page ends pagination even with more rows');
select is(public.get_native_learning_creation_status(pg_temp.cid(30),pg_temp.cid(31),pg_temp.cid(32)),'{"status":"absent","result":null}'::jsonb,'unused identities report absent');
insert into creation_fixture values('preview',public.preview_native_learning_draft_command(pg_temp.cid(32),'learning.createCourse',pg_temp.cid(30),pg_temp.cparams(),'Reviewed new course definitions'));
select is((select count(*) from public.courses where id=pg_temp.cid(30)),0::bigint,'preview writes no course');
select is((select value#>>'{before,exists}' from creation_fixture where label='preview'),'false','preview expresses actual absence');
select is((select value#>>'{after,contentStandard}' from creation_fixture where label='preview'),'comprehensive','new draft declares comprehensive standard');
insert into creation_fixture values('created',public.apply_native_learning_draft_command(
  (select (value->>'commandId')::uuid from creation_fixture where label='preview'),(select value->>'previewDigest' from creation_fixture where label='preview')));
select is((select status from public.courses where id=pg_temp.cid(30)),'draft','created parent stays draft');
select ok((select current_version_id is null and organization_id is null and created_by=pg_temp.cid(1) from public.courses where id=pg_temp.cid(30)),'parent tenancy and creator come from trusted native creation');
select ok((select version_number=1 and status='draft' and content_standard='comprehensive' and not ai_generated and ai_reviewed_at is null and ai_reviewed_by is null and published_at is null from public.course_versions where id=pg_temp.cid(31)),'first version is human-authored and unapproved');
select ok((select provenance_kind='new_course' and source_version_id is null and source_revision is null from app_private.learning_authoring_drafts where version_id=pg_temp.cid(31)),'new course has explicit provenance without self-source');
select is((select count(*) from public.course_blocks where course_version_id=pg_temp.cid(31)),0::bigint,'creation adds no fabricated lessons');
select is((select value->>'sourceRevision' from creation_fixture where label='created'),pg_temp.crevision(),'creation receipt hashes actual canonical source');
select is(public.get_native_learning_draft_source(pg_temp.cid(31))->>'sourceRevision',pg_temp.crevision(),'parent-draft source is immediately readable');
select is((app_private.learning_source_payload(pg_temp.cid(30),pg_temp.cid(31))::jsonb)->'blocks','[]'::jsonb,'empty source retains explicit empty blocks');
select ok((pg_temp.create_course(30,31,32)->>'replayed')::boolean,'same request replays original result');
select is((select count(*) from public.course_versions where course_id=pg_temp.cid(30)),1::bigint,'replay does not create a second draft');
select throws_ok($$select public.preview_native_learning_draft_command(pg_temp.cid(32),'learning.createCourse',pg_temp.cid(30),pg_temp.cparams()||'{"extra":true}','Reviewed new course definitions')$$,
  '40001','Request identifier already has different inputs.','request identity cannot change fields');
select throws_ok($$select pg_temp.create_course(30,41,42)$$,'40001','Creation identities are already in use.','existing parent identity cannot be overwritten');

-- Current same principal may recover after original session expiration; other principal cannot.
update auth.sessions set created_at=now()-interval '9 hours' where id=pg_temp.cid(100);
select throws_ok($$select public.get_native_learning_creation_status(pg_temp.cid(30),pg_temp.cid(31),pg_temp.cid(32))$$,
  '28000','Sign in again before editing or approving a governed draft.','old session cannot recover');
select pg_temp.actor(1,101);
select is(public.get_native_learning_creation_status(pg_temp.cid(30),pg_temp.cid(31),pg_temp.cid(32))->'result',
  (select value from creation_fixture where label='created'),'renewed same-principal session recovers immutable original result');
select pg_temp.actor(2,102);
select throws_ok($$select public.get_native_learning_creation_status(pg_temp.cid(30),pg_temp.cid(31),pg_temp.cid(32))$$,
  '40001','Creation identities exist without the matching receipt.','another principal cannot claim creation evidence');
select pg_temp.actor(3,103);
select throws_ok($$select public.get_native_learning_creation_options(0)$$,'42501','Current native administrator required.','learner cannot use creation reads');
select throws_ok($$select public.get_native_learning_creation_status(pg_temp.cid(30),pg_temp.cid(31),pg_temp.cid(32))$$,'42501','Current native administrator required.','learner cannot read a native creation receipt');
select pg_temp.actor(1,101);

savepoint creation_rollback;
select pg_temp.create_course(40,41,42);
rollback to savepoint creation_rollback;
select is((select count(*) from public.courses where id=pg_temp.cid(40)),0::bigint,'transaction rollback removes course');
select is((select count(*) from app_private.learning_authoring_drafts where version_id=pg_temp.cid(41)),0::bigint,'transaction rollback removes provenance');
select is((select count(*) from app_private.platform_admin_commands where request_id=pg_temp.cid(42)),0::bigint,'transaction rollback removes intent/result');
create function pg_temp.reject_creation_audit() returns trigger language plpgsql as $$
begin
  if new.entity_id=pg_temp.cid(45)::text and new.action='governed_learning_draft_applied' then raise exception 'Synthetic audit refusal'; end if;
  return new;
end;
$$;
create trigger creation_fixture_audit before insert on public.audit_logs for each row execute function pg_temp.reject_creation_audit();
select throws_ok($$select pg_temp.create_course(44,45,46)$$,'P0001','Synthetic audit refusal','audit failure rejects entire creation transaction');
select is((select count(*) from public.courses where id=pg_temp.cid(44)),0::bigint,'audit failure leaves no orphaned course');
select is((select count(*) from app_private.platform_admin_commands where request_id=pg_temp.cid(46)),0::bigint,'audit failure leaves no created receipt');
drop trigger creation_fixture_audit on public.audit_logs;

insert into creation_fixture values('staleType',public.preview_native_learning_draft_command(pg_temp.cid(52),'learning.createCourse',pg_temp.cid(50),pg_temp.cparams(51),'Reviewed new course definitions'));
update public.training_types set renewal_interval_days=123 where id=pg_temp.cid(11);
select throws_ok($$select public.apply_native_learning_draft_command((select (value->>'commandId')::uuid from creation_fixture where label='staleType'),
  (select value->>'previewDigest' from creation_fixture where label='staleType'))$$,'40001','Source or authority changed since preview.','training policy change invalidates creation preview');
select is((select count(*) from public.courses where id=pg_temp.cid(50)),0::bigint,'stale policy creates no material');
select throws_ok($$select public.preview_native_learning_draft_command(pg_temp.cid(62),'learning.createCourse',pg_temp.cid(60),pg_temp.cparams(61,12),'Reviewed new course definitions')$$,
  '40001','Choose a current active global training type.','inactive type cannot be selected directly');
select throws_ok($$select public.preview_native_learning_draft_command(pg_temp.cid(62),'learning.createCourse',pg_temp.cid(60),pg_temp.cparams(61,13),'Reviewed new course definitions')$$,
  '40001','Choose a current active global training type.','tenant type cannot be linked to global course');

-- Existing writer works before parent publication; no review is fabricated for human material.
select lives_ok($$select public.execute_native_learning_draft_command(pg_temp.cid(70),'learning.patchDraft',pg_temp.cid(30),
  jsonb_build_object('versionId',pg_temp.cid(31),'sourceRevision',pg_temp.crevision(),'patch',jsonb_build_object('version',jsonb_build_object('description','Edited human definition'))),'Reviewed draft description change')$$,'parent draft accepts normal source-CAS editing');
select throws_ok($$select public.publish_course_version(pg_temp.cid(31))$$,'23514',null,'empty comprehensive draft cannot publish');
select ok((select status='draft' and current_version_id is null from public.courses where id=pg_temp.cid(30)),'failed first publication preserves parent state');

-- Add genuinely sufficient synthetic definitions through the normal structure core.
create function pg_temp.add_fixture_structure() returns void language plpgsql as $$
declare v_changes jsonb:='[]'; v_question integer; v_activities text[]:=array['objectives','instruction','instruction','practice','practice','scenario','sources','assessment']; i integer;
begin
  for i in 1..8 loop
    v_changes:=v_changes||jsonb_build_array(jsonb_build_object('operation','addLesson','blockId',pg_temp.cid(200+i),'blockType',case when i=8 then 'quiz' else 'text' end,'title','Synthetic step '||i,
      'body',jsonb_build_object('estimatedMinutes',2,'activityType',v_activities[i])||case when i=8 then '{}'::jsonb else
        jsonb_build_object('content',repeat('Synthetic learner guidance describes a practice activity and careful observation. ',12)||case when i=7 then ' Sources: https://www.pa.gov/ official fixture citation.' else '' end) end));
  end loop;
  v_changes:=v_changes||jsonb_build_array(jsonb_build_object('operation','configureQuiz','blockId',pg_temp.cid(208),'quizId',pg_temp.cid(220),'title','Final assessment',
    'kind','final_exam','passingScore',80,'maxAttempts',null,'shuffleQuestions',true,'shuffleAnswers',true,'revealsAnswersAfterAttempt',false));
  for v_question in 1..5 loop
    v_changes:=v_changes||jsonb_build_array(jsonb_build_object('operation','saveQuestion','quizId',pg_temp.cid(220),'questionId',pg_temp.cid(230+v_question),
      'prompt','Synthetic contextual assessment question number '||v_question,'type','single_choice','points',1,'topicCode',null,'topicLabel',null,
      'explanation','Synthetic restricted explanation explains why the chosen response meets the supplied example criteria.',
      'removedAnswerIds','[]'::jsonb,'answers',(select jsonb_agg(jsonb_build_object('answerId',pg_temp.cid(300+10*v_question+a),'text','Synthetic meaningful option number '||a,'correct',a=1) order by a) from generate_series(1,4) a)));
  end loop;
  perform public.execute_native_learning_draft_command(pg_temp.cid(71),'learning.editStructure',pg_temp.cid(30),
    jsonb_build_object('versionId',pg_temp.cid(31),'sourceRevision',pg_temp.crevision(),'changes',v_changes),'Reviewed complete synthetic curriculum');
end;
$$;
select lives_ok($$select pg_temp.add_fixture_structure()$$,'normal structure writer builds new parent-draft curriculum');
select is(public.get_comprehensive_course_version_issues(pg_temp.cid(31)),array[]::text[],'new fixture meets native comprehensive readiness without lowering standard');
select lives_ok($$select public.publish_course_version(pg_temp.cid(31))$$,'existing native publisher handles first governed publication');
select ok((select status='published' and current_version_id=pg_temp.cid(31) from public.courses where id=pg_temp.cid(30)),'first publication atomically activates parent and exact version');
select is((select count(*) from public.course_assignments where course_id=pg_temp.cid(30)),0::bigint,'creation/publication writes no assignments');
select is((select count(*) from public.course_completion_credits where course_id=pg_temp.cid(30)),0::bigint,'no learner completion credits written');
select is((select count(*) from public.course_provider_profiles where course_id=pg_temp.cid(30)),0::bigint,'no provider evidence fabricated');

-- SMS delegates use the same writer and a renewed session may recover the receipt.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
insert into creation_fixture values('hubPreview',public.preview_learning_authoring_command(pg_temp.cid(1),pg_temp.cid(900),pg_temp.cid(901),now()-interval '1 hour',now()+interval '7 hours',
  pg_temp.cid(82),'learning.createCourse',pg_temp.cid(80),pg_temp.cparams(81,null),'Reviewed new delegated course','app_sms'));
insert into creation_fixture values('hubResult',public.apply_learning_authoring_command(pg_temp.cid(1),pg_temp.cid(900),pg_temp.cid(901),now()-interval '1 hour',now()+interval '7 hours',
  (select (value->>'commandId')::uuid from creation_fixture where label='hubPreview'),(select value->>'previewDigest' from creation_fixture where label='hubPreview'),'app_sms'));
select is((select authentication_method from app_private.platform_admin_commands where request_id=pg_temp.cid(82)),'app_sms','creation audit uses actual SMS method');
select is(public.get_learning_creation_status(pg_temp.cid(1),pg_temp.cid(900),pg_temp.cid(902),now()-interval '1 hour',now()+interval '7 hours',pg_temp.cid(80),pg_temp.cid(81),pg_temp.cid(82),'app_sms')->'result',
  (select value from creation_fixture where label='hubResult'),'new verified SMS session reads exact original creation result');
select is(public.inspect_learning_authoring_course(pg_temp.cid(1),pg_temp.cid(900),pg_temp.cid(902),now()-interval '1 hour',now()+interval '7 hours',pg_temp.cid(80),'app_sms')->>'currentVersionId',null::text,'delegated inspector discovers parent draft without current version');
select is(public.get_learning_authoring_source(pg_temp.cid(1),pg_temp.cid(900),pg_temp.cid(902),now()-interval '1 hour',now()+interval '7 hours',pg_temp.cid(80),pg_temp.cid(81),'app_sms')->>'sourceRevision',
  (select value->>'sourceRevision' from creation_fixture where label='hubResult'),'direct new-draft source matches immutable create result');
select throws_ok($$select public.get_learning_creation_status(pg_temp.cid(1),pg_temp.cid(999),pg_temp.cid(902),now()-interval '1 hour',now()+interval '7 hours',pg_temp.cid(80),pg_temp.cid(81),pg_temp.cid(82),'app_sms')$$,
  '40001','Creation identities exist without the matching receipt.','different Hub principal cannot recover creation receipt');
update auth.users set banned_until=now()+interval '1 day' where id=pg_temp.cid(1);
select throws_ok($$select public.get_learning_creation_status(pg_temp.cid(1),pg_temp.cid(900),pg_temp.cid(902),now()-interval '1 hour',now()+interval '7 hours',pg_temp.cid(80),pg_temp.cid(81),pg_temp.cid(82),'app_sms')$$,
  '42501',null,'native actor ban blocks delegated receipt recovery');
select * from finish();
rollback;
