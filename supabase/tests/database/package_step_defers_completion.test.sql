-- pgTAP coverage for 20260905200000: a package finished the course and issued nothing (I20).
--
-- The SCORM bridge set course_assignments.status = 'completed' itself the moment a vendor package
-- reported done. Issuance lives in complete_course_assignment, so the learner was marked complete
-- with no certificate -- and the completed assignment is exactly what stops them completing it
-- properly afterwards. On a comprehensive version it was worse: the bridge's UPDATE tripped
-- require_comprehensive_self_completion, which since 20260810161000 aborts the transaction, so the
-- learner's commit failed with "Could not save learning progress" every time.
-- Run with: supabase test db.

begin;
select plan(9);

------------------------------------------------------------------------------------------------
-- 1-3. The bridge is gone, and nothing is left wired to it
------------------------------------------------------------------------------------------------
select hasnt_function(
  'public', 'bridge_learning_runtime_completion', array['uuid'],
  'the bridge that completed the course from a package no longer exists'
);
select hasnt_function(
  'public', 'trg_bridge_learning_runtime_completion',
  'nor its trigger function'
);
select is(
  (select count(*)::integer from pg_trigger t
   where t.tgrelid = 'public.learning_runtime_commits'::regclass
     and not t.tgisinternal
     and t.tgname = 'trg_bridge_learning_runtime_completion'),
  0,
  'and no trigger on the commit ledger completes an assignment'
);

------------------------------------------------------------------------------------------------
-- Fixture: one learner, one published course whose version carries a package step
------------------------------------------------------------------------------------------------
insert into public.organizations (id, name, slug) values
  ('d5000000-0000-4000-8000-000000000001', 'Package Org', 'package-org');
insert into public.facilities (id, organization_id, name, facility_type) values
  ('d5000000-0000-4000-8000-000000000011', 'd5000000-0000-4000-8000-000000000001', 'Package Facility', 'PCH');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', 'd5000000-0000-4000-8000-000000000021', 'authenticated',
   'authenticated', 'package-admin@test.local', 'x', now(), '{}'::jsonb, '{}'::jsonb, now(), now(),
   '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', 'd5000000-0000-4000-8000-000000000022', 'authenticated',
   'authenticated', 'package-learner@test.local', 'x', now(), '{}'::jsonb, '{}'::jsonb, now(), now(),
   '', '', '', '', '', '', false, false);

select set_config('app.privileged_write', 'on', true);
insert into public.profiles (id, organization_id, email, first_name, last_name, role, is_active) values
  ('d5000000-0000-4000-8000-000000000021', 'd5000000-0000-4000-8000-000000000001',
   'package-admin@test.local', 'Avery', 'Admin', 'org_admin', true),
  ('d5000000-0000-4000-8000-000000000022', 'd5000000-0000-4000-8000-000000000001',
   'package-learner@test.local', 'Lee', 'Learner', 'employee', true)
on conflict (id) do update set organization_id = excluded.organization_id,
  role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);

insert into public.employees (
  id, organization_id, facility_id, profile_id, first_name, last_name, job_title, status
) values (
  'd5000000-0000-4000-8000-000000000031', 'd5000000-0000-4000-8000-000000000001',
  'd5000000-0000-4000-8000-000000000011', 'd5000000-0000-4000-8000-000000000022',
  'Lee', 'Learner', 'Direct Care Aide', 'active'
);

insert into public.courses (id, organization_id, title, status, estimated_duration_minutes, created_by)
values ('d5000000-0000-4000-8000-000000000041', 'd5000000-0000-4000-8000-000000000001',
        'Packaged Bloodborne Pathogens', 'draft', 10, 'd5000000-0000-4000-8000-000000000021');
insert into public.course_versions (id, course_id, organization_id, version_number, title, status)
values ('d5000000-0000-4000-8000-000000000051', 'd5000000-0000-4000-8000-000000000041',
        'd5000000-0000-4000-8000-000000000001', 1, 'Packaged BBP v1', 'draft');
-- A scorm block must carry its document to publish (get_course_version_publish_issues).
insert into public.training_documents (
  id, organization_id, facility_id, file_name, storage_bucket, storage_path, file_type, document_type
) values (
  'd5000000-0000-4000-8000-000000000062', 'd5000000-0000-4000-8000-000000000001',
  'd5000000-0000-4000-8000-000000000011', 'bbp.zip', 'learning-packages', 'packages/bbp.zip',
  'application/zip', 'other'
);
insert into public.course_blocks (id, course_version_id, organization_id, block_type, sort_order, title, body, document_id)
values ('d5000000-0000-4000-8000-000000000061', 'd5000000-0000-4000-8000-000000000051',
        'd5000000-0000-4000-8000-000000000001', 'scorm', 0, 'Vendor package', '{}'::jsonb,
        'd5000000-0000-4000-8000-000000000062');

