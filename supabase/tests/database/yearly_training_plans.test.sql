begin;
select no_plan();

create function pg_temp.id(n integer) returns uuid language sql immutable as $$
  select ('ea250000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
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
  (pg_temp.id(1), 'Yearly plan tenant', 'yearly-plan-test', 'active'),
  (pg_temp.id(2), 'Other yearly tenant', 'yearly-plan-other', 'active');
insert into app_private.module_access_terms(organization_id, module_key, source, reason) values
  (pg_temp.id(1), 'modules.train', 'complimentary', 'Disposable yearly training plan test'),
  (pg_temp.id(2), 'modules.train', 'complimentary', 'Disposable yearly training plan test');
insert into public.facilities(id, organization_id, name, facility_type) values
  (pg_temp.id(11), pg_temp.id(1), 'Assigned facility', 'PCH'),
  (pg_temp.id(12), pg_temp.id(1), 'Unassigned facility', 'PCH'),
  (pg_temp.id(13), pg_temp.id(2), 'Other organization', 'PCH');
insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.id(n), 'authenticated', 'authenticated', 'year-plan-' || n || '@test.local',
  'x', now(), '{}', '{}', now(), now() from generate_series(101, 106) n;
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, role, email, first_name, last_name, is_active)
select pg_temp.id(n), case when n = 105 then null else pg_temp.id(1) end,
  case n when 101 then 'org_admin' when 102 then 'facility_manager' when 103 then 'employee'
    when 104 then 'trainer' when 105 then 'platform_admin' else 'auditor' end,
  'year-plan-' || n || '@test.local', 'Year', 'Plan', true
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

select ok(not has_function_privilege('anon', 'public.apply_yearly_training_plan(uuid,uuid)', 'execute'), 'anonymous callers cannot apply plans');
select ok(not has_function_privilege('anon', 'public.assert_yearly_training_plan_employee(uuid,uuid)', 'execute'), 'anonymous callers cannot invoke employee lock helper');
select is((select prorettype from pg_proc where oid = 'public.assert_yearly_training_plan_employee(uuid,uuid)'::regprocedure), 'void'::regtype::oid,
  'scoped lock helper returns no employee data');
select is((select prosecdef from pg_proc where oid = 'public.apply_yearly_training_plan(uuid,uuid)'::regprocedure), false, 'apply keeps table RLS active');
select ok(not has_schema_privilege('authenticated', 'app_private', 'usage'), 'private schema remains inaccessible to client queries');
select pg_temp.act(102);
select is(public.has_effective_permission('training.sessions.manage', 'facility', pg_temp.id(11)), true, 'normal manager grant covers own facility');
select is(public.has_effective_permission('training.sessions.manage', 'organization', pg_temp.id(1)), false, 'fixture has no fabricated organization-wide manager permission');
select lives_ok($$insert into public.training_plans(id, organization_id, facility_id, training_year, due_date, name)
  values(pg_temp.id(501), pg_temp.id(1), pg_temp.id(11), 2026, '2027-01-15', 'Annual plan')$$,
  'assigned facility manager creates annual plan with explicitly entered date outside plan year');
select throws_ok($$insert into public.training_plans(organization_id, facility_id, training_year, name)
  values(pg_temp.id(1), pg_temp.id(11), 2026, 'Missing date')$$, '23514', null, 'annual plan cannot calculate or omit deadline');
select throws_ok($$insert into public.training_plans(organization_id, facility_id, due_date, name)
  values(pg_temp.id(1), pg_temp.id(11), '2026-12-12', 'Missing year')$$, '23514', null, 'annual plan requires year');
select throws_ok($$insert into public.training_plans(organization_id, facility_id, training_year, due_date, name)
  values(pg_temp.id(1), pg_temp.id(11), 2201, '2026-12-12', 'Invalid year')$$, '23514', null, 'annual year is bounded');
select throws_ok($$insert into public.training_plans(organization_id, facility_id, training_year, due_date, name)
  values(pg_temp.id(1), pg_temp.id(12), 2026, '2026-12-12', 'Wrong facility')$$, '42501', null, 'manager cannot author another facility plan');
select throws_ok($$insert into public.training_plans(organization_id, name) values(pg_temp.id(1), 'Org-wide manager plan')$$,
  '42501', null, 'manager cannot turn annual permission into legacy organization-wide authoring');
