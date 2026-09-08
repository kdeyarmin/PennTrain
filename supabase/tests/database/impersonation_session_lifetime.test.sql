begin;
select plan(35);

insert into public.organizations(id,name,slug,subscription_status)
values ('d9000000-0000-4000-8000-000000000001','Lifetime Test','impersonation-lifetime-test','active');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,
  email_change_token_new,email_change,email_change_token_current,reauthentication_token,is_sso_user,is_anonymous)
select '00000000-0000-0000-0000-000000000000',id,'authenticated','authenticated',email,'x',now(),
  '{}','{}',now(),now(),'','','','','','',false,false
from (values
 ('d9000000-0000-4000-8000-000000000011'::uuid,'lifetime-actor@test.local'),
 ('d9000000-0000-4000-8000-000000000012'::uuid,'lifetime-target@test.local'),
 ('d9000000-0000-4000-8000-000000000013'::uuid,'lifetime-other@test.local')
) u(id,email);
select set_config('app.privileged_write','on',true);
insert into public.profiles(id,organization_id,email,first_name,last_name,role,is_active)
select id,case when id='d9000000-0000-4000-8000-000000000011' then null else 'd9000000-0000-4000-8000-000000000001'::uuid end,
 email,'Lifetime','Test',case when id='d9000000-0000-4000-8000-000000000011' then 'platform_admin' else 'employee' end,true
from auth.users where id in ('d9000000-0000-4000-8000-000000000011','d9000000-0000-4000-8000-000000000012','d9000000-0000-4000-8000-000000000013')
on conflict(id) do update set organization_id=excluded.organization_id,role=excluded.role,is_active=true;
select set_config('app.privileged_write','off',true);
insert into auth.sessions(id,user_id,created_at,updated_at,aal,not_after) values
 ('d9000000-0000-4000-8000-000000000021','d9000000-0000-4000-8000-000000000012',now(),now(),'aal1',null),
 ('d9000000-0000-4000-8000-000000000022','d9000000-0000-4000-8000-000000000012',now(),now(),'aal1',now()+interval '5 minutes'),
 ('d9000000-0000-4000-8000-000000000023','d9000000-0000-4000-8000-000000000013',now(),now(),'aal1',null);
insert into public.session_lock_events(profile_id,organization_id,route_path,lock_reason,locked_at,unlocked_at,session_id)
values ('d9000000-0000-4000-8000-000000000012','d9000000-0000-4000-8000-000000000001','/app','manual',now(),now(),'d9000000-0000-4000-8000-000000000021');

select set_config('request.jwt.claims','{"sub":"d9000000-0000-4000-8000-000000000012","role":"authenticated","session_id":"d9000000-0000-4000-8000-000000000021"}',true);
set local role authenticated;
select is(public.current_impersonation_session_live(),true,'ordinary authentication remains live');
select lives_ok($$select public.enforce_request_impersonation_lifetime()$$,'ordinary requests pass the guard');
reset role;

insert into public.impersonation_sessions(id,actor_profile_id,target_profile_id,target_organization_id,context_secret_sha256,reason,expires_at)
select id,'d9000000-0000-4000-8000-000000000011','d9000000-0000-4000-8000-000000000012',
 'd9000000-0000-4000-8000-000000000001',repeat('a',64),'Lifetime test',now()+interval '30 minutes'
from (values ('d9000000-0000-4000-8000-000000000031'::uuid),('d9000000-0000-4000-8000-000000000032'::uuid),('d9000000-0000-4000-8000-000000000033'::uuid)) i(id);
update public.impersonation_sessions set target_session_id='d9000000-0000-4000-8000-000000000021'
where id='d9000000-0000-4000-8000-000000000031';
select is((select s.not_after=i.expires_at and i.bound_at is not null from auth.sessions s
 join public.impersonation_sessions i on i.target_session_id=s.id::text
 where i.id='d9000000-0000-4000-8000-000000000031'),true,'bind caps refresh lifetime and stamps bound time');
