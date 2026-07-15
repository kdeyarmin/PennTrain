begin;
select plan(35);

insert into public.organizations(id, name, slug, subscription_status) values
  ('91000000-0000-4000-8000-000000000001', 'P1 Org A', 'p1-org-a', 'active'),
  ('91000000-0000-4000-8000-000000000002', 'P1 Org B', 'p1-org-b', 'active');

insert into public.facilities(id, organization_id, name, facility_type) values
  ('91000000-0000-4000-8000-000000000011', '91000000-0000-4000-8000-000000000001', 'P1 Facility A1', 'PCH'),
  ('91000000-0000-4000-8000-000000000012', '91000000-0000-4000-8000-000000000001', 'P1 Facility A2', 'PCH'),
  ('91000000-0000-4000-8000-000000000013', '91000000-0000-4000-8000-000000000002', 'P1 Facility B1', 'ALR');

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
)
select
  '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated',
  v.email, 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false
from (values
  ('91000000-0000-4000-8000-000000000101'::uuid, 'p1-admin-a@test.local'),
  ('91000000-0000-4000-8000-000000000102'::uuid, 'p1-inactive-admin-a@test.local'),
  ('91000000-0000-4000-8000-000000000103'::uuid, 'p1-manager-a@test.local'),
  ('91000000-0000-4000-8000-000000000104'::uuid, 'p1-trainer-a@test.local'),
  ('91000000-0000-4000-8000-000000000105'::uuid, 'p1-trainer-a2@test.local'),
  ('91000000-0000-4000-8000-000000000106'::uuid, 'p1-auditor-a@test.local'),
  ('91000000-0000-4000-8000-000000000107'::uuid, 'p1-employee-a@test.local'),
  ('91000000-0000-4000-8000-000000000108'::uuid, 'p1-moved-user@test.local'),
  ('91000000-0000-4000-8000-000000000109'::uuid, 'p1-admin-b@test.local'),
  ('91000000-0000-4000-8000-000000000110'::uuid, 'p1-employee-b@test.local')
) v(id, email);

select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('91000000-0000-4000-8000-000000000101', '91000000-0000-4000-8000-000000000001', 'p1-admin-a@test.local', 'P1', 'Admin A', 'org_admin', true),
  ('91000000-0000-4000-8000-000000000102', '91000000-0000-4000-8000-000000000001', 'p1-inactive-admin-a@test.local', 'P1', 'Inactive Admin', 'org_admin', false),
  ('91000000-0000-4000-8000-000000000103', '91000000-0000-4000-8000-000000000001', 'p1-manager-a@test.local', 'P1', 'Manager', 'facility_manager', true),
  ('91000000-0000-4000-8000-000000000104', '91000000-0000-4000-8000-000000000001', 'p1-trainer-a@test.local', 'P1', 'Trainer A', 'trainer', true),
  ('91000000-0000-4000-8000-000000000105', '91000000-0000-4000-8000-000000000001', 'p1-trainer-a2@test.local', 'P1', 'Trainer A2', 'trainer', true),
  ('91000000-0000-4000-8000-000000000106', '91000000-0000-4000-8000-000000000001', 'p1-auditor-a@test.local', 'P1', 'Auditor', 'auditor', true),
  ('91000000-0000-4000-8000-000000000107', '91000000-0000-4000-8000-000000000001', 'p1-employee-a@test.local', 'P1', 'Employee A', 'employee', true),
  ('91000000-0000-4000-8000-000000000108', '91000000-0000-4000-8000-000000000001', 'p1-moved-user@test.local', 'P1', 'Moved User', 'employee', true),
  ('91000000-0000-4000-8000-000000000109', '91000000-0000-4000-8000-000000000002', 'p1-admin-b@test.local', 'P1', 'Admin B', 'org_admin', true),
  ('91000000-0000-4000-8000-000000000110', '91000000-0000-4000-8000-000000000002', 'p1-employee-b@test.local', 'P1', 'Employee B', 'employee', true)
on conflict(id) do update set organization_id = excluded.organization_id,
  role = excluded.role, is_active = excluded.is_active;
select set_config('app.privileged_write', 'off', true);

insert into public.facility_assignments(profile_id, facility_id) values
  ('91000000-0000-4000-8000-000000000103', '91000000-0000-4000-8000-000000000011'),
  ('91000000-0000-4000-8000-000000000104', '91000000-0000-4000-8000-000000000011'),
  ('91000000-0000-4000-8000-000000000108', '91000000-0000-4000-8000-000000000011');