select is((select count(*)::int from public.training_plans where id in (pg_temp.id(502), pg_temp.id(503))), 0,
  'manager cannot read another facility or tenant annual plan');
select lives_ok($$insert into public.training_plan_items(id, training_plan_id, course_id, sort_order) values
  (pg_temp.id(601), pg_temp.id(501), pg_temp.id(301), 0),
  (pg_temp.id(602), pg_temp.id(501), pg_temp.id(302), 1)$$, 'annual plan accepts own and global catalog courses');
select throws_ok($$insert into public.training_plan_items(training_plan_id, course_id)
  values(pg_temp.id(501), pg_temp.id(305))$$, '23514', null, 'plan cannot contain another tenant course');
select throws_ok($$insert into public.course_assignments(organization_id, facility_id, employee_id, course_id,
  course_version_id, assigned_by, due_date, training_plan_id, training_plan_item_id)
  values(pg_temp.id(1), pg_temp.id(11), pg_temp.id(206), pg_temp.id(302), pg_temp.id(402),
    pg_temp.id(102), '2027-01-15', pg_temp.id(501), pg_temp.id(601))$$, '23514', null,
  'annual insert refuses mismatched supplied item before canonicalizing provenance');
select throws_ok($$insert into public.course_assignments(organization_id, facility_id, employee_id, course_id,
  course_version_id, assigned_by, due_date, training_plan_id)
  values(pg_temp.id(1), pg_temp.id(11), pg_temp.id(206), pg_temp.id(303), pg_temp.id(403),
    pg_temp.id(102), '2027-01-15', pg_temp.id(501))$$, '23514', null,
  'omitting annual item reference cannot bypass current plan course membership');
select lives_ok($$insert into public.course_assignments(id, organization_id, facility_id, employee_id, course_id,
  course_version_id, assigned_by, due_date, training_plan_id, training_plan_item_id)
  values(pg_temp.id(807), pg_temp.id(1), pg_temp.id(11), pg_temp.id(206), pg_temp.id(301), pg_temp.id(401),
    pg_temp.id(102), '2027-01-15', pg_temp.id(501), pg_temp.id(601))$$,
  'valid supplied annual item is accepted and normalized to stable plan/course provenance');
select is((select training_plan_item_id from public.course_assignments where id = pg_temp.id(807)), null::uuid,
  'direct annual insert does not retain the editable-item foreign key');
select throws_ok($$select public.apply_yearly_training_plan(pg_temp.id(502), pg_temp.id(203))$$, '42501', null, 'manager cannot apply other facility plan');
select throws_ok($$select public.apply_yearly_training_plan(pg_temp.id(501), pg_temp.id(203))$$, '42501', null, 'student must be in plan facility');
select throws_ok($$select public.apply_yearly_training_plan(pg_temp.id(501), pg_temp.id(204))$$, '42501', null, 'inactive student cannot receive or reconcile plan');
select throws_ok($$select public.apply_yearly_training_plan(pg_temp.id(501), pg_temp.id(205))$$, '42501', null, 'student must be in plan tenant');
select throws_ok($$select public.assert_yearly_training_plan_employee(pg_temp.id(502), pg_temp.id(203))$$, '42501', null,
  'direct employee helper cannot target an unassigned facility plan');
select throws_ok($$select public.assert_yearly_training_plan_employee(pg_temp.id(503), pg_temp.id(205))$$, '42501', null,
  'direct employee helper cannot target another tenant plan');
select throws_ok($$select public.assert_yearly_training_plan_employee(pg_temp.id(501), pg_temp.id(203))$$, '42501', null,
  'direct employee helper validates student facility independently');
select throws_ok($$select public.assert_yearly_training_plan_employee(pg_temp.id(501), pg_temp.id(205))$$, '42501', null,
  'direct employee helper validates student tenant independently');
select throws_ok($$select public.assert_yearly_training_plan_employee(pg_temp.id(501), pg_temp.id(204))$$, '42501', null,
  'direct employee helper refuses inactive student');

insert into yearly_results values('first', public.apply_yearly_training_plan(pg_temp.id(501), pg_temp.id(201)));
select is((select result from yearly_results where name = 'first'),
  '{"assigned":2,"updated":0,"canceled":0,"already_completed":0,"conflicts":[]}'::jsonb, 'first apply assigns complete bundle atomically');
