begin;
select plan(11);

insert into public.organizations(id, name, slug, subscription_status) values
  ('76200000-0000-4000-8000-000000000001', 'Copilot Org', 'copilot-draft-org', 'active'),
  ('76200000-0000-4000-8000-000000000002', 'Other Copilot Org', 'other-copilot-draft-org', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('76200000-0000-4000-8000-000000000011', '76200000-0000-4000-8000-000000000001', 'Copilot PCH', 'PCH'),
  ('76200000-0000-4000-8000-000000000012', '76200000-0000-4000-8000-000000000001', 'Unassigned Copilot ALR', 'ALR'),
  ('76200000-0000-4000-8000-000000000013', '76200000-0000-4000-8000-000000000002', 'Other Copilot PCH', 'PCH');
insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', '76200000-0000-4000-8000-000000000101', 'authenticated', 'authenticated', 'copilot-admin-draft@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', '76200000-0000-4000-8000-000000000102', 'authenticated', 'authenticated', 'copilot-manager-draft@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', '76200000-0000-4000-8000-000000000103', 'authenticated', 'authenticated', 'copilot-auditor-draft@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', '76200000-0000-4000-8000-000000000104', 'authenticated', 'authenticated', 'copilot-employee-draft@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', '76200000-0000-4000-8000-000000000105', 'authenticated', 'authenticated', 'other-copilot-admin-draft@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('76200000-0000-4000-8000-000000000101', '76200000-0000-4000-8000-000000000001', 'copilot-admin-draft@test.local', 'Copilot', 'Admin', 'org_admin', true),
  ('76200000-0000-4000-8000-000000000102', '76200000-0000-4000-8000-000000000001', 'copilot-manager-draft@test.local', 'Copilot', 'Manager', 'facility_manager', true),
  ('76200000-0000-4000-8000-000000000103', '76200000-0000-4000-8000-000000000001', 'copilot-auditor-draft@test.local', 'Copilot', 'Auditor', 'auditor', true),
  ('76200000-0000-4000-8000-000000000104', '76200000-0000-4000-8000-000000000001', 'copilot-employee-draft@test.local', 'Copilot', 'Employee', 'employee', true),
  ('76200000-0000-4000-8000-000000000105', '76200000-0000-4000-8000-000000000002', 'other-copilot-admin-draft@test.local', 'Other', 'Admin', 'org_admin', true)
on conflict(id) do update set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);
insert into public.facility_assignments(profile_id, facility_id) values
  ('76200000-0000-4000-8000-000000000102', '76200000-0000-4000-8000-000000000011');

