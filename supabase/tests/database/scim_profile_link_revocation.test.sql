-- PT-008: SCIM subject links must resolve and persist the profile they govern
-- so suspend/deprovision actually revoke login (profiles.is_active = false AND
-- auth.sessions deleted) and re-enable restores it, including for profiles that
-- were bridged by verified email or SSO rather than invite provisioning.
begin;
select plan(22);

select has_function('app_private', 'resolve_scim_link_profile_id',
  array['uuid', 'uuid', 'text'],
  'SCIM link-to-profile resolution is a governed helper');

insert into public.organizations (id, name, slug)
values ('77000000-0000-4000-8000-000000000001', 'PT008 SCIM Org', 'pt008-scim-org');

insert into public.facilities (id, organization_id, name, facility_type)
values ('77000000-0000-4000-8000-000000000011',
  '77000000-0000-4000-8000-000000000001', 'PT008 PCH', 'PCH');

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
  ('77000000-0000-4000-8000-000000000101'::uuid, 'bridge-user@pt008.example'),
  ('77000000-0000-4000-8000-000000000102'::uuid, 'invited-user@pt008.example'),
  ('77000000-0000-4000-8000-000000000103'::uuid, 'backfill-user@pt008.example'),
  ('77000000-0000-4000-8000-000000000105'::uuid, 'sso-user@pt008.example')
) as fixture(id, email);

select set_config('app.privileged_write', 'on', true);
insert into public.profiles (
  id, organization_id, email, first_name, last_name, role, is_active, created_at
)
values
  ('77000000-0000-4000-8000-000000000101', '77000000-0000-4000-8000-000000000001',
    'bridge-user@pt008.example', 'Bridge', 'User', 'employee', true, now()),
  ('77000000-0000-4000-8000-000000000102', '77000000-0000-4000-8000-000000000001',
    'invited-user@pt008.example', 'Invited', 'User', 'employee', true, now()),
  ('77000000-0000-4000-8000-000000000103', '77000000-0000-4000-8000-000000000001',
    'backfill-user@pt008.example', 'Backfill', 'User', 'employee', true, now()),
  -- Older than the SSO-linked twin below, so a naive email match would pick it:
  -- proves the SSO-linked profile is preferred by the resolver.
  ('77000000-0000-4000-8000-000000000105', '77000000-0000-4000-8000-000000000001',
    'sso-user@pt008.example', 'Plain', 'Twin', 'employee', true, now() - interval '2 days')
on conflict (id) do update set
  organization_id = excluded.organization_id,
  email = excluded.email,
  first_name = excluded.first_name,
  last_name = excluded.last_name,
  role = excluded.role,
  is_active = excluded.is_active,
  created_at = excluded.created_at;
select set_config('app.privileged_write', 'off', true);

-- Verified tenant identity domain (SCIM userName enforcement target).
insert into public.organization_identity_domains (
  id, organization_id, domain, verification_status, verification_challenge_sha256,
  verified_at, created_by
)
values (
  '77000000-0000-4000-8000-000000000021', '77000000-0000-4000-8000-000000000001',
  'pt008.example', 'verified', repeat('a', 64), now(),
  '77000000-0000-4000-8000-000000000101'
);

-- Active SSO connection on the verified domain, then a real SSO JIT user whose
-- auth.identities row auto-creates the identity_subject_links bridge target.
insert into public.organization_sso_connections (
  id, organization_id, identity_domain_id, provider, provider_connection_id,
  display_name, status, created_by
)
values (
  '77000000-0000-4000-8000-000000000301', '77000000-0000-4000-8000-000000000001',
  '77000000-0000-4000-8000-000000000021', 'saml',
  '77000000-0000-4000-8000-000000000302', 'PT008 SAML', 'active',
  '77000000-0000-4000-8000-000000000101'
);
update public.organization_sso_connections
set jit_membership_enabled = true,
    jit_membership_policy = '{"allowNewUsers":true}'
