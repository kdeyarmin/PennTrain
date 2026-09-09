-- A Portal plan change retains the original subscription metadata. Exercise the
-- real receipt processor and entitlement resolver, including rejected and stale
-- deliveries, rather than updating local package rows as a test substitute.
begin;
select plan(383);

insert into public.feature_definitions (feature_key, display_name, value_type, default_value)
values ('portal.care_access', 'Portal plan test care access', 'boolean', 'false'::jsonb);

insert into public.packages (id, name, learner_limit, facility_limit, features)
values
  ('ea000000-0000-4000-8000-000000000001', 'Portal test Train', 10, 1, '{}'::jsonb),
  ('ea000000-0000-4000-8000-000000000002', 'Portal test CareBase', 100, 10, '{}'::jsonb),
  ('ea000000-0000-4000-8000-000000000003', 'Portal test legacy', 20, 2, '{}'::jsonb);

insert into public.package_billing_prices (
  package_id, stripe_price_id, recurring_interval, billing_metric, pricing_model,
  base_amount_cents, minimum_quantity, maximum_quantity, is_seat_based
)
values
  ('ea000000-0000-4000-8000-000000000001', 'price_portalTrainMonth', 'month', 'flat', 'flat', 23900, 1, 1, false),
  ('ea000000-0000-4000-8000-000000000001', 'price_portalTrainYear', 'year', 'flat', 'flat', 239000, 1, 1, false),
  ('ea000000-0000-4000-8000-000000000002', 'price_portalCareMonth', 'month', 'flat', 'flat', 49900, 1, 1, false),
  ('ea000000-0000-4000-8000-000000000002', 'price_portalCareYear', 'year', 'flat', 'flat', 499000, 1, 1, false);

insert into public.package_entitlements (package_id, feature_key, entitlement_value, effective_from, source)
values
  ('ea000000-0000-4000-8000-000000000001', 'portal.care_access', 'false'::jsonb, now() - interval '1 day', 'sales_contract'),
  ('ea000000-0000-4000-8000-000000000002', 'portal.care_access', 'true'::jsonb, now() - interval '1 day', 'sales_contract');

insert into public.organizations (id, name, slug, subscription_status, package_id)
values
  ('ea000000-0000-4000-8000-000000000011', 'Portal plan org', 'portal-plan-org', 'active', 'ea000000-0000-4000-8000-000000000001'),
  ('ea000000-0000-4000-8000-000000000012', 'Portal legacy org', 'portal-legacy-org', 'active', 'ea000000-0000-4000-8000-000000000003'),
  ('ea000000-0000-4000-8000-000000000013', 'Portal first org', 'portal-first-org', 'active', 'ea000000-0000-4000-8000-000000000001'),
  ('ea000000-0000-4000-8000-000000000014', 'Portal placeholder org', 'portal-placeholder-org', 'trial', 'ea000000-0000-4000-8000-000000000001'),
  ('ea000000-0000-4000-8000-000000000015', 'Portal duplicate org', 'portal-duplicate-org', 'trial', 'ea000000-0000-4000-8000-000000000001'),
  ('ea000000-0000-4000-8000-000000000016', 'Portal comped org', 'portal-comped-org', 'trial', 'ea000000-0000-4000-8000-000000000001'),
  ('ea000000-0000-4000-8000-000000000017', 'Portal invoice-first org', 'portal-invoice-first-org', 'trial', 'ea000000-0000-4000-8000-000000000001'),
  ('ea000000-0000-4000-8000-000000000018', 'Portal comp-expiry org', 'portal-comp-expiry-org', 'trial', 'ea000000-0000-4000-8000-000000000001'),
  ('ea000000-0000-4000-8000-000000000019', 'Portal dunning org', 'portal-dunning-org', 'trial', 'ea000000-0000-4000-8000-000000000001'),
  ('ea000000-0000-4000-8000-000000000020', 'Portal unvalidated grace org', 'portal-unvalidated-grace-org', 'trial', 'ea000000-0000-4000-8000-000000000001');

-- This fixture only builds signed-event-shaped input; production processing and
-- all mutations run through the existing service-role RPC.
create function pg_temp.portal_event(
  p_event text,
  p_sequence integer,
  p_prices text[],
  p_metadata_package uuid default 'ea000000-0000-4000-8000-000000000001',
  p_org uuid default 'ea000000-0000-4000-8000-000000000011',
  p_status text default 'active',
  p_has_more boolean default false,
  p_subscription_suffix text default '',
  p_event_type text default 'customer.subscription.updated'
)
returns table (was_duplicate boolean, was_applied boolean, was_stale boolean,
               resolved_organization_id uuid, canonical_state text)
language sql
set search_path = ''
as $fixture$
  select * from public.process_stripe_billing_event(
    p_event, p_event_type,
    date_trunc('second', now()) - interval '1 minute' + p_sequence * interval '1 second',
    jsonb_build_object('data', jsonb_build_object('object', jsonb_build_object(
      'id', 'sub_portal' || replace(p_org::text, '-', '') || p_subscription_suffix,
      'customer', 'cus_portal' || replace(p_org::text, '-', ''),
      'status', p_status,
      'metadata', jsonb_build_object('organization_id', p_org, 'package_id', p_metadata_package),
      'items', jsonb_build_object('has_more', p_has_more, 'data', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', 'si_portal' || replace(p_org::text, '-', '') || p_subscription_suffix || n,
          'quantity', 1,
          'current_period_start', extract(epoch from now())::bigint,
          'current_period_end', extract(epoch from now() + interval '1 year')::bigint,
          'price', jsonb_build_object('id', price)
        ) order by n)
        from unnest(p_prices) with ordinality item(price, n)
      ), '[]'::jsonb))
    ))), md5(p_event) || md5(p_event), p_event
  );
$fixture$;

create function pg_temp.portal_checkout(
  p_event text, p_org uuid, p_package uuid, p_subscription_suffix text default ''
)
returns table (was_duplicate boolean, was_applied boolean, was_stale boolean,
               resolved_organization_id uuid, canonical_state text)
language sql set search_path = ''
as $fixture$
  select * from public.process_stripe_billing_event(
    p_event, 'checkout.session.completed', date_trunc('second', now()) - interval '59 seconds',
    jsonb_build_object('data', jsonb_build_object('object', jsonb_build_object(
      'id', 'cs_' || p_event, 'customer', 'cus_portal' || replace(p_org::text, '-', ''),
      'subscription', 'sub_portal' || replace(p_org::text, '-', '') || p_subscription_suffix,
      'payment_status', 'paid',
      'metadata', jsonb_build_object('organization_id', p_org, 'package_id', p_package)
    ))), md5(p_event) || md5(p_event), p_event
  );
$fixture$;

create function pg_temp.portal_invoice(p_event text, p_org uuid, p_subscription_suffix text default '',
                                      p_event_type text default 'invoice.paid', p_sequence integer default 40)
returns table (was_duplicate boolean, was_applied boolean, was_stale boolean,
               resolved_organization_id uuid, canonical_state text)
language sql set search_path = ''
as $fixture$
  select * from public.process_stripe_billing_event(
    p_event, p_event_type, date_trunc('second', now()) - interval '1 minute' + p_sequence * interval '1 second',
    jsonb_build_object('data', jsonb_build_object('object', jsonb_build_object(
      'id', 'in_' || replace(p_event, '_', ''), 'customer', 'cus_portal' || replace(p_org::text, '-', ''),
      'parent', jsonb_build_object('subscription_details', jsonb_build_object(
        'subscription', 'sub_portal' || replace(p_org::text, '-', '') || p_subscription_suffix)),
      'status', case when p_event_type = 'invoice.payment_failed' then 'open' else 'paid' end,
      'currency', 'usd', 'amount_paid', case when p_event_type = 'invoice.payment_failed' then 0 else 49900 end,
      'amount_due', 49900, 'amount_remaining', case when p_event_type = 'invoice.payment_failed' then 49900 else 0 end
    ))), md5(p_event) || md5(p_event), p_event
  );
$fixture$;

set local role service_role;

select ok((select was_applied from pg_temp.portal_event('evt_portalInitial', 1, array['price_portalTrainMonth'])),
  'the initial mapped Train subscription is applied');
select is((select package_id from public.organizations where slug = 'portal-plan-org'),
  'ea000000-0000-4000-8000-000000000001'::uuid, 'the initial organization uses Train');
select is((select is_entitled from public.get_effective_entitlements('ea000000-0000-4000-8000-000000000011', clock_timestamp())
  where feature_key = 'portal.care_access'), false, 'Train does not grant CareBase access');

select ok((select was_applied from pg_temp.portal_event('evt_portalUpgrade', 2, array['price_portalCareMonth'])),
  'a Portal upgrade applies even though subscription metadata still says Train');
select is((select package_id from public.organizations where slug = 'portal-plan-org'),
  'ea000000-0000-4000-8000-000000000002'::uuid, 'the signed CareBase price changes the organization package');
select is((select package_id from public.billing_subscriptions where organization_id = 'ea000000-0000-4000-8000-000000000011'),
  'ea000000-0000-4000-8000-000000000002'::uuid, 'the subscription package agrees with the paid price');
select is((select plan_name from public.organizations where slug = 'portal-plan-org'),
  'Portal test CareBase', 'the displayed plan follows the price change');
select is((select is_entitled from public.get_effective_entitlements('ea000000-0000-4000-8000-000000000011', clock_timestamp())
  where feature_key = 'portal.care_access'), true, 'an upgrade grants the purchased CareBase entitlement');

select ok((select was_applied from pg_temp.portal_event('evt_portalAnnual', 3, array['price_portalCareYear'])),
  'a monthly-to-annual cadence change applies with unchanged old metadata');
select is((select package_id from public.organizations where slug = 'portal-plan-org'),
  'ea000000-0000-4000-8000-000000000002'::uuid, 'a cadence change retains the same package');
select is((select stripe_price_id from public.billing_subscription_items where organization_id = 'ea000000-0000-4000-8000-000000000011'),
  'price_portalCareYear', 'the annual price replaces the monthly subscription item');

select ok((select was_applied from pg_temp.portal_event('evt_portalDowngrade', 4, array['price_portalTrainYear'],
  'ea000000-0000-4000-8000-000000000002')), 'a downgrade applies despite metadata retaining CareBase');
select is((select package_id from public.organizations where slug = 'portal-plan-org'),
  'ea000000-0000-4000-8000-000000000001'::uuid, 'the downgrade selects Train from its signed price');
select is((select is_entitled from public.get_effective_entitlements('ea000000-0000-4000-8000-000000000011', clock_timestamp())
  where feature_key = 'portal.care_access'), false, 'a downgrade removes the higher paid entitlement');

select lives_ok($$ select * from public.process_stripe_billing_event(
  'evt_portalDelayedCheckout', 'checkout.session.completed', date_trunc('second', now()) - interval '59 seconds',
  '{"data":{"object":{"id":"cs_portalOriginal","customer":"cus_portalea000000000040008000000000000011",
    "subscription":"sub_portalea000000000040008000000000000011","payment_status":"paid",
    "metadata":{"organization_id":"ea000000-0000-4000-8000-000000000011",
                "package_id":"ea000000-0000-4000-8000-000000000002"}}}}'::jsonb,
  repeat('e', 64), 'evt_portalDelayedCheckout') $$,
  'the original Checkout receipt can arrive after an authoritative Portal change');
select is((select package_id from public.organizations where slug = 'portal-plan-org'),
  'ea000000-0000-4000-8000-000000000001'::uuid, 'delayed Checkout metadata cannot undo the current purchased plan');
select is((select is_entitled from public.get_effective_entitlements('ea000000-0000-4000-8000-000000000011', clock_timestamp())
  where feature_key = 'portal.care_access'), false, 'delayed Checkout cannot restore downgraded CareBase access');

select results_eq($$ select was_applied, was_stale from pg_temp.portal_event('evt_portalStaleUpgrade', 2, array['price_portalCareMonth']) $$,
  $$ values (false, true) $$, 'an older upgrade cannot override the newer downgrade');
select results_eq($$ select was_applied, was_stale from pg_temp.portal_event('evt_portalStaleUnknown', 1, array['price_unrecognized']) $$,
  $$ values (false, true) $$, 'a stale unknown price is ignored before current-plan validation');

select results_eq($$ select was_applied, was_stale from pg_temp.portal_event('evt_portalUnknown', 5, array['price_unrecognized']) $$,
  $$ values (false, false) $$, 'a fresh unknown catalog plan is rejected');
select is((select processing_status from app_private.stripe_billing_events where event_id = 'evt_portalUnknown'),
  'failed', 'an unknown plan leaves a durable failed receipt');
select is((select package_id from public.organizations where slug = 'portal-plan-org'),
  'ea000000-0000-4000-8000-000000000001'::uuid, 'rejected and stale transitions preserve the current package');
select is((select stripe_price_id from public.billing_subscription_items where organization_id = 'ea000000-0000-4000-8000-000000000011'),
  'price_portalTrainYear', 'a rejected plan rolls back subscription item replacement');
select is((select provider_event_id from public.billing_subscriptions where organization_id = 'ea000000-0000-4000-8000-000000000011'),
  'evt_portalDowngrade', 'rejection rolls back the attempted freshness advancement');

select ok(not (select was_applied from pg_temp.portal_event('evt_portalAmbiguous', 6,
  array['price_portalTrainMonth', 'price_portalCareMonth'])), 'two mapped packages are rejected instead of choosing one');
select is((select processing_status from app_private.stripe_billing_events where event_id = 'evt_portalAmbiguous'),
  'failed', 'an ambiguous plan has a durable failed receipt');
select ok(not (select was_applied from pg_temp.portal_event('evt_portalMixed', 7,
  array['price_portalCareMonth', 'price_unrecognized'])), 'a known package mixed with an unknown item is rejected');
select ok(not (select was_applied from pg_temp.portal_event('evt_portalPartial', 8,
  array['price_portalCareMonth'], p_has_more => true)), 'a truncated item list cannot select an application package');
select ok(not (select was_applied from pg_temp.portal_event('evt_portalEmptyActive', 9, array[]::text[])),
  'an active catalog subscription cannot regain a package through metadata with no prices');

select ok((select was_applied from pg_temp.portal_event('evt_portalPriceWins', 10, array['price_portalCareMonth'],
  'ea000000-0000-4000-8000-000000000099')), 'a recognized price wins even over a nonexistent metadata package');
select is((select package_id from public.organizations where slug = 'portal-plan-org'),
  'ea000000-0000-4000-8000-000000000002'::uuid, 'invalid old metadata does not block a valid upgrade');

select ok(not (select was_applied from pg_temp.portal_event('evt_portalUnknownFirst', 1, array['price_unrecognized'],
  p_org => 'ea000000-0000-4000-8000-000000000013')), 'a first app subscription also requires a recognized price');
select results_eq($$ select is_provider_placeholder, billing_state, provider_status from public.billing_subscriptions
  where organization_id = 'ea000000-0000-4000-8000-000000000013' $$,
  $$ values (true, 'suspended'::text, 'plan_reconciliation_failed'::text) $$,
  'a rejected first subscription leaves a recoverable quarantine without granting access');

select ok((select was_applied from pg_temp.portal_event('evt_portalLegacy', 1, array['price_customLegacy'],
  'ea000000-0000-4000-8000-000000000003', 'ea000000-0000-4000-8000-000000000012')),
  'a legacy custom subscription with no catalog mapping retains its metadata contract');
select is((select package_id from public.billing_subscriptions where organization_id = 'ea000000-0000-4000-8000-000000000012'),
  'ea000000-0000-4000-8000-000000000003'::uuid, 'the legacy package remains bound');
select ok((select was_applied from pg_temp.portal_event('evt_portalLegacyUpdate', 2, array['price_customLegacyNext'],
  'ea000000-0000-4000-8000-000000000003', 'ea000000-0000-4000-8000-000000000012')),
  'a legacy-only custom price update remains compatible');

select ok((select was_applied from pg_temp.portal_event('evt_portalCancel', 11, array[]::text[],
  p_status => 'canceled')), 'a terminal event without removed items can still cancel a catalog plan');
select is((select package_id from public.organizations where slug = 'portal-plan-org'),
  'ea000000-0000-4000-8000-000000000002'::uuid, 'terminal metadata cannot switch the retained historical package');
select is((select is_entitled from public.get_effective_entitlements('ea000000-0000-4000-8000-000000000011', clock_timestamp())
  where feature_key = 'portal.care_access'), false, 'cancellation removes paid access even while retaining package history');
