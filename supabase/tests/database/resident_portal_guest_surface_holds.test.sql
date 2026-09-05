begin;
select plan(14);

-- The resident portal is the only part of this product reachable with NO ACCOUNT AT ALL. Seven
-- SECURITY DEFINER functions are granted to `anon`, they bypass RLS by definition, and the only
-- thing between an anonymous HTTP request and a resident's schedule, documents and messages is the
-- token each one validates. tenant_isolation_invariants.test.sql already says so in a comment --
-- "their security is the token each one validates, not the grant" -- and then asserts only that the
-- surface does not GROW. This asserts that it actually holds.
--
-- Every call below is made as `anon`. The fixture is five grants over two residents: live+accepted,
-- live+unaccepted, expired, revoked, and one accepted grant for a DIFFERENT resident carrying only
-- the `messages` permission. Controls come first, because an assertion that a hostile token is
-- refused proves nothing if the endpoint refuses everything.
--
-- This was written as a one-off attack script and every case came back clean. That is why it is
-- here: a one-off proves the surface was sound on the morning somebody ran it.

insert into public.organizations(id, name, slug, subscription_status) values
  ('da000000-0000-4000-8000-000000000001', 'Guest Org', 'guest-org', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('da000000-0000-4000-8000-000000000011', 'da000000-0000-4000-8000-000000000001', 'Guest Facility', 'PCH');
insert into public.residents(id, organization_id, facility_id, first_name, last_name, admission_date, status, clinical_data_consent) values
  ('da000000-0000-4000-8000-000000000201', 'da000000-0000-4000-8000-000000000001',
   'da000000-0000-4000-8000-000000000011', 'Grace', 'Resident', public.pa_today() - 200, 'active', 'granted'),
  ('da000000-0000-4000-8000-000000000202', 'da000000-0000-4000-8000-000000000001',
   'da000000-0000-4000-8000-000000000011', 'Other', 'Resident', public.pa_today() - 150, 'active', 'granted');

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values ('00000000-0000-0000-0000-000000000000', 'da000000-0000-4000-8000-000000000101',
  'authenticated', 'authenticated', 'guest-admin@test.local', 'x', now(), '{}', '{}',
  now(), now(), '', '', '', '', '', '', false, false);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active)
values ('da000000-0000-4000-8000-000000000101', 'da000000-0000-4000-8000-000000000001',
        'guest-admin@test.local', 'G', 'Admin', 'org_admin', true)
on conflict (id) do update
set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);

-- created_at is set explicitly on every row: the table CHECKs `expires_at > created_at`, so an
-- already-expired grant cannot be minted without backdating it. That constraint is itself worth
-- knowing about -- it means the expired case can only arise by the passage of time, never by a bad
-- insert.
insert into public.resident_portal_grants(
  id, organization_id, facility_id, resident_id, token_sha256, designated_person_name,
  relationship_label, permissions, terms_version, accepted_terms_at, expires_at, revoked_at,
  revoked_by, created_at
) values
  ('da000000-0000-4000-8000-000000000301', 'da000000-0000-4000-8000-000000000001', 'da000000-0000-4000-8000-000000000011',
   'da000000-0000-4000-8000-000000000201', encode(extensions.digest(convert_to('LIVE-TOKEN', 'utf8'), 'sha256'), 'hex'),
   'Dana Guest', 'daughter', array['schedule','documents','messages','requests']::text[], 'v1',
   now() - interval '1 day', now() + interval '7 days', null, null, now() - interval '2 days'),
  ('da000000-0000-4000-8000-000000000302', 'da000000-0000-4000-8000-000000000001', 'da000000-0000-4000-8000-000000000011',
   'da000000-0000-4000-8000-000000000201', encode(extensions.digest(convert_to('UNACCEPTED-TOKEN', 'utf8'), 'sha256'), 'hex'),
   'Pat Guest', 'son', array['schedule','documents','messages','requests']::text[], 'v1',
   null, now() + interval '7 days', null, null, now() - interval '2 days'),
  ('da000000-0000-4000-8000-000000000303', 'da000000-0000-4000-8000-000000000001', 'da000000-0000-4000-8000-000000000011',
   'da000000-0000-4000-8000-000000000201', encode(extensions.digest(convert_to('EXPIRED-TOKEN', 'utf8'), 'sha256'), 'hex'),
   'Old Guest', 'cousin', array['schedule','documents','messages','requests']::text[], 'v1',
   now() - interval '9 days', now() - interval '1 hour', null, null, now() - interval '10 days'),
  ('da000000-0000-4000-8000-000000000304', 'da000000-0000-4000-8000-000000000001', 'da000000-0000-4000-8000-000000000011',
   'da000000-0000-4000-8000-000000000201', encode(extensions.digest(convert_to('REVOKED-TOKEN', 'utf8'), 'sha256'), 'hex'),
   'Gone Guest', 'nephew', array['schedule','documents','messages','requests']::text[], 'v1',
   now() - interval '2 days', now() + interval '7 days', now() - interval '1 hour',
   'da000000-0000-4000-8000-000000000101', now() - interval '3 days'),
  ('da000000-0000-4000-8000-000000000305', 'da000000-0000-4000-8000-000000000001', 'da000000-0000-4000-8000-000000000011',
   'da000000-0000-4000-8000-000000000202', encode(extensions.digest(convert_to('OTHER-TOKEN', 'utf8'), 'sha256'), 'hex'),
   'Nosy Guest', 'friend', array['messages']::text[], 'v1',
   now() - interval '1 day', now() + interval '7 days', null, null, now() - interval '2 days');