where id = '77000000-0000-4000-8000-000000000301';

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
)
values (
  '00000000-0000-0000-0000-000000000000',
  '77000000-0000-4000-8000-000000000104', 'authenticated', 'authenticated',
  'sso-user@pt008.example', 'x', now(),
  '{"provider":"sso:77000000-0000-4000-8000-000000000302","providers":["sso:77000000-0000-4000-8000-000000000302"]}',
  '{"first_name":"SSO","last_name":"Linked"}', now(), now(),
  '', '', '', '', '', '', true, false
);
insert into auth.identities (
  provider_id, user_id, identity_data, provider, created_at, updated_at
)
values (
  'pt008-saml-name-id-1', '77000000-0000-4000-8000-000000000104',
  '{"email":"sso-user@pt008.example"}',
  'sso:77000000-0000-4000-8000-000000000302', now(), now()
);

-- SCIM connection with the standard salted-digest credential shape.
insert into public.scim_connections (
  id, organization_id, connection_key, display_name, provider, status,
  default_facility_id, credential_salt, credential_hash_sha256,
  credential_hint, created_by
)
values (
  '77000000-0000-4000-8000-000000000401', '77000000-0000-4000-8000-000000000001',
  '77000000-0000-4000-8000-000000000402', 'PT008 SCIM', 'test-idp', 'active',
  '77000000-0000-4000-8000-000000000011', repeat('b', 32),
  encode(extensions.digest(convert_to(repeat('b', 32) || ':pt008-secret', 'utf8'), 'sha256'), 'hex'),
  'secret', '77000000-0000-4000-8000-000000000101'
);

create or replace function pg_temp.act_as(
  p_profile_id uuid,
  p_aal text,
  p_role text default 'authenticated'
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
      'iat', extract(epoch from now())::bigint
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

-- ---------------------------------------------------------------------------
-- 1) Create: the link is born with profile_id bridged by verified email.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-000000000000', 'aal2', 'service_role');
create temporary table pt008_r1 as
select public.apply_scim_change(
  '77000000-0000-4000-8000-000000000401', 'pt008-create-0001', repeat('1', 64),
  'create', 'pt008-user-001',
  '{"operation":"create","externalId":"pt008-user-001","userName":"bridge-user@pt008.example","name":{"givenName":"Bridge","familyName":"User"},"employeeNumber":"PT8-001","jobTitle":"Direct Care","groups":[]}'
) as result;
reset role;
select ok((select (result ->> 'ok')::boolean from pt008_r1),
  'SCIM create succeeds for an email-bridged subject');
select diag('create pt008-user-001 failed: ' || result::text)
from pt008_r1 where not coalesce((result ->> 'ok')::boolean, false);
select is(
  (select profile_id from public.scim_subject_links
    where external_subject_id = 'pt008-user-001'),
  '77000000-0000-4000-8000-000000000101'::uuid,
  'link creation populates profile_id from the verified-email profile match'
);

-- ---------------------------------------------------------------------------
-- 2) Deprovision: login disabled AND sessions deleted; link retained.
-- ---------------------------------------------------------------------------
insert into auth.sessions (id, user_id, created_at, updated_at, aal)
values ('77000000-0000-4000-8000-000000000901',
  '77000000-0000-4000-8000-000000000101', now(), now(), 'aal1');

select pg_temp.act_as('00000000-0000-0000-0000-000000000000', 'aal2', 'service_role');
create temporary table pt008_r2 as
select public.apply_scim_change(
  '77000000-0000-4000-8000-000000000401', 'pt008-deprovision-0001', repeat('2', 64),
  'deprovision', 'pt008-user-001',
  '{"operation":"deprovision","externalId":"pt008-user-001","userName":"bridge-user@pt008.example"}'
) as result;
reset role;
select ok((select (result ->> 'ok')::boolean from pt008_r2),
  'SCIM deprovision succeeds for the linked subject');
