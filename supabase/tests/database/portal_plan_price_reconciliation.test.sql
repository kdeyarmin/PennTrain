-- A Portal plan change retains the original subscription metadata. Exercise the
-- real receipt processor and entitlement resolver, including rejected and stale
-- deliveries, rather than updating local package rows as a test substitute.
begin;
select plan(41);

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
  ('ea000000-0000-4000-8000-000000000013', 'Portal first org', 'portal-first-org', 'active', 'ea000000-0000-4000-8000-000000000001');

-- This fixture only builds signed-event-shaped input; production processing and
-- all mutations run through the existing service-role RPC.
create function pg_temp.portal_event(
  p_event text,
  p_sequence integer,
  p_prices text[],
  p_metadata_package uuid default 'ea000000-0000-4000-8000-000000000001',
  p_org uuid default 'ea000000-0000-4000-8000-000000000011',
  p_status text default 'active',
  p_has_more boolean default false
)
returns table (was_duplicate boolean, was_applied boolean, was_stale boolean,
               resolved_organization_id uuid, canonical_state text)
language sql
set search_path = ''
as $fixture$
  select * from public.process_stripe_billing_event(
    p_event, 'customer.subscription.updated',
    '2026-09-09T12:00:00Z'::timestamptz + p_sequence * interval '1 second',
    jsonb_build_object('data', jsonb_build_object('object', jsonb_build_object(
      'id', 'sub_portal' || replace(p_org::text, '-', ''),
      'customer', 'cus_portal' || replace(p_org::text, '-', ''),
      'status', p_status,
      'metadata', jsonb_build_object('organization_id', p_org, 'package_id', p_metadata_package),
      'items', jsonb_build_object('has_more', p_has_more, 'data', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', 'si_portal' || replace(p_org::text, '-', '') || n,
          'quantity', 1,
          'current_period_start', 1788955200,
          'current_period_end', 1820491200,
          'price', jsonb_build_object('id', price)
        ) order by n)
        from unnest(p_prices) with ordinality item(price, n)
      ), '[]'::jsonb))
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
  'evt_portalDelayedCheckout', 'checkout.session.completed', '2026-09-09T12:00:01Z',
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

select * from finish();
rollback;
