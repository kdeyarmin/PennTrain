-- Signup rollback must clear restrict FKs and leftover profiles;
-- checkout.session.completed must stamp the purchased package and a
-- subscription stub (paid → active, trial → trial; expanded customer ids).
begin;
select plan(18);

set local role postgres;

insert into public.packages (id, name, learner_limit, facility_limit, features, sort_order)
values (
  '35000000-0000-4000-8000-000000000001', 'Checkout Completion Pack', 10, 2,
  '{"modules.train":true,"modules.carebase":true}'::jsonb, 98
);

-- record_organization_signup creates settings + fires the enterprise hierarchy
-- trigger that writes enterprise_organization_memberships (ON DELETE RESTRICT).
select lives_ok(
  $$ select public.record_organization_signup(
       'Rollback Signup Org', 'rollback-signup-org',
       now() + interval '30 days', 'CareMetric-HIPAA-BAA-v2026-07-14') $$,
  'signup RPC creates the organization'
);

select ok(
  exists (
    select 1 from public.enterprise_organization_memberships m
    join public.organizations o on o.id = m.organization_id
    where o.slug = 'rollback-signup-org' and m.effective_to is null
  ),
  'signup provisions an enterprise membership that would block a raw org delete'
);

-- A leftover org_admin profile (invite succeeded, later step failed) used to
-- block organizations DELETE because profiles.organization_id is NO ACTION.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values (
  '00000000-0000-0000-0000-000000000000',
  '35000000-0000-4000-8000-000000000101',
  'authenticated', 'authenticated', 'rollback-admin@test.local', 'x', now(),
  '{"role":"org_admin"}'::jsonb, '{}'::jsonb, now(), now(),
  '', '', '', '', '', '', false, false
);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles (
  id, organization_id, email, first_name, last_name, role, is_active
) values (
  '35000000-0000-4000-8000-000000000101',
  (select id from public.organizations where slug = 'rollback-signup-org'),
  'rollback-admin@test.local', 'Rollback', 'Admin', 'org_admin', true
)
on conflict (id) do update set
  organization_id = excluded.organization_id,
  role = excluded.role,
  is_active = excluded.is_active;
select set_config('app.privileged_write', 'off', true);

select lives_ok(
  $$ select public.rollback_organization_signup(
       (select id from public.organizations where slug = 'rollback-signup-org')) $$,
  'rollback removes the restrict memberships, detaches leftover profiles, and deletes the organization'
);

select ok(
  not exists (select 1 from public.organizations where slug = 'rollback-signup-org'),
  'rolled-back signup organization is gone'
);

select is(
  (select organization_id from public.profiles
   where id = '35000000-0000-4000-8000-000000000101'),
  null,
  'rollback detaches leftover signup profiles so the org delete is not blocked'
);

insert into public.organizations (id, name, slug, subscription_status, trial_ends_at)
values (
  '35000000-0000-4000-8000-000000000011', 'Checkout Completion Org',
  'checkout-completion-org', 'trial', now() + interval '20 days'
);

select lives_ok(
  $$ select public.process_stripe_billing_event(
       'evt_checkout_complete_1', 'checkout.session.completed',
       '2026-08-13T16:00:00Z'::timestamptz,
       jsonb_build_object('data', jsonb_build_object('object', jsonb_build_object(
         'id', 'cs_test_complete_1',
         'customer', 'cus_checkoutComplete1',
         'subscription', 'sub_checkoutComplete1',
         'payment_status', 'paid',
         'client_reference_id', '35000000-0000-4000-8000-000000000011',
         'metadata', jsonb_build_object(
           'organization_id', '35000000-0000-4000-8000-000000000011',
           'package_id', '35000000-0000-4000-8000-000000000001')
       ))),
       repeat('c', 64), 'corr-checkout-complete-1') $$,
  'checkout.session.completed processes without error'
);

select is(
  (select package_id from public.organizations
   where id = '35000000-0000-4000-8000-000000000011'),
  '35000000-0000-4000-8000-000000000001'::uuid,
  'completed checkout stamps the purchased package immediately'
);

select results_eq(
  $$ select provider_status, billing_state
     from public.billing_subscriptions
     where stripe_subscription_id = 'sub_checkoutComplete1' $$,
  $$ values ('active'::text, 'active'::text) $$,
  'completed paid checkout inserts a live subscription stub'
);

