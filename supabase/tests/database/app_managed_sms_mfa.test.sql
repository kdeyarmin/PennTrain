begin;
select no_plan();

-- Invoke the request hook anonymously first so a warmed privileged plan cannot hide a grant bug.
select set_config('request.jwt.claims','{"role":"anon"}',true);
select set_config('request.path','/rpc/sms_mfa_test_definer_probe',true);
select set_config('request.method','POST',true);
set local role anon;
select lives_ok($$select public.enforce_request_impersonation_lifetime()$$,
 'anonymous requests still reach their existing grants and policies');
reset role;
select set_config('request.jwt.claims','{}',true);

-- All identities, destinations and Verify SIDs in this transaction are synthetic. No SMS is sent.
insert into public.organizations(id,name,slug,subscription_status)
values ('da000000-0000-4000-8000-000000000001','SMS MFA Test','sms-mfa-test','active');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,
  email_change_token_new,email_change,email_change_token_current,reauthentication_token,is_sso_user,is_anonymous)
select '00000000-0000-0000-0000-000000000000',id,'authenticated','authenticated',email,'x',now(),
  '{}','{}',now(),now(),'','','','','','',false,false
from (values
 ('da000000-0000-4000-8000-000000000011'::uuid,'sms-admin@test.local'),
 ('da000000-0000-4000-8000-000000000012'::uuid,'sms-other@test.local'),
 ('da000000-0000-4000-8000-000000000013'::uuid,'sms-native@test.local')
) u(id,email);
select set_config('app.privileged_write','on',true);
insert into public.profiles(id,organization_id,email,first_name,last_name,role,is_active)
select id,'da000000-0000-4000-8000-000000000001',email,'SMS','Test','org_admin',true
from auth.users where id in ('da000000-0000-4000-8000-000000000011','da000000-0000-4000-8000-000000000012','da000000-0000-4000-8000-000000000013')
on conflict(id) do update set organization_id=excluded.organization_id,role=excluded.role,is_active=true;
select set_config('app.privileged_write','off',true);
insert into auth.sessions(id,user_id,created_at,updated_at,aal,not_after) values
 ('da000000-0000-4000-8000-000000000101','da000000-0000-4000-8000-000000000011',now(),now(),'aal1',null),
 ('da000000-0000-4000-8000-000000000102','da000000-0000-4000-8000-000000000011',now(),now(),'aal1',null),
 ('da000000-0000-4000-8000-000000000103','da000000-0000-4000-8000-000000000012',now(),now(),'aal1',null),
 ('da000000-0000-4000-8000-000000000104','da000000-0000-4000-8000-000000000011',now()-interval '9 hours',now(),'aal1',null),
 ('da000000-0000-4000-8000-000000000105','da000000-0000-4000-8000-000000000013',now(),now(),'aal2',null),
 ('da000000-0000-4000-8000-000000000106','da000000-0000-4000-8000-000000000011',now(),now(),'aal1',null),
 ('da000000-0000-4000-8000-000000000107','da000000-0000-4000-8000-000000000011',now(),now(),'aal1',now()-interval '1 second');
insert into auth.mfa_amr_claims(id,session_id,authentication_method,created_at,updated_at)
select gen_random_uuid(),id,'password',created_at,created_at from auth.sessions
where id in ('da000000-0000-4000-8000-000000000101','da000000-0000-4000-8000-000000000102',
 'da000000-0000-4000-8000-000000000103','da000000-0000-4000-8000-000000000104',
 'da000000-0000-4000-8000-000000000105','da000000-0000-4000-8000-000000000107');
insert into auth.mfa_amr_claims(id,session_id,authentication_method,created_at,updated_at)
values (gen_random_uuid(),'da000000-0000-4000-8000-000000000106','recovery',now(),now());
insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,secret,created_at,updated_at)
values ('da000000-0000-4000-8000-000000000201','da000000-0000-4000-8000-000000000013','Test authenticator','totp','verified','synthetic-test-secret',now(),now());

create function pg_temp.sms_actor(p_user uuid,p_session uuid,p_aal text default 'aal1')
returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',p_user,'role','authenticated',
   'session_id',p_session,'aal',p_aal,'iat',extract(epoch from now())::bigint)::text,true);
$$;
create function pg_temp.sms_service() returns void language sql as $$
 select set_config('request.jwt.claims','{"role":"service_role"}',true);
$$;
create temporary table sms_test_state(key text primary key,value jsonb);
grant all on sms_test_state to authenticated,service_role;

