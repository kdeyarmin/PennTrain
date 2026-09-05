-- pgTAP coverage for 20260905230000 (I16 residual): seventeen anonymous entry points with no
-- throttle, no record of a wrong guess, and no idea their organization had been suspended.
--
-- The tokens are 32 random bytes, so guessing one is not the threat. Being able to try forever,
-- from anywhere, against a surface that reads resident schedules, financial statements and shared
-- clinical documents, is -- and until this migration the first evidence of an attack would have
-- been its success. Run with: supabase test db.

begin;
select plan(14);

------------------------------------------------------------------------------------------------
-- 1-2. Every anonymous entry point goes through the gate, including the next one somebody adds
------------------------------------------------------------------------------------------------
select is(
  (select count(*)::integer from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and has_function_privilege('anon', p.oid, 'execute')
     and p.proname not in (
       'verify_certificate', 'verify_training_passport', 'list_regulatory_updates',
       'assert_guest_request_allowed')
     and p.prosrc not like '%assert_guest_request_allowed%'),
  0,
  'no token-bearing anonymous RPC reaches its own body without passing the gate'
);
select is(
  (select count(*)::integer from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and has_function_privilege('anon', p.oid, 'execute')
     and p.prosrc like '%assert_guest_request_allowed%'),
  17,
  'and there are seventeen of them, which is the number to change deliberately'
);

------------------------------------------------------------------------------------------------
-- Fixture
------------------------------------------------------------------------------------------------
insert into public.organizations (id, name, slug, subscription_status) values
  ('f8000000-0000-4000-8000-000000000001', 'Guest Org', 'guest-org', 'active'),
  ('f8000000-0000-4000-8000-000000000002', 'Suspended Org', 'suspended-guest-org', 'suspended');
insert into public.facilities (id, organization_id, name, facility_type, safety_report_token) values
  ('f8000000-0000-4000-8000-000000000011', 'f8000000-0000-4000-8000-000000000001',
   'Guest PCH', 'PCH', 'poster-token-guest-01'),
  ('f8000000-0000-4000-8000-000000000012', 'f8000000-0000-4000-8000-000000000002',
   'Suspended PCH', 'PCH', 'poster-token-guest-02');
insert into public.residents (id, organization_id, facility_id, first_name, last_name, status, admission_date) values
  ('f8000000-0000-4000-8000-000000000021', 'f8000000-0000-4000-8000-000000000001',
   'f8000000-0000-4000-8000-000000000011', 'Robin', 'Resident', 'active', current_date - 30),
  ('f8000000-0000-4000-8000-000000000022', 'f8000000-0000-4000-8000-000000000002',
   'f8000000-0000-4000-8000-000000000012', 'Sam', 'Suspended', 'active', current_date - 30);

-- Two live portal grants, one in each organization.
insert into public.resident_portal_grants (
  organization_id, facility_id, resident_id, token_sha256, designated_person_name,
  relationship_label, permissions, expires_at, accepted_terms_at
) values
  ('f8000000-0000-4000-8000-000000000001', 'f8000000-0000-4000-8000-000000000011',
   'f8000000-0000-4000-8000-000000000021',
   encode(extensions.digest(convert_to('good-token-aaa', 'UTF8'), 'sha256'), 'hex'),
   'Alex Family', 'Daughter', array['schedule'], now() + interval '10 days', now()),
  ('f8000000-0000-4000-8000-000000000002', 'f8000000-0000-4000-8000-000000000012',
   'f8000000-0000-4000-8000-000000000022',
   encode(extensions.digest(convert_to('suspended-token-bbb', 'UTF8'), 'sha256'), 'hex'),
   'Blake Family', 'Son', array['schedule'], now() + interval '10 days', now());

-- One caller, so the per-caller counters mean something. Without this each token would key its
-- own window and nothing would ever be throttled -- which is the defect a token-keyed limiter has.
select set_config('request.headers', '{"x-forwarded-for":"203.0.113.7, 10.0.0.1"}', true);

------------------------------------------------------------------------------------------------
-- 3-6. A wrong guess is recorded, and the eleventh in a minute is refused
------------------------------------------------------------------------------------------------
select lives_ok(
  $$select public.assert_guest_request_allowed('resident_portal', 'no-such-token-0')$$,
  'a single unknown token is allowed through -- the calling function gives its own refusal, so the gate adds no oracle'
);
select is(
  (select count(*)::integer from app_private.guest_token_failures
   where surface = 'resident_portal' and caller_key = 'ip:203.0.113.7'),
  1,
  'and it is written down, which is how a scan becomes visible before it succeeds'
);
select is(
  (select count(*)::integer from app_private.guest_token_failures
   where token_sha256 = 'no-such-token-0'),
  0,
  'the presented token is stored hashed, never as itself'
);

select lives_ok(
  $$select public.assert_guest_request_allowed('resident_portal', 'no-such-token-' || i)
    from generate_series(1, 9) i$$,
  'nine more unknown tokens from the same caller still pass'
);
select throws_ok(
  $$select public.assert_guest_request_allowed('resident_portal', 'no-such-token-11')$$,
  'P0001',
  null,
  'the eleventh in the same minute is refused -- by then the caller has said what they are doing'
);

------------------------------------------------------------------------------------------------
-- 7-9. A real link is not collateral damage, and a suspended account's links stop
------------------------------------------------------------------------------------------------
-- A different caller, because the one above has spent its unknown-token budget.
select set_config('request.headers', '{"x-forwarded-for":"203.0.113.8"}', true);
select lives_ok(
  $$select public.assert_guest_request_allowed('resident_portal', 'good-token-aaa')$$,
  'a live grant passes'
);
select is(
  (select count(*)::integer from app_private.guest_token_failures
   where caller_key = 'ip:203.0.113.8'),
  0,
  'and records no failure'
);
select throws_ok(
  $$select public.assert_guest_request_allowed('resident_portal', 'suspended-token-bbb')$$,
  '42501',
  null,
  'a suspended organization''s outstanding links stop working, without touching the grant rows'
);

------------------------------------------------------------------------------------------------
-- 10-11. The safety-report poster, including the legacy QR code
------------------------------------------------------------------------------------------------
select set_config('request.headers', '{"x-forwarded-for":"203.0.113.9"}', true);
select lives_ok(
  $$select public.assert_guest_request_allowed('safety_report', 'f8000000-0000-4000-8000-000000000011')$$,
  'a legacy poster carrying the facility UUID still resolves'
);
select is(
  (select count(*)::integer from app_private.guest_token_failures
   where caller_key = 'ip:203.0.113.9'),
  0,
  'and is not counted as a wrong guess -- those QR codes are real and printed'
);

------------------------------------------------------------------------------------------------
-- 12-13. The one issuer with no ceiling, and who may read the failures
------------------------------------------------------------------------------------------------
select ok(
  (select prosrc like '%30 days%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'issue_move_in_guest_grant'),
  'a move-in guest link is capped, like its three siblings, instead of lasting as long as somebody typed'
);
select ok(
  not has_function_privilege('anon', 'public.get_guest_access_health(integer)', 'EXECUTE'),
  'the failure log is not readable from the surface it is watching'
);

select * from finish();
rollback;
