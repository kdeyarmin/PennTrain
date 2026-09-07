-- pgTAP coverage for 20260906230000 (BACKLOG J74, P3 guest/server).
--
-- Two defects in the one gate every anonymous entry point runs through:
--
--   1. `guest_request_denial('safety_report', <36 characters of hex and hyphens>)` cast the token
--      to uuid behind a regex that matched far more than uuids -- thirty-six hyphens, thirty-six
--      hex digits with no dashes -- so a crafted poster code raised 22P02. The public page answered
--      a wrong guess with a 500, and because PostgREST runs the whole call in one transaction the
--      exception rolled back the throttle row and the failure row the gate had just written. The
--      one shape of request most worth counting was the one shape never counted.
--
--   2. `get_resident_portal_experience` ran the gate itself and then called
--      `get_resident_portal_snapshot`, which runs it again -- so one portal page load spent two of
--      the caller's sixty requests a minute, and one wrong link spent two of the ten unknown-token
--      strikes.
--
-- Nothing below reads source. Each defect is provoked and the row it should have left is looked for.

begin;
select plan(9);

------------------------------------------------------------------------------------------------
-- Fixture: one organization, one facility with a poster token, one resident, one live portal grant
------------------------------------------------------------------------------------------------
insert into public.organizations (id, name, slug, subscription_status) values
  ('c7000000-0000-4000-8000-000000000001', 'Crafted Token Org', 'crafted-token-org', 'active');
insert into public.facilities (id, organization_id, name, facility_type, safety_report_token) values
  ('c7000000-0000-4000-8000-000000000011', 'c7000000-0000-4000-8000-000000000001',
   'Crafted Token PCH', 'PCH', 'poster-token-crafted-01');
insert into public.residents (id, organization_id, facility_id, first_name, last_name, status, admission_date, clinical_data_consent) values
  ('c7000000-0000-4000-8000-000000000021', 'c7000000-0000-4000-8000-000000000001',
   'c7000000-0000-4000-8000-000000000011', 'Casey', 'Resident', 'active', public.pa_today() - 40, 'granted');
insert into public.resident_portal_grants (
  organization_id, facility_id, resident_id, token_sha256, designated_person_name,
  relationship_label, permissions, expires_at, accepted_terms_at
) values
  ('c7000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000011',
   'c7000000-0000-4000-8000-000000000021',
   encode(extensions.digest(convert_to('crafted-portal-token-aaa', 'UTF8'), 'sha256'), 'hex'),
   'Casey Family', 'Daughter', array['schedule'], now() + interval '10 days', now());

------------------------------------------------------------------------------------------------
-- 1-5. A crafted 36-character safety-report token is an ordinary denial, and it is counted
------------------------------------------------------------------------------------------------
-- The caller key is the LAST x-forwarded-for hop (20260906200000), so this is one caller.
select set_config('request.headers', '{"x-forwarded-for":"203.0.113.41"}', true);

select lives_ok(
  $$select public.guest_request_denial('safety_report', repeat('a', 36))$$,
  'thirty-six hex characters with no dashes -- matched the old character-class regex, is not a uuid, and used to raise 22P02'
);
select lives_ok(
  $$select public.guest_request_denial('safety_report', repeat('-', 36))$$,
  'and thirty-six hyphens, which is the cheapest crafted token there is'
);
select is(
  public.guest_request_denial('safety_report', repeat('a', 36)),
  null,
  'the gate itself allows it through -- the safety-report RPC gives its own refusal, so the gate adds no oracle'
);
select is(
  (select count(*)::integer from app_private.guest_token_failures
   where surface = 'safety_report' and caller_key = 'ip:203.0.113.41'),
  3,
  'and every one of those guesses is written down; before this migration the exception rolled all three away'
);
select is(
  (select unknown_token_count from app_private.guest_request_windows
   where caller_key = 'ip:203.0.113.41'),
  3,
  'the throttle counter carries them too, so a scanner spends the budget instead of triggering a 500'
);

------------------------------------------------------------------------------------------------
-- 6-7. The real poster codes still resolve, both forms
------------------------------------------------------------------------------------------------
select set_config('request.headers', '{"x-forwarded-for":"203.0.113.42"}', true);
select is(
  public.guest_request_denial('safety_report', 'c7000000-0000-4000-8000-000000000011'),
  null,
  'the legacy QR code carrying the facility UUID still resolves -- those posters are printed and in the world'
);
select is(
  (select count(*)::integer from app_private.guest_token_failures
   where caller_key = 'ip:203.0.113.42'),
  0,
  'and neither the legacy form nor the current token counts as a wrong guess'
);

------------------------------------------------------------------------------------------------
-- 8-9. One portal page load costs one request, not two
------------------------------------------------------------------------------------------------
select set_config('request.headers', '{"x-forwarded-for":"203.0.113.43"}', true);
select is(
  (select public.get_resident_portal_experience('crafted-portal-token-aaa')->>'accessStatus'),
  'active',
  'the portal home page still opens for a live, terms-accepted grant'
);
select is(
  (select request_count from app_private.guest_request_windows where caller_key = 'ip:203.0.113.43'),
  1,
  'and charges the caller ONCE -- it used to gate itself and then call the snapshot, which gates again'
);

select * from finish();
rollback;