select is((select count(*)::int from public.course_assignments where employee_id = pg_temp.id(201)
  and due_date = '2027-01-15' and training_plan_id = pg_temp.id(501)), 2, 'all course deadlines equal exact entered date');
select is((select count(*)::int from public.course_assignments where employee_id = pg_temp.id(201)
  and training_plan_id = pg_temp.id(501) and training_plan_item_id is null), 2,
  'annual apply records stable source plan/course without acquiring editable item foreign-key locks');
select is(public.apply_yearly_training_plan(pg_temp.id(501), pg_temp.id(201)),
  '{"assigned":0,"updated":0,"canceled":0,"already_completed":0,"conflicts":[]}'::jsonb, 'retry makes no duplicate assignments or unnecessary updates');
select is((public.apply_yearly_training_plan(pg_temp.id(501), pg_temp.id(202))->>'assigned')::int, 2, 'same plan can be applied to another selected student');

select throws_ok($$update public.training_plans set training_year = 2027 where id = pg_temp.id(501)$$,
  '55000', null, 'used plan cannot be reclassified into a different training year');
select throws_ok($$delete from public.training_plans where id = pg_temp.id(501)$$,
  '55000', null, 'used plan cannot delete assignment provenance');
select throws_ok($$update public.course_assignments set training_plan_id = null, training_plan_item_id = null
  where training_plan_id = pg_temp.id(501) and employee_id = pg_temp.id(201)$$,
  '55000', null, 'direct update cannot strip yearly assignment provenance');
select lives_ok($$select public.complete_course_assignment((select id from public.course_assignments
  where employee_id = pg_temp.id(201) and course_id = pg_temp.id(301)))$$, 'normal manager completion records real retained evidence');
insert into yearly_evidence select id, course_assignment_id, slug, issued_at from public.certificates
  where employee_id = pg_temp.id(201) and course_id = pg_temp.id(301);
select is((select count(*)::int from yearly_evidence), 1, 'completed course has an issued certificate');
insert into public.course_assignments(organization_id, facility_id, employee_id, course_id, course_version_id, assigned_by, due_date)
values(pg_temp.id(1), pg_temp.id(11), pg_temp.id(201), pg_temp.id(303), pg_temp.id(403), pg_temp.id(102), '2026-11-09');
select throws_ok($$update public.course_assignments set training_plan_id = pg_temp.id(501), training_plan_item_id = pg_temp.id(601)
  where employee_id = pg_temp.id(201) and course_id = pg_temp.id(303)$$,
  '55000', null, 'unrelated assignment cannot be adopted through a direct provenance update');

-- Support historical annual references as well as fresh normalized rows.
update public.course_assignments set training_plan_item_id = pg_temp.id(602)
where training_plan_id = pg_temp.id(501) and course_id = pg_temp.id(302);
select is((select count(*)::int from public.course_assignments where training_plan_id = pg_temp.id(501)
  and training_plan_item_id = pg_temp.id(602)), 2, 'historical annual item references remain supported');
-- Removing an item invokes its FK SET NULL action on existing assignments.
select lives_ok($$delete from public.training_plan_items where id = pg_temp.id(602)$$, 'used course can be removed while its assignments retain source plan');
select is((select count(*)::int from public.course_assignments where course_id = pg_temp.id(302)
  and training_plan_id = pg_temp.id(501) and training_plan_item_id is null), 2, 'removed item retains both plan assignment histories');
insert into public.training_plan_items(id, training_plan_id, course_id) values(pg_temp.id(603), pg_temp.id(501), pg_temp.id(303));
update public.training_plans set due_date = '2027-02-21' where id = pg_temp.id(501);
insert into yearly_results values('reapply', public.apply_yearly_training_plan(pg_temp.id(501), pg_temp.id(201)));
select is((select result - 'conflicts' from yearly_results where name = 'reapply'),
  '{"assigned":0,"updated":0,"canceled":1,"already_completed":1}'::jsonb, 'reapply cancels removed unfinished course and preserves completed course');
select is((select result->'conflicts'->0->>'course_id' from yearly_results where name = 'reapply'), pg_temp.id(303)::text,
  'reapply reports unrelated open course as a conflict');
