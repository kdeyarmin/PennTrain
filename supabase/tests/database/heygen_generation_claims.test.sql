begin;
select no_plan();

-- The fixtures and provider IDs below are synthetic. This transaction exercises
-- the paid-generation control plane without contacting HeyGen or writing Storage.
insert into public.organizations(id,name,slug,subscription_status)
values ('db700000-0000-4000-8000-000000000001','HeyGen Claim Test','heygen-claim-test','active');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,
  email_change_token_new,email_change,email_change_token_current,reauthentication_token,is_sso_user,is_anonymous)
select '00000000-0000-0000-0000-000000000000',id,'authenticated','authenticated',email,'x',now(),
  '{}','{}',now(),now(),'','','','','','',false,false
from (values
 ('db700000-0000-4000-8000-000000000011'::uuid,'heygen-admin@test.local'),
 ('db700000-0000-4000-8000-000000000012'::uuid,'heygen-second-admin@test.local'),
 ('db700000-0000-4000-8000-000000000013'::uuid,'heygen-learner@test.local'),
 ('db700000-0000-4000-8000-000000000014'::uuid,'heygen-sms-admin@test.local')
) u(id,email);
select set_config('app.privileged_write','on',true);
insert into public.profiles(id,organization_id,email,first_name,last_name,role,is_active)
select id,'db700000-0000-4000-8000-000000000001',email,'HeyGen','Test',
  case when id='db700000-0000-4000-8000-000000000013' then 'employee' else 'platform_admin' end,true
from auth.users where id in ('db700000-0000-4000-8000-000000000011','db700000-0000-4000-8000-000000000012',
  'db700000-0000-4000-8000-000000000013','db700000-0000-4000-8000-000000000014')
on conflict(id) do update set organization_id=excluded.organization_id,role=excluded.role,is_active=true;
select set_config('app.privileged_write','off',true);
insert into auth.sessions(id,user_id,created_at,updated_at,aal,not_after) values
 ('db700000-0000-4000-8000-000000000101','db700000-0000-4000-8000-000000000011',now(),now(),'aal2',null),
 ('db700000-0000-4000-8000-000000000102','db700000-0000-4000-8000-000000000012',now(),now(),'aal2',null),
 ('db700000-0000-4000-8000-000000000103','db700000-0000-4000-8000-000000000013',now(),now(),'aal2',null),
 ('db700000-0000-4000-8000-000000000104','db700000-0000-4000-8000-000000000014',now(),now(),'aal1',null);
insert into public.courses(id,organization_id,title,status,estimated_duration_minutes)
values ('db700000-0000-4000-8000-000000000201','db700000-0000-4000-8000-000000000001',
 'HeyGen claim fixture','draft',30);
insert into public.course_versions(id,course_id,organization_id,version_number,title,status)
values ('db700000-0000-4000-8000-000000000211','db700000-0000-4000-8000-000000000201',
 'db700000-0000-4000-8000-000000000001',1,'HeyGen claim fixture v1','draft');
insert into public.course_blocks(id,course_version_id,organization_id,block_type,sort_order,title,body,video_url)
select ('db700000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
 'db700000-0000-4000-8000-000000000211','db700000-0000-4000-8000-000000000001',
 'video',n,'Video ' || n,jsonb_build_object('script','Original narration','editorNote','Keep this note'),
 'https://example.invalid/previous-video.mp4'
from generate_series(301,310) n;

create function pg_temp.heygen_actor(p_user uuid default 'db700000-0000-4000-8000-000000000011',
 p_session uuid default 'db700000-0000-4000-8000-000000000101',p_aal text default 'aal2')
returns void language plpgsql as $$
begin
 reset role;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_user,'role','authenticated',
   'session_id',p_session,'aal',p_aal,'iat',extract(epoch from now())::bigint)::text,true);
 set local role authenticated;