select diag('deprovision pt008-user-001 failed: ' || result::text)
from pt008_r2 where not coalesce((result ->> 'ok')::boolean, false);
select is(
  (select is_active from public.profiles
    where id = '77000000-0000-4000-8000-000000000101'),
  false,
  'deprovision disables login: profiles.is_active becomes false'
);
select is(
  (select count(*)::integer from auth.sessions
    where user_id = '77000000-0000-4000-8000-000000000101'),
  0,
  'deprovision also deletes the profile''s auth sessions'
);
select is(
  (select lifecycle_state from public.scim_subject_links
    where external_subject_id = 'pt008-user-001'),
  'deprovisioned',
  'the subject link is retained in a terminal lifecycle state'
);
select is(
  (select profile_id from public.scim_subject_links
    where external_subject_id = 'pt008-user-001'),
  '77000000-0000-4000-8000-000000000101'::uuid,
  'the deprovisioned link retains its revocation target profile'
);
select is(
  (select count(*)::integer from public.identity_session_revocations
    where profile_id = '77000000-0000-4000-8000-000000000101' and source = 'scim'),
  1,
  'deprovision retains session-revocation evidence'
);

-- ---------------------------------------------------------------------------
-- 3) Re-enable: the provider re-activates the subject; login restored only
--    because the employee row is active again.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-000000000000', 'aal2', 'service_role');
create temporary table pt008_r3 as
select public.apply_scim_change(
  '77000000-0000-4000-8000-000000000401', 'pt008-reenable-0001', repeat('3', 64),
  'update', 'pt008-user-001',
  '{"operation":"update","externalId":"pt008-user-001","userName":"bridge-user@pt008.example","name":{"givenName":"Bridge","familyName":"User"},"jobTitle":"Direct Care","groups":[]}'
) as result;
reset role;
select ok((select (result ->> 'ok')::boolean from pt008_r3),
  'SCIM re-enable (update) succeeds after deprovision');
select diag('re-enable pt008-user-001 failed: ' || result::text)
from pt008_r3 where not coalesce((result ->> 'ok')::boolean, false);
select is(
  (select e.status from public.employees e
    join public.scim_subject_links s on s.employee_id = e.id
    where s.external_subject_id = 'pt008-user-001'),
  'active',
  're-enable rehires the employee row through the governed lifecycle'
);
select is(
  (select is_active from public.profiles
    where id = '77000000-0000-4000-8000-000000000101'),
  true,
  're-enable restores login because the employee row is active'
);

-- ---------------------------------------------------------------------------
-- 4) A subject with no matching profile links cleanly with a null profile_id.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-000000000000', 'aal2', 'service_role');
create temporary table pt008_r4 as
select public.apply_scim_change(
  '77000000-0000-4000-8000-000000000401', 'pt008-create-0002', repeat('4', 64),
  'create', 'pt008-user-002',
  '{"operation":"create","externalId":"pt008-user-002","userName":"no-profile@pt008.example","name":{"givenName":"No","familyName":"Profile"},"jobTitle":"Direct Care","groups":[]}'
) as result;
reset role;
select ok((select (result ->> 'ok')::boolean from pt008_r4),
  'SCIM create succeeds when no profile matches the subject');
select diag('create pt008-user-002 failed: ' || result::text)
from pt008_r4 where not coalesce((result ->> 'ok')::boolean, false);
select is(
  (select profile_id from public.scim_subject_links
    where external_subject_id = 'pt008-user-002'),
  null::uuid,
  'a profile-less subject keeps a null profile_id without error'
);

-- ---------------------------------------------------------------------------
-- 5) Invite provisioning later attaches a profile: the next SCIM operation
--    adopts employees.profile_id as the authoritative link.
-- ---------------------------------------------------------------------------
update public.employees e
set profile_id = '77000000-0000-4000-8000-000000000102'
from public.scim_subject_links s
where s.employee_id = e.id and s.external_subject_id = 'pt008-user-002';

select pg_temp.act_as('00000000-0000-0000-0000-000000000000', 'aal2', 'service_role');
create temporary table pt008_r5 as
select public.apply_scim_change(
  '77000000-0000-4000-8000-000000000401', 'pt008-invite-update-0001', repeat('5', 64),
  'update', 'pt008-user-002',
  '{"operation":"update","externalId":"pt008-user-002","userName":"no-profile@pt008.example","name":{"givenName":"No","familyName":"Profile"},"jobTitle":"Direct Care","groups":[]}'
) as result;
reset role;
select ok((select (result ->> 'ok')::boolean from pt008_r5),
  'SCIM update succeeds after invite provisioning links the employee');
