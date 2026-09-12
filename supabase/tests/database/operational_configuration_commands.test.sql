-- Only synthetic configuration and principals. All evidence is rolled back.
begin;
select no_plan();
create function pg_temp.cid(n integer) returns uuid language sql immutable as $$select ('acd00000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
  created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change,email_change_token_current,reauthentication_token,is_sso_user,is_anonymous)
select '00000000-0000-0000-0000-000000000000',pg_temp.cid(n),'authenticated','authenticated','configuration-'||n||'@test.local','x',now(),'{}','{}',now(),now(),'','','','','','',false,false from generate_series(1,3)n;
select set_config('app.privileged_write','on',true);
update public.profiles set role='platform_admin',is_active=true where id in(pg_temp.cid(1),pg_temp.cid(2));
update public.profiles set role='employee',is_active=true where id=pg_temp.cid(3);
select set_config('app.privileged_write','',true);
insert into public.organizations(id,name,slug) values(pg_temp.cid(10),'Configuration fixture organization','configuration-fixture');
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values(pg_temp.cid(100),pg_temp.cid(1),now()-interval '1 hour',now(),'aal2'),(pg_temp.cid(103),pg_temp.cid(3),now()-interval '1 hour',now(),'aal2');
insert into public.feature_definitions(feature_key,display_name,description,value_type,default_value) values('fixture.configuration','Configuration fixture','Synthetic configuration','boolean','false');
insert into app_private.system_job_definitions(job_key,display_name,description,execution_kind,expected_interval,freshness_sla,retry_mode,claims_before_running,last_known_good_result)
values('fixture.configuration.job','Configuration worker','Synthetic worker','worker','1 hour','2 hours','manual',true,'{"private":"do-not-project"}'),
  ('fixture.configuration.external','Unclaimed external job','Synthetic external execution','external','1 hour','2 hours','none',false,'{}');
create temporary table configuration_fixture(label text primary key,value jsonb);
create function pg_temp.target(p_kind text default 'release') returns jsonb language sql as $$
  select case p_kind when 'job' then '{"kind":"job","jobKey":"fixture.configuration.job"}'::jsonb
    when 'featureKill' then '{"kind":"featureKill","featureKey":"fixture.configuration","organizationId":null}'::jsonb
    else '{"kind":"release","featureKey":"fixture.configuration"}'::jsonb end;
$$;
create function pg_temp.context(p_target jsonb default pg_temp.target()) returns jsonb language sql as $$
  select public.get_operational_configuration(pg_temp.cid(1),pg_temp.cid(200),pg_temp.cid(201),now()-interval '1 hour',now()+interval '7 hours','app_sms',p_target);
$$;
create function pg_temp.preview(p_target jsonb,p_parameters jsonb,p_request uuid default gen_random_uuid(),p_revision text default null,p_reason text default 'Reviewed operational change') returns jsonb language sql as $$
  select public.preview_operational_configuration_command(pg_temp.cid(1),pg_temp.cid(200),pg_temp.cid(201),now()-interval '1 hour',now()+interval '7 hours','app_sms',
    p_request,p_target,coalesce(p_revision,pg_temp.context(p_target)->>'configurationRevision'),p_parameters,p_reason);
$$;
create function pg_temp.apply(p_preview jsonb,p_session integer default 201,p_principal integer default 200) returns jsonb language sql as $$
  select public.apply_operational_configuration_command(pg_temp.cid(1),pg_temp.cid(p_principal),pg_temp.cid(p_session),now()-interval '1 hour',now()+interval '7 hours','app_sms',
    (p_preview->>'commandId')::uuid,p_preview->>'previewDigest');
$$;
create function pg_temp.status(p_preview jsonb,p_session integer default 201,p_principal integer default 200) returns jsonb language sql as $$
  select public.get_operational_configuration_command_status(pg_temp.cid(1),pg_temp.cid(p_principal),pg_temp.cid(p_session),now()-interval '1 hour',now()+interval '7 hours','app_sms',
    (p_preview->>'commandId')::uuid,p_preview->>'previewDigest');
$$;
create function pg_temp.native_actor(p_user integer default 1,p_session integer default 100,p_aal text default 'aal2') returns void language sql as $$
  select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.cid(p_user),'role','authenticated','aal',p_aal,'iat',extract(epoch from now()),'session_id',pg_temp.cid(p_session))::text,true);
