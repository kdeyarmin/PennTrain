-- PT-057: poison Stripe events must leave a durable processing_status='failed'
-- receipt with error text and return normally (webhook 200, Stripe stops
-- retrying), while genuinely transient errors keep raising so the whole
-- transaction -- receipt included -- rolls back and Stripe retries cleanly.
begin;
select plan(14);

insert into public.organizations (id, name, slug, subscription_status)
values
  ('32000000-0000-4000-8000-000000000011', 'Dead Letter Org A', 'dead-letter-org-a', 'active'),
  ('32000000-0000-4000-8000-000000000012', 'Dead Letter Org B', 'dead-letter-org-b', 'active');

set local role service_role;

-- Baseline: a well-formed signed subscription event still applies.
select results_eq(
  $$ select was_duplicate, was_applied, was_stale, canonical_state
     from public.process_stripe_billing_event(
       'evt_dl_first', 'customer.subscription.updated',
       '2026-07-24T12:00:00Z'::timestamptz,
       jsonb_build_object('data', jsonb_build_object('object', jsonb_build_object(
         'id', 'sub_dlA', 'customer', 'cus_dlA', 'status', 'active',
         'metadata', jsonb_build_object('organization_id', '32000000-0000-4000-8000-000000000011'),
         'items', jsonb_build_object('data', jsonb_build_array(jsonb_build_object(
           'id', 'si_dlA', 'quantity', 5,
           'current_period_start', 1786449600, 'current_period_end', 1789128000,
           'price', jsonb_build_object('id', 'price_dlA'))))))),
       repeat('1', 64), 'dead-letter-first') $$,
  $$ values (false, true, false, 'active'::text) $$,
  'a well-formed subscription event is still applied'
);
select is(
  (select processing_status from app_private.stripe_billing_events
   where event_id = 'evt_dl_first'),
  'applied',
  'the applied event has an applied receipt'
);

-- Cross-tenant binding: org B claims org A''s Stripe customer. The guard must
-- return normally (webhook 200) instead of raising, and the receipt must
-- survive as a failed dead letter attributed to the claiming tenant.
select results_eq(
  $$ select was_duplicate, was_applied, was_stale
     from public.process_stripe_billing_event(
       'evt_dl_cross', 'customer.subscription.updated',
       '2026-07-24T12:05:00Z'::timestamptz,
       jsonb_build_object('data', jsonb_build_object('object', jsonb_build_object(
         'id', 'sub_dlCross', 'customer', 'cus_dlA', 'status', 'active',
         'metadata', jsonb_build_object('organization_id', '32000000-0000-4000-8000-000000000012')))),
       repeat('2', 64), 'dead-letter-cross') $$,
  $$ values (false, false, false) $$,
  'a cross-tenant customer binding returns normally instead of raising'
);
select results_eq(
  $$ select processing_status, organization_id,
       processing_error like '%different tenant%'
     from app_private.stripe_billing_events where event_id = 'evt_dl_cross' $$,
  $$ values ('failed'::text, '32000000-0000-4000-8000-000000000012'::uuid, true) $$,
  'the cross-tenant rejection leaves a failed receipt with error text and tenant attribution'
);
select is(
  (select stripe_customer_id from public.billing_accounts
   where organization_id = '32000000-0000-4000-8000-000000000012'),
  null::text,
  'the rejected binding wrote no customer id onto the claiming tenant account'
);

-- Stripe redelivery of the same poison event must not duplicate the receipt
-- and must keep answering the duplicate (200) shape.
select results_eq(
  $$ select was_duplicate, was_applied
     from public.process_stripe_billing_event(
       'evt_dl_cross', 'customer.subscription.updated',
       '2026-07-24T12:05:00Z'::timestamptz,
       jsonb_build_object('data', jsonb_build_object('object', jsonb_build_object(
         'id', 'sub_dlCross', 'customer', 'cus_dlA', 'status', 'active',
         'metadata', jsonb_build_object('organization_id', '32000000-0000-4000-8000-000000000012')))),
       repeat('2', 64), 'dead-letter-cross-retry') $$,
  $$ values (true, false) $$,
  'redelivery of a failed event returns the canonical duplicate response'
);
select is(
  (select count(*)::integer from app_private.stripe_billing_events
   where event_id = 'evt_dl_cross'),
  1,
  'redelivery of a failed event does not duplicate its receipt'
);

