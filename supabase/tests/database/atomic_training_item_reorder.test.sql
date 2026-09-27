begin;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$
  select ('ab920000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid;
$$;
create function pg_temp.act(n integer) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('app.privileged_write','off',true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated','aal','aal2','iat',extract(epoch from now())::bigint)::text,true);
  set local role authenticated;
end;
$$;
insert into public.organizations(id,name,slug,subscription_status) values
  (pg_temp.id(1),'Reorder org','reorder-org','active'),(pg_temp.id(2),'Other reorder org','reorder-other','active');
insert into app_private.module_access_terms(organization_id,module_key,source,reason) values
  (pg_temp.id(1),'modules.train','complimentary','Disposable training reorder test');
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select pg_temp.id(n),'authenticated','authenticated','reorder-'||n||'@test.local','x',now(),'{}','{}',now(),now() from generate_series(101,103) n;
select set_config('app.privileged_write','on',true);
update public.profiles set role='platform_admin',organization_id=null,is_active=true where id=pg_temp.id(101);
update public.profiles set role='org_admin',organization_id=pg_temp.id(1),is_active=true where id=pg_temp.id(102);
update public.profiles set role='employee',organization_id=pg_temp.id(1),is_active=true where id=pg_temp.id(103);
select set_config('app.privileged_write','off',true);
insert into public.courses(id,title,status) values
  (pg_temp.id(10),'Reorder course','draft'),(pg_temp.id(14),'Second plan course','draft');
insert into public.course_versions(id,course_id,version_number,title,status) values
  (pg_temp.id(11),pg_temp.id(10),1,'Draft','draft'),(pg_temp.id(12),pg_temp.id(10),2,'Other draft','draft');
insert into public.course_blocks(id,course_version_id,block_type,sort_order,title,body) values
  (pg_temp.id(201),pg_temp.id(11),'quiz',0,'First','{}'),
  (pg_temp.id(202),pg_temp.id(11),'text',1,'Second','{"content":"Confirm the learner identity before recording training attendance."}'),
  (pg_temp.id(203),pg_temp.id(12),'text',0,'Other version','{"content":"Review the training record before confirming completion."}');
insert into public.quizzes(id,course_block_id,title) values (pg_temp.id(210),pg_temp.id(201),'Quiz');
insert into public.quiz_questions(id,quiz_id,question_text,question_type,sort_order) values
  (pg_temp.id(211),pg_temp.id(210),'First','single_choice',0),(pg_temp.id(212),pg_temp.id(210),'Second','single_choice',1);
insert into public.quiz_answers(id,question_id,answer_text,is_correct,sort_order) values
  (pg_temp.id(221),pg_temp.id(211),'Confirm the learner identity.',true,0),
  (pg_temp.id(222),pg_temp.id(211),'Assume the identity without checking.',false,1),
  (pg_temp.id(223),pg_temp.id(212),'Review the training record.',true,0),
  (pg_temp.id(224),pg_temp.id(212),'Skip the training record.',false,1);
insert into public.training_plans(id,organization_id,name) values
  (pg_temp.id(300),pg_temp.id(1),'Plan'),(pg_temp.id(310),pg_temp.id(2),'Other tenant plan');
insert into public.training_plan_items(id,training_plan_id,course_id,sort_order) values
  (pg_temp.id(301),pg_temp.id(300),pg_temp.id(10),0),(pg_temp.id(302),pg_temp.id(300),pg_temp.id(14),1),
  (pg_temp.id(311),pg_temp.id(310),pg_temp.id(10),0),(pg_temp.id(312),pg_temp.id(310),pg_temp.id(14),1);
insert into public.competency_templates(id,organization_id,name) values
  (pg_temp.id(400),pg_temp.id(1),'Checklist'),(pg_temp.id(410),null,'System checklist');
insert into public.competency_template_items(id,template_id,item_text,sort_order) values
  (pg_temp.id(401),pg_temp.id(400),'First',0),(pg_temp.id(402),pg_temp.id(400),'Second',1),
  (pg_temp.id(411),pg_temp.id(410),'First system',0),(pg_temp.id(412),pg_temp.id(410),'Second system',1);

select ok(not has_function_privilege('anon','public.swap_training_item_order(text,uuid,uuid,integer,integer)','EXECUTE'),'anonymous reorder is not callable');
select ok(not (select prosecdef from pg_proc where oid='public.swap_training_item_order(text,uuid,uuid,integer,integer)'::regprocedure),'reordering retains caller RLS');
select pg_temp.act(101);
select lives_ok($$select public.swap_training_item_order('course_blocks',pg_temp.id(201),pg_temp.id(202),0,1)$$,'course blocks swap together');
select is((select array_agg(sort_order order by id) from public.course_blocks where id in (pg_temp.id(201),pg_temp.id(202))),array[1,0],'both block positions changed');
select lives_ok($$select public.swap_training_item_order('quiz_questions',pg_temp.id(211),pg_temp.id(212),0,1)$$,'quiz questions swap together');
select is((select array_agg(sort_order order by id) from public.quiz_questions where quiz_id=pg_temp.id(210)),array[1,0],'both question positions changed');
select throws_ok($$select public.swap_training_item_order('course_blocks',pg_temp.id(201),pg_temp.id(202),0,1)$$,'40001','Training item order changed. Reload and retry.','stale display cannot undo a later reorder');
select throws_ok($$select public.swap_training_item_order('course_blocks',pg_temp.id(201),pg_temp.id(203),1,0)$$,'42501','Both training items must be accessible and belong to the same parent.','items cannot cross course versions');
select throws_ok($$select public.swap_training_item_order('profiles',pg_temp.id(101),pg_temp.id(102),0,1)$$,'22023','Unsupported training item resource.','arbitrary tables cannot be targeted');
select pg_temp.act(102);
select lives_ok($$select public.swap_training_item_order('training_plan_items',pg_temp.id(301),pg_temp.id(302),0,1)$$,'organization author can reorder plan items');
select is((select array_agg(sort_order order by id) from public.training_plan_items where training_plan_id=pg_temp.id(300)),array[1,0],'both plan positions changed');
select lives_ok($$select public.swap_training_item_order('competency_template_items',pg_temp.id(401),pg_temp.id(402),0,1)$$,'organization author can reorder owned checklist items');
select is((select array_agg(sort_order order by id) from public.competency_template_items where template_id=pg_temp.id(400)),array[1,0],'both checklist positions changed');
select throws_ok($$select public.swap_training_item_order('training_plan_items',pg_temp.id(311),pg_temp.id(312),0,1)$$,'42501',null,'other-tenant plan remains inaccessible');
select throws_ok($$select public.swap_training_item_order('competency_template_items',pg_temp.id(411),pg_temp.id(412),0,1)$$,'42501',null,'system checklist remains read-only for organization author');
select throws_ok($$select public.swap_training_item_order('quiz_questions',pg_temp.id(211),pg_temp.id(212),1,0)$$,'42501',null,'organization author cannot edit platform course content');
select pg_temp.act(103);
select throws_ok($$select public.swap_training_item_order('competency_template_items',pg_temp.id(401),pg_temp.id(402),1,0)$$,'42501',null,'learner cannot reorder a readable checklist');

reset role;
create function pg_temp.fail_reorder() returns trigger language plpgsql as $$
begin if new.id=pg_temp.id(202) then raise exception 'Synthetic second-item failure'; end if; return new; end;
$$;
create trigger synthetic_reorder_failure before update on public.course_blocks for each row execute function pg_temp.fail_reorder();
select pg_temp.act(101);
select throws_ok($$select public.swap_training_item_order('course_blocks',pg_temp.id(201),pg_temp.id(202),1,0)$$,'P0001','Synthetic second-item failure','a second-item error aborts the complete move');
select is((select array_agg(sort_order order by id) from public.course_blocks where id in (pg_temp.id(201),pg_temp.id(202))),array[1,0],'first position is rolled back with the failing second item');
reset role;
drop trigger synthetic_reorder_failure on public.course_blocks;
select pg_temp.act(101);
select lives_ok($$update public.course_versions set status='published' where id=pg_temp.id(11)$$,'complete draft passes the normal publication guards');
select throws_ok($$select public.swap_training_item_order('course_blocks',pg_temp.id(201),pg_temp.id(202),1,0)$$,'0A000','Only draft course content can be reordered.','published block order remains immutable');
select throws_ok($$select public.swap_training_item_order('quiz_questions',pg_temp.id(211),pg_temp.id(212),1,0)$$,'0A000','Only draft course content can be reordered.','published question order remains immutable');
reset role;
select * from finish();
rollback;