end;
$$;
create function pg_temp.heygen_service() returns void language plpgsql as $$
begin
 reset role;
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 set local role service_role;
end;
$$;
create temporary table heygen_claim_test_state(key text primary key,value jsonb);
grant all on heygen_claim_test_state to authenticated,service_role;

create function pg_temp.heygen_claim(p_key text,p_block integer,p_request integer,
 p_payload jsonb default '{"type":"avatar","avatar_id":"avatar_test","voice_id":"voice_test","script":"Original narration","title":"Claim test"}')
returns void language plpgsql as $$
begin
 insert into heygen_claim_test_state(key,value) values(p_key,public.claim_course_video_generation(
  ('db700000-0000-4000-8000-' || lpad(p_block::text,12,'0'))::uuid,
  ('db700000-0000-4000-8000-' || lpad(p_request::text,12,'0'))::uuid,
  p_payload,true,'https://example.invalid/previous-video.mp4'))
 on conflict(key) do update set value=excluded.value;
end;
$$;
create function pg_temp.heygen_finish(p_key text,p_outcome text,p_video text default null)
returns jsonb language plpgsql as $$
declare v jsonb;
begin
 select value into v from heygen_claim_test_state where key=p_key;
 return public.finish_course_video_submission((v->>'attempt_id')::uuid,(v->>'lease_id')::uuid,p_outcome,p_video,null);
end;
$$;

select ok(not has_function_privilege('anon','public.claim_course_video_generation(uuid,uuid,jsonb,boolean,text,uuid)','execute'),
 'anonymous callers cannot reserve a billed job');
select ok(has_function_privilege('authenticated','public.claim_course_video_generation(uuid,uuid,jsonb,boolean,text,uuid)','execute'),
 'authenticated callers reach the claim RPC authorization checks');
select ok(not has_function_privilege('authenticated','public.finish_course_video_submission(uuid,uuid,text,text,text)','execute'),
 'a browser cannot assert that the provider accepted a paid request');
select ok(not has_function_privilege('authenticated','public.resolve_course_video_generation(uuid,text,uuid,jsonb,text,text,text)','execute'),
 'a browser cannot mark an unrendered video completed');
select ok(has_function_privilege('service_role','public.resolve_course_video_generation(uuid,text,uuid,jsonb,text,text,text)','execute'),
 'the trusted polling worker may finalize an already-authorized render');
select ok(not has_table_privilege('authenticated','app_private.heygen_generation_attempts','insert,update,delete'),
 'a browser cannot release or replace a paid-generation claim');
select ok(not has_table_privilege('authenticated','app_private.heygen_generation_requests','insert,update,delete'),
 'a browser cannot rewrite durable request aliases');

select pg_temp.heygen_actor('db700000-0000-4000-8000-000000000013','db700000-0000-4000-8000-000000000103');
select throws_ok($$select pg_temp.heygen_claim('denied',301,501)$$,'42501',null,
 'an employee cannot start a paid job even with MFA');
select pg_temp.heygen_actor('db700000-0000-4000-8000-000000000011','db700000-0000-4000-8000-000000000101','aal1');
select throws_ok($$select pg_temp.heygen_claim('denied',301,501)$$,'42501',null,
 'password-only platform administration cannot start a paid job');
reset role;
insert into app_private.sms_mfa_accounts(profile_id) values ('db700000-0000-4000-8000-000000000014');
select pg_temp.heygen_actor('db700000-0000-4000-8000-000000000014','db700000-0000-4000-8000-000000000104','aal2');
select throws_ok($$select pg_temp.heygen_claim('denied',301,501)$$,'42501',null,
 'an SMS account cannot replace its missing SMS proof with an aal2 claim');
reset role;
select is((select count(*)::integer from app_private.heygen_generation_attempts),0,
 'failed authorization creates no paid-generation attempts');

