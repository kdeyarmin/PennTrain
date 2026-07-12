begin;
select plan(56);

select has_table('public', 'feature_definitions', 'typed feature definitions exist');
select has_table('public', 'organization_entitlement_grants', 'effective contractual grants exist');
select has_table('public', 'billing_subscriptions', 'subscription reconciliation state exists');
select has_table('app_private', 'stripe_billing_events', 'signed Stripe receipts are private');
select has_table('public', 'integration_api_credentials', 'tenant API credential metadata exists');
select has_table('app_private', 'integration_api_credential_hashes', 'API credential hashes are private');
select has_table('public', 'integration_webhook_deliveries', 'durable webhook deliveries exist');
select has_table('public', 'integration_webhook_delivery_attempts', 'webhook attempts are observable');
select has_function('public', 'get_effective_entitlements',
  array['uuid', 'timestamp with time zone'], 'effective entitlement evaluation is a stable RPC');
select has_function('public', 'process_stripe_billing_event',
  array['text', 'text', 'timestamp with time zone', 'jsonb', 'text', 'text'],
  'signed Stripe events have one ordered command');
select has_function('public', 'get_integration_control_plane', array['uuid'],
  'integration delivery state has an operator control plane');
select results_eq(
  $$ select schedule from cron.job where jobname = 'integration-webhook-dispatch' $$,
  $$ values ('*/5 * * * *'::text) $$,
  'the integration dispatcher is scheduled every five minutes'
);
select ok(
  not has_schema_privilege('authenticated', 'app_private', 'USAGE'),
  'authenticated callers cannot inspect hashes, event receipts, or signing-secret references'
);

insert into public.packages (
  id, name, learner_limit, facility_limit, features, sort_order
) values (
  '30000000-0000-4000-8000-000000000001', 'Phase 2 Contract', 10, 2,
  '{"phase2.contract":true}'::jsonb, 99
);
insert into public.organizations (id, name, slug, subscription_status, package_id)
values
  ('30000000-0000-4000-8000-000000000011', 'Phase 2 Org A', 'phase2-org-a', 'active',
   '30000000-0000-4000-8000-000000000001'),
  ('30000000-0000-4000-8000-000000000012', 'Phase 2 Org B', 'phase2-org-b', 'active',
   '30000000-0000-4000-8000-000000000001');

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
  ('30000000-0000-4000-8000-000000000101'::uuid, 'phase2-platform@test.local'),
  ('30000000-0000-4000-8000-000000000102'::uuid, 'phase2-admin-a@test.local'),
  ('30000000-0000-4000-8000-000000000103'::uuid, 'phase2-admin-b@test.local')
) v(id, email);

select set_config('app.privileged_write', 'on', true);
insert into public.profiles (
  id, organization_id, email, first_name, last_name, role, is_active
) values
  ('30000000-0000-4000-8000-000000000101', null, 'phase2-platform@test.local', 'Phase', 'Platform', 'platform_admin', true),
  ('30000000-0000-4000-8000-000000000102', '30000000-0000-4000-8000-000000000011',
   'phase2-admin-a@test.local', 'Phase', 'Admin A', 'org_admin', true),
  ('30000000-0000-4000-8000-000000000103', '30000000-0000-4000-8000-000000000012',
   'phase2-admin-b@test.local', 'Phase', 'Admin B', 'org_admin', true)
on conflict (id) do update set
  organization_id = excluded.organization_id,
  email = excluded.email,
  first_name = excluded.first_name,
  last_name = excluded.last_name,
  role = excluded.role,
  is_active = excluded.is_active;
select set_config('app.privileged_write', 'off', true);

create or replace function pg_temp.act_as(p_profile_id uuid, p_aal text default 'aal2')
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_profile_id, 'role', 'authenticated', 'aal', p_aal,
    'iat', extract(epoch from now())::bigint
  )::text, true);
  set local role authenticated;
end;
$$;

