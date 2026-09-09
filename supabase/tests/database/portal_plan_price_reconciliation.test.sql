-- A Portal plan change retains the original subscription metadata. Exercise the
-- real receipt processor and entitlement resolver, including rejected and stale
-- deliveries, rather than updating local package rows as a test substitute.
begin;
select plan(114);

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
                                      p_event_type text default 'invoice.paid')
returns table (was_duplicate boolean, was_applied boolean, was_stale boolean,
               resolved_organization_id uuid, canonical_state text)
language sql set search_path = ''
as $fixture$
  select * from public.process_stripe_billing_event(
    p_event, p_event_type, date_trunc('second', now()) - interval '20 seconds',
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
select is((select count(*)::integer from public.billing_subscriptions where organization_id = 'ea000000-0000-4000-8000-000000000013'),
  0, 'a rejected first subscription does not leave a partial row');

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
  where feature_key = 'portal.care_access'), true, 'an unexpired manual comp still grants its independent access');
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

select * from finish();
rollback;