-- Deliberately broad permissive policies prove the new restrictive floor cannot be bypassed
-- by a direct-owner policy or by another permissive grant. Everything rolls back with this test.
create policy sms_mfa_test_profile_access on public.profiles for all to authenticated using (true) with check (true);
create policy sms_mfa_test_lock_access on public.session_lock_events for all to authenticated using (true) with check (true);
create policy sms_mfa_test_object_access on storage.objects for all to authenticated using (true) with check (true);
insert into public.session_lock_events(id,profile_id,organization_id,route_path,lock_reason,locked_at,unlocked_at,session_id)
values ('da000000-0000-4000-8000-000000000301','da000000-0000-4000-8000-000000000011','da000000-0000-4000-8000-000000000001',
 '/me/courses','manual',now(),now(),'synthetic-closed-session');
insert into storage.buckets(id,name,"public") values ('sms-mfa-security-test','sms-mfa-security-test',false);
-- Storage's existing restrictive module policy rejects unclassified buckets. Classify this
-- rolled-back fixture so the verified-session assertion tests an otherwise-authorized object.
insert into app_private.product_module_storage_buckets(bucket_id,module_key)
values ('sms-mfa-security-test','core');
insert into storage.objects(id,bucket_id,name) values ('da000000-0000-4000-8000-000000000302','sms-mfa-security-test','protected-test-object.txt');
create function public.sms_mfa_test_definer_probe() returns integer language sql security definer set search_path='' as $$
 select count(*)::integer from public.profiles;
$$;
revoke all on function public.sms_mfa_test_definer_probe() from public;
grant execute on function public.sms_mfa_test_definer_probe() to authenticated;
create function pg_temp.sms_request(p_path text,p_method text) returns void language plpgsql as $$
begin
 perform set_config('request.path',p_path,true);
 perform set_config('request.method',p_method,true);
end;
$$;

-- Service-only mutations cannot be called directly with a browser JWT.
select ok(not has_function_privilege('authenticated','public.prepare_sms_mfa_challenge(uuid,uuid,text,boolean)','execute'),
 'a browser cannot choose its own SMS destination or claim native assurance through the service RPC');
select ok(not has_function_privilege('anon','public.complete_sms_mfa_check(uuid,uuid,uuid,uuid,boolean)','execute'),
 'anonymous callers cannot assert provider approval');
select ok(not has_function_privilege('authenticated','public.complete_sms_mfa_check(uuid,uuid,uuid,uuid,boolean)','execute'),
 'an authenticated caller cannot fabricate provider approval');

select ok(not has_table_privilege('authenticated','app_private.sms_mfa_factors','select,insert,update,delete'),
 'browsers cannot read phone numbers or rewrite enrolled factors');
select ok(not has_table_privilege('authenticated','app_private.sms_mfa_session_assurance','insert,update,delete'),
 'browsers cannot insert or extend their own assurance');
select ok(not has_table_privilege('anon','app_private.sms_mfa_challenges','select,insert,update,delete'),
 'anonymous callers cannot read or modify challenges');

-- Lifecycle and isolation assertions follow the same public RPCs the edge endpoint invokes.
create function pg_temp.sms_prepare(p_key text,p_user uuid,p_session uuid,p_phone text default null,p_native boolean default false)
returns void language plpgsql as $$
begin
 perform pg_temp.sms_service();
 insert into sms_test_state(key,value) values(p_key,
  public.prepare_sms_mfa_challenge(p_user,p_session,p_phone,p_native)
  || jsonb_build_object('userId',p_user,'sessionId',p_session))
 on conflict(key) do update set value=excluded.value;
end;
$$;
create function pg_temp.sms_activate(p_key text,p_sid text) returns void language plpgsql as $$
declare v jsonb;
begin
 perform pg_temp.sms_service(); select value into v from sms_test_state where key=p_key;
 perform public.activate_sms_mfa_challenge((v->>'userId')::uuid,(v->>'sessionId')::uuid,(v->>'challengeId')::uuid,p_sid);
end;
$$;
create function pg_temp.sms_reserve(p_key text) returns void language plpgsql as $$
declare v jsonb; a jsonb;
begin
 perform pg_temp.sms_service(); select value into v from sms_test_state where key=p_key;
 a:=public.reserve_sms_mfa_check((v->>'userId')::uuid,(v->>'sessionId')::uuid,(v->>'challengeId')::uuid);
 update sms_test_state set value=v||a where key=p_key;
end;
$$;
create function pg_temp.sms_complete(p_key text,p_approved boolean) returns jsonb language plpgsql as $$
declare v jsonb;
begin
 perform pg_temp.sms_service(); select value into v from sms_test_state where key=p_key;
 return public.complete_sms_mfa_check((v->>'userId')::uuid,(v->>'sessionId')::uuid,
  (v->>'challengeId')::uuid,(v->>'attemptId')::uuid,p_approved);