update public.impersonation_sessions set target_session_id='d9000000-0000-4000-8000-000000000022'
where id='d9000000-0000-4000-8000-000000000032';
select is((select not_after=now()+interval '5 minutes' from auth.sessions where id='d9000000-0000-4000-8000-000000000022'),true,'bind preserves an earlier Auth deadline');
select throws_ok($$update public.impersonation_sessions set target_session_id='d9000000-0000-4000-8000-000000000023' where id='d9000000-0000-4000-8000-000000000033'$$,
 '42501','Impersonation Auth session belongs to another user','another users Auth session cannot be bound');
select throws_ok($$update public.impersonation_sessions set target_session_id='d9000000-0000-4000-8000-000000000099' where id='d9000000-0000-4000-8000-000000000033'$$,
 '42501','Impersonation Auth session does not exist','a nonexistent Auth session cannot be bound');
select throws_ok($$update public.impersonation_sessions set expires_at=expires_at+interval '1 hour' where id='d9000000-0000-4000-8000-000000000031'$$,
 '42501','A bound impersonation lifetime cannot be extended','a bound window cannot be extended');
select throws_ok($$update public.impersonation_sessions set target_session_id=null where id='d9000000-0000-4000-8000-000000000031'$$,
 '42501','A bound impersonation identity cannot be reassigned','a bound context cannot be unbound');
set local role authenticated;
select is(public.current_impersonation_session_live(),true,'a valid bound context remains live');
select is(public.current_session_unlocked(),true,'valid impersonation preserves unlocked access');
select is((select count(*)::int from public.session_lock_events where session_id='d9000000-0000-4000-8000-000000000021'),1,'valid impersonation can read its direct-owner rows without RLS recursion');
reset role;

-- Losing platform authority immediately ends the borrowed access without blocking cleanup.
select set_config('app.privileged_write','on',true);
update public.profiles set is_active=false where id='d9000000-0000-4000-8000-000000000011';
set local role authenticated;
select is(public.current_impersonation_session_live(),false,'a deactivated actor loses borrowed access immediately');
reset role;
update public.profiles set is_active=true,role='org_admin',organization_id='d9000000-0000-4000-8000-000000000001' where id='d9000000-0000-4000-8000-000000000011';
set local role authenticated;
select is(public.current_impersonation_session_live(),false,'a demoted actor loses borrowed access immediately');
reset role;
update public.profiles set role='platform_admin',organization_id=null where id='d9000000-0000-4000-8000-000000000011';
select set_config('app.privileged_write','off',true);
set local role authenticated;
select is(public.current_impersonation_session_live(),true,'an active platform actor retains a valid bounded session');
reset role;

-- Expire the context while its JWT would otherwise remain valid.
update public.impersonation_sessions set expires_at=now()-interval '1 second' where id='d9000000-0000-4000-8000-000000000031';
set local role authenticated;
select is(public.current_impersonation_session_live(),false,'expired context refuses an existing JWT');
select is(public.current_session_unlocked(),false,'expiry denies shared authorization helpers');
select is((select count(*)::int from public.session_lock_events where session_id='d9000000-0000-4000-8000-000000000021'),0,'restrictive RLS also denies direct owner policies');
select throws_ok($$select public.enforce_request_impersonation_lifetime()$$,'42501','The impersonation session has expired or ended','pre-request guard blocks SECURITY DEFINER RPC entry');
select set_config('request.jwt.claims','{"sub":"d9000000-0000-4000-8000-000000000012","role":"authenticated","session_id":"d9000000-0000-4000-8000-000000000021","user_metadata":{"role":"service_role","session_id":"ordinary","impersonation_expires_at":"2099-01-01"}}',true);
select is(public.current_impersonation_session_live(),false,'user-editable metadata cannot bypass expiry');
reset role;
select set_config('request.jwt.claims','{"sub":"d9000000-0000-4000-8000-000000000013","role":"authenticated","session_id":"d9000000-0000-4000-8000-000000000022"}',true);
set local role authenticated;
select is(public.current_impersonation_session_live(),false,'context target must match the signed user identity');
reset role;