insert into public.employees(
  id, organization_id, facility_id, profile_id, first_name, last_name, job_title, status
) values
  ('91000000-0000-4000-8000-000000000201', '91000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000011', '91000000-0000-4000-8000-000000000107', 'P1', 'Employee A', 'Aide', 'active'),
  ('91000000-0000-4000-8000-000000000202', '91000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000011', '91000000-0000-4000-8000-000000000108', 'P1', 'Moved User', 'Aide', 'active'),
  ('91000000-0000-4000-8000-000000000203', '91000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000013', '91000000-0000-4000-8000-000000000110', 'P1', 'Employee B', 'Aide', 'active');

insert into public.training_types(
  id, organization_id, code, name, category, renewal_interval_days,
  warning_days_default, is_system_default
) values
  ('91000000-0000-4000-8000-000000000301', '91000000-0000-4000-8000-000000000001', 'P1-A', 'P1 Training A', 'other', 365, 30, false),
  ('91000000-0000-4000-8000-000000000302', '91000000-0000-4000-8000-000000000002', 'P1-B', 'P1 Training B', 'other', 365, 30, false);

insert into public.training_classes(
  id, organization_id, facility_id, trainer_profile_id, training_type_id,
  class_name, class_date, duration_hours
) values
  ('91000000-0000-4000-8000-000000000401', '91000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000011', '91000000-0000-4000-8000-000000000104', '91000000-0000-4000-8000-000000000301', 'Trainer A class', current_date + 1, 1),
  ('91000000-0000-4000-8000-000000000402', '91000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000011', '91000000-0000-4000-8000-000000000105', '91000000-0000-4000-8000-000000000301', 'Other trainer class', current_date + 1, 1);

insert into public.schedules(
  id, organization_id, facility_id, title, period_start, period_end, status, created_by
) values (
  '91000000-0000-4000-8000-000000000501', '91000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000011', 'P1 published schedule', current_date,
  current_date + 7, 'published', '91000000-0000-4000-8000-000000000101'
);
insert into public.shift_assignments(
  id, organization_id, schedule_id, facility_id, employee_id,
  shift_date, start_time, end_time, status, source
) values (
  '91000000-0000-4000-8000-000000000502', '91000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000501', '91000000-0000-4000-8000-000000000011',
  '91000000-0000-4000-8000-000000000202', current_date + 1, '08:00', '16:00', 'scheduled', 'manual'
);
insert into public.support_tickets(
  id, organization_id, created_by, subject, category, priority, status
) values (
  '91000000-0000-4000-8000-000000000503', '91000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000108', 'P1 stale ticket', 'technical_issue', 'normal', 'open'
);

insert into public.training_documents(
  id, organization_id, facility_id, employee_id, file_name, storage_bucket,
  storage_path, file_type, uploaded_by_profile_id, document_type
) values
  ('91000000-0000-4000-8000-000000000601', '91000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000011', '91000000-0000-4000-8000-000000000201', 'own.pdf', 'external-uploads', '91000000-0000-4000-8000-000000000001/91000000-0000-4000-8000-000000000011/own.pdf', 'application/pdf', '91000000-0000-4000-8000-000000000107', 'external_certificate'),
  ('91000000-0000-4000-8000-000000000602', '91000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000011', null, 'other.pdf', 'external-uploads', '91000000-0000-4000-8000-000000000001/91000000-0000-4000-8000-000000000011/other.pdf', 'application/pdf', '91000000-0000-4000-8000-000000000101', 'other');

insert into public.binder_export_jobs(
  id, organization_id, requested_by, facility_ids, status, completed_at,
  storage_bucket, storage_path
) values
  ('91000000-0000-4000-8000-000000000701', '91000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000103', array['91000000-0000-4000-8000-000000000011'::uuid], 'succeeded', now(), 'binder-exports', '91000000-0000-4000-8000-000000000001/scoped.pdf'),
  ('91000000-0000-4000-8000-000000000702', '91000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000103', '{}', 'succeeded', now(), 'binder-exports', '91000000-0000-4000-8000-000000000001/org-wide.pdf');

