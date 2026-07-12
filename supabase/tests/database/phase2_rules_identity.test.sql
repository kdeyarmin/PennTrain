begin;
select plan(51);

select has_table('public', 'regulatory_rule_versions',
  'versioned regulatory rules are persisted');
select has_table('public', 'regulatory_rule_golden_fixtures',
  'deterministic golden fixtures are persisted');
select has_table('public', 'regulatory_rule_shadow_reconciliations',
  'shadow differences require retained reconciliation evidence');
select has_table('public', 'organization_identity_domains',
  'tenant domain verification has a registry');
select has_table('public', 'scim_request_receipts',
  'SCIM replay receipts are retained');
select has_function('public', 'submit_regulatory_rule_version', array['uuid'],
  'rule review submission uses a governed RPC');
select has_function('public', 'apply_scim_change',
  array['uuid', 'text', 'text', 'text', 'text', 'jsonb'],
  'SCIM changes use one idempotent lifecycle RPC');
select has_function('public', 'create_scim_connection',
  array['uuid', 'text', 'text', 'uuid'],
  'SCIM credential creation accepts no caller-supplied secret material');
select ok(
  exists (
    select 1
    from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.scim_connections'::regclass
      and t.tgname = 'audit_log'
      and not t.tgisinternal
  ),
  'SCIM control-plane mutations produce structured audit evidence'
);

insert into public.organizations (id, name, slug)
values
  ('32000000-0000-4000-8000-000000000001', 'Phase Two Identity A', 'phase-two-identity-a'),
  ('32000000-0000-4000-8000-000000000002', 'Phase Two Identity B', 'phase-two-identity-b');

insert into public.facilities (id, organization_id, name, facility_type)
values
  ('32000000-0000-4000-8000-000000000011', '32000000-0000-4000-8000-000000000001', 'Identity PCH', 'PCH'),
  ('32000000-0000-4000-8000-000000000012', '32000000-0000-4000-8000-000000000002', 'Identity ALR', 'ALR');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
)
select
  '00000000-0000-0000-0000-000000000000', fixture.id, 'authenticated',
  'authenticated', fixture.email, 'x', now(), '{}'::jsonb, '{}'::jsonb,
  now(), now(), '', '', '', '', '', '', false, false
from (values
  ('32000000-0000-4000-8000-000000000101'::uuid, 'rule-author@platform.test'),
  ('32000000-0000-4000-8000-000000000102'::uuid, 'rule-reviewer@platform.test'),
  ('32000000-0000-4000-8000-000000000103'::uuid, 'identity-admin@alpha.example'),
  ('32000000-0000-4000-8000-000000000104'::uuid, 'scim-user@alpha.example'),
  ('32000000-0000-4000-8000-000000000105'::uuid, 'unsafe-link@unverified.example')
) as fixture(id, email);

select set_config('app.privileged_write', 'on', true);
insert into public.profiles (
  id, organization_id, email, first_name, last_name, role, is_active
)
values
  ('32000000-0000-4000-8000-000000000101', null, 'rule-author@platform.test', 'Rule', 'Author', 'platform_admin', true),
  ('32000000-0000-4000-8000-000000000102', null, 'rule-reviewer@platform.test', 'Rule', 'Reviewer', 'platform_admin', true),
  ('32000000-0000-4000-8000-000000000103', '32000000-0000-4000-8000-000000000001', 'identity-admin@alpha.example', 'Identity', 'Admin', 'org_admin', true),
  ('32000000-0000-4000-8000-000000000104', '32000000-0000-4000-8000-000000000001', 'scim-user@alpha.example', 'SCIM', 'User', 'employee', true),
  ('32000000-0000-4000-8000-000000000105', '32000000-0000-4000-8000-000000000001', 'unsafe-link@unverified.example', 'Unsafe', 'Link', 'employee', true)
