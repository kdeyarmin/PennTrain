begin;
select no_plan();

create function pg_temp.id(n integer) returns uuid language sql immutable as $$
  select ('ea270000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$$;
create function pg_temp.act(n integer, assurance text default 'aal2') returns void language plpgsql as $$
begin
  reset role;
  perform set_config('app.privileged_write', 'off', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.id(n), 'role', 'authenticated',
    'session_id', pg_temp.id(n + 1000), 'aal', assurance, 'iat', extract(epoch from now())::bigint)::text, true);
  set local role authenticated;
end;
$$;

insert into public.organizations(id, name, slug, subscription_status, trial_ends_at, package_id)
select pg_temp.id(1), 'Catalog authority tenant', 'catalog-authority-test', 'trial', now() - interval '1 day', id
from public.packages where name = 'CareMetric Train';
insert into app_private.module_access_terms(organization_id, module_key, source, reason)
values (pg_temp.id(1), 'modules.train', 'complimentary', 'Disposable catalog authority test');
insert into public.facilities(id, organization_id, name, facility_type)
values (pg_temp.id(11), pg_temp.id(1), 'Assigned facility', 'PCH');
insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.id(n), 'authenticated', 'authenticated', 'catalog-authority-' || n || '@test.local', 'x', now(), '{}', '{}', now(), now()
from generate_series(101, 105) n;
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, role, email, first_name, last_name, is_active)
select pg_temp.id(n), case when n = 101 then null else pg_temp.id(1) end,
  case n when 101 then 'platform_admin' when 102 then 'org_admin' when 103 then 'facility_manager' when 104 then 'trainer' else 'employee' end,
  'catalog-authority-' || n || '@test.local', 'Catalog', 'Tester', true
from generate_series(101, 105) n
on conflict (id) do update set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
insert into auth.sessions(id, user_id, created_at, updated_at)
select pg_temp.id(n + 1000), pg_temp.id(n), now(), now() from generate_series(101, 105) n;
insert into public.facility_assignments(profile_id, facility_id) values (pg_temp.id(103), pg_temp.id(11)), (pg_temp.id(104), pg_temp.id(11));
insert into public.employees(id, organization_id, facility_id, first_name, last_name, job_title, status)
select pg_temp.id(n), pg_temp.id(1), pg_temp.id(11), 'Student', n::text, 'Caregiver', 'active' from generate_series(201, 203) n;
insert into public.courses(id, organization_id, title, status) values
  (pg_temp.id(301), pg_temp.id(1), 'Published tenant course', 'draft'),
  (pg_temp.id(302), null, 'Published global course', 'draft'),
  (pg_temp.id(303), pg_temp.id(1), 'Tenant draft', 'draft');
insert into public.course_versions(id, course_id, organization_id, version_number, title)
select pg_temp.id(n + 100), c.id, c.organization_id, 1, c.title from public.courses c join generate_series(301, 303) n on c.id = pg_temp.id(n);
insert into public.course_blocks(course_version_id, organization_id, block_type, sort_order, title, body)
select id, organization_id, 'text', 0, 'Lesson', '{"content":"Existing approved lesson"}'
from public.course_versions where id in (pg_temp.id(401), pg_temp.id(402), pg_temp.id(403));
update public.course_versions set status = 'published', published_at = now() where id in (pg_temp.id(401), pg_temp.id(402));
update public.courses c set status = 'published', current_version_id = v.id from public.course_versions v
where v.course_id = c.id and c.id in (pg_temp.id(301), pg_temp.id(302));
insert into public.learning_packages(id, organization_id, course_version_id, standard_type, storage_path, content_sha256, compressed_bytes, entry_point, validation_status)
values (pg_temp.id(501), pg_temp.id(1), pg_temp.id(403), 'scorm_1_2', 'fixture.zip', repeat('a', 64), 1, 'index.html', 'pending');
select set_config('app.privileged_write', 'off', true);

select ok(not has_function_privilege('anon', 'public.unpublish_course(uuid,text)', 'execute'), 'anonymous callers cannot unpublish courses');
select ok(not has_function_privilege('authenticated', 'app_private.assert_learning_package_scope(uuid,uuid,boolean)', 'execute'), 'clients cannot call the internal media authorizer with a forged actor');

-- Exercise the real internal scope authorizer as the database owner. Public
-- package/media RPCs derive p_actor from the current session before using it.
select is(app_private.assert_learning_package_scope(pg_temp.id(102), pg_temp.id(403), false), pg_temp.id(303), 'tenant administrator retains scoped package inspection');
select throws_ok(format('select app_private.assert_learning_package_scope(%L,%L,true)', pg_temp.id(n), pg_temp.id(403)),
  '42501', 'Only super admins can change course packages and media.', 'tenant role ' || n || ' cannot author package or media content')
from generate_series(102, 104) n;
select is(app_private.assert_learning_package_scope(pg_temp.id(101), pg_temp.id(403), true), pg_temp.id(303), 'super admin can author draft package content');

