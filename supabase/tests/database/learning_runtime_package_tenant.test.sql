begin;
select plan(7);

insert into public.organizations(id, name, slug) values
  ('d8000000-0000-4000-8000-000000000001', 'Runtime Owner', 'runtime-package-owner'),
  ('d8000000-0000-4000-8000-000000000002', 'Runtime Other', 'runtime-package-other');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('d8000000-0000-4000-8000-000000000011', 'd8000000-0000-4000-8000-000000000001', 'Runtime Facility', 'PCH');
insert into auth.users(instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous)
values ('00000000-0000-0000-0000-000000000000', 'd8000000-0000-4000-8000-000000000021',
  'authenticated', 'authenticated', 'runtime-learner@test.local', 'x', now(), '{}', '{}', now(), now(),
  '', '', '', '', '', '', false, false);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active)
values ('d8000000-0000-4000-8000-000000000021', 'd8000000-0000-4000-8000-000000000001',
  'runtime-learner@test.local', 'Runtime', 'Learner', 'employee', true)
on conflict(id) do update set organization_id=excluded.organization_id, role=excluded.role, is_active=true;
insert into public.employees(id, organization_id, facility_id, profile_id, first_name, last_name, job_title, status)
values ('d8000000-0000-4000-8000-000000000031', 'd8000000-0000-4000-8000-000000000001',
  'd8000000-0000-4000-8000-000000000011', 'd8000000-0000-4000-8000-000000000021',
  'Runtime', 'Learner', 'Direct Care Aide', 'active');
insert into public.courses(id, organization_id, title, status, created_by)
values ('d8000000-0000-4000-8000-000000000041', null, 'Shared Runtime Course', 'draft',
  'd8000000-0000-4000-8000-000000000021');
insert into public.course_versions(id, course_id, organization_id, version_number, title, status)
values ('d8000000-0000-4000-8000-000000000051', 'd8000000-0000-4000-8000-000000000041',
  null, 1, 'Shared Runtime Version', 'draft');
insert into public.course_blocks(course_version_id, organization_id, block_type, sort_order, title, body)
values ('d8000000-0000-4000-8000-000000000051', null, 'text', 0, 'Introduction', '{"content":"Runtime test"}');
update public.course_versions set status='published', published_at=now() where id='d8000000-0000-4000-8000-000000000051';
update public.courses set current_version_id='d8000000-0000-4000-8000-000000000051', status='published'
where id='d8000000-0000-4000-8000-000000000041';
insert into public.course_assignments(id, organization_id, facility_id, employee_id, course_id, course_version_id, status)
values ('d8000000-0000-4000-8000-000000000071', 'd8000000-0000-4000-8000-000000000001',
  'd8000000-0000-4000-8000-000000000011', 'd8000000-0000-4000-8000-000000000031',
  'd8000000-0000-4000-8000-000000000041', 'd8000000-0000-4000-8000-000000000051', 'assigned');
select set_config('app.privileged_write', 'off', true);

-- Same shared course version, three different package scopes. The foreign package is newest,
-- so automatic selection must exclude it as well as the explicit-ID path.
insert into public.learning_packages(id, organization_id, course_version_id, standard_type,
  storage_path, content_sha256, compressed_bytes, expanded_bytes, entry_point,
  validation_status, validated_at, immutable_at)
select package_id, org_id, 'd8000000-0000-4000-8000-000000000051', 'scorm_2004_4th',
  package_id::text || '/package.zip', repeat(replace(package_id::text, '-', ''), 2), 100, 1000, 'index.html',
  'accepted', now() + freshness, now()
from (values
  ('d8000000-0000-4000-8000-000000000081'::uuid, 'd8000000-0000-4000-8000-000000000001'::uuid, interval '0 seconds'),
  ('d8000000-0000-4000-8000-000000000082'::uuid, 'd8000000-0000-4000-8000-000000000002'::uuid, interval '2 seconds'),
  ('d8000000-0000-4000-8000-000000000083'::uuid, null::uuid, interval '1 second')
) as packages(package_id, org_id, freshness);

select set_config('request.jwt.claims', jsonb_build_object(
  'sub', 'd8000000-0000-4000-8000-000000000021', 'role', 'authenticated', 'aal', 'aal1')::text, true);
set local role authenticated;

select is((select count(*)::integer from public.learning_packages
  where id='d8000000-0000-4000-8000-000000000082'), 0, 'RLS hides the foreign package');
select throws_ok($$select public.start_learning_runtime_session(
  'd8000000-0000-4000-8000-000000000071', 'd8000000-0000-4000-8000-000000000082')$$,
  'P0002', 'No accepted learning package is available for this assignment',
  'an explicit UUID cannot bypass the package tenant boundary');
select is((select count(*)::integer from public.learning_runtime_sessions
  where package_id='d8000000-0000-4000-8000-000000000082'), 0,
  'a refused launch creates no foreign-package runtime context');
select is(public.start_learning_runtime_session('d8000000-0000-4000-8000-000000000071',
  'd8000000-0000-4000-8000-000000000081')->>'packageId',
  'd8000000-0000-4000-8000-000000000081', 'an explicit own-tenant package still launches');
select is(public.start_learning_runtime_session('d8000000-0000-4000-8000-000000000071',
  'd8000000-0000-4000-8000-000000000083')->>'packageId',
  'd8000000-0000-4000-8000-000000000083', 'an explicit globally shared package still launches');
select is(public.start_learning_runtime_session('d8000000-0000-4000-8000-000000000071')->>'packageId',
  'd8000000-0000-4000-8000-000000000083', 'automatic selection skips the newest foreign package');
select is(public.start_learning_runtime_session('d8000000-0000-4000-8000-000000000071',
  'd8000000-0000-4000-8000-000000000081')->>'reused', 'true', 'relaunch still resumes the owned session');

reset role;
select * from finish();
rollback;