create temporary table phase2_issued (
  credential_id uuid, key_prefix text, plaintext_key text, expires_at timestamptz
) on commit drop;
create temporary table phase2_rotated (
  credential_id uuid, key_prefix text, plaintext_key text, expires_at timestamptz
) on commit drop;
create temporary table phase2_endpoint (
  endpoint_id uuid, plaintext_signing_secret text, secret_version integer
) on commit drop;
create temporary table phase2_claimed (
  delivery_id uuid, organization_id uuid, endpoint_id uuid, destination_url text, event_id uuid,
  request_body jsonb, plaintext_signing_secret text, attempt_number integer,
  max_attempts integer, timeout_ms integer, correlation_id text,
  event_schema_version text
) on commit drop;
grant all on table phase2_issued, phase2_rotated, phase2_endpoint, phase2_claimed
to authenticated, service_role;

select pg_temp.act_as('30000000-0000-4000-8000-000000000101', 'aal1');
select throws_ok(
  $$ select public.set_release_flag('phase2.contract', 'global', true,
       'phase2-test', 'must require step-up', null) $$,
  '42501', null, 'billing and release mutations require AAL2'
);

reset role;
select pg_temp.act_as('30000000-0000-4000-8000-000000000101', 'aal2');
select lives_ok(
  $$ select public.set_package_entitlement(
       '30000000-0000-4000-8000-000000000001', 'phase2.contract', 'true'::jsonb,
       'Approved test contract', clock_timestamp() + interval '1 millisecond', null, 'contract-test-1') $$,
  'platform administrators can version a typed package entitlement'
);
select results_eq(
  $$ select entitlement_value, entitlement_source, is_entitled
     from public.get_effective_entitlements(
       '30000000-0000-4000-8000-000000000011', clock_timestamp() + interval '2 milliseconds')
     where feature_key = 'phase2.contract' $$,
  $$ values ('true'::jsonb, 'package'::text, true) $$,
  'effective entitlement resolution uses the typed package contract'
);
select lives_ok(
  $$ select public.set_release_flag('phase2.contract', 'global', true,
       'phase2-test', 'Enable controlled test release', null) $$,
  'release state changes through an AAL2 operator command'
);
select is(
  (public.evaluate_feature_access(
    '30000000-0000-4000-8000-000000000011', 'phase2.contract', 1, clock_timestamp() + interval '2 milliseconds'
  )->>'allowed')::boolean,
  true,
  'entitlement plus release allows access before an emergency disable'
);
select lives_ok(
  $$ select public.set_feature_kill_switch(
       'phase2.contract', '30000000-0000-4000-8000-000000000011', true,
       'Exercise independent emergency disable', now() + interval '1 hour') $$,
  'kill switches have an independent privileged command'
);
select results_eq(
  $$ select
       (x->>'entitled')::boolean, (x->>'released')::boolean,
       (x->>'killed')::boolean, (x->>'allowed')::boolean
     from (select public.evaluate_feature_access(
       '30000000-0000-4000-8000-000000000011', 'phase2.contract', 1,
       clock_timestamp() + interval '2 milliseconds') x) q $$,
  $$ values (true, true, true, false) $$,
  'commercial entitlement, release, and kill-switch decisions remain distinct'
);