insert into storage.objects(bucket_id, name, owner_id) values
  ('external-uploads', '91000000-0000-4000-8000-000000000001/91000000-0000-4000-8000-000000000011/own.pdf', '91000000-0000-4000-8000-000000000107'),
  ('external-uploads', '91000000-0000-4000-8000-000000000001/91000000-0000-4000-8000-000000000011/other.pdf', '91000000-0000-4000-8000-000000000101'),
  ('competency-attachments', '91000000-0000-4000-8000-000000000001/91000000-0000-4000-8000-000000000011/competency.pdf', '91000000-0000-4000-8000-000000000104'),
  ('signin-sheets', '91000000-0000-4000-8000-000000000001/91000000-0000-4000-8000-000000000011/91000000-0000-4000-8000-000000000401/roster.pdf', '91000000-0000-4000-8000-000000000104'),
  ('signin-sheets', '91000000-0000-4000-8000-000000000001/91000000-0000-4000-8000-000000000011/91000000-0000-4000-8000-000000000402/other-roster.pdf', '91000000-0000-4000-8000-000000000105'),
  ('course-documents', 'system/91000000-0000-4000-8000-000000000801/platform.pdf', '91000000-0000-4000-8000-000000000101'),
  ('binder-exports', '91000000-0000-4000-8000-000000000001/scoped.pdf', null),
  ('binder-exports', '91000000-0000-4000-8000-000000000001/org-wide.pdf', null);

create or replace function pg_temp.act_as(p_id uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_id, 'role', p_role, 'aal', 'aal2', 'iat', extract(epoch from now())::bigint
  )::text, true);
  if p_role = 'service_role' then set local role service_role;
  else set local role authenticated;
  end if;
end
$$;

-- Storage API deletes set this transaction-local guard before issuing their SQL.
-- The tests mirror that real boundary so RLS, rather than the direct-SQL safety trigger,
-- determines which rows may be removed.
select set_config('storage.allow_delete_query', 'true', true);

select pg_temp.act_as('91000000-0000-4000-8000-000000000101');
select ok(public.is_assigned_to_facility('91000000-0000-4000-8000-000000000011'), 'org admin retains same-tenant facility scope');
select ok(not public.is_assigned_to_facility('91000000-0000-4000-8000-000000000013'), 'org admin cannot authorize a cross-tenant facility identifier');
select throws_ok($$
  insert into public.facility_assignments(profile_id, facility_id)
  values ('91000000-0000-4000-8000-000000000110', '91000000-0000-4000-8000-000000000012')
$$, '42501', null, 'org admin cannot assign a different tenant profile');
select lives_ok($$
  insert into public.facility_assignments(profile_id, facility_id)
  values ('91000000-0000-4000-8000-000000000105', '91000000-0000-4000-8000-000000000012')
$$, 'org admin can assign an active same-tenant profile');
select throws_ok($$
  insert into public.training_classes(
    organization_id, facility_id, trainer_profile_id, training_type_id,
    class_name, class_date, duration_hours
  ) values (
    '91000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000013',
    '91000000-0000-4000-8000-000000000104', '91000000-0000-4000-8000-000000000301',
    'Cross-tenant facility', current_date + 1, 1
  )
$$, '23514', null, 'training class rejects a cross-tenant facility');
select throws_ok($$
  insert into public.training_classes(
    organization_id, facility_id, trainer_profile_id, training_type_id,
    class_name, class_date, duration_hours
  ) values (
    '91000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000011',
    '91000000-0000-4000-8000-000000000104', '91000000-0000-4000-8000-000000000302',
    'Cross-tenant type', current_date + 1, 1
  )
$$, '23514', null, 'training class rejects a cross-tenant training type');
select throws_ok($$
  insert into public.training_classes(
    organization_id, facility_id, trainer_profile_id, training_type_id,
    class_name, class_date, duration_hours
  ) values (
    '91000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000011',
    '91000000-0000-4000-8000-000000000109', '91000000-0000-4000-8000-000000000301',
    'Cross-tenant trainer', current_date + 1, 1
  )
$$, '23514', null, 'training class rejects a cross-tenant trainer');
select throws_ok($$
  insert into public.training_class_attendees(class_id, employee_id)
  values ('91000000-0000-4000-8000-000000000401', '91000000-0000-4000-8000-000000000203')
$$, '23514', null, 'class writer cannot enroll another tenant employee');
select lives_ok($$
  insert into public.training_class_attendees(class_id, employee_id)
  values ('91000000-0000-4000-8000-000000000401', '91000000-0000-4000-8000-000000000201')
$$, 'same-tenant employee enrollment remains valid');

select pg_temp.act_as('91000000-0000-4000-8000-000000000102');
select throws_ok($$
  insert into public.facility_assignments(profile_id, facility_id)
  values ('91000000-0000-4000-8000-000000000107', '91000000-0000-4000-8000-000000000012')
$$, '42501', null, 'inactive org admin cannot administer facility assignments');