$$;
select ok(not has_function_privilege('authenticated','public.get_operational_configuration(uuid,uuid,uuid,timestamptz,timestamptz,text,jsonb)','execute'),'browser cannot forge configuration delegation');
select ok(not has_function_privilege('anon','public.apply_operational_configuration_command(uuid,uuid,uuid,timestamptz,timestamptz,text,uuid,text)','execute'),'anonymous configuration writes denied');
select ok(has_function_privilege('service_role','public.apply_operational_configuration_command(uuid,uuid,uuid,timestamptz,timestamptz,text,uuid,text)','execute'),'native service has guarded command API');
select ok(not has_function_privilege('service_role','app_private.write_release_flag(uuid,text,text,boolean,text,text,timestamptz)','execute'),'service cannot bypass the reviewed writer');
select ok(not has_table_privilege('service_role','app_private.operational_configuration_commands','select'),'raw command evidence is private');
select pg_temp.native_actor();
select throws_ok($$select pg_temp.context()$$,'42501','Delegation forbidden','native JWT cannot call delegated authority helper');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select is(pg_temp.context()->'state'->>'configured','false','absent flag is distinct from off');
select is(pg_temp.context()->'state'->'rolloutMode','null'::jsonb,'absent mode remains unknown');
select ok(position('do-not-project' in pg_temp.context(pg_temp.target('job'))::text)=0,'private job result never enters review projection');
select is(pg_temp.context('{"kind":"job","jobKey":"fixture.configuration.external"}')->'impact'->>'killSwitchCanStop','false','unclaimed job capability remains false');
select throws_ok($$select pg_temp.context('{"kind":"job","jobKey":"fixture.configuration.job","run":true}')$$,'22023','Invalid configuration target.','no arbitrary job operation enters context');
select throws_ok($$select pg_temp.preview(pg_temp.target(),'{"rolloutMode":"cohort","isEnabled":true,"owner":"ops","expiresAt":null}')$$,'22023','Invalid configuration change.','delegated rollout cannot create cohorts');
select throws_ok($$select pg_temp.preview(pg_temp.target('job'),'{"enabled":true,"dispatch":true}')$$,'22023','Invalid configuration change.','job command cannot dispatch');
insert into configuration_fixture values('releasePreview',pg_temp.preview(pg_temp.target(),'{"rolloutMode":"global","isEnabled":true,"owner":"Operations","expiresAt":null}',pg_temp.cid(300)));
select is((select count(*) from public.release_flags where feature_key='fixture.configuration'),0::bigint,'preview does not configure the flag');
insert into configuration_fixture values('releaseResult',pg_temp.apply((select value from configuration_fixture where label='releasePreview')));
select is((select rollout_mode from public.release_flags where feature_key='fixture.configuration'),'global','delegated change enters common native writer');
select is((select created_by from public.release_flags where feature_key='fixture.configuration'),pg_temp.cid(1),'native actor owns the created configuration');
select is(pg_temp.apply((select value from configuration_fixture where label='releasePreview'))->>'replayed','true','same command replay returns receipt');
select is((select count(*) from public.audit_logs where action='platform_operational_configuration_applied' and entity_id=(select value->>'commandId' from configuration_fixture where label='releasePreview')),1::bigint,'replay writes no second command audit');
select is((select metadata->>'authenticationMethod' from public.audit_logs where action='platform_operational_configuration_applied' and entity_id=(select value->>'commandId' from configuration_fixture where label='releasePreview')),'app_sms','audit distinguishes actual SMS authority');
select is((select actor_subject_id from public.audit_logs where action='platform_operational_configuration_applied' and entity_id=(select value->>'commandId' from configuration_fixture where label='releasePreview')),pg_temp.cid(200)::text,'audit retains current mapped Hub principal');
select is(pg_temp.preview(pg_temp.target(),'{"rolloutMode":"global","isEnabled":true,"owner":"Operations","expiresAt":null}',pg_temp.cid(300),
  (select value->>'configurationRevision' from configuration_fixture where label='releasePreview')),(select value from configuration_fixture where label='releasePreview'),'exact preview replay retains immutable binding');
select throws_ok($$select pg_temp.preview(pg_temp.target(),'{"rolloutMode":"off","isEnabled":false,"owner":"Operations","expiresAt":null}',pg_temp.cid(300),'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')$$,
  '40001','Configuration request identity was reused.','request identity cannot change settings');