reset role;
set local role service_role;
create temporary table phase2_stripe_first on commit drop as
select * from public.process_stripe_billing_event(
  'evt_phase2_active', 'customer.subscription.updated',
  '2026-07-11T12:00:00Z'::timestamptz,
  jsonb_build_object('data', jsonb_build_object('object', jsonb_build_object(
    'id', 'sub_phase2A', 'customer', 'cus_phase2A', 'status', 'active',
    'metadata', jsonb_build_object(
      'organization_id', '30000000-0000-4000-8000-000000000011',
      'package_id', '30000000-0000-4000-8000-000000000001'),
    'items', jsonb_build_object('data', jsonb_build_array(jsonb_build_object(
      'id', 'si_phase2A', 'quantity', 10,
      'price', jsonb_build_object('id', 'price_phase2A')))),
    'current_period_start', 1783771200, 'current_period_end', 1786449600
  ))), repeat('a', 64), 'stripe-phase2-active'
);
select results_eq(
  $$ select was_duplicate, was_applied, was_stale, canonical_state from phase2_stripe_first $$,
  $$ values (false, true, false, 'active'::text) $$,
  'the first signed subscription event becomes canonical billing state'
);
select results_eq(
  $$ select provider_status, billing_state, seat_quantity
     from public.billing_subscriptions where stripe_subscription_id = 'sub_phase2A' $$,
  $$ values ('active'::text, 'active'::text, 10) $$,
  'subscription and seat reconciliation preserve signed Price quantities'
);
select results_eq(
  $$ select was_duplicate, was_applied
     from public.process_stripe_billing_event(
       'evt_phase2_active', 'customer.subscription.updated',
       '2026-07-11T12:00:00Z'::timestamptz,
       jsonb_build_object('data', jsonb_build_object('object', jsonb_build_object(
         'id', 'sub_phase2A', 'customer', 'cus_phase2A', 'status', 'active',
         'metadata', jsonb_build_object('organization_id', '30000000-0000-4000-8000-000000000011')))),
       repeat('a', 64), 'stripe-phase2-duplicate') $$,
  $$ values (true, false) $$,
  'a repeated signed event returns the canonical duplicate response'
);
select is(
  (select count(*)::integer from app_private.stripe_billing_events
   where event_id = 'evt_phase2_active'),
  1,
  'duplicate Stripe delivery has one durable receipt'
);
select results_eq(
  $$ select was_applied, was_stale
     from public.process_stripe_billing_event(
       'evt_phase2_old_cancel', 'customer.subscription.deleted',
       '2026-07-10T12:00:00Z'::timestamptz,
       jsonb_build_object('data', jsonb_build_object('object', jsonb_build_object(
         'id', 'sub_phase2A', 'customer', 'cus_phase2A', 'status', 'canceled',
         'metadata', jsonb_build_object('organization_id', '30000000-0000-4000-8000-000000000011')))),
       repeat('b', 64), 'stripe-phase2-old') $$,
  $$ values (false, true) $$,
  'an out-of-order older subscription event is recorded but not applied'
);
select is(
  (select billing_state from public.billing_accounts
   where organization_id = '30000000-0000-4000-8000-000000000011'),
  'active',
  'an older cancel event cannot revoke or corrupt newer active state'
);
select results_eq(
  $$ select was_applied, canonical_state
     from public.process_stripe_billing_event(
       'evt_phase2_invoice_failed', 'invoice.payment_failed',
       '2026-07-11T13:00:00Z'::timestamptz,
       jsonb_build_object('data', jsonb_build_object('object', jsonb_build_object(
         'id', 'in_phase2A', 'customer', 'cus_phase2A', 'subscription', 'sub_phase2A',
         'status', 'open', 'currency', 'usd', 'amount_due', 1000,
         'amount_paid', 0, 'amount_remaining', 1000, 'created', 1783774800))),
       repeat('c', 64), 'stripe-phase2-invoice') $$,
  $$ values (true, 'grace'::text) $$,
  'a signed failed invoice starts a separately modeled grace period'
);
update public.billing_accounts set grace_ends_at = now() - interval '1 second'
where organization_id = '30000000-0000-4000-8000-000000000011';
select is(public.reconcile_billing_states(now()), 1,
  'billing reconciliation expires grace into past-due state');
select is(
  public.has_effective_entitlement(
    '30000000-0000-4000-8000-000000000011', 'phase2.contract', 1,
    clock_timestamp() + interval '2 milliseconds'),
  false,
  'past-due billing state cannot silently preserve contractual feature access'
);