on conflict (id) do update set
  organization_id = excluded.organization_id,
  email = excluded.email,
  first_name = excluded.first_name,
  last_name = excluded.last_name,
  role = excluded.role,
  is_active = excluded.is_active;
select set_config('app.privileged_write', 'off', true);

create or replace function pg_temp.act_as(
  p_profile_id uuid,
  p_aal text,
  p_role text default 'authenticated',
  p_iat bigint default null,
  p_session_id uuid default null
)
returns void
language plpgsql
as $function$
begin
  reset role;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', p_profile_id,
      'role', p_role,
      'aal', p_aal,
      'iat', coalesce(p_iat, extract(epoch from now())::bigint),
      'session_id', p_session_id
    )::text,
    true
  );
  if p_role = 'service_role' then
    set local role service_role;
  else
    set local role authenticated;
  end if;
end;
$function$;

select pg_temp.act_as('32000000-0000-4000-8000-000000000103', 'aal2');
select throws_ok(
  $$ insert into public.identity_security_policies(
    organization_id, require_aal2, updated_by
  ) values (
    '32000000-0000-4000-8000-000000000001', false,
    '32000000-0000-4000-8000-000000000103'
  ) $$,
  '23514', null,
  'tenant identity policy may not weaken the privileged AAL2 floor'
);
reset role;

-- Seed an already-active historic version, then move its successor through the
-- real author/reviewer/shadow activation path.
insert into public.regulatory_rule_packs (id, rule_key, name, owner_profile_id)
values (
  '32000000-0000-4000-8000-000000000201', 'pa.training.annual',
  'Pennsylvania annual training baseline', '32000000-0000-4000-8000-000000000101'
);

insert into public.regulatory_rule_versions (
  id, rule_pack_id, version_number, state, jurisdiction_code, authority_name,
  citation, source_uri, source_checksum_sha256, applicability,
  calculation_parameters, effective_from, release_notes, authored_by,
  submitted_by, submitted_at, reviewed_by, review_notes, approved_at, activated_at
)
values (
  '32000000-0000-4000-8000-000000000211',
  '32000000-0000-4000-8000-000000000201', 1, 'active', 'US-PA',
  'Pennsylvania Department of Human Services', '55 Pa. Code test baseline',
  'https://example.test/rules/v1', repeat('1', 64),
  '{"facilityTypes":["PCH","ALR"]}', '{"annualHours":12,"graceDays":0}',
  date '2024-01-01', 'Initial governed baseline',
  '32000000-0000-4000-8000-000000000101',
  '32000000-0000-4000-8000-000000000101', now() - interval '2 years',
  '32000000-0000-4000-8000-000000000102', 'Independent baseline approval',
  now() - interval '2 years', now() - interval '2 years'
);

select pg_temp.act_as('32000000-0000-4000-8000-000000000101', 'aal2');
insert into public.regulatory_rule_versions (
  id, rule_pack_id, version_number, jurisdiction_code, authority_name,
  citation, source_uri, source_checksum_sha256, applicability,
  calculation_parameters, effective_from, supersedes_version_id,
  release_notes, authored_by
)
values (
  '32000000-0000-4000-8000-000000000212',
  '32000000-0000-4000-8000-000000000201', 2, 'US-PA',
  'Pennsylvania Department of Human Services', '55 Pa. Code test amendment',
  'https://example.test/rules/v2', repeat('2', 64),
  '{"facilityTypes":["PCH","ALR"]}', '{"annualHours":16,"graceDays":5}',
  date '2026-01-01', '32000000-0000-4000-8000-000000000211',
  'Increase annual hours with a defined grace period',
  '32000000-0000-4000-8000-000000000101'
);
insert into public.regulatory_rule_golden_fixtures (
  id, rule_version_id, fixture_key, facility_type, workforce_profile_key,
  boundary_date, input_payload, expected_result, created_by
)
values
  (
    '32000000-0000-4000-8000-000000000221',
    '32000000-0000-4000-8000-000000000212', 'pch-renewal-boundary', 'PCH',
    'direct-care', date '2026-01-01', '{"completedHours":16}',
    '{"compliant":true,"requiredHours":16}', '32000000-0000-4000-8000-000000000101'
  ),
  (
    '32000000-0000-4000-8000-000000000222',
    '32000000-0000-4000-8000-000000000212', 'alr-grace-boundary', 'ALR',
    'medication-administration', date '2026-01-06', '{"completedHours":15}',
    '{"compliant":false,"requiredHours":16}', '32000000-0000-4000-8000-000000000101'
  );