-- A real server-side SMS proof, rather than a native AAL2 claim, authorizes the
-- opted-in administrator's exact session. These are test-only provider receipts.
insert into app_private.sms_mfa_factors(id,profile_id,phone) values
 ('db700000-0000-4000-8000-000000000701','db700000-0000-4000-8000-000000000014','+15555550701');
insert into app_private.sms_mfa_challenges(id,profile_id,session_id,phone,purpose,state,consumed_at) values
 ('db700000-0000-4000-8000-000000000702','db700000-0000-4000-8000-000000000014',
  'db700000-0000-4000-8000-000000000104','+15555550701','enroll','consumed',now());
insert into app_private.sms_mfa_session_assurance(session_id,profile_id,factor_id,challenge_id,expires_at) values
 ('db700000-0000-4000-8000-000000000104','db700000-0000-4000-8000-000000000014',
  'db700000-0000-4000-8000-000000000701','db700000-0000-4000-8000-000000000702',now()+interval '1 hour');
select pg_temp.heygen_actor('db700000-0000-4000-8000-000000000014','db700000-0000-4000-8000-000000000104','aal1');
select lives_ok($$select pg_temp.heygen_claim('sms-authorized',308,511)$$,
 'a verified SMS session can claim a paid job without a Supabase AAL2 token');
select is((select value->>'should_submit' from heygen_claim_test_state where key='sms-authorized'),'true',
 'verified SMS gives the same claim authority as native MFA');

select pg_temp.heygen_actor();
select throws_ok($$select public.claim_course_video_generation('db700000-0000-4000-8000-000000000309',
 'db700000-0000-4000-8000-000000000512',
 '{"type":"avatar","avatar_id":"avatar_test","voice_id":"voice_test","script":"Original narration","title":"Claim test"}',
 false,'https://example.invalid/previous-video.mp4')$$,'55000',null,
 'an existing usable video requires explicit replacement consent');
select throws_ok($$select public.claim_course_video_generation('db700000-0000-4000-8000-000000000309',
 'db700000-0000-4000-8000-000000000512',
 '{"type":"avatar","avatar_id":"avatar_test","voice_id":"voice_test","script":"Original narration","title":"Claim test"}',
 true,'https://example.invalid/a-stale-video.mp4')$$,'55000',null,
 'replacement consent cannot apply to a different current video');
select lives_ok($$select pg_temp.heygen_claim('first',301,501)$$,
 'a current authorized platform admin obtains the first claim');
select is((select value->>'should_submit' from heygen_claim_test_state where key='first'),'true',
 'the first claimant alone may call the provider');
select is((select video_url from public.course_blocks where id='db700000-0000-4000-8000-000000000301'),
 'https://example.invalid/previous-video.mp4','starting a replacement preserves the usable prior video');
select pg_temp.heygen_actor('db700000-0000-4000-8000-000000000012','db700000-0000-4000-8000-000000000102');
select lives_ok($$select pg_temp.heygen_claim('duplicate',301,502)$$,
 'a concurrent matching request attaches to the existing attempt');
select is((select value->>'attempt_id' from heygen_claim_test_state where key='duplicate'),
 (select value->>'attempt_id' from heygen_claim_test_state where key='first'),
 'two administrators cannot create separate matching provider jobs');
select is((select value->>'should_submit' from heygen_claim_test_state where key='duplicate'),'false',
 'the competing request cannot submit while the original lease is live');
select throws_ok($$select pg_temp.heygen_claim('changed-request',301,502,
 '{"type":"avatar","avatar_id":"avatar_test","voice_id":"voice_test","script":"Different narration","title":"Claim test"}')$$,
 null::char(5),null,'a replay cannot silently change its frozen narration');
select throws_ok($$select pg_temp.heygen_claim('changed-block',302,502)$$,
 null::char(5),null,'the same request ID cannot be reused for another block');

select pg_temp.heygen_service();
select lives_ok($$select pg_temp.heygen_finish('first','unknown')$$,
 'a transport timeout records an unknown provider result without releasing the attempt');
