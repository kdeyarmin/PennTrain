-- Public invite-link resend: hashed caps, and a lookup that cannot tell the reasons apart.
-- Run with: supabase test db.

begin;
select plan(21);

------------------------------------------------------------------------------------------------
-- 1-4. Only the service role may reserve or look up
------------------------------------------------------------------------------------------------
select has_function(
  'public', 'reserve_invite_resend',
  array['text', 'text', 'integer', 'integer'],
  'the resend cap is a service-role reservation'
);
select has_function(
  'public', 'pending_invite_user_id',
  array['text'],
  'a pending invite is looked up by email without creating an account'
);

set local role anon;
select throws_ok(
  $$select public.reserve_invite_resend(repeat('a', 64), repeat('b', 64), 5, 3)$$,
  '42501', null,
  'anon cannot spend or read the resend cap'
);
select throws_ok(
  $$select public.pending_invite_user_id('invitee@example.test')$$,
  '42501', null,
  'anon cannot ask whether an address was invited'
);
reset role;

set local role authenticated;
select throws_ok(
  $$select public.pending_invite_user_id('invitee@example.test')$$,
  '42501', null,
  'a signed-in user cannot ask whether an address was invited'
);
reset role;

------------------------------------------------------------------------------------------------
-- 5-8. Caps
------------------------------------------------------------------------------------------------
set local role service_role;

select lives_ok(
  $$select public.reserve_invite_resend(repeat('1', 64), repeat('9', 64), 5, 50)$$,
  'a first request from one address is recorded'
);
select lives_ok(
  $$select public.reserve_invite_resend(repeat('1', 64), repeat('9', 64), 5, 50)$$,
  'a second request from the same address is recorded'
);
select lives_ok(
  $$select public.reserve_invite_resend(repeat('1', 64), repeat('9', 64), 5, 50)$$,
  'a third request from the same address is recorded'
);
select lives_ok(
  $$select public.reserve_invite_resend(repeat('1', 64), repeat('9', 64), 5, 50)$$,
  'a fourth request from the same address is recorded'
);
select lives_ok(
  $$select public.reserve_invite_resend(repeat('1', 64), repeat('9', 64), 5, 50)$$,
  'a fifth request from the same address is recorded'
);
select throws_ok(
  $$select public.reserve_invite_resend(repeat('1', 64), repeat('9', 64), 5, 50)$$,
  'P0001', 'invite_resend_rate_limited',
  'the sixth request from the same address in an hour is refused'
);

select lives_ok(
  $$select public.reserve_invite_resend(repeat('2', 64), repeat('8', 64), 50, 3)$$,
  'a first request for one email is recorded'
);
select lives_ok(
  $$select public.reserve_invite_resend(repeat('2', 64), repeat('8', 64), 50, 3)$$,
  'a second request for the same email is recorded'
);
select lives_ok(
  $$select public.reserve_invite_resend(repeat('2', 64), repeat('8', 64), 50, 3)$$,
  'a third request for the same email is recorded'
);
select throws_ok(
  $$select public.reserve_invite_resend(repeat('2', 64), repeat('c', 64), 50, 3)$$,
  'P0001', 'invite_resend_rate_limited',
  'a fourth request for the same email is refused even from a new address'
);
select lives_ok(
  $$select public.reserve_invite_resend(repeat('3', 64), repeat('c', 64), 50, 3)$$,
  'a different email from that address is still accepted'
);
select throws_ok(
  $$select public.reserve_invite_resend('not-a-hash', repeat('d', 64), 5, 3)$$,
  '22023', null,
  'a reservation that is not a hash is rejected'
);

------------------------------------------------------------------------------------------------
-- 9-15. Lookup returns an id only for an unconfirmed, still-active invitation
------------------------------------------------------------------------------------------------
reset role;
insert into public.organizations(id, name, slug, subscription_status) values
  ('17160000-0000-4000-8000-000000000001', 'Invite Resend Org', 'invite-resend-org', 'trial');

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', '17160000-0000-4000-8000-000000000011',
   'authenticated', 'authenticated', 'pending.invitee@example.test', 'x', null,
   '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', '17160000-0000-4000-8000-000000000012',
   'authenticated', 'authenticated', 'confirmed.invitee@example.test', 'x', now(),
   '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', '17160000-0000-4000-8000-000000000013',
   'authenticated', 'authenticated', 'revoked.invitee@example.test', 'x', null,
   '{}', '{}', now(), now(), '', '', '', '', '', '', false, false);

select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('17160000-0000-4000-8000-000000000011', '17160000-0000-4000-8000-000000000001',
   'pending.invitee@example.test', 'Pending', 'Invitee', 'employee', true),
  ('17160000-0000-4000-8000-000000000012', '17160000-0000-4000-8000-000000000001',
   'confirmed.invitee@example.test', 'Confirmed', 'Invitee', 'employee', true),
  ('17160000-0000-4000-8000-000000000013', '17160000-0000-4000-8000-000000000001',
   'revoked.invitee@example.test', 'Revoked', 'Invitee', 'employee', false)
on conflict (id) do update set
  organization_id = excluded.organization_id,
  email = excluded.email,
  is_active = excluded.is_active,
  role = excluded.role;
select set_config('app.privileged_write', 'off', true);

set local role service_role;
select is(
  public.pending_invite_user_id('Pending.Invitee@example.test'),
  '17160000-0000-4000-8000-000000000011'::uuid,
  'an unconfirmed active invitation is the only address that can be resent'
);
select is(
  public.pending_invite_user_id('confirmed.invitee@example.test'),
  null,
  'a confirmed account is not resent an invitation'
);
select is(
  public.pending_invite_user_id('revoked.invitee@example.test'),
  null,
  'a revoked invitation is not resent'
);
select is(
  public.pending_invite_user_id('nobody@example.test'),
  null,
  'an unknown address looks the same as a confirmed one'
);

select * from finish();
rollback;