select public.submit_regulatory_rule_version('32000000-0000-4000-8000-000000000212');

select throws_ok(
  $$ select public.approve_regulatory_rule_version(
    '32000000-0000-4000-8000-000000000212', 'Author cannot self approve this version'
  ) $$,
  '42501', null,
  'the author cannot approve their own regulatory version'
);

reset role;
select pg_temp.act_as('32000000-0000-4000-8000-000000000102', 'aal1');
select throws_ok(
  $$ select public.approve_regulatory_rule_version(
    '32000000-0000-4000-8000-000000000212', 'Independent regulatory approval notes'
  ) $$,
  '42501', null,
  'an AAL1 privileged session cannot approve a regulatory version'
);

reset role;
select pg_temp.act_as('32000000-0000-4000-8000-000000000102', 'aal2');
select lives_ok(
  $$ select public.approve_regulatory_rule_version(
    '32000000-0000-4000-8000-000000000212', 'Independent regulatory approval notes'
  ) $$,
  'a separate AAL2 reviewer can approve the version'
);
select is(
  (select reviewed_by from public.regulatory_rule_versions
    where id = '32000000-0000-4000-8000-000000000212'),
  '32000000-0000-4000-8000-000000000102'::uuid,
  'approval evidence preserves the independent reviewer'
);
select public.start_regulatory_rule_shadow('32000000-0000-4000-8000-000000000212');
select throws_ok(
  $$ select public.record_regulatory_shadow_run(
    '32000000-0000-4000-8000-000000000212',
    '32000000-0000-4000-8000-000000000001', 'PCH',
    '32000000-0000-4000-8000-000000000211', now() - interval '40 days',
    now(), 20, 'phase2-test-engine', 'fabricated-shadow-history', '[]'
  ) $$,
  '22007', null,
  'a shadow run cannot claim cohort history from before shadow mode began'
);
reset role;
select set_config('app.regulatory_rule_transition', 'on', true);
update public.regulatory_rule_versions
set shadow_started_at = now() - interval '41 days'
where id = '32000000-0000-4000-8000-000000000212';
select set_config('app.regulatory_rule_transition', '', true);
select pg_temp.act_as('32000000-0000-4000-8000-000000000102', 'aal2');
select public.record_regulatory_fixture_result(
  '32000000-0000-4000-8000-000000000221', 'phase2-test-engine',
  '{"compliant":true,"requiredHours":16}', 'fixture-run-0001'
);
select public.record_regulatory_fixture_result(
  '32000000-0000-4000-8000-000000000222', 'phase2-test-engine',
  '{"compliant":false,"requiredHours":16}', 'fixture-run-0002'
);
select throws_ok(
  $$ select public.record_regulatory_fixture_result(
    '32000000-0000-4000-8000-000000000221', 'phase2-test-engine',
    '{"compliant":false,"requiredHours":999}', 'fixture-run-0001'
  ) $$,
  '23505', null,
  'a fixture request id cannot replay with different result content'
);
select public.record_regulatory_shadow_run(
  '32000000-0000-4000-8000-000000000212',
  '32000000-0000-4000-8000-000000000001', 'PCH',
  '32000000-0000-4000-8000-000000000211', now() - interval '40 days',
  now() - interval '2 days', 20, 'phase2-test-engine', 'shadow-run-org-a',
  '[{"subjectReference":"employee-1","baselineResult":{"requiredHours":12},"candidateResult":{"requiredHours":16}}]'
);
select throws_ok(
  $$ select public.record_regulatory_shadow_run(
    '32000000-0000-4000-8000-000000000212',
    '32000000-0000-4000-8000-000000000001', 'PCH',
    '32000000-0000-4000-8000-000000000211', now() - interval '40 days',
    now() - interval '2 days', 21, 'phase2-test-engine', 'shadow-run-org-a', '[]'
  ) $$,
  '23505', null,
  'a shadow request id cannot replay with different cohort content'
);
select public.record_regulatory_shadow_run(
  '32000000-0000-4000-8000-000000000212',
  '32000000-0000-4000-8000-000000000002', 'ALR',
  '32000000-0000-4000-8000-000000000211', now() - interval '39 days',
  now() - interval '1 day', 20, 'phase2-test-engine', 'shadow-run-org-b', '[]'
);