select is((select result->'conflicts'->0->>'due_date' from yearly_results where name = 'reapply'), '2026-11-09',
  'conflict includes the preserved unrelated deadline');
select is((select due_date from public.course_assignments where employee_id = pg_temp.id(201) and course_id = pg_temp.id(301)), '2027-01-15'::date,
  'completed assignment keeps its original deadline');
select is((select status from public.course_assignments where employee_id = pg_temp.id(201) and course_id = pg_temp.id(302)), 'canceled',
  'normal facility-scoped manager can cancel removed course through reapply');
select is(public.apply_yearly_training_plan(pg_temp.id(501), pg_temp.id(202)),
  '{"assigned":1,"updated":1,"canceled":1,"already_completed":0,"conflicts":[]}'::jsonb,
  'other student receives added course, updated deadline, and removal');
select is((select count(*)::int from public.course_assignments where employee_id = pg_temp.id(201) and course_id = pg_temp.id(301)), 1,
  'reapply never creates another copy of already completed plan course');
select results_eq($$select id, course_assignment_id, slug, issued_at from public.certificates
  where employee_id = pg_temp.id(201) and course_id = pg_temp.id(301)$$,
  $$select id, course_assignment_id, slug, issued_at from yearly_evidence$$, 'certificate identity and issuance are unchanged');
select is((public.apply_yearly_training_plan(pg_temp.id(501), pg_temp.id(201))->>'canceled')::int, 0, 'retry does not recancel removed history');

-- A bad current bundle cannot partially change due dates or cancel old courses.
insert into public.training_plan_items(id, training_plan_id, course_id) values(pg_temp.id(604), pg_temp.id(501), pg_temp.id(304));
update public.training_plans set due_date = '2027-03-15' where id = pg_temp.id(501);
select throws_ok($$select public.apply_yearly_training_plan(pg_temp.id(501), pg_temp.id(202))$$, '23514', null,
  'any draft or missing current version rejects the entire application');
select is((select count(*)::int from public.course_assignments where employee_id = pg_temp.id(202)
  and status = 'assigned' and due_date = '2027-02-21'), 2, 'failed apply leaves every existing open deadline untouched');
delete from public.training_plan_items where id = pg_temp.id(604);

-- Preserve completion even if its item is removed and later re-added.
select lives_ok($$delete from public.training_plan_items where id = pg_temp.id(601)$$, 'completed course item can be removed without deleting evidence');
insert into public.training_plan_items(id, training_plan_id, course_id) values(pg_temp.id(605), pg_temp.id(501), pg_temp.id(301));
select is((public.apply_yearly_training_plan(pg_temp.id(501), pg_temp.id(201))->>'already_completed')::int, 1,
  're-added completed course is recognized by stable plan/course identity');

-- Deadline restoration mirrors the status job without waiting for it to run.
reset role;
select set_config('app.privileged_write', 'on', true);
update public.course_assignments set status = 'overdue', due_date = public.pa_today() - 1
where employee_id = pg_temp.id(202) and course_id = pg_temp.id(301);
update public.course_assignments set status = 'paused', due_date = public.pa_today() - 1
where employee_id = pg_temp.id(202) and course_id = pg_temp.id(303);
select pg_temp.act(102);
update public.training_plans set due_date = public.pa_today() + 1 where id = pg_temp.id(501);
select is((public.apply_yearly_training_plan(pg_temp.id(501), pg_temp.id(202))->>'updated')::int, 2, 'deadline extension updates own overdue and paused deadlines');
select is((select status from public.course_assignments where employee_id = pg_temp.id(202) and course_id = pg_temp.id(301)), 'assigned',
  'extended overdue assignment immediately stops showing overdue');
select is((select status from public.course_assignments where employee_id = pg_temp.id(202) and course_id = pg_temp.id(303)), 'paused',
  'deadline change preserves paused state');

select pg_temp.act(103);
select is((select count(*)::int from public.training_plans where id = pg_temp.id(501)), 1,
  'same-facility learner can read the plan without management rights');
select is((select count(*)::int from (select id from public.training_plans where id = pg_temp.id(501) for no key update) locked), 0,
  'UPDATE policy independently refuses the readable plan lock to a learner');
