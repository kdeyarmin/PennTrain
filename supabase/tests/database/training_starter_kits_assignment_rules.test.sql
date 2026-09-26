begin;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$
  select ('ea260000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$$;
create function pg_temp.act(n integer,assurance text default 'aal2') returns void language plpgsql as $$
begin
  reset role;
  perform set_config('app.privileged_write','off',true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated','aal',assurance,'iat',extract(epoch from now())::bigint)::text,true);
  set local role authenticated;
end $$;
insert into public.organizations(id,name,slug,subscription_status) values
  (pg_temp.id(1),'Starter kit tenant','starter-kit-test','active'),(pg_temp.id(2),'Other kit tenant','starter-kit-other','active');
insert into app_private.module_access_terms(organization_id,module_key,source,reason) values
  (pg_temp.id(1),'modules.train','complimentary','Disposable starter kit test'),(pg_temp.id(2),'modules.train','complimentary','Disposable starter kit test');
insert into public.facilities(id,organization_id,name,facility_type) values
  (pg_temp.id(11),pg_temp.id(1),'Assigned facility','PCH'),(pg_temp.id(12),pg_temp.id(1),'Other facility','PCH'),(pg_temp.id(13),pg_temp.id(2),'Other tenant','PCH');
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select pg_temp.id(n),'authenticated','authenticated','starter-kit-'||n||'@test.local','x',now(),'{}','{}',now(),now() from generate_series(101,106) n;
select set_config('app.privileged_write','on',true);
insert into public.profiles(id,organization_id,role,email,first_name,last_name,is_active)
select pg_temp.id(n),case when n=105 then null when n=106 then pg_temp.id(2) else pg_temp.id(1) end,
  case n when 101 then 'org_admin' when 102 then 'facility_manager' when 103 then 'employee' when 104 then 'trainer' when 105 then 'platform_admin' else 'org_admin' end,
  'starter-kit-'||n||'@test.local','Kit','Tester',true from generate_series(101,106) n
on conflict(id) do update set organization_id=excluded.organization_id,role=excluded.role,is_active=true;
insert into public.facility_assignments(profile_id,facility_id) values (pg_temp.id(102),pg_temp.id(11)),(pg_temp.id(103),pg_temp.id(11)),(pg_temp.id(104),pg_temp.id(11));
insert into public.employees(id,organization_id,facility_id,profile_id,first_name,last_name,job_title,department,status) values
  (pg_temp.id(201),pg_temp.id(1),pg_temp.id(11),pg_temp.id(103),'First','Caregiver','Caregiver','Care','active'),
  (pg_temp.id(202),pg_temp.id(1),pg_temp.id(11),null,'Second','Caregiver','caregiver','Care','active'),
  (pg_temp.id(203),pg_temp.id(1),pg_temp.id(11),null,'Dietary','Worker','Caregiver','Dietary','active'),
  (pg_temp.id(204),pg_temp.id(1),pg_temp.id(12),null,'Other','Facility','Caregiver','Care','active'),
  (pg_temp.id(205),pg_temp.id(2),pg_temp.id(13),null,'Other','Tenant','Caregiver','Care','active');
insert into public.courses(id,organization_id,title,status) values
  (pg_temp.id(301),pg_temp.id(1),'Tenant course','draft'),(pg_temp.id(302),null,'Global orientation','draft'),(pg_temp.id(303),null,'Global safety','draft');
insert into public.course_versions(id,course_id,organization_id,version_number,title)
select pg_temp.id(n+100),id,organization_id,1,title from public.courses c join generate_series(301,303) n on c.id=pg_temp.id(n);
insert into public.course_blocks(course_version_id,organization_id,block_type,sort_order,title,body)
select id,organization_id,'text',0,'Lesson','{"content":"Global classroom orientation lesson"}' from public.course_versions where id in (pg_temp.id(401),pg_temp.id(402),pg_temp.id(403));
update public.course_versions set status='published',published_at=now() where id in (pg_temp.id(401),pg_temp.id(402),pg_temp.id(403));
update public.courses c set status='published',current_version_id=v.id from public.course_versions v where v.course_id=c.id and c.id in (pg_temp.id(301),pg_temp.id(302),pg_temp.id(303));
select set_config('app.privileged_write','off',true);
create temp table kit_results(name text primary key,result jsonb);
grant all on kit_results to authenticated;
create function pg_temp.value(n text,k text default 'id') returns uuid language sql as $$ select (result->>k)::uuid from kit_results where name=n $$;
create function pg_temp.preview() returns jsonb language sql as $$ select public.preview_training_assignment_rule(pg_temp.value('plan')) $$;
select ok(not has_function_privilege('anon','public.save_training_starter_kit(uuid,integer,text,text,jsonb,boolean)','execute'),'anonymous callers cannot author kits');
select ok(not has_function_privilege('anon','public.copy_training_starter_kit(uuid,integer,integer,date,text)','execute'),'anonymous callers cannot adopt kits');
select ok(not has_function_privilege('anon','public.approve_training_assignment_automation(uuid,text,boolean)','execute'),'anonymous callers cannot approve automation');
select is((select prosecdef from pg_proc where oid='public.apply_training_assignment_rule(uuid,text,uuid[])'::regprocedure),false,'rule application preserves invoker RLS');
select is((select prosecdef from pg_proc where oid='app_private.apply_approved_training_staff_rules()'::regprocedure),false,'staff automation uses current actor rather than impersonating a saved admin');

select pg_temp.act(102);
select throws_ok($$select public.save_training_starter_kit(null,null,'Unauthorized kit','',jsonb_build_array(jsonb_build_object('course_id',pg_temp.id(302),'is_required',true)),true)$$,'42501',null,'facility manager cannot publish global starter kits');
select pg_temp.act(105);
insert into kit_results values('kit',public.save_training_starter_kit(null,null,'Orientation starter','Review for your facility.',jsonb_build_array(jsonb_build_object('course_id',pg_temp.id(302),'is_required',true)),true));
select is((select (result->>'revision')::int from kit_results where name='kit'),1,'owner creates versioned published kit');
select throws_ok($$select public.save_training_starter_kit(null,null,'Tenant leakage','',jsonb_build_array(jsonb_build_object('course_id',pg_temp.id(301),'is_required',true)),true)$$,'23514',null,'global starter kit cannot leak tenant-owned courses');
select throws_ok($$select public.save_training_starter_kit(null,null,'Repeated course','',jsonb_build_array(jsonb_build_object('course_id',pg_temp.id(302),'is_required',true),jsonb_build_object('course_id',pg_temp.id(302),'is_required',false)),true)$$,'22023',null,'duplicate courses rejected');
select throws_ok($$select public.save_training_starter_kit(null,null,'Empty kit','','[]',true)$$,'22023',null,'published kit cannot be empty');
select throws_ok($$select public.save_training_starter_kit(pg_temp.value('kit'),99,'Stale edit','',jsonb_build_array(jsonb_build_object('course_id',pg_temp.id(302),'is_required',true)),true)$$,'40001',null,'kit stale write rejected');
insert into kit_results values('selection',jsonb_build_object('id',public.select_training_starter_kit(pg_temp.id(11),pg_temp.value('kit'))));
select is(public.select_training_starter_kit(pg_temp.id(11),pg_temp.value('kit')),pg_temp.value('selection'),'owner selection retry is idempotent');
select is((select count(*)::int from public.training_plans where facility_id=pg_temp.id(11)),0,'owner kit selection never invents plan deadlines or creates assignments');

select pg_temp.act(103);
select is((select count(*)::int from public.training_starter_kits),0,'learners cannot read authoring kit inventory');
select is((select count(*)::int from public.training_starter_kit_selections),0,'learners cannot read facility starter selections');
select throws_ok($$select public.copy_training_starter_kit(pg_temp.value('selection'),1,2030,'2030-12-15','Unauthorized plan')$$,'42501',null,'learners cannot adopt facility kits');
select pg_temp.act(106);
select is((select count(*)::int from public.training_starter_kit_selections),0,'other tenant cannot see selections');
select throws_ok($$select public.copy_training_starter_kit(pg_temp.value('selection'),1,2030,'2030-12-15','Other tenant plan')$$,'42501',null,'other tenant cannot copy selection');
select pg_temp.act(102,'aal1');
select throws_ok($$select public.copy_training_starter_kit(pg_temp.value('selection'),1,2030,'2030-12-15','Weak session plan')$$,'42501',null,'manager adoption requires MFA');
select pg_temp.act(102);
select throws_ok($$select public.select_training_starter_kit(pg_temp.id(12),pg_temp.value('kit'))$$,'42501',null,'manager cannot select a kit for an unassigned facility');
select throws_ok($$select public.copy_training_starter_kit(pg_temp.value('selection'),1,2030,null,'Missing deadline')$$,'22023',null,'copy requires an explicitly entered date');
select throws_ok($$select public.copy_training_starter_kit(pg_temp.value('selection'),1,2030,'2000-01-01','Past deadline')$$,'22023',null,'copy cannot preapprove past deadlines');
select throws_ok($$select public.copy_training_starter_kit(pg_temp.value('selection'),2,2030,'2031-01-12','Changed kit')$$,'40001',null,'copy refuses a stale reviewed kit revision');
insert into kit_results values('plan',jsonb_build_object('id',public.copy_training_starter_kit(pg_temp.value('selection'),1,2030,'2031-01-12','Facility orientation')));
select is((select due_date::text from public.training_plans where id=pg_temp.value('plan')),'2031-01-12','copy preserves exact entered deadline even outside the training year');
select is((select count(*)::int from public.training_plan_items where training_plan_id=pg_temp.value('plan')),1,'copy includes all reviewed courses');
select is(public.copy_training_starter_kit(pg_temp.value('selection'),1,2030,'2031-01-12','Retry copy'),pg_temp.value('plan'),'copy retry returns same editable facility plan');
select is((select count(*)::int from public.course_assignments where facility_id=pg_temp.id(11)),0,'copying never assigns staff before review');
select pg_temp.act(105);
select lives_ok($$select public.save_training_starter_kit(pg_temp.value('kit'),1,'Updated global kit','',jsonb_build_array(jsonb_build_object('course_id',pg_temp.id(303),'is_required',true)),true)$$,'owner may revise the global kit');
select pg_temp.act(102);
select is((select course_id from public.training_plan_items where training_plan_id=pg_temp.value('plan')),pg_temp.id(302),'global revision leaves editable facility copy unchanged');
select lives_ok($$select public.save_training_assignment_rule(pg_temp.value('plan'),'Caregiver','Care',true,null)$$,'manager saves exact title and department rule');
select is(jsonb_array_length(pg_temp.preview()->'employees'),2,'matching is case insensitive and requires both criteria');
select is((select automatic_enabled from public.training_plan_assignment_rules where training_plan_id=pg_temp.value('plan')),false,'matching rules default to manual preview');
select throws_ok($$select public.save_training_assignment_rule(pg_temp.value('plan'),'Caregiver','Care',true,99)$$,'40001',null,'stale rule revisions rejected');
select throws_ok($$select public.apply_training_assignment_rule(pg_temp.value('plan'),pg_temp.preview()->>'fingerprint',array[pg_temp.id(203)])$$,'42501',null,'same-facility employee who does not match cannot be selected');
select throws_ok($$select public.apply_training_assignment_rule(pg_temp.value('plan'),pg_temp.preview()->>'fingerprint',array[pg_temp.id(204)])$$,'42501',null,'other facility employee cannot be selected');
insert into kit_results values('preview',pg_temp.preview());
update public.training_plans set due_date='2031-01-20' where id=pg_temp.value('plan');
select throws_ok($$select public.apply_training_assignment_rule(pg_temp.value('plan'),(select result->>'fingerprint' from kit_results where name='preview'),array[pg_temp.id(201)])$$,'40001',null,'date change invalidates previously reviewed application');
select is((select count(*)::int from public.course_assignments where facility_id=pg_temp.id(11)),0,'stale preview causes no partial assignments');
insert into public.course_assignments(id,organization_id,facility_id,employee_id,course_id,course_version_id,assigned_by,due_date)
values(pg_temp.id(801),pg_temp.id(1),pg_temp.id(11),pg_temp.id(202),pg_temp.id(302),pg_temp.id(402),pg_temp.id(102),'2031-02-22');
insert into kit_results values('applied',public.apply_training_assignment_rule(pg_temp.value('plan'),pg_temp.preview()->>'fingerprint',array[pg_temp.id(201),pg_temp.id(202)]));
select is((select count(*)::int from public.course_assignments where employee_id=pg_temp.id(201)),1,'explicit reviewed application assigns matching staff');
select is((select due_date::text from public.course_assignments where id=pg_temp.id(801)),'2031-02-22','existing individual deadline is preserved');
select is((select jsonb_array_length(result->1->'result'->'conflicts') from kit_results where name='applied'),1,'individual assignment conflict is returned for visible resolution');
select lives_ok($$select public.apply_training_assignment_rule(pg_temp.value('plan'),pg_temp.preview()->>'fingerprint',array[pg_temp.id(201)])$$,'fresh retry of already enrolled staff is safe');
select is((select count(*)::int from public.course_assignments where employee_id=pg_temp.id(201)),1,'rule retry never duplicates assignments');
update public.training_plans set due_date='2031-03-01' where id=pg_temp.value('plan');
select lives_ok($$select public.apply_training_assignment_rule(pg_temp.value('plan'),pg_temp.preview()->>'fingerprint',array[pg_temp.id(201)])$$,'rule does not reconcile an existing enrollment');
select is((select due_date::text from public.course_assignments where employee_id=pg_temp.id(201)),'2031-01-20','existing plan enrollment retains previously approved date');

select throws_ok($$select public.approve_training_assignment_automation(pg_temp.value('plan'),'stale-review',true)$$,'40001',null,'automatic opt-in requires a fresh explicit review');
select lives_ok($$select public.approve_training_assignment_automation(pg_temp.value('plan'),pg_temp.preview()->>'fingerprint',true)$$,'manager approves current exact plan and deadline');
insert into public.employees(id,organization_id,facility_id,first_name,last_name,job_title,department,status)
values(pg_temp.id(206),pg_temp.id(1),pg_temp.id(11),'Automatic','Newhire','Caregiver','Care','active');
select is((select count(*)::int from public.course_assignments where employee_id=pg_temp.id(206)),1,'approved manager staff creation assigns the saved plan');
select is((select due_date::text from public.course_assignments where employee_id=pg_temp.id(206)),'2031-03-01','automatic rule uses only explicitly approved date');
update public.employees set job_title='CAREGIVER' where id=pg_temp.id(206);
select is((select count(*)::int from public.course_assignments where employee_id=pg_temp.id(206)),1,'automatic recheck is idempotent');
insert into public.training_plan_items(training_plan_id,course_id,is_required) values(pg_temp.value('plan'),pg_temp.id(303),true);
insert into public.employees(id,organization_id,facility_id,first_name,last_name,job_title,department,status)
values(pg_temp.id(207),pg_temp.id(1),pg_temp.id(11),'Changed','Curriculum','Caregiver','Care','active');
select is((select count(*)::int from public.course_assignments where employee_id=pg_temp.id(207)),0,'changed courses suspend automatic application until reapproval');
select ok(exists(select 1 from jsonb_array_elements(pg_temp.preview()->'employees') e where e->>'id'=pg_temp.id(207)::text and not (e->>'already_enrolled')::boolean),'staff skipped by stale automation remains a visible pending match');
select lives_ok($$select public.approve_training_assignment_automation(pg_temp.value('plan'),pg_temp.preview()->>'fingerprint',true)$$,'manager can reapprove changed curriculum');
update public.training_plans set due_date='2000-01-01' where id=pg_temp.value('plan');
insert into public.employees(id,organization_id,facility_id,first_name,last_name,job_title,department,status)
values(pg_temp.id(208),pg_temp.id(1),pg_temp.id(11),'Past','Deadline','Caregiver','Care','active');
select is((select count(*)::int from public.course_assignments where employee_id=pg_temp.id(208)),0,'past dates never automatically assign new staff');
select throws_ok($$select public.approve_training_assignment_automation(pg_temp.value('plan'),pg_temp.preview()->>'fingerprint',true)$$,'40001',null,'past-date automation cannot be approved');
update public.training_plans set due_date='2031-04-01' where id=pg_temp.value('plan');
select lives_ok($$select public.approve_training_assignment_automation(pg_temp.value('plan'),pg_temp.preview()->>'fingerprint',true)$$,'explicit future deadline can be approved');
reset role;
select set_config('request.jwt.claims','{}',true);
insert into public.employees(id,organization_id,facility_id,first_name,last_name,job_title,department,status)
values(pg_temp.id(209),pg_temp.id(1),pg_temp.id(11),'Imported','Noactor','Caregiver','Care','active');
select is((select count(*)::int from public.course_assignments where employee_id=pg_temp.id(209)),0,'system import never impersonates the stored approving administrator');
select pg_temp.act(102);
select lives_ok($$select public.save_training_assignment_rule(pg_temp.value('plan'),'Caregiver',null,true,(select revision from public.training_plan_assignment_rules where training_plan_id=pg_temp.value('plan')))$$,'administrator can edit matching criteria');
select is((select automatic_enabled from public.training_plan_assignment_rules where training_plan_id=pg_temp.value('plan')),false,'editing rule clears prior automatic approval');
select pg_temp.act(103);
select is((select count(*)::int from public.training_plan_assignment_rules),0,'learner cannot read assignment rule authoring state');
select throws_ok($$select public.preview_training_assignment_rule(pg_temp.value('plan'))$$,'42501',null,'learner cannot preview employee matching data');
select pg_temp.act(106);
select throws_ok($$select public.preview_training_assignment_rule(pg_temp.value('plan'))$$,'42501',null,'other tenant cannot preview employee matching data');
reset role;
select set_config('request.jwt.claims','{}',true);
update app_private.module_access_terms set revoked_at=now() where organization_id=pg_temp.id(1);
select pg_temp.act(102);
select is((select count(*)::int from public.training_starter_kits),0,'revoked Training entitlement removes starter-kit access');
select throws_ok($$select public.preview_training_assignment_rule(pg_temp.value('plan'))$$,'42501',null,'revoked entitlement blocks rule preview');
reset role;
select ok(exists(select 1 from public.audit_logs where entity_type='training_starter_kits' and action='training_starter_kits_created'),'global kit authoring is audited');
select ok(exists(select 1 from public.audit_logs where entity_type='training_plan_assignment_rules' and action='training_plan_assignment_rules_updated'),'rule and automatic approval edits are audited');
select * from finish();
rollback;
