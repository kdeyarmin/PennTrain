begin;
select plan(31);

select has_table('public', 'compliance_copilot_runs', 'copilot receipts have dedicated storage');
select is(
  (select value from public.platform_settings where key = 'ai_compliance_copilot_enabled'),
  'false'::jsonb,
  'regulated-data copilot starts disabled pending provider review'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.compliance_copilot_runs'::regclass),
  'copilot receipts enforce RLS'
);
select ok(has_table_privilege('authenticated', 'public.compliance_copilot_runs', 'SELECT'), 'authenticated roles can read scoped receipts');
select ok(not has_table_privilege('authenticated', 'public.compliance_copilot_runs', 'INSERT'), 'browser roles cannot create model receipts');
select ok(not has_table_privilege('authenticated', 'public.compliance_copilot_runs', 'UPDATE'), 'browser roles cannot rewrite model receipts');
select ok(not has_table_privilege('authenticated', 'public.compliance_copilot_runs', 'DELETE'), 'browser roles cannot delete model receipts');
select ok(not has_table_privilege('anon', 'public.compliance_copilot_runs', 'SELECT'), 'anonymous users cannot read model receipts');
select ok(has_table_privilege('service_role', 'public.compliance_copilot_runs', 'SELECT'), 'server functions can read receipts');
select ok(has_table_privilege('service_role', 'public.compliance_copilot_runs', 'INSERT'), 'server functions can append receipts');
select ok(not has_table_privilege('service_role', 'public.compliance_copilot_runs', 'UPDATE'), 'server functions cannot rewrite receipts');
select ok(not has_table_privilege('service_role', 'public.compliance_copilot_runs', 'DELETE'), 'server functions cannot delete receipts');

insert into public.organizations(id, name, slug, subscription_status) values
  ('76000000-0000-4000-8000-000000000001', 'Copilot Org', 'copilot-org', 'active'),
  ('76000000-0000-4000-8000-000000000002', 'Other Copilot Org', 'other-copilot-org', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('76000000-0000-4000-8000-000000000011', '76000000-0000-4000-8000-000000000001', 'Copilot PCH', 'PCH'),
  ('76000000-0000-4000-8000-000000000012', '76000000-0000-4000-8000-000000000001', 'Unassigned Copilot ALR', 'ALR'),
  ('76000000-0000-4000-8000-000000000013', '76000000-0000-4000-8000-000000000002', 'Other Copilot PCH', 'PCH');
insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', '76000000-0000-4000-8000-000000000101', 'authenticated', 'authenticated', 'copilot-admin@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', '76000000-0000-4000-8000-000000000102', 'authenticated', 'authenticated', 'copilot-manager@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', '76000000-0000-4000-8000-000000000103', 'authenticated', 'authenticated', 'copilot-auditor@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', '76000000-0000-4000-8000-000000000104', 'authenticated', 'authenticated', 'copilot-employee@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', '76000000-0000-4000-8000-000000000105', 'authenticated', 'authenticated', 'other-copilot-admin@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('76000000-0000-4000-8000-000000000101', '76000000-0000-4000-8000-000000000001', 'copilot-admin@test.local', 'Copilot', 'Admin', 'org_admin', true),
  ('76000000-0000-4000-8000-000000000102', '76000000-0000-4000-8000-000000000001', 'copilot-manager@test.local', 'Copilot', 'Manager', 'facility_manager', true),
  ('76000000-0000-4000-8000-000000000103', '76000000-0000-4000-8000-000000000001', 'copilot-auditor@test.local', 'Copilot', 'Auditor', 'auditor', true),
  ('76000000-0000-4000-8000-000000000104', '76000000-0000-4000-8000-000000000001', 'copilot-employee@test.local', 'Copilot', 'Employee', 'employee', true),
  ('76000000-0000-4000-8000-000000000105', '76000000-0000-4000-8000-000000000002', 'other-copilot-admin@test.local', 'Other', 'Admin', 'org_admin', true)
on conflict(id) do update set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);
insert into public.facility_assignments(profile_id, facility_id) values
  ('76000000-0000-4000-8000-000000000102', '76000000-0000-4000-8000-000000000011');