select throws_ok(
  $$ select public.activate_regulatory_rule_version(
    '32000000-0000-4000-8000-000000000212'
  ) $$,
  '23514', null,
  'an unexplained shadow difference blocks rule activation'
);
select public.reconcile_regulatory_shadow_difference(
  (select d.id from public.regulatory_rule_shadow_differences d
    join public.regulatory_rule_shadow_runs r on r.id = d.shadow_run_id
    where r.rule_version_id = '32000000-0000-4000-8000-000000000212'),
  'expected_change', 'The cited amendment intentionally raises annual required hours.',
  repeat('3', 64)
);
select lives_ok(
  $$ select public.activate_regulatory_rule_version(
    '32000000-0000-4000-8000-000000000212'
  ) $$,
  'a reconciled two-cohort shadow version can activate'
);
select is(
  (select version_number from public.get_regulatory_rule_snapshot(
    'pa.training.annual', date '2025-06-01')),
  1,
  'historic evaluation still resolves the superseded version'
);
select is(
  (select version_number from public.get_regulatory_rule_snapshot(
    'pa.training.annual', date '2026-06-01')),
  2,
  'current evaluation resolves the new active version'
);
select isnt(
  (select content_checksum_sha256 from public.regulatory_rule_versions
    where id = '32000000-0000-4000-8000-000000000211'),
  (select content_checksum_sha256 from public.regulatory_rule_versions
    where id = '32000000-0000-4000-8000-000000000212'),
  'historical rule versions retain distinct deterministic checksums'
);

-- MFA and trusted domain verification.
reset role;
select pg_temp.act_as('32000000-0000-4000-8000-000000000103', 'aal1');
select throws_ok(
  $$ select public.assert_identity_assurance('identity_admin') $$,
  '42501', null,
  'AAL1 cannot perform a privileged tenant identity operation'
);
reset role;
select pg_temp.act_as('32000000-0000-4000-8000-000000000103', 'aal2');
select lives_ok(
  $$ select public.assert_identity_assurance('identity_admin') $$,
  'AAL2 satisfies the privileged tenant identity policy'
);
reset role;
select pg_temp.act_as(
  '32000000-0000-4000-8000-000000000103',
  'aal2',
  'authenticated',
  extract(epoch from now() - interval '481 minutes')::bigint
);
select throws_ok(
  $$ select public.assert_identity_assurance('identity_admin') $$,
  '42501', null,
  'an expired privileged AAL2 session must reauthenticate'
);
reset role;
select pg_temp.act_as(
  '32000000-0000-4000-8000-000000000103',
  'aal2',
  'authenticated',
  extract(epoch from now())::bigint,
  '32000000-0000-4000-8000-000000000999'
);
select throws_ok(
  $$ select public.assert_identity_assurance('identity_admin') $$,
  '42501', null,
  'a JWT for a deleted Auth session is rejected immediately'
);
reset role;
select pg_temp.act_as('32000000-0000-4000-8000-000000000103', 'aal2');