select throws_ok($$select public.assert_yearly_training_plan_employee(pg_temp.id(501), pg_temp.id(201))$$, '42501', null,
  'learner cannot invoke employee lock helper despite reading their facility plan');
select throws_ok($$select public.apply_yearly_training_plan(pg_temp.id(501), pg_temp.id(201))$$, '42501', null, 'learner cannot apply their own plan');
select throws_ok($$insert into public.training_plans(organization_id, facility_id, training_year, due_date, name)
  values(pg_temp.id(1), pg_temp.id(11), 2026, '2026-12-12', 'Learner plan')$$, '42501', null, 'learner cannot author plan');
select pg_temp.act(102, 'aal1');
select throws_ok($$select public.apply_yearly_training_plan(pg_temp.id(501), pg_temp.id(201))$$, '42501', null, 'unverified manager session cannot apply plan');
select throws_ok($$select public.assert_yearly_training_plan_employee(pg_temp.id(501), pg_temp.id(201))$$, '42501', null,
  'unverified manager session cannot invoke employee lock helper');
select pg_temp.act(106);
select is((select count(*)::int from public.training_plans where id = pg_temp.id(501)), 1, 'auditor can read annual plan');
select throws_ok($$select public.assert_yearly_training_plan_employee(pg_temp.id(501), pg_temp.id(201))$$, '42501', null,
  'auditor cannot invoke employee lock helper despite facility visibility');
select throws_ok($$select public.apply_yearly_training_plan(pg_temp.id(501), pg_temp.id(201))$$, '42501', null,
  'auditor cannot apply annual plan');
select pg_temp.act(104);
select is((select count(*)::int from (select id from public.employees where id = pg_temp.id(202) for update) locked), 0,
  'trainer still lacks employee UPDATE scope');
select lives_ok($$select public.assert_yearly_training_plan_employee(pg_temp.id(501), pg_temp.id(202))$$,
  'assigned trainer can acquire the per-student application lock without employee UPDATE rights');
select lives_ok($$select public.apply_yearly_training_plan(pg_temp.id(501), pg_temp.id(202))$$, 'assigned trainer may apply annual plan');
select pg_temp.act(101);
select throws_ok($$select public.apply_yearly_training_plan(pg_temp.id(504), pg_temp.id(201))$$, '22023', null, 'annual RPC does not silently convert legacy plan');
select lives_ok($$update public.training_plans set name = 'Legacy edited' where id = pg_temp.id(504)$$, 'legacy organization curriculum editing remains available');
insert into public.training_plan_items(id, training_plan_id, course_id) values(pg_temp.id(606), pg_temp.id(504), pg_temp.id(302));
insert into public.course_assignments(id, organization_id, facility_id, employee_id, course_id, course_version_id,
  assigned_by, training_plan_id, training_plan_item_id)
values(pg_temp.id(806), pg_temp.id(1), pg_temp.id(12), pg_temp.id(203), pg_temp.id(302), pg_temp.id(402),
  pg_temp.id(101), pg_temp.id(504), pg_temp.id(606));
select throws_ok($$update public.training_plans set facility_id = pg_temp.id(12), training_year = 2026,
  due_date = '2026-12-12' where id = pg_temp.id(504)$$, '55000', null,
  'used legacy curriculum cannot retroactively claim annual assignment provenance');
select throws_ok($$update public.course_assignments set facility_id = pg_temp.id(11) where id = pg_temp.id(806)$$,
  '55000', null, 'ordinary legacy assignment updates still enforce evidence scope identity');
select lives_ok($$update public.course_assignments set due_date = public.pa_today() + 7 where id = pg_temp.id(806)$$,
  'ordinary legacy deadline update preserves its unchanged parent provenance');
select results_eq($$select training_plan_id, training_plan_item_id from public.course_assignments where id = pg_temp.id(806)$$,
  $$select pg_temp.id(504), pg_temp.id(606)$$, 'legacy deadline update retains both provenance references');
select lives_ok($$delete from public.training_plans where id = pg_temp.id(504)$$, 'legacy used template deletion remains supported');
select is((select training_plan_id from public.course_assignments where id = pg_temp.id(806)), null::uuid,
  'legacy template deletion detaches plan and preserves assignment');
select is((select training_plan_item_id from public.course_assignments where id = pg_temp.id(806)), null::uuid,
  'legacy template deletion also detaches its item after both FK actions');