select pg_temp.act(102);
select throws_ok($$select public.unpublish_course(pg_temp.id(301), 'Retire this content')$$, '42501', 'Only super admins can unpublish courses', 'organization admin cannot unpublish even an organization-owned course');
select throws_ok($$insert into public.courses(organization_id, title) values (pg_temp.id(1), 'Unauthorized course')$$, '42501', null, 'organization admin cannot create course content directly');
select throws_ok($$select public.publish_course_version(pg_temp.id(403))$$, '42501', null, 'organization admin cannot publish a course');
select throws_ok($$select public.register_learning_package(pg_temp.id(403), 'scorm_1_2', 'draft.zip', repeat('b',64), 1, 'index.html', null)$$,
  '42501', 'Only super admins can change course packages and media.', 'organization admin cannot use the package registration RPC to change a draft');
select throws_ok($$select public.quarantine_learning_package(pg_temp.id(501), 'Retire this package')$$, '42501', 'Only super admins can quarantine course packages', 'organization admin cannot remove a course package from use');
select lives_ok($$insert into public.course_assignments(organization_id, facility_id, employee_id, course_id, course_version_id, status)
  values (pg_temp.id(1), pg_temp.id(11), pg_temp.id(201), pg_temp.id(302), pg_temp.id(402), 'assigned')$$, 'organization admin can enroll students in an existing global course');

select pg_temp.act(103);
select throws_ok($$select public.unpublish_course(pg_temp.id(301), 'Retire this content')$$, '42501', 'Only super admins can unpublish courses', 'facility manager cannot unpublish a course');
select throws_ok($$insert into public.courses(organization_id, title) values (pg_temp.id(1), 'Unauthorized course')$$, '42501', null, 'facility manager cannot create course content directly');
select throws_ok($$select public.register_learning_package(pg_temp.id(403), 'scorm_1_2', 'draft.zip', repeat('b',64), 1, 'index.html', null)$$,
  '42501', 'Only super admins can change course packages and media.', 'facility manager cannot replace draft package content through its RPC');
select throws_ok($$select public.quarantine_learning_package(pg_temp.id(501), 'Retire this package')$$, '42501', 'Only super admins can quarantine course packages', 'facility manager cannot quarantine a course package');
select lives_ok($$insert into public.course_assignments(organization_id, facility_id, employee_id, course_id, course_version_id, status)
  values (pg_temp.id(1), pg_temp.id(11), pg_temp.id(202), pg_temp.id(302), pg_temp.id(402), 'assigned')$$, 'facility manager can enroll students at an assigned facility');

select pg_temp.act(104);
select throws_ok($$select public.unpublish_course(pg_temp.id(301), 'Retire this content')$$, '42501', 'Only super admins can unpublish courses', 'trainer cannot unpublish a course');
select throws_ok($$select public.register_learning_package(pg_temp.id(403), 'scorm_1_2', 'draft.zip', repeat('b',64), 1, 'index.html', null)$$,
  '42501', 'Only super admins can change course packages and media.', 'trainer cannot change draft packages');
select lives_ok($$insert into public.course_assignments(organization_id, facility_id, employee_id, course_id, course_version_id, status)
  values (pg_temp.id(1), pg_temp.id(11), pg_temp.id(203), pg_temp.id(302), pg_temp.id(402), 'assigned')$$, 'trainer retains existing student enrollment permissions');

select pg_temp.act(105);
select throws_ok($$select public.unpublish_course(pg_temp.id(301), 'Retire this content')$$, '42501', 'Only super admins can unpublish courses', 'student cannot retire course content');
select pg_temp.act(101, 'aal1');
select throws_ok($$select public.unpublish_course(pg_temp.id(301), 'Retire this content')$$, '42501', null, 'super admin still needs fresh MFA to unpublish');
select pg_temp.act(101);
select throws_ok($$select public.unpublish_course(pg_temp.id(301), 'short')$$, '22023', 'A reason of at least 8 characters is required', 'super admin must still supply an audit reason');
select lives_ok($$select public.unpublish_course(pg_temp.id(301), 'Retire this content')$$, 'super admin can unpublish an organization-owned course');
select is((select status from public.courses where id = pg_temp.id(301)), 'archived', 'unpublished course is archived');
select is((select count(*) from public.audit_logs where entity_id = pg_temp.id(301)::text and action = 'unpublished' and new_values->>'reason' = 'Retire this content'), 1::bigint, 'unpublishing retains its audit reason');
select lives_ok($$select public.quarantine_learning_package(pg_temp.id(501), 'Quarantine reviewed content')$$, 'super admin retains package quarantine');
select is((select validation_status from public.learning_packages where id = pg_temp.id(501)), 'quarantined', 'package quarantine remains effective');
select is((select count(*) from public.course_assignments where course_id = pg_temp.id(302)), 3::bigint, 'enrollment records remain intact');

reset role;
select * from finish();
rollback;