end;
$$;

select pg_temp.sms_actor('da000000-0000-4000-8000-000000000011','da000000-0000-4000-8000-000000000101');
set local role authenticated;
select is(public.get_my_mfa_status()->>'verified','false','fresh password alone is not MFA');
select is(public.identity_assurance_is_current('identity_admin'),false,'privileged operation remains denied before enrollment');
reset role;
select pg_temp.sms_actor('da000000-0000-4000-8000-000000000013','da000000-0000-4000-8000-000000000105','aal2');
set local role authenticated;
select is(public.get_my_mfa_status()->>'verified','true','existing native MFA remains usable without an SMS factor');
select is(public.identity_assurance_is_current('identity_admin'),true,'existing native MFA still authorizes privileged operations');
reset role;
select pg_temp.sms_service();
select throws_ok($$select public.prepare_sms_mfa_challenge('da000000-0000-4000-8000-000000000011','da000000-0000-4000-8000-000000000103','+15555550101')$$,
 '42501',null,'another user session cannot receive a challenge');
select throws_ok($$select public.prepare_sms_mfa_challenge('da000000-0000-4000-8000-000000000011','da000000-0000-4000-8000-000000000999','+15555550101')$$,
 '42501',null,'nonexistent or revoked Auth sessions cannot enroll');
select throws_ok($$select public.prepare_sms_mfa_challenge('da000000-0000-4000-8000-000000000011','da000000-0000-4000-8000-000000000107','+15555550101')$$,
 '42501',null,'expired Auth sessions cannot enroll');
select throws_ok($$select public.prepare_sms_mfa_challenge('da000000-0000-4000-8000-000000000011','da000000-0000-4000-8000-000000000106','+15555550101')$$,
 '42501',null,'email recovery does not establish first-factor password proof');
select throws_ok($$select public.prepare_sms_mfa_challenge('da000000-0000-4000-8000-000000000011','da000000-0000-4000-8000-000000000104','+15555550101')$$,
 '42501',null,'stale password sessions cannot enroll a number');
select throws_ok($$select public.prepare_sms_mfa_challenge('da000000-0000-4000-8000-000000000013','da000000-0000-4000-8000-000000000105','+15555550103',false)$$,
 '42501',null,'an account with native MFA must prove it before adding SMS');
select throws_ok($$select public.prepare_sms_mfa_challenge('da000000-0000-4000-8000-000000000011','da000000-0000-4000-8000-000000000101','15555550101')$$,
 '22023',null,'only normalized international destinations are accepted');

select lives_ok($$select pg_temp.sms_prepare('first','da000000-0000-4000-8000-000000000011','da000000-0000-4000-8000-000000000101','+15555550101')$$,
 'fresh password can begin first SMS enrollment');
select is((select count(*)::integer from app_private.sms_mfa_factors),0,'sending never enrolls a factor');
select throws_ok($$select pg_temp.sms_reserve('first')$$,'42501',null,'provider send must be recorded before checking a code');
select lives_ok($$select pg_temp.sms_activate('first','VE11111111111111111111111111111111')$$,'provider SID binds to the prepared challenge');
select throws_ok($$select pg_temp.sms_prepare('too-soon','da000000-0000-4000-8000-000000000011','da000000-0000-4000-8000-000000000101','+15555550101')$$,
 'P0001',null,'resends are throttled before a provider request');
select lives_ok($$select pg_temp.sms_reserve('first')$$,'one verification request claims the pending challenge');
select throws_ok($$select pg_temp.sms_reserve('first')$$,'42501',null,'concurrent code checks cannot share one challenge lease');
select is(pg_temp.sms_complete('first',false)->>'verified','false','an incorrect provider check grants nothing');
select is((select count(*)::integer from app_private.sms_mfa_session_assurance),0,'failed verification leaves no session proof');
update app_private.sms_mfa_challenges set last_sent_at=statement_timestamp()-interval '61 seconds';
insert into sms_test_state(key,value) select 'before-resend',value from sms_test_state where key='first';
select lives_ok($$select pg_temp.sms_prepare('resend','da000000-0000-4000-8000-000000000011','da000000-0000-4000-8000-000000000101','+15555550101')$$,
 'resending reuses the same pending local challenge');
select is((select value->>'challengeId' from sms_test_state where key='resend'),
 (select value->>'challengeId' from sms_test_state where key='first'),'resend preserves the challenge identity');
