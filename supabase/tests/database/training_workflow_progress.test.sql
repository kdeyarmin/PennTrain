begin;
select no_plan();

create function pg_temp.id(n integer) returns uuid language sql immutable as $$
  select ('ea260000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$$;
create function pg_temp.act(n integer, assurance text default 'aal2') returns void language plpgsql as $$
begin
  reset role;
  perform set_config('app.privileged_write', 'off', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.id(n), 'role', 'authenticated',
    'aal', assurance, 'iat', extract(epoch from now())::bigint)::text, true);
  set local role authenticated;
end;
$$;

insert into public.organizations(id, name, slug, subscription_status) values
  (pg_temp.id(1), 'Yearly plan tenant', 'workflow-progress-test', 'active'),
  (pg_temp.id(2), 'Other yearly tenant', 'workflow-progress-other', 'active');
insert into app_private.module_access_terms(organization_id, module_key, source, reason) values
  (pg_temp.id(1), 'modules.train', 'complimentary', 'Disposable yearly training plan test'),
  (pg_temp.id(2), 'modules.train', 'complimentary', 'Disposable yearly training plan test');
insert into public.facilities(id, organization_id, name, facility_type) values
  (pg_temp.id(11), pg_temp.id(1), 'Assigned facility', 'PCH'),
  (pg_temp.id(12), pg_temp.id(1), 'Unassigned facility', 'PCH'),
  (pg_temp.id(13), pg_temp.id(2), 'Other organization', 'PCH');
insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.id(n), 'authenticated', 'authenticated', 'workflow-progress-' || n || '@test.local',
  'x', now(), '{}', '{}', now(), now() from generate_series(101, 106) n;
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, role, email, first_name, last_name, is_active)
select pg_temp.id(n), case when n = 105 then null else pg_temp.id(1) end,
  case n when 101 then 'org_admin' when 102 then 'facility_manager' when 103 then 'employee'
    when 104 then 'trainer' when 105 then 'platform_admin' else 'auditor' end,
  'workflow-progress-' || n || '@test.local', 'Year', 'Plan', true
from generate_series(101, 106) n
on conflict(id) do update set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
-- Use normal role/facility provisioning. Do not add an artificial organization-wide
-- grant: it would hide the manager cancellation permission regression.
insert into public.facility_assignments(profile_id, facility_id) values
  (pg_temp.id(102), pg_temp.id(11)), (pg_temp.id(104), pg_temp.id(11)),
  (pg_temp.id(103), pg_temp.id(11));
insert into public.employees(id, organization_id, facility_id, profile_id, first_name, last_name, job_title, status) values
  (pg_temp.id(201), pg_temp.id(1), pg_temp.id(11), pg_temp.id(103), 'First', 'Student', 'Aide', 'active'),
  (pg_temp.id(202), pg_temp.id(1), pg_temp.id(11), null, 'Second', 'Student', 'Aide', 'active'),
  (pg_temp.id(203), pg_temp.id(1), pg_temp.id(12), null, 'Other', 'Facility', 'Aide', 'active'),
  (pg_temp.id(204), pg_temp.id(1), pg_temp.id(11), null, 'Former', 'Student', 'Aide', 'terminated'),
  (pg_temp.id(205), pg_temp.id(2), pg_temp.id(13), null, 'Other', 'Tenant', 'Aide', 'active'),
  (pg_temp.id(206), pg_temp.id(1), pg_temp.id(11), null, 'Direct', 'Assignment', 'Aide', 'active');
insert into public.courses(id, organization_id, title, status)
select pg_temp.id(n), case when n = 302 then null when n = 305 then pg_temp.id(2) else pg_temp.id(1) end,
  'Yearly course ' || n, 'draft' from generate_series(301, 305) n;
insert into public.course_versions(id, course_id, organization_id, version_number, title)
select pg_temp.id(n + 100), id, organization_id, 1, title from public.courses c
join generate_series(301, 305) n on c.id = pg_temp.id(n);
insert into public.course_blocks(course_version_id, organization_id, block_type, sort_order, title, body)
select id, organization_id, 'text', 0, 'Lesson', '{"content":"Legacy classroom course lesson"}'
from public.course_versions where id in (pg_temp.id(401), pg_temp.id(402), pg_temp.id(403), pg_temp.id(404), pg_temp.id(405));
update public.course_versions set status = 'published', published_at = now()
where id in (pg_temp.id(401), pg_temp.id(402), pg_temp.id(403), pg_temp.id(405));
update public.courses c set status = 'published', current_version_id = v.id
from public.course_versions v where v.course_id = c.id
  and c.id in (pg_temp.id(301), pg_temp.id(302), pg_temp.id(303), pg_temp.id(305));
select set_config('app.privileged_write', 'off', true);

insert into public.training_plans(id, organization_id, facility_id, training_year, due_date, name) values
  (pg_temp.id(502), pg_temp.id(1), pg_temp.id(12), 2026, '2026-12-12', 'Other facility plan'),
  (pg_temp.id(503), pg_temp.id(2), pg_temp.id(13), 2026, '2026-12-12', 'Other tenant plan');