select public.register_identity_domain(
  '32000000-0000-4000-8000-000000000001', 'alpha.example', repeat('a', 64)
);
select is(
  (
    select new_values ->> 'verification_challenge_sha256'
    from public.audit_logs
    where entity_type = 'organization_identity_domains'
      and entity_id = (
        select id::text
        from public.organization_identity_domains
        where domain = 'alpha.example'
      )
    order by created_at desc
    limit 1
  ),
  '[REDACTED]',
  'identity-domain DNS verifier material is redacted from audit evidence'
);
select throws_ok(
  $$ select public.verify_identity_domain(
    (select id from public.organization_identity_domains where domain = 'alpha.example'),
    repeat('a', 64)
  ) $$,
  '42501', null,
  'the registering administrator cannot self-attest DNS ownership'
);
select set_config(
  'test.phase2_alpha_domain_id',
  (select id::text from public.organization_identity_domains where domain = 'alpha.example'),
  true
);
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-000000000000', 'aal2', 'service_role');
select ok(
  public.verify_identity_domain(
    current_setting('test.phase2_alpha_domain_id')::uuid,
    repeat('a', 64)
  ),
  'the trusted verifier can verify an observed DNS challenge'
);
reset role;

insert into public.organization_identity_domains (
  id, organization_id, domain, verification_challenge_sha256, created_by
)
values (
  '32000000-0000-4000-8000-000000000291',
  '32000000-0000-4000-8000-000000000002', 'pending.example', repeat('9', 64),
  '32000000-0000-4000-8000-000000000101'
);
select throws_ok(
  $$ insert into public.organization_sso_connections (
    organization_id, identity_domain_id, provider, provider_connection_id,
    display_name, status, jit_membership_enabled, created_by
  ) values (
    '32000000-0000-4000-8000-000000000002',
    '32000000-0000-4000-8000-000000000291', 'saml',
    '32000000-0000-4000-8000-000000000292', 'Unverified SAML', 'active', true,
    '32000000-0000-4000-8000-000000000101'
  ) $$,
  '42501', null,
  'an SSO connection cannot activate against an unverified domain'
);

insert into public.organization_sso_connections (
  id, organization_id, identity_domain_id, provider, provider_connection_id,
  display_name, status, created_by
)
values (
  '32000000-0000-4000-8000-000000000301',
  '32000000-0000-4000-8000-000000000001',
  (select id from public.organization_identity_domains where domain = 'alpha.example'),
  'saml', '32000000-0000-4000-8000-000000000302', 'Phase 2 SAML', 'active',
  '32000000-0000-4000-8000-000000000103'
);
update public.organization_sso_connections
set jit_membership_enabled = true,
    jit_membership_policy = '{"allowNewUsers":true}'
where id = '32000000-0000-4000-8000-000000000301';

reset role;
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
)
values (
  '00000000-0000-0000-0000-000000000000',
  '32000000-0000-4000-8000-000000000106', 'authenticated', 'authenticated',
  'identity-admin@alpha.example', 'x', now(),
  '{"provider":"sso:32000000-0000-4000-8000-000000000302","providers":["sso:32000000-0000-4000-8000-000000000302"]}',
  '{"first_name":"SSO","last_name":"Subject"}', now(), now(),
  '', '', '', '', '', '', true, false
);
insert into auth.identities (
  provider_id, user_id, identity_data, provider, created_at, updated_at
)
values (
  'immutable-saml-name-id-001', '32000000-0000-4000-8000-000000000106',
  '{"email":"identity-admin@alpha.example"}',
  'sso:32000000-0000-4000-8000-000000000302', now(), now()
);
select is(
  (select organization_id from public.profiles where id = '32000000-0000-4000-8000-000000000106'),
  '32000000-0000-4000-8000-000000000001'::uuid,
  'verified active SSO JIT maps the Auth UUID to the connection organization'
);
select is(
  (select provider_subject from public.identity_subject_links
    where profile_id = '32000000-0000-4000-8000-000000000106'),
  'immutable-saml-name-id-001',
  'SSO subject linking uses the immutable provider NameID rather than email'
);
select is(
  (select count(*)::integer from public.profiles where email = 'identity-admin@alpha.example'),
  2,
  'SSO creates a distinct Auth UUID instead of linking an equal email account'
);
select is(
  (select count(*)::integer from public.enterprise_scope_memberships
    where profile_id = '32000000-0000-4000-8000-000000000106'
      and organization_id = '32000000-0000-4000-8000-000000000001'
      and effective_to is null),
  1,
  'SSO JIT creates an effective organization membership'
);

