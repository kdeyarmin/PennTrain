-- pgTAP coverage for 20260905030000: revoking an invitation makes the account unusable.
--
-- Before this, revoke wrote `status = 'revoked'` on a ledger nothing in Auth or RLS reads, while
-- `invite-user` had already created the auth user, written the profile with its target role, and
-- linked the employee. The invitee could still set a password -- from the original link, or at any
-- later time through /forgot-password, which confirms an unconfirmed user -- and sign in as an
-- active member of the tenant. Nothing tested revoke at all.
-- Run with: supabase test db (requires the local Supabase Docker stack).

begin;
select plan(11);

insert into public.organizations(id, name, slug) values
  ('3c000000-0000-4000-8000-000000000001', 'Revoke Org', 'revoke-invite-org');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('3c000000-0000-4000-8000-000000000011', '3c000000-0000-4000-8000-000000000001', 'Revoke Facility', 'PCH');

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) select
  '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated',
  v.email, 'x', v.confirmed, '{}'::jsonb, '{}'::jsonb, now(), now(),
  '', '', '', '', '', '', false, false
from (values
  -- The admin doing the revoking.
  ('3c000000-0000-4000-8000-000000000101'::uuid, 'revoke-admin@test.local', now()),
  -- An invitee who has never opened the link: no confirmation, no sign-in.
  ('3c000000-0000-4000-8000-000000000102'::uuid, 'revoke-pending@test.local', null::timestamptz),
  -- An invitee who HAS accepted, while the daily reconcile has not caught up.
  ('3c000000-0000-4000-8000-000000000103'::uuid, 'revoke-accepted@test.local', now())
) v(id, email, confirmed);

select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('3c000000-0000-4000-8000-000000000101', '3c000000-0000-4000-8000-000000000001', 'revoke-admin@test.local', 'Revoke', 'Admin', 'org_admin', true),
  ('3c000000-0000-4000-8000-000000000102', '3c000000-0000-4000-8000-000000000001', 'revoke-pending@test.local', 'Pending', 'Invitee', 'facility_manager', true),
  ('3c000000-0000-4000-8000-000000000103', '3c000000-0000-4000-8000-000000000001', 'revoke-accepted@test.local', 'Accepted', 'Invitee', 'employee', true)
on conflict (id) do update set
  organization_id = excluded.organization_id, email = excluded.email,
  first_name = excluded.first_name, last_name = excluded.last_name,
  role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);

-- The employee row invite-user linked to the pending invitee.
insert into public.employees(
  id, organization_id, facility_id, profile_id, employee_number, first_name, last_name,
  email, hire_date, job_title, status
) values (
  '3c000000-0000-4000-8000-000000000201', '3c000000-0000-4000-8000-000000000001',
  '3c000000-0000-4000-8000-000000000011', '3c000000-0000-4000-8000-000000000102',
  'RV-1', 'Pending', 'Invitee', 'revoke-pending@test.local', public.pa_today()-10, 'Care Manager', 'active'
);

-- A live session for the pending invitee, the way a half-accepted invite leaves one behind.
insert into auth.sessions(id, user_id, created_at, updated_at)
values (gen_random_uuid(), '3c000000-0000-4000-8000-000000000102', now(), now());

insert into public.user_invitation_lifecycle(
  id, organization_id, employee_id, invited_user_id, email, first_name, last_name,
  invited_role, status, expires_at, created_by
) values
  ('3c000000-0000-4000-8000-000000000301', '3c000000-0000-4000-8000-000000000001',
   '3c000000-0000-4000-8000-000000000201', '3c000000-0000-4000-8000-000000000102',
   'revoke-pending@test.local', 'Pending', 'Invitee', 'facility_manager', 'sent',
   now() + interval '7 days', '3c000000-0000-4000-8000-000000000101'),
  ('3c000000-0000-4000-8000-000000000302', '3c000000-0000-4000-8000-000000000001',
   null, '3c000000-0000-4000-8000-000000000103',
   'revoke-accepted@test.local', 'Accepted', 'Invitee', 'employee', 'sent',
   now() + interval '7 days', '3c000000-0000-4000-8000-000000000101');

