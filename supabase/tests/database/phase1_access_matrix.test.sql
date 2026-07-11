-- Focused Phase 1 release-gate matrix: explicit grants, six application roles,
-- tenant/facility boundaries, and the private certificate Storage path policy.
begin;
select plan(28);

insert into public.organizations (id, name, slug) values
  ('20000000-0000-4000-8000-000000000001', 'Access Matrix Org A', 'access-matrix-org-a'),
  ('20000000-0000-4000-8000-000000000002', 'Access Matrix Org B', 'access-matrix-org-b');

insert into public.facilities (id, organization_id, name, facility_type) values
  ('20000000-0000-4000-8000-000000000011', '20000000-0000-4000-8000-000000000001', 'Access Facility A1', 'PCH'),
  ('20000000-0000-4000-8000-000000000012', '20000000-0000-4000-8000-000000000001', 'Access Facility A2', 'PCH'),
  ('20000000-0000-4000-8000-000000000013', '20000000-0000-4000-8000-000000000002', 'Access Facility B1', 'PCH');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
)
select
  '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated',
  v.email, 'x', now(), '{}'::jsonb, '{}'::jsonb, now(), now(),
  '', '', '', '', '', '', false, false
from (values
  ('20000000-0000-4000-8000-000000000101'::uuid, 'matrix-platform@test.local'),
  ('20000000-0000-4000-8000-000000000102'::uuid, 'matrix-org-admin@test.local'),
  ('20000000-0000-4000-8000-000000000103'::uuid, 'matrix-manager@test.local'),
  ('20000000-0000-4000-8000-000000000104'::uuid, 'matrix-trainer@test.local'),
  ('20000000-0000-4000-8000-000000000105'::uuid, 'matrix-auditor@test.local'),
  ('20000000-0000-4000-8000-000000000106'::uuid, 'matrix-employee@test.local')
) as v(id, email);

-- auth.users fires handle_new_user(); finish the trigger-created fixture rows under the
-- same transaction-local bypass used by trusted profile administration paths.
select set_config('app.privileged_write', 'on', true);

insert into public.profiles (
  id, organization_id, email, first_name, last_name, role, is_active
) values
  ('20000000-0000-4000-8000-000000000101', null, 'matrix-platform@test.local', 'Matrix', 'Platform', 'platform_admin', true),
  ('20000000-0000-4000-8000-000000000102', '20000000-0000-4000-8000-000000000001', 'matrix-org-admin@test.local', 'Matrix', 'Admin', 'org_admin', true),
  ('20000000-0000-4000-8000-000000000103', '20000000-0000-4000-8000-000000000001', 'matrix-manager@test.local', 'Matrix', 'Manager', 'facility_manager', true),
  ('20000000-0000-4000-8000-000000000104', '20000000-0000-4000-8000-000000000001', 'matrix-trainer@test.local', 'Matrix', 'Trainer', 'trainer', true),
  ('20000000-0000-4000-8000-000000000105', '20000000-0000-4000-8000-000000000001', 'matrix-auditor@test.local', 'Matrix', 'Auditor', 'auditor', true),
  ('20000000-0000-4000-8000-000000000106', '20000000-0000-4000-8000-000000000001', 'matrix-employee@test.local', 'Matrix', 'Employee', 'employee', true)
on conflict (id) do update set
  organization_id = excluded.organization_id,
  email = excluded.email,
  first_name = excluded.first_name,
  last_name = excluded.last_name,
  role = excluded.role,
  is_active = excluded.is_active;

select set_config('app.privileged_write', 'off', true);

insert into public.facility_assignments (profile_id, facility_id) values
  ('20000000-0000-4000-8000-000000000103', '20000000-0000-4000-8000-000000000011'),
  ('20000000-0000-4000-8000-000000000104', '20000000-0000-4000-8000-000000000011');

insert into public.employees (
  id, organization_id, facility_id, profile_id, first_name, last_name, job_title, status
) values
  ('20000000-0000-4000-8000-000000000201', '20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000011', '20000000-0000-4000-8000-000000000106', 'Matrix', 'Employee', 'Aide', 'active'),
  ('20000000-0000-4000-8000-000000000202', '20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000012', null, 'Other', 'Facility', 'Aide', 'active'),
  ('20000000-0000-4000-8000-000000000203', '20000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000013', null, 'Other', 'Tenant', 'Aide', 'active');