select is((select due_date from public.course_assignments where id = pg_temp.id(806)), public.pa_today() + 7,
  'legacy template deletion preserves the independently entered assignment deadline');
select lives_ok($$update public.training_plans set name = 'Other site edited' where id = pg_temp.id(502)$$, 'organization admin may manage every tenant facility');
select throws_ok($$update public.training_plans set facility_id = pg_temp.id(12) where id = pg_temp.id(501)$$, '55000', null,
  'used annual plan cannot move facilities even for organization administrator');
select pg_temp.act(105);
select lives_ok($$update public.training_plans set name = 'Platform reviewed' where id = pg_temp.id(503)$$, 'platform administrator may manage another tenant plan');

-- Real lifecycle transfers move unfinished training, preserving original plan
-- provenance and completed/canceled evidence at the original facility.
select pg_temp.act(101);
select throws_ok($$update public.course_assignments set facility_id = pg_temp.id(12)
  where employee_id = pg_temp.id(202) and course_id = pg_temp.id(301)$$, '55000', null,
  'direct annual assignment facility tampering remains blocked by the existing evidence identity guard');
select lives_ok($$select public.apply_employee_lifecycle_transition(pg_temp.id(202), 'transfer', public.pa_today(),
  pg_temp.id(12), 'Transfer annual plan student to another facility')$$,
  'authorized lifecycle transfers open and paused annual assignments');
select is((select count(*)::int from public.course_assignments where employee_id = pg_temp.id(202)
  and status in ('assigned', 'paused') and facility_id = pg_temp.id(12) and training_plan_id = pg_temp.id(501)), 2,
  'transferred unfinished assignments keep the original annual plan provenance');
select throws_ok($$select public.apply_yearly_training_plan(pg_temp.id(501), pg_temp.id(202))$$, '42501', null,
  'even organization administrator cannot reapply the old facility plan after transfer');
select lives_ok($$update public.course_assignments set due_date = public.pa_today() + 7
  where employee_id = pg_temp.id(202) and course_id = pg_temp.id(301)$$,
  'transferred annual assignment accepts authorized deadline changes at its new facility');
select lives_ok($$select public.complete_course_assignment((select id from public.course_assignments
  where employee_id = pg_temp.id(202) and course_id = pg_temp.id(301)))$$,
  'transferred annual assignment can complete normally while retaining its original plan');
select is((select count(*)::int from public.certificates c join public.course_assignments a on a.id = c.course_assignment_id
  where a.employee_id = pg_temp.id(202) and a.course_id = pg_temp.id(301) and a.training_plan_id = pg_temp.id(501)
    and a.status = 'completed' and c.facility_id = pg_temp.id(12)), 1,
  'completion after transfer issues evidence at the new facility without relabeling its source plan');
select pg_temp.act(101);
select throws_ok($$update public.course_assignments set facility_id = pg_temp.id(11)
  where employee_id = pg_temp.id(202) and course_id = pg_temp.id(303)$$, '55000', null,
  'transfer does not grant a later direct facility retagging bypass');
select lives_ok($$select public.apply_employee_lifecycle_transition(pg_temp.id(201), 'transfer', public.pa_today(),
  pg_temp.id(12), 'Transfer student while preserving prior completed annual evidence')$$,
  'lifecycle transfer also accepts student with completed annual plan evidence');
select is((select facility_id from public.course_assignments where employee_id = pg_temp.id(201) and course_id = pg_temp.id(301)), pg_temp.id(11),
  'completed annual assignment remains at the source facility after employee transfer');
select results_eq($$select id, course_assignment_id, slug, issued_at from public.certificates
  where employee_id = pg_temp.id(201) and course_id = pg_temp.id(301)$$,
  $$select id, course_assignment_id, slug, issued_at from yearly_evidence$$,
  'employee transfer preserves the original completed certificate identity and issuance');
select pg_temp.act(102);
select throws_ok($$select public.apply_yearly_training_plan(pg_temp.id(501), pg_temp.id(202))$$, '42501', null,
  'transferred student cannot have historical plan reconciled by former facility manager');
select throws_ok($$select public.apply_yearly_training_plan(pg_temp.id(501), pg_temp.id(201))$$, '42501', null,
  'former facility manager cannot reapply the transferred student completed plan either');
select finish();
rollback;