-- One calendar event, belonging to resident 201 and to nobody else.
insert into public.resident_service_calendar_events(
  id, organization_id, facility_id, resident_id, event_type, title, starts_at, ends_at, status
) values (
  'da000000-0000-4000-8000-000000000401', 'da000000-0000-4000-8000-000000000001',
  'da000000-0000-4000-8000-000000000011', 'da000000-0000-4000-8000-000000000201',
  'medical_appointment', 'Cardiology', now() + interval '2 days', now() + interval '2 days 1 hour', 'scheduled');

set local role anon;

-- Controls first ----------------------------------------------------------------------------------
select is(
  public.get_resident_portal_snapshot('LIVE-TOKEN', null) ->> 'accessStatus',
  'active',
  'CONTROL: a live accepted token really does open the portal'
);
select isnt(
  public.respond_resident_portal_schedule_event(
    'LIVE-TOKEN', 'da000000-0000-4000-8000-000000000401', 'confirmed', null),
  null,
  'CONTROL: that token really can respond to its own resident''s appointment'
);

-- Token state -------------------------------------------------------------------------------------
select is(
  public.get_resident_portal_snapshot('NO-SUCH-TOKEN', null) ->> 'accessStatus',
  'invalid',
  'an unknown token opens nothing'
);
select is(
  public.get_resident_portal_snapshot('EXPIRED-TOKEN', null) ->> 'accessStatus',
  'invalid',
  'an expired grant opens nothing'
);
select is(
  public.get_resident_portal_snapshot('REVOKED-TOKEN', null) ->> 'accessStatus',
  'invalid',
  'a revoked grant opens nothing, and does not merely stop being listed'
);

-- Terms acceptance --------------------------------------------------------------------------------
--
-- get_resident_portal_experience is the one portal reader whose own body never mentions
-- accepted_terms_at -- it delegates to get_resident_portal_snapshot and returns early unless
-- accessStatus is 'active'. That is correct, and it is exactly the delegation shape that makes a
-- grep for the check report a hole that is not there. The assertion is behavioural for that reason.
select is(
  public.get_resident_portal_snapshot('UNACCEPTED-TOKEN', null) ->> 'accessStatus',
  'terms_required',
  'a grant whose terms were never accepted reports terms_required'
);
select is(
  public.get_resident_portal_experience('UNACCEPTED-TOKEN') ->> 'accessStatus',
  'terms_required',
  'and the richer experience endpoint stops at the same gate rather than reading around it'
);
select ok(
  public.get_resident_portal_experience('UNACCEPTED-TOKEN') -> 'requests' is null
  and public.get_resident_portal_experience('UNACCEPTED-TOKEN') -> 'payment' is null,
  'the pre-acceptance payload carries no requests and no payment link'
);
select is(
  public.get_resident_portal_experience('EXPIRED-TOKEN') ->> 'accessStatus',
  'invalid',
  'the experience endpoint honours expiry too'
);

-- Token/resource binding --------------------------------------------------------------------------
--
-- The classic failure for a token-plus-id endpoint: the token is valid, so the id is trusted. Here
-- OTHER-TOKEN is a perfectly good accepted token -- for a different resident.
select is(
  (public.respond_resident_portal_schedule_event(
     'OTHER-TOKEN', 'da000000-0000-4000-8000-000000000401', 'confirmed', null))->>'code',
  '42501',
  'a valid token cannot answer for an appointment belonging to another resident'
);
-- Writes ------------------------------------------------------------------------------------------
-- post_resident_portal_message answers a falsy body rather than raising. Returning it is a refusal
-- only if nothing was written, so the row counts below are the assertion, not the return value.
-- The body is jsonb now (20260905360000) so that a GATE denial can carry a code the browser sees;
-- this permission refusal keeps the shape it had, which `guestRpcOk` reads as false either way.
select is(
  public.post_resident_portal_message('REVOKED-TOKEN', 'hello', null)::text,
  'false',
  'a revoked token cannot post a message'
);
select is(
  public.post_resident_portal_message('EXPIRED-TOKEN', 'hello', null)::text,
  'false',
  'an expired token cannot post a message'
);

reset role;

-- Asserted as the OWNER on purpose. The first draft placed this while still `anon`, where RLS hides
-- resident_portal_grants entirely -- `not exists (...)` would have been true because the row was
-- invisible, not because the permission was absent, and it would have passed against a grant that
-- did carry `schedule`.
select ok(
  not exists (
    select 1 from public.resident_portal_grants
    where id = 'da000000-0000-4000-8000-000000000305' and 'schedule' = any(permissions)
  ),
  'the refused grant carries only `messages`, so assertion 10 covers the permission gate too'
);

select is(
  (select count(*)::int from public.resident_portal_messages m
   where m.grant_id in ('da000000-0000-4000-8000-000000000303', 'da000000-0000-4000-8000-000000000304'))
  + (select count(*)::int from public.resident_portal_schedule_responses r
     where r.grant_id = 'da000000-0000-4000-8000-000000000305'),
  0,
  'nothing the refused calls attempted was actually written'
);

select * from finish();
rollback;