reset role;
select pg_temp.act_as('30000000-0000-4000-8000-000000000101', 'aal2');
select public.set_organization_entitlement_grant(
  '30000000-0000-4000-8000-000000000011', 'integrations.api', 'grant',
  'true'::jsonb, 'Phase 2 integration API test contract', now(), null, 'integration-test', null
);
select public.set_organization_entitlement_grant(
  '30000000-0000-4000-8000-000000000011', 'integrations.webhooks', 'grant',
  'true'::jsonb, 'Phase 2 webhook test contract', now(), null, 'integration-test', null
);
select public.set_release_flag(
  'integrations.api', 'global', true, 'phase2-test', 'Enable integration API test', null
);
select public.set_release_flag(
  'integrations.webhooks', 'global', true, 'phase2-test', 'Enable webhook test', null
);
select public.set_billing_account_override(
  '30000000-0000-4000-8000-000000000011', 'comped',
  'Enable integration contract test after past-due reconciliation', now() + interval '1 day'
);

reset role;
select pg_temp.act_as('30000000-0000-4000-8000-000000000102', 'aal2');
select lives_ok(
  $$ select public.get_billing_reconciliation('30000000-0000-4000-8000-000000000011') $$,
  'organization administrators can reconcile their own account'
);
select throws_ok(
  $$ select * from public.get_effective_entitlements(
       '30000000-0000-4000-8000-000000000012', now()) $$,
  '42501', null, 'entitlement evaluation rejects a cross-tenant organization id'
);

reset role;
select pg_temp.act_as('30000000-0000-4000-8000-000000000102', 'aal1');
select throws_ok(
  $$ select * from public.issue_integration_api_credential(
       '30000000-0000-4000-8000-000000000011', 'AAL1 must fail',
       array['events:read'], now() + interval '1 day', 1) $$,
  '42501', null, 'credential issuance requires AAL2'
);

reset role;
select pg_temp.act_as('30000000-0000-4000-8000-000000000102', 'aal2');
insert into phase2_issued
select * from public.issue_integration_api_credential(
  '30000000-0000-4000-8000-000000000011', 'Phase 2 API',
  array['commands:write', 'events:read'], now() + interval '1 day', 1
);
reset role;
select ok(
  (select plaintext_key ~ '^cmt_live_[0-9a-f]{12}[.][0-9a-f]{64}$' from phase2_issued)
  and (select h.secret_sha256 <> i.plaintext_key
       from phase2_issued i join app_private.integration_api_credential_hashes h
         on h.credential_id = i.credential_id),
  'API credentials are returned once and stored only as SHA-256 hashes'
);
insert into phase2_rotated
select * from public.rotate_integration_api_credential(
  (select credential_id from phase2_issued), now() + interval '2 days'
);
select results_eq(
  $$ select old.status, old.replaced_by_id = new.credential_id,
       old.key_prefix <> new.key_prefix
     from public.integration_api_credentials old
     cross join phase2_rotated new
     where old.id = (select credential_id from phase2_issued) $$,
  $$ values ('rotated'::text, true, true) $$,
  'rotation atomically revokes the old credential and links a distinct replacement'
);

