-- Only rollback fixtures; no production courses or learner history.
begin;
select no_plan();
insert into public.organizations(id,name,slug) values('dd000000-0000-4000-8000-000000000001','Distribution fixture','distribution-fixture');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
 created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change,email_change_token_current,reauthentication_token,is_sso_user,is_anonymous)
values('00000000-0000-0000-0000-000000000000','dd000000-0000-4000-8000-000000000003','authenticated','authenticated','distribution@test.local','x',now(),'{}','{}',now(),now(),'','','','','','',false,false);
select set_config('app.privileged_write','on',true);
update public.profiles set role='platform_admin',is_active=true where id='dd000000-0000-4000-8000-000000000003';
insert into public.courses(id,organization_id,title,status,created_by) values
 ('dd000000-0000-4000-8000-000000000004',null,'Global distribution fixture','draft','dd000000-0000-4000-8000-000000000003'),
 ('dd000000-0000-4000-8000-000000000005','dd000000-0000-4000-8000-000000000001','Private tenant course','draft','dd000000-0000-4000-8000-000000000003');
insert into public.course_versions(id,course_id,organization_id,version_number,title,status) values
 ('dd000000-0000-4000-8000-000000000006','dd000000-0000-4000-8000-000000000004',null,1,'Current global version','draft'),
 ('dd000000-0000-4000-8000-000000000007','dd000000-0000-4000-8000-000000000004',null,2,'New unpublished draft','draft');
insert into public.course_blocks(id,course_version_id,organization_id,block_type,sort_order,title,body) values
 ('dd000000-0000-4000-8000-000000000008','dd000000-0000-4000-8000-000000000006',null,'text',0,'Retained material','{"content":"Original current content"}');
select set_config('app.privileged_write','',true);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
create function pg_temp.context(p_id uuid default 'dd000000-0000-4000-8000-000000000004') returns jsonb language sql as $$
 select public.get_learning_distribution_context('dd000000-0000-4000-8000-000000000003','dd000000-0000-4000-8000-000000000010',
 'dd000000-0000-4000-8000-000000000011',now()-interval '1 hour',now()+interval '7 hours',p_id,'app_sms');
$$;
create function pg_temp.status() returns jsonb language sql as $$
 select public.get_learning_distribution_status(array['dd000000-0000-4000-8000-000000000004'::uuid,
 'dd000000-0000-4000-8000-000000000005','dd000000-0000-4000-8000-000000000099']);
$$;
select ok(not has_function_privilege('authenticated','public.get_learning_distribution_context(uuid,uuid,uuid,timestamptz,timestamptz,uuid,text)','EXECUTE'),'browser cannot forge human delegation');
select ok(not has_function_privilege('anon','public.get_learning_distribution_status(uuid[])','EXECUTE')
 and not has_function_privilege('authenticated','public.get_learning_distribution_status(uuid[])','EXECUTE'),'machine endpoint has no browser RPC grant');
select ok(has_function_privilege('service_role','public.get_learning_distribution_status(uuid[])','EXECUTE'),'configured backend can observe status');
select is(pg_temp.context()->>'publicationState','draft','unpublished course remains a draft');
select is(pg_temp.context()->'source','null'::jsonb,'unpublished draft material is not distributed');
select is(pg_temp.context()->'currentVersionId','null'::jsonb,'missing current pointer is explicit');
select throws_ok($$select pg_temp.context('dd000000-0000-4000-8000-000000000005')$$,'P0002','Global course not found','tenant material is unavailable to global distribution');
select is(pg_temp.status()->'items'->1,pg_temp.status()->'items'->2||jsonb_build_object('courseId','dd000000-0000-4000-8000-000000000005'),'tenant and absent IDs have identical tombstone semantics');
select throws_ok($$select public.get_learning_distribution_status('{}'::uuid[])$$,'22023','A unique bounded course batch is required','empty batch rejected');
select throws_ok($$select public.get_learning_distribution_status(array_fill('dd000000-0000-4000-8000-000000000004'::uuid,array[11]))$$,'22023','A unique bounded course batch is required','oversized batch rejected');
select throws_ok($$select public.get_learning_distribution_status(array['dd000000-0000-4000-8000-000000000004'::uuid,'dd000000-0000-4000-8000-000000000004'])$$,'22023','A unique bounded course batch is required','duplicate IDs rejected');
select throws_ok($$select public.get_learning_distribution_status(array[null::uuid])$$,'22023','A unique bounded course batch is required','null IDs rejected');
select set_config('app.privileged_write','on',true);
update public.course_versions set status='published',published_at=now() where id='dd000000-0000-4000-8000-000000000006';
update public.courses set status='published',current_version_id='dd000000-0000-4000-8000-000000000006' where id='dd000000-0000-4000-8000-000000000004';
select set_config('app.privileged_write','',true);
create temporary table distribution_fixture(label text primary key,value jsonb);
insert into distribution_fixture values('source',pg_temp.context()),('course',(select to_jsonb(c) from public.courses c where id='dd000000-0000-4000-8000-000000000004')),
 ('version',(select to_jsonb(v) from public.course_versions v where id='dd000000-0000-4000-8000-000000000006')),
 ('history',jsonb_build_array((select count(*) from public.course_assignments),(select count(*) from public.certificates),(select count(*) from public.quiz_attempts)));
