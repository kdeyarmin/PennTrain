begin;
select no_plan();
select ok(not has_function_privilege('authenticated','public.platform_admin_read_operations(uuid,uuid,uuid,timestamptz,timestamptz,text,text,integer,integer,text)','EXECUTE'),'browser cannot forge operational delegation');
select ok(not has_function_privilege('anon','public.platform_admin_read_operations(uuid,uuid,uuid,timestamptz,timestamptz,text,text,integer,integer,text)','EXECUTE'),'anonymous operations are denied');
select ok(has_function_privilege('service_role','public.platform_admin_read_operations(uuid,uuid,uuid,timestamptz,timestamptz,text,text,integer,integer,text)','EXECUTE'),'native server can invoke bounded operational reader');
select ok(not has_function_privilege('service_role','app_private.system_job_control_plane_rows()','EXECUTE'),'shared job core has no raw service grant');
select ok(has_function_privilege('authenticated','public.get_system_job_control_plane()','EXECUTE'),'native reader keeps its existing grant');

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
  created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change,email_change_token_current,reauthentication_token,is_sso_user,is_anonymous)
values('00000000-0000-0000-0000-000000000000','9f000000-0000-4000-8000-000000000001','authenticated','authenticated','operations-actor@test.local','x',now(),'{}','{}',now(),now(),'','','','','','',false,false);
select set_config('app.privileged_write','on',true);
update public.profiles set role='platform_admin',is_active=true where id='9f000000-0000-4000-8000-000000000001';
select set_config('app.privileged_write','',true);
insert into app_private.system_job_definitions(job_key,display_name,description,execution_kind,expected_interval,freshness_sla,retry_mode)
values('fixture.operations.worker','Operations fixture','Synthetic worker','worker','1 hour','2 hours','manual');
insert into app_private.system_job_runs(job_key,correlation_id,status,attempted_count,succeeded_count,failed_count,started_at,finished_at,error_message)
values('fixture.operations.worker','fixture-only','failed',9007199254740993,0,9007199254740993,now()-interval '1 hour',now()-interval '59 minutes','private-token-do-not-project');
insert into public.feature_definitions(feature_key,display_name,description,value_type,default_value)
values('fixture.operations.feature','Operations feature','Synthetic rollout','boolean','false');
insert into public.audit_logs(action,entity_type,entity_id,actor_profile_id,actor_subject_id,metadata)
values('fixture.operations.event','fixture.operations.entity','source-id','9f000000-0000-4000-8000-000000000001','worker:fixture','{"private":"do-not-project"}');

create function pg_temp.operations(p_operation text,p_limit integer default 25,p_offset integer default 0,p_search text default 'fixture.operations') returns jsonb language sql as $$
  select public.platform_admin_read_operations('9f000000-0000-4000-8000-000000000001','9f000000-0000-4000-8000-000000000002','9f000000-0000-4000-8000-000000000003',
    now()-interval '1 hour',now()+interval '7 hours','app_sms',p_operation,p_limit,p_offset,p_search);
$$;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select is(pg_temp.operations('operations.jobs.list')->>'total','1','job search returns the exact native cohort');
select is(pg_temp.operations('operations.jobs.list')->'items'->0->>'attemptedCount','9007199254740993','large counts retain decimal precision');
select is(pg_temp.operations('operations.jobs.list')->'items'->0->>'lastStatus','failed','worker result owns status');
select is(pg_temp.operations('operations.jobs.list')->'items'->0->>'hasError','true','error presence is visible');
select ok(position('private-token' in pg_temp.operations('operations.jobs.list')::text)=0,'upstream error details remain private');
select is(pg_temp.operations('operations.jobs.list',1,1)->'items','[]'::jsonb,'past-end pagination is empty without losing total');
select is(pg_temp.operations('operations.releases.list')->'items'->0->>'rolloutMode','unconfigured','missing rollout stays distinct from off');
select is(pg_temp.operations('operations.releases.list')->'items'->0->'isEnabled','null'::jsonb,'missing rollout is unknown');
select is(pg_temp.operations('operations.releases.list')->'items'->0->>'organizationKillSwitchCount','0','unconfigured feature has exact switch count');
select is(pg_temp.operations('operations.audit.list')->>'total','1','audit filtering preserves source events');
select is(pg_temp.operations('operations.audit.list')->'items'->0->>'actorSubjectId','worker:fixture','non-UUID actor subjects are retained');
select ok(position('do-not-project' in pg_temp.operations('operations.audit.list')::text)=0,'raw audit metadata is excluded');
select throws_ok($$select pg_temp.operations('operations.jobs.run')$$,'22023','Invalid operational read','no write operations enter the reader');
select throws_ok($$select pg_temp.operations('operations.jobs.list',51)$$,'22023','Invalid operational read','oversized pages are denied');
select throws_ok($$select pg_temp.operations('operations.audit.list',25,10001)$$,'22023','Invalid operational read','deep offsets are bounded');
select throws_ok($$select pg_temp.operations('operations.audit.list',25,0,E'bad\nfilter')$$,'22023','Invalid operational read','control characters are denied');
select throws_ok($$select public.platform_admin_read_operations('9f000000-0000-4000-8000-000000000001','9f000000-0000-4000-8000-000000000002','9f000000-0000-4000-8000-000000000003',now()-interval '9 hours',now()-interval '1 hour','app_sms','operations.jobs.list',25,0,'')$$,
  '42501','Fresh Hub session required','expired sessions cannot inspect current operations');
reset role;
select set_config('app.privileged_write','on',true);
update public.profiles set is_active=false where id='9f000000-0000-4000-8000-000000000001';
select set_config('app.privileged_write','',true);
set local role service_role;
select throws_ok($$select pg_temp.operations('operations.jobs.list')$$,'42501','Delegation forbidden','native deactivation revokes operational access');
reset role;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"9f000000-0000-4000-8000-000000000001"}',true);
set local role authenticated;
select throws_ok($$select public.get_system_job_control_plane()$$,'42501','Only platform_admin may inspect system jobs','native reader retains its own protected role check');
reset role;
select * from finish();
rollback;