select set_config('app.privileged_write', 'on', true);
update public.course_versions set status = 'published', published_at = now()
where id = 'd5000000-0000-4000-8000-000000000051';
update public.courses set current_version_id = 'd5000000-0000-4000-8000-000000000051', status = 'published'
where id = 'd5000000-0000-4000-8000-000000000041';
select set_config('app.privileged_write', 'off', true);

insert into public.course_assignments (
  id, organization_id, facility_id, employee_id, course_id, course_version_id, assigned_by
) values (
  'd5000000-0000-4000-8000-000000000071', 'd5000000-0000-4000-8000-000000000001',
  'd5000000-0000-4000-8000-000000000011', 'd5000000-0000-4000-8000-000000000031',
  'd5000000-0000-4000-8000-000000000041', 'd5000000-0000-4000-8000-000000000051',
  'd5000000-0000-4000-8000-000000000021'
);

-- An accepted package must carry its validation stamp, its immutability stamp and an entry point
-- (learning_packages_check), which is what makes "accepted" mean something.
insert into public.learning_packages (
  id, organization_id, course_version_id, standard_type, storage_path, content_sha256,
  compressed_bytes, expanded_bytes, entry_point, validation_status, validated_at, immutable_at
) values (
  'd5000000-0000-4000-8000-000000000081', 'd5000000-0000-4000-8000-000000000001',
  'd5000000-0000-4000-8000-000000000051', 'scorm_2004_4th', 'packages/bbp.zip', repeat('a', 64),
  1024, 4096, 'index.html', 'accepted', now(), now()
);

-- Enough elapsed progress that the pacing gates are satisfied and the package rule is the only
-- thing left standing between the learner and their certificate.
select set_config('app.privileged_write', 'on', true);
insert into public.course_progress (assignment_id, percent_complete, started_at, last_block_id)
values ('d5000000-0000-4000-8000-000000000071', 100, now() - interval '2 hours',
        'd5000000-0000-4000-8000-000000000061');
select set_config('app.privileged_write', 'off', true);

create or replace function pg_temp.act_as(p_profile_id uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_profile_id, 'role', 'authenticated', 'aal', 'aal2'
  )::text, true);
  execute 'set local role authenticated';
end;
$$;

------------------------------------------------------------------------------------------------
-- 4-6. The package step has to report completion first
------------------------------------------------------------------------------------------------
select pg_temp.act_as('d5000000-0000-4000-8000-000000000022');
select throws_ok(
  $$select public.complete_course_assignment('d5000000-0000-4000-8000-000000000071')$$,
  '23514',
  null,
  'a course carrying a package step cannot be completed before the package reports completion'
);
select is(
  (select status from public.course_assignments where id = 'd5000000-0000-4000-8000-000000000071'),
  'assigned',
  'and the refusal leaves the assignment where it was'
);
select is(
  (select count(*)::integer from public.certificates
   where course_assignment_id = 'd5000000-0000-4000-8000-000000000071'),
  0,
  'with no certificate, which is the state the old bridge produced and called done'
);

------------------------------------------------------------------------------------------------
-- 7-9. Once it reports, the learner completes the course the ordinary way -- and gets the
-- certificate the bridge never issued.
------------------------------------------------------------------------------------------------
reset role;
select set_config('app.privileged_write', 'on', true);
insert into public.learning_runtime_sessions (
  id, organization_id, package_id, assignment_id, employee_id, registration_key,
  runtime_standard, launch_nonce_sha256, state, expires_at
) values (
  'd5000000-0000-4000-8000-000000000091', 'd5000000-0000-4000-8000-000000000001',
  'd5000000-0000-4000-8000-000000000081', 'd5000000-0000-4000-8000-000000000071',
  'd5000000-0000-4000-8000-000000000031', 'reg-key-1', 'scorm_2004_4th', repeat('b', 64),
  -- Deliberately left ACTIVE: start_learning_runtime_session reactivates a finished session on
  -- every relaunch, so a gate that read session state would forget a completed package the moment
  -- the learner reopened it. The commit below is what the gate reads.
  'active', now() + interval '1 hour'
);
insert into public.learning_runtime_commits (
  organization_id, runtime_session_id, idempotency_key, sequence_number,
  completion_status, success_status, raw_state, state_sha256
) values (
  'd5000000-0000-4000-8000-000000000001', 'd5000000-0000-4000-8000-000000000091',
  'commit-1', 1, 'completed', 'passed', '{}'::jsonb, repeat('c', 64)
);
select set_config('app.privileged_write', 'off', true);

select pg_temp.act_as('d5000000-0000-4000-8000-000000000022');
select lives_ok(
  $$select public.complete_course_assignment('d5000000-0000-4000-8000-000000000071')$$,
  'with the package reported complete, the learner completes the course themselves'
);
select is(
  (select status from public.course_assignments where id = 'd5000000-0000-4000-8000-000000000071'),
  'completed',
  'the assignment is completed through the one path that issues evidence'
);
select is(
  (select count(*)::integer from public.certificates
   where course_assignment_id = 'd5000000-0000-4000-8000-000000000071'),
  1,
  'and the certificate exists -- which is the whole point of not letting the bridge do this'
);

select * from finish();
rollback;
