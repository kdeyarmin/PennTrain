begin;
select plan(39);

select has_function(
  'public',
  'generate_paged_compliance_report',
  array['text','uuid','uuid','date','date','integer','integer'],
  'the paged compliance report RPC exists'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.generate_paged_compliance_report(text,uuid,uuid,date,date,integer,integer)',
    'EXECUTE'
  ),
  'authenticated reporting users may execute the RPC'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.generate_paged_compliance_report(text,uuid,uuid,date,date,integer,integer)',
    'EXECUTE'
  ),
  'anonymous callers cannot execute the RPC'
);

select results_eq(
  $$
    select prosecdef
    from pg_proc
    where oid = 'public.generate_paged_compliance_report(text,uuid,uuid,date,date,integer,integer)'::regprocedure
  $$,
  array[false],
  'the report function preserves caller RLS with SECURITY INVOKER'
);

select is(
  (
    select coalesce(array_to_string(proconfig, ','), '')::text
    from pg_proc
    where oid = 'public.generate_paged_compliance_report(text,uuid,uuid,date,date,integer,integer)'::regprocedure
  ),
  'search_path=""'::text,
  'the report function pins an empty search path'
);

insert into public.organizations(id, name, slug, subscription_status) values
  ('27000000-0000-4000-8000-000000000001', 'Report Org A', 'report-org-a', 'active'),
  ('27000000-0000-4000-8000-000000000002', 'Report Org B', 'report-org-b', 'active');

insert into public.facilities(id, organization_id, name, facility_type, is_sandbox, sandbox_seed_version) values
  ('27000000-0000-4000-8000-000000000011', '27000000-0000-4000-8000-000000000001', 'Report A One', 'PCH', false, null),
  ('27000000-0000-4000-8000-000000000012', '27000000-0000-4000-8000-000000000001', 'Report A Two', 'ALR', false, null),
  ('27000000-0000-4000-8000-000000000013', '27000000-0000-4000-8000-000000000001', 'Report Sandbox', 'PCH', true, 1),
  ('27000000-0000-4000-8000-000000000021', '27000000-0000-4000-8000-000000000002', 'Report B One', 'PCH', false, null);

insert into auth.users(
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at,
  confirmation_token,recovery_token,email_change_token_new,email_change,
  email_change_token_current,reauthentication_token,is_sso_user,is_anonymous
)
select
  '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated',
  v.email, 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false
from (values
  ('27000000-0000-4000-8000-000000000101'::uuid, 'report-admin-a@test.local'),
  ('27000000-0000-4000-8000-000000000102'::uuid, 'report-employee-a@test.local'),
  ('27000000-0000-4000-8000-000000000201'::uuid, 'report-admin-b@test.local')
) as v(id,email);

select set_config('app.privileged_write','on',true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('27000000-0000-4000-8000-000000000101', '27000000-0000-4000-8000-000000000001', 'report-admin-a@test.local', 'Report', 'Admin A', 'org_admin', true),
  ('27000000-0000-4000-8000-000000000102', '27000000-0000-4000-8000-000000000001', 'report-employee-a@test.local', 'Report', 'Employee A', 'employee', true),
  ('27000000-0000-4000-8000-000000000201', '27000000-0000-4000-8000-000000000002', 'report-admin-b@test.local', 'Report', 'Admin B', 'org_admin', true)
on conflict(id) do update set
  organization_id = excluded.organization_id,
  first_name = excluded.first_name,
  last_name = excluded.last_name,
  role = excluded.role,
  is_active = excluded.is_active;
select set_config('app.privileged_write','off',true);

insert into public.employees(
  id, organization_id, facility_id, first_name, last_name, job_title,
  status, hire_date, administers_medications, trainer_status, is_synthetic
) values
  ('27000000-0000-4000-8000-000000000301', '27000000-0000-4000-8000-000000000001', '27000000-0000-4000-8000-000000000011', 'Alice', 'Able', 'Aide', 'active', current_date - 20, true, false, false),
  ('27000000-0000-4000-8000-000000000302', '27000000-0000-4000-8000-000000000001', '27000000-0000-4000-8000-000000000011', 'Bob', 'Baker', 'Trainer', 'active', current_date - 200, false, true, false),
  ('27000000-0000-4000-8000-000000000303', '27000000-0000-4000-8000-000000000001', '27000000-0000-4000-8000-000000000012', 'Cara', 'Clark', 'Aide', 'active', current_date - 300, false, false, false),
  ('27000000-0000-4000-8000-000000000304', '27000000-0000-4000-8000-000000000001', '27000000-0000-4000-8000-000000000013', 'Demo', 'Sandbox', 'Demo', 'active', current_date - 10, false, false, true),
  ('27000000-0000-4000-8000-000000000401', '27000000-0000-4000-8000-000000000002', '27000000-0000-4000-8000-000000000021', 'Other', 'Tenant', 'Aide', 'active', current_date - 200, false, false, false);

insert into public.training_types(
  id, organization_id, code, name, category, applies_to_facility_type,
  applies_to_administers_meds, applies_to_trainers, is_active, sort_order
) values
  ('27000000-0000-4000-8000-000000000501', '27000000-0000-4000-8000-000000000001', 'RPT-A', 'Report Training A', 'annual', 'BOTH', true, false, true, 1),
  ('27000000-0000-4000-8000-000000000502', '27000000-0000-4000-8000-000000000001', 'RPT-B', 'Report Training B', 'annual', 'BOTH', false, true, true, 2);

insert into public.employee_training_records(
  id, organization_id, facility_id, employee_id, training_type_id,
  completion_date, due_date, status, document_required
) values
  ('27000000-0000-4000-8000-000000000601', '27000000-0000-4000-8000-000000000001', '27000000-0000-4000-8000-000000000011', '27000000-0000-4000-8000-000000000301', '27000000-0000-4000-8000-000000000501', current_date - 40, current_date - 10, 'expired', true),
  ('27000000-0000-4000-8000-000000000602', '27000000-0000-4000-8000-000000000001', '27000000-0000-4000-8000-000000000011', '27000000-0000-4000-8000-000000000302', '27000000-0000-4000-8000-000000000502', current_date - 10, current_date + 30, 'due_soon', false),
  ('27000000-0000-4000-8000-000000000603', '27000000-0000-4000-8000-000000000001', '27000000-0000-4000-8000-000000000012', '27000000-0000-4000-8000-000000000303', '27000000-0000-4000-8000-000000000501', current_date - 5, current_date + 300, 'compliant', false),
  ('27000000-0000-4000-8000-000000000604', '27000000-0000-4000-8000-000000000001', '27000000-0000-4000-8000-000000000013', '27000000-0000-4000-8000-000000000304', '27000000-0000-4000-8000-000000000501', current_date - 5, current_date - 1, 'expired', false);

insert into public.alerts(
  organization_id, facility_id, alert_type, title, message, severity
) values
  ('27000000-0000-4000-8000-000000000001', '27000000-0000-4000-8000-000000000011', 'overdue', 'Info fixture', 'Info fixture', 'info'),
  ('27000000-0000-4000-8000-000000000001', '27000000-0000-4000-8000-000000000011', 'overdue', 'Warning fixture', 'Warning fixture', 'warning'),
  ('27000000-0000-4000-8000-000000000001', '27000000-0000-4000-8000-000000000011', 'overdue', 'Critical fixture', 'Critical fixture', 'critical');

create or replace function pg_temp.act_as(p_id uuid) returns void
language plpgsql as $$
begin
  reset role;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', p_id, 'role', 'authenticated', 'aal', 'aal2', 'iat', extract(epoch from now())::bigint)::text,
    true
  );
  set local role authenticated;