select pg_temp.act_as('91000000-0000-4000-8000-000000000104');
select throws_ok($$
  insert into public.training_classes(
    organization_id, facility_id, trainer_profile_id, training_type_id,
    class_name, class_date, duration_hours
  ) values (
    '91000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000012',
    '91000000-0000-4000-8000-000000000104', '91000000-0000-4000-8000-000000000301',
    'Unassigned facility', current_date + 1, 1
  )
$$, '42501', null, 'trainer cannot create a class outside assigned facilities');
select isnt_empty($$
  update public.training_classes set notes = 'legitimate trainer update'
  where id = '91000000-0000-4000-8000-000000000401' returning 1
$$, 'trainer can update their own assigned-facility class');
select is_empty($$
  update public.training_classes set notes = 'cross-class update'
  where id = '91000000-0000-4000-8000-000000000402' returning 1
$$, 'trainer cannot update another trainer class');
select is((select count(*)::integer from storage.objects where bucket_id = 'signin-sheets'), 1, 'trainer reads only their own class roster object');
select is((select count(*)::integer from storage.objects where bucket_id = 'signin-sheets' and name like '%0000402/%'), 0, 'other class roster remains hidden from assigned trainer');
select is_empty($$
  delete from storage.objects where bucket_id = 'signin-sheets' and name like '%0000402/%' returning 1
$$, 'trainer cannot delete another class roster');
select is_empty($$
  update storage.objects set metadata = '{"attempted":true}'
  where bucket_id = 'course-documents' returning 1
$$, 'tenant trainer cannot overwrite platform course assets');

select pg_temp.act_as('91000000-0000-4000-8000-000000000107');
select is((select count(*)::integer from storage.objects where bucket_id = 'external-uploads'), 1, 'employee reads only their own external upload');
select is((select count(*)::integer from storage.objects where bucket_id = 'competency-attachments'), 0, 'employee cannot read competency attachments');
select is((select count(*)::integer from storage.objects where bucket_id = 'signin-sheets'), 0, 'employee cannot read facility sign-in sheets');

select pg_temp.act_as('91000000-0000-4000-8000-000000000106');
select is((select count(*)::integer from storage.objects where bucket_id = 'external-uploads'), 2, 'auditor retains read-only review access to tenant external uploads');
select is_empty($$
  delete from storage.objects where bucket_id = 'external-uploads' returning 1
$$, 'auditor cannot delete external uploads');
select is((select count(*)::integer from storage.objects where bucket_id = 'competency-attachments'), 1, 'auditor retains read access to competency evidence');
select is_empty($$
  delete from storage.objects where bucket_id = 'competency-attachments' returning 1
$$, 'auditor cannot delete competency evidence');
select is((select count(*)::integer from storage.objects where bucket_id = 'signin-sheets'), 2, 'auditor retains read access to sign-in sheets');
select is_empty($$
  delete from storage.objects where bucket_id = 'signin-sheets' returning 1
$$, 'auditor cannot delete sign-in sheets');

select pg_temp.act_as('91000000-0000-4000-8000-000000000103');
select is((select count(*)::integer from public.binder_export_jobs), 1, 'facility manager sees only assigned non-empty binder scopes');
select is((select count(*)::integer from storage.objects where bucket_id = 'binder-exports'), 1, 'facility manager signs only assigned-scope binder objects');

reset role;
delete from public.facility_assignments
where profile_id = '91000000-0000-4000-8000-000000000103';
select pg_temp.act_as('91000000-0000-4000-8000-000000000103');
select is((select count(*)::integer from public.binder_export_jobs), 0, 'former manager loses binder job visibility after assignment removal');
select is((select count(*)::integer from storage.objects where bucket_id = 'binder-exports'), 0, 'former manager cannot mint binder object links after assignment removal');

select pg_temp.act_as('91000000-0000-4000-8000-000000000108', 'service_role');
select lives_ok($$
  select public.admin_update_profile(
    '91000000-0000-4000-8000-000000000108', null, null, null,
    '91000000-0000-4000-8000-000000000002', null, null
  )
$$, 'service-role profile reassignment succeeds through the trusted RPC');
reset role;
select is((select count(*)::integer from public.facility_assignments where profile_id = '91000000-0000-4000-8000-000000000108'), 0, 'reassignment atomically removes former-tenant facility assignments');
select is((select count(*)::integer from public.employees where profile_id = '91000000-0000-4000-8000-000000000108'), 0, 'reassignment atomically severs former-tenant employee ownership');
select pg_temp.act_as('91000000-0000-4000-8000-000000000108');
select is((select count(*)::integer from public.support_tickets where id = '91000000-0000-4000-8000-000000000503'), 0, 'reassigned user cannot read former-tenant support ticket');
select is((select count(*)::integer from public.shift_assignments where id = '91000000-0000-4000-8000-000000000502'), 0, 'reassigned user cannot read former-tenant shift');

select * from finish();
rollback;
