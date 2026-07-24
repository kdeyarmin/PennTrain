-- PT-057 operator surface: platform admins can list Stripe webhook dead
-- letters (processing_status='failed') and replay the stored signed payload;
-- everyone else is denied. Retry keeps the dead letter durable when the
-- cause persists, applies the event once the cause is fixed, and refuses
-- receipts that are not failed.
begin;
select plan(14);

insert into public.organizations (id, name, slug, subscription_status)
values
  ('33000000-0000-4000-8000-000000000011', 'Retry Org A', 'retry-org-a', 'active'),
  ('33000000-0000-4000-8000-000000000012', 'Retry Org B', 'retry-org-b', 'active');

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
  ('33000000-0000-4000-8000-000000000101'::uuid, 'retry-platform@test.local'),
  ('33000000-0000-4000-8000-000000000102'::uuid, 'retry-orgadmin@test.local')
) v(id, email);

select set_config('app.privileged_write', 'on', true);
insert into public.profiles (
  id, organization_id, email, first_name, last_name, role, is_active
) values
  ('33000000-0000-4000-8000-000000000101', null, 'retry-platform@test.local',
   'Retry', 'Platform', 'platform_admin', true),
  ('33000000-0000-4000-8000-000000000102', '33000000-0000-4000-8000-000000000011',
   'retry-orgadmin@test.local', 'Retry', 'OrgAdmin', 'org_admin', true)
on conflict (id) do update set
  organization_id = excluded.organization_id,
  email = excluded.email,
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

-- Seed one applied receipt (binds cus_retA to org A) and one cross-tenant
-- dead letter (org B claims org A's customer).
set local role service_role;
select results_eq(
  $$ select was_duplicate, was_applied, was_stale
     from public.process_stripe_billing_event(
       'evt_ret_ok', 'customer.subscription.updated',
       '2026-07-24T12:00:00Z'::timestamptz,
       jsonb_build_object('data', jsonb_build_object('object', jsonb_build_object(
         'id', 'sub_retA', 'customer', 'cus_retA', 'status', 'active',
         'metadata', jsonb_build_object('organization_id', '33000000-0000-4000-8000-000000000011'),
         'items', jsonb_build_object('data', jsonb_build_array(jsonb_build_object(
           'id', 'si_retA', 'quantity', 3,
           'current_period_start', 1786449600, 'current_period_end', 1789128000,
           'price', jsonb_build_object('id', 'price_retA'))))))),
       repeat('a', 64), 'retry-surface-ok') $$,
  $$ values (false, true, false) $$,
  'the baseline subscription event applies and binds the customer to org A'
);
select results_eq(
  $$ select was_duplicate, was_applied, was_stale
     from public.process_stripe_billing_event(
       'evt_ret_cross', 'customer.subscription.updated',
       '2026-07-24T12:05:00Z'::timestamptz,
       jsonb_build_object('data', jsonb_build_object('object', jsonb_build_object(
         'id', 'sub_retCross', 'customer', 'cus_retA', 'status', 'active',
         'metadata', jsonb_build_object('organization_id', '33000000-0000-4000-8000-000000000012')))),
       repeat('b', 64), 'retry-surface-cross') $$,
  $$ values (false, false, false) $$,
  'the cross-tenant event returns normally as a dead letter'
);
reset role;

select is(
  (select processing_status from app_private.stripe_billing_events
   where event_id = 'evt_ret_cross'),
  'failed',
  'the seeded dead letter is durably marked failed'
);

-- Non-platform admins are denied both the list and the retry.
select pg_temp.act_as('33000000-0000-4000-8000-000000000102');
select throws_ok(
  $$ select * from public.list_failed_stripe_billing_events() $$,
  '42501', null,
  'an org admin cannot list billing event dead letters'
);
select throws_ok(
  $$ select * from public.retry_failed_stripe_billing_event('evt_ret_cross') $$,
  '42501', null,
  'an org admin cannot retry billing events'
);

-- Retry is a billing mutation: platform admin without fresh AAL2 is refused.
select pg_temp.act_as('33000000-0000-4000-8000-000000000101', 'aal1');
select throws_ok(
  $$ select * from public.retry_failed_stripe_billing_event('evt_ret_cross') $$,
  '42501', null,
  'retry requires a fresh AAL2 session even for platform admins'
);

-- Platform admin sees the dead letter with tenant attribution, provider ids
-- extracted from the stored payload, and the recorded error.
select pg_temp.act_as('33000000-0000-4000-8000-000000000101');
select results_eq(
  $$ select event_id, event_type, organization_id, organization_name,
       stripe_customer_id, stripe_subscription_id,
       processing_error like '%different tenant%'
     from public.list_failed_stripe_billing_events() $$,
  $$ values ('evt_ret_cross'::text, 'customer.subscription.updated'::text,
       '33000000-0000-4000-8000-000000000012'::uuid, 'Retry Org B'::text,
       'cus_retA'::text, 'sub_retCross'::text, true) $$,
  'a platform admin sees the seeded dead letter with provider ids and error text'
);

-- Retrying while the cause persists fails again -- and stays durable.
select results_eq(
  $$ select was_applied, processing_status
     from public.retry_failed_stripe_billing_event('evt_ret_cross') $$,
  $$ values (false, 'failed'::text) $$,
  'a retry with an unresolved cause reports the fresh failure'
);
reset role;
select is(
  (select count(*)::integer from app_private.stripe_billing_events
   where event_id = 'evt_ret_cross' and processing_status = 'failed'),
  1,
  'the dead letter survives a failed retry'
);

-- Fix the cause (release org A's claim on the customer), then retry.
update public.billing_accounts
set stripe_customer_id = null
where organization_id = '33000000-0000-4000-8000-000000000011';
create temp table _orig_receipt as
select signature_verified_at, created_at
from app_private.stripe_billing_events
where event_id = 'evt_ret_cross';

select pg_temp.act_as('33000000-0000-4000-8000-000000000101');
select results_eq(
  $$ select was_applied, processing_status
     from public.retry_failed_stripe_billing_event('evt_ret_cross') $$,
  $$ values (true, 'applied'::text) $$,
  'retry applies the stored payload once the cause is fixed'
);
select is(
  (select count(*)::integer from public.list_failed_stripe_billing_events()),
  0,
  'the dead-letter list is empty after a successful retry'
);
select throws_ok(
  $$ select * from public.retry_failed_stripe_billing_event('evt_ret_cross') $$,
  '22023', null,
  'an already-applied event cannot be retried'
);
reset role;

select results_eq(
  $$ select e.signature_verified_at = o.signature_verified_at,
       e.created_at = o.created_at
     from app_private.stripe_billing_events e
     cross join _orig_receipt o
     where e.event_id = 'evt_ret_cross' $$,
  $$ values (true, true) $$,
  'the replayed receipt keeps its original intake evidence timestamps'
);
select is(
  (select a.stripe_customer_id from public.billing_accounts a
   where a.organization_id = '33000000-0000-4000-8000-000000000012'),
  'cus_retA',
  'the successful replay bound the customer to the claiming tenant'
);

select * from finish();
rollback;