reset role;
update app_private.heygen_generation_attempts set lease_until=now()-interval '1 second'
 where id=(select (value->>'attempt_id')::uuid from heygen_claim_test_state where key='first');
select pg_temp.heygen_actor();
select lives_ok($$select pg_temp.heygen_claim('retry',301,503)$$,
 'a retry may reclaim a timed-out provider submission inside the idempotency window');
select is((select value->>'attempt_id' from heygen_claim_test_state where key='retry'),
 (select value->>'attempt_id' from heygen_claim_test_state where key='first'),
 'timeout recovery preserves the original provider idempotency key');
select is((select value->'payload' from heygen_claim_test_state where key='retry'),
 (select value->'payload' from heygen_claim_test_state where key='first'),
 'timeout recovery sends the identical frozen provider payload');
select isnt((select value->>'lease_id' from heygen_claim_test_state where key='retry'),
 (select value->>'lease_id' from heygen_claim_test_state where key='first'),
 'reclaiming creates a fresh lease token');
select pg_temp.heygen_service();
select throws_ok($$select pg_temp.heygen_finish('first','failed')$$,'55000',null,
 'a superseded lease is rejected when it tries to finish');
reset role;
select isnt((select state from app_private.heygen_generation_attempts
 where id=(select (value->>'attempt_id')::uuid from heygen_claim_test_state where key='retry')),'failed',
 'a superseded lease cannot fail the newly claimed submission');
select pg_temp.heygen_service();
select lives_ok($$select pg_temp.heygen_finish('retry','accepted','video_claim_301')$$,
 'the current lease records provider acceptance');
reset role;
select is((select body->'heygen'->>'video_id' from public.course_blocks
 where id='db700000-0000-4000-8000-000000000301'),'video_claim_301',
 'provider acceptance records the job on the intended course block');
insert into heygen_claim_test_state(key,value)
select 'source301',source_snapshot from app_private.heygen_generation_attempts
where id=(select (value->>'attempt_id')::uuid from heygen_claim_test_state where key='retry');
select pg_temp.heygen_service();
select lives_ok($$select public.resolve_course_video_generation('db700000-0000-4000-8000-000000000301',
 'video_claim_301',(select (value->>'attempt_id')::uuid from heygen_claim_test_state where key='retry'),
 (select value from heygen_claim_test_state where key='source301'),'completed',
 'storage://course-videos/db700000-0000-4000-8000-000000000001/db700000-0000-4000-8000-000000000301.video_claim_301.mp4',null)$$,
 'the matching completed render atomically replaces its video');
reset role;
select is((select body->>'editorNote' from public.course_blocks
 where id='db700000-0000-4000-8000-000000000301'),'Keep this note',
 'completion preserves sibling authoring data');
select is((select body->'heygen'->>'status' from public.course_blocks
 where id='db700000-0000-4000-8000-000000000301'),'completed','completion is persisted on the block');
select pg_temp.heygen_service();
select public.resolve_course_video_generation('db700000-0000-4000-8000-000000000301','video_claim_301',
 (select (value->>'attempt_id')::uuid from heygen_claim_test_state where key='retry'),
 (select value from heygen_claim_test_state where key='source301'),'processing',null,null);
reset role;
select is((select body->'heygen'->>'status' from public.course_blocks
 where id='db700000-0000-4000-8000-000000000301'),'completed',
 'a late polling response cannot regress completed work to processing');

-- A later deliberate replacement receives a new identity. An older poll can no
-- longer overwrite either that identity or the usable video retained during it.
select pg_temp.heygen_actor();
insert into heygen_claim_test_state(key,value) values('replacement',public.claim_course_video_generation(
 'db700000-0000-4000-8000-000000000301','db700000-0000-4000-8000-000000000513',
 '{"type":"avatar","avatar_id":"avatar_test","voice_id":"voice_test","script":"Original narration","title":"Claim test"}',
 true,'storage://course-videos/db700000-0000-4000-8000-000000000001/db700000-0000-4000-8000-000000000301.video_claim_301.mp4'));
