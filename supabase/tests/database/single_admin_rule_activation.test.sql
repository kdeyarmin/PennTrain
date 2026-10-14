begin;
select plan(17);

insert into public.organizations (id, name, slug, subscription_status)
values
  ('8de20000-0000-4000-8000-000000000001', 'Single Admin Org', 'single-admin-org', 'active'),
  ('8de20000-0000-4000-8000-000000000002', 'Other Admin Org', 'single-admin-other', 'active');

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
  ('8de20000-0000-4000-8000-000000000011'::uuid, 'single-admin@platform.test'),
  ('8de20000-0000-4000-8000-000000000012'::uuid, 'sms-admin@platform.test'),
  ('8de20000-0000-4000-8000-000000000013'::uuid, 'target-staff@single-admin.test'),
  ('8de20000-0000-4000-8000-000000000014'::uuid, 'other-requester@single-admin.test')
) as fixture(id, email);

select set_config('app.privileged_write', 'on', true);
insert into public.profiles (id, organization_id, email, first_name, last_name, role, is_active)
values
  ('8de20000-0000-4000-8000-000000000011', null, 'single-admin@platform.test', 'Only', 'Admin', 'platform_admin', true),
  ('8de20000-0000-4000-8000-000000000012', null, 'sms-admin@platform.test', 'Text', 'Admin', 'platform_admin', true),
  ('8de20000-0000-4000-8000-000000000013', '8de20000-0000-4000-8000-000000000001', 'target-staff@single-admin.test', 'Target', 'Staff', 'employee', true),
  ('8de20000-0000-4000-8000-000000000014', '8de20000-0000-4000-8000-000000000002', 'other-requester@single-admin.test', 'Other', 'Requester', 'employee', true)
on conflict (id) do update set
  organization_id = excluded.organization_id,
  email = excluded.email,
  first_name = excluded.first_name,
  last_name = excluded.last_name,
  role = excluded.role,
  is_active = excluded.is_active;
select set_config('app.privileged_write', 'off', true);

insert into auth.sessions (id, user_id, created_at, updated_at, aal, not_after)
values
  ('8de20000-0000-4000-8000-000000000101', '8de20000-0000-4000-8000-000000000011', now(), now(), 'aal2', null),
  ('8de20000-0000-4000-8000-000000000102', '8de20000-0000-4000-8000-000000000012', now(), now(), 'aal1', null);

insert into app_private.sms_mfa_accounts (profile_id)
values ('8de20000-0000-4000-8000-000000000012');
insert into app_private.sms_mfa_factors (id, profile_id, phone)
values ('8de20000-0000-4000-8000-000000000701', '8de20000-0000-4000-8000-000000000012', '+15555550801');
insert into app_private.sms_mfa_challenges (
  id, profile_id, session_id, phone, purpose, state, consumed_at
) values (
  '8de20000-0000-4000-8000-000000000702', '8de20000-0000-4000-8000-000000000012',
  '8de20000-0000-4000-8000-000000000102', '+15555550801', 'verify', 'consumed', now()
);
insert into app_private.sms_mfa_session_assurance (
  session_id, profile_id, factor_id, challenge_id, expires_at
) values (
  '8de20000-0000-4000-8000-000000000102', '8de20000-0000-4000-8000-000000000012',
  '8de20000-0000-4000-8000-000000000701', '8de20000-0000-4000-8000-000000000702',
  now() + interval '1 hour'
);

create or replace function pg_temp.act_as(p_profile_id uuid, p_aal text, p_session_id uuid default null)
returns void
language plpgsql
as $function$
begin
  reset role;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', p_profile_id,
      'role', 'authenticated',
      'aal', p_aal,
      'iat', extract(epoch from now())::bigint,
      'session_id', p_session_id
    )::text,
    true
  );
  set local role authenticated;
end;
$function$;

select has_function(
  'public', 'install_and_activate_regulatory_rule_pack', array['text', 'text'],
  'one administrator can install and activate a Pennsylvania pack'
);

select pg_temp.act_as('8de20000-0000-4000-8000-000000000011', 'aal2', '8de20000-0000-4000-8000-000000000101');
select is(
  public.identity_operation_requires_aal2('regulatory_governance'),
  true,
  'regulatory governance is on the platform AAL2 baseline'
);
select throws_ok(
  $$ select public.install_and_activate_regulatory_rule_pack(
    'oh.rcf.3701-16.personnel', 'Ohio stays a mechanism draft'
  ) $$,
  '22023', null,
  'the combined action is limited to the Pennsylvania personnel packs'
);