select is((select value->>'expiresAt' from sms_test_state where key='resend'),
 (select value->>'expiresAt' from sms_test_state where key='first'),'resend cannot extend the code expiry');
select is((select check_attempts from app_private.sms_mfa_challenges where id=(select (value->>'challengeId')::uuid from sms_test_state where key='first')),1,
 'resend cannot reset the code guessing budget');
select lives_ok($$select pg_temp.sms_activate('resend','VE11111111111111111111111111111111')$$,'a repeated pending Twilio SID safely reactivates its original challenge');
select pg_temp.sms_reserve('first');
select throws_ok($$select public.complete_sms_mfa_check('da000000-0000-4000-8000-000000000011','da000000-0000-4000-8000-000000000101',
 (select (value->>'challengeId')::uuid from sms_test_state where key='first'),'da000000-0000-4000-8000-000000000999',true)$$,
 '42501',null,'an unrelated attempt token cannot claim provider approval');
select is(pg_temp.sms_complete('first',true)->>'verified','true','provider approval enrolls and attests the exact session atomically');
select is((select count(*)::integer from app_private.sms_mfa_factors),1,'one verified factor is saved');
select is((select aal::text from auth.sessions where id='da000000-0000-4000-8000-000000000101'),'aal1','SMS never fabricates a Supabase AAL2 session');
select throws_ok($$select pg_temp.sms_complete('first',true)$$,'42501',null,'approved challenge cannot be consumed twice');
select throws_ok($$select pg_temp.sms_reserve('first')$$,'42501',null,'consumed challenge cannot be checked again');

select pg_temp.sms_actor('da000000-0000-4000-8000-000000000011','da000000-0000-4000-8000-000000000101');
set local role authenticated;
select is(public.get_my_mfa_status()->>'method','sms','session status identifies SMS accurately');
select is((select privileged_profiles_without_mfa from public.get_identity_control_plane()
 where organization_id='da000000-0000-4000-8000-000000000001'),1::bigint,
 'identity controls count SMS and native factors without false unenrolled warnings');
select is(public.get_my_mfa_status()->>'verified','true','the enrolled session sees its server proof');
select is(public.get_my_mfa_status()->>'accountAccessible','true','active account availability is visible independently of the MFA gate');
select is(public.identity_assurance_is_current('identity_admin'),true,'the server proof authorizes existing protected operations');
select is(public.current_session_unlocked(),true,'valid SMS proof opens the shared authorization helper');
select is((select count(*)::integer from public.profiles where id in ('da000000-0000-4000-8000-000000000011','da000000-0000-4000-8000-000000000012')),2,
 'verified SMS preserves otherwise-authorized profile reads');
select is((select count(*)::integer from public.session_lock_events where id='da000000-0000-4000-8000-000000000301'),1,
 'verified SMS preserves otherwise-authorized direct owner data reads');
select is((select count(*)::integer from storage.objects where id='da000000-0000-4000-8000-000000000302'),1,
 'verified SMS preserves otherwise-authorized storage metadata access');
select pg_temp.sms_request('/rpc/sms_mfa_test_definer_probe','POST');
select lives_ok($$select public.enforce_request_impersonation_lifetime(); select public.sms_mfa_test_definer_probe()$$,
 'verified SMS permits existing SECURITY DEFINER RPC entry');

select ok(public.get_my_mfa_status()::text not like '%15555550101%','account status only exposes a masked number');
reset role;
select pg_temp.sms_service();
select set_config('app.privileged_write','on',true);
update public.organizations set subscription_status='suspended' where id='da000000-0000-4000-8000-000000000001';
select set_config('app.privileged_write','off',true);
select pg_temp.sms_actor('da000000-0000-4000-8000-000000000011','da000000-0000-4000-8000-000000000101');
set local role authenticated;
select is(public.get_my_mfa_status()->>'accountAccessible','false','suspended SMS accounts can resolve their account restriction during bootstrap');
select is(public.get_my_mfa_status()->>'verified','false','suspended accounts cannot retain otherwise-valid SMS assurance');
reset role;
select pg_temp.sms_service();
select set_config('app.privileged_write','on',true);
update public.organizations set subscription_status='active' where id='da000000-0000-4000-8000-000000000001';
select set_config('app.privileged_write','off',true);
select pg_temp.sms_actor('da000000-0000-4000-8000-000000000011','da000000-0000-4000-8000-000000000102');
set local role authenticated;
select is(public.get_my_mfa_status()->>'verified','false','a second session cannot borrow the first session proof');
select is(public.identity_assurance_is_current('identity_admin'),false,'a second session cannot perform privileged operations');
select is(public.current_session_unlocked(),false,'unverified SMS closes shared role and organization helpers');
select is(public.get_my_mfa_policy()->>'required','true','bootstrap policy still requires MFA while shared role lookup is closed');
reset role;
drop policy sms_mfa_test_profile_access on public.profiles;
set local role authenticated;
select is((select count(*)::integer from public.profiles where id='da000000-0000-4000-8000-000000000011'),1,
 'the existing production profile policy supports self bootstrap without an extra permissive grant');