select results_eq($$ select was_duplicate, was_applied from pg_temp.portal_event('evt_portalCancel', 11, array[]::text[], p_status => 'canceled') $$,
  $$ values (true, false) $$, 'redelivery preserves the existing duplicate event contract');
select ok(not has_function_privilege('authenticated',
  'public.process_stripe_billing_event(text,text,timestamptz,jsonb,text,text)', 'EXECUTE'),
  'the migration does not grant browsers access to signed-event reconciliation');

-- A terminal snapshot must end access even when its final prices cannot be
-- mapped. The package and last validated items remain historical facts.
select ok((select was_applied from pg_temp.portal_event('evt_portalBeforeUnknownCancel', 12, array['price_portalCareMonth'])),
  'the catalog subscription can recover before the terminal unknown-price case');
select ok((select was_applied from pg_temp.portal_event('evt_portalUnknownCancel', 13, array['price_unrecognized'],
  p_status => null, p_event_type => 'customer.subscription.deleted')),
  'a deleted subscription with an unknown item still applies its terminal status');
select is((select billing_state from public.billing_accounts where organization_id = 'ea000000-0000-4000-8000-000000000011'),
  'canceled', 'unknown final prices cannot retain active billing access');
select is((select stripe_price_id from public.billing_subscription_items where organization_id = 'ea000000-0000-4000-8000-000000000011'),
  'price_portalCareMonth', 'terminal events preserve the last validated item history');
select is((select package_id from public.organizations where slug = 'portal-plan-org'),
  'ea000000-0000-4000-8000-000000000002'::uuid, 'terminal unknown prices preserve the historical package');
select ok((select was_applied from pg_temp.portal_invoice('evt_portalInvoiceAfterCancel', 'ea000000-0000-4000-8000-000000000011')),
  'a paid invoice can still be recorded after cancellation');
select is((select billing_state from public.billing_accounts where organization_id = 'ea000000-0000-4000-8000-000000000011'),
  'canceled', 'invoice delivery cannot reactivate a terminal subscription');
select ok((select was_applied from pg_temp.portal_event('evt_portalBeforeExpiry', 14, array['price_portalCareMonth'])),
  'a valid subscription snapshot can recover after terminal state');
select ok((select was_applied from pg_temp.portal_event('evt_portalIncompleteExpired', 15,
  array['price_portalTrainMonth', 'price_portalCareMonth'], p_status => 'incomplete_expired', p_has_more => true)),
  'incomplete_expired still terminates an ambiguous truncated final snapshot');
select is((select is_entitled from public.get_effective_entitlements('ea000000-0000-4000-8000-000000000011', clock_timestamp())
  where feature_key = 'portal.care_access'), false, 'terminal ambiguous snapshots cannot retain paid entitlements');

-- Checkout's provisional grant must stop when the first authoritative plan is
-- rejected. Subsequent invoice success cannot validate that rejected package.
select ok((select was_applied from pg_temp.portal_checkout('evt_portalPlaceholderCheckout',
  'ea000000-0000-4000-8000-000000000014', 'ea000000-0000-4000-8000-000000000002')),
  'Checkout still grants a provisional package while the subscription is in flight');
select is((select is_entitled from public.get_effective_entitlements('ea000000-0000-4000-8000-000000000014', clock_timestamp())
  where feature_key = 'portal.care_access'), true, 'the Checkout fixture initially has provisional CareBase access');
select ok(not (select was_applied from pg_temp.portal_event('evt_portalPlaceholderRejected', 30,
  array['price_portalTrainMonth', 'price_portalCareMonth'], p_org => 'ea000000-0000-4000-8000-000000000014')),
  'ambiguous authoritative prices reject the Checkout placeholder package');
select results_eq($$ select is_provider_placeholder, billing_state, provider_status from public.billing_subscriptions
  where organization_id = 'ea000000-0000-4000-8000-000000000014' $$,
  $$ values (true, 'suspended'::text, 'plan_reconciliation_failed'::text) $$,
  'the rejected placeholder is retained for recovery but no longer confers active access');
select is((select processing_status from app_private.stripe_billing_events where event_id = 'evt_portalPlaceholderRejected'),
  'failed', 'placeholder quarantine retains the durable failed receipt');
select is((select billing_state from public.billing_accounts where organization_id = 'ea000000-0000-4000-8000-000000000014'),
  'suspended', 'the account also loses its provisional paid status');
select is((select subscription_status from public.organizations where slug = 'portal-placeholder-org'),
  'suspended', 'the organization status agrees after the inner transaction rolls back');
select is((select is_entitled from public.get_effective_entitlements('ea000000-0000-4000-8000-000000000014', clock_timestamp())
  where feature_key = 'portal.care_access'), false, 'rejected Checkout metadata cannot grant indefinite access');
select ok((select was_applied from pg_temp.portal_invoice('evt_portalQuarantinedInvoice', 'ea000000-0000-4000-8000-000000000014')),
  'the invoice for a quarantined placeholder is still durably recorded');
select is((select billing_state from public.billing_accounts where organization_id = 'ea000000-0000-4000-8000-000000000014'),
  'suspended', 'invoice success cannot reopen the rejected placeholder');
select ok((select was_applied from pg_temp.portal_event('evt_portalPlaceholderRecovered', 20, array['price_portalCareMonth'],
  p_org => 'ea000000-0000-4000-8000-000000000014')),
  'a validated snapshot can recover even when created before the rejected event and invoice');
select results_eq($$ select is_provider_placeholder, billing_state from public.billing_subscriptions
  where organization_id = 'ea000000-0000-4000-8000-000000000014' $$,
  $$ values (false, 'active'::text) $$, 'valid reconciliation replaces the quarantined placeholder');
select is((select billing_state from public.billing_accounts where organization_id = 'ea000000-0000-4000-8000-000000000014'),
  'active', 'quarantine does not advance account freshness past the recovering snapshot');
select is((select is_entitled from public.get_effective_entitlements('ea000000-0000-4000-8000-000000000014', clock_timestamp())
  where feature_key = 'portal.care_access'), true, 'validated reconciliation restores the purchased entitlement');

-- A duplicate Checkout may claim a higher package while another real
-- subscription remains active. Reject only that provisional grant.
select ok((select was_applied from pg_temp.portal_event('evt_portalDuplicateValid', 1, array['price_portalTrainMonth'],
  p_org => 'ea000000-0000-4000-8000-000000000015')), 'the duplicate scenario starts with a valid Train subscription');
select ok((select was_applied from pg_temp.portal_checkout('evt_portalDuplicateCheckout',
  'ea000000-0000-4000-8000-000000000015', 'ea000000-0000-4000-8000-000000000002', 'Second')),
  'a racing second Checkout has its own provisional subscription');
select ok(not (select was_applied from pg_temp.portal_event('evt_portalDuplicateRejected', 3, array['price_unrecognized'],
  p_org => 'ea000000-0000-4000-8000-000000000015', p_subscription_suffix => 'Second')),
  'the second unknown subscription is rejected');
select is((select billing_state from public.billing_accounts where organization_id = 'ea000000-0000-4000-8000-000000000015'),
  'active', 'a valid other subscription retains paid status');
select is((select package_id from public.organizations where slug = 'portal-duplicate-org'),
  'ea000000-0000-4000-8000-000000000001'::uuid, 'the other subscription restores its own validated package');
select is((select is_entitled from public.get_effective_entitlements('ea000000-0000-4000-8000-000000000015', clock_timestamp())
  where feature_key = 'portal.care_access'), false, 'rejected second-Checkout metadata does not retain higher access');

select ok((select was_applied from pg_temp.portal_checkout('evt_portalCompedCheckout',
  'ea000000-0000-4000-8000-000000000016', 'ea000000-0000-4000-8000-000000000002')),
  'the manual-comp scenario starts with a provisional subscription');
reset role;
update public.billing_accounts set billing_state = 'comped', state_source = 'manual_comp', comped_until = now() + interval '1 day'
where organization_id = 'ea000000-0000-4000-8000-000000000016';
set local role service_role;
select ok(not (select was_applied from pg_temp.portal_event('evt_portalCompedRejected', 2, array['price_unrecognized'],
  p_org => 'ea000000-0000-4000-8000-000000000016')), 'invalid provider pricing is still rejected for a comped organization');
select results_eq($$ select billing_state, state_source from public.billing_accounts
  where organization_id = 'ea000000-0000-4000-8000-000000000016' $$,
  $$ values ('comped'::text, 'manual_comp'::text) $$, 'an independent manual comp survives placeholder quarantine');

select results_eq($$ select o.package_id, a.comped_until from public.organizations o
  join public.billing_accounts a on a.organization_id = o.id where o.id = 'ea000000-0000-4000-8000-000000000016' $$,
  $$ values ('ea000000-0000-4000-8000-000000000001'::uuid, now() + interval '1 day') $$,
  'quarantine restores the pre-Checkout package without shortening the independent comp');
select results_eq($$ select entitlement_value, is_entitled from public.get_effective_entitlements(
  'ea000000-0000-4000-8000-000000000016', clock_timestamp()) where feature_key = 'limits.learners' $$,
  $$ values ('10'::jsonb, true) $$, 'the original comped Train allowance remains usable');
select is((select is_entitled from public.get_effective_entitlements('ea000000-0000-4000-8000-000000000016', clock_timestamp())
  where feature_key = 'portal.care_access'), false, 'the rejected higher package is unavailable during the comp');


-- Reverse delivery order: an invoice with a newer provider timestamp can arrive
-- before cancellation or first plan validation. It cannot retain invalid access.
select ok((select was_applied from pg_temp.portal_event('evt_portalReverseActive', 16, array['price_portalCareMonth'])),
  'the reverse-order cancellation starts with an active validated plan');
select ok((select was_applied from pg_temp.portal_invoice('evt_portalInvoiceBeforeCancel', 'ea000000-0000-4000-8000-000000000011')),
  'a later-created invoice is delivered before the cancellation snapshot');
select ok((select was_applied from pg_temp.portal_event('evt_portalReverseCancel', 18, array['price_unrecognized'], p_status => 'canceled')),
  'the subscription cancellation still applies despite the newer invoice receipt');
select is((select billing_state from public.billing_accounts where organization_id = 'ea000000-0000-4000-8000-000000000011'),
  'canceled', 'invoice-created ordering cannot keep a canceled account active');

select ok((select was_applied from pg_temp.portal_event('evt_portalBeforePause', 19, array['price_portalCareMonth'])),
  'the restrictive-status scenarios start with a validated paid plan');
select ok((select was_applied from pg_temp.portal_event('evt_portalUnknownPause', 20, array['price_unrecognized'], p_status => 'paused')),
  'unknown prices cannot prevent an authoritative pause');
select is((select billing_state from public.billing_accounts where organization_id = 'ea000000-0000-4000-8000-000000000011'),
  'suspended', 'a paused provider subscription loses active access');
select ok((select was_applied from pg_temp.portal_event('evt_portalBeforeUnpaid', 21, array['price_portalCareMonth'])),
  'a validated active snapshot resumes a paused subscription');
select ok((select was_applied from pg_temp.portal_event('evt_portalUnknownUnpaid', 22, array['price_unrecognized'], p_status => 'unpaid')),
  'unknown prices cannot prevent the existing unpaid policy');
select is((select billing_state from public.billing_accounts where organization_id = 'ea000000-0000-4000-8000-000000000011'),
  'past_due', 'unpaid retains the existing nonentitled billing state');
select ok((select was_applied from pg_temp.portal_event('evt_portalUnknownPastDue', 24, array['price_unrecognized'], p_status => 'past_due')),
  'unknown prices do not block the existing past-due grace period');
select is((select grace_ends_at from public.billing_accounts where organization_id = 'ea000000-0000-4000-8000-000000000011'),
  date_trunc('second', now()) - interval '36 seconds' + interval '7 days', 'past_due keeps its original seven-day grace clock');
select is((select is_entitled from public.get_effective_entitlements('ea000000-0000-4000-8000-000000000011', clock_timestamp() + interval '8 days')
  where feature_key = 'portal.care_access'), false, 'an unresolved price cannot turn dunning grace into indefinite access');
select ok((select was_applied from pg_temp.portal_event('evt_portalGraceMappedDowngrade', 25, array['price_portalTrainYear'],
  p_metadata_package => 'ea000000-0000-4000-8000-000000000002', p_status => 'past_due')),
  'a recognized downgrade still reconciles its purchased package during grace');
select is((select package_id from public.organizations where slug = 'portal-plan-org'),
  'ea000000-0000-4000-8000-000000000001'::uuid, 'known prices retain precedence over old metadata while past due');
select is((select is_entitled from public.get_effective_entitlements('ea000000-0000-4000-8000-000000000011', clock_timestamp())
  where feature_key = 'portal.care_access'), false, 'the lower mapped plan removes higher access immediately during grace');

select ok((select was_applied from pg_temp.portal_checkout('evt_portalInvoiceFirstCheckout',
  'ea000000-0000-4000-8000-000000000017', 'ea000000-0000-4000-8000-000000000002')),
  'the reverse-order recovery starts with a Checkout placeholder');
select ok((select was_applied from pg_temp.portal_invoice('evt_portalInvoiceFirstPaid', 'ea000000-0000-4000-8000-000000000017')),
  'payment is recorded before first authoritative plan rejection');
select ok(not (select was_applied from pg_temp.portal_event('evt_portalInvoiceFirstRejected', 30, array['price_unrecognized'],
  p_org => 'ea000000-0000-4000-8000-000000000017')), 'the first invalid plan is rejected after the invoice');
select is((select billing_state from public.billing_accounts where organization_id = 'ea000000-0000-4000-8000-000000000017'),
  'suspended', 'an earlier-delivered invoice does not prevent placeholder quarantine');
select ok((select was_applied from pg_temp.portal_event('evt_portalInvoiceFirstRecovered', 20, array['price_portalCareMonth'],
  p_org => 'ea000000-0000-4000-8000-000000000017')), 'an older-created valid plan can recover after the invoice-first rejection');
select is((select billing_state from public.billing_accounts where organization_id = 'ea000000-0000-4000-8000-000000000017'),
  'active', 'valid recovery respects the stored successful-payment evidence');

select ok((select was_applied from pg_temp.portal_checkout('evt_portalCompExpiryCheckout',
  'ea000000-0000-4000-8000-000000000018', 'ea000000-0000-4000-8000-000000000002')),
  'the comp-expiry case starts with a provisional plan');
select ok((select was_applied from pg_temp.portal_invoice('evt_portalCompExpiryPaid', 'ea000000-0000-4000-8000-000000000018')),
  'the account has active provider state before being manually comped');
reset role;
update public.billing_accounts set billing_state = 'comped', state_source = 'manual_comp', comped_until = now() + interval '1 day'
where organization_id = 'ea000000-0000-4000-8000-000000000018';
set local role service_role;
select ok(not (select was_applied from pg_temp.portal_event('evt_portalCompExpiryRejected', 30, array['price_unrecognized'],
  p_org => 'ea000000-0000-4000-8000-000000000018')), 'the invalid plan is rejected without revoking the manual comp');
select is((select is_entitled from public.get_effective_entitlements('ea000000-0000-4000-8000-000000000018', clock_timestamp())
  where feature_key = 'portal.care_access'), false, 'an independent comp cannot retain the rejected higher Checkout tier');
select is((select is_entitled from public.get_effective_entitlements('ea000000-0000-4000-8000-000000000018', clock_timestamp() + interval '2 days')
  where feature_key = 'portal.care_access'), false, 'expired comp cannot reveal the rejected placeholder as active provider state');
select ok((select was_applied from pg_temp.portal_event('evt_portalCompExpiryRecovered', 20, array['price_portalCareMonth'],
  p_org => 'ea000000-0000-4000-8000-000000000018')), 'valid reconciliation can recover underlying provider state during a comp');
select is((select is_entitled from public.get_effective_entitlements('ea000000-0000-4000-8000-000000000018', clock_timestamp() + interval '2 days')
  where feature_key = 'portal.care_access'), true, 'a validated paid plan remains available after the comp expires');

select ok((select was_applied from pg_temp.portal_checkout('evt_portalDunningCheckout',
  'ea000000-0000-4000-8000-000000000019', 'ea000000-0000-4000-8000-000000000002')),
  'the dunning case starts with a provisional plan');