-- Event-id reuse with different content: never applies, never raises, and the
-- original receipt keeps its authoritative status with the replay recorded.
select results_eq(
  $$ select was_duplicate, was_applied
     from public.process_stripe_billing_event(
       'evt_dl_first', 'customer.subscription.updated',
       '2026-07-24T12:10:00Z'::timestamptz,
       jsonb_build_object('data', jsonb_build_object('object', jsonb_build_object(
         'id', 'sub_dlA', 'customer', 'cus_dlA', 'status', 'canceled',
         'metadata', jsonb_build_object('organization_id', '32000000-0000-4000-8000-000000000011')))),
       repeat('3', 64), 'dead-letter-reuse') $$,
  $$ values (true, false) $$,
  'an event id reused with different content is rejected as a duplicate, not a 500'
);
select results_eq(
  $$ select processing_status, processing_error like '%Rejected replay%'
     from app_private.stripe_billing_events where event_id = 'evt_dl_first' $$,
  $$ values ('applied'::text, true) $$,
  'the original receipt keeps its status and records the rejected replay'
);

-- Malformed payload values (non-numeric quantity -> 22P02) are poison, not
-- transient: durable failed receipt, normal return.
select results_eq(
  $$ select was_duplicate, was_applied, was_stale
     from public.process_stripe_billing_event(
       'evt_dl_malformed', 'customer.subscription.updated',
       '2026-07-24T12:15:00Z'::timestamptz,
       jsonb_build_object('data', jsonb_build_object('object', jsonb_build_object(
         'id', 'sub_dlBad', 'customer', 'cus_dlA', 'status', 'active',
         'metadata', jsonb_build_object('organization_id', '32000000-0000-4000-8000-000000000011'),
         'items', jsonb_build_object('data', jsonb_build_array(jsonb_build_object(
           'id', 'si_dlBad', 'quantity', 'not-a-number',
           'price', jsonb_build_object('id', 'price_dlBad'))))))),
       repeat('4', 64), 'dead-letter-malformed') $$,
  $$ values (false, false, false) $$,
  'a malformed payload returns normally instead of raising'
);
select results_eq(
  $$ select processing_status, processing_error like '[22P02]%'
     from app_private.stripe_billing_events where event_id = 'evt_dl_malformed' $$,
  $$ values ('failed'::text, true) $$,
  'the malformed payload leaves a failed receipt carrying the sqlstate and error'
);

-- Transient failures (here: FK timing on an unknown package) must keep
-- raising so the webhook answers 500 and Stripe retries.
select throws_ok(
  $$ select * from public.process_stripe_billing_event(
       'evt_dl_transient', 'customer.subscription.updated',
       '2026-07-24T12:20:00Z'::timestamptz,
       jsonb_build_object('data', jsonb_build_object('object', jsonb_build_object(
         'id', 'sub_dlFk', 'customer', 'cus_dlA', 'status', 'active',
         'metadata', jsonb_build_object(
           'organization_id', '32000000-0000-4000-8000-000000000011',
           'package_id', '32000000-0000-4000-8000-0000000000ff')))),
       repeat('5', 64), 'dead-letter-transient') $$,
  '23503', null,
  'a transient relational failure still raises for Stripe retry'
);
select is(
  (select count(*)::integer from app_private.stripe_billing_events
   where event_id = 'evt_dl_transient'),
  0,
  'a transient failure rolls the receipt back so the retry re-inserts cleanly'
);
select is(
  (select count(*)::integer from app_private.stripe_billing_events
   where processing_status = 'failed'),
  2,
  'exactly the two poison events remain as failed dead letters'
);

reset role;
select * from finish();
rollback;