insert into public.compliance_copilot_runs(
  id, organization_id, facility_id, requested_by, intent, question,
  jurisdiction_code, facility_type, as_of_date, determination_kind, status, model,
  rule_sources, evidence_used, missing_information, response, safeguards,
  request_checksum_sha256, response_checksum_sha256, error_message
) values
  (
    '76200000-0000-4000-8000-000000000201', '76200000-0000-4000-8000-000000000001',
    '76200000-0000-4000-8000-000000000011', '76200000-0000-4000-8000-000000000101',
    'readiness_score', 'Why is the readiness score low?', 'PA', 'PCH', public.pa_today(),
    'confirmed_system_determination', 'completed', 'claude-test',
    '[{"id":"rule:1","citation":"55 Pa. Code 2600.65","version":"2026.1"}]',
    '[{"id":"evidence:1","kind":"readiness_snapshot"}]', '[]',
    '{"answer":"The current system snapshot shows overdue items."}',
    '{"readOnly":true,"humanConfirmationRequired":true,"operationalMutationsAllowed":false}',
    repeat('a', 64), repeat('b', 64), null
  ),
  (
    '76200000-0000-4000-8000-000000000202', '76200000-0000-4000-8000-000000000001',
    '76200000-0000-4000-8000-000000000012', '76200000-0000-4000-8000-000000000103',
    'draft_plan_of_correction', 'Draft a plan from verified findings.', 'PA', 'ALR', public.pa_today(),
    'recommendation', 'completed', 'claude-test', '[]', '[]',
    '["No governed source matched the supplied finding."]',
    '{"answer":"A human-reviewed draft requires more information."}',
    '{"readOnly":true,"humanConfirmationRequired":true,"operationalMutationsAllowed":false}',
    repeat('c', 64), repeat('d', 64), null
  ),
  (
    '76200000-0000-4000-8000-000000000203', '76200000-0000-4000-8000-000000000002',
    '76200000-0000-4000-8000-000000000013', '76200000-0000-4000-8000-000000000105',
    'due_next_30_days', 'What is due in the next 30 days?', 'PA', 'PCH', public.pa_today(),
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


-- The source must be an actual completed receipt for the exact draft scope.
select pg_temp.act_as('76200000-0000-4000-8000-000000000101');
select lives_ok($$select public.create_copilot_action_draft('76200000-0000-4000-8000-000000000011', 'readiness_score', 'Manual review', null, '[{"title":"Review overdue work"}]')$$, 'legacy source-less proposals remain available');
select lives_ok($$select public.create_copilot_action_draft('76200000-0000-4000-8000-000000000011', 'readiness_score', 'Scoped review', '76200000-0000-4000-8000-000000000201', '[{"title":"Review overdue work"}]')$$, 'completed same-facility source can create a proposal');
select is((select count(*)::integer from public.copilot_action_drafts where organization_id='76200000-0000-4000-8000-000000000001' and status='draft'), 2, 'proposals remain drafts pending human review');
select throws_ok($$select public.create_copilot_action_draft('76200000-0000-4000-8000-000000000011', 'readiness_score', 'Wrong facility', '76200000-0000-4000-8000-000000000202', '[{"title":"Review overdue work"}]')$$, '22023', 'Copilot source response must be completed and belong to this facility', 'same organization does not permit another facility receipt');
select throws_ok($$select public.create_copilot_action_draft('76200000-0000-4000-8000-000000000011', 'readiness_score', 'Wrong organization', '76200000-0000-4000-8000-000000000203', '[{"title":"Review overdue work"}]')$$, '22023', 'Copilot source response must be completed and belong to this facility', 'another organization receipt is rejected');
select throws_ok($$select public.create_copilot_action_draft('76200000-0000-4000-8000-000000000011', 'readiness_score', 'Missing source', '76200000-0000-4000-8000-000000000299', '[{"title":"Review overdue work"}]')$$, '22023', 'Copilot source response must be completed and belong to this facility', 'nonexistent source is rejected');
select pg_temp.act_as('76200000-0000-4000-8000-000000000105');
select throws_ok($$select public.create_copilot_action_draft('76200000-0000-4000-8000-000000000013', 'due_next_30_days', 'Failed source', '76200000-0000-4000-8000-000000000203', '[{"title":"Review overdue work"}]')$$, '22023', 'Copilot source response must be completed and belong to this facility', 'failed same-facility source is rejected');
select pg_temp.act_as('76200000-0000-4000-8000-000000000102');
select throws_ok($$select public.create_copilot_action_draft('76200000-0000-4000-8000-000000000012', 'draft_plan_of_correction', 'Unassigned review', '76200000-0000-4000-8000-000000000202', '[{"title":"Review overdue work"}]')$$, '42501', null, 'valid receipt does not bypass manager facility assignment');
select pg_temp.act_as('76200000-0000-4000-8000-000000000103');
select throws_ok($$select public.create_copilot_action_draft('76200000-0000-4000-8000-000000000011', 'readiness_score', 'Auditor proposal', '76200000-0000-4000-8000-000000000201', '[{"title":"Review overdue work"}]')$$, '42501', null, 'read-only auditor cannot create a proposal');
reset role;
select throws_ok($$update public.copilot_action_drafts set source_response_id='76200000-0000-4000-8000-000000000202' where title='Scoped review' and organization_id='76200000-0000-4000-8000-000000000001'$$, '22023', 'Copilot source response must be completed and belong to this facility', 'source changes cannot bypass the scope guard');
select is((select count(*)::integer from public.work_items where organization_id='76200000-0000-4000-8000-000000000001'), 0, 'creating drafts does not create operational work');
select * from finish();
rollback;