insert into public.training_types (
  id, organization_id, code, name, category, renewal_interval_days,
  warning_days_default, is_system_default
) values
  ('20000000-0000-4000-8000-000000000301', '20000000-0000-4000-8000-000000000001', 'MATRIX-A', 'Matrix Training A', 'other', 365, 30, false),
  ('20000000-0000-4000-8000-000000000302', '20000000-0000-4000-8000-000000000002', 'MATRIX-B', 'Matrix Training B', 'other', 365, 30, false);

-- Employee/training-type triggers may create shell requirements. Own the exact
-- fixture rows by clearing only these three synthetic employees first.
delete from public.employee_training_records
where employee_id in (
  '20000000-0000-4000-8000-000000000201',
  '20000000-0000-4000-8000-000000000202',
  '20000000-0000-4000-8000-000000000203'
);

insert into public.employee_training_records (
  id, organization_id, facility_id, employee_id, training_type_id, status, notes
) values
  ('20000000-0000-4000-8000-000000000401', '20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000011', '20000000-0000-4000-8000-000000000201', '20000000-0000-4000-8000-000000000301', 'missing', 'matrix-a1'),
  ('20000000-0000-4000-8000-000000000402', '20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000012', '20000000-0000-4000-8000-000000000202', '20000000-0000-4000-8000-000000000301', 'missing', 'matrix-a2'),
  ('20000000-0000-4000-8000-000000000403', '20000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000013', '20000000-0000-4000-8000-000000000203', '20000000-0000-4000-8000-000000000302', 'missing', 'matrix-b1');

insert into public.courses (id, organization_id, title, status) values
  ('20000000-0000-4000-8000-000000000501', '20000000-0000-4000-8000-000000000001', 'Matrix Course A', 'draft'),
  ('20000000-0000-4000-8000-000000000502', '20000000-0000-4000-8000-000000000002', 'Matrix Course B', 'draft');

select set_config('app.privileged_write', 'on', true);
insert into public.certificates (
  id, organization_id, facility_id, employee_id, course_id, slug,
  pdf_storage_bucket, pdf_storage_path, pdf_status, pdf_ready_at
) values
  ('20000000-0000-4000-8000-000000000601', '20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000011', '20000000-0000-4000-8000-000000000201', '20000000-0000-4000-8000-000000000501', 'matrix-cert-a1', 'certificates', 'matrix/org-a/facility-a1.pdf', 'ready', now()),
  ('20000000-0000-4000-8000-000000000602', '20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000012', '20000000-0000-4000-8000-000000000202', '20000000-0000-4000-8000-000000000501', 'matrix-cert-a2', 'certificates', 'matrix/org-a/facility-a2.pdf', 'ready', now()),
  ('20000000-0000-4000-8000-000000000603', '20000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000013', '20000000-0000-4000-8000-000000000203', '20000000-0000-4000-8000-000000000502', 'matrix-cert-b1', 'certificates', 'matrix/org-b/facility-b1.pdf', 'ready', now());

insert into storage.objects (bucket_id, name) values
  ('certificates', 'matrix/org-a/facility-a1.pdf'),
  ('certificates', 'matrix/org-a/facility-a2.pdf'),
  ('certificates', 'matrix/org-b/facility-b1.pdf'),
  ('certificates', 'matrix/unlinked-object-must-stay-hidden.pdf');

create or replace function pg_temp.act_as(p_profile_id uuid) returns void as $$
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_profile_id::text, 'role', 'authenticated')::text,
    true
  );
  set local role authenticated;
end;
$$ language plpgsql;