select pg_temp.act_as('8de20000-0000-4000-8000-000000000012', 'aal1', '8de20000-0000-4000-8000-000000000102');
select is(
  public.identity_assurance_is_current('regulatory_governance'),
  true,
  'a texted-code MFA proof satisfies regulatory governance without a native AAL2 token'
);
select lives_ok(
  $$ select public.install_and_activate_regulatory_rule_pack(
    'pa.pch.2600.65.personnel',
    'Single administrator approved the counsel-cleared PCH personnel pack'
  ) $$,
  'SMS-verified administrator installs and activates the PCH pack'
);
select is(
  (select state from public.regulatory_rule_versions v
    join public.regulatory_rule_packs p on p.id = v.rule_pack_id
    where p.rule_key = 'pa.pch.2600.65.personnel'),
  'active',
  'the PCH pack is active'
);
select is(
  (select reviewed_by = authored_by and shadow_started_at is null
    from public.regulatory_rule_versions v
    join public.regulatory_rule_packs p on p.id = v.rule_pack_id
    where p.rule_key = 'pa.pch.2600.65.personnel'),
  true,
  'the same administrator is recorded as author and reviewer, with no shadow period'
);
select is(
  (select count(*) = count(*) filter (where latest.passed)
    and count(*) = 3
    from public.regulatory_rule_golden_fixtures f
    join public.regulatory_rule_versions v on v.id = f.rule_version_id
    join public.regulatory_rule_packs p on p.id = v.rule_pack_id
    left join lateral (
      select r.passed from public.regulatory_rule_fixture_runs r
      where r.fixture_id = f.id
      order by r.executed_at desc, r.id desc
      limit 1
    ) latest on true
    where p.rule_key = 'pa.pch.2600.65.personnel'),
  true,
  'all three shipped PCH fixtures pass against the hour floors'
);
select is(
  public.install_and_activate_regulatory_rule_pack(
    'pa.pch.2600.65.personnel',
    'Single administrator approved the counsel-cleared PCH personnel pack'
  ),
  (select v.id from public.regulatory_rule_versions v
    join public.regulatory_rule_packs p on p.id = v.rule_pack_id
    where p.rule_key = 'pa.pch.2600.65.personnel' and v.state = 'active'),
  'activating an already active pack returns that version'
);

select pg_temp.act_as('8de20000-0000-4000-8000-000000000011', 'aal1', '8de20000-0000-4000-8000-000000000101');
select throws_ok(
  $$ select public.install_and_activate_regulatory_rule_pack(
    'pa.alf.2800.65.personnel',
    'Password-only session cannot activate the ALF pack'
  ) $$,
  '42501', null,
  'a password-only session cannot install and activate a pack'
);

select pg_temp.act_as('8de20000-0000-4000-8000-000000000011', 'aal2', '8de20000-0000-4000-8000-000000000101');
select lives_ok(
  $$ select public.install_and_activate_regulatory_rule_pack(
    'pa.alf.2800.65.personnel',
    'Single administrator approved the counsel-cleared ALF personnel pack'
  ) $$,
  'native AAL2 administrator installs and activates the ALF pack'
);
select is(
  (select count(*) = count(*) filter (where latest.passed) and count(*) = 3
    from public.regulatory_rule_golden_fixtures f
    join public.regulatory_rule_versions v on v.id = f.rule_version_id
    join public.regulatory_rule_packs p on p.id = v.rule_pack_id
    left join lateral (
      select r.passed from public.regulatory_rule_fixture_runs r
      where r.fixture_id = f.id
      order by r.executed_at desc, r.id desc
      limit 1
    ) latest on true
    where p.rule_key = 'pa.alf.2800.65.personnel' and v.state = 'active'),
  true,
  'all three shipped ALF fixtures pass, including dementia hours that do not count'
);

select lives_ok(
  $$ select public.grant_identity_break_glass(
    '8de20000-0000-4000-8000-000000000013',
    '8de20000-0000-4000-8000-000000000011',
    'Emergency access recorded by the only platform administrator',
    'INC-1001',
    now() + interval '2 hours'
  ) $$,
  'the platform administrator may request and approve break-glass access'
);
select is(
  (select requested_by = approved_by
    from public.identity_break_glass_events
    where target_profile_id = '8de20000-0000-4000-8000-000000000013'),
  true,
  'break-glass evidence records the same person as requester and approver'
);
select throws_ok(
  $$ select public.grant_identity_break_glass(
    '8de20000-0000-4000-8000-000000000013',
    '8de20000-0000-4000-8000-000000000014',
    'A requester from another organization is still refused',
    'INC-1002',
    now() + interval '2 hours'
  ) $$,
  '23514', null,
  'a different requester must still share the target organization'
);

select lives_ok(
  $$ select public.set_organization_entitlement_grant(
    '8de20000-0000-4000-8000-000000000001',
    'limits.learners',
    'grant',
    '5'::jsonb,
    'Single administrator approved this contractual grant',
    now(),
    null,
    'single-admin-contract',
    '8de20000-0000-4000-8000-000000000011'
  ) $$,
  'the creating administrator may also be the entitlement approver'
);
select is(
  (select created_by = approved_by
    from public.organization_entitlement_grants
    where organization_id = '8de20000-0000-4000-8000-000000000001'
      and feature_key = 'limits.learners'
      and effective_to is null),
  true,
  'the entitlement grant records who created and approved it'
);

select * from finish();
rollback;