select ok((select was_applied from pg_temp.portal_invoice('evt_portalDunningFailure', 'ea000000-0000-4000-8000-000000000019',
  p_event_type => 'invoice.payment_failed')), 'a newer payment failure is recorded before plan validation');
select ok(not (select was_applied from pg_temp.portal_event('evt_portalDunningRejected', 30, array['price_unrecognized'],
  p_org => 'ea000000-0000-4000-8000-000000000019')), 'the provisional plan is quarantined after its payment failure');
select ok((select was_applied from pg_temp.portal_event('evt_portalDunningRecovered', 20, array['price_portalCareMonth'],
  p_org => 'ea000000-0000-4000-8000-000000000019')), 'the older-created valid plan is reconciled');
select results_eq($$ select billing_state, provider_state, grace_ends_at from public.billing_accounts
  where organization_id = 'ea000000-0000-4000-8000-000000000019' $$,
  $$ values ('grace'::text, 'past_due'::text, date_trunc('second', now()) - interval '20 seconds' + interval '7 days') $$,
  'plan recovery preserves the newer payment failure and its original grace deadline');

-- Grace can preserve a validated plan, but cannot validate Checkout metadata.
select ok((select was_applied from pg_temp.portal_checkout('evt_portalUnvalidatedGraceCheckout',
  'ea000000-0000-4000-8000-000000000020', 'ea000000-0000-4000-8000-000000000002')),
  'the first-past-due case starts with a provisional higher plan');
select ok(not (select was_applied from pg_temp.portal_event('evt_portalUnvalidatedGraceRejected', 30, array['price_unrecognized'],
  p_org => 'ea000000-0000-4000-8000-000000000020', p_status => 'past_due')),
  'an unknown first past_due snapshot cannot validate a provisional package');
select results_eq($$ select is_provider_placeholder, billing_state, provider_status from public.billing_subscriptions
  where organization_id = 'ea000000-0000-4000-8000-000000000020' $$,
  $$ values (true, 'suspended'::text, 'plan_reconciliation_failed'::text) $$,
  'unresolved first grace remains a quarantined placeholder');
select ok((select was_applied from pg_temp.portal_invoice('evt_portalUnvalidatedGracePaid', 'ea000000-0000-4000-8000-000000000020')),
  'the subsequent paid invoice is still recorded');
select is((select billing_state from public.billing_accounts where organization_id = 'ea000000-0000-4000-8000-000000000020'),
  'suspended', 'payment cannot reopen an unvalidated past-due placeholder');
select is((select is_entitled from public.get_effective_entitlements('ea000000-0000-4000-8000-000000000020', clock_timestamp())
  where feature_key = 'portal.care_access'), false, 'unvalidated grace followed by payment cannot grant indefinite higher access');

reset role;
insert into public.organizations (id, name, slug, subscription_status, package_id)
values
  ('ea000000-0000-4000-8000-000000000021', 'Portal reverse no-account org', 'portal-reverse-no-account-org', 'trial', 'ea000000-0000-4000-8000-000000000001'),
  ('ea000000-0000-4000-8000-000000000022', 'Portal reverse trial org', 'portal-reverse-trial-org', 'trial', 'ea000000-0000-4000-8000-000000000001'),
  ('ea000000-0000-4000-8000-000000000023', 'Portal reverse duplicate org', 'portal-reverse-duplicate-org', 'trial', 'ea000000-0000-4000-8000-000000000001');
-- Organization creation normally makes a NULL-customer trial account. Delete
-- only this isolated fixture's account to exercise the first-upsert rollback.
delete from public.billing_accounts
where organization_id = 'ea000000-0000-4000-8000-000000000021';
set local role service_role;

-- Failure arrives before both Checkout and the first persistent account row.
select ok(not (select was_applied from pg_temp.portal_event('evt_portalNoAccountRejected', 30, array['price_unrecognized'],
  p_org => 'ea000000-0000-4000-8000-000000000021')), 'a first invalid snapshot remains rejected when no billing account existed');
select results_eq($$ select stripe_customer_id, billing_state from public.billing_accounts
  where organization_id = 'ea000000-0000-4000-8000-000000000021' $$,
  $$ values ('cus_portalea000000000040008000000000000021'::text, 'suspended'::text) $$,
  'the failed first snapshot persists only the correctly bound suspended account');
select results_eq($$ select is_provider_placeholder, billing_state, provider_status from public.billing_subscriptions
  where organization_id = 'ea000000-0000-4000-8000-000000000021' $$,
  $$ values (true, 'suspended'::text, 'plan_reconciliation_failed'::text) $$,
  'failure creates a durable quarantine before any Checkout placeholder exists');
select is((select processing_status from app_private.stripe_billing_events where event_id = 'evt_portalNoAccountRejected'),
  'failed', 'creating quarantine preserves the original durable failed receipt');
select ok((select was_applied from pg_temp.portal_checkout('evt_portalNoAccountCheckout',
  'ea000000-0000-4000-8000-000000000021', 'ea000000-0000-4000-8000-000000000002')),
  'a late paid Checkout is still durably processed');
select results_eq($$ select a.billing_state, o.subscription_status, o.package_id
  from public.billing_accounts a join public.organizations o on o.id = a.organization_id
  where o.id = 'ea000000-0000-4000-8000-000000000021' $$,
  $$ values ('suspended'::text, 'suspended'::text, 'ea000000-0000-4000-8000-000000000001'::uuid) $$,
  'late Checkout cannot activate or change the package of the rejected first plan');
select ok((select was_applied from pg_temp.portal_invoice('evt_portalNoAccountPaid', 'ea000000-0000-4000-8000-000000000021')),
  'a later paid invoice is durably recorded after failure and Checkout');
select is((select billing_state from public.billing_accounts where organization_id = 'ea000000-0000-4000-8000-000000000021'),
  'suspended', 'invoice payment cannot activate an unvalidated reverse-order plan');
select ok((select was_applied from pg_temp.portal_event('evt_portalNoAccountRecovered', 20, array['price_portalCareMonth'],
  p_org => 'ea000000-0000-4000-8000-000000000021')), 'a valid older snapshot can recover the reverse-order quarantine');
select results_eq($$ select is_provider_placeholder, billing_state, package_id from public.billing_subscriptions
  where organization_id = 'ea000000-0000-4000-8000-000000000021' $$,
  $$ values (false, 'active'::text, 'ea000000-0000-4000-8000-000000000002'::uuid) $$,
  'recovery produces one authoritative subscription with its purchased package');
select is((select is_entitled from public.get_effective_entitlements('ea000000-0000-4000-8000-000000000021', clock_timestamp())
  where feature_key = 'portal.care_access'), true, 'only the validated recovery grants the purchased higher access');

-- The ordinary signup account exists, but its first customer binding is rolled
-- back by failed price validation. An intervening invoice must remain blocked.
select results_eq($$ select stripe_customer_id, billing_state from public.billing_accounts
  where organization_id = 'ea000000-0000-4000-8000-000000000022' $$,
  $$ values (null::text, 'trial'::text) $$, 'normal signup begins with a NULL-bound trial account');
select ok(not (select was_applied from pg_temp.portal_event('evt_portalTrialFirstRejected', 30,
  array['price_portalTrainMonth', 'price_portalCareMonth'], p_org => 'ea000000-0000-4000-8000-000000000022')),
  'ambiguous prices fail before the normal trial account receives Checkout');
select results_eq($$ select stripe_customer_id, billing_state from public.billing_accounts
  where organization_id = 'ea000000-0000-4000-8000-000000000022' $$,
  $$ values ('cus_portalea000000000040008000000000000022'::text, 'suspended'::text) $$,
  'quarantine safely binds the existing NULL-customer account after rollback');
select ok((select was_applied from pg_temp.portal_invoice('evt_portalTrialFirstPaid', 'ea000000-0000-4000-8000-000000000022')),
  'an invoice arriving between rejection and Checkout is recorded');
select is((select billing_state from public.billing_accounts where organization_id = 'ea000000-0000-4000-8000-000000000022'),
  'suspended', 'the intervening paid invoice cannot confer access before Checkout');
select ok((select was_applied from pg_temp.portal_checkout('evt_portalTrialFirstCheckout',
  'ea000000-0000-4000-8000-000000000022', 'ea000000-0000-4000-8000-000000000002')),
  'Checkout can arrive after both rejection and invoice payment');
select results_eq($$ select a.billing_state, o.package_id from public.billing_accounts a
  join public.organizations o on o.id = a.organization_id
  where o.id = 'ea000000-0000-4000-8000-000000000022' $$,
  $$ values ('suspended'::text, 'ea000000-0000-4000-8000-000000000001'::uuid) $$,
  'late Checkout leaves the ordinary trial account quarantined on its original package');
select is((select is_entitled from public.get_effective_entitlements('ea000000-0000-4000-8000-000000000022', clock_timestamp())
  where feature_key = 'portal.care_access'), false, 'reversed webhook delivery never grants unvalidated CareBase access');
select ok((select was_applied from pg_temp.portal_event('evt_portalTrialFirstRecovered', 20, array['price_portalCareYear'],
  p_org => 'ea000000-0000-4000-8000-000000000022')), 'a valid annual plan also recovers the existing-account quarantine');
select is((select billing_state from public.billing_accounts where organization_id = 'ea000000-0000-4000-8000-000000000022'),
  'active', 'validated recovery reactivates the original account');

-- A legitimate lower subscription must survive a rejected second subscription
-- and its later Checkout metadata claiming higher access.
select ok((select was_applied from pg_temp.portal_event('evt_portalReverseOtherValid', 1, array['price_portalTrainMonth'],
  p_org => 'ea000000-0000-4000-8000-000000000023')), 'the reverse duplicate case starts with an authoritative lower plan');
select ok(not (select was_applied from pg_temp.portal_event('evt_portalReverseOtherRejected', 30, array['price_unrecognized'],
  p_org => 'ea000000-0000-4000-8000-000000000023', p_subscription_suffix => 'Second')),
  'an invalid second subscription is rejected before its Checkout arrives');
select results_eq($$ select a.billing_state, o.package_id from public.billing_accounts a
  join public.organizations o on o.id = a.organization_id
  where o.id = 'ea000000-0000-4000-8000-000000000023' $$,
  $$ values ('active'::text, 'ea000000-0000-4000-8000-000000000001'::uuid) $$,
  'the valid other subscription retains its active lower package');
select results_eq($$ select is_provider_placeholder, billing_state, provider_status from public.billing_subscriptions
  where stripe_subscription_id = 'sub_portalea000000000040008000000000000023Second' $$,
  $$ values (true, 'suspended'::text, 'plan_reconciliation_failed'::text) $$,
  'only the invalid second subscription receives durable quarantine');
select ok((select was_applied from pg_temp.portal_checkout('evt_portalReverseOtherCheckout',
  'ea000000-0000-4000-8000-000000000023', 'ea000000-0000-4000-8000-000000000002', 'Second')),
  'the rejected second subscription can receive its delayed higher-package Checkout');
select is((select package_id from public.organizations where id = 'ea000000-0000-4000-8000-000000000023'),
  'ea000000-0000-4000-8000-000000000001'::uuid, 'rejected second Checkout metadata cannot replace the valid lower package');
select is((select is_entitled from public.get_effective_entitlements('ea000000-0000-4000-8000-000000000023', clock_timestamp())
  where feature_key = 'portal.care_access'), false, 'the valid first plan cannot expose the rejected second Checkout higher entitlement');
select is((select stripe_price_id from public.billing_subscription_items where organization_id = 'ea000000-0000-4000-8000-000000000023'),
  'price_portalTrainMonth', 'quarantining the second subscription preserves the valid first items');
select ok((select was_applied from pg_temp.portal_event('evt_portalReverseOtherRecovered', 20, array['price_portalCareMonth'],
  p_org => 'ea000000-0000-4000-8000-000000000023', p_subscription_suffix => 'Second')),
  'an older valid snapshot can reconcile the quarantined second subscription');
select is((select is_entitled from public.get_effective_entitlements('ea000000-0000-4000-8000-000000000023', clock_timestamp())
  where feature_key = 'portal.care_access'), true, 'validated second-subscription recovery can grant the higher purchased plan');
select is((select count(*)::integer from public.billing_subscriptions
  where organization_id = 'ea000000-0000-4000-8000-000000000023' and not is_provider_placeholder),
  2, 'recovery retains both real subscriptions for duplicate billing reconciliation');

-- Invoice and subscription delivery order must not reverse newer payment
-- evidence. Each fixture uses the real receipt processor and entitlement read.
reset role;
insert into public.organizations (id, name, slug, subscription_status, package_id)
values
  ('ea000000-0000-4000-8000-000000000024', 'Portal payment ordering org', 'portal-payment-ordering-org', 'trial', 'ea000000-0000-4000-8000-000000000001'),
  ('ea000000-0000-4000-8000-000000000025', 'Portal quarantined failure org', 'portal-quarantined-failure-org', 'trial', 'ea000000-0000-4000-8000-000000000001'),
  ('ea000000-0000-4000-8000-000000000026', 'Portal quarantined paid org', 'portal-quarantined-paid-org', 'trial', 'ea000000-0000-4000-8000-000000000001'),
  ('ea000000-0000-4000-8000-000000000027', 'Portal quarantined old payment org', 'portal-quarantined-old-payment-org', 'trial', 'ea000000-0000-4000-8000-000000000001'),
  ('ea000000-0000-4000-8000-000000000028', 'Portal other payment org', 'portal-other-payment-org', 'trial', 'ea000000-0000-4000-8000-000000000001'),
  ('ea000000-0000-4000-8000-000000000029', 'Portal expired other payment org', 'portal-expired-other-payment-org', 'trial', 'ea000000-0000-4000-8000-000000000001');
set local role service_role;

select ok((select was_applied from pg_temp.portal_event('evt_portalPaymentOrderActive', 1, array['price_portalCareMonth'],
  p_org => 'ea000000-0000-4000-8000-000000000024')), 'payment ordering starts with a validated subscription');
select ok((select was_applied from pg_temp.portal_invoice('evt_portalPaymentOrderPaid', 'ea000000-0000-4000-8000-000000000024')),
  'a newer successful payment is delivered before restrictive snapshots');
select ok((select was_applied from pg_temp.portal_event('evt_portalOldPastDue', 2, array['price_unrecognized'],
  p_org => 'ea000000-0000-4000-8000-000000000024', p_status => 'past_due')), 'the older past-due subscription snapshot is recorded');
select is((select billing_state from public.billing_accounts where organization_id = 'ea000000-0000-4000-8000-000000000024'),
  'active', 'an older past-due snapshot cannot replace newer successful payment');
select ok((select was_applied from pg_temp.portal_event('evt_portalOldUnpaid', 3, array['price_unrecognized'],
  p_org => 'ea000000-0000-4000-8000-000000000024', p_status => 'unpaid')), 'the older unpaid snapshot is recorded');
select is((select billing_state from public.billing_accounts where organization_id = 'ea000000-0000-4000-8000-000000000024'),
  'active', 'an older unpaid snapshot cannot revoke access after newer successful payment');
select ok((select was_applied from pg_temp.portal_event('evt_portalOldPaused', 4, array['price_unrecognized'],
  p_org => 'ea000000-0000-4000-8000-000000000024', p_status => 'paused')), 'the older paused snapshot is recorded');
select results_eq($$ select billing_state, provider_event_id, grace_ends_at from public.billing_accounts
  where organization_id = 'ea000000-0000-4000-8000-000000000024' $$,
  $$ values ('active'::text, 'evt_portalPaymentOrderPaid'::text, null::timestamptz) $$,
  'older restrictive snapshots preserve the successful payment pointer and do not create dunning grace');
select is((select is_entitled from public.get_effective_entitlements('ea000000-0000-4000-8000-000000000024', clock_timestamp())
  where feature_key = 'portal.care_access'), true, 'newer payment preserves purchased access regardless of delivery order');
select ok((select was_applied from pg_temp.portal_event('evt_portalNewUnpaid', 50, array['price_unrecognized'],
  p_org => 'ea000000-0000-4000-8000-000000000024', p_status => 'unpaid')), 'a genuinely newer unpaid snapshot still takes effect');
select is((select billing_state from public.billing_accounts where organization_id = 'ea000000-0000-4000-8000-000000000024'),
  'past_due', 'newer unpaid status retains the existing nonentitled policy');
select ok((select was_applied from pg_temp.portal_invoice('evt_portalNewUnpaidPaid', 'ea000000-0000-4000-8000-000000000024',
  p_sequence => 52)), 'a newer paid invoice is accepted after the unpaid snapshot');
