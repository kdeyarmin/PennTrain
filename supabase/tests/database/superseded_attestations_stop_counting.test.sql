begin;
select plan(5);

-- Publishing a newer policy version leaves the old row pending and stamps
-- superseded_at. That row cannot be signed (BACKLOG J7). It must not keep the
-- command center, the portfolio, platform health, or the learning tile overdue.

insert into public.organizations(id, name, slug, subscription_status) values
  ('e2810000-0000-4000-8000-000000000001', 'Superseded attestation org', 'superseded-attestation-org', 'active');
insert into public.facilities(id, organization_id, name, facility_type, is_active) values
  ('e2810000-0000-4000-8000-000000000011', 'e2810000-0000-4000-8000-000000000001', 'Attestation Home', 'PCH', true);

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', 'e2810000-0000-4000-8000-000000000301', 'authenticated', 'authenticated', 'superseded-admin@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', 'e2810000-0000-4000-8000-000000000302', 'authenticated', 'authenticated', 'superseded-platform@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false);

select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('e2810000-0000-4000-8000-000000000301', 'e2810000-0000-4000-8000-000000000001', 'superseded-admin@test.local', 'Attest', 'Admin', 'org_admin', true),
  ('e2810000-0000-4000-8000-000000000302', 'e2810000-0000-4000-8000-000000000001', 'superseded-platform@test.local', 'Attest', 'Platform', 'platform_admin', true)
on conflict (id) do update set
  organization_id = excluded.organization_id,
  role = excluded.role,
  is_active = true;
select set_config('app.privileged_write', 'off', true);

insert into public.employees(
  id, organization_id, facility_id, first_name, last_name, job_title, status, hire_date
) values
  ('e2810000-0000-4000-8000-000000000101', 'e2810000-0000-4000-8000-000000000001', 'e2810000-0000-4000-8000-000000000011', 'Open', 'Staff', 'Aide', 'active', public.pa_today() - 30),
  ('e2810000-0000-4000-8000-000000000102', 'e2810000-0000-4000-8000-000000000001', 'e2810000-0000-4000-8000-000000000011', 'Closed', 'Staff', 'Aide', 'active', public.pa_today() - 30);

insert into public.policy_documents (id, organization_id, title) values
  ('e2810000-0000-4000-8000-000000000401', 'e2810000-0000-4000-8000-000000000001', 'Abuse reporting');
insert into public.policy_document_versions (
  id, policy_document_id, organization_id, version_number, storage_path,
  file_name, file_type, content_hash, status, published_at
) values (
  'e2810000-0000-4000-8000-000000000411', 'e2810000-0000-4000-8000-000000000401',
  'e2810000-0000-4000-8000-000000000001', 1,
  'e2810000-0000-4000-8000-000000000001/e2810000-0000-4000-8000-000000000401/v1.pdf',
  'abuse-reporting.pdf', 'application/pdf', repeat('d', 64), 'published', now()
);
insert into public.policy_attestation_campaigns (
  id, organization_id, policy_document_id, policy_document_version_id, name, due_date
) values
  ('e2810000-0000-4000-8000-000000000501', 'e2810000-0000-4000-8000-000000000001',
   'e2810000-0000-4000-8000-000000000401', 'e2810000-0000-4000-8000-000000000411',
   'Overdue version', public.pa_today() - 1),
  ('e2810000-0000-4000-8000-000000000502', 'e2810000-0000-4000-8000-000000000001',
   'e2810000-0000-4000-8000-000000000401', 'e2810000-0000-4000-8000-000000000411',
   'Future version', public.pa_today() + 10);

create or replace function pg_temp.act_as(p_id uuid)
returns void language plpgsql as $$
begin
  reset role;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', p_id, 'role', 'authenticated', 'aal', 'aal2', 'iat', extract(epoch from now())::bigint)::text,
    true
  );
  set local role authenticated;
end;
$$;

create temp table health_before (health jsonb);
grant all on table health_before to authenticated;

select pg_temp.act_as('e2810000-0000-4000-8000-000000000302');
insert into health_before select public.get_platform_health();

reset role;
insert into public.policy_attestations (
  id, organization_id, facility_id, employee_id, campaign_id, policy_document_version_id
) values
  ('e2810000-0000-4000-8000-000000000601', 'e2810000-0000-4000-8000-000000000001', 'e2810000-0000-4000-8000-000000000011', 'e2810000-0000-4000-8000-000000000101', 'e2810000-0000-4000-8000-000000000501', 'e2810000-0000-4000-8000-000000000411'),
  ('e2810000-0000-4000-8000-000000000602', 'e2810000-0000-4000-8000-000000000001', 'e2810000-0000-4000-8000-000000000011', 'e2810000-0000-4000-8000-000000000101', 'e2810000-0000-4000-8000-000000000502', 'e2810000-0000-4000-8000-000000000411'),
  ('e2810000-0000-4000-8000-000000000603', 'e2810000-0000-4000-8000-000000000001', 'e2810000-0000-4000-8000-000000000011', 'e2810000-0000-4000-8000-000000000102', 'e2810000-0000-4000-8000-000000000501', 'e2810000-0000-4000-8000-000000000411'),
  ('e2810000-0000-4000-8000-000000000604', 'e2810000-0000-4000-8000-000000000001', 'e2810000-0000-4000-8000-000000000011', 'e2810000-0000-4000-8000-000000000102', 'e2810000-0000-4000-8000-000000000502', 'e2810000-0000-4000-8000-000000000411');
update public.policy_attestations
set superseded_at = now()
where id in (
  'e2810000-0000-4000-8000-000000000603',
  'e2810000-0000-4000-8000-000000000604'
);

select pg_temp.act_as('e2810000-0000-4000-8000-000000000301');
select is(
  (public.get_operations_command_center('e2810000-0000-4000-8000-000000000011')->'signals'->>'overduePolicyAttestations')::integer,
  1,
  'a superseded overdue attestation does not keep the command center overdue'
);
select is(
  (
    select (x->'signals'->>'overduePolicyAttestations')::integer
    from jsonb_array_elements(public.get_portfolio_operations_command_center()->'facilities') x
    where x->'facility'->>'id' = 'e2810000-0000-4000-8000-000000000011'
  ),
  1,
  'the portfolio uses that same command-center count'
);
select is(
  (public.get_governed_learning_control_plane()->'policies'->>'pendingAttestations')::integer,
  2,
  'the learning tile counts only attestations that can still be signed'
);

select pg_temp.act_as('e2810000-0000-4000-8000-000000000302');
select is(
  (public.get_platform_health()->>'overduePolicyAttestations')::integer
    - (select (health->>'overduePolicyAttestations')::integer from health_before),
  1,
  'platform health overdue attestations skip the superseded row'
);
select is(
  (public.get_platform_health()->>'pendingPolicyAttestations')::integer
    - (select (health->>'pendingPolicyAttestations')::integer from health_before),
  2,
  'platform health pending attestations skip both superseded rows'
);

reset role;
select * from finish();
rollback;