create or replace function pg_temp.act_as(p_profile_id uuid)
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_profile_id, 'role', 'authenticated', 'aal', 'aal2',
    'iat', extract(epoch from now())::bigint
  )::text, true);
  set local role authenticated;
end;
$$;

select pg_temp.act_as('3c000000-0000-4000-8000-000000000101');

-- ---------------------------------------------------------------------------------------
-- Revoking an unopened invitation makes the account unusable.
-- ---------------------------------------------------------------------------------------
select lives_ok(
  $$ select public.revoke_user_invitation(
       '3c000000-0000-4000-8000-000000000301', 'Hired someone else') $$,
  'an unopened invitation can be revoked'
);

reset role;

select is(
  (select status from public.user_invitation_lifecycle where id = '3c000000-0000-4000-8000-000000000301'),
  'revoked',
  'the ledger records the revocation'
);

-- This is the assertion that matters: the ledger was never the thing standing between the invitee
-- and a working account.
select is(
  (select is_active from public.profiles where id = '3c000000-0000-4000-8000-000000000102'),
  false,
  'the invited profile is deactivated, so RLS refuses it on the next request however it signs in'
);

select is(
  (select count(*)::int from auth.sessions where user_id = '3c000000-0000-4000-8000-000000000102'),
  0,
  'any session the half-accepted invite left behind is gone'
);

select is(
  (select profile_id from public.employees where id = '3c000000-0000-4000-8000-000000000201'),
  null,
  'the employee is detached, so the same person can be invited again'
);

select ok(
  exists (select 1 from public.employees where id = '3c000000-0000-4000-8000-000000000201'),
  'the employee record itself survives -- only the login link was withdrawn'
);

-- ---------------------------------------------------------------------------------------
-- An invitation that was really accepted is refused, not silently deactivated.
-- ---------------------------------------------------------------------------------------
-- The ledger still says `sent` here because reconcile_user_invitation_lifecycle runs daily.
-- Trusting it would take a working account away from someone who did nothing wrong.
select is(
  (select status from public.user_invitation_lifecycle where id = '3c000000-0000-4000-8000-000000000302'),
  'sent',
  'the ledger has not caught up with this acceptance yet'
);

select pg_temp.act_as('3c000000-0000-4000-8000-000000000101');

select throws_ok(
  $$ select public.revoke_user_invitation(
       '3c000000-0000-4000-8000-000000000302', 'Changed our minds') $$,
  '22023',
  'This invitation has already been accepted; deactivate the user instead',
  'revoking an already-accepted invitation is refused, and says what to do instead'
);

reset role;

select is(
  (select is_active from public.profiles where id = '3c000000-0000-4000-8000-000000000103'),
  true,
  'the accepted user keeps their working account'
);

-- The stale row is NOT corrected by the refusal, and this assertion exists to say so rather than
-- to leave it unstated. A draft did correct it and then raised; the raise rolled the correction
-- back, so the call reported an error and changed nothing. Reconciling the ledger belongs to the
-- daily job that owns it, not to a function whose answer is "no".
select is(
  (select status from public.user_invitation_lifecycle where id = '3c000000-0000-4000-8000-000000000302'),
  'sent',
  'the refusal changes nothing at all, including the stale ledger row'
);

-- ---------------------------------------------------------------------------------------
-- Revocation is not repeatable.
-- ---------------------------------------------------------------------------------------
select pg_temp.act_as('3c000000-0000-4000-8000-000000000101');
select throws_ok(
  $$ select public.revoke_user_invitation(
       '3c000000-0000-4000-8000-000000000301', 'Again') $$,
  '22023',
  'Only pending invitations can be revoked',
  'a revoked invitation cannot be revoked twice'
);

select * from finish();
rollback;
