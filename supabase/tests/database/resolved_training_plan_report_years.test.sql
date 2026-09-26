begin;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$
  select ('ec270000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$$;
create function pg_temp.y(delta integer default 0) returns integer language sql stable as $$
  select extract(year from public.pa_today())::integer+delta;
$$;
create function pg_temp.act(n integer) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('app.privileged_write','off',true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated','aal','aal2','iat',extract(epoch from now())::bigint)::text,true);
  set local role authenticated;
end $$;
create function pg_temp.report(p_year integer,p_employee uuid default null,p_plan uuid default null) returns jsonb language sql as $$
  select public.get_training_progress_report(pg_temp.id(1),p_training_year=>p_year,p_employee_id=>p_employee,p_plan_id=>p_plan);
$$;
create function pg_temp.student(p_year integer,p_employee uuid) returns jsonb language sql as $$
  select row from jsonb_array_elements(public.get_training_roster_progress(pg_temp.id(11),p_training_year=>p_year)->'rows') row
    where row->>'employee_id'=p_employee::text;
$$;

insert into public.organizations(id,name,slug,subscription_status,trial_ends_at,package_id)
select v.id,v.name,v.slug,'trial',now()-interval '1 day',p.id from (values
  (pg_temp.id(1),'Resolved reporting tenant','resolved-report-test'),
  (pg_temp.id(2),'Other reporting tenant','resolved-report-other')
) v(id,name,slug) cross join public.packages p where p.name='CareMetric Train';
insert into app_private.module_access_terms(organization_id,module_key,source,reason) values
  (pg_temp.id(1),'modules.train','complimentary','Disposable resolved annual reporting test'),
  (pg_temp.id(2),'modules.train','complimentary','Disposable resolved annual reporting test');
insert into public.facilities(id,organization_id,name,facility_type) values
  (pg_temp.id(11),pg_temp.id(1),'Assigned facility','PCH'),
  (pg_temp.id(12),pg_temp.id(1),'Unassigned facility','PCH'),
  (pg_temp.id(13),pg_temp.id(2),'Other tenant facility','PCH');
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select pg_temp.id(n),'authenticated','authenticated','resolved-report-'||n||'@test.local','x',now(),'{}','{}',now(),now() from generate_series(101,104)n;
select set_config('app.privileged_write','on',true);
insert into public.profiles(id,organization_id,role,email,first_name,last_name,is_active)
select pg_temp.id(n),case when n=104 then pg_temp.id(2) else pg_temp.id(1) end,
  case n when 101 then 'org_admin' when 102 then 'facility_manager' when 103 then 'employee' else 'org_admin' end,
  'resolved-report-'||n||'@test.local','Annual','Reporter',true from generate_series(101,104)n
on conflict(id) do update set organization_id=excluded.organization_id,role=excluded.role,is_active=true;
insert into public.facility_assignments(profile_id,facility_id) values (pg_temp.id(102),pg_temp.id(11)),(pg_temp.id(103),pg_temp.id(11));
insert into public.employees(id,organization_id,facility_id,profile_id,first_name,last_name,job_title,status) values
  (pg_temp.id(201),pg_temp.id(1),pg_temp.id(11),pg_temp.id(103),'Resolved','Learner','Aide','active'),
  (pg_temp.id(202),pg_temp.id(1),pg_temp.id(11),null,'Unresolved','Peer','Aide','active'),
  (pg_temp.id(203),pg_temp.id(1),pg_temp.id(12),null,'Other','Facility','Aide','active'),
  (pg_temp.id(204),pg_temp.id(2),pg_temp.id(13),null,'Other','Tenant','Aide','active');
insert into public.courses(id,title,status) values (pg_temp.id(301),'Annual communication','draft'),(pg_temp.id(302),'Annual handoff','draft');
insert into public.course_versions(id,course_id,version_number,title) values (pg_temp.id(401),pg_temp.id(301),1,'Annual communication'),(pg_temp.id(402),pg_temp.id(302),1,'Annual handoff');
insert into public.course_blocks(course_version_id,block_type,sort_order,title,body)
select pg_temp.id(n),'text',0,'Lesson','{"content":"Original annual report regression lesson."}'::jsonb from generate_series(401,402)n;
update public.course_versions set status='published',published_at=now() where id in (pg_temp.id(401),pg_temp.id(402));
update public.courses c set current_version_id=v.id,status='published' from public.course_versions v where v.course_id=c.id and c.id in (pg_temp.id(301),pg_temp.id(302));
insert into public.course_assignments(id,organization_id,facility_id,employee_id,course_id,course_version_id,due_date,is_required) values
  (pg_temp.id(803),pg_temp.id(1),pg_temp.id(11),pg_temp.id(202),pg_temp.id(301),pg_temp.id(401),make_date(pg_temp.y(-1),12,31),true),
  (pg_temp.id(804),pg_temp.id(1),pg_temp.id(12),pg_temp.id(203),pg_temp.id(301),pg_temp.id(401),make_date(pg_temp.y(),12,31),true),
  (pg_temp.id(805),pg_temp.id(2),pg_temp.id(13),pg_temp.id(204),pg_temp.id(301),pg_temp.id(401),make_date(pg_temp.y(),12,31),true);

select pg_temp.act(102);
insert into public.training_plans(id,organization_id,facility_id,training_year,due_date,name) values
  (pg_temp.id(501),pg_temp.id(1),pg_temp.id(11),pg_temp.y(-1),make_date(pg_temp.y(-1),12,31),'Previous annual plan'),
  (pg_temp.id(502),pg_temp.id(1),pg_temp.id(11),pg_temp.y(),make_date(pg_temp.y(),12,31),'Current annual plan'),
  (pg_temp.id(503),pg_temp.id(1),pg_temp.id(11),pg_temp.y(),make_date(pg_temp.y(),12,31),'Current follow-up plan');
insert into public.training_plan_items(training_plan_id,course_id,is_required) values
  (pg_temp.id(501),pg_temp.id(301),true),(pg_temp.id(502),pg_temp.id(301),true),
  (pg_temp.id(502),pg_temp.id(302),true),(pg_temp.id(503),pg_temp.id(301),true);
insert into public.course_assignments(id,organization_id,facility_id,employee_id,course_id,course_version_id,assigned_by,training_plan_id,due_date,assigned_at,is_required) values
  (pg_temp.id(801),pg_temp.id(1),pg_temp.id(11),pg_temp.id(201),pg_temp.id(301),pg_temp.id(401),pg_temp.id(102),pg_temp.id(501),make_date(pg_temp.y(-1),12,31),make_date(pg_temp.y(-1),1,1)::timestamptz,true),
  (pg_temp.id(802),pg_temp.id(1),pg_temp.id(11),pg_temp.id(201),pg_temp.id(302),pg_temp.id(402),pg_temp.id(102),null,make_date(pg_temp.y(-1),12,31),make_date(pg_temp.y(-1),1,1)::timestamptz,false);
select is(jsonb_array_length(public.apply_yearly_training_plan(pg_temp.id(502),pg_temp.id(201))->'conflicts'),2,'current plan encounters both prior-year plan and individual assignments');
select is((pg_temp.report(pg_temp.y(),pg_temp.id(201))->>'total')::int,0,'unresolved prior-year assignments are not silently attributed to current year');
select lives_ok($$select public.resolve_training_plan_assignment(pg_temp.id(502),pg_temp.id(201),pg_temp.id(801))$$,'manager explicitly reuses previous annual plan assignment');
select lives_ok($$select public.resolve_training_plan_assignment(pg_temp.id(502),pg_temp.id(201),pg_temp.id(802))$$,'manager explicitly reuses previous individual assignment');
select is((public.get_training_plan_progress(pg_temp.id(502))->0->>'unresolved')::int,0,'supported resolution satisfies both plan links');
select is((pg_temp.report(pg_temp.y(),pg_temp.id(201))->>'total')::int,2,'current-year report includes both exact resolved assignments');
select is((pg_temp.report(pg_temp.y(),pg_temp.id(201))->>'required_total')::int,2,'current plan requirement includes the formerly elective assignment');
select is((pg_temp.report(pg_temp.y(-1),pg_temp.id(201))->>'total')::int,2,'original reporting year retains both assignments');
select is((pg_temp.report(pg_temp.y(1),pg_temp.id(201))->>'total')::int,0,'resolution does not leak into an unrelated future year');
select is((pg_temp.report(pg_temp.y(),pg_temp.id(202))->>'total')::int,0,'same course assigned to another student is not attributed by course alone');
select is((pg_temp.report(pg_temp.y(),pg_temp.id(201),pg_temp.id(502))->>'total')::int,2,'year and resolved-plan filters compose');
select is((pg_temp.student(pg_temp.y(),pg_temp.id(201))->>'required_total')::int,2,'current roster denominator includes resolved prior-year assignments');
select is((pg_temp.student(pg_temp.y(-1),pg_temp.id(201))->>'required_total')::int,2,'previous roster denominator retains original assignments');
select is(pg_temp.student(pg_temp.y(),pg_temp.id(201))->>'state','overdue','original deadlines remain actionable rather than showing no assignments');
select is((pg_temp.student(pg_temp.y(),pg_temp.id(202))->>'required_total')::int,0,'unresolved peer remains outside current-year roster denominator');
select is((public.get_training_progress_report(pg_temp.id(1),p_employee_id=>pg_temp.id(201),p_training_year=>pg_temp.y(),p_date_from=>make_date(pg_temp.y(),1,1))->>'total')::int,0,'explicit assignment-date range still uses original assignment date');

select is(jsonb_array_length(public.apply_yearly_training_plan(pg_temp.id(503),pg_temp.id(201))->'conflicts'),1,'second current-year plan encounters the same existing assignment');
select lives_ok($$select public.resolve_training_plan_assignment(pg_temp.id(503),pg_temp.id(201),pg_temp.id(801))$$,'second current-year plan can explicitly reuse the same assignment');
select is((pg_temp.report(pg_temp.y(),pg_temp.id(201))->>'total')::int,2,'multiple same-year plan resolutions never duplicate report rows');
select is(jsonb_array_length(pg_temp.report(pg_temp.y(),pg_temp.id(201))->'rows'),2,'report detail rows also remain deduplicated');
select is((pg_temp.student(pg_temp.y(),pg_temp.id(201))->>'required_total')::int,2,'multiple same-year plan resolutions never duplicate roster denominator');
select is((pg_temp.report(null,pg_temp.id(201))->>'total')::int,2,'all-years report still counts assignments rather than plan links');
select is((select training_plan_id from public.course_assignments where id=pg_temp.id(801)),pg_temp.id(501),'resolution preserves original annual plan ownership');
select is((select due_date from public.course_assignments where id=pg_temp.id(801)),make_date(pg_temp.y(-1),12,31),'resolution preserves original annual deadline');
select is((select due_date from public.course_assignments where id=pg_temp.id(802)),make_date(pg_temp.y(-1),12,31),'resolution preserves original individual deadline');
select lives_ok($$select public.complete_course_assignment(pg_temp.id(801))$$,'completion uses the supported evidence transaction');
select is((pg_temp.report(pg_temp.y(),pg_temp.id(201))->>'required_completed')::int,1,'resolved current-year report counts a real completion once');
select is((pg_temp.report(pg_temp.y(-1),pg_temp.id(201))->>'required_completed')::int,1,'same completion stays visible in original year');
select is((pg_temp.student(pg_temp.y(),pg_temp.id(201))->>'required_completed')::int,1,'resolved current-year roster counts completion once');
select is((pg_temp.report(pg_temp.y())->>'total')::int,2,'facility manager year report excludes another facility and tenant');
select throws_ok($$select public.get_training_progress_report(pg_temp.id(2),p_training_year=>pg_temp.y())$$,'42501',null,'year resolution does not bypass organization report access');
select pg_temp.act(101);
select is((pg_temp.report(pg_temp.y())->>'total')::int,3,'organization administrator includes authorized other facility without duplicates');
select pg_temp.act(103);
select throws_ok($$select pg_temp.report(pg_temp.y())$$,'42501',null,'learner cannot invoke management year report');
select throws_ok($$select public.get_training_roster_progress(pg_temp.id(11),p_training_year=>pg_temp.y())$$,'42501',null,'learner cannot invoke management year roster');
reset role;
select ok(not (select prosecdef from pg_proc where oid='public.get_training_roster_progress(uuid,text,text,integer,integer,integer)'::regprocedure),'roster retains invoker RLS');
select ok(not (select prosecdef from pg_proc where oid='public.get_training_progress_report(uuid,uuid,text,text,text,date,date,integer,integer,uuid,uuid,text,text,integer,text)'::regprocedure),'report retains invoker RLS');
select * from finish();
rollback;