select is((select billing_state from public.billing_accounts where organization_id = 'ea000000-0000-4000-8000-000000000024'),
  'active', 'newer payment also restores access when delivered after unpaid status');
select ok((select was_applied from pg_temp.portal_event('evt_portalNewPaused', 54, array['price_unrecognized'],
  p_org => 'ea000000-0000-4000-8000-000000000024', p_status => 'paused')), 'a genuinely newer paused snapshot takes effect');
select is((select billing_state from public.billing_accounts where organization_id = 'ea000000-0000-4000-8000-000000000024'),
  'suspended', 'pause still suspends the account when newer than payment evidence');
select ok((select was_applied from pg_temp.portal_invoice('evt_portalNewPausedPaid', 'ea000000-0000-4000-8000-000000000024',
  p_event_type => 'invoice.payment_succeeded', p_sequence => 56)), 'a newer payment_succeeded invoice is accepted after pause');
select is((select billing_state from public.billing_accounts where organization_id = 'ea000000-0000-4000-8000-000000000024'),
  'active', 'successful payment after pause has the same outcome as reversed delivery');

-- Quarantining another subscription must preserve this newer payment even
-- though the first subscription still carries its older paused snapshot.
select ok(not (select was_applied from pg_temp.portal_event('evt_portalPaidThenInvalidSecond', 57, array['price_unrecognized'],
  p_org => 'ea000000-0000-4000-8000-000000000024', p_subscription_suffix => 'Second')),
  'an invalid second plan is rejected after payment restored the first plan');
select results_eq($$ select billing_state, provider_event_id, grace_ends_at from public.billing_accounts
  where organization_id = 'ea000000-0000-4000-8000-000000000024' $$,
  $$ values ('active'::text, 'evt_portalNewPausedPaid'::text, null::timestamptz) $$,
  'second-plan quarantine preserves the first plan newer successful payment');
select is((select package_id from public.organizations where id = 'ea000000-0000-4000-8000-000000000024'),
  'ea000000-0000-4000-8000-000000000002'::uuid, 'the paid first plan retains its validated CareBase package');
select results_eq($$ select is_provider_placeholder, billing_state, provider_status from public.billing_subscriptions
  where stripe_subscription_id = 'sub_portalea000000000040008000000000000024Second' $$,
  $$ values (true, 'suspended'::text, 'plan_reconciliation_failed'::text) $$,
  'only the invalid second subscription is quarantined after payment recovery');
select is((select is_entitled from public.get_effective_entitlements('ea000000-0000-4000-8000-000000000024', clock_timestamp())
  where feature_key = 'portal.care_access'), true, 'the paid first plan remains usable while its invalid second plan is quarantined');

select ok((select was_applied from pg_temp.portal_invoice('evt_portalFirstPlanNewFailure', 'ea000000-0000-4000-8000-000000000024',
  p_event_type => 'invoice.payment_failed', p_sequence => 58)), 'a newer first-plan failure starts its ordinary grace period');
select ok(not (select was_applied from pg_temp.portal_event('evt_portalGraceThenInvalidThird', 59, array['price_unrecognized'],
  p_org => 'ea000000-0000-4000-8000-000000000024', p_subscription_suffix => 'Third')),
  'an invalid third plan is rejected while the first plan has newer invoice grace');
select results_eq($$ select billing_state, provider_state, provider_event_id, grace_ends_at from public.billing_accounts
  where organization_id = 'ea000000-0000-4000-8000-000000000024' $$,
  $$ values ('grace'::text, 'past_due'::text, 'evt_portalFirstPlanNewFailure'::text,
             date_trunc('second', now()) - interval '2 seconds' + interval '7 days') $$,
  'third-plan quarantine preserves the first failure and its original grace deadline');
select is((select is_entitled from public.get_effective_entitlements('ea000000-0000-4000-8000-000000000024', clock_timestamp())
  where feature_key = 'portal.care_access'), true, 'the first plan retains access during its original grace period');
select is((select is_entitled from public.get_effective_entitlements('ea000000-0000-4000-8000-000000000024', clock_timestamp() + interval '8 days')
  where feature_key = 'portal.care_access'), false, 'preserving another plan payment evidence does not extend its grace entitlement');

select ok((select was_applied from pg_temp.portal_event('evt_portalExpiredFirstValid', -777600, array['price_portalCareMonth'],
  p_org => 'ea000000-0000-4000-8000-000000000029')), 'the expired-grace case starts with an older valid first plan');
select ok((select was_applied from pg_temp.portal_event('evt_portalExpiredFirstPaused', -777599, array['price_unrecognized'],
  p_org => 'ea000000-0000-4000-8000-000000000029', p_status => 'paused')), 'the older first-plan pause is recorded');
select ok((select was_applied from pg_temp.portal_invoice('evt_portalExpiredFirstFailure', 'ea000000-0000-4000-8000-000000000029',
  p_event_type => 'invoice.payment_failed', p_sequence => -691200)), 'a newer first-plan failure whose grace has expired is accepted');
select ok(not (select was_applied from pg_temp.portal_event('evt_portalExpiredInvalidSecond', 57, array['price_unrecognized'],
  p_org => 'ea000000-0000-4000-8000-000000000029', p_subscription_suffix => 'Second')),
  'an invalid second plan is rejected after the first plan grace has already expired');
select results_eq($$ select billing_state, provider_state, provider_event_id, grace_ends_at from public.billing_accounts
  where organization_id = 'ea000000-0000-4000-8000-000000000029' $$,
  $$ values ('grace'::text, 'past_due'::text, 'evt_portalExpiredFirstFailure'::text,
             date_trunc('second', now()) - interval '1 day 1 minute') $$,
  'quarantine preserves expired payment evidence without restarting its grace clock');
select is((select is_entitled from public.get_effective_entitlements('ea000000-0000-4000-8000-000000000029', clock_timestamp())
  where feature_key = 'portal.care_access'), false, 'an already expired first-plan grace remains nonentitled after second-plan quarantine');

select ok((select was_applied from pg_temp.portal_checkout('evt_portalDuringFailureCheckout',
  'ea000000-0000-4000-8000-000000000025', 'ea000000-0000-4000-8000-000000000002')),
  'the during-quarantine failure case starts with a provisional plan');
select ok((select was_applied from pg_temp.portal_invoice('evt_portalDuringFailurePriorPaid', 'ea000000-0000-4000-8000-000000000025',
  p_sequence => 5)), 'an earlier successful payment establishes the old account pointer');
select ok(not (select was_applied from pg_temp.portal_event('evt_portalDuringFailureRejected', 30, array['price_unrecognized'],
  p_org => 'ea000000-0000-4000-8000-000000000025')), 'invalid pricing quarantines the previously paid placeholder');
select ok((select was_applied from pg_temp.portal_invoice('evt_portalDuringFailureFailed', 'ea000000-0000-4000-8000-000000000025',
  p_event_type => 'invoice.payment_failed')), 'a newer failure is durably accepted during quarantine');
select is((select billing_state from public.billing_accounts where organization_id = 'ea000000-0000-4000-8000-000000000025'),
  'suspended', 'failure evidence does not turn quarantine into entitled grace before plan validation');
select ok((select was_applied from pg_temp.portal_event('evt_portalDuringFailureRecovered', 20, array['price_portalCareMonth'],
  p_org => 'ea000000-0000-4000-8000-000000000025')), 'an older valid snapshot recovers the plan after the failure');
select results_eq($$ select billing_state, provider_state, provider_event_id, grace_ends_at from public.billing_accounts
  where organization_id = 'ea000000-0000-4000-8000-000000000025' $$,
  $$ values ('grace'::text, 'past_due'::text, 'evt_portalDuringFailureFailed'::text,
             date_trunc('second', now()) - interval '20 seconds' + interval '7 days') $$,
  'recovery retains the failure received during quarantine and its original grace deadline');
select is((select is_entitled from public.get_effective_entitlements('ea000000-0000-4000-8000-000000000025', clock_timestamp() + interval '8 days')
  where feature_key = 'portal.care_access'), false, 'a quarantined payment failure cannot become indefinite paid access after recovery');

select ok(not (select was_applied from pg_temp.portal_event('evt_portalDuringPaidRejected', 30, array['price_unrecognized'],
  p_org => 'ea000000-0000-4000-8000-000000000026')), 'first invalid pricing starts the payment-recovery quarantine');
select ok((select was_applied from pg_temp.portal_invoice('evt_portalDuringPaidFailed', 'ea000000-0000-4000-8000-000000000026',
  p_event_type => 'invoice.payment_failed')), 'failure is accepted while the first plan remains quarantined');
select ok((select was_applied from pg_temp.portal_invoice('evt_portalDuringPaidSuccess', 'ea000000-0000-4000-8000-000000000026',
  p_event_type => 'invoice.payment_succeeded', p_sequence => 45)), 'newer success is also retained while quarantined');
select ok((select was_applied from pg_temp.portal_event('evt_portalDuringPaidRecovered', 20, array['price_portalCareMonth'],
  p_org => 'ea000000-0000-4000-8000-000000000026')), 'valid pricing recovers after both payment outcomes');
select results_eq($$ select billing_state, provider_event_id, grace_ends_at from public.billing_accounts
  where organization_id = 'ea000000-0000-4000-8000-000000000026' $$,
  $$ values ('active'::text, 'evt_portalDuringPaidSuccess'::text, null::timestamptz) $$,
  'the latest successful invoice supersedes the quarantined failure during recovery');

select ok(not (select was_applied from pg_temp.portal_event('evt_portalDuringOldPaidRejected', 30, array['price_unrecognized'],
  p_org => 'ea000000-0000-4000-8000-000000000027')), 'the reversed invoice-order case starts quarantined');
select ok((select was_applied from pg_temp.portal_invoice('evt_portalDuringOldPaidFailed', 'ea000000-0000-4000-8000-000000000027',
  p_event_type => 'invoice.payment_failed', p_sequence => 45)), 'a newer failure is delivered first during quarantine');
select ok((select was_applied from pg_temp.portal_invoice('evt_portalDuringOldPaidSuccess', 'ea000000-0000-4000-8000-000000000027')),
  'an older success from another invoice is delivered afterward');
select ok((select was_applied from pg_temp.portal_event('evt_portalDuringOldPaidRecovered', 20, array['price_portalCareMonth'],
  p_org => 'ea000000-0000-4000-8000-000000000027')), 'valid pricing recovers after reversed invoice delivery');
select results_eq($$ select billing_state, provider_event_id, grace_ends_at from public.billing_accounts
  where organization_id = 'ea000000-0000-4000-8000-000000000027' $$,
  $$ values ('grace'::text, 'evt_portalDuringOldPaidFailed'::text,
             date_trunc('second', now()) - interval '15 seconds' + interval '7 days') $$,
  'payment creation time wins over reversed arrival when recovering quarantine');

select ok((select was_applied from pg_temp.portal_event('evt_portalOtherPaymentValid', 1, array['price_portalTrainMonth'],
  p_org => 'ea000000-0000-4000-8000-000000000028')), 'an existing valid subscription precedes a quarantined second plan');
select ok((select was_applied from pg_temp.portal_invoice('evt_portalOtherPaymentPaid', 'ea000000-0000-4000-8000-000000000028',
  p_sequence => 55)), 'the existing subscription has newer successful account evidence');
select ok(not (select was_applied from pg_temp.portal_event('evt_portalOtherPaymentRejected', 30, array['price_unrecognized'],
  p_org => 'ea000000-0000-4000-8000-000000000028', p_subscription_suffix => 'Second')),
  'the invalid second subscription is independently quarantined');
select ok((select was_applied from pg_temp.portal_invoice('evt_portalOtherPaymentFailed', 'ea000000-0000-4000-8000-000000000028',
  'Second', 'invoice.payment_failed')), 'the second plan records an older failure during quarantine');
select ok((select was_applied from pg_temp.portal_event('evt_portalOtherPaymentRecovered', 20, array['price_portalTrainYear'],
  p_org => 'ea000000-0000-4000-8000-000000000028', p_subscription_suffix => 'Second')),
  'the second plan can validate without rewriting newer first-subscription evidence');
select results_eq($$ select billing_state, provider_event_id, grace_ends_at from public.billing_accounts
  where organization_id = 'ea000000-0000-4000-8000-000000000028' $$,
  $$ values ('active'::text, 'evt_portalOtherPaymentPaid'::text, null::timestamptz) $$,
  'quarantine recovery cannot override a newer account event for another valid subscription');

select ok(not (select was_applied from pg_temp.portal_event('evt_portalOtherTerminalRejected', 30, array['price_unrecognized'],
  p_org => 'ea000000-0000-4000-8000-000000000028', p_subscription_suffix => 'Third')),
  'a third invalid subscription is quarantined for terminal recovery ordering');
select ok((select was_applied from pg_temp.portal_invoice('evt_portalOtherTerminalFailed', 'ea000000-0000-4000-8000-000000000028',
  'Third', 'invoice.payment_failed')), 'the terminal quarantine records its own historical payment failure');
select ok((select was_applied from pg_temp.portal_event('evt_portalOtherPaymentCanceled', 19, array['price_unrecognized'],
  p_org => 'ea000000-0000-4000-8000-000000000028', p_subscription_suffix => 'Third', p_status => 'canceled')),
  'a quarantined third subscription can terminate without promoting historical invoices');
select results_eq($$ select billing_state, provider_event_id from public.billing_accounts
  where organization_id = 'ea000000-0000-4000-8000-000000000028' $$,
  $$ values ('active'::text, 'evt_portalOtherPaymentPaid'::text) $$,
  'terminal quarantine recovery cannot override newer evidence for another valid subscription');


-- Failure-before-Checkout must inherit the same independent provenance when
-- another unvalidated Checkout already supplies the organization tier.
reset role;
insert into public.organizations (id, name, slug, subscription_status, package_id)
values ('ea000000-0000-4000-8000-000000000036', 'Portal reverse chained comp org', 'portal-reverse-chained-comp-org', 'trial', 'ea000000-0000-4000-8000-000000000001');
update public.billing_accounts set billing_state = 'comped', state_source = 'manual_comp', comped_until = now() + interval '1 day'
where organization_id = 'ea000000-0000-4000-8000-000000000036';
set local role service_role;
select ok((select was_applied from pg_temp.portal_checkout('evt_portalReverseChainCheckoutA', 'ea000000-0000-4000-8000-000000000036',
  'ea000000-0000-4000-8000-000000000002')), 'the reversed chain begins with an unvalidated higher Checkout');
select ok(not (select was_applied from pg_temp.portal_event('evt_portalReverseChainRejectedB', 30, array['price_unrecognized'],
  p_org => 'ea000000-0000-4000-8000-000000000036', p_subscription_suffix => 'Second')), 'second-plan rejection can arrive before its own Checkout');
select results_eq($$ select o.package_id, a.billing_state, a.comped_until from public.organizations o
  join public.billing_accounts a on a.organization_id = o.id where o.id = 'ea000000-0000-4000-8000-000000000036' $$,
  $$ values ('ea000000-0000-4000-8000-000000000001'::uuid, 'comped'::text, now() + interval '1 day') $$,
  'failure-before-second-Checkout inherits the first Checkout independent lower comp');
select is((select checkout_previous_package_id from public.billing_subscriptions
  where stripe_subscription_id = 'sub_portalea000000000040008000000000000036Second'),
  'ea000000-0000-4000-8000-000000000001'::uuid, 'reverse-order quarantine stores trustworthy original provenance');
select ok((select was_applied from pg_temp.portal_checkout('evt_portalReverseChainCheckoutB', 'ea000000-0000-4000-8000-000000000036',
  'ea000000-0000-4000-8000-000000000002', 'Second')), 'the rejected second subscription can later receive Checkout');
select is((select is_entitled from public.get_effective_entitlements('ea000000-0000-4000-8000-000000000036', clock_timestamp())
  where feature_key = 'portal.care_access'), false, 'late second Checkout cannot launder the first provisional tier into comped access');

-- Package provenance must survive repeat Checkout and must not select a
-- historical canceled tier ahead of an independently chosen current comp.
reset role;
insert into public.organizations (id, name, slug, subscription_status, package_id)
values
  ('ea000000-0000-4000-8000-000000000030', 'Portal provenance comp org', 'portal-provenance-comp-org', 'trial', 'ea000000-0000-4000-8000-000000000001'),
  ('ea000000-0000-4000-8000-000000000031', 'Portal legacy provenance org', 'portal-legacy-provenance-org', 'trial', 'ea000000-0000-4000-8000-000000000001'),
  ('ea000000-0000-4000-8000-000000000032', 'Portal chained provenance org', 'portal-chained-provenance-org', 'trial', 'ea000000-0000-4000-8000-000000000001');