-- Explicit grants remain a separate gate from RLS.
select ok(
  not exists (
    select 1
    from pg_catalog.pg_policy p
    join pg_catalog.pg_class c on c.oid = p.polrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    join pg_catalog.pg_roles authenticated_role
      on authenticated_role.rolname = 'authenticated'
    cross join lateral unnest(
      case p.polcmd
        when 'r' then array['SELECT']::text[]
        when 'a' then array['INSERT']::text[]
        when 'w' then array['UPDATE']::text[]
        when 'd' then array['DELETE']::text[]
        else array['SELECT', 'INSERT', 'UPDATE', 'DELETE']::text[]
      end
    ) as required(privilege_name)
    where n.nspname = 'public'
      and (
        0::oid = any (p.polroles)
        or authenticated_role.oid = any (p.polroles)
      )
      and not has_table_privilege(
        'authenticated',
        format('%I.%I', n.nspname, c.relname),
        required.privilege_name
      )
  ),
  'every authenticated public-table RLS command has its matching table grant'
);
select ok(
  not exists (
    select 1
    from (values
      ('organizations', 'SELECT'),
      ('organizations', 'INSERT'),
      ('organizations', 'DELETE'),
      ('resident_documents', 'SELECT'),
      ('resident_documents', 'INSERT'),
      ('resident_documents', 'DELETE'),
      ('violation_documents', 'SELECT'),
      ('violation_documents', 'INSERT'),
      ('violation_documents', 'DELETE'),
      ('resident_assessment_ai_generations', 'SELECT'),
      ('resident_assessment_ai_generations', 'INSERT'),
      ('resident_assessment_ai_generations', 'UPDATE'),
      ('incidents', 'SELECT'),
      ('incidents', 'UPDATE'),
      ('policy_attestations', 'SELECT'),
      ('policy_attestations', 'UPDATE'),
      ('facilities', 'SELECT'),
      ('facilities', 'INSERT'),
      ('employees', 'SELECT'),
      ('employees', 'INSERT'),
      ('courses', 'SELECT'),
      ('courses', 'INSERT'),
      ('course_versions', 'SELECT'),
      ('course_versions', 'INSERT'),
      ('course_blocks', 'SELECT'),
      ('course_blocks', 'INSERT'),
      ('facility_assignments', 'INSERT'),
      ('alerts', 'SELECT'),
      ('certificates', 'SELECT'),
      ('corrective_actions', 'SELECT'),
      ('dhs_citation_topics', 'SELECT'),
      ('dhs_violations', 'SELECT'),
      ('employee_credentials', 'SELECT'),
      ('employee_training_records', 'SELECT'),
      ('inspection_items', 'SELECT'),
      ('notification_deliveries', 'SELECT'),
      ('notifications', 'SELECT'),
      ('platform_settings', 'SELECT'),
      ('policy_attestation_campaigns', 'SELECT'),
      ('policy_documents', 'SELECT'),
      ('practicums', 'SELECT'),
      ('profiles', 'SELECT'),
      ('resident_assessment_forms', 'SELECT'),
      ('resident_compliance_items', 'SELECT'),
      ('residents', 'SELECT'),
      ('training_types', 'SELECT')
    ) as required(table_name, privilege_name)
    where not has_table_privilege(
      'service_role',
      format('public.%I', required.table_name),
      required.privilege_name
    )
  ),
  'trusted service workflows have every required direct table command'
);
select ok(
  not exists (
    with scoped_tables(table_name) as (
      values
        ('packages'),
        ('organizations'),
        ('organization_settings'),
        ('facilities'),
        ('profiles'),
        ('facility_assignments'),
        ('employees'),
        ('training_types'),
        ('employee_training_records'),
        ('employee_training_hour_buckets'),
        ('practicums'),
        ('training_documents'),
        ('alerts'),
        ('training_classes'),
        ('training_class_attendees'),
        ('courses'),
        ('course_versions'),
        ('course_blocks'),
        ('quizzes'),
        ('quiz_questions'),
        ('quiz_answers'),
        ('course_assignments'),
        ('course_progress'),
        ('quiz_attempts'),
        ('quiz_attempt_answers'),
        ('training_plans'),
        ('training_plan_items'),
        ('competency_templates'),
        ('competency_template_items'),
        ('competency_records'),
        ('competency_record_items'),
        ('certificates'),
        ('notifications'),
        ('course_feedback'),
        ('quiz_question_explanations'),
        ('employee_credentials'),
        ('employee_credential_documents'),
        ('incidents'),
        ('incident_staff_involved'),
        ('incident_notifications'),
        ('incident_documents'),
        ('corrective_actions'),
        ('inspection_items'),
        ('inspection_events'),
        ('notification_deliveries'),
        ('policy_documents'),
        ('policy_document_versions'),
        ('policy_attestation_campaigns'),
        ('policy_attestations'),
        ('employee_background_check_profiles'),
        ('exclusion_screening_matches'),
        ('administrator_profiles'),
        ('administrator_ce_entries'),
        ('class_checkin_tokens'),
        ('dhs_citation_topics'),
        ('entrance_conference_items'),
        ('dhs_violations'),
        ('violation_documents'),
        ('onboarding_checklist_templates'),
        ('employee_onboarding_items'),
        ('employee_checkin_logs'),
        ('residents'),
        ('resident_compliance_items'),
        ('resident_documents'),
        ('course_ai_generations'),
        ('platform_settings'),
        ('employee_facility_assignments'),
        ('facility_units'),
        ('shift_definitions'),
        ('employee_schedule_preferences'),
        ('schedules'),
        ('shift_assignments'),
        ('resident_compliance_rule_packs'),
        ('resident_informal_supports'),
        ('resident_assessment_forms'),
        ('support_tickets'),
        ('support_ticket_messages'),
        ('help_articles'),
        ('resident_assessment_ai_generations')
    ),
    privileges(privilege_name) as (
      select distinct upper(privilege_type)
      from pg_catalog.aclexplode(
        pg_catalog.acldefault(
          'r',
          (select oid
           from pg_catalog.pg_roles
           where rolname = 'service_role')
        )
      )
    ),
    allowed(table_name, privilege_name) as (
      values
        ('organizations', 'SELECT'),
        ('organizations', 'INSERT'),
        ('organizations', 'DELETE'),
        ('resident_documents', 'SELECT'),
        ('resident_documents', 'INSERT'),
        ('resident_documents', 'DELETE'),
        ('violation_documents', 'SELECT'),
        ('violation_documents', 'INSERT'),
        ('violation_documents', 'DELETE'),
        ('resident_assessment_ai_generations', 'SELECT'),
        ('resident_assessment_ai_generations', 'INSERT'),
        ('resident_assessment_ai_generations', 'UPDATE'),
        ('incidents', 'SELECT'),
        ('incidents', 'UPDATE'),
        ('policy_attestations', 'SELECT'),
        ('policy_attestations', 'UPDATE'),
        ('facilities', 'SELECT'),
        ('facilities', 'INSERT'),
        ('employees', 'SELECT'),
        ('employees', 'INSERT'),
        ('courses', 'SELECT'),
        ('courses', 'INSERT'),
        ('course_versions', 'SELECT'),
        ('course_versions', 'INSERT'),
        ('course_blocks', 'SELECT'),
        ('course_blocks', 'INSERT'),
        ('facility_assignments', 'INSERT'),
        ('alerts', 'SELECT'),
        ('certificates', 'SELECT'),
        ('corrective_actions', 'SELECT'),
        ('dhs_citation_topics', 'SELECT'),
        ('dhs_violations', 'SELECT'),
        ('employee_credentials', 'SELECT'),
        ('employee_training_records', 'SELECT'),
        ('inspection_items', 'SELECT'),
        ('notification_deliveries', 'SELECT'),
        ('notifications', 'SELECT'),
        ('platform_settings', 'SELECT'),
        ('policy_attestation_campaigns', 'SELECT'),
        ('policy_documents', 'SELECT'),
        ('practicums', 'SELECT'),
        ('profiles', 'SELECT'),
        ('resident_assessment_forms', 'SELECT'),
        ('resident_compliance_items', 'SELECT'),
        ('residents', 'SELECT'),
        ('training_types', 'SELECT')
    )
    select 1
    from scoped_tables
    cross join privileges
    where (
      (
        case
          when privileges.privilege_name in (
            'SELECT', 'INSERT', 'UPDATE', 'REFERENCES'
          ) then has_any_column_privilege(
            'service_role',
            format('public.%I', scoped_tables.table_name),
            privileges.privilege_name
          )
          else has_table_privilege(
            'service_role',
            format('public.%I', scoped_tables.table_name),
            privileges.privilege_name
          )
        end
        and not exists (
          select 1
          from allowed
          where allowed.table_name = scoped_tables.table_name
            and allowed.privilege_name = privileges.privilege_name
        )
      )
      or case
        when privileges.privilege_name in (
          'SELECT', 'INSERT', 'UPDATE', 'REFERENCES'
        ) then has_any_column_privilege(
          'service_role',
          format('public.%I', scoped_tables.table_name),
          privileges.privilege_name || ' WITH GRANT OPTION'
        )
        else has_table_privilege(
          'service_role',
          format('public.%I', scoped_tables.table_name),
          privileges.privilege_name || ' WITH GRANT OPTION'
        )
      end
    )
  ),
  'trusted service workflows have no unapproved core-table or delegation privileges'
);
select ok(
  has_table_privilege('authenticated', 'public.certificate_pdf_jobs', 'SELECT')
  and not has_table_privilege('authenticated', 'public.certificate_pdf_jobs', 'INSERT')
  and not has_table_privilege('authenticated', 'public.certificate_pdf_jobs', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.certificate_pdf_jobs', 'DELETE'),
  'certificate job evidence exposes a read-only authenticated table grant'
);
select ok(
  has_function_privilege('service_role', 'public.claim_system_job_execution(text,text,text,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.claim_system_job_execution(text,text,text,text)', 'EXECUTE'),
  'job mutation RPC grants are service-role only'
);
select ok(
  has_function_privilege('authenticated', 'public.get_system_job_control_plane()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_system_job_control_plane()', 'EXECUTE'),
  'operator control-plane RPC has an explicit authenticated grant and no anonymous grant'
);
select ok(
  has_schema_privilege('service_role', 'app_private', 'USAGE')
  and not has_schema_privilege('authenticated', 'app_private', 'USAGE'),
  'private operational state is not exposed to authenticated clients'
);

set local role service_role;
select lives_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('certificates', 'matrix/service-worker-unlinked.pdf') $$,
  'the trusted service role retains Storage write access'
);
reset role;