-- Native wrappers retain original caller policy, cohort support and audit core.
select pg_temp.native_actor();
select lives_ok($$select public.set_release_flag('fixture.configuration','cohort',true,'Native operations','Native cohort preservation',null)$$,'native setter still supports existing cohort mode');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
insert into public.release_cohorts(id,cohort_key,name,is_active) values(pg_temp.cid(20),'fixture.configuration.cohort','Retained cohort',true);
insert into public.organization_release_cohorts(id,organization_id,cohort_id,feature_key,reason) values(pg_temp.cid(21),pg_temp.cid(10),pg_temp.cid(20),'fixture.configuration','Existing membership');
select is(pg_temp.context()->'state'->>'rolloutMode','cohort','cohort mode remains observable before a global change');
select is(pg_temp.context()->'impact'->>'retainedCohortCount','1','review names exact retained cohort count');
select is(pg_temp.context()->'impact'->>'retainedMembershipCount','1','review names exact retained membership count');
insert into configuration_fixture values('cohortPreview',pg_temp.preview(pg_temp.target(),'{"rolloutMode":"global","isEnabled":true,"owner":"Operations","expiresAt":null}'));
update public.release_cohorts set name='Changed retained cohort' where id=pg_temp.cid(20);
select throws_ok($$select pg_temp.apply((select value from configuration_fixture where label='cohortPreview'))$$,'40001','Operational configuration changed. Review current settings.','unmodified flag with changed retained cohort still invalidates review');
insert into configuration_fixture values('membershipPreview',pg_temp.preview(pg_temp.target(),'{"rolloutMode":"global","isEnabled":true,"owner":"Operations","expiresAt":null}'));
update public.organization_release_cohorts set reason='Changed current cohort association' where id=pg_temp.cid(21);
select throws_ok($$select pg_temp.apply((select value from configuration_fixture where label='membershipPreview'))$$,'40001','Operational configuration changed. Review current settings.','membership source belongs to exact review CAS');
insert into configuration_fixture values('cohortsBefore',jsonb_build_object('cohorts',(select jsonb_agg(to_jsonb(c)) from public.release_cohorts c where id=pg_temp.cid(20)),'members',(select jsonb_agg(to_jsonb(m)) from public.organization_release_cohorts m where id=pg_temp.cid(21))));
select lives_ok($$select pg_temp.apply(pg_temp.preview(pg_temp.target(),'{"rolloutMode":"global","isEnabled":true,"owner":"Operations","expiresAt":null}'))$$,'fresh explicit global rollout succeeds');
select is(jsonb_build_object('cohorts',(select jsonb_agg(to_jsonb(c)) from public.release_cohorts c where id=pg_temp.cid(20)),'members',(select jsonb_agg(to_jsonb(m)) from public.organization_release_cohorts m where id=pg_temp.cid(21))),
  (select value from configuration_fixture where label='cohortsBefore'),'global setting never rewrites retained cohort history');
-- Clear preserves the native historical expiry and removes the stored disable.
select lives_ok($$select pg_temp.apply(pg_temp.preview(pg_temp.target('featureKill'),jsonb_build_object('isDisabled',true,'expiresAt',now()+interval '1 day')))$$,'global feature disable succeeds');
insert into configuration_fixture values('killBefore',(select to_jsonb(k) from public.feature_kill_switches k where feature_key='fixture.configuration' and organization_id is null and is_disabled));
select is(pg_temp.context()->'impact'->>'globalKillSwitchActive','true','global disable is included in release impact');
select lives_ok($$select pg_temp.apply(pg_temp.preview(pg_temp.target('featureKill'),'{"isDisabled":false,"expiresAt":null}'))$$,'clear uses existing native writer');
select is(pg_temp.context(pg_temp.target('featureKill'))->'state','{"configured":false,"isDisabled":false,"reason":null,"expiresAt":null}'::jsonb,'cleared state is absence, never arbitrary newest history');
select is((select expires_at from public.feature_kill_switches where id=(select (value->>'id')::uuid from configuration_fixture where label='killBefore')),
  (select (value->>'expires_at')::timestamptz from configuration_fixture where label='killBefore'),'cleared historical expiry remains unchanged');