insert into public.compliance_copilot_runs(
  id, organization_id, facility_id, requested_by, intent, question,
  jurisdiction_code, facility_type, as_of_date, determination_kind, status, model,
  rule_sources, evidence_used, missing_information, response, safeguards,
  request_checksum_sha256, response_checksum_sha256, error_message
) values
  (
    '76000000-0000-4000-8000-000000000201', '76000000-0000-4000-8000-000000000001',
    '76000000-0000-4000-8000-000000000011', '76000000-0000-4000-8000-000000000101',
    'readiness_score', 'Why is the readiness score low?', 'PA', 'PCH', current_date,
    'confirmed_system_determination', 'completed', 'claude-test',
    '[{"id":"rule:1","citation":"55 Pa. Code 2600.65","version":"2026.1"}]',
    '[{"id":"evidence:1","kind":"readiness_snapshot"}]', '[]',
    '{"answer":"The current system snapshot shows overdue items."}',
    '{"readOnly":true,"humanConfirmationRequired":true,"operationalMutationsAllowed":false}',
    repeat('a', 64), repeat('b', 64), null
  ),
  (
    '76000000-0000-4000-8000-000000000202', '76000000-0000-4000-8000-000000000001',
    '76000000-0000-4000-8000-000000000012', '76000000-0000-4000-8000-000000000103',
    'draft_plan_of_correction', 'Draft a plan from verified findings.', 'PA', 'ALR', current_date,
    'recommendation', 'completed', 'claude-test', '[]', '[]',
    '["No governed source matched the supplied finding."]',
    '{"answer":"A human-reviewed draft requires more information."}',
    '{"readOnly":true,"humanConfirmationRequired":true,"operationalMutationsAllowed":false}',
    repeat('c', 64), repeat('d', 64), null
  ),
  (
    '76000000-0000-4000-8000-000000000203', '76000000-0000-4000-8000-000000000002',
    '76000000-0000-4000-8000-000000000013', '76000000-0000-4000-8000-000000000105',
    'due_next_30_days', 'What is due in the next 30 days?', 'PA', 'PCH', current_date,
    'confirmed_system_determination', 'failed', null, '[]', '[]', '[]', '{}',
    '{"readOnly":true,"humanConfirmationRequired":true,"operationalMutationsAllowed":false}',
    repeat('e', 64), null, 'Provider unavailable'
  );

create or replace function pg_temp.act_as(p_id uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_id, 'role', p_role, 'aal', 'aal2', 'iat', extract(epoch from now())::bigint
  )::text, true);
  if p_role = 'anon' then set local role anon;
  elsif p_role = 'service_role' then set local role service_role;
  else set local role authenticated;
  end if;
end
$$;

select pg_temp.act_as('76000000-0000-4000-8000-000000000101');
select is((select count(*)::integer from public.compliance_copilot_runs), 2, 'organization admins see all receipts in their organization');
select pg_temp.act_as('76000000-0000-4000-8000-000000000102');
select is((select count(*)::integer from public.compliance_copilot_runs), 1, 'facility managers see only assigned-facility receipts');
select pg_temp.act_as('76000000-0000-4000-8000-000000000103');
select is((select count(*)::integer from public.compliance_copilot_runs), 2, 'auditors see receipts in their organization');
select pg_temp.act_as('76000000-0000-4000-8000-000000000104');
select is((select count(*)::integer from public.compliance_copilot_runs), 0, 'employees cannot read copilot receipts');
select pg_temp.act_as('76000000-0000-4000-8000-000000000105');
select is((select count(*)::integer from public.compliance_copilot_runs), 1, 'other organizations see only their own receipts');
select pg_temp.act_as('00000000-0000-0000-0000-000000000000', 'anon');
select throws_ok($$select count(*) from public.compliance_copilot_runs$$, '42501', null, 'anonymous access is denied at the grant boundary');

select pg_temp.act_as('76000000-0000-4000-8000-000000000101');
select throws_ok($$
  insert into public.compliance_copilot_runs(
    organization_id, facility_id, requested_by, intent, question, jurisdiction_code,
    facility_type, as_of_date, determination_kind, status, model, response, safeguards,
    request_checksum_sha256, response_checksum_sha256
  ) values (
    '76000000-0000-4000-8000-000000000001', '76000000-0000-4000-8000-000000000011',
    '76000000-0000-4000-8000-000000000101', 'readiness_score', 'Can I create this receipt?',
    'PA', 'PCH', current_date, 'recommendation', 'completed', 'browser-model', '{"answer":"No"}',
    '{"readOnly":true,"humanConfirmationRequired":true}', repeat('f', 64), repeat('0', 64)
  )
$$, '42501', null, 'authenticated callers cannot forge copilot receipts');