set local role service_role;
select ok((select was_applied from pg_temp.portal_event('evt_portalCompHistoricalCare', 1, array['price_portalCareMonth'],
  p_org => 'ea000000-0000-4000-8000-000000000030')), 'the provenance case has a historical higher subscription');
select ok((select was_applied from pg_temp.portal_event('evt_portalCompHistoricalCanceled', 2, array['price_unrecognized'],
  p_org => 'ea000000-0000-4000-8000-000000000030', p_status => 'canceled')), 'the historical higher subscription is canceled');
reset role;
update public.organizations set package_id = 'ea000000-0000-4000-8000-000000000001' where id = 'ea000000-0000-4000-8000-000000000030';
update public.billing_accounts set billing_state = 'comped', state_source = 'manual_comp', comped_until = now() + interval '1 day'
where organization_id = 'ea000000-0000-4000-8000-000000000030';
set local role service_role;
select ok((select was_applied from pg_temp.portal_checkout('evt_portalCompNewCheckout', 'ea000000-0000-4000-8000-000000000030',
  'ea000000-0000-4000-8000-000000000002', 'Second')), 'new Checkout provisionally claims the higher tier during a lower independent comp');
select ok((select was_applied from pg_temp.portal_checkout('evt_portalCompRepeatedCheckout', 'ea000000-0000-4000-8000-000000000030',
  'ea000000-0000-4000-8000-000000000002', 'Second')), 'a repeated Checkout is accepted without replacing original provenance');
select is((select checkout_previous_package_id from public.billing_subscriptions
  where stripe_subscription_id = 'sub_portalea000000000040008000000000000030Second'),
  'ea000000-0000-4000-8000-000000000001'::uuid, 'provenance records the actual pre-Checkout lower tier, not canceled history or a repeated provisional stamp');
select ok(not (select was_applied from pg_temp.portal_event('evt_portalCompNewRejected', 30, array['price_unrecognized'],
  p_org => 'ea000000-0000-4000-8000-000000000030', p_subscription_suffix => 'Second')), 'invalid higher pricing is rejected during the lower comp');
select results_eq($$ select o.package_id, a.billing_state, a.state_source, a.comped_until from public.organizations o
  join public.billing_accounts a on a.organization_id = o.id where o.id = 'ea000000-0000-4000-8000-000000000030' $$,
  $$ values ('ea000000-0000-4000-8000-000000000001'::uuid, 'comped'::text, 'manual_comp'::text, now() + interval '1 day') $$,
  'failed reconciliation preserves the actual lower comp and its expiry despite historical higher billing');
select is((select is_entitled from public.get_effective_entitlements('ea000000-0000-4000-8000-000000000030', clock_timestamp())
  where feature_key = 'portal.care_access'), false, 'comp cannot restore the rejected higher entitlement from historical billing');

select ok((select was_applied from pg_temp.portal_checkout('evt_portalLegacyProvenanceCheckout', 'ea000000-0000-4000-8000-000000000031',
  'ea000000-0000-4000-8000-000000000002')), 'the legacy placeholder fixture starts with higher provisional Checkout');
reset role;
-- Simulate a placeholder created before the provenance column existed.
update public.billing_subscriptions set checkout_previous_package_id = null where organization_id = 'ea000000-0000-4000-8000-000000000031';
update public.billing_accounts set billing_state = 'comped', state_source = 'manual_comp', comped_until = null
where organization_id = 'ea000000-0000-4000-8000-000000000031';
set local role service_role;
select ok(not (select was_applied from pg_temp.portal_event('evt_portalLegacyProvenanceRejected', 30, array['price_unrecognized'],
  p_org => 'ea000000-0000-4000-8000-000000000031')), 'invalid legacy placeholder pricing is rejected without inventing a prior package');
select results_eq($$ select o.package_id, a.billing_state, a.state_source, a.comped_until from public.organizations o
  join public.billing_accounts a on a.organization_id = o.id where o.id = 'ea000000-0000-4000-8000-000000000031' $$,
  $$ values (null::uuid, 'comped'::text, 'manual_comp'::text, null::timestamptz) $$,
  'unknown pre-migration provenance clears only the unvalidated tier while retaining the indefinite independent comp');
select is((select is_entitled from public.get_effective_entitlements('ea000000-0000-4000-8000-000000000031', clock_timestamp())
  where feature_key = 'portal.care_access'), false, 'an indefinite comp cannot keep the legacy placeholder unvalidated CareBase tier');

reset role;
update public.billing_accounts set billing_state = 'comped', state_source = 'manual_comp', comped_until = null
where organization_id = 'ea000000-0000-4000-8000-000000000032';
set local role service_role;
select ok((select was_applied from pg_temp.portal_checkout('evt_portalChainCheckoutA', 'ea000000-0000-4000-8000-000000000032',
  'ea000000-0000-4000-8000-000000000002')), 'the first unvalidated Checkout provisionally stamps a higher tier');
select ok((select was_applied from pg_temp.portal_checkout('evt_portalChainCheckoutB', 'ea000000-0000-4000-8000-000000000032',
  'ea000000-0000-4000-8000-000000000002', 'Second')), 'a second unvalidated Checkout inherits the currently stamped first Checkout provenance');
select is((select checkout_previous_package_id from public.billing_subscriptions
  where stripe_subscription_id = 'sub_portalea000000000040008000000000000032Second'),
  'ea000000-0000-4000-8000-000000000001'::uuid, 'a second provisional subscription cannot launder the first provisional tier into trusted provenance');
select ok(not (select was_applied from pg_temp.portal_event('evt_portalChainRejectedB', 30, array['price_unrecognized'],
  p_org => 'ea000000-0000-4000-8000-000000000032', p_subscription_suffix => 'Second')), 'the second unvalidated plan is rejected');
select results_eq($$ select o.package_id, a.billing_state from public.organizations o
  join public.billing_accounts a on a.organization_id = o.id where o.id = 'ea000000-0000-4000-8000-000000000032' $$,
  $$ values ('ea000000-0000-4000-8000-000000000001'::uuid, 'comped'::text) $$,
  'rejection restores the lower independent comp through a chain of two unvalidated Checkouts');
select is((select is_entitled from public.get_effective_entitlements('ea000000-0000-4000-8000-000000000032', clock_timestamp())
  where feature_key = 'portal.care_access'), false, 'chained provisional Checkout cannot preserve rejected higher access');

reset role;
insert into public.organizations (id, name, slug, subscription_status, package_id)
values ('ea000000-0000-4000-8000-000000000033', 'Portal restrictive recovery 33', 'portal-restrictive-recovery-33', 'trial', 'ea000000-0000-4000-8000-000000000001');
set local role service_role;
select ok(not (select was_applied from pg_temp.portal_event('evt_portalRestriction33Failed', 30, array['price_unrecognized'],
  p_org => 'ea000000-0000-4000-8000-000000000033', p_status => 'past_due')), 'first past_due snapshot is quarantined when its plan is unknown');
select ok((select was_applied from pg_temp.portal_event('evt_portalRestriction33Recovered', 20, array['price_portalCareMonth'],
  p_org => 'ea000000-0000-4000-8000-000000000033')), 'older valid prices recover the plan without erasing newer past_due evidence');
select results_eq($$ select provider_status, billing_state, provider_event_id, is_provider_placeholder from public.billing_subscriptions
  where organization_id = 'ea000000-0000-4000-8000-000000000033' $$,
  $$ values ('past_due'::text, 'grace'::text, 'evt_portalRestriction33Failed'::text, false) $$,
  'validated items retain the newer past_due subscription receipt as their freshness boundary');
select results_eq($$ select provider_state, billing_state, provider_event_id from public.billing_accounts where organization_id = 'ea000000-0000-4000-8000-000000000033' $$,
  $$ values ('past_due'::text, 'grace'::text, 'evt_portalRestriction33Failed'::text) $$,
  'account recovery honors the original newer past_due status');
select results_eq($$ select was_applied, was_stale from pg_temp.portal_event('evt_portalRestriction33StillOlder', 25, array['price_portalCareYear'], p_org => 'ea000000-0000-4000-8000-000000000033') $$,
  $$ values (false, true) $$, 'another older active snapshot cannot erase the recovered past_due boundary');

select is((select grace_ends_at from public.billing_accounts where organization_id = 'ea000000-0000-4000-8000-000000000033'),
  date_trunc('second', now()) - interval '30 seconds' + interval '7 days', 'recovered past-due status retains its original grace deadline');
select is((select is_entitled from public.get_effective_entitlements('ea000000-0000-4000-8000-000000000033', clock_timestamp() + interval '8 days')
  where feature_key = 'portal.care_access'), false, 'failed restrictive receipt recovery cannot grant indefinite access after grace');

select ok((select was_applied from pg_temp.portal_invoice('evt_portalRestriction33NewPaid', 'ea000000-0000-4000-8000-000000000033', p_sequence => 40)),
  'a genuinely newer successful payment can restore access after recovered past_due evidence');
select is((select billing_state from public.billing_accounts where organization_id = 'ea000000-0000-4000-8000-000000000033'), 'active',
  'new successful payment supersedes the older recovered restrictive evidence');

reset role;
insert into public.organizations (id, name, slug, subscription_status, package_id)
values ('ea000000-0000-4000-8000-000000000034', 'Portal restrictive recovery 34', 'portal-restrictive-recovery-34', 'trial', 'ea000000-0000-4000-8000-000000000001');
set local role service_role;
select ok(not (select was_applied from pg_temp.portal_event('evt_portalRestriction34Failed', 30, array['price_unrecognized'],
  p_org => 'ea000000-0000-4000-8000-000000000034', p_status => 'unpaid')), 'first unpaid snapshot is quarantined when its plan is unknown');
select ok((select was_applied from pg_temp.portal_event('evt_portalRestriction34Recovered', 20, array['price_portalCareMonth'],
  p_org => 'ea000000-0000-4000-8000-000000000034')), 'older valid prices recover the plan without erasing newer unpaid evidence');
select results_eq($$ select provider_status, billing_state, provider_event_id, is_provider_placeholder from public.billing_subscriptions
  where organization_id = 'ea000000-0000-4000-8000-000000000034' $$,
  $$ values ('unpaid'::text, 'past_due'::text, 'evt_portalRestriction34Failed'::text, false) $$,
  'validated items retain the newer unpaid subscription receipt as their freshness boundary');
select results_eq($$ select provider_state, billing_state, provider_event_id from public.billing_accounts where organization_id = 'ea000000-0000-4000-8000-000000000034' $$,
  $$ values ('unpaid'::text, 'past_due'::text, 'evt_portalRestriction34Failed'::text) $$,
  'account recovery honors the original newer unpaid status');
select results_eq($$ select was_applied, was_stale from pg_temp.portal_event('evt_portalRestriction34StillOlder', 25, array['price_portalCareYear'], p_org => 'ea000000-0000-4000-8000-000000000034') $$,
  $$ values (false, true) $$, 'another older active snapshot cannot erase the recovered unpaid boundary');

select is((select is_entitled from public.get_effective_entitlements('ea000000-0000-4000-8000-000000000034', clock_timestamp())
  where feature_key = 'portal.care_access'), false, 'recovered unpaid state does not confer access');

select ok((select was_applied from pg_temp.portal_invoice('evt_portalRestriction34NewPaid', 'ea000000-0000-4000-8000-000000000034', p_sequence => 40)),
  'a genuinely newer successful payment can restore access after recovered unpaid evidence');
select is((select billing_state from public.billing_accounts where organization_id = 'ea000000-0000-4000-8000-000000000034'), 'active',
  'new successful payment supersedes the older recovered restrictive evidence');

reset role;
insert into public.organizations (id, name, slug, subscription_status, package_id)
values ('ea000000-0000-4000-8000-000000000035', 'Portal restrictive recovery 35', 'portal-restrictive-recovery-35', 'trial', 'ea000000-0000-4000-8000-000000000001');
set local role service_role;
select ok(not (select was_applied from pg_temp.portal_event('evt_portalRestriction35Failed', 30, array['price_unrecognized'],
  p_org => 'ea000000-0000-4000-8000-000000000035', p_status => 'paused')), 'first paused snapshot is quarantined when its plan is unknown');
select ok((select was_applied from pg_temp.portal_event('evt_portalRestriction35Recovered', 20, array['price_portalCareMonth'],
  p_org => 'ea000000-0000-4000-8000-000000000035')), 'older valid prices recover the plan without erasing newer paused evidence');
select results_eq($$ select provider_status, billing_state, provider_event_id, is_provider_placeholder from public.billing_subscriptions
  where organization_id = 'ea000000-0000-4000-8000-000000000035' $$,
  $$ values ('paused'::text, 'suspended'::text, 'evt_portalRestriction35Failed'::text, false) $$,
  'validated items retain the newer paused subscription receipt as their freshness boundary');
select results_eq($$ select provider_state, billing_state, provider_event_id from public.billing_accounts where organization_id = 'ea000000-0000-4000-8000-000000000035' $$,
  $$ values ('paused'::text, 'suspended'::text, 'evt_portalRestriction35Failed'::text) $$,
  'account recovery honors the original newer paused status');
select results_eq($$ select was_applied, was_stale from pg_temp.portal_event('evt_portalRestriction35StillOlder', 25, array['price_portalCareYear'], p_org => 'ea000000-0000-4000-8000-000000000035') $$,
  $$ values (false, true) $$, 'another older active snapshot cannot erase the recovered paused boundary');

select is((select is_entitled from public.get_effective_entitlements('ea000000-0000-4000-8000-000000000035', clock_timestamp())
  where feature_key = 'portal.care_access'), false, 'recovered paused state does not confer access');

select ok((select was_applied from pg_temp.portal_invoice('evt_portalRestriction35NewPaid', 'ea000000-0000-4000-8000-000000000035', p_sequence => 40)),
  'a genuinely newer successful payment can restore access after recovered paused evidence');
select is((select billing_state from public.billing_accounts where organization_id = 'ea000000-0000-4000-8000-000000000035'), 'active',
  'new successful payment supersedes the older recovered restrictive evidence');
-- A mapped historical seat plan must keep its purchased cap
-- when newer payment evidence restores access past an older provider snapshot.
reset role;
insert into public.packages (id, name, learner_limit, facility_limit, features)
values ('eaff0000-0000-4000-8000-000000000001', 'Portal legacy seat contract', 100, 10, '{}'::jsonb);
insert into public.package_billing_prices (
  package_id, stripe_price_id, recurring_interval, billing_metric, pricing_model,
  base_amount_cents, unit_amount_cents, minimum_quantity, maximum_quantity, is_seat_based
) values (
  'eaff0000-0000-4000-8000-000000000001', 'price_portalLegacySeats', 'month', 'active_learner', 'per_unit',
  0, 1000, 1, 100, true
);
insert into public.organizations (id, name, slug, subscription_status, package_id)
values
  ('eaff0000-0000-4000-8000-000000000101', 'Portal seats paid before unpaid', 'portal-seats-paid-before-unpaid', 'trial', 'eaff0000-0000-4000-8000-000000000001'),
  ('eaff0000-0000-4000-8000-000000000102', 'Portal seats paid before pause', 'portal-seats-paid-before-pause', 'trial', 'eaff0000-0000-4000-8000-000000000001'),
  ('eaff0000-0000-4000-8000-000000000103', 'Portal seats unpaid before paid', 'portal-seats-unpaid-before-paid', 'trial', 'eaff0000-0000-4000-8000-000000000001'),
  ('eaff0000-0000-4000-8000-000000000104', 'Portal seats pause before paid', 'portal-seats-pause-before-paid', 'trial', 'eaff0000-0000-4000-8000-000000000001');

-- Invoice fixtures already accept these sub_portal identifiers. Mutations still
-- go through the real processor; only signed-event-shaped input is constructed.
create function pg_temp.portal_seat_event(
  p_event text, p_sequence integer, p_org uuid, p_status text default 'active',
  p_known_price boolean default true, p_event_type text default 'customer.subscription.updated'
)
returns table (was_duplicate boolean, was_applied boolean, was_stale boolean,
               resolved_organization_id uuid, canonical_state text)
