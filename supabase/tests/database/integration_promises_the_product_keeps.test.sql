-- The promises the integration surface makes, and now keeps (20260906260000).
--
-- Every assertion below covers something that was true of the SERVER and false of the PRODUCT,
-- which is the shape a name search cannot find:
--
--   * a 202 for a command type the inbox never drains, and then silence forever;
--   * an apply-time outcome recorded on a receipt nothing exposed and no event carried;
--   * `previous_vault_secret_id` and `previous_valid_until` written by every rotation and read by
--     nothing, so the grace window the rotation dialog promises did not exist;
--   * `consecutive_failures` counted up and acted on nowhere;
--   * a subscription that could not be switched off and an endpoint that could not be switched on;
--   * an unverified identity-domain claim that blocked the real owner permanently.
--
-- Run with: supabase test db.

begin;
select plan(26);

-- Fixtures ------------------------------------------------------------------------------------
insert into public.organizations(id, name, slug, subscription_status) values
  ('c4000000-0000-4000-8000-000000000001', 'Promise Org A', 'promise-org-a', 'active'),
  ('c4000000-0000-4000-8000-000000000002', 'Promise Org B', 'promise-org-b', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('c4000000-0000-4000-8000-000000000011', 'c4000000-0000-4000-8000-000000000001', 'Promise Facility', 'ALR');
insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', 'c4000000-0000-4000-8000-000000000101', 'authenticated', 'authenticated', 'promise-a@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', 'c4000000-0000-4000-8000-000000000201', 'authenticated', 'authenticated', 'promise-b@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', 'c4000000-0000-4000-8000-000000000901', 'authenticated', 'authenticated', 'promise-platform@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('c4000000-0000-4000-8000-000000000101', 'c4000000-0000-4000-8000-000000000001', 'promise-a@test.local', 'Ada', 'Admin', 'org_admin', true),
  ('c4000000-0000-4000-8000-000000000201', 'c4000000-0000-4000-8000-000000000002', 'promise-b@test.local', 'Bo', 'Admin', 'org_admin', true),
  ('c4000000-0000-4000-8000-000000000901', null, 'promise-platform@test.local', 'Pat', 'Platform', 'platform_admin', true)
on conflict(id) do update set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);
insert into public.integration_api_credentials(
  id, organization_id, name, key_prefix, scopes, status, expires_at, rate_limit_per_minute, created_by
) values
  ('c4000000-0000-4000-8000-000000000301', 'c4000000-0000-4000-8000-000000000001',
   'Promise A commands', 'c40000000301', array['commands:write'], 'active', now() + interval '30 days', 600,
   'c4000000-0000-4000-8000-000000000101'),
  ('c4000000-0000-4000-8000-000000000302', 'c4000000-0000-4000-8000-000000000002',
   'Promise B commands', 'c40000000302', array['commands:write'], 'active', now() + interval '30 days', 600,
   'c4000000-0000-4000-8000-000000000201');

create or replace function pg_temp.act_as(p_profile_id uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_profile_id, 'role', p_role, 'aal', 'aal2',
    'iat', extract(epoch from now())::bigint)::text, true);
  if p_role = 'service_role' then set local role service_role;
  else set local role authenticated; end if;
end $$;

------------------------------------------------------------------------------------------------
-- 1. A command type nothing consumes is refused, not accepted
------------------------------------------------------------------------------------------------

select results_eq(
  $$ select schema_name from public.integration_schema_definitions
     where schema_kind = 'event' and lifecycle_status = 'active'
       and schema_name in ('integration.command.applied', 'integration.command.rejected')
     order by schema_name $$,
  $$ values ('integration.command.applied'::text), ('integration.command.rejected'::text) $$,
  'the two apply-outcome event types are registered in the schema contract'
);

select pg_temp.act_as('00000000-0000-0000-0000-000000000000', 'service_role');
select throws_ok(
  $$ select * from public.accept_integration_command(
       'c4000000-0000-4000-8000-000000000301', 'promise-unconsumed-1', repeat('a', 64),
       'workforce.lifecycle.sync', '2026-07-11', '{}'::jsonb, 'promise-unconsumed') $$,
  '22023', null,
  'a command type the inbox never drains is refused instead of answered 202'
);

create temporary table promise_command on commit drop as
select * from public.accept_integration_command(
  'c4000000-0000-4000-8000-000000000301', 'promise-consumed-1', repeat('b', 64),
  'fhir.bundle.import', '2026-07-25', '{"sourceId":null}'::jsonb, 'promise-consumed'
);
grant select on table promise_command to authenticated, service_role;
select is(
  (select command_status from promise_command), 'accepted'::text,
  'a command type the inbox does drain is still accepted'
);

------------------------------------------------------------------------------------------------
-- 2. The apply-time outcome is pushed and readable
------------------------------------------------------------------------------------------------