-- platform_admin: global reads and a cross-tenant regulated write.
select pg_temp.act_as('20000000-0000-4000-8000-000000000101');
select is((select count(*)::int from public.employee_training_records), 3,
  'platform_admin can read representative records across tenants');
select results_eq(
  $$ with changed as (
       update public.employee_training_records set notes = 'platform-write'
       where id = '20000000-0000-4000-8000-000000000403' returning 1
     ) select count(*)::int from changed $$,
  array[1],
  'platform_admin can write a representative cross-tenant record'
);

-- org_admin: organization-wide, never cross-tenant.
reset role;
select pg_temp.act_as('20000000-0000-4000-8000-000000000102');
select is((select count(*)::int from public.employee_training_records), 2,
  'org_admin reads both own-organization facilities and not another tenant');
select results_eq(
  $$ with own_changed as (
       update public.employee_training_records set notes = 'org-write'
       where id = '20000000-0000-4000-8000-000000000402' returning 1
     ), cross_changed as (
       update public.employee_training_records set notes = 'cross-tenant-denied'
       where id = '20000000-0000-4000-8000-000000000403' returning 1
     )
     select
       (select count(*)::int from own_changed),
       (select count(*)::int from cross_changed) $$,
  $$ values (1, 0) $$,
  'org_admin writes its organization and cannot write another tenant'
);