select pg_temp.act_as('32000000-0000-4000-8000-000000000103', 'aal2');
select throws_ok(
  $$ select public.link_sso_identity_subject(
    '32000000-0000-4000-8000-000000000301', 'provider-subject-unsafe',
    '32000000-0000-4000-8000-000000000105', 'admin_verified'
  ) $$,
  '42501', null,
  'a verified provider subject cannot link a profile from an unverified email domain'
);

-- SCIM uses a salted digest, a request hash, and the workforce lifecycle RPC.
reset role;
insert into public.scim_connections (
  id, organization_id, connection_key, display_name, provider, status,
  default_facility_id, credential_salt, credential_hash_sha256,
  credential_hint, created_by
)
values (
  '32000000-0000-4000-8000-000000000401',
  '32000000-0000-4000-8000-000000000001',
  '32000000-0000-4000-8000-000000000402', 'Phase 2 SCIM', 'test-idp', 'active',
  '32000000-0000-4000-8000-000000000011', repeat('b', 32),
  encode(extensions.digest(convert_to(repeat('b', 32) || ':provider-secret-never-store', 'utf8'), 'sha256'), 'hex'),
  '...store', '32000000-0000-4000-8000-000000000103'
);
select ok(
  (select credential_hash_sha256 <> 'provider-secret-never-store'
    and credential_hash_sha256 ~ '^[0-9a-f]{64}$'
    from public.scim_connections where id = '32000000-0000-4000-8000-000000000401'),
  'SCIM credentials are salted hashes rather than provider plaintext'
);
select ok(
  (
    select new_values ->> 'credential_salt' = '[REDACTED]'
      and new_values ->> 'credential_hash_sha256' = '[REDACTED]'
    from public.audit_logs
    where entity_type = 'scim_connections'
      and entity_id = '32000000-0000-4000-8000-000000000401'
    order by created_at desc
    limit 1
  ),
  'SCIM verifier material is redacted from audit evidence'
);

select pg_temp.act_as('00000000-0000-0000-0000-000000000000', 'aal2', 'service_role');
create temporary table phase2_scim_first as
select public.apply_scim_change(
  '32000000-0000-4000-8000-000000000401', 'scim-create-0001', repeat('c', 64),
  'create', 'provider-user-001',
  '{"operation":"create","externalId":"provider-user-001","userName":"scim-user@alpha.example","name":{"givenName":"SCIM","familyName":"Provisioned"},"employeeNumber":"SCIM-001","jobTitle":"Direct Care","groups":[]}'
) as result;
select ok((select (result ->> 'ok')::boolean from phase2_scim_first),
  'SCIM create provisions a canonical workforce subject');