update app_private.integration_command_receipts
set status = 'applied', result = jsonb_build_object('requestsApplied', 2)
where id = (select command_id from promise_command);
select lives_ok(
  $$ select app_private.emit_integration_command_outcome_event(
       (select command_id from promise_command), 'integration.command.applied', 'applied') $$,
  'the drain can file an applied outcome as a versioned event'
);
select results_eq(
  $$ select event_type, payload->>'status' from app_private.integration_event_log
     where causation_id = (select command_id::text from promise_command)
     order by sequence_number $$,
  $$ values ('integration.command.accepted'::text, 'accepted'::text),
            ('integration.command.applied'::text, 'applied'::text) $$,
  'accept and apply are two events on the same command, not one'
);
select is(
  (select payload ? 'message' from app_private.integration_event_log
   where event_type = 'integration.command.applied'
     and causation_id = (select command_id::text from promise_command)),
  false,
  'the fanned-out event carries the SQLSTATE, never the raw sqlerrm text'
);

select results_eq(
  $$ select command_status, result->>'requestsApplied'
     from public.get_integration_command_receipt(
       'c4000000-0000-4000-8000-000000000301', (select command_id from promise_command)) $$,
  $$ values ('applied'::text, '2'::text) $$,
  'the submitting tenant can read what became of its own command'
);
select is(
  (select count(*)::int from public.get_integration_command_receipt(
     'c4000000-0000-4000-8000-000000000302', (select command_id from promise_command))),
  0,
  'another tenant credential reads nothing, not somebody else command receipt'
);

------------------------------------------------------------------------------------------------
-- 3. The rotation grace window
------------------------------------------------------------------------------------------------

-- Webhooks are an entitled, released capability: without both the endpoint cannot be created at
-- all, which is the same contract the Phase 2 test asserts.
select pg_temp.act_as('c4000000-0000-4000-8000-000000000901');
select public.set_organization_entitlement_grant(
  'c4000000-0000-4000-8000-000000000001', 'integrations.webhooks', 'grant',
  'true'::jsonb, 'Promise webhook test contract', now(), null, 'promise-test', null
);
select public.set_release_flag(
  'integrations.webhooks', 'global', true, 'promise-test', 'Enable webhook test', null
);

select pg_temp.act_as('c4000000-0000-4000-8000-000000000101');
create temporary table promise_endpoint on commit drop as
select * from public.create_integration_webhook_endpoint(
  'c4000000-0000-4000-8000-000000000001', 'Promise Receiver',
  'https://hooks.example.test/promise',
  array['integration.command.applied', 'integration.test'], 'Grace window receiver'
);
grant select on table promise_endpoint to authenticated, service_role;

create temporary table promise_rotated on commit drop as
select * from public.rotate_integration_webhook_secret((select endpoint_id from promise_endpoint));
grant select on table promise_rotated to authenticated, service_role;

create temporary table promise_delivery on commit drop as
select public.enqueue_integration_test_delivery(
  (select endpoint_id from promise_endpoint), '{"probe":"grace"}'::jsonb) delivery_id;
grant select on table promise_delivery to authenticated, service_role;

create temporary table promise_claimed (
  delivery_id uuid, organization_id uuid, endpoint_id uuid, destination_url text, event_id uuid,
  request_body jsonb, plaintext_signing_secret text, previous_signing_secret text,
  attempt_number integer, max_attempts integer, timeout_ms integer, correlation_id text,
  event_schema_version text
) on commit drop;
grant all on table promise_claimed to authenticated, service_role;

select pg_temp.act_as('00000000-0000-0000-0000-000000000000', 'service_role');
insert into promise_claimed
select * from public.claim_integration_webhook_deliveries(
  1, (select endpoint_id from promise_endpoint), (select delivery_id from promise_delivery));
select is(
  (select plaintext_signing_secret from promise_claimed),
  (select plaintext_signing_secret from promise_rotated),
  'the dispatcher signs with the secret the rotation just minted'
);
select isnt(
  (select previous_signing_secret from promise_claimed), null,
  'and, inside the window, also with the secret the consumer has not replaced yet'
);

-- Past the window the old secret stops being offered. Same claim, one changed column.
update app_private.integration_endpoint_secrets
set previous_valid_until = now() - interval '1 minute'
where endpoint_id = (select endpoint_id from promise_endpoint);
update public.integration_webhook_deliveries
set status = 'pending', locked_at = null
where id = (select delivery_id from promise_delivery);
truncate promise_claimed;
insert into promise_claimed
select * from public.claim_integration_webhook_deliveries(
  1, (select endpoint_id from promise_endpoint), (select delivery_id from promise_delivery));
select is(
  (select previous_signing_secret from promise_claimed), null,
  'once the window closes the previous secret is not sent again'
);

------------------------------------------------------------------------------------------------
-- 4. A dead endpoint switches itself off, and can be switched back on
------------------------------------------------------------------------------------------------