select is(pg_temp.context()->>'currentVersionId','dd000000-0000-4000-8000-000000000006','published current pointer wins over a newer draft');
select is((pg_temp.context()#>>'{source,payload}')::jsonb->>'sourceVersionId','dd000000-0000-4000-8000-000000000006','exported payload has the same current version');
select is(pg_temp.context()#>>'{source,sourceRevision}',encode(extensions.digest(pg_temp.context()#>>'{source,payload}','sha256'),'hex'),'published source SHA binds exact immutable text');
select is(pg_temp.status()#>>'{items,0,sourceRevision}',pg_temp.context()#>>'{source,sourceRevision}','machine and delegated source observe the same canonical digest');
select ok(not ((pg_temp.status()->'items'->0)?'payload'),'machine projection never returns source material');
select set_config('app.privileged_write','on',true);
update public.course_blocks set body='{"content":"Changed native current content"}' where id='dd000000-0000-4000-8000-000000000008';
select set_config('app.privileged_write','',true);
select isnt(pg_temp.status()#>>'{items,0,sourceRevision}',(select value#>>'{source,sourceRevision}' from distribution_fixture where label='source'),'native material change is observable without an editor session');
select set_config('app.privileged_write','on',true);
update public.courses set status='archived' where id='dd000000-0000-4000-8000-000000000004';
select set_config('app.privileged_write','',true);
select is(pg_temp.status()#>>'{items,0,publicationState}','archived','retirement propagates as confirmed state');
select is(pg_temp.status()#>'{items,0,sourceRevision}','null'::jsonb,'retirement removes distributable hash');
select is(pg_temp.context()->'source','null'::jsonb,'retired course source is not offered for publication');
select is((select to_jsonb(v) from public.course_versions v where id='dd000000-0000-4000-8000-000000000006'),(select value from distribution_fixture where label='version'),'observer preserves original version metadata');
select is(jsonb_build_array((select count(*) from public.course_assignments),(select count(*) from public.certificates),(select count(*) from public.quiz_attempts)),
 (select value from distribution_fixture where label='history'),'all assignment, certificate and attempt history stays unchanged');
select throws_ok($$select public.get_learning_distribution_context('dd000000-0000-4000-8000-000000000003','dd000000-0000-4000-8000-000000000010',
 'dd000000-0000-4000-8000-000000000011',now()-interval '9 hours',now()-interval '1 hour','dd000000-0000-4000-8000-000000000004','app_sms')$$,
 '42501','Fresh Hub session required','human context rejects expired SMS authority');
select set_config('app.privileged_write','on',true);
update public.profiles set is_active=false where id='dd000000-0000-4000-8000-000000000003';
select set_config('app.privileged_write','',true);
select throws_ok($$select pg_temp.context()$$,'42501','Delegation forbidden','deactivated native operator cannot export source');
select is(jsonb_array_length(pg_temp.status()->'items'),3,'machine read remains independent of human login');
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select throws_ok($$select pg_temp.status()$$,'42501','Service observer required','machine RPC independently rejects human credentials');
select * from finish();
rollback;
