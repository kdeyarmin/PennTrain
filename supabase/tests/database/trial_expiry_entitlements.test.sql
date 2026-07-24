-- PT-052: a lapsed in-app trial (organizations.trial_ends_at) with no live
-- subscription must resolve to 'past_due' at entitlement time, denying
-- non-core modules while comped/active/grace accounts, live-subscription
-- trials, legacy orgs without a stamped window, and platform-admin access are
-- unaffected.
begin;
select plan(12);

-- Org fixtures. The ensure_organization_billing_account trigger creates each
-- billing account in the organization's subscription_status ('trial' here).
insert into public.organizations (id, name, slug, subscription_status, trial_ends_at)
values
  ('31000000-0000-4000-8000-000000000011', 'Trial Lapsed Org', 'trial-lapsed-org', 'trial',
   now() - interval '1 day'),
  ('31000000-0000-4000-8000-000000000012', 'Trial Active Org', 'trial-active-org', 'trial',
   now() + interval '20 days'),
  ('31000000-0000-4000-8000-000000000013', 'Trial Legacy Org', 'trial-legacy-org', 'trial',
   null);

select is(
  (select a.billing_state from public.billing_accounts a
   where a.organization_id = '31000000-0000-4000-8000-000000000011'),
  'trial',
  'new organizations still start in the trial billing state'
);

select results_eq(
  $$ select distinct billing_state from public.get_effective_entitlements(
       '31000000-0000-4000-8000-000000000011') $$,
  $$ values ('past_due'::text) $$,
  'a lapsed trial with no live subscription resolves to past_due'
);
select is(
  public.has_effective_entitlement(
    '31000000-0000-4000-8000-000000000011', 'modules.carebase'),
  false,
  'a lapsed trial denies non-core module entitlements'
);

select results_eq(
  $$ select distinct billing_state from public.get_effective_entitlements(
       '31000000-0000-4000-8000-000000000012') $$,
  $$ values ('trial'::text) $$,
  'an active trial keeps its trial billing state'
);
select is(
  public.has_effective_entitlement(
    '31000000-0000-4000-8000-000000000012', 'modules.carebase'),
  true,
  'an active trial keeps non-core module entitlements'
);

select is(
  public.has_effective_entitlement(
    '31000000-0000-4000-8000-000000000013', 'modules.carebase'),
  true,
  'an organization without a stamped trial window is not downgraded'
);

-- A live Stripe subscription in its own trialing period protects the account
-- even after the in-app signup window has passed.
insert into public.billing_subscriptions (
  organization_id, billing_account_id, stripe_subscription_id,
  provider_status, billing_state, seat_quantity,
  provider_event_created_at, provider_event_id
)
select
  '31000000-0000-4000-8000-000000000011', a.id, 'sub_trialexpiry1',
  'trialing', 'trial', 5, now(), 'evt_trialexpiry1'
from public.billing_accounts a
where a.organization_id = '31000000-0000-4000-8000-000000000011';
select is(
  public.has_effective_entitlement(
    '31000000-0000-4000-8000-000000000011', 'modules.carebase'),
  true,
  'a live subscription overrides the lapsed in-app trial window'
);
delete from public.billing_subscriptions
where stripe_subscription_id = 'sub_trialexpiry1';

-- Manual comp bypasses the trial cutoff entirely.
update public.billing_accounts
set billing_state = 'comped', state_source = 'manual_comp',
    comped_until = now() + interval '30 days'
where organization_id = '31000000-0000-4000-8000-000000000011';
select is(
  public.has_effective_entitlement(
    '31000000-0000-4000-8000-000000000011', 'modules.carebase'),
  true,
  'a comped account keeps entitlements despite a lapsed trial window'
);

-- Paid accounts are untouched by the trial branch.
update public.billing_accounts
set billing_state = 'active', state_source = 'stripe', comped_until = null
where organization_id = '31000000-0000-4000-8000-000000000011';
select is(
  public.has_effective_entitlement(
    '31000000-0000-4000-8000-000000000011', 'modules.carebase'),
  true,
  'an active account keeps entitlements despite a lapsed trial window'
);

-- Back to the lapsed-trial shape for the caller-facing assertions below.
update public.billing_accounts
set billing_state = 'trial', state_source = 'legacy'
where organization_id = '31000000-0000-4000-8000-000000000011';

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
  ('31000000-0000-4000-8000-000000000101'::uuid, 'trial-platform@test.local'),
  ('31000000-0000-4000-8000-000000000102'::uuid, 'trial-orgadmin@test.local')
) v(id, email);

select set_config('app.privileged_write', 'on', true);
insert into public.profiles (
  id, organization_id, email, first_name, last_name, role, is_active
) values
  ('31000000-0000-4000-8000-000000000101', null, 'trial-platform@test.local',
   'Trial', 'Platform', 'platform_admin', true),
  ('31000000-0000-4000-8000-000000000102', '31000000-0000-4000-8000-000000000011',
   'trial-orgadmin@test.local', 'Trial', 'OrgAdmin', 'org_admin', true)
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

select pg_temp.act_as('31000000-0000-4000-8000-000000000102');
select is(
  public.has_effective_entitlement(
    '31000000-0000-4000-8000-000000000011', 'modules.carebase'),
  false,
  'the lapsed org admin sees the module denial through the authenticated path'
);

reset role;
select pg_temp.act_as('31000000-0000-4000-8000-000000000101');
select lives_ok(
  $$ select count(*) from public.get_effective_entitlements(
       '31000000-0000-4000-8000-000000000011') $$,
  'platform administrators can still inspect a lapsed-trial tenant'
);
select results_eq(
  $$ select distinct billing_state from public.get_effective_entitlements(
       '31000000-0000-4000-8000-000000000011') $$,
  $$ values ('past_due'::text) $$,
  'platform administrators see the resolved past_due state for a lapsed trial'
);

reset role;
select * from finish();
rollback;
