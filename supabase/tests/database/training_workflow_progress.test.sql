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
select pg_temp.id(n), case when n = 105 then null when n = 106 then pg_temp.id(2) else pg_temp.id(1) end,
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
select is((public.get_training_roster_progress(pg_temp.id(11),p_state=>'due_soon')->>'total')::int,(public.get_training_roster_progress(pg_temp.id(11))->>'due_soon')::int,'due-soon card includes staff who also have plan conflicts');
select throws_ok($$update public.training_plan_enrollments set applied_snapshot='{}' where employee_id=pg_temp.id(201)$$,'42501',null,'direct snapshot forgery is rejected');
select throws_ok($$select public.resolve_training_plan_assignment(pg_temp.id(501),pg_temp.id(202),pg_temp.id(801))$$,'22023',null,'resolution cannot borrow another employee completion');
insert into yearly_results values('copy',to_jsonb(public.copy_yearly_training_plan(pg_temp.id(501),2027,'2027-12-31','Next annual plan')));
select is((select count(*)::int from public.training_plan_items where training_plan_id=(select (result#>>'{}')::uuid from yearly_results where name='copy')),3,'annual copy contains the selected courses');
select is((select count(*)::int from public.training_plan_enrollments where training_plan_id=(select (result#>>'{}')::uuid from yearly_results where name='copy')),0,'annual copy contains no prior enrollments');
-- Self-enrollment is optional and cannot change another learner or its own obligation.
select pg_temp.act(103,'aal1');
select is(public.self_enroll_course(pg_temp.id(303)),(select id from public.course_assignments where employee_id=pg_temp.id(201) and course_id=pg_temp.id(303)),'self enrollment of existing requirement retains assignment');
update public.course_assignments set is_required=false where employee_id=pg_temp.id(201) and course_id=pg_temp.id(303);
select is((select is_required from public.course_assignments where employee_id=pg_temp.id(201) and course_id=pg_temp.id(303)),true,'RLS prevents learner from changing required course to elective');
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
-- Effective requiredness follows an explicit cross-plan resolution without rewriting origin.
insert into public.training_plan_items(training_plan_id,course_id,is_required) values(pg_temp.id(501),pg_temp.id(303),true);
select lives_ok($$select public.apply_yearly_training_plan(pg_temp.id(501),pg_temp.id(201))$$,'reapplying exposes existing elective as conflict');
select lives_ok($$select public.resolve_training_plan_assignment(pg_temp.id(501),pg_temp.id(201),(select id from public.course_assignments where employee_id=pg_temp.id(201) and course_id=pg_temp.id(303) and status<>'canceled'))$$,'explicit resolution requires existing elective for plan');
select is((public.get_training_progress_report(pg_temp.id(1),pg_temp.id(11),p_employee_id=>pg_temp.id(201))->>'required_total')::int,3,'plan-required elective participates in required report denominator');
select is((select is_required from public.course_assignments where employee_id=pg_temp.id(201) and course_id=pg_temp.id(303) and status<>'canceled'),false,'resolved elective retains its original assignment classification');
select pg_temp.act(103,'aal1');
select is(cardinality(public.get_training_required_assignments(pg_temp.id(201))),3,'learner sees all three actual required courses');
select is(cardinality(public.get_training_required_assignments(pg_temp.id(202))),0,'learner cannot read peer obligations');
select pg_temp.act(102);
select lives_ok($$select public.set_training_assignment_exemption(pg_temp.id(206),2026,'No online courses assigned to this classroom-only worker')$$,'manager records reasoned annual assignment exemption');
select is((public.get_training_roster_progress(pg_temp.id(11),p_training_year=>2026)->>'exempt')::int,1,'deliberate exemption is distinguishable from omission');
select is((public.get_training_roster_progress(pg_temp.id(11),p_training_year=>2027)->>'exempt')::int,0,'exemption cannot roll silently into next training year');
select lives_ok($$select public.set_training_assignment_exemption(pg_temp.id(206),2026,null)$$,'manager can remove an exemption with retained row audit');
select is((public.get_training_roster_progress(pg_temp.id(11),p_training_year=>2026)->>'exempt')::int,0,'removed exemption returns to needs assignments');
select throws_ok($$select public.get_training_reminder_receipts(pg_temp.id(12))$$,'42501',null,'reminder receipts cannot bypass facility-manager scope');
select throws_ok($$select public.get_training_partner_facilities()$$,'42501',null,'facility managers cannot read owner partner overview');
select pg_temp.act(103,'aal1');
select throws_ok($$select public.set_training_assignment_exemption(pg_temp.id(201),2026,'Attempt to waive my own courses')$$,'42501',null,'learner cannot exempt their own assignments');
select pg_temp.act(105);
select is((public.get_training_partner_facilities(p_search=>'Yearly plan tenant')->>'total')::int,2,'owner can follow both facilities in complimentary training organization');
select pg_temp.act(102);
-- Projection uses real recorded credit, never catalog duration, and exposes only eligible topics.
reset role;
insert into public.course_completion_credits(course_assignment_id,course_id,course_version_id,organization_id,facility_id,employee_id,
  training_type_id,topic_code,credit_hours,training_year,citation_note,credited_at)
select a.id,a.course_id,a.course_version_id,a.organization_id,a.facility_id,a.employee_id,t.id,topic,1,2026,'Test of existing governed credit projection',now()
from public.course_assignments a cross join public.training_types t cross join (values('PCH-2600.65-F1'),('PCH-2600.65-G1')) codes(topic)
where a.employee_id=pg_temp.id(201) and a.course_id=pg_temp.id(301) and t.code='DIRECT-ANNUAL';
select pg_temp.act(102);
select is((select (v->'allocations'->>'base')::numeric from jsonb_array_elements(public.get_training_completion_evidence(pg_temp.id(11),pg_temp.id(201))) v where v->>'course_assignment_id'=(select id::text from public.course_assignments where employee_id=pg_temp.id(201) and course_id=pg_temp.id(301))),60::numeric,'multiple topic credits do not duplicate the same hour bucket');
select ok((select v->'topics' ? 'med_self_admin' and not(v->'topics' ? 'fire') from jsonb_array_elements(public.get_training_completion_evidence(pg_temp.id(11),pg_temp.id(201))) v where v->>'course_assignment_id'=(select id::text from public.course_assignments where employee_id=pg_temp.id(201) and course_id=pg_temp.id(301))),'eligible online topic projects while qualified fire instruction is not automatically asserted');
reset role;
insert into public.training_evidence_events(organization_id,facility_id,employee_id,title,completed_on,minutes,delivery,provider,source_reference,course_assignment_id,created_by,status)
values(pg_temp.id(1),pg_temp.id(11),pg_temp.id(201),'Linked outside evidence',public.pa_today(),60,'external','Test provider','workflow-evidence-link',pg_temp.id(801),pg_temp.id(102),'pending');
select pg_temp.act(102);
select is(jsonb_array_length(public.get_training_completion_evidence(pg_temp.id(11),pg_temp.id(201))),2,'pending outside evidence cannot hide a proven online completion');
reset role;
update public.training_evidence_events set status='verified',reviewed_by=pg_temp.id(102),reviewed_at=now(),review_note='Verified against the completed course' where course_assignment_id=pg_temp.id(801);
select pg_temp.act(102);
select is(jsonb_array_length(public.get_training_completion_evidence(pg_temp.id(11),pg_temp.id(201))),1,'verified linked evidence replaces its projection to prevent duplicate hours');
-- Facility-scale test: 200 employees, three annual cycles, 1,800 course assignments.
-- It exercises the real authorized dashboard RPC with the migrated 80-course library.
reset role;
select set_config('request.jwt.claims','{}',true);
select set_config('app.privileged_write','on',true);
insert into public.employees(id,organization_id,facility_id,first_name,last_name,job_title,status)
select pg_temp.id(1000+n),pg_temp.id(1),pg_temp.id(11),'Scale',lpad(n::text,3,'0'),'Aide','active' from generate_series(1,200) n;
insert into public.course_assignments(organization_id,facility_id,employee_id,course_id,course_version_id,due_date,assigned_at,status,canceled_at,cancellation_reason)
select pg_temp.id(1),pg_temp.id(11),pg_temp.id(1000+n),pg_temp.id(c),pg_temp.id(c+100),make_date(y,12,31),make_timestamptz(y,1,1,12,0,0,'America/New_York'),
case when y=2026 then 'assigned' else 'canceled' end,
case when y<2026 then make_timestamptz(y,12,31,12,0,0,'America/New_York') end,
case when y<2026 then 'Prior annual fixture closed with retained history' end
from generate_series(1,200) n cross join generate_series(301,303) c cross join generate_series(2024,2026) y;
select set_config('app.privileged_write','off',true);
analyze public.employees;
analyze public.course_assignments;
create function pg_temp.measure_training_roster() returns jsonb language plpgsql as $$
declare started timestamptz:=clock_timestamp(); result jsonb;
begin
  result:=public.get_training_roster_progress(pg_temp.id(11),p_search=>'Scale',p_training_year=>2026,p_limit=>50);
  return jsonb_build_object('report',result,'elapsed_ms',extract(epoch from clock_timestamp()-started)*1000);
end;
$$;
select pg_temp.act(102);
insert into yearly_results values('scale',pg_temp.measure_training_roster());
select is((select (result->'report'->>'active_staff')::int from yearly_results where name='scale'),200,'representative-scale dashboard includes every matching employee');
select is((select jsonb_array_length(result->'report'->'rows') from yearly_results where name='scale'),50,'dashboard returns one bounded staff page');
select cmp_ok((select (result->>'elapsed_ms')::numeric from yearly_results where name='scale'),'<',5000::numeric,'200-staff dashboard server query completes within five seconds');
select diag('200 staff / 3 years / 1800 assignments; dashboard RPC: '||(select result->>'elapsed_ms' from yearly_results where name='scale')||' ms');
select pg_temp.act(106);
select is((select count(*)::int from public.training_plan_enrollments where training_plan_id=pg_temp.id(501)),0,'other tenant cannot read plan enrollment');
select throws_ok($$select public.get_training_plan_progress(pg_temp.id(501))$$,'42501',null,'other tenant cannot query plan progress');
select * from finish();
rollback;