-- facility_manager: assigned facility only.
reset role;
select pg_temp.act_as('20000000-0000-4000-8000-000000000103');
select is((select count(*)::int from public.employee_training_records), 1,
  'facility_manager reads only its assigned facility');
select results_eq(
  $$ with assigned_changed as (
       update public.employee_training_records set notes = 'manager-write'
       where id = '20000000-0000-4000-8000-000000000401' returning 1
     ), unassigned_changed as (
       update public.employee_training_records set notes = 'manager-unassigned-denied'
       where id = '20000000-0000-4000-8000-000000000402' returning 1
     ), cross_changed as (
       update public.employee_training_records set notes = 'manager-cross-tenant-denied'
       where id = '20000000-0000-4000-8000-000000000403' returning 1
     )
     select
       (select count(*)::int from assigned_changed),
       (select count(*)::int from unassigned_changed),
       (select count(*)::int from cross_changed) $$,
  $$ values (1, 0, 0) $$,
  'facility_manager writes assigned scope and not unassigned/cross-tenant scope'
);

-- trainer: same assigned-facility boundary for training evidence.
reset role;
select pg_temp.act_as('20000000-0000-4000-8000-000000000104');
select is((select count(*)::int from public.employee_training_records), 1,
  'trainer reads only its assigned facility');