select is(
  (select stripe_customer_id from public.billing_accounts
   where organization_id = '35000000-0000-4000-8000-000000000011'),
  'cus_checkoutComplete1',
  'completed checkout binds the Stripe customer'
);

select is(
  (select billing_state from public.billing_accounts
   where organization_id = '35000000-0000-4000-8000-000000000011'),
  'active',
  'paid checkout promotes the trial billing account'
);

-- A later richer subscription event must still be allowed to overwrite the stub.
select lives_ok(
  $$ select public.process_stripe_billing_event(
       'evt_checkout_sub_updated', 'customer.subscription.updated',
       '2026-08-13T16:01:00Z'::timestamptz,
       jsonb_build_object('data', jsonb_build_object('object', jsonb_build_object(
         'id', 'sub_checkoutComplete1',
         'customer', 'cus_checkoutComplete1',
         'status', 'trialing',
         'metadata', jsonb_build_object(
           'organization_id', '35000000-0000-4000-8000-000000000011',
           'package_id', '35000000-0000-4000-8000-000000000001'),
         'items', jsonb_build_object('data', jsonb_build_array(jsonb_build_object(
           'id', 'si_checkoutComplete1', 'quantity', 1,
           'current_period_start', 1783771200, 'current_period_end', 1786449600,
           'price', jsonb_build_object('id', 'price_checkoutComplete1'))))
       ))),
       repeat('d', 64), 'corr-checkout-sub-updated') $$,
  'a later subscription event can refine the checkout stub'
);

select is(
  (select provider_status from public.billing_subscriptions
   where stripe_subscription_id = 'sub_checkoutComplete1'),
  'trialing',
  'newer subscription.updated wins over the checkout stub'
);

select throws_ok(
  $$ select public.rollback_organization_signup(
       '35000000-0000-4000-8000-000000000011') $$,
  '42501',
  'cannot roll back an organization that already has billing state',
  'a paid tenant cannot be rolled back as a failed signup'
);

-- Trial checkout (remaining in-app days → Stripe trial) reports
-- payment_status=no_payment_required. Must stamp the package and a trial stub
-- without promoting the billing account to active.
insert into public.organizations (id, name, slug, subscription_status, trial_ends_at)
values (
  '35000000-0000-4000-8000-000000000012', 'Checkout Trial Org',
  'checkout-trial-org', 'trial', now() + interval '12 days'
);

select lives_ok(
  $$ select public.process_stripe_billing_event(
       'evt_checkout_trial_1', 'checkout.session.completed',
       '2026-08-13T16:02:00Z'::timestamptz,
       jsonb_build_object('data', jsonb_build_object('object', jsonb_build_object(
         'id', 'cs_test_trial_1',
         'customer', jsonb_build_object('id', 'cus_checkoutTrial1'),
         'subscription', jsonb_build_object('id', 'sub_checkoutTrial1'),
         'payment_status', 'no_payment_required',
         'client_reference_id', '35000000-0000-4000-8000-000000000012',
         'metadata', jsonb_build_object(
           'organization_id', '35000000-0000-4000-8000-000000000012',
           'package_id', '35000000-0000-4000-8000-000000000001')
       ))),
       repeat('e', 64), 'corr-checkout-trial-1') $$,
  'trial checkout.session.completed with expanded customer/subscription objects processes'
);

select is(
  (select package_id from public.organizations
   where id = '35000000-0000-4000-8000-000000000012'),
  '35000000-0000-4000-8000-000000000001'::uuid,
  'trial checkout stamps the purchased package immediately'
);

select is(
  (select stripe_customer_id from public.billing_accounts
   where organization_id = '35000000-0000-4000-8000-000000000012'),
  'cus_checkoutTrial1',
  'expanded customer object still binds cus_…'
);

select results_eq(
  $$ select provider_status, billing_state
     from public.billing_subscriptions
     where stripe_subscription_id = 'sub_checkoutTrial1' $$,
  $$ values ('trialing'::text, 'trial'::text) $$,
  'trial checkout inserts a trialing subscription stub'
);

select is(
  (select billing_state from public.billing_accounts
   where organization_id = '35000000-0000-4000-8000-000000000012'),
  'trial',
  'trial checkout does not promote the billing account to active'
);

select * from finish();
rollback;