language sql set search_path = ''
as $fixture$
  select * from public.process_stripe_billing_event(
    p_event, p_event_type, date_trunc('second', now()) - interval '1 minute' + p_sequence * interval '1 second',
    jsonb_build_object('data', jsonb_build_object('object', jsonb_build_object(
      'id', 'sub_portal' || replace(p_org::text, '-', ''),
      'customer', 'cus_portal' || replace(p_org::text, '-', ''),
      'status', p_status,
      'metadata', jsonb_build_object('organization_id', p_org, 'package_id', 'eaff0000-0000-4000-8000-000000000001'),
      'items', jsonb_build_object('has_more', false, 'data', jsonb_build_array(jsonb_build_object(
        'id', 'si_portal' || replace(p_org::text, '-', '') || '1',
        'quantity', case when p_known_price then 7 else 99 end,
        'current_period_start', extract(epoch from now())::bigint,
        'current_period_end', extract(epoch from now() + interval '1 year')::bigint,
        'price', jsonb_build_object('id', case when p_known_price then 'price_portalLegacySeats' else 'price_unrecognized' end)
      )))
    ))), md5(p_event) || md5(p_event), p_event
  );
$fixture$;
set local role service_role;

select ok((select was_applied from pg_temp.portal_seat_event('evt_portalSeat101Initial', 1, 'eaff0000-0000-4000-8000-000000000101')),
  'seat case 101 begins with an authoritative mapped seven-seat subscription');
select results_eq($$ select entitlement_value, entitlement_source, billing_state, is_entitled
  from public.get_effective_entitlements('eaff0000-0000-4000-8000-000000000101', clock_timestamp()) where feature_key = 'limits.learners' $$,
  $$ values ('7'::jsonb, 'package+stripe_seat_cap'::text, 'active'::text, true) $$,
  'seat case 101 initially caps its hundred-seat package at seven purchased seats');
select ok((select was_applied from pg_temp.portal_invoice('evt_portalSeat101Paid', 'eaff0000-0000-4000-8000-000000000101',
  p_event_type => 'invoice.paid', p_sequence => 40)), 'seat case 101 accepts its newer successful invoice');
select ok((select was_applied from pg_temp.portal_seat_event('evt_portalSeat101Restrictive', 10, 'eaff0000-0000-4000-8000-000000000101', 'unpaid', false)),
  'seat case 101 accepts the older unpaid snapshot while retaining validated item history');
select results_eq($$ select entitlement_value, entitlement_source, billing_state, is_entitled
  from public.get_effective_entitlements('eaff0000-0000-4000-8000-000000000101', clock_timestamp()) where feature_key = 'limits.learners' $$,
  $$ values ('7'::jsonb, 'package+stripe_seat_cap'::text, 'active'::text, true) $$,
  'seat case 101 preserves seven purchased seats after payment despite the older unpaid snapshot');
select results_eq($$ select s.billing_state, s.provider_status, s.provider_event_id, a.provider_event_id
  from public.billing_subscriptions s join public.billing_accounts a on a.id = s.billing_account_id
  where s.organization_id = 'eaff0000-0000-4000-8000-000000000101' $$,
  $$ values ('past_due'::text, 'unpaid'::text, 'evt_portalSeat101Restrictive'::text, 'evt_portalSeat101Paid'::text) $$,
  'seat case 101 retains independent subscription and payment chronology');
select is(public.has_effective_entitlement('eaff0000-0000-4000-8000-000000000101', 'limits.learners', 8, clock_timestamp()), false,
  'seat case 101 cannot use an eighth seat through the quantity-aware entitlement consumer');

select ok((select was_applied from pg_temp.portal_seat_event('evt_portalSeat102Initial', 1, 'eaff0000-0000-4000-8000-000000000102')),
  'seat case 102 begins with an authoritative mapped seven-seat subscription');
select results_eq($$ select entitlement_value, entitlement_source, billing_state, is_entitled
  from public.get_effective_entitlements('eaff0000-0000-4000-8000-000000000102', clock_timestamp()) where feature_key = 'limits.learners' $$,
  $$ values ('7'::jsonb, 'package+stripe_seat_cap'::text, 'active'::text, true) $$,
  'seat case 102 initially caps its hundred-seat package at seven purchased seats');
select ok((select was_applied from pg_temp.portal_invoice('evt_portalSeat102Paid', 'eaff0000-0000-4000-8000-000000000102',
  p_event_type => 'invoice.payment_succeeded', p_sequence => 40)), 'seat case 102 accepts its newer successful invoice');
select ok((select was_applied from pg_temp.portal_seat_event('evt_portalSeat102Restrictive', 10, 'eaff0000-0000-4000-8000-000000000102', 'paused', false)),
  'seat case 102 accepts the older paused snapshot while retaining validated item history');
select results_eq($$ select entitlement_value, entitlement_source, billing_state, is_entitled
  from public.get_effective_entitlements('eaff0000-0000-4000-8000-000000000102', clock_timestamp()) where feature_key = 'limits.learners' $$,
  $$ values ('7'::jsonb, 'package+stripe_seat_cap'::text, 'active'::text, true) $$,
  'seat case 102 preserves seven purchased seats after payment despite the older paused snapshot');
select results_eq($$ select s.billing_state, s.provider_status, s.provider_event_id, a.provider_event_id
  from public.billing_subscriptions s join public.billing_accounts a on a.id = s.billing_account_id
  where s.organization_id = 'eaff0000-0000-4000-8000-000000000102' $$,
  $$ values ('suspended'::text, 'paused'::text, 'evt_portalSeat102Restrictive'::text, 'evt_portalSeat102Paid'::text) $$,
  'seat case 102 retains independent subscription and payment chronology');
select is(public.has_effective_entitlement('eaff0000-0000-4000-8000-000000000102', 'limits.learners', 8, clock_timestamp()), false,
  'seat case 102 cannot use an eighth seat through the quantity-aware entitlement consumer');

select ok((select was_applied from pg_temp.portal_seat_event('evt_portalSeat103Initial', 1, 'eaff0000-0000-4000-8000-000000000103')),
  'seat case 103 begins with an authoritative mapped seven-seat subscription');
select results_eq($$ select entitlement_value, entitlement_source, billing_state, is_entitled
  from public.get_effective_entitlements('eaff0000-0000-4000-8000-000000000103', clock_timestamp()) where feature_key = 'limits.learners' $$,
  $$ values ('7'::jsonb, 'package+stripe_seat_cap'::text, 'active'::text, true) $$,
  'seat case 103 initially caps its hundred-seat package at seven purchased seats');
select ok((select was_applied from pg_temp.portal_seat_event('evt_portalSeat103Restrictive', 10, 'eaff0000-0000-4000-8000-000000000103', 'unpaid', false)),
  'seat case 103 accepts the older unpaid snapshot while retaining validated item history');
select ok((select was_applied from pg_temp.portal_invoice('evt_portalSeat103Paid', 'eaff0000-0000-4000-8000-000000000103',
  p_event_type => 'invoice.paid', p_sequence => 40)), 'seat case 103 accepts its newer successful invoice');
select results_eq($$ select entitlement_value, entitlement_source, billing_state, is_entitled
  from public.get_effective_entitlements('eaff0000-0000-4000-8000-000000000103', clock_timestamp()) where feature_key = 'limits.learners' $$,
  $$ values ('7'::jsonb, 'package+stripe_seat_cap'::text, 'active'::text, true) $$,
  'seat case 103 preserves seven purchased seats after payment despite the older unpaid snapshot');
select results_eq($$ select s.billing_state, s.provider_status, s.provider_event_id, a.provider_event_id
  from public.billing_subscriptions s join public.billing_accounts a on a.id = s.billing_account_id
  where s.organization_id = 'eaff0000-0000-4000-8000-000000000103' $$,
  $$ values ('past_due'::text, 'unpaid'::text, 'evt_portalSeat103Restrictive'::text, 'evt_portalSeat103Paid'::text) $$,
  'seat case 103 retains independent subscription and payment chronology');
select is(public.has_effective_entitlement('eaff0000-0000-4000-8000-000000000103', 'limits.learners', 8, clock_timestamp()), false,
  'seat case 103 cannot use an eighth seat through the quantity-aware entitlement consumer');

select ok((select was_applied from pg_temp.portal_seat_event('evt_portalSeat104Initial', 1, 'eaff0000-0000-4000-8000-000000000104')),
  'seat case 104 begins with an authoritative mapped seven-seat subscription');
select results_eq($$ select entitlement_value, entitlement_source, billing_state, is_entitled
  from public.get_effective_entitlements('eaff0000-0000-4000-8000-000000000104', clock_timestamp()) where feature_key = 'limits.learners' $$,
  $$ values ('7'::jsonb, 'package+stripe_seat_cap'::text, 'active'::text, true) $$,
  'seat case 104 initially caps its hundred-seat package at seven purchased seats');
select ok((select was_applied from pg_temp.portal_seat_event('evt_portalSeat104Restrictive', 10, 'eaff0000-0000-4000-8000-000000000104', 'paused', false)),
  'seat case 104 accepts the older paused snapshot while retaining validated item history');
select ok((select was_applied from pg_temp.portal_invoice('evt_portalSeat104Paid', 'eaff0000-0000-4000-8000-000000000104',
  p_event_type => 'invoice.payment_succeeded', p_sequence => 40)), 'seat case 104 accepts its newer successful invoice');
select results_eq($$ select entitlement_value, entitlement_source, billing_state, is_entitled
  from public.get_effective_entitlements('eaff0000-0000-4000-8000-000000000104', clock_timestamp()) where feature_key = 'limits.learners' $$,
  $$ values ('7'::jsonb, 'package+stripe_seat_cap'::text, 'active'::text, true) $$,
  'seat case 104 preserves seven purchased seats after payment despite the older paused snapshot');
select results_eq($$ select s.billing_state, s.provider_status, s.provider_event_id, a.provider_event_id
  from public.billing_subscriptions s join public.billing_accounts a on a.id = s.billing_account_id
  where s.organization_id = 'eaff0000-0000-4000-8000-000000000104' $$,
  $$ values ('suspended'::text, 'paused'::text, 'evt_portalSeat104Restrictive'::text, 'evt_portalSeat104Paid'::text) $$,
  'seat case 104 retains independent subscription and payment chronology');
select is(public.has_effective_entitlement('eaff0000-0000-4000-8000-000000000104', 'limits.learners', 8, clock_timestamp()), false,
  'seat case 104 cannot use an eighth seat through the quantity-aware entitlement consumer');

select ok((select was_applied from pg_temp.portal_invoice('evt_portalSeatGraceFailed', 'eaff0000-0000-4000-8000-000000000104',
  p_event_type => 'invoice.payment_failed', p_sequence => 50)), 'a newer seat-plan payment failure starts its ordinary grace period');
select results_eq($$ select entitlement_value, entitlement_source, billing_state, is_entitled
  from public.get_effective_entitlements('eaff0000-0000-4000-8000-000000000104', clock_timestamp()) where feature_key = 'limits.learners' $$,
  $$ values ('7'::jsonb, 'package+stripe_seat_cap'::text, 'grace'::text, true) $$,
  'grace preserves the seven-seat cap despite the older paused snapshot');
select is(public.has_effective_entitlement('eaff0000-0000-4000-8000-000000000104', 'limits.learners', 8, clock_timestamp()), false,
  'grace does not provide unpurchased seats');
select results_eq($$ select entitlement_value, billing_state, is_entitled
  from public.get_effective_entitlements('eaff0000-0000-4000-8000-000000000104', clock_timestamp() + interval '8 days')
  where feature_key = 'limits.learners' $$,
  $$ values ('7'::jsonb, 'past_due'::text, false) $$,
  'keeping the purchased seat cap cannot extend access beyond the original grace deadline');
select results_eq($$ select provider_event_id, grace_ends_at from public.billing_accounts
  where organization_id = 'eaff0000-0000-4000-8000-000000000104' $$,
  $$ values ('evt_portalSeatGraceFailed'::text, date_trunc('second', now()) - interval '10 seconds' + interval '7 days') $$,
  'seat entitlement reads preserve the original failure receipt and grace clock');

select ok((select was_applied from pg_temp.portal_seat_event('evt_portalSeat101Terminal', 60, 'eaff0000-0000-4000-8000-000000000101', 'canceled', false,
  'customer.subscription.deleted')), 'newer canceled evidence still ends the legacy seat subscription');
select is(public.has_effective_entitlement('eaff0000-0000-4000-8000-000000000101', 'limits.learners', 1, clock_timestamp()), false,
  'a terminated seat subscription provides no quantity entitlement');
select ok((select was_applied from pg_temp.portal_invoice('evt_portalSeat101AfterTerminalPaid', 'eaff0000-0000-4000-8000-000000000101', p_sequence => 62)),
  'a successful invoice received after canceled remains durable without promoting access');
select results_eq($$ select entitlement_value, entitlement_source, billing_state, is_entitled
  from public.get_effective_entitlements('eaff0000-0000-4000-8000-000000000101', clock_timestamp()) where feature_key = 'limits.learners' $$,
  $$ values ('100'::jsonb, 'package'::text, 'canceled'::text, false) $$,
  'terminal evidence excludes its retained seat items and prevents later payment from restoring access');

select ok((select was_applied from pg_temp.portal_seat_event('evt_portalSeat102Terminal', 60, 'eaff0000-0000-4000-8000-000000000102', 'incomplete_expired', false,
  'customer.subscription.updated')), 'newer incomplete_expired evidence still ends the legacy seat subscription');
select is(public.has_effective_entitlement('eaff0000-0000-4000-8000-000000000102', 'limits.learners', 1, clock_timestamp()), false,
  'a terminated seat subscription provides no quantity entitlement');
select ok((select was_applied from pg_temp.portal_invoice('evt_portalSeat102AfterTerminalPaid', 'eaff0000-0000-4000-8000-000000000102', p_sequence => 62)),
  'a successful invoice received after incomplete_expired remains durable without promoting access');
select results_eq($$ select entitlement_value, entitlement_source, billing_state, is_entitled
  from public.get_effective_entitlements('eaff0000-0000-4000-8000-000000000102', clock_timestamp()) where feature_key = 'limits.learners' $$,
  $$ values ('100'::jsonb, 'package'::text, 'canceled'::text, false) $$,
  'terminal evidence excludes its retained seat items and prevents later payment from restoring access');


-- A first terminal snapshot must revoke provisional tiers even while comped.

reset role;
insert into public.organizations (id, name, slug, subscription_status, package_id)
values ('ea000000-0000-4000-8000-000000000037', 'Portal terminal comp 37', 'portal-terminal-comp-37', 'trial', 'ea000000-0000-4000-8000-000000000001');
update public.billing_accounts set billing_state = 'comped', state_source = 'manual_comp', comped_until = now() + interval '1 day'
where organization_id = 'ea000000-0000-4000-8000-000000000037';
set local role service_role;
select ok((select was_applied from pg_temp.portal_checkout('evt_portalTerminalComp37Checkout', 'ea000000-0000-4000-8000-000000000037', 'ea000000-0000-4000-8000-000000000002')),
  'terminal comp 37 starts with provisional higher Checkout');

select ok((select was_applied from pg_temp.portal_event('evt_portalTerminalComp37Ended', 30, array['price_unrecognized'],
  p_org => 'ea000000-0000-4000-8000-000000000037', p_status => 'canceled', p_event_type => 'customer.subscription.deleted')),
  'first terminal canceled snapshot still applies to the provisional subscription');
select results_eq($$ select o.package_id, a.billing_state, a.state_source, a.comped_until from public.organizations o
  join public.billing_accounts a on a.organization_id = o.id where o.id = 'ea000000-0000-4000-8000-000000000037' $$,
  $$ values ('ea000000-0000-4000-8000-000000000001'::uuid, 'comped'::text, 'manual_comp'::text, now() + interval '1 day') $$,
  'terminal comp 37 retains only original trustworthy provenance and the independent comp');
select results_eq($$ select package_id, provider_status, billing_state, is_provider_placeholder from public.billing_subscriptions
  where organization_id = 'ea000000-0000-4000-8000-000000000037' $$,
  $$ values ('ea000000-0000-4000-8000-000000000001'::uuid, 'canceled'::text, 'canceled'::text, false) $$,
  'terminal comp 37 does not turn provisional pricing into validated subscription history');
select is((select is_entitled from public.get_effective_entitlements('ea000000-0000-4000-8000-000000000037', clock_timestamp()) where feature_key = 'portal.care_access'),
  false, 'terminal comp 37 no longer grants the canceled Checkout higher tier');