select results_eq(
  $$ with assigned_changed as (
       update public.employee_training_records set notes = 'trainer-write'
       where id = '20000000-0000-4000-8000-000000000401' returning 1
     ), unassigned_changed as (
       update public.employee_training_records set notes = 'trainer-unassigned-denied'
       where id = '20000000-0000-4000-8000-000000000402' returning 1
     ), cross_changed as (
       update public.employee_training_records set notes = 'trainer-cross-tenant-denied'
       where id = '20000000-0000-4000-8000-000000000403' returning 1
     )
     select
       (select count(*)::int from assigned_changed),
       (select count(*)::int from unassigned_changed),
       (select count(*)::int from cross_changed) $$,
  $$ values (1, 0, 0) $$,
  'trainer writes assigned scope and not unassigned/cross-tenant scope'
);

-- auditor: own-organization read-only.
reset role;
select pg_temp.act_as('20000000-0000-4000-8000-000000000105');
select is((select count(*)::int from public.employee_training_records), 2,
  'auditor reads its organization across facilities and not another tenant');
select results_eq(
  $$ with changed as (
       update public.employee_training_records set notes = 'auditor-write-denied'
       where id in (
         '20000000-0000-4000-8000-000000000401',
         '20000000-0000-4000-8000-000000000403'
       ) returning 1
     ) select count(*)::int from changed $$,
  array[0],
  'auditor cannot write own-tenant or cross-tenant training evidence'
);

-- employee: own linked record only, read-only.
reset role;
select pg_temp.act_as('20000000-0000-4000-8000-000000000106');
select is((select count(*)::int from public.employee_training_records), 1,
  'employee reads only its own linked training evidence');
select results_eq(
  $$ with changed as (
       update public.employee_training_records set notes = 'employee-write-denied'
       where id in (
         '20000000-0000-4000-8000-000000000401',
         '20000000-0000-4000-8000-000000000402',
         '20000000-0000-4000-8000-000000000403'
       ) returning 1
     ) select count(*)::int from changed $$,
  array[0],
  'employee cannot directly rewrite own or other training evidence'
);

-- The certificate Storage policy must match table visibility and the exact
-- bucket/path recorded on a certificate. Unlinked objects stay hidden even
-- from platform_admin.
reset role;
select pg_temp.act_as('20000000-0000-4000-8000-000000000101');
select is((select count(*)::int from storage.objects where bucket_id = 'certificates'), 3,
  'platform_admin reads linked certificate objects across tenants but not unlinked paths');

reset role;
select pg_temp.act_as('20000000-0000-4000-8000-000000000102');
select is((select count(*)::int from storage.objects where bucket_id = 'certificates'), 2,
  'org_admin certificate Storage reads are tenant-scoped');

reset role;
select pg_temp.act_as('20000000-0000-4000-8000-000000000103');
select is((select count(*)::int from storage.objects where bucket_id = 'certificates'), 1,
  'facility_manager certificate Storage reads are assigned-facility scoped');

reset role;
select pg_temp.act_as('20000000-0000-4000-8000-000000000104');
select is((select count(*)::int from storage.objects where bucket_id = 'certificates'), 1,
  'trainer certificate Storage reads are assigned-facility scoped');

reset role;
select pg_temp.act_as('20000000-0000-4000-8000-000000000105');
select is((select count(*)::int from storage.objects where bucket_id = 'certificates'), 2,
  'auditor certificate Storage reads are own-tenant scoped');

reset role;
select pg_temp.act_as('20000000-0000-4000-8000-000000000106');
select is((select count(*)::int from storage.objects where bucket_id = 'certificates'), 1,
  'employee certificate Storage reads are limited to its own certificate');

reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select is((select count(*)::int from storage.objects where bucket_id = 'certificates'), 0,
  'anonymous callers cannot enumerate private certificate objects');

reset role;
select pg_temp.act_as('20000000-0000-4000-8000-000000000102');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('certificates', 'matrix/org-admin-direct-write-denied.pdf') $$,
  null,
  null,
  'authenticated organization administrators cannot write the service-only certificate bucket'
);

select * from finish();
rollback;
