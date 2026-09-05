-- pgTAP coverage for 20260905210000 (I21): consent somebody else gave for you, a placeholder that
-- outranked the real subscription, and a roster nobody could reach.
--
-- The first case is the one with a statute attached: an administrator could opt another person
-- into text messages and the RPC stamped sms_consent_at as though that person had given it.
-- Run with: supabase test db.

begin;
select plan(14);

insert into public.organizations (id, name, slug, subscription_status) values
  ('e7000000-0000-4000-8000-000000000001', 'Consent Org', 'consent-org', 'active');
insert into public.facilities (id, organization_id, name, facility_type) values
  ('e7000000-0000-4000-8000-000000000011', 'e7000000-0000-4000-8000-000000000001', 'Consent PCH', 'PCH');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', 'e7000000-0000-4000-8000-000000000021', 'authenticated',
   'authenticated', 'consent-admin@test.local', 'x', now(), '{}'::jsonb, '{}'::jsonb, now(), now(),
   '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', 'e7000000-0000-4000-8000-000000000022', 'authenticated',
   'authenticated', 'consent-aide@test.local', 'x', now(), '{}'::jsonb, '{}'::jsonb, now(), now(),
   '', '', '', '', '', '', false, false);

select set_config('app.privileged_write', 'on', true);
insert into public.profiles (id, organization_id, email, first_name, last_name, role, is_active, phone) values
  ('e7000000-0000-4000-8000-000000000021', 'e7000000-0000-4000-8000-000000000001',
   'consent-admin@test.local', 'Avery', 'Admin', 'org_admin', true, '+15551110001'),
  ('e7000000-0000-4000-8000-000000000022', 'e7000000-0000-4000-8000-000000000001',
   'consent-aide@test.local', 'Alex', 'Aide', 'employee', true, '+15551110002')
on conflict (id) do update set organization_id = excluded.organization_id,
  role = excluded.role, is_active = true, phone = excluded.phone;
select set_config('app.privileged_write', 'off', true);

insert into public.employees (
  id, organization_id, facility_id, profile_id, first_name, last_name, job_title, status
) values
  ('e7000000-0000-4000-8000-000000000031', 'e7000000-0000-4000-8000-000000000001',
   'e7000000-0000-4000-8000-000000000011', 'e7000000-0000-4000-8000-000000000022',
   'Alex', 'Aide', 'Direct Care Aide', 'active'),
  -- The imported half of the roster: on the schedule, on the compliance reports, and reachable by
  -- nothing at all, because every enqueue_* resolves the recipient through profiles.
  ('e7000000-0000-4000-8000-000000000032', 'e7000000-0000-4000-8000-000000000001',
   'e7000000-0000-4000-8000-000000000011', null,
   'Blake', 'Imported', 'Direct Care Aide', 'active'),
  ('e7000000-0000-4000-8000-000000000033', 'e7000000-0000-4000-8000-000000000001',
   'e7000000-0000-4000-8000-000000000011', null,
   'Casey', 'Imported', 'Direct Care Aide', 'active');

create or replace function pg_temp.act_as(p_profile_id uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_profile_id, 'role', 'authenticated', 'aal', 'aal2'
  )::text, true);
  execute 'set local role authenticated';
end;
$$;

------------------------------------------------------------------------------------------------
-- 1-5. Consent is the recipient's to give
------------------------------------------------------------------------------------------------
select pg_temp.act_as('e7000000-0000-4000-8000-000000000021');
select throws_ok(
  $$select public.update_profile_contact_preferences(
      'e7000000-0000-4000-8000-000000000022', 'Alex', 'Aide', '+15551110002', true, 'sms')$$,
  '42501',
  null,
  'an org admin cannot opt another person into text messages'
);
select is(
  (select sms_consent_at from public.profiles where id = 'e7000000-0000-4000-8000-000000000022'),
  null,
  'and no consent timestamp is written -- that column is what a TCPA complaint asks about'
);
-- Everything else an administrator legitimately does on this screen still works.
select lives_ok(
  $$select public.update_profile_contact_preferences(
      'e7000000-0000-4000-8000-000000000022', 'Alexandra', 'Aide', '+15551110002', false, 'email')$$,
  'an administrator can still correct a name and a phone number'
);

-- The recipient opts themselves in, which is the only way it can happen.
select pg_temp.act_as('e7000000-0000-4000-8000-000000000022');
select lives_ok(
  $$select public.update_profile_contact_preferences(
      'e7000000-0000-4000-8000-000000000022', 'Alexandra', 'Aide', '+15551110002', true, 'sms')$$,
  'the recipient opts themselves in from their own preferences'
);
select isnt(
  (select sms_consent_at from public.profiles where id = 'e7000000-0000-4000-8000-000000000022'),
  null,
  'and that is the consent the record now reflects'
);