select isnt((select value->>'attempt_id' from heygen_claim_test_state where key='replacement'),
 (select value->>'attempt_id' from heygen_claim_test_state where key='first'),
 'an explicit later replacement starts a distinct attempt');
select pg_temp.heygen_service();
select pg_temp.heygen_finish('replacement','accepted','video_claim_301b');
select public.resolve_course_video_generation('db700000-0000-4000-8000-000000000301','video_claim_301',
 (select (value->>'attempt_id')::uuid from heygen_claim_test_state where key='first'),
 (select value from heygen_claim_test_state where key='source301'),'completed',
 'storage://course-videos/db700000-0000-4000-8000-000000000001/db700000-0000-4000-8000-000000000301.video_claim_301.mp4',null);
reset role;
select is((select body->'heygen'->>'video_id' from public.course_blocks
 where id='db700000-0000-4000-8000-000000000301'),'video_claim_301b',
 'an old completion cannot overwrite a newer provider job ID');
select is((select body->'heygen'->>'status' from public.course_blocks
 where id='db700000-0000-4000-8000-000000000301'),'processing',
 'an old completion cannot complete the new attempt');
insert into heygen_claim_test_state(key,value)
select 'source301b',source_snapshot from app_private.heygen_generation_attempts
where id=(select (value->>'attempt_id')::uuid from heygen_claim_test_state where key='replacement');
select pg_temp.heygen_service();
select throws_ok($$select public.resolve_course_video_generation('db700000-0000-4000-8000-000000000301',
 'video_claim_301b',(select (value->>'attempt_id')::uuid from heygen_claim_test_state where key='replacement'),
 (select value from heygen_claim_test_state where key='source301b'),'completed',
 'storage://course-videos/db700000-0000-4000-8000-000000000001/db700000-0000-4000-8000-000000000301.video_claim_301.mp4',null)$$,
 '22023',null,'a new attempt cannot reuse the storage object of the old video');
select public.resolve_course_video_generation('db700000-0000-4000-8000-000000000301','video_claim_301b',
 (select (value->>'attempt_id')::uuid from heygen_claim_test_state where key='replacement'),
 (select value from heygen_claim_test_state where key='source301b'),'completed',
 'storage://course-videos/db700000-0000-4000-8000-000000000001/db700000-0000-4000-8000-000000000301.video_claim_301b.mp4',null);
select pg_temp.heygen_actor();
select pg_temp.heygen_claim('original-replay',301,502);
select is((select value->>'attempt_id' from heygen_claim_test_state where key='original-replay'),
 (select value->>'attempt_id' from heygen_claim_test_state where key='first'),
 'an old request alias still replays its original attempt after a later replacement');
select is((select value->>'should_submit' from heygen_claim_test_state where key='original-replay'),'false',
 'replaying an old successful request cannot create a third paid render');

-- An unknown request beyond the provider's replay window must remain blocked.
select pg_temp.heygen_actor();
select pg_temp.heygen_claim('expired',302,504);
select pg_temp.heygen_service();
select pg_temp.heygen_finish('expired','unknown');
reset role;
update app_private.heygen_generation_attempts
 set first_submitted_at=now()-interval '24 hours',lease_until=now()-interval '1 hour'
 where id=(select (value->>'attempt_id')::uuid from heygen_claim_test_state where key='expired');
select pg_temp.heygen_actor();
select lives_ok($$select pg_temp.heygen_claim('expired-retry',302,505)$$,
 'an expired unknown request returns its reconciliation state');
select is((select value->>'should_submit' from heygen_claim_test_state where key='expired-retry'),'false',
 'no provider request is made outside the safe idempotency window');
select is((select value->>'state' from heygen_claim_test_state where key='expired-retry'),'reconciliation_required',
 'an unknown charge requires reconciliation instead of creating another job');