insert into public.training_plans(id, organization_id, name) values (pg_temp.id(504), pg_temp.id(1), 'Legacy curriculum');
create temp table yearly_results(name text primary key, result jsonb);
grant all on yearly_results to authenticated;
create temp table yearly_evidence as select id, course_assignment_id, slug, issued_at from public.certificates where false;
grant all on yearly_evidence to authenticated;


select pg_temp.act(102);
insert into public.training_plans(id,organization_id,facility_id,training_year,due_date,name)
values(pg_temp.id(501),pg_temp.id(1),pg_temp.id(11),2026,public.pa_today()+6,'Required plan');
insert into public.training_plan_items(id,training_plan_id,course_id,is_required) values
(pg_temp.id(601),pg_temp.id(501),pg_temp.id(301),true),
(pg_temp.id(602),pg_temp.id(501),pg_temp.id(302),true);
insert into public.course_assignments(id,organization_id,facility_id,employee_id,course_id,course_version_id,assigned_by,due_date)
values(pg_temp.id(801),pg_temp.id(1),pg_temp.id(11),pg_temp.id(201),pg_temp.id(302),pg_temp.id(402),pg_temp.id(102),public.pa_today()+2);
select is((public.apply_yearly_training_plan(pg_temp.id(501),pg_temp.id(201))->>'assigned')::int,1,'application creates A and leaves individual B untouched');
select lives_ok($$select public.complete_course_assignment((select id from public.course_assignments where employee_id=pg_temp.id(201) and course_id=pg_temp.id(301)))$$,'manager completes A using supported completion command');
select is((public.get_training_plan_progress(pg_temp.id(501))->0->>'required')::int,2,'plan denominator includes unresolved B');
select is((public.get_training_plan_progress(pg_temp.id(501))->0->>'completed')::int,1,'only completed A counts');
select is((public.get_training_plan_progress(pg_temp.id(501))->0->>'unresolved')::int,1,'unfinished individual B remains actionable conflict');
select lives_ok($$select public.resolve_training_plan_assignment(pg_temp.id(501),pg_temp.id(201),pg_temp.id(801))$$,'manager explicitly resolves requirement to existing assignment');
select is((public.get_training_plan_progress(pg_temp.id(501))->0->>'unresolved')::int,0,'resolution closes coverage gap');
select is((public.get_training_plan_progress(pg_temp.id(501))->0->>'completed')::int,1,'resolution does not fabricate completion');
select is((select training_plan_id from public.course_assignments where id=pg_temp.id(801)),null::uuid,'resolution preserves original assignment owner');
select is((select due_date from public.course_assignments where id=pg_temp.id(801)),public.pa_today()+2,'resolution preserves original deadline');
select lives_ok($$select public.complete_course_assignment(pg_temp.id(801))$$,'complete resolved B');
select is((public.get_training_plan_progress(pg_temp.id(501))->0->>'completed')::int,2,'all required completions now count');
insert into public.training_plan_items(id,training_plan_id,course_id) values(pg_temp.id(603),pg_temp.id(501),pg_temp.id(303));
select is((public.get_training_plan_progress(pg_temp.id(501))->0->>'needs_reapply')::boolean,true,'added C visibly invalidates application snapshot');
select is((public.get_training_plan_progress(pg_temp.id(501))->0->>'required')::int,3,'new required C is included before reapplication');
select is((public.get_training_plan_progress(pg_temp.id(501))->0->>'unresolved')::int,1,'new C is unresolved rather than hidden');
select lives_ok($$select public.apply_yearly_training_plan(pg_temp.id(501),pg_temp.id(201))$$,'reapply creates C');
select is((public.get_training_plan_progress(pg_temp.id(501))->0->>'needs_reapply')::boolean,false,'successful application saves current revision');
select is((public.get_training_roster_progress(pg_temp.id(11))->>'active_staff')::int,3,'dashboard includes entire active roster');
select is((public.get_training_roster_progress(pg_temp.id(11))->>'no_assignments')::int,2,'unassigned employees remain visible');
select is((public.get_training_roster_progress(pg_temp.id(11))->>'plan_attention')::int,0,'ordinary unfinished learning is not mislabeled as a plan conflict');
select is((public.get_training_progress_report(pg_temp.id(1),pg_temp.id(11),p_employee_id=>pg_temp.id(201))->>'total')::int,3,'individual transcript selects exact employee');
select is((public.get_training_progress_report(pg_temp.id(1),pg_temp.id(11),p_employee_id=>pg_temp.id(202))->>'total')::int,0,'unassigned individual does not inherit facility assignments');
select is(jsonb_array_length(public.get_training_completion_evidence(pg_temp.id(11),pg_temp.id(201))),2,'both online completions enter evidence view without manual entry');
select is((public.get_training_completion_evidence(pg_temp.id(11),pg_temp.id(201))->0->>'automatic')::boolean,true,'online evidence preserves provenance');
select is((select course_title_snapshot from public.certificates where employee_id=pg_temp.id(201) and course_id=pg_temp.id(301)),'Yearly course 301','certificate snapshots completed version title');
update public.courses set title='Renamed live catalog course',catalog_code='NEW-CODE' where id=pg_temp.id(301);
select is((select course_title from public.verify_certificate((select slug from public.certificates where employee_id=pg_temp.id(201) and course_id=pg_temp.id(301)))),'Yearly course 301','public certificate verification preserves completed title after rename');
select is((select course_code from public.verify_certificate((select slug from public.certificates where employee_id=pg_temp.id(201) and course_id=pg_temp.id(301)))),null::text,'adding live catalog code does not rewrite a null snapshot');
select is((select course_version from public.verify_certificate((select slug from public.certificates where employee_id=pg_temp.id(201) and course_id=pg_temp.id(301)))),'v1','certificate version uses stable version label');
-- All-conflict application must preserve membership even if it creates no assignment.
insert into public.course_assignments(organization_id,facility_id,employee_id,course_id,course_version_id,assigned_by,due_date)
select pg_temp.id(1),pg_temp.id(11),pg_temp.id(202),pg_temp.id(n),pg_temp.id(n+100),pg_temp.id(102),public.pa_today()+1 from generate_series(301,303) n;
select is((public.apply_yearly_training_plan(pg_temp.id(501),pg_temp.id(202))->>'assigned')::int,0,'all-conflict application creates zero plan-owned assignments');
select is((select (v->>'unresolved')::int from jsonb_array_elements(public.get_training_plan_progress(pg_temp.id(501))) v where v->>'employee_id'=pg_temp.id(202)::text),3,'all-conflict employee retains all three unresolved requirements');
select throws_ok($$update public.training_plan_enrollments set applied_snapshot='{}' where employee_id=pg_temp.id(201)$$,'42501',null,'direct snapshot forgery is rejected');
select throws_ok($$select public.resolve_training_plan_assignment(pg_temp.id(501),pg_temp.id(202),pg_temp.id(801))$$,'22023',null,'resolution cannot borrow another employee completion');
insert into yearly_results values('copy',to_jsonb(public.copy_yearly_training_plan(pg_temp.id(501),2027,'2027-12-31','Next annual plan')));
select is((select count(*)::int from public.training_plan_items where training_plan_id=(select (result#>>'{}')::uuid from yearly_results where name='copy')),3,'annual copy contains the selected courses');
select is((select count(*)::int from public.training_plan_enrollments where training_plan_id=(select (result#>>'{}')::uuid from yearly_results where name='copy')),0,'annual copy contains no prior enrollments');
-- Self-enrollment is optional and cannot change another learner or its own obligation.
select pg_temp.act(103,'aal1');
select is(public.self_enroll_course(pg_temp.id(303)),(select id from public.course_assignments where employee_id=pg_temp.id(201) and course_id=pg_temp.id(303)),'self enrollment of existing requirement retains assignment');
select throws_ok($$update public.course_assignments set is_required=false where employee_id=pg_temp.id(201) and course_id=pg_temp.id(303)$$,'42501',null,'learner cannot turn a requirement into an elective');
select throws_ok($$select public.get_training_roster_progress(pg_temp.id(11))$$,'42501',null,'learner cannot read facility report');
select pg_temp.act(102);
delete from public.training_plan_items where id=pg_temp.id(603);
select lives_ok($$select public.apply_yearly_training_plan(pg_temp.id(501),pg_temp.id(201))$$,'removed requirement cancels only unfinished plan course');
select pg_temp.act(103,'aal1');
select lives_ok($$select public.self_enroll_course(pg_temp.id(303))$$,'learner can independently enroll in a removed course');
select is((select is_required from public.course_assignments where employee_id=pg_temp.id(201) and course_id=pg_temp.id(303) and status<>'canceled'),false,'self-selected course is optional');
select is((select assignment_origin from public.course_assignments where employee_id=pg_temp.id(201) and course_id=pg_temp.id(303) and status<>'canceled'),'self_enrolled','self-selected course retains origin');
select pg_temp.act(102);
select is((public.get_training_progress_report(pg_temp.id(1),pg_temp.id(11),p_employee_id=>pg_temp.id(201))->>'required_total')::int,2,'unfinished elective does not increase required denominator');
select is((public.get_training_progress_report(pg_temp.id(1),pg_temp.id(11),p_employee_id=>pg_temp.id(201))->>'required_completed')::int,2,'required progress stays 100 percent with elective open');
select is((public.get_training_progress_report(pg_temp.id(1),pg_temp.id(11),p_employee_id=>pg_temp.id(201))->>'optional_total')::int,1,'elective remains reportable');
select pg_temp.act(106);
select is((select count(*)::int from public.training_plan_enrollments where training_plan_id=pg_temp.id(501)),0,'other tenant cannot read plan enrollment');
select throws_ok($$select public.get_training_plan_progress(pg_temp.id(501))$$,'42501',null,'other tenant cannot query plan progress');
select * from finish();
rollback;