reset role;
set local role service_role;
select is(
  (select count(*)::integer from public.authenticate_integration_api_credential(
    (select h.secret_sha256 from phase2_issued i
     join app_private.integration_api_credential_hashes h on h.credential_id = i.credential_id),
    'events:read', 'old-key-test')),
  0,
  'a rotated credential cannot authenticate'
);
select is(
  (select count(*)::integer from public.authenticate_integration_api_credential(
    (select h.secret_sha256 from phase2_rotated i
     join app_private.integration_api_credential_hashes h on h.credential_id = i.credential_id),
    'commands:write', 'new-key-test')),
  1,
  'the replacement credential authenticates in its tenant and scope'
);
create temporary table phase2_command_first on commit drop as
select * from public.accept_integration_command(
  (select credential_id from phase2_rotated), 'phase2-command-0001', repeat('d', 64),
  'workforce.lifecycle.sync', '2026-07-11', '{"externalId":"employee-1"}'::jsonb,
  'phase2-command-correlation'
);
select results_eq(
  $$ select was_duplicate, command_status from phase2_command_first $$,
  $$ values (false, 'accepted'::text) $$,
  'the first inbound integration request becomes one lifecycle command receipt'
);
select results_eq(
  $$ select command_id = (select command_id from phase2_command_first), was_duplicate
     from public.accept_integration_command(
       (select credential_id from phase2_rotated), 'phase2-command-0001', repeat('d', 64),
       'workforce.lifecycle.sync', '2026-07-11', '{"externalId":"employee-1"}'::jsonb,
       'phase2-command-correlation-retry') $$,
  $$ values (true, true) $$,
  'a repeated command returns the canonical receipt instead of racing a duplicate insert'
);
select is(
  (select count(*)::integer from app_private.integration_command_receipts
   where credential_id = (select credential_id from phase2_rotated)
     and idempotency_key = 'phase2-command-0001'),
  1,
  'command idempotency stores one receipt'
);
select throws_ok(
  $$ select * from public.accept_integration_command(
       (select credential_id from phase2_rotated), 'phase2-command-0001', repeat('e', 64),
       'workforce.lifecycle.sync', '2026-07-11', '{"externalId":"employee-2"}'::jsonb,
       'phase2-command-conflict') $$,
  '23505', null, 'an idempotency key cannot be reused for different content'
);
select is(
  (select count(*)::integer from app_private.integration_event_log
   where causation_id = (select command_id::text from phase2_command_first)),
  1,
  'one accepted command produces one versioned event envelope'
);
select results_eq(
  $$ select allowed, remaining from public.consume_integration_rate_limit(
       (select credential_id from phase2_rotated), 1) $$,
  $$ values (true, 0) $$,
  'the first request consumes the credential rate budget'
);
select results_eq(
  $$ select allowed, remaining from public.consume_integration_rate_limit(
       (select credential_id from phase2_rotated), 1) $$,
  $$ values (false, 0) $$,
  'a request beyond the tenant credential limit is rejected'
);

reset role;
select pg_temp.act_as('30000000-0000-4000-8000-000000000102', 'aal2');
select throws_ok(
  $$ select * from public.create_integration_webhook_endpoint(
       '30000000-0000-4000-8000-000000000011', 'Unsafe loopback',
       'https://127.0.0.1/events', array['integration.test'], '') $$,
  '22023', null, 'obvious private webhook destinations are rejected at configuration time'
);
insert into phase2_endpoint
select * from public.create_integration_webhook_endpoint(
  '30000000-0000-4000-8000-000000000011', 'Phase 2 Receiver',
  'https://hooks.example.test/events',
  array['integration.command.accepted', 'integration.test'], 'Test receiver'
);
select ok(
  (select plaintext_signing_secret ~ '^whsec_[0-9a-f]{64}$' and secret_version = 1
   from phase2_endpoint),
  'webhook endpoint creation returns one versioned signing secret'
);
create temporary table phase2_test_delivery on commit drop as
select public.enqueue_integration_test_delivery(
  (select endpoint_id from phase2_endpoint), '{"probe":"phase2"}'::jsonb
) delivery_id;
grant select on table phase2_test_delivery to service_role;

reset role;
set local role service_role;
insert into phase2_claimed
select * from public.claim_integration_webhook_deliveries(
  1, (select endpoint_id from phase2_endpoint),
  (select delivery_id from phase2_test_delivery)
);
select is(
  (select plaintext_signing_secret from phase2_claimed),
  (select plaintext_signing_secret from phase2_endpoint),
  'the dispatcher resolves the current Vault secret only while claiming work'
);
select is(
  public.complete_integration_webhook_delivery(
    (select delivery_id from phase2_claimed), (select attempt_number from phase2_claimed),
    false, 400, repeat('f', 64), 'http_400', 'Rejected test delivery', false, 10, 1783780000
  ),
  'dead_letter',
  'a non-retryable failure moves the delivery to the dead-letter state'
);

