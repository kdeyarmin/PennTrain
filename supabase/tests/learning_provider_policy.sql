-- Synthetic creation lifecycle only. The entire fixture is rolled back.
begin;
select no_plan();
create function pg_temp.cid(n integer) returns uuid language sql immutable as $$select ('ace00000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
insert into public.organizations(id,name,slug) values(pg_temp.cid(10),'Provider policy fixture organization','provider-policy-fixture');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
  created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change,email_change_token_current,reauthentication_token,is_sso_user,is_anonymous)
select '00000000-0000-0000-0000-000000000000',pg_temp.cid(n),'authenticated','authenticated','provider-policy-'||n||'@test.local','x',now(),'{}','{}',now(),now(),'','','','','','',false,false
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
    'category','Safety','estimatedDurationMinutes',120,'trainingTypeId',case when p_type is null then null else pg_temp.cid(p_type) end),
    'version',jsonb_build_object('title','Care practice first draft','description','Human entered draft'));
$$;
create function pg_temp.create_course(p_course integer,p_version integer,p_request integer) returns jsonb language sql as $$
  select public.execute_native_learning_draft_command(pg_temp.cid(p_request),'learning.createCourse',pg_temp.cid(p_course),pg_temp.cparams(p_version),'Reviewed new course definitions');
$$;

select pg_temp.create_course(30,31,20);
insert into public.courses(id,organization_id,title,status) values(pg_temp.cid(40),pg_temp.cid(10),'Tenant provider record','draft');
create function pg_temp.context() returns jsonb language sql as $$select public.get_native_learning_provider_context(pg_temp.cid(30))$$;
create function pg_temp.preview(p_patch jsonb,p_request uuid default gen_random_uuid(),p_revision text default null) returns jsonb language sql as $$
  select public.preview_native_learning_provider_command(p_request,pg_temp.cid(30),coalesce(p_revision,pg_temp.context()->>'providerContextRevision'),p_patch,'Reviewed course-wide provider record');
$$;
create function pg_temp.apply(p_preview jsonb) returns jsonb language sql as $$select public.apply_native_learning_provider_command((p_preview->>'commandId')::uuid,p_preview->>'previewDigest')$$;
create function pg_temp.edit(p_patch jsonb) returns jsonb language sql as $$select pg_temp.apply(pg_temp.preview(p_patch))$$;
select ok(not has_function_privilege('authenticated','app_private.learning_provider_plan(uuid,boolean,text,jsonb)','EXECUTE'),'native callers cannot reach raw provider plan');
select ok(not has_function_privilege('service_role','app_private.apply_learning_provider_command(uuid,uuid,uuid,text,timestamptz,uuid,text)','EXECUTE'),'delegate cannot reach raw provider writer');
select ok(not has_table_privilege('authenticated','public.course_provider_profiles','UPDATE'),'old native table update is removed');
select ok(not has_table_privilege('service_role','public.course_provider_profiles','INSERT'),'service direct upsert cannot bypass shared ledger');
select ok(has_table_privilege('authenticated','public.course_provider_profiles','SELECT'),'native learner profile read remains');
select pg_temp.actor(3,103);
select throws_ok($$select pg_temp.context()$$,'42501','Current native administrator required.','learner cannot view protected context');
select pg_temp.actor();
select is(pg_temp.context()->'profile','null'::jsonb,'new course has no invented provider profile');
select throws_ok($$select pg_temp.preview('{"courseAuthor":"Author"}')$$,'22023','A new provider record requires the full name.','new record requires explicit name');
insert into creation_fixture values('first',pg_temp.preview('{"providerFullName":"Original provider","signatureName":"Typed provider","reviewNotes":"Original notes"}',pg_temp.cid(200)));
select is((select count(*) from public.course_provider_profiles where course_id=pg_temp.cid(30)),0::bigint,'preview creates no provider or signature');
select is((select value->>'signatureTimestampAction' from creation_fixture where label='first'),'record','preview honestly describes future server signature timestamp');
insert into creation_fixture values('firstResult',pg_temp.apply((select value from creation_fixture where label='first')));
select is((select provider_full_name from public.course_provider_profiles where course_id=pg_temp.cid(30)),'Original provider','shared transaction inserts provider');
select ok((select provider_signature_recorded_at between now()-interval '1 minute' and clock_timestamp() from public.course_provider_profiles where course_id=pg_temp.cid(30)),'server records signature time');
select is((select updated_by from public.course_provider_profiles where course_id=pg_temp.cid(30)),pg_temp.cid(1),'actual native actor stamped');
select is(pg_temp.apply((select value from creation_fixture where label='first'))->>'replayed','true','exact apply replay returns committed receipt');
select is((select count(*) from app_private.learning_provider_commands where request_id=pg_temp.cid(200)),1::bigint,'replay does not make another command');
select throws_ok($$select pg_temp.preview('{"providerFullName":"Different"}',pg_temp.cid(200),'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')$$,'40001','Request already has different inputs.','request cannot be repurposed');
select throws_ok($$select pg_temp.edit('{"providerFullName":"Original provider"}')$$,'22023','No provider changes to apply.','no-op metadata denied');
select throws_ok($$select pg_temp.edit(jsonb_build_object('reviewNotes','{"token":"hidden"}'))$$,'22023','Provider text contains excluded credentials.','credential JSON inside a text field is rejected');
select throws_ok($$select pg_temp.edit('{"credential":"Invented"}')$$,'22023','Invalid provider patch.','credential assertion is outside editor');
select throws_ok($$select pg_temp.edit('{"signatureRecordedAt":"2026-01-01"}')$$,'22023','Invalid provider patch.','client cannot supply signature timestamp');
select throws_ok($$select pg_temp.edit('{"nextReviewDue":"2025-02-29"}')$$,'22023','Invalid calendar date.','impossible day denied by database');
select throws_ok($$select pg_temp.edit('{"reviewNotes":"   "}')$$,'22023','Invalid provider notes.','blank notes require explicit null');
select throws_ok($$select pg_temp.edit('{"lastClinicalReviewDate":"2026-09-11","nextReviewDue":"2026-09-10"}')$$,'23514','Next review must not precede the last review.','native review window preserved');
update public.course_provider_profiles set professional_title='Retained title',credential='Retained credential',credential_number='Retained number',
  credential_issuing_organization='Retained issuer',credential_expires_on='2030-01-01',review_notes=repeat('x',20000) where course_id=pg_temp.cid(30);