select is((select count(*)::integer from public.profiles where id='da000000-0000-4000-8000-000000000012'),0,
 'the existing production profile policy still hides peers while SMS is missing');
reset role;
create policy sms_mfa_test_profile_access on public.profiles for all to authenticated using (true) with check (true);
set local role authenticated;
select is((select count(*)::integer from public.profiles where id='da000000-0000-4000-8000-000000000011'),1,
 'login bootstrap can still read the caller own profile');
select is((select count(*)::integer from public.profiles where id='da000000-0000-4000-8000-000000000012'),0,
 'profile bootstrap never reveals other profiles without SMS');
with changed as (update public.profiles set first_name='Unauthorized change' where id='da000000-0000-4000-8000-000000000011' returning id)
select is((select count(*)::integer from changed),0,'profile bootstrap does not permit even self-profile updates');
select is((select count(*)::integer from public.session_lock_events where id='da000000-0000-4000-8000-000000000301'),0,
 'restrictive SMS policy blocks direct-owner reads despite a broad permissive policy');
select is((select count(*)::integer from storage.objects where id='da000000-0000-4000-8000-000000000302'),0,
 'restrictive SMS policy blocks storage reads despite a broad permissive policy');
select throws_ok($$insert into storage.objects(bucket_id,name) values ('sms-mfa-security-test','unauthorized.txt')$$,
 '42501',null,'restrictive SMS policy blocks storage writes');
select pg_temp.sms_request('/profiles','GET');
select lives_ok($$select public.enforce_request_impersonation_lifetime()$$,'GET profiles remains available for caller-only bootstrap');
select pg_temp.sms_request('/profiles','HEAD');
select lives_ok($$select public.enforce_request_impersonation_lifetime()$$,'HEAD profiles remains available for caller-only bootstrap');
select pg_temp.sms_request('/profiles','PATCH');
select throws_ok($$select public.enforce_request_impersonation_lifetime()$$,'42501',null,'profile bootstrap never admits write requests');
select pg_temp.sms_request('/rpc/get_my_mfa_status','POST');
select lives_ok($$select public.enforce_request_impersonation_lifetime(); select public.get_my_mfa_status()$$,
 'the exact SMS status RPC remains reachable before verification');
select pg_temp.sms_request('/rpc/get_my_mfa_policy','POST');
select lives_ok($$select public.enforce_request_impersonation_lifetime(); select public.get_my_mfa_policy()$$,
 'the exact MFA policy RPC remains reachable before verification');
select pg_temp.sms_request('/rpc/sms_mfa_test_definer_probe','POST');
select throws_ok($$select public.enforce_request_impersonation_lifetime(); select public.sms_mfa_test_definer_probe()$$,
 '42501',null,'the request hook denies arbitrary SECURITY DEFINER RPCs before their bodies run');
select pg_temp.sms_request('/rpc/get_my_mfa_status_untrusted','POST');
select throws_ok($$select public.enforce_request_impersonation_lifetime()$$,'42501',null,'RPC allowlist is exact rather than a name prefix');
select pg_temp.sms_request('','POST');
select throws_ok($$select public.enforce_request_impersonation_lifetime()$$,'42501',null,'an absent request path fails closed');
select pg_temp.sms_request('/session_lock_events','GET');
select throws_ok($$select public.enforce_request_impersonation_lifetime()$$,'42501',null,'other table endpoints require SMS before dispatch');

reset role;

-- An attacker may enroll a first native factor directly with Supabase at AAL1.
-- Such a native factor must never bypass an already-enrolled app SMS factor.
insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,secret,created_at,updated_at)
values ('da000000-0000-4000-8000-000000000202','da000000-0000-4000-8000-000000000011','Untrusted native factor','totp','verified','synthetic-test-secret',now(),now());
update auth.sessions set aal='aal2' where id='da000000-0000-4000-8000-000000000102';
select pg_temp.sms_actor('da000000-0000-4000-8000-000000000011','da000000-0000-4000-8000-000000000102','aal2');
set local role authenticated;
select is(public.get_my_mfa_status()->>'verified','false','native AAL2 cannot bypass an existing SMS factor');
select is(public.identity_assurance_is_current('identity_admin'),false,'privileged RPCs also enforce SMS precedence over native AAL2');
reset role;
select pg_temp.sms_service();
select throws_ok($$select public.prepare_sms_mfa_challenge('da000000-0000-4000-8000-000000000011','da000000-0000-4000-8000-000000000102','+15555550999',true)$$,
 '42501',null,'native AAL2 cannot replace someone else SMS factor');