select diag('SCIM create failure: ' || result::text)
from phase2_scim_first
where not coalesce((result ->> 'ok')::boolean, false);
select ok(
  (public.apply_scim_change(
    '32000000-0000-4000-8000-000000000401', 'scim-create-0001', repeat('c', 64),
    'create', 'provider-user-001',
    '{"operation":"create","externalId":"provider-user-001","userName":"scim-user@alpha.example","name":{"givenName":"SCIM","familyName":"Provisioned"},"employeeNumber":"SCIM-001","jobTitle":"Direct Care","groups":[]}'
  ) ->> 'replayed')::boolean,
  'an identical SCIM request replays the retained response'
);
reset role;
select is(
  (select count(*)::integer from public.scim_subject_links
    where external_subject_id = 'provider-user-001'),
  1,
  'SCIM replay does not duplicate the identity or employee lifecycle'
);
select throws_ok(
  $$ select public.apply_scim_change(
    '32000000-0000-4000-8000-000000000401', 'scim-create-0001', repeat('d', 64),
    'create', 'provider-user-001',
    '{"operation":"create","externalId":"provider-user-001","userName":"scim-user@alpha.example"}'
  ) $$,
  '23505', null,
  'reusing a SCIM replay key with a different payload hash is rejected'
);

reset role;
update public.employees e
set profile_id = '32000000-0000-4000-8000-000000000104'
from public.scim_subject_links link
where link.employee_id = e.id and link.external_subject_id = 'provider-user-001';
update public.scim_subject_links
set profile_id = '32000000-0000-4000-8000-000000000104'
where external_subject_id = 'provider-user-001';

select pg_temp.act_as('00000000-0000-0000-0000-000000000000', 'aal2', 'service_role');
select ok((public.apply_scim_change(
  '32000000-0000-4000-8000-000000000401', 'scim-suspend-0001', repeat('e', 64),
  'suspend', 'provider-user-001',
  '{"operation":"suspend","externalId":"provider-user-001","userName":"scim-user@alpha.example"}'
) ->> 'ok')::boolean, 'SCIM suspension uses the governed employee lifecycle');
select ok((public.apply_scim_change(
  '32000000-0000-4000-8000-000000000401', 'scim-deprovision-0001', repeat('f', 64),
  'deprovision', 'provider-user-001',
  '{"operation":"deprovision","externalId":"provider-user-001","userName":"scim-user@alpha.example"}'
) ->> 'ok')::boolean, 'SCIM deprovisioning uses the governed employee lifecycle');

reset role;
select is(
  (select lifecycle_state from public.scim_subject_links where external_subject_id = 'provider-user-001'),
  'deprovisioned',
  'SCIM deprovisioning retains the canonical identity in a terminal state'
);
select is(
  (select e.status from public.employees e join public.scim_subject_links s on s.employee_id = e.id
    where s.external_subject_id = 'provider-user-001'),
  'terminated',
  'SCIM deprovisioning terminates rather than deletes the employee'
);
select is(
  (select is_active from public.profiles where id = '32000000-0000-4000-8000-000000000104'),
  false,
  'SCIM deprovisioning immediately disables the linked profile'
);
select is(
  (select count(*)::integer from public.identity_session_revocations
    where profile_id = '32000000-0000-4000-8000-000000000104' and source = 'scim'),
  2,
  'SCIM suspension and deprovisioning retain session-revocation evidence'
);
select is(
  (select count(*)::integer from public.scim_request_receipts
    where scim_connection_id = '32000000-0000-4000-8000-000000000401'),
  3,
  'SCIM create, suspension, and deprovision receipts remain retained'
);
select throws_ok(
  $$ delete from public.scim_request_receipts where request_id = 'scim-create-0001' $$,
  '55000', null,
  'SCIM evidence cannot be deleted even by a privileged database caller'
);
select ok(
  not has_function_privilege('authenticated',
    'public.apply_scim_change(uuid,text,text,text,text,jsonb)', 'EXECUTE')
  and has_function_privilege('service_role',
    'public.apply_scim_change(uuid,text,text,text,text,jsonb)', 'EXECUTE'),
  'only the trusted service role can execute the SCIM lifecycle RPC'
);
select ok(
  not has_table_privilege('authenticated', 'public.scim_connections', 'SELECT'),
  'authenticated callers cannot read stored SCIM credential digests'
);

select * from finish();
rollback;