select diag('invite update pt008-user-002 failed: ' || result::text)
from pt008_r5 where not coalesce((result ->> 'ok')::boolean, false);
select is(
  (select profile_id from public.scim_subject_links
    where external_subject_id = 'pt008-user-002'),
  '77000000-0000-4000-8000-000000000102'::uuid,
  'the link adopts the invite-provisioned employees.profile_id'
);

-- Suspend now revokes the invite-provisioned login...
select pg_temp.act_as('00000000-0000-0000-0000-000000000000', 'aal2', 'service_role');
create temporary table pt008_r6 as
select public.apply_scim_change(
  '77000000-0000-4000-8000-000000000401', 'pt008-suspend-0002', repeat('6', 64),
  'suspend', 'pt008-user-002',
  '{"operation":"suspend","externalId":"pt008-user-002","userName":"no-profile@pt008.example"}'
) as result;
reset role;
select ok((select (result ->> 'ok')::boolean from pt008_r6),
  'SCIM suspend succeeds for the invite-linked subject');
select diag('suspend pt008-user-002 failed: ' || result::text)
from pt008_r6 where not coalesce((result ->> 'ok')::boolean, false);
select is(
  (select is_active from public.profiles
    where id = '77000000-0000-4000-8000-000000000102'),
  false,
  'suspend disables the linked login'
);

-- ...and re-enable restores it because the employee row is active.
select pg_temp.act_as('00000000-0000-0000-0000-000000000000', 'aal2', 'service_role');
create temporary table pt008_r7 as
select public.apply_scim_change(
  '77000000-0000-4000-8000-000000000401', 'pt008-reenable-0002', repeat('7', 64),
  'update', 'pt008-user-002',
  '{"operation":"update","externalId":"pt008-user-002","userName":"no-profile@pt008.example","name":{"givenName":"No","familyName":"Profile"},"jobTitle":"Direct Care","groups":[]}'
) as result;
reset role;
select ok((select (result ->> 'ok')::boolean from pt008_r7),
  'SCIM re-enable succeeds after suspension');
select diag('re-enable pt008-user-002 failed: ' || result::text)
from pt008_r7 where not coalesce((result ->> 'ok')::boolean, false);
select is(
  (select is_active from public.profiles
    where id = '77000000-0000-4000-8000-000000000102'),
  true,
  're-enable after suspension restores the linked login'
);

-- ---------------------------------------------------------------------------
-- 6) SSO bridging and migration backfill.
-- ---------------------------------------------------------------------------
insert into public.employees (
  id, organization_id, facility_id, first_name, last_name, email,
  hire_date, job_title, status
)
values (
  '77000000-0000-4000-8000-000000000031', '77000000-0000-4000-8000-000000000001',
  '77000000-0000-4000-8000-000000000011', 'Backfill', 'User',
  'backfill-user@pt008.example', current_date, 'Direct Care', 'active'
);

select is(
  app_private.resolve_scim_link_profile_id(
    '77000000-0000-4000-8000-000000000001',
    '77000000-0000-4000-8000-000000000031',
    'sso-user@pt008.example'
  ),
  '77000000-0000-4000-8000-000000000104'::uuid,
  'resolution prefers the SSO-linked profile over an older email twin'
);

-- A pre-fix link row (profile_id never written) is repaired by the migration's
-- backfill statement.
insert into public.scim_subject_links (
  organization_id, scim_connection_id, external_subject_id, user_name,
  employee_id, lifecycle_state, last_request_id
)
values (
  '77000000-0000-4000-8000-000000000001', '77000000-0000-4000-8000-000000000401',
  'pt008-user-004', 'backfill-user@pt008.example',
  '77000000-0000-4000-8000-000000000031', 'active', 'pt008-seed-0001'
);

update public.scim_subject_links l
set profile_id = app_private.resolve_scim_link_profile_id(
  l.organization_id, l.employee_id, l.user_name
)
where l.profile_id is null
  and app_private.resolve_scim_link_profile_id(
    l.organization_id, l.employee_id, l.user_name
  ) is not null;

select is(
  (select profile_id from public.scim_subject_links
    where external_subject_id = 'pt008-user-004'),
  '77000000-0000-4000-8000-000000000103'::uuid,
  'the backfill resolves profile_id for links created before the fix'
);

select * from finish();
rollback;
