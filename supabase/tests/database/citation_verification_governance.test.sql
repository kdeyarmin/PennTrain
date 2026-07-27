begin;
select plan(13);

-- Phase 10b: citation verification is structural, and "verified" costs something.

select has_column('public', 'dhs_citation_topics', 'verification_status', 'the status column exists');
select has_function('public', 'record_citation_verification',
  array['uuid', 'text', 'text', 'date', 'date'], 'the verification write path exists');
select has_function('public', 'get_citation_governance_status', array[]::text[],
  'the library can report its own staleness');

-- The backfill told the truth ------------------------------------------------------------------
-- Nothing may be marked verified by a migration: no person read the regulation.
select is(
  (select count(*)::int from public.dhs_citation_topics where verification_status = 'verified'),
  0,
  'the migration marked nothing as verified, because nobody verified anything'
);

-- The seeded rows whose own notes admit the section numbers are approximate now say so structurally
-- rather than in prose no surface can read.
select cmp_ok(
  (select count(*)::int from public.dhs_citation_topics where verification_status = 'approximate'),
  '>', 0,
  'rows whose notes admitted "approximate" carry that status'
);
select is(
  (select count(*)::int from public.dhs_citation_topics
   where verification_status not in ('verified', 'unverified', 'approximate', 'superseded')),
  0,
  'every row landed on a known status'
);

-- Fixtures ---------------------------------------------------------------------------------------
insert into public.organizations(id, name, slug, subscription_status) values
  ('fa000000-0000-4000-8000-000000000001', 'Citation Org', 'citation-org', 'active');
insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', 'fa000000-0000-4000-8000-000000000101', 'authenticated', 'authenticated', 'fa-platform@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', 'fa000000-0000-4000-8000-000000000102', 'authenticated', 'authenticated', 'fa-admin@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('fa000000-0000-4000-8000-000000000101', null, 'fa-platform@test.local', 'Pat', 'Platform', 'platform_admin', true),
  ('fa000000-0000-4000-8000-000000000102', 'fa000000-0000-4000-8000-000000000001', 'fa-admin@test.local', 'Ora', 'Admin', 'org_admin', true)
on conflict(id) do update set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);

create or replace function pg_temp.act_as(p_id uuid)
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_id, 'role', 'authenticated', 'aal', 'aal2',
    'iat', extract(epoch from now())::bigint)::text, true);
  set local role authenticated;
end $$;

create temp table target(id uuid) on commit drop;
-- The grant matters more than it looks. Without it every statement below that runs as `authenticated`
-- fails with 42501 reading the temp table itself, which is indistinguishable from the authorization
-- error this suite is trying to assert -- the org-admin case passed for entirely the wrong reason.
grant all on target to authenticated, anon, service_role;
insert into target select id from public.dhs_citation_topics where citation_ref is not null order by sort_order limit 1;

-- "Verified" cannot be claimed without provenance -----------------------------------------------
-- A status anyone can set for free becomes the status everyone sets to silence the warning.
select throws_ok($$update public.dhs_citation_topics
  set verification_status = 'verified'
  where id = (select id from target)$$,
  '23514',
  null,
  'a row cannot be marked verified without a verifier, a date, and a source');

select throws_ok($$update public.dhs_citation_topics
  set verification_status = 'superseded', superseded_by_ref = null
  where id = (select id from target)$$,
  '23514',
  null,
  'a superseded citation must say what replaced it');

-- Only a platform admin records verification ----------------------------------------------------
select pg_temp.act_as('fa000000-0000-4000-8000-000000000102');
select throws_ok($$select public.record_citation_verification(
  (select id from target), '2600.65', 'https://www.pacodeandbulletin.gov/example')$$,
  '42501',
  null,
  'an organization admin cannot record a verification');
reset role;

-- The source is what makes a verification checkable by the next person.
select pg_temp.act_as('fa000000-0000-4000-8000-000000000101');
select throws_ok($$select public.record_citation_verification(
  (select id from target), '2600.65', '   ')$$,
  '22023',
  null,
  'verification without a source is refused, because it is one person''s recollection');

select lives_ok($$select public.record_citation_verification(
  (select id from target), '2600.65', 'https://www.pacodeandbulletin.gov/example', '2024-01-01'::date)$$,
  'a platform admin with a source records the verification');
reset role;

select is(
  (select verified_by from public.dhs_citation_topics where id = (select id from target)),
  'fa000000-0000-4000-8000-000000000101'::uuid,
  'the verifier recorded is the person who did it, not a system account'
);

-- The library reports the gap rather than a score ------------------------------------------------
select cmp_ok(
  (public.get_citation_governance_status() ->> 'displayableUnverified')::int,
  '>', 0,
  'unverified citations a user could be shown are counted, not averaged into a health score'
);

select * from finish();
rollback;