------------------------------------------------------------------------------------------------
-- 6-7. An administrator may still turn it OFF, and may not move it to a new number
------------------------------------------------------------------------------------------------
select pg_temp.act_as('e7000000-0000-4000-8000-000000000021');
select throws_ok(
  $$select public.update_profile_contact_preferences(
      'e7000000-0000-4000-8000-000000000022', 'Alexandra', 'Aide', '+15559990000', true, 'sms')$$,
  '42501',
  null,
  'consent does not follow a phone number the administrator typed in'
);
select lives_ok(
  $$select public.update_profile_contact_preferences(
      'e7000000-0000-4000-8000-000000000022', 'Alexandra', 'Aide', '+15551110002', false, 'email')$$,
  'but an administrator can always turn texting off -- an opt-out needs nobody''s permission'
);

------------------------------------------------------------------------------------------------
-- 8-10. How many people the product can actually reach
------------------------------------------------------------------------------------------------
select is(
  (select unreachable_employees from public.get_notification_reach()
   where organization_id = 'e7000000-0000-4000-8000-000000000001'),
  2,
  'the two imported aides with no login are counted, not silently dropped'
);
select is(
  (select reachable_employees from public.get_notification_reach()
   where organization_id = 'e7000000-0000-4000-8000-000000000001'),
  1,
  'against the one who was actually invited'
);
select is(
  (select count(*)::integer from public.get_notification_reach()
   where organization_id <> 'e7000000-0000-4000-8000-000000000001'),
  0,
  'and an organization administrator sees only their own organization'
);

------------------------------------------------------------------------------------------------
-- 11-14. The checkout stub does not outrank the real subscription
------------------------------------------------------------------------------------------------
-- Replayed in the order that broke it: the checkout session completes at 12:00:05 and the
-- subscription.created event Stripe emitted a moment earlier carries 12:00:00. Under the plain
-- (timestamp, id) ordering the stub wins and the real row is discarded.
reset role;
-- Clear the acting identity: packages carries a legacy-contract trigger that demands an AAL2
-- platform admin from anyone who has an identity at all.
select set_config('request.jwt.claims', '', true);

insert into public.packages (id, name, learner_limit, facility_limit, features, sort_order)
values ('e7000000-0000-4000-8000-000000000041', 'Consent Plan', 25, 3, '{}'::jsonb, 98);

set local role service_role;

select ok(
  (select was_applied from public.process_stripe_billing_event(
    'evt_consent_checkout', 'checkout.session.completed',
    '2026-07-11T12:00:05Z'::timestamptz,
    jsonb_build_object('data', jsonb_build_object('object', jsonb_build_object(
      'id', 'cs_consent', 'customer', 'cus_consent', 'payment_status', 'paid',
      'subscription', 'sub_consent',
      'metadata', jsonb_build_object(
        'organization_id', 'e7000000-0000-4000-8000-000000000001',
        'package_id', 'e7000000-0000-4000-8000-000000000041')
    ))), repeat('d', 64), 'stripe-consent-checkout')),
  'the checkout stub is written so trial expiry cannot lock out someone who has just paid'
);
select is(
  (select is_provider_placeholder from public.billing_subscriptions
   where stripe_subscription_id = 'sub_consent'),
  true,
  'and it is marked as the stand-in it is'
);

select ok(
  (select was_applied from public.process_stripe_billing_event(
    'evt_consent_subscription', 'customer.subscription.created',
    -- EARLIER than the checkout event, which is the whole point.
    '2026-07-11T12:00:00Z'::timestamptz,
    jsonb_build_object('data', jsonb_build_object('object', jsonb_build_object(
      'id', 'sub_consent', 'customer', 'cus_consent', 'status', 'active',
      'metadata', jsonb_build_object(
        'organization_id', 'e7000000-0000-4000-8000-000000000001',
        'package_id', 'e7000000-0000-4000-8000-000000000041'),
      'items', jsonb_build_object('data', jsonb_build_array(jsonb_build_object(
        'id', 'si_consent', 'quantity', 25,
        'current_period_start', 1783771200, 'current_period_end', 1786449600,
        'price', jsonb_build_object('id', 'price_consent'))))
    ))), repeat('e', 64), 'stripe-consent-subscription')),
  'the real subscription event supersedes the stub even though its timestamp is older'
);
select results_eq(
  $$ select s.seat_quantity, s.is_provider_placeholder,
            (select count(*)::integer from public.billing_subscription_items i
             where i.subscription_id = s.id)
     from public.billing_subscriptions s where s.stripe_subscription_id = 'sub_consent' $$,
  $$ values (25, false, 1) $$,
  'so the seats, the flag and the subscription items all reflect Stripe -- an empty items table is what the hourly quantity sync reports as partial forever'
);

select * from finish();
rollback;