insert into creation_fixture values('oldProvider',(select to_jsonb(p) from public.course_provider_profiles p where course_id=pg_temp.cid(30)));
select lives_ok($$select pg_temp.edit('{"courseAuthor":"Updated author"}')$$,'unrelated sparse edit preserves out-of-editor legacy values');
select is((select to_jsonb(p)-array['course_author','updated_at','updated_by'] from public.course_provider_profiles p where course_id=pg_temp.cid(30)),
  (select value-array['course_author','updated_at','updated_by'] from creation_fixture where label='oldProvider'),'five credential fields and old signature/notes remain exact');
select lives_ok($$select pg_temp.edit('{"signatureName":null}')$$,'signature can be explicitly removed');
select ok((select provider_signature_name is null and provider_signature_recorded_at is null from public.course_provider_profiles where course_id=pg_temp.cid(30)),'clearing signature clears paired server timestamp');
-- Certificate history is synthetic. A null snapshot marker intentionally models a pre-migration certificate.
insert into public.facilities(id,organization_id,name,facility_type) values(pg_temp.cid(50),pg_temp.cid(10),'Provider fixture facility','PCH');
insert into public.employees(id,organization_id,facility_id,profile_id,employee_number,first_name,last_name,email,hire_date,job_title,status)
  values(pg_temp.cid(51),pg_temp.cid(10),pg_temp.cid(50),pg_temp.cid(3),'PROVIDER-1','Synthetic','Learner','provider-fixture@test.local',public.pa_today()-1,'Care','active');
insert into public.certificates(id,organization_id,facility_id,employee_id,course_id,slug,credential_number,issued_at)
  values(pg_temp.cid(52),pg_temp.cid(10),pg_temp.cid(50),pg_temp.cid(51),pg_temp.cid(30),'provider-stamped','PROVIDER-CERT-1',now()),
        (pg_temp.cid(53),pg_temp.cid(10),pg_temp.cid(50),pg_temp.cid(51),pg_temp.cid(30),'provider-legacy','PROVIDER-CERT-2',now());
