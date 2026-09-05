-- pgTAP coverage for 20260905220000 (I22): a limiter that charged the customer for our outage, and
-- a break-glass grant that granted nothing.
--
-- The signup cap counted every attempt for an email address in the last day regardless of what
-- became of it -- including `invite_failed`, which is what a misconfigured SMTP produces. Three
-- tries during an outage of ours locked a prospective customer out for a day.
-- Run with: supabase test db.

begin;
select plan(12);

set local role service_role;

------------------------------------------------------------------------------------------------
-- 1-5. A platform fault does not spend the caller's quota
------------------------------------------------------------------------------------------------
select has_column(
  'public', 'signup_attempts', 'counts_toward_rate_limit',
  'each attempt records whether the caller is answerable for it'
);

-- Three attempts, each dying the way a first customer's does while our mail is misconfigured.
select public.finalize_signup_attempt(
  public.reserve_signup_attempt(repeat('1', 64), repeat('9', 64), 50, 3, 50, true, 'v1', 'v1'),
  false, 'invite_failed')
from generate_series(1, 3);

select is(
  (select count(*)::integer from public.signup_attempts where email_hash = repeat('1', 64)),
  3,
  'all three attempts are recorded -- the evidence is not what changed'
);
select is(
  (select count(*)::integer from public.signup_attempts
   where email_hash = repeat('1', 64) and counts_toward_rate_limit),
  0,
  'and none of them counts against the caller: the invitation failed because we could not send it'
);
select lives_ok(
  $$select public.reserve_signup_attempt(repeat('1', 64), repeat('9', 64), 50, 3, 50, true, 'v1', 'v1')$$,
  'so a fourth attempt is accepted rather than refused for the rest of the day'
);

-- A caller-side failure still spends the quota, because that is what the cap is for.
select public.finalize_signup_attempt(
  public.reserve_signup_attempt(repeat('2', 64), repeat('8', 64), 50, 3, 50, true, 'v1', 'v1'),
  false, 'turnstile_failed')
from generate_series(1, 3);
select throws_ok(
  $$select public.reserve_signup_attempt(repeat('2', 64), repeat('8', 64), 50, 3, 50, true, 'v1', 'v1')$$,
  'P0001',
  'signup_email_rate_limited',
  'three failed challenges from the same address still exhaust the daily cap'
);

-- And a success counts: a second organization for one email address is the case the cap exists for.
select public.finalize_signup_attempt(
  public.reserve_signup_attempt(repeat('3', 64), repeat('7', 64), 50, 1, 50, true, 'v1', 'v1'),
  true, null);
select throws_ok(
  $$select public.reserve_signup_attempt(repeat('3', 64), repeat('7', 64), 50, 1, 50, true, 'v1', 'v1')$$,
  'P0001',
  'signup_email_rate_limited',
  'and a successful signup spends the quota it used'
);

------------------------------------------------------------------------------------------------
-- 6-11. Break-glass records an authorization; it does not confer one
------------------------------------------------------------------------------------------------
-- Stated as an invariant rather than as prose: if a later change makes a permission helper or an
-- RLS policy read this table, that is a live privilege-escalation path and this fails.
select is(
  (select count(*)::integer from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'app_private')
     and p.prosrc like '%identity_break_glass_events%'
     and p.proname not in (
       'grant_identity_break_glass', 'revoke_identity_break_glass', 'get_identity_control_plane')),
  0,
  'only the two writers and the read-only control plane touch identity_break_glass_events'
);
select is(
  (select count(*)::integer from pg_policies
   where coalesce(qual, '') || coalesce(with_check, '') like '%identity_break_glass_events%'),
  0,
  'no row-level security policy consults it, so a record widens nothing'
);
select ok(
  (select prosrc not like '%identity_break_glass_events%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'has_effective_permission'),
  'and the permission helper itself has never heard of it'
);

-- The surfaces have to say so, because an operator reading "elevated access" at 3am will believe
-- somebody now has it.
select matches(
  obj_description('public.identity_break_glass_events'::regclass, 'pg_class'),
  'confers no permissions',
  'the table says outright that it confers nothing'
);
select matches(
  obj_description(
    (select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'grant_identity_break_glass'),
    'pg_proc'),
  'does NOT change anyone',
  'and so does the function whose name says "grant"'
);
select ok(
  has_function_privilege('authenticated', 'public.grant_identity_break_glass(uuid, uuid, text, text, timestamptz)', 'EXECUTE'),
  'the RPC is still reachable -- the record is worth making, which is why this was relabelled rather than removed'
);

select * from finish();
rollback;