select ok(to_regprocedure('public.remove_sms_mfa_factor(uuid,uuid,boolean)') is null,
 'self-service SMS removal cannot activate untrusted native factors');

-- The provider SID tombstone prevents reuse even by a different authenticated user.
select pg_temp.sms_prepare('other','da000000-0000-4000-8000-000000000012','da000000-0000-4000-8000-000000000103','+15555550102');
select throws_ok($$select pg_temp.sms_activate('other','VE11111111111111111111111111111111')$$,'42501',null,
 'a consumed provider SID cannot be reassigned to another challenge or user');
select pg_temp.sms_activate('other','VE22222222222222222222222222222222');
select throws_ok($$select public.reserve_sms_mfa_check('da000000-0000-4000-8000-000000000011','da000000-0000-4000-8000-000000000101',
 (select (value->>'challengeId')::uuid from sms_test_state where key='other'))$$,'42501',null,
 'a user cannot check another user challenge');
select pg_temp.sms_reserve('other');
update app_private.sms_mfa_challenges set attempt_expires_at=statement_timestamp()-interval '1 second'
where id=(select (value->>'challengeId')::uuid from sms_test_state where key='other');
select throws_ok($$select pg_temp.sms_complete('other',true)$$,'42501',null,'an expired check lease cannot grant assurance');
select pg_temp.sms_reserve('other');
update app_private.sms_mfa_challenges set expires_at=statement_timestamp()-interval '1 second'
where id=(select (value->>'challengeId')::uuid from sms_test_state where key='other');
select throws_ok($$select pg_temp.sms_complete('other',true)$$,'42501',null,'an expired challenge cannot grant assurance despite provider approval');

-- Idle locking retires old proof permanently; a new password plus its own SMS is required.
select pg_temp.sms_actor('da000000-0000-4000-8000-000000000011','da000000-0000-4000-8000-000000000101');
insert into sms_test_state(key,value) values('lock',jsonb_build_object('id',public.record_idle_session_lock('/me/courses','manual')));
select is((select count(*)::integer from app_private.sms_mfa_session_assurance where session_id='da000000-0000-4000-8000-000000000101'),0,
 'idle locking deletes the old session proof');
select is(public.get_my_mfa_status()->>'verified','false','locked sessions report no valid MFA');
select pg_temp.sms_actor('da000000-0000-4000-8000-000000000011','da000000-0000-4000-8000-000000000102','aal2');
set local role authenticated;
select throws_ok($$select public.record_idle_session_unlock((select (value->>'id')::uuid from sms_test_state where key='lock'))$$,
 '42501',null,'new password or native AAL2 alone cannot unlock an SMS account');
reset role;
update app_private.sms_mfa_challenges set last_sent_at=statement_timestamp()-interval '61 seconds'
where profile_id='da000000-0000-4000-8000-000000000011';
select pg_temp.sms_prepare('second','da000000-0000-4000-8000-000000000011','da000000-0000-4000-8000-000000000102');
select is((select value->>'phone' from sms_test_state where key='second'),'+15555550101','step-up sends only to the enrolled destination');
select pg_temp.sms_activate('second','VE33333333333333333333333333333333');
select pg_temp.sms_reserve('second');
select is(pg_temp.sms_complete('second',true)->>'verified','true','the new session can verify its own SMS challenge');
select pg_temp.sms_actor('da000000-0000-4000-8000-000000000011','da000000-0000-4000-8000-000000000102','aal2');
set local role authenticated;
select lives_ok($$select public.record_idle_session_unlock((select (value->>'id')::uuid from sms_test_state where key='lock'))$$,
 'new session SMS proof permits completing the existing idle lock');
reset role;
select pg_temp.sms_actor('da000000-0000-4000-8000-000000000011','da000000-0000-4000-8000-000000000101');
set local role authenticated;
select is(public.get_my_mfa_status()->>'verified','false','closing the old lock never resurrects its old SMS proof');
select is(public.identity_assurance_is_current('identity_admin'),false,'the old JWT stays denied after another session unlocks');
reset role;