end
$$;

select pg_temp.act_as('27000000-0000-4000-8000-000000000102');
select throws_ok(
  $$ select public.generate_paged_compliance_report('compliance-summary') $$,
  '42501', null,
  'employees cannot call the reporting RPC directly'
);

select pg_temp.act_as('27000000-0000-4000-8000-000000000101');
select throws_ok(
  $$ select public.generate_paged_compliance_report('compliance-summary', '27000000-0000-4000-8000-000000000021') $$,
  '42501', null,
  'a caller cannot request a facility in another tenant'
);
select throws_ok(
  $$ select public.generate_paged_compliance_report('unknown-report') $$,
  '22023', null,
  'unknown report identifiers are rejected'
);
select throws_ok(
  $$ select public.generate_paged_compliance_report('compliance-summary', null, null, current_date, current_date - 1) $$,
  '22023', null,
  'backwards date windows are rejected'
);

select is(
  jsonb_array_length((public.generate_paged_compliance_report('training-matrix', null, null, null, null, 2, 0))->'rows'),
  2,
  'the report row page respects the requested limit'
);
select is(
  ((public.generate_paged_compliance_report('training-matrix', null, null, null, null, 2, 0))->>'totalRows')::integer,
  3,
  'the report response retains the full RLS-scoped row count'
);
select is(
  (public.generate_paged_compliance_report('training-matrix', null, null, null, null, 2, 0))->>'hasMore',
  'true',
  'the first bounded page reports that another page exists'
);
select is(
  (public.generate_paged_compliance_report('training-matrix', null, null, null, null, 2, 2))->>'pageOffset',
  '2',
  'the second page echoes its stable offset'
);
select is(
  ((public.generate_paged_compliance_report('training-matrix', '27000000-0000-4000-8000-000000000012'))->>'totalRows')::integer,
  1,
  'facility filtering is applied in the database'
);
select is(
  ((public.generate_paged_compliance_report('compliance-summary'))->'rows'->0->>1)::integer,
  3,
  'sandbox employees are excluded from report totals'
);
select is(
  (public.generate_paged_compliance_report('facility-compliance'))->'rows'->1->>1,
  'ALF',
  'facility reports translate the stored ALR code to the user-facing ALF label'
);
select results_eq(
  $$ select severity from public.alerts
     where title like '% fixture'
     order by severity_rank desc $$,
  array['critical', 'warning', 'info'],
  'server-side alert ordering preserves operational severity priority'
);

select lives_ok(
  format(
    'select public.generate_paged_compliance_report(%L, null, %L::uuid, null, null, 10, 0)',
    report_id,
    '27000000-0000-4000-8000-000000000301'
  ),
  report_id || ' executes through the server report engine'
)
from unnest(array[
  'compliance-summary', 'facility-compliance', 'survey-readiness',
  'expired-training', 'due-soon', 'medication-administration',
  'training-matrix', 'practicum-status', 'annual-practicum',
  'annual-hours', 'training-hours', 'trainer-certification',
  'new-employee-training', 'employee-transcript',
  'expiring-certifications', 'missing-documents', 'document-audit',
  'overdue-training', 'credential-status', 'incident-log',
  'incident-notification-register', 'inspection-compliance'
]) as reports(report_id);

select * from finish();
rollback;