select set_config('request.jwt.claims','{"sub":"d9000000-0000-4000-8000-000000000012","role":"authenticated","session_id":"d9000000-0000-4000-8000-000000000022"}',true);
update public.impersonation_sessions set ended_at=now() where id='d9000000-0000-4000-8000-000000000032';
set local role authenticated;
select is(public.current_impersonation_session_live(),false,'ended contexts refuse existing JWTs');
reset role;
select is((select not_after<=now() from auth.sessions where id='d9000000-0000-4000-8000-000000000022'),true,'ending caps the refresh deadline immediately');
select throws_ok($$update public.impersonation_sessions set ended_at=null where id='d9000000-0000-4000-8000-000000000032'$$,
 '42501','An ended impersonation cannot be reopened','an ended context stays ended');
delete from auth.sessions where id='d9000000-0000-4000-8000-000000000021';
select lives_ok($$update public.impersonation_sessions set ended_at=now() where id='d9000000-0000-4000-8000-000000000031'$$,'late end can finalize after Auth sign-out deleted its session');

update public.impersonation_sessions set target_profile_id='d9000000-0000-4000-8000-000000000013', expires_at=now()-interval '1 second'
where id='d9000000-0000-4000-8000-000000000033';
select throws_ok($$update public.impersonation_sessions set target_session_id='d9000000-0000-4000-8000-000000000023' where id='d9000000-0000-4000-8000-000000000033'$$,
 '42501','Impersonation context is expired or ended','an expired unbound context cannot claim a session');
update public.impersonation_sessions set expires_at=now()+interval '30 minutes' where id='d9000000-0000-4000-8000-000000000033';
update auth.sessions set not_after=now()-interval '1 second' where id='d9000000-0000-4000-8000-000000000023';
select throws_ok($$update public.impersonation_sessions set target_session_id='d9000000-0000-4000-8000-000000000023' where id='d9000000-0000-4000-8000-000000000033'$$,
 '42501','Impersonation Auth session is expired','a live context cannot revive an expired Auth session');
update auth.sessions set not_after=null where id='d9000000-0000-4000-8000-000000000023';
update public.impersonation_sessions set target_session_id='d9000000-0000-4000-8000-000000000023' where id='d9000000-0000-4000-8000-000000000033';
delete from auth.sessions where id='d9000000-0000-4000-8000-000000000023';
select set_config('request.jwt.claims','{"sub":"d9000000-0000-4000-8000-000000000013","role":"authenticated","session_id":"d9000000-0000-4000-8000-000000000023"}',true);
set local role authenticated;
select is(public.current_impersonation_session_live(),false,'deleting an Auth session revokes its still-live bound context');
reset role;

select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select is(public.current_impersonation_session_live(),true,'service role without impersonation remains unaffected');
select lives_ok($$select public.enforce_request_impersonation_lifetime()$$,'service worker requests remain available');
reset role;
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select lives_ok($$select public.enforce_request_impersonation_lifetime()$$,'anonymous public routes remain available');
reset role;
select is(has_function_privilege('anon','public.current_impersonation_session_live()','execute'),false,'anonymous callers cannot query the lifecycle helper');
select ok((select count(*) from pg_policies where schemaname='public' and tablename='session_lock_events' and policyname='impersonation_session_lifetime' and permissive='RESTRICTIVE')=1,'lifetime restriction supplements existing policies');
select is((select split_part(setting,'=',2) from pg_db_role_setting cfg cross join lateral unnest(cfg.setconfig) setting
 where cfg.setrole=(select oid from pg_roles where rolname='authenticator') and cfg.setdatabase=0 and setting like 'pgrst.db_pre_request=%'),
 'public.enforce_request_impersonation_lifetime','PostgREST invokes the request guard');
select is((select count(*)::integer from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where c.relrowsecurity and c.relkind in ('r','p')
 and (n.nspname='public' or (n.nspname='storage' and c.relname='objects'))
 and not exists (select 1 from pg_policy p where p.polrelid=c.oid
   and p.polname='impersonation_session_lifetime' and not p.polpermissive)),0,
 'every current public and object-storage RLS table enforces the impersonation lifetime');
select is((select prosecdef from pg_proc where oid='public.enforce_request_impersonation_lifetime()'::regprocedure),false,
 'the public request guard needs no elevated owner privileges');
select * from finish();
rollback;