reset role;
select pg_temp.act_as('30000000-0000-4000-8000-000000000102', 'aal2');
create temporary table phase2_replay on commit drop as
select public.replay_integration_webhook_delivery(
  (select delivery_id from phase2_test_delivery), 'Validated operator replay test'
) delivery_id;
grant select on table phase2_replay to service_role;
select isnt(
  (select delivery_id from phase2_replay),
  (select delivery_id from phase2_test_delivery),
  'operator replay creates a new delivery attempt ledger instead of rewriting history'
);

reset role;
set local role service_role;
truncate phase2_claimed;
insert into phase2_claimed
select * from public.claim_integration_webhook_deliveries(
  1, null, (select delivery_id from phase2_replay)
);
select is(
  public.complete_integration_webhook_delivery(
    (select delivery_id from phase2_claimed), (select attempt_number from phase2_claimed),
    true, 204, repeat('0', 64), null, null, false, 8, 1783780100
  ),
  'delivered',
  'a replayed delivery can complete with independent attempt evidence'
);
select results_eq(
  $$ select status, replay_count from public.integration_webhook_deliveries
     where id in ((select delivery_id from phase2_test_delivery),
                  (select delivery_id from phase2_replay))
     order by replay_count $$,
  $$ values ('dead_letter'::text, 0), ('delivered'::text, 1) $$,
  'dead-letter history and successful replay remain independently observable'
);

reset role;
select pg_temp.act_as('30000000-0000-4000-8000-000000000102', 'aal2');
create temporary table phase2_stale_delivery on commit drop as
select public.enqueue_integration_test_delivery(
  (select endpoint_id from phase2_endpoint), '{"probe":"stale-lease"}'::jsonb
) delivery_id;
grant select on table phase2_stale_delivery to service_role;

reset role;
set local role service_role;
truncate phase2_claimed;
insert into phase2_claimed
select * from public.claim_integration_webhook_deliveries(
  1, null, (select delivery_id from phase2_stale_delivery), 60
);
update public.integration_webhook_deliveries
set locked_at = now() - interval '10 minutes'
where id = (select delivery_id from phase2_stale_delivery);
truncate phase2_claimed;
insert into phase2_claimed
select * from public.claim_integration_webhook_deliveries(
  1, null, (select delivery_id from phase2_stale_delivery), 60
);
select is(
  (select attempt_number from phase2_claimed),
  2,
  'a stale processing lease is reclaimed as the next bounded attempt'
);
select is(
  (
    select count(*)::integer
    from public.integration_webhook_delivery_attempts
    where delivery_id = (select delivery_id from phase2_stale_delivery)
      and attempt_number = 1
      and outcome = 'retry'
      and error_code = 'worker_lease_expired'
  ),
  1,
  'a reclaimed worker lease retains an explicit abandoned-attempt record'
);

reset role;
select pg_temp.act_as('30000000-0000-4000-8000-000000000103', 'aal2');
select is((select count(*)::integer from public.integration_webhook_endpoints), 0,
  'another organization cannot enumerate tenant webhook endpoints');

reset role;
select pg_temp.act_as('30000000-0000-4000-8000-000000000102', 'aal2');
select lives_ok(
  $$ select public.get_integration_control_plane('30000000-0000-4000-8000-000000000011') $$,
  'organization administrators can inspect their own integration control plane'
);
select lives_ok(
  $$ select public.revoke_integration_api_credential(
       (select credential_id from phase2_rotated), 'End of Phase 2 test') $$,
  'credential revocation is an audited operator command'
);

reset role;
set local role service_role;
select is(
  (select count(*)::integer from public.authenticate_integration_api_credential(
    (select h.secret_sha256 from phase2_rotated i
     join app_private.integration_api_credential_hashes h on h.credential_id = i.credential_id),
    'events:read', 'revoked-key-test')),
  0,
  'a revoked credential cannot authenticate'
);

reset role;
select * from finish();
rollback;