select ok((select was_applied from pg_temp.portal_invoice('evt_portalTerminalComp37LaterPaid', 'ea000000-0000-4000-8000-000000000037', p_sequence => 40)),
  'terminal comp 37 still records a later invoice');
select is((select is_entitled from public.get_effective_entitlements('ea000000-0000-4000-8000-000000000037', clock_timestamp()) where feature_key = 'portal.care_access'),
  false, 'a paid invoice cannot reopen terminal comp 37 unvalidated tier');

select results_eq($$ select entitlement_value, is_entitled from public.get_effective_entitlements('ea000000-0000-4000-8000-000000000037', clock_timestamp())
  where feature_key = 'limits.learners' $$,
  $$ values ('10'::jsonb, true) $$, 'terminal comp 37 keeps the original lower allowance available');

reset role;
insert into public.organizations (id, name, slug, subscription_status, package_id)
values ('ea000000-0000-4000-8000-000000000038', 'Portal terminal comp 38', 'portal-terminal-comp-38', 'trial', 'ea000000-0000-4000-8000-000000000001');
update public.billing_accounts set billing_state = 'comped', state_source = 'manual_comp', comped_until = now() + interval '1 day'
where organization_id = 'ea000000-0000-4000-8000-000000000038';
set local role service_role;
select ok((select was_applied from pg_temp.portal_checkout('evt_portalTerminalComp38Checkout', 'ea000000-0000-4000-8000-000000000038', 'ea000000-0000-4000-8000-000000000002')),
  'terminal comp 38 starts with provisional higher Checkout');

select ok((select was_applied from pg_temp.portal_event('evt_portalTerminalComp38Ended', 30, array['price_unrecognized'],
  p_org => 'ea000000-0000-4000-8000-000000000038', p_status => 'incomplete_expired', p_event_type => 'customer.subscription.deleted')),
  'first terminal incomplete_expired snapshot still applies to the provisional subscription');
select results_eq($$ select o.package_id, a.billing_state, a.state_source, a.comped_until from public.organizations o
  join public.billing_accounts a on a.organization_id = o.id where o.id = 'ea000000-0000-4000-8000-000000000038' $$,
  $$ values ('ea000000-0000-4000-8000-000000000001'::uuid, 'comped'::text, 'manual_comp'::text, now() + interval '1 day') $$,
  'terminal comp 38 retains only original trustworthy provenance and the independent comp');
select results_eq($$ select package_id, provider_status, billing_state, is_provider_placeholder from public.billing_subscriptions
  where organization_id = 'ea000000-0000-4000-8000-000000000038' $$,
  $$ values ('ea000000-0000-4000-8000-000000000001'::uuid, 'incomplete_expired'::text, 'canceled'::text, false) $$,
  'terminal comp 38 does not turn provisional pricing into validated subscription history');
select is((select is_entitled from public.get_effective_entitlements('ea000000-0000-4000-8000-000000000038', clock_timestamp()) where feature_key = 'portal.care_access'),
  false, 'terminal comp 38 no longer grants the canceled Checkout higher tier');
select ok((select was_applied from pg_temp.portal_invoice('evt_portalTerminalComp38LaterPaid', 'ea000000-0000-4000-8000-000000000038', p_sequence => 40)),
  'terminal comp 38 still records a later invoice');
select is((select is_entitled from public.get_effective_entitlements('ea000000-0000-4000-8000-000000000038', clock_timestamp()) where feature_key = 'portal.care_access'),
  false, 'a paid invoice cannot reopen terminal comp 38 unvalidated tier');

select results_eq($$ select entitlement_value, is_entitled from public.get_effective_entitlements('ea000000-0000-4000-8000-000000000038', clock_timestamp())
  where feature_key = 'limits.learners' $$,
  $$ values ('10'::jsonb, true) $$, 'terminal comp 38 keeps the original lower allowance available');

reset role;
insert into public.organizations (id, name, slug, subscription_status, package_id)
values ('ea000000-0000-4000-8000-000000000039', 'Portal terminal comp 39', 'portal-terminal-comp-39', 'trial', 'ea000000-0000-4000-8000-000000000001');
update public.billing_accounts set billing_state = 'comped', state_source = 'manual_comp', comped_until = null::timestamptz
where organization_id = 'ea000000-0000-4000-8000-000000000039';
set local role service_role;
select ok((select was_applied from pg_temp.portal_checkout('evt_portalTerminalComp39Checkout', 'ea000000-0000-4000-8000-000000000039', 'ea000000-0000-4000-8000-000000000002')),
  'terminal comp 39 starts with provisional higher Checkout');
reset role;
update public.billing_subscriptions set checkout_previous_package_id = null where organization_id = 'ea000000-0000-4000-8000-000000000039';
set local role service_role;

select ok((select was_applied from pg_temp.portal_event('evt_portalTerminalComp39Ended', 30, array['price_unrecognized'],
  p_org => 'ea000000-0000-4000-8000-000000000039', p_status => 'canceled', p_event_type => 'customer.subscription.deleted')),
  'first terminal canceled snapshot still applies to the provisional subscription');
select results_eq($$ select o.package_id, a.billing_state, a.state_source, a.comped_until from public.organizations o
  join public.billing_accounts a on a.organization_id = o.id where o.id = 'ea000000-0000-4000-8000-000000000039' $$,
  $$ values (null::uuid, 'comped'::text, 'manual_comp'::text, null::timestamptz) $$,
  'terminal comp 39 retains only original trustworthy provenance and the independent comp');
select results_eq($$ select package_id, provider_status, billing_state, is_provider_placeholder from public.billing_subscriptions
  where organization_id = 'ea000000-0000-4000-8000-000000000039' $$,
  $$ values (null::uuid, 'canceled'::text, 'canceled'::text, false) $$,
  'terminal comp 39 does not turn provisional pricing into validated subscription history');
select is((select is_entitled from public.get_effective_entitlements('ea000000-0000-4000-8000-000000000039', clock_timestamp()) where feature_key = 'portal.care_access'),
  false, 'terminal comp 39 no longer grants the canceled Checkout higher tier');
select ok((select was_applied from pg_temp.portal_invoice('evt_portalTerminalComp39LaterPaid', 'ea000000-0000-4000-8000-000000000039', p_sequence => 40)),
  'terminal comp 39 still records a later invoice');
select is((select is_entitled from public.get_effective_entitlements('ea000000-0000-4000-8000-000000000039', clock_timestamp()) where feature_key = 'portal.care_access'),
  false, 'a paid invoice cannot reopen terminal comp 39 unvalidated tier');


-- A terminal provisional subscription must not undo a different subscription
-- that legitimately validated a higher package after the provisional Checkout.
reset role;
insert into public.organizations (id, name, slug, subscription_status, package_id)
values ('ea000000-0000-4000-8000-000000000040', 'Portal terminal sibling org', 'portal-terminal-sibling-org', 'trial', 'ea000000-0000-4000-8000-000000000001');
update public.billing_accounts set billing_state = 'comped', state_source = 'manual_comp', comped_until = now() + interval '1 day'
where organization_id = 'ea000000-0000-4000-8000-000000000040';
set local role service_role;
select ok((select was_applied from pg_temp.portal_checkout('evt_portalTerminalSiblingCheckoutB', 'ea000000-0000-4000-8000-000000000040',
  'ea000000-0000-4000-8000-000000000002', 'Second')), 'terminal sibling B starts with Checkout provenance from the lower comp');
select ok((select was_applied from pg_temp.portal_event('evt_portalTerminalSiblingValidA', 40, array['price_portalCareMonth'],
  p_org => 'ea000000-0000-4000-8000-000000000040')), 'another subscription A then validates the higher package');
select ok((select was_applied from pg_temp.portal_event('evt_portalTerminalSiblingCanceledB', 30, array['price_unrecognized'],
  p_org => 'ea000000-0000-4000-8000-000000000040', p_subscription_suffix => 'Second', p_status => 'canceled')),
  'the provisional B cancellation is delivered after newer A validation');
select results_eq($$ select o.package_id, a.billing_state, a.provider_state, a.provider_event_id, a.comped_until
  from public.organizations o join public.billing_accounts a on a.organization_id = o.id
  where o.id = 'ea000000-0000-4000-8000-000000000040' $$,
  $$ values ('ea000000-0000-4000-8000-000000000002'::uuid, 'comped'::text, 'active'::text,
             'evt_portalTerminalSiblingValidA'::text, now() + interval '1 day') $$,
  'B termination preserves the current validated A package, newer provider evidence, and independent comp');
select is((select is_entitled from public.get_effective_entitlements('ea000000-0000-4000-8000-000000000040', clock_timestamp())
  where feature_key = 'portal.care_access'), true, 'the legitimate higher subscription remains usable after provisional sibling cancellation');


-- The private survivor helper distinguishes no row from a valid legacy NULL
-- package and remains callable only inside the trusted processor context.
reset role;
insert into public.organizations (id, name, slug, subscription_status, package_id)
values ('eaff0000-0000-4000-8000-000000000206', 'Portal null survivor package', 'portal-null-survivor-package', 'trial', null);
set local role service_role;
select ok((select was_applied from pg_temp.portal_event('evt_portalNullSurvivorPackage', 1, array['price_legacyUnmapped'],
  p_metadata_package => null, p_org => 'eaff0000-0000-4000-8000-000000000206')),
  'a legitimate legacy subscription can have an authoritative NULL package');
reset role;
select results_eq($$ select package_id from app_private.stripe_surviving_subscription_package(
  'eaff0000-0000-4000-8000-000000000206', (select id from public.billing_accounts
    where organization_id = 'eaff0000-0000-4000-8000-000000000206'), null) $$,
  $$ values (null::uuid) $$, 'a surviving NULL-package subscription produces a row, distinct from no survivor');
select ok(not has_function_privilege('anon', 'app_private.stripe_surviving_subscription_package(uuid,uuid,text)', 'execute')
  and not has_function_privilege('authenticated', 'app_private.stripe_surviving_subscription_package(uuid,uuid,text)', 'execute')
  and not has_function_privilege('service_role', 'app_private.stripe_surviving_subscription_package(uuid,uuid,text)', 'execute'),
  'the private survivor helper grants no direct caller access');
set local role service_role;

reset role;
insert into public.organizations (id, name, slug, subscription_status, package_id)
values
  ('eaff0000-0000-4000-8000-000000000201', 'Expired survivor trial', 'portal-expired-survivor-trial', 'trial', 'ea000000-0000-4000-8000-000000000001'),
  ('eaff0000-0000-4000-8000-000000000202', 'Expired survivor period', 'portal-expired-survivor-period', 'trial', 'ea000000-0000-4000-8000-000000000001'),
  ('eaff0000-0000-4000-8000-000000000203', 'Expired survivor invoice grace', 'portal-expired-survivor-invoice-grace', 'trial', 'ea000000-0000-4000-8000-000000000001'),
  ('eaff0000-0000-4000-8000-000000000204', 'Current survivor invoice grace', 'portal-current-survivor-invoice-grace', 'trial', 'ea000000-0000-4000-8000-000000000001'),
  ('eaff0000-0000-4000-8000-000000000205', 'Sibling survivor invoice history', 'portal-sibling-survivor-invoice-history', 'trial', 'ea000000-0000-4000-8000-000000000001');
create function pg_temp.portal_expiry_event(
  p_event text, p_sequence integer, p_org uuid, p_status text,
  p_period_end timestamptz, p_trial_end timestamptz default null, p_suffix text default ''
)
returns table (was_duplicate boolean, was_applied boolean, was_stale boolean,
               resolved_organization_id uuid, canonical_state text)
language sql set search_path = ''
as $fixture$
  select * from public.process_stripe_billing_event(
    p_event, 'customer.subscription.updated', date_trunc('second', now()) - interval '1 minute' + p_sequence * interval '1 second',
    jsonb_build_object('data', jsonb_build_object('object', jsonb_build_object(
      'id', 'sub_portal' || replace(p_org::text, '-', '') || p_suffix,
      'customer', 'cus_portal' || replace(p_org::text, '-', ''),
      'status', p_status, 'trial_end', extract(epoch from p_trial_end)::bigint,
      'metadata', jsonb_build_object('organization_id', p_org, 'package_id', 'ea000000-0000-4000-8000-000000000002'),
      'items', jsonb_build_object('has_more', false, 'data', jsonb_build_array(jsonb_build_object(
        'id', 'si_portal' || replace(p_org::text, '-', '') || p_suffix || '1', 'quantity', 1,
        'current_period_start', extract(epoch from now() - interval '10 days')::bigint,
        'current_period_end', extract(epoch from p_period_end)::bigint,
        'price', jsonb_build_object('id', 'price_portalCareMonth')
      )))
    ))), md5(p_event) || md5(p_event), p_event
  );
$fixture$;
set local role service_role;

select ok((select was_applied from pg_temp.portal_expiry_event('evt_portalSurvivor201Historical', 1, 'eaff0000-0000-4000-8000-000000000201', 'trialing',
  now() + interval '1 year', now() - interval '1 day')), 'survivor case 201 has authoritative historical CareBase subscription state');
reset role;
-- The operator independently selected a lower, still-current manual comp.
update public.organizations set package_id = 'ea000000-0000-4000-8000-000000000001' where id = 'eaff0000-0000-4000-8000-000000000201';
update public.billing_accounts set billing_state = 'comped', state_source = 'manual_comp', comped_until = now() + interval '1 day'
where organization_id = 'eaff0000-0000-4000-8000-000000000201';
set local role service_role;
select ok((select was_applied from pg_temp.portal_checkout('evt_portalSurvivor201Checkout', 'eaff0000-0000-4000-8000-000000000201',
  'ea000000-0000-4000-8000-000000000002', 'Second')), 'survivor case 201 receives a new provisional higher Checkout');
select ok(not (select was_applied from pg_temp.portal_event('evt_portalSurvivor201Rejected', 57, array['price_unrecognized'],
  p_org => 'eaff0000-0000-4000-8000-000000000201', p_subscription_suffix => 'Second')), 'survivor case 201 rejects the unvalidated second plan');
select results_eq($$ select o.package_id, a.billing_state, a.state_source, a.comped_until from public.organizations o
  join public.billing_accounts a on a.organization_id = o.id where o.id = 'eaff0000-0000-4000-8000-000000000201' $$,
  $$ values ('ea000000-0000-4000-8000-000000000001'::uuid, 'comped'::text, 'manual_comp'::text, now() + interval '1 day') $$,
  'survivor case 201 keeps the independent lower comp instead of restoring expired higher billing history');
select is((select is_entitled from public.get_effective_entitlements('eaff0000-0000-4000-8000-000000000201', clock_timestamp())
  where feature_key = 'portal.care_access'), false, 'survivor case 201 cannot regain CareBase through expired history');
select results_eq($$ select provider_status, provider_event_id, package_id from public.billing_subscriptions
  where stripe_subscription_id = 'sub_portaleaff0000000040008000000000000201' $$,
  $$ values ('trialing'::text, 'evt_portalSurvivor201Historical'::text, 'ea000000-0000-4000-8000-000000000002'::uuid) $$,
  'survivor case 201 preserves historical provider evidence without using it as a current grant');

select ok((select was_applied from pg_temp.portal_expiry_event('evt_portalSurvivor202Historical', 1, 'eaff0000-0000-4000-8000-000000000202', 'active',
  now() - interval '1 day', null)), 'survivor case 202 has authoritative historical CareBase subscription state');
reset role;
-- The operator independently selected a lower, still-current manual comp.
update public.organizations set package_id = 'ea000000-0000-4000-8000-000000000001' where id = 'eaff0000-0000-4000-8000-000000000202';
update public.billing_accounts set billing_state = 'comped', state_source = 'manual_comp', comped_until = now() + interval '1 day'
where organization_id = 'eaff0000-0000-4000-8000-000000000202';
set local role service_role;
select ok((select was_applied from pg_temp.portal_checkout('evt_portalSurvivor202Checkout', 'eaff0000-0000-4000-8000-000000000202',
  'ea000000-0000-4000-8000-000000000002', 'Second')), 'survivor case 202 receives a new provisional higher Checkout');
select ok(not (select was_applied from pg_temp.portal_event('evt_portalSurvivor202Rejected', 57, array['price_unrecognized'],
  p_org => 'eaff0000-0000-4000-8000-000000000202', p_subscription_suffix => 'Second')), 'survivor case 202 rejects the unvalidated second plan');