-- A verified owner may replace the number; outstanding codes and old proofs are retired.
update app_private.sms_mfa_challenges set last_sent_at=statement_timestamp()-interval '61 seconds'
where profile_id='da000000-0000-4000-8000-000000000011';
select pg_temp.sms_prepare('stale-number','da000000-0000-4000-8000-000000000011','da000000-0000-4000-8000-000000000101');
select pg_temp.sms_activate('stale-number','VE44444444444444444444444444444444');
update app_private.sms_mfa_challenges set last_sent_at=statement_timestamp()-interval '61 seconds'
where profile_id='da000000-0000-4000-8000-000000000011';
select lives_ok($$select pg_temp.sms_prepare('replacement','da000000-0000-4000-8000-000000000011','da000000-0000-4000-8000-000000000102','+15555550199')$$,
 'fresh password plus existing SMS proof can begin replacing the number');
select pg_temp.sms_activate('replacement','VE55555555555555555555555555555555');
select pg_temp.sms_reserve('replacement');
select is(pg_temp.sms_complete('replacement',true)->>'verified','true','approved replacement atomically installs its new factor');
select is((select phone from app_private.sms_mfa_factors where profile_id='da000000-0000-4000-8000-000000000011'),'+15555550199',
 'future SMS challenges use the newly verified number');
select is((select state from app_private.sms_mfa_challenges where id=(select (value->>'challengeId')::uuid from sms_test_state where key='stale-number')),'canceled',
 'number replacement invalidates other sessions outstanding codes');
select throws_ok($$select pg_temp.sms_reserve('stale-number')$$,'42501',null,'old-number code cannot verify after replacement');
select is((select count(*)::integer from app_private.sms_mfa_session_assurance where profile_id='da000000-0000-4000-8000-000000000011'),1,
 'number replacement leaves only the newly attested session');

-- Assurance expiry and Auth revocation remain authoritative even for unexpired JWTs.
select pg_temp.sms_actor('da000000-0000-4000-8000-000000000011','da000000-0000-4000-8000-000000000102','aal2');
update app_private.sms_mfa_session_assurance set verified_at=statement_timestamp()-interval '2 minutes',expires_at=statement_timestamp()-interval '1 minute'
where session_id='da000000-0000-4000-8000-000000000102';
select is(public.get_my_mfa_status()->>'verified','false','expired app proof denies even a native AAL2 token');
select is(public.identity_assurance_is_current('identity_admin'),false,'expired proof closes sensitive RPC access');
update app_private.sms_mfa_session_assurance set verified_at=statement_timestamp(),expires_at=statement_timestamp()+interval '1 hour'
where session_id='da000000-0000-4000-8000-000000000102';
update auth.sessions set not_after=statement_timestamp()-interval '1 second' where id='da000000-0000-4000-8000-000000000102';
select is(public.get_my_mfa_status()->>'verified','false','Auth not_after caps an otherwise live proof');
update auth.sessions set not_after=null where id='da000000-0000-4000-8000-000000000102';
select is(public.get_my_mfa_status()->>'verified','true','a live Auth session and proof verify before revocation');
delete from auth.sessions where id='da000000-0000-4000-8000-000000000102';
select is((select count(*)::integer from app_private.sms_mfa_session_assurance where session_id='da000000-0000-4000-8000-000000000102'),0,
 'Auth session deletion immediately cascades to its SMS proof');
select is(public.identity_assurance_is_current('identity_admin'),false,'a revoked session JWT cannot use privileged operations');


-- SMS mode survives an administrator reset so untrusted native factors never become a back door.
select pg_temp.sms_service();
select throws_ok($$select public.reset_sms_mfa_factor('da000000-0000-4000-8000-000000000011','da000000-0000-4000-8000-000000000011','Reset synthetic MFA factor')$$,
 '42501',null,'administrators cannot use the reset path on their own account');
select throws_ok($$select public.reset_sms_mfa_factor('da000000-0000-4000-8000-000000000011','da000000-0000-4000-8000-000000000013','Reset synthetic MFA factor')$$,
 '42501',null,'ordinary organization administrators cannot reset another user SMS');
select set_config('app.privileged_write','on',true);
update public.profiles set role='platform_admin',organization_id=null where id='da000000-0000-4000-8000-000000000013';
select set_config('app.privileged_write','off',true);
select is(public.reset_sms_mfa_factor('da000000-0000-4000-8000-000000000011','da000000-0000-4000-8000-000000000013','Reset synthetic MFA factor'),1,
 'a separately authorized platform administrator can reset the lost SMS factor');