-- Authoring after a paid request starts must win over its eventual response.
select pg_temp.heygen_claim('edited',303,506);
select pg_temp.heygen_service();
select pg_temp.heygen_finish('edited','accepted','video_claim_303');
reset role;
insert into heygen_claim_test_state(key,value)
select 'source303',source_snapshot from app_private.heygen_generation_attempts
where id=(select (value->>'attempt_id')::uuid from heygen_claim_test_state where key='edited');
update public.course_blocks set body=jsonb_set(body,'{script}','"Revised narration"')
where id='db700000-0000-4000-8000-000000000303';
select pg_temp.heygen_service();
select public.resolve_course_video_generation('db700000-0000-4000-8000-000000000303','video_claim_303',
 (select (value->>'attempt_id')::uuid from heygen_claim_test_state where key='edited'),
 (select value from heygen_claim_test_state where key='source303'),'completed',
 'storage://course-videos/db700000-0000-4000-8000-000000000001/db700000-0000-4000-8000-000000000303.video_claim_303.mp4',null);
reset role;
select is((select body->>'script' from public.course_blocks
 where id='db700000-0000-4000-8000-000000000303'),'Revised narration',
 'an older provider response cannot restore stale narration');
select is((select video_url from public.course_blocks where id='db700000-0000-4000-8000-000000000303'),
 'https://example.invalid/previous-video.mp4','a render for superseded narration cannot replace the video');

-- A copied block must not inherit another block's canonical request identity.
update public.course_blocks set body=(select body from public.course_blocks
 where id='db700000-0000-4000-8000-000000000301') where id='db700000-0000-4000-8000-000000000304';
select pg_temp.heygen_actor();
select lives_ok($$select pg_temp.heygen_claim('copied',304,507)$$,
 'a cloned block obtains its own attempt despite copied terminal HeyGen metadata');
select isnt((select value->>'attempt_id' from heygen_claim_test_state where key='copied'),
 (select value->>'attempt_id' from heygen_claim_test_state where key='first'),
 'generation attempts stay bound to their original blocks');

-- Publication may follow an accepted request; its already-authorized result still
-- needs to finish through the trusted writer without reopening ordinary editing.
select pg_temp.heygen_claim('published',305,508);
select pg_temp.heygen_service();
select pg_temp.heygen_finish('published','accepted','video_claim_305');
reset role;
insert into heygen_claim_test_state(key,value)
select 'source305',source_snapshot from app_private.heygen_generation_attempts
where id=(select (value->>'attempt_id')::uuid from heygen_claim_test_state where key='published');
select set_config('app.privileged_write','on',true);
update public.course_versions set status='published',published_at=now()
where id='db700000-0000-4000-8000-000000000211';
select set_config('app.privileged_write','off',true);
select pg_temp.heygen_actor();
select throws_ok($$select pg_temp.heygen_claim('late-new',306,509)$$,'55000',null,
 'a new paid generation cannot begin after the version is published');
select throws_ok($$update public.course_blocks set title='Unauthorized published edit'
 where id='db700000-0000-4000-8000-000000000305'$$,'0A000',null,
 'ordinary platform-admin writes remain blocked on published course blocks');
select pg_temp.heygen_service();
select lives_ok($$select public.resolve_course_video_generation('db700000-0000-4000-8000-000000000305',
 'video_claim_305',(select (value->>'attempt_id')::uuid from heygen_claim_test_state where key='published'),
 (select value from heygen_claim_test_state where key='source305'),'completed',
 'storage://course-videos/db700000-0000-4000-8000-000000000001/db700000-0000-4000-8000-000000000305.video_claim_305.mp4',null)$$,
 'a valid in-flight render can finish after its course version is published');
reset role;
select is((select body->'heygen'->>'status' from public.course_blocks
 where id='db700000-0000-4000-8000-000000000305'),'completed',
 'published finalization persists through the narrowly trusted writer');

select * from finish();
rollback;