select results_eq($$ select o.package_id, a.billing_state, a.state_source, a.comped_until from public.organizations o
  join public.billing_accounts a on a.organization_id = o.id where o.id = 'eaff0000-0000-4000-8000-000000000202' $$,
  $$ values ('ea000000-0000-4000-8000-000000000001'::uuid, 'comped'::text, 'manual_comp'::text, now() + interval '1 day') $$,
  'survivor case 202 keeps the independent lower comp instead of restoring expired higher billing history');
select is((select is_entitled from public.get_effective_entitlements('eaff0000-0000-4000-8000-000000000202', clock_timestamp())
  where feature_key = 'portal.care_access'), false, 'survivor case 202 cannot regain CareBase through expired history');
select results_eq($$ select provider_status, provider_event_id, package_id from public.billing_subscriptions
  where stripe_subscription_id = 'sub_portaleaff0000000040008000000000000202' $$,
  $$ values ('active'::text, 'evt_portalSurvivor202Historical'::text, 'ea000000-0000-4000-8000-000000000002'::uuid) $$,
  'survivor case 202 preserves historical provider evidence without using it as a current grant');

select ok((select was_applied from pg_temp.portal_expiry_event('evt_portalSurvivor203Historical', -777600, 'eaff0000-0000-4000-8000-000000000203', 'active',
  now() + interval '1 year', null)), 'survivor case 203 has authoritative historical CareBase subscription state');
select ok((select was_applied from pg_temp.portal_invoice('evt_portalSurvivor203ExpiredFailure', 'eaff0000-0000-4000-8000-000000000203',
  p_event_type => 'invoice.payment_failed', p_sequence => -691200)), 'a newer historical failure has an already expired grace deadline');
reset role;
-- The operator independently selected a lower, still-current manual comp.
update public.organizations set package_id = 'ea000000-0000-4000-8000-000000000001' where id = 'eaff0000-0000-4000-8000-000000000203';
update public.billing_accounts set billing_state = 'comped', state_source = 'manual_comp', comped_until = now() + interval '1 day'
where organization_id = 'eaff0000-0000-4000-8000-000000000203';
set local role service_role;
select ok((select was_applied from pg_temp.portal_checkout('evt_portalSurvivor203Checkout', 'eaff0000-0000-4000-8000-000000000203',
  'ea000000-0000-4000-8000-000000000002', 'Second')), 'survivor case 203 receives a new provisional higher Checkout');
select ok(not (select was_applied from pg_temp.portal_event('evt_portalSurvivor203Rejected', 57, array['price_unrecognized'],
  p_org => 'eaff0000-0000-4000-8000-000000000203', p_subscription_suffix => 'Second')), 'survivor case 203 rejects the unvalidated second plan');
select results_eq($$ select o.package_id, a.billing_state, a.state_source, a.comped_until from public.organizations o
  join public.billing_accounts a on a.organization_id = o.id where o.id = 'eaff0000-0000-4000-8000-000000000203' $$,
  $$ values ('ea000000-0000-4000-8000-000000000001'::uuid, 'comped'::text, 'manual_comp'::text, now() + interval '1 day') $$,
  'survivor case 203 keeps the independent lower comp instead of restoring expired higher billing history');
select is((select is_entitled from public.get_effective_entitlements('eaff0000-0000-4000-8000-000000000203', clock_timestamp())
  where feature_key = 'portal.care_access'), false, 'survivor case 203 cannot regain CareBase through expired history');
select results_eq($$ select provider_status, provider_event_id, package_id from public.billing_subscriptions
  where stripe_subscription_id = 'sub_portaleaff0000000040008000000000000203' $$,
  $$ values ('active'::text, 'evt_portalSurvivor203Historical'::text, 'ea000000-0000-4000-8000-000000000002'::uuid) $$,
  'survivor case 203 preserves historical provider evidence without using it as a current grant');

-- A current failure grants the existing seven-day grace even if the previous
-- paid period ended. Its newer evidence must take precedence over period expiry.
select ok((select was_applied from pg_temp.portal_expiry_event('evt_portalSurvivor204Historical', -172800,
  'eaff0000-0000-4000-8000-000000000204', 'active', now() - interval '1 day')),
  'current-grace survivor has a historical paid period that has ended');
select ok((select was_applied from pg_temp.portal_invoice('evt_portalSurvivor204CurrentFailure',
  'eaff0000-0000-4000-8000-000000000204', p_event_type => 'invoice.payment_failed', p_sequence => 50)),
  'a newer invoice failure starts the original current grace deadline');
select ok((select was_applied from pg_temp.portal_checkout('evt_portalSurvivor204Checkout',
  'eaff0000-0000-4000-8000-000000000204', 'ea000000-0000-4000-8000-000000000001', 'Second')),
  'a second Checkout provisionally stamps another tier during current invoice grace');
select ok(not (select was_applied from pg_temp.portal_event('evt_portalSurvivor204Rejected', 57, array['price_unrecognized'],
  p_org => 'eaff0000-0000-4000-8000-000000000204', p_subscription_suffix => 'Second')),
  'the second plan is rejected without ending the valid first plan current grace');
select results_eq($$ select o.package_id, a.billing_state, a.provider_event_id, a.grace_ends_at from public.organizations o
  join public.billing_accounts a on a.organization_id = o.id where o.id = 'eaff0000-0000-4000-8000-000000000204' $$,
  $$ values ('ea000000-0000-4000-8000-000000000002'::uuid, 'grace'::text, 'evt_portalSurvivor204CurrentFailure'::text,
             date_trunc('second', now()) - interval '10 seconds' + interval '7 days') $$,
  'the current invoice grace survives the ended paid period and keeps its original package and deadline');
select is((select is_entitled from public.get_effective_entitlements('eaff0000-0000-4000-8000-000000000204', clock_timestamp())
  where feature_key = 'portal.care_access'), true, 'current first-plan invoice grace keeps CareBase usable');
select is((select is_entitled from public.get_effective_entitlements('eaff0000-0000-4000-8000-000000000204', clock_timestamp() + interval '8 days')
  where feature_key = 'portal.care_access'), false, 'preserving a current grace survivor never extends its original expiry');

-- A sibling receipt can occupy the account pointer without erasing the first
-- subscription's own newer expired failure. Evaluate each history separately.
select ok((select was_applied from pg_temp.portal_expiry_event('evt_portalSurvivor205First', -777600,
  'eaff0000-0000-4000-8000-000000000205', 'active', now() + interval '1 year')),
  'the sibling case starts with an old active higher subscription');
select ok((select was_applied from pg_temp.portal_invoice('evt_portalSurvivor205FirstFailed',
  'eaff0000-0000-4000-8000-000000000205', p_event_type => 'invoice.payment_failed', p_sequence => -691200)),
  'the first subscription has newer failure evidence whose grace expired');
select ok((select was_applied from pg_temp.portal_expiry_event('evt_portalSurvivor205Second', -604800,
  'eaff0000-0000-4000-8000-000000000205', 'active', now() - interval '1 day', p_suffix => 'Second')),
  'a sibling subscription also has historical higher pricing and an expired paid period');
select ok((select was_applied from pg_temp.portal_invoice('evt_portalSurvivor205SecondPaid',
  'eaff0000-0000-4000-8000-000000000205', p_subscription_suffix => 'Second', p_sequence => -518400)),
  'the sibling successful invoice now occupies the account pointer');
reset role;
update public.organizations set package_id = 'ea000000-0000-4000-8000-000000000001'
where id = 'eaff0000-0000-4000-8000-000000000205';
update public.billing_accounts set billing_state = 'comped', state_source = 'manual_comp', comped_until = now() + interval '1 day'
where organization_id = 'eaff0000-0000-4000-8000-000000000205';
set local role service_role;
select ok((select was_applied from pg_temp.portal_checkout('evt_portalSurvivor205Checkout',
  'eaff0000-0000-4000-8000-000000000205', 'ea000000-0000-4000-8000-000000000002', 'Third')),
  'a third Checkout provisionally claims the higher tier during the independent lower comp');
select ok(not (select was_applied from pg_temp.portal_event('evt_portalSurvivor205Rejected', 57, array['price_unrecognized'],
  p_org => 'eaff0000-0000-4000-8000-000000000205', p_subscription_suffix => 'Third')),
  'invalid third-plan pricing is rejected');
select results_eq($$ select o.package_id, a.billing_state, a.state_source, a.comped_until, a.provider_event_id
  from public.organizations o join public.billing_accounts a on a.organization_id = o.id
  where o.id = 'eaff0000-0000-4000-8000-000000000205' $$,
  $$ values ('ea000000-0000-4000-8000-000000000001'::uuid, 'comped'::text, 'manual_comp'::text,
             now() + interval '1 day', 'evt_portalSurvivor205SecondPaid'::text) $$,
  'a current sibling invoice pointer cannot hide the first subscription expired failure or the sibling expired period');
select is((select is_entitled from public.get_effective_entitlements('eaff0000-0000-4000-8000-000000000205', clock_timestamp())
  where feature_key = 'portal.care_access'), false, 'neither expired subscription can overwrite the independent lower comp');

-- A distinct updated/deleted terminal pair for B may
-- arrive around later valid sibling state and an independent operator comp.
select ok((select was_applied from pg_temp.portal_event('evt_portalTerminalSiblingEndedA', 50, array['price_unrecognized'],
  p_org => 'ea000000-0000-4000-8000-000000000040', p_status => 'canceled', p_event_type => 'customer.subscription.deleted')),
  'the legitimate sibling A can subsequently end after B first terminated');
reset role;
update public.organizations set package_id = 'ea000000-0000-4000-8000-000000000001'
where id = 'ea000000-0000-4000-8000-000000000040';
update public.billing_accounts set billing_state = 'comped', state_source = 'manual_comp', comped_until = now() + interval '1 day'
where organization_id = 'ea000000-0000-4000-8000-000000000040';
set local role service_role;
select ok((select was_applied from pg_temp.portal_event('evt_portalTerminalSiblingDeletedBAgain', 30, array['price_unrecognized'],
  p_org => 'ea000000-0000-4000-8000-000000000040', p_subscription_suffix => 'Second',
  p_status => 'canceled', p_event_type => 'customer.subscription.deleted')),
  'a distinct delayed B terminal receipt is accepted by its own receipt ordering');
select results_eq($$ select o.package_id, a.billing_state, a.state_source, a.provider_event_id, a.comped_until
  from public.organizations o join public.billing_accounts a on a.organization_id = o.id
  where o.id = 'ea000000-0000-4000-8000-000000000040' $$,
  $$ values ('ea000000-0000-4000-8000-000000000001'::uuid, 'comped'::text, 'manual_comp'::text,
             'evt_portalTerminalSiblingEndedA'::text, now() + interval '1 day') $$,
  'a terminal row without authoritative items cannot restamp its earlier copied higher package over the current independent comp');
select is((select is_entitled from public.get_effective_entitlements('ea000000-0000-4000-8000-000000000040', clock_timestamp())
  where feature_key = 'portal.care_access'), false, 'repeated terminal receipts cannot launder copied package history into higher comped access');

-- Retain quantity constraint semantics separately from account access expiry.
reset role;
insert into public.organizations (id, name, slug, subscription_status, package_id)
values ('eaff0000-0000-4000-8000-000000000301', 'Portal sibling seat receipts', 'portal-sibling-seat-receipts', 'trial', 'eaff0000-0000-4000-8000-000000000001');
set local role service_role;
select ok((select was_applied from pg_temp.portal_seat_event('evt_portalSeatSiblingAInitial', 1,
  'eaff0000-0000-4000-8000-000000000301')), 'seat sibling A starts with seven authoritative purchased seats');
select ok((select was_applied from pg_temp.portal_seat_event('evt_portalSeatSiblingAPaused', 10,
  'eaff0000-0000-4000-8000-000000000301', 'paused', false)), 'seat sibling A records restrictive status while retaining its validated items');
select ok((select was_applied from pg_temp.portal_invoice('evt_portalSeatSiblingAPaid',
  'eaff0000-0000-4000-8000-000000000301', p_sequence => 40)), 'newer payment restores access for seat sibling A');
select ok((select was_applied from pg_temp.portal_event('evt_portalSeatSiblingBActive', 50, array['price_portalLegacySeats'],
  p_org => 'eaff0000-0000-4000-8000-000000000301', p_subscription_suffix => 'Second')),
  'seat sibling B supplies one seat and occupies the newer account event pointer');
select results_eq($$ select e.entitlement_value, e.entitlement_source, e.billing_state, e.is_entitled, a.provider_event_id
  from public.get_effective_entitlements('eaff0000-0000-4000-8000-000000000301', clock_timestamp()) e
  join public.billing_accounts a on a.organization_id = 'eaff0000-0000-4000-8000-000000000301'
  where e.feature_key = 'limits.learners' $$,
  $$ values ('7'::jsonb, 'package+stripe_seat_cap'::text, 'active'::text, true, 'evt_portalSeatSiblingBActive'::text) $$,
  'a sibling current account pointer cannot erase A matching newer payment and seven-seat cap');
select ok((select was_applied from pg_temp.portal_invoice('evt_portalSeatSiblingANewerFailure',
  'eaff0000-0000-4000-8000-000000000301', p_event_type => 'invoice.payment_failed', p_sequence => 60)),
  'a later A failure supersedes its earlier successful payment');
select results_eq($$ select e.entitlement_value, e.billing_state, e.is_entitled, a.provider_event_id, a.grace_ends_at
  from public.get_effective_entitlements('eaff0000-0000-4000-8000-000000000301', clock_timestamp()) e
  join public.billing_accounts a on a.organization_id = 'eaff0000-0000-4000-8000-000000000301'
  where e.feature_key = 'limits.learners' $$,
  $$ values ('7'::jsonb, 'grace'::text, true, 'evt_portalSeatSiblingANewerFailure'::text,
             date_trunc('second', now()) + interval '7 days') $$,
  'newest A failure retains its quantity constraint during the original account grace');
select results_eq($$ select entitlement_value, billing_state, is_entitled
  from public.get_effective_entitlements('eaff0000-0000-4000-8000-000000000301', clock_timestamp() + interval '8 days')
  where feature_key = 'limits.learners' $$,
  $$ values ('7'::jsonb, 'past_due'::text, false) $$,
  'older A success cannot override the later failure account expiry while its numerical seat cap remains visible');
select ok((select was_applied from pg_temp.portal_seat_event('evt_portalSeatSiblingANewPause', 70,
  'eaff0000-0000-4000-8000-000000000301', 'paused', false)), 'genuinely newer A pause supersedes both earlier A payment outcomes');
select ok((select was_applied from pg_temp.portal_invoice('evt_portalSeatSiblingBPaid',
  'eaff0000-0000-4000-8000-000000000301', p_subscription_suffix => 'Second', p_sequence => 80)),
  'B newer payment restores account access without validating A older payment history');
select results_eq($$ select e.entitlement_value, e.entitlement_source, e.billing_state, e.is_entitled, a.provider_event_id
  from public.get_effective_entitlements('eaff0000-0000-4000-8000-000000000301', clock_timestamp()) e
  join public.billing_accounts a on a.organization_id = 'eaff0000-0000-4000-8000-000000000301'
  where e.feature_key = 'limits.learners' $$,
  $$ values ('1'::jsonb, 'package+stripe_seat_cap'::text, 'active'::text, true, 'evt_portalSeatSiblingBPaid'::text) $$,
  'only B one seat remains eligible when A subscription status is newer than all A invoices');
select ok((select was_applied from pg_temp.portal_seat_event('evt_portalSeatSiblingATerminal', 90,
  'eaff0000-0000-4000-8000-000000000301', 'canceled', false, 'customer.subscription.deleted')),
  'terminal A evidence is retained after payment and pause history');
select ok((select was_applied from pg_temp.portal_invoice('evt_portalSeatSiblingBPaidAfterTerminal',
  'eaff0000-0000-4000-8000-000000000301', p_subscription_suffix => 'Second', p_sequence => 100)),
  'B can subsequently provide its own account payment evidence');
select results_eq($$ select entitlement_value, entitlement_source, billing_state, is_entitled
  from public.get_effective_entitlements('eaff0000-0000-4000-8000-000000000301', clock_timestamp()) where feature_key = 'limits.learners' $$,
  $$ values ('1'::jsonb, 'package+stripe_seat_cap'::text, 'active'::text, true) $$,
  'retained terminal A item history cannot increase the surviving B seat cap');

select * from finish();
rollback;