update public.certificates set provider_snapshot_at=null,training_provider=null,provider_credential=null where id=pg_temp.cid(53);
insert into creation_fixture values('stamped',(select to_jsonb(c) from public.certificates c where id=pg_temp.cid(52))),('legacy',(select to_jsonb(c) from public.certificates c where id=pg_temp.cid(53)));
insert into creation_fixture values('rename',pg_temp.preview('{"providerFullName":"Later provider"}'));
select is((select value#>>'{impact,legacyFallbackCertificates}' from creation_fixture where label='rename'),'1','exact legacy fallback count is decimal string');
select pg_temp.apply((select value from creation_fixture where label='rename'));
select is((select to_jsonb(c) from public.certificates c where id=pg_temp.cid(52)),(select value from creation_fixture where label='stamped'),'issued certificate remains byte-equivalent after provider edit');
select is((select to_jsonb(c) from public.certificates c where id=pg_temp.cid(53)),(select value from creation_fixture where label='legacy'),'legacy certificate is not silently backfilled');
select is((select case when c.provider_snapshot_at is not null then c.training_provider else p.provider_full_name end from public.certificates c join public.course_provider_profiles p on p.course_id=c.course_id where c.id=pg_temp.cid(53)),
  'Later provider','legacy live-profile fallback retains native display semantics');
-- Any full provider/course row change makes the preview stale, including noneditable credential fields.
insert into creation_fixture values('stale',pg_temp.preview('{"courseAuthor":"Another author"}'));
update public.course_provider_profiles set credential_number='Changed native credential' where course_id=pg_temp.cid(30);
select throws_ok($$select pg_temp.apply((select value from creation_fixture where label='stale'))$$,'40001','Provider context changed; refresh before editing.','full provider row CAS catches retained credential changes');
insert into creation_fixture values('courseStale',pg_temp.preview('{"courseAuthor":"Another author"}'));
update public.courses set description='Changed course policy context' where id=pg_temp.cid(30);
select throws_ok($$select pg_temp.apply((select value from creation_fixture where label='courseStale'))$$,'40001','Provider context changed; refresh before editing.','full course row CAS catches course changes');
-- Exact material review is revoked by the existing common provider definition trigger.
update public.course_provider_profiles set review_notes='Ordinary notes' where course_id=pg_temp.cid(30);
update public.course_versions set ai_generated=true where id=pg_temp.cid(31);
select public.execute_native_learning_draft_command(pg_temp.cid(230),'learning.reviewDraft',pg_temp.cid(30),jsonb_build_object('versionId',pg_temp.cid(31),
 'sourceRevision',encode(extensions.digest(app_private.learning_source_payload(pg_temp.cid(30),pg_temp.cid(31)),'sha256'),'hex'),'reviewed',true),'Reviewed exact AI draft materials');
insert into creation_fixture values('reviewImpact',pg_temp.preview('{"reviewNotes":"Reviewed maintenance notes"}'));
select is((select value#>>'{impact,governedDrafts,0,reviewInvalidated}' from creation_fixture where label='reviewImpact'),'true','preview names exact active draft review impact');
select pg_temp.apply((select value from creation_fixture where label='reviewImpact'));
select ok((select ai_reviewed_at is null and ai_reviewed_by is null from public.course_versions where id=pg_temp.cid(31)),'metadata changes invalidate draft review without claiming provider approval');
select is((select count(*) from public.course_completion_credits where course_id=pg_temp.cid(30)),0::bigint,'provider edit issues no learner credit');
-- Fresh session can observe the old immutable receipt but cannot apply its command.
select pg_temp.actor(1,101);
select is(public.get_native_learning_provider_status((select (value->>'commandId')::uuid from creation_fixture where label='first'),
  (select value->>'previewDigest' from creation_fixture where label='first'))->'result',(select value from creation_fixture where label='firstResult'),'new session observes original result unchanged');
select throws_ok($$select pg_temp.apply((select value from creation_fixture where label='first'))$$,'42501','Provider preview belongs to another administrator session.','new session cannot apply old command');
select is(public.get_native_learning_provider_status((select (value->>'commandId')::uuid from creation_fixture where label='stale'),
  (select value->>'previewDigest' from creation_fixture where label='stale'))->>'canApplyThisSession','false','observing stale command never grants new session apply');
select ok(jsonb_array_length(public.list_native_learning_provider_commands(pg_temp.cid(30),0)->'items')>0,'saved owned commands remain discoverable across sessions');
select pg_temp.actor(2,102);
select throws_ok($$select public.get_native_learning_provider_status((select (value->>'commandId')::uuid from creation_fixture where label='first'),
  (select value->>'previewDigest' from creation_fixture where label='first'))$$,'42501','Provider receipt belongs to another administrator.','another current admin cannot disclose private intent');
select is(public.list_native_learning_provider_commands(pg_temp.cid(30),0)->'items','[]'::jsonb,'other administrator list does not expose intents');
select pg_temp.actor();
-- Complete rollback includes profile and audit; receipt never claims success without its audit.
insert into creation_fixture values('beforeRollback',(select to_jsonb(p) from public.course_provider_profiles p where course_id=pg_temp.cid(30)));
create function pg_temp.fail_provider_audit() returns trigger language plpgsql as $$begin if new.action='learning_provider_policy_applied' then raise exception 'fixture audit failure'; end if; return new; end$$;
create trigger fixture_provider_audit before insert on public.audit_logs for each row execute function pg_temp.fail_provider_audit();
select throws_ok($$select pg_temp.edit('{"courseAuthor":"Rolled back author"}')$$,'P0001','fixture audit failure','audit failure aborts provider transaction');
select is((select to_jsonb(p) from public.course_provider_profiles p where course_id=pg_temp.cid(30)),(select value from creation_fixture where label='beforeRollback'),'audit failure restores original provider');
drop trigger fixture_provider_audit on public.audit_logs;
-- Delegated SMS uses the identical writer with explicit actor audit and global-only scope.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select throws_ok($$select public.get_learning_provider_context(pg_temp.cid(1),pg_temp.cid(250),pg_temp.cid(251),now()-interval '1 hour',now()+interval '7 hours','app_sms',pg_temp.cid(40))$$,'42501','Global course required.','Hub delegate cannot edit tenant-owned course provider');
insert into creation_fixture values('sms',public.preview_learning_provider_command(pg_temp.cid(1),pg_temp.cid(250),pg_temp.cid(251),now()-interval '1 hour',now()+interval '7 hours','app_sms',pg_temp.cid(252),pg_temp.cid(30),
  public.get_learning_provider_context(pg_temp.cid(1),pg_temp.cid(250),pg_temp.cid(251),now()-interval '1 hour',now()+interval '7 hours','app_sms',pg_temp.cid(30))->>'providerContextRevision','{"courseAuthor":"SMS author"}','Reviewed delegated provider record'));
select lives_ok($$select public.apply_learning_provider_command(pg_temp.cid(1),pg_temp.cid(250),pg_temp.cid(251),now()-interval '1 hour',now()+interval '7 hours','app_sms',
 (select (value->>'commandId')::uuid from creation_fixture where label='sms'),(select value->>'previewDigest' from creation_fixture where label='sms'))$$,'SMS delegate calls common provider core');
select is((select actor_profile_id from public.audit_logs where action='learning_provider_policy_applied' and request_id=(select value->>'commandId' from creation_fixture where label='sms')),pg_temp.cid(1),'delegated audit records mapped native actor without fabricated JWT');
select is((select metadata->>'authenticationMethod' from public.audit_logs where action='learning_provider_policy_applied' and request_id=(select value->>'commandId' from creation_fixture where label='sms')),'app_sms','audit distinguishes actual SMS authority');
select is(public.get_learning_provider_status(pg_temp.cid(1),pg_temp.cid(250),pg_temp.cid(253),now()-interval '1 hour',now()+interval '7 hours','app_sms',
 (select (value->>'commandId')::uuid from creation_fixture where label='sms'),(select value->>'previewDigest' from creation_fixture where label='sms'))->>'canApplyThisSession','false','new SMS session can only observe old receipt');
select throws_ok($$select public.get_learning_provider_context(pg_temp.cid(1),pg_temp.cid(250),pg_temp.cid(251),now()-interval '9 hours',now()+interval '1 hour','app_sms',pg_temp.cid(30))$$,'42501','Fresh Hub session required','old original session cannot view provider context');
select set_config('app.privileged_write','on',true);
update public.profiles set is_active=false where id=pg_temp.cid(1);
select set_config('app.privileged_write','',true);
select throws_ok($$select public.get_learning_provider_status(pg_temp.cid(1),pg_temp.cid(250),pg_temp.cid(251),now()-interval '1 hour',now()+interval '7 hours','app_sms',
 (select (value->>'commandId')::uuid from creation_fixture where label='sms'),(select value->>'previewDigest' from creation_fixture where label='sms'))$$,'42501','Delegation forbidden','native actor revocation blocks receipt disclosure');
select * from finish();
rollback;