select is((select count(*) from public.feature_kill_switches where id=(select (value->>'id')::uuid from configuration_fixture where label='killBefore')),1::bigint,'clearing does not delete historical switch');
select lives_ok($$select pg_temp.apply(pg_temp.preview(jsonb_build_object('kind','featureKill','featureKey','fixture.configuration','organizationId',pg_temp.cid(10)),'{"isDisabled":true,"expiresAt":null}'))$$,'explicit organization disable succeeds');
select is(pg_temp.context()->'impact'->>'organizationKillSwitchCount','1','organization scope remains distinct from global');
select is(pg_temp.context()->'impact'->>'globalKillSwitchActive','false','organization disable does not create global disable');
-- Configuration changes never create work or alter entitlement definitions.
select lives_ok($$select pg_temp.apply(pg_temp.preview(pg_temp.target('job'),'{"enabled":true}'))$$,'reviewed job kill switch succeeds');
select is((select kill_switch_enabled from app_private.system_job_definitions where job_key='fixture.configuration.job'),true,'common writer records switch');
select is((select count(*) from app_private.system_job_runs where job_key='fixture.configuration.job'),0::bigint,'configuration never dispatches a job');
insert into configuration_fixture values('jobPreview',pg_temp.preview(pg_temp.target('job'),'{"enabled":false}'));
update app_private.system_job_definitions set claims_before_running=false where job_key='fixture.configuration.job';
select throws_ok($$select pg_temp.apply((select value from configuration_fixture where label='jobPreview'))$$,'40001','Operational configuration changed. Review current settings.','changed job consumption capability invalidates review');
-- Current sessions may observe old owned evidence but cannot inherit old apply.
insert into configuration_fixture values('pending',pg_temp.preview(pg_temp.target('job'),'{"enabled":false}'));
select is(pg_temp.status((select value from configuration_fixture where label='pending'))->>'canApplyThisSession','true','original fresh session may still apply');
select is(pg_temp.status((select value from configuration_fixture where label='pending'),202)->>'canApplyThisSession','false','new session observes pending without grant');
select throws_ok($$select pg_temp.apply((select value from configuration_fixture where label='pending'),202)$$,'42501','Configuration command is not authorized.','new session cannot apply old review');
select is(pg_temp.status((select value from configuration_fixture where label='releasePreview'),202)->'result',(select value from configuration_fixture where label='releaseResult'),'new session recovers exact immutable result');
select throws_ok($$select pg_temp.status((select value from configuration_fixture where label='releasePreview'),202,299)$$,'42501','Configuration receipt is not authorized.','different principal cannot inspect another receipt');
select throws_ok($$select public.get_operational_configuration(pg_temp.cid(1),pg_temp.cid(200),pg_temp.cid(201),now()-interval '9 hours',now()+interval '1 hour','app_sms',pg_temp.target())$$,'42501','Fresh Hub session required','refreshed credentials cannot extend original authority');
-- A write and its immutable receipt/audit share one rollback boundary.
insert into configuration_fixture values('beforeRollback',pg_temp.context(pg_temp.target('job')));
create function pg_temp.fail_configuration_audit() returns trigger language plpgsql as $$begin if new.action='platform_operational_configuration_applied' then raise exception 'fixture audit failure'; end if;return new;end;$$;
create trigger fixture_configuration_audit before insert on public.audit_logs for each row execute function pg_temp.fail_configuration_audit();
select throws_ok($$select pg_temp.apply((select value from configuration_fixture where label='pending'))$$,'P0001','fixture audit failure','audit failure aborts configuration writer');
select is(pg_temp.context(pg_temp.target('job')),(select value from configuration_fixture where label='beforeRollback'),'audit failure restores exact configured state');
select is(pg_temp.status((select value from configuration_fixture where label='pending'))->'result','null'::jsonb,'rolled-back write has no fabricated receipt');
drop trigger fixture_configuration_audit on public.audit_logs;
-- Time boundaries shorten review even if no material row is updated afterward.
update public.release_flags set expires_at=clock_timestamp()+interval '2 seconds' where feature_key='fixture.configuration';
insert into configuration_fixture values('expiry',pg_temp.preview(pg_temp.target(),'{"rolloutMode":"off","isEnabled":false,"owner":"Operations","expiresAt":null}'));
select ok((select (value->>'expiresAt')::timestamptz<clock_timestamp()+interval '3 seconds' from configuration_fixture where label='expiry'),'review expires at next configured boundary');
select pg_sleep(2.1);
select throws_ok($$select pg_temp.apply((select value from configuration_fixture where label='expiry'))$$,'40001','Configuration review expired.','time alone cannot silently change reviewed impact');
-- Current role revocation also protects read-only receipts.
select set_config('app.privileged_write','on',true);update public.profiles set is_active=false where id=pg_temp.cid(1);select set_config('app.privileged_write','',true);
select throws_ok($$select pg_temp.status((select value from configuration_fixture where label='releasePreview'))$$,'42501','Delegation forbidden','native revocation blocks immutable receipt disclosure');
select pg_temp.native_actor(3,103);
select throws_ok($$select public.set_system_job_kill_switch('fixture.configuration.job',false,'Unapproved employee edit')$$,'42501','Only platform_admin may change job kill switches','native employee cannot use original job wrapper');
select throws_ok($$select public.set_release_flag('fixture.configuration','global',true,'employee','Unapproved employee edit',null)$$,'42501','Only platform administrators may change release flags','native release wrapper retains platform authority');
select * from finish();
rollback;