update auth.sessions set aal='aal2' where id='da000000-0000-4000-8000-000000000101';
select pg_temp.sms_actor('da000000-0000-4000-8000-000000000011','da000000-0000-4000-8000-000000000101','aal2');
select is(public.get_my_mfa_status()->>'smsRequired','true','administrator reset retains permanent SMS-mode selection');
select is(public.get_my_mfa_status()->>'verified','false','native AAL2 stays denied after administrator reset');
select is(public.get_my_mfa_status()->>'hasVerifiedFactor','false','untrusted native factors are not offered as recovery methods');
select is(public.identity_assurance_is_current('identity_admin'),false,'reset never turns an untrusted native JWT into privileged access');
-- Age completed attempts instead of sleeping; preserve each stored code lifetime constraint.
update app_private.sms_mfa_challenges set created_at=statement_timestamp()-interval '11 minutes',
 expires_at=statement_timestamp()-interval '1 minute',last_sent_at=statement_timestamp()-interval '11 minutes'
where profile_id='da000000-0000-4000-8000-000000000011';
select lives_ok($$select pg_temp.sms_prepare('reenroll','da000000-0000-4000-8000-000000000011','da000000-0000-4000-8000-000000000101','+15555550200')$$,
 'after authorized reset a recent password can enroll a replacement despite untrusted native factors');

-- Phone verification cannot be used from an impersonated session to enroll the target account.
select set_config('app.privileged_write','on',true);
insert into public.impersonation_sessions(actor_profile_id,target_profile_id,target_organization_id,target_session_id,context_secret_sha256,reason,expires_at)
values ('da000000-0000-4000-8000-000000000013','da000000-0000-4000-8000-000000000012','da000000-0000-4000-8000-000000000001',
 'da000000-0000-4000-8000-000000000103',repeat('b',64),'Synthetic SMS security test',now()+interval '20 minutes');
select set_config('app.privileged_write','off',true);
select pg_temp.sms_service();
select throws_ok($$select public.prepare_sms_mfa_challenge('da000000-0000-4000-8000-000000000012','da000000-0000-4000-8000-000000000103','+15555550102')$$,
 '42501',null,'an impersonator cannot enroll a second factor for the target');

-- The code guessing budget is per user, not resettable by creating new challenges.
insert into auth.sessions(id,user_id,created_at,updated_at,aal)
values ('da000000-0000-4000-8000-000000000108','da000000-0000-4000-8000-000000000012',now(),now(),'aal1');
insert into auth.mfa_amr_claims(id,session_id,authentication_method,created_at,updated_at)
values (gen_random_uuid(),'da000000-0000-4000-8000-000000000108','password',now(),now());
update app_private.sms_mfa_challenges set last_sent_at=statement_timestamp()-interval '61 seconds'
where profile_id='da000000-0000-4000-8000-000000000012';
select pg_temp.sms_prepare('budget','da000000-0000-4000-8000-000000000012','da000000-0000-4000-8000-000000000108','+15555550102');
select pg_temp.sms_activate('budget','VE66666666666666666666666666666666');
select pg_temp.sms_reserve('budget');
select pg_temp.sms_complete('budget',false);
select pg_temp.sms_reserve('budget');
select pg_temp.sms_complete('budget',false);
select pg_temp.sms_reserve('budget');
select pg_temp.sms_complete('budget',false);
select throws_ok($$select pg_temp.sms_reserve('budget')$$,'P0001',null,
 'five failed or expired checks across challenges exhaust the user guessing budget');

select pg_temp.sms_actor('da000000-0000-4000-8000-000000000013','da000000-0000-4000-8000-000000000105','aal2');
select is((select privileged_profiles_without_mfa from public.get_identity_control_plane()
 where organization_id='da000000-0000-4000-8000-000000000001'),2::bigint,
 'identity controls flag reset SMS accounts despite untrusted native factors');

select pg_temp.sms_service();
set local role service_role;
select lives_ok($$select public.enforce_request_impersonation_lifetime()$$,
 'service workers remain outside caller SMS enrollment requirements');
reset role;
select is((select count(*)::integer from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where c.relrowsecurity and c.relkind in ('r','p')
 and (n.nspname='public' or (n.nspname='storage' and c.relname='objects'))
 and not exists (select 1 from pg_policy p where p.polrelid=c.oid and not p.polpermissive
   and p.polname=case when n.nspname='public' and c.relname='profiles'
     then 'sms_mfa_bootstrap_profile' else 'sms_mfa_session_required' end)),0,
 'every existing public and storage RLS table receives the SMS requirement');
select is((select prosecdef from pg_proc where oid='public.enforce_request_impersonation_lifetime()'::regprocedure),false,
 'the combined public request hook remains an invoker wrapper');

select * from finish();
rollback;