-- As the owner: the endpoints table carries a CHECK that calls an app_private function, which the
-- browser and worker roles cannot execute directly -- only the definer functions above can.
reset role;
update public.integration_webhook_endpoints
set consecutive_failures = 24
where id = (select endpoint_id from promise_endpoint);
select pg_temp.act_as('00000000-0000-0000-0000-000000000000', 'service_role');
select is(
  public.complete_integration_webhook_delivery(
    (select delivery_id from promise_claimed), (select attempt_number from promise_claimed),
    false, 404, repeat('c', 64), 'http_404', 'Gone', false, 5, 1783780000),
  'dead_letter',
  'a non-retryable failure dead-letters the delivery'
);
select results_eq(
  $$ select status, consecutive_failures >= 25 from public.integration_webhook_endpoints
     where id = (select endpoint_id from promise_endpoint) $$,
  $$ values ('disabled'::text, true) $$,
  'and the twenty-fifth consecutive failure disables the endpoint instead of counting on'
);

select pg_temp.act_as('c4000000-0000-4000-8000-000000000101');
select lives_ok(
  $$ select public.reactivate_integration_webhook_endpoint(
       (select endpoint_id from promise_endpoint)) $$,
  'an endpoint that was switched off can be switched back on'
);
select results_eq(
  $$ select status, consecutive_failures, disable_reason is null
     from public.integration_webhook_endpoints
     where id = (select endpoint_id from promise_endpoint) $$,
  $$ values ('active'::text, 0, true) $$,
  'reactivation clears the failure count and the disable record with it'
);

------------------------------------------------------------------------------------------------
-- 5. One subscription off
------------------------------------------------------------------------------------------------

select lives_ok(
  $$ select public.set_integration_webhook_subscription(
       (select endpoint_id from promise_endpoint), 'integration.test', false) $$,
  'one event subscription can be switched off without touching the endpoint'
);
select results_eq(
  $$ select event_type, is_active from public.integration_webhook_subscriptions
     where endpoint_id = (select endpoint_id from promise_endpoint)
     order by event_type $$,
  $$ values ('integration.command.applied'::text, true), ('integration.test'::text, false) $$,
  'and the endpoint keeps delivering everything else it is subscribed to'
);

------------------------------------------------------------------------------------------------
-- 6. An unverified domain claim expires
------------------------------------------------------------------------------------------------

select pg_temp.act_as('c4000000-0000-4000-8000-000000000101');
select lives_ok(
  $$ select public.register_identity_domain(
       'c4000000-0000-4000-8000-000000000001', 'promise-holdings.test') $$,
  'the first organization registers a domain and gets a challenge to publish'
);

select pg_temp.act_as('c4000000-0000-4000-8000-000000000201');
select throws_ok(
  $$ select public.register_identity_domain(
       'c4000000-0000-4000-8000-000000000002', 'promise-holdings.test') $$,
  '23505', 'identity domain is unavailable',
  'a fresh claim still blocks another organization while the first one is proving it'
);

-- Ninety days later, with nothing published and nothing verified, it is not a claim any more.
-- Aged as the owner: the table is not writable by a browser role, only through its RPCs.
reset role;
update public.organization_identity_domains
set created_at = now() - interval '91 days'
where domain = 'promise-holdings.test';
select pg_temp.act_as('c4000000-0000-4000-8000-000000000201');
select is(
  (select public.register_identity_domain(
     'c4000000-0000-4000-8000-000000000002', 'promise-holdings.test')->>'status'),
  'pending',
  'and a claim nobody verified in ninety days releases to the organization that asks next'
);
select results_eq(
  $$ select organization_id, verification_status from public.organization_identity_domains
     where domain = 'promise-holdings.test' $$,
  $$ values ('c4000000-0000-4000-8000-000000000002'::uuid, 'pending'::text) $$,
  'the row moves to the new organization rather than a second row being created'
);
select is(
  (select count(*)::int from public.audit_logs
   where entity_type = 'organization_identity_domains'
     and action = 'identity_domain_claim_released'),
  1,
  'the takeover is written to the audit log, so the loss is a record and not a mystery'
);

------------------------------------------------------------------------------------------------
-- 7. Exclusion-screening residue (I32)
------------------------------------------------------------------------------------------------

select is(
  (select count(*)::int from public.help_articles
   where is_published and (title ilike '%exclusion screening%' or content::text ilike '%exclusion screening%')),
  0,
  'the Help Center no longer publishes an FAQ about a console that does not exist'
);
select results_eq(
  $$ select r.requirement_key, r.label ilike '%exclusion%', r.rule->>'evidenceType', r.is_mandatory
     from public.compliance_profile_requirements r
     join public.compliance_profile_definitions p on p.id = r.profile_definition_id
     where p.is_mandatory_baseline and r.requirement_key = 'workforce.background_screening' $$,
  $$ values ('workforce.background_screening'::text, false, 'background-clearance'::text, true) $$,
  'the mandatory background requirement keeps its key and its force, and drops the exclusion framing'
);
select is(
  (select count(*)::int from public.entrance_conference_items
   where is_active and prompt ilike '%exclusion%'),
  0,
  'Survey Day no longer asks the facility to produce evidence of a check it cannot run'
);
select is(
  (select count(*)::int from public.feature_definitions
   where description ilike '%exclusion screening%' or description ilike '%exclusion%'),
  0,
  'and no sellable module description offers exclusion screening to a commercial package'
);

select * from finish();
rollback;