reset role;
select throws_ok($$update public.compliance_copilot_runs set question = 'Rewritten question' where id = '76000000-0000-4000-8000-000000000201'$$, '55000', null, 'receipts cannot be updated even by a database owner');
select throws_ok($$delete from public.compliance_copilot_runs where id = '76000000-0000-4000-8000-000000000201'$$, '55000', null, 'receipts cannot be deleted even by a database owner');
select throws_ok($$
  insert into public.compliance_copilot_runs(organization_id, facility_id, requested_by, intent, question, jurisdiction_code, facility_type, as_of_date, determination_kind, status, model, response, safeguards, request_checksum_sha256, response_checksum_sha256)
  values ('76000000-0000-4000-8000-000000000001', '76000000-0000-4000-8000-000000000011', '76000000-0000-4000-8000-000000000101', 'invented_intent', 'Invalid intent', 'PA', 'PCH', current_date, 'recommendation', 'completed', 'test', '{"answer":"x"}', '{"readOnly":true,"humanConfirmationRequired":true}', repeat('a',64), repeat('b',64))
$$, '23514', null, 'unsupported intents are rejected');
select throws_ok($$
  insert into public.compliance_copilot_runs(organization_id, facility_id, requested_by, intent, question, jurisdiction_code, facility_type, as_of_date, determination_kind, status, model, response, safeguards, request_checksum_sha256, response_checksum_sha256)
  values ('76000000-0000-4000-8000-000000000001', '76000000-0000-4000-8000-000000000011', '76000000-0000-4000-8000-000000000101', 'readiness_score', 'Unsafe safeguards', 'PA', 'PCH', current_date, 'recommendation', 'completed', 'test', '{"answer":"x"}', '{"readOnly":false,"humanConfirmationRequired":true}', repeat('a',64), repeat('b',64))
$$, '23514', null, 'read-only and human-confirmation safeguards are mandatory');
select throws_ok($$
  insert into public.compliance_copilot_runs(organization_id, facility_id, requested_by, intent, question, jurisdiction_code, facility_type, as_of_date, determination_kind, status, model, response, safeguards, request_checksum_sha256)
  values ('76000000-0000-4000-8000-000000000001', '76000000-0000-4000-8000-000000000011', '76000000-0000-4000-8000-000000000101', 'readiness_score', 'Missing checksum', 'PA', 'PCH', current_date, 'recommendation', 'completed', 'test', '{"answer":"x"}', '{"readOnly":true,"humanConfirmationRequired":true}', repeat('a',64))
$$, '23514', null, 'completed receipts require a response checksum');
select throws_ok($$
  insert into public.compliance_copilot_runs(organization_id, facility_id, requested_by, intent, question, jurisdiction_code, facility_type, as_of_date, determination_kind, status, safeguards, request_checksum_sha256)
  values ('76000000-0000-4000-8000-000000000001', '76000000-0000-4000-8000-000000000011', '76000000-0000-4000-8000-000000000101', 'readiness_score', 'Silent failure', 'PA', 'PCH', current_date, 'recommendation', 'failed', '{"readOnly":true,"humanConfirmationRequired":true}', repeat('a',64))
$$, '23514', null, 'failed receipts require an error message');
select throws_ok($$
  insert into public.compliance_copilot_runs(organization_id, facility_id, requested_by, intent, question, subject_type, jurisdiction_code, facility_type, as_of_date, determination_kind, status, model, response, safeguards, request_checksum_sha256, response_checksum_sha256)
  values ('76000000-0000-4000-8000-000000000001', '76000000-0000-4000-8000-000000000011', '76000000-0000-4000-8000-000000000101', 'employee_blocked', 'Why blocked?', 'employee', 'PA', 'PCH', current_date, 'confirmed_system_determination', 'completed', 'test', '{"answer":"x"}', '{"readOnly":true,"humanConfirmationRequired":true}', repeat('a',64), repeat('b',64))
$$, '23514', null, 'subject type and reference must be paired');
select is((select rule_sources->0->>'citation' from public.compliance_copilot_runs where id = '76000000-0000-4000-8000-000000000201'), '55 Pa. Code 2600.65', 'receipts retain the exact citation used');
select is((select evidence_used->0->>'id' from public.compliance_copilot_runs where id = '76000000-0000-4000-8000-000000000201'), 'evidence:1', 'receipts retain the referenced evidence ID');
select is(length((select request_checksum_sha256 from public.compliance_copilot_runs where id = '76000000-0000-4000-8000-000000000201')), 64, 'request packets are content-hashed');
select is((select determination_kind from public.compliance_copilot_runs where id = '76000000-0000-4000-8000-000000000202'), 'recommendation', 'draft content is explicitly labeled as a recommendation');
select hasnt_column('public', 'compliance_copilot_runs', 'finding_id', 'copilot receipts have no finding mutation linkage');

select * from finish();
rollback;
