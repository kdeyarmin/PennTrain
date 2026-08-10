begin;
select plan(6);

-- The incident KPI cards count Pennsylvania calendar days, not UTC ones.
--
-- get_incident_list_summary bounded 'reported last 7/30 days' with `(p_today + 1)::timestamptz`,
-- which on a UTC database ends "today" at 20:00 ET -- so an incident logged at 21:30 stayed in
-- the list but vanished from the card until the UTC day rolled over, and a week-old evening
-- incident lingered one day too long. 20260810111000 moved the bounds to public.pa_midnight().
--
-- The probes below pin both edges with fixed January instants (EST, UTC-5), deterministic in any
-- session timezone and on any date the suite runs. Each probe gets its OWN facility on purpose:
-- against a shared facility the UTC windows lose one incident off the top edge and gain one off
-- the bottom edge, the count comes out 1 either way, and the assertion proves nothing.

insert into public.organizations(id, name, slug, subscription_status) values
  ('d7000000-0000-4000-8000-000000000001', 'Facility Day Org', 'facility-day-org', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('d7000000-0000-4000-8000-000000000011', 'd7000000-0000-4000-8000-000000000001', 'Facility Day Home', 'PCH'),
  ('d7000000-0000-4000-8000-000000000012', 'd7000000-0000-4000-8000-000000000001', 'Facility Day Annex', 'PCH');
insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', 'd7000000-0000-4000-8000-000000000101', 'authenticated', 'authenticated', 'facility-day-admin@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('d7000000-0000-4000-8000-000000000101', 'd7000000-0000-4000-8000-000000000001', 'facility-day-admin@test.local', 'Facility', 'Day', 'org_admin', true)
on conflict(id) do update set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);

insert into public.residents(id, organization_id, facility_id, first_name, last_name, status, admission_date) values
  ('d7000000-0000-4000-8000-000000000201', 'd7000000-0000-4000-8000-000000000001', 'd7000000-0000-4000-8000-000000000011', 'Eve', 'Ning', 'active', date '2025-06-01'),
  ('d7000000-0000-4000-8000-000000000202', 'd7000000-0000-4000-8000-000000000001', 'd7000000-0000-4000-8000-000000000012', 'Wee', 'Kold', 'active', date '2025-06-01');

-- Two probes around p_today = 2026-01-15 (EST, so the PA day runs 05:00Z to 05:00Z):
--   * home (011): 2026-01-16 02:30Z is 21:30 ET on the 15th -- inside the day, past UTC midnight;
--   * annex (012): 2026-01-08 03:00Z is 22:00 ET on the 7th -- before the 7-day window opens at
--     pa_midnight(2026-01-08) = 05:00Z, but after the old UTC bound of 00:00Z.
insert into public.incidents(
  id, organization_id, facility_id, resident_id, incident_type, severity, status,
  occurred_at, narrative, reported_by_profile_id
) values
  ('d7000000-0000-4000-8000-000000000301', 'd7000000-0000-4000-8000-000000000001', 'd7000000-0000-4000-8000-000000000011', 'd7000000-0000-4000-8000-000000000201', 'significant_injury', 'minor', 'reported', timestamptz '2026-01-16 02:30:00+00', 'Evening probe reported after UTC midnight', 'd7000000-0000-4000-8000-000000000101'),
  ('d7000000-0000-4000-8000-000000000302', 'd7000000-0000-4000-8000-000000000001', 'd7000000-0000-4000-8000-000000000012', 'd7000000-0000-4000-8000-000000000202', 'significant_injury', 'minor', 'reported', timestamptz '2026-01-08 03:00:00+00', 'Stale probe from the evening before the window opens', 'd7000000-0000-4000-8000-000000000101');

create or replace function pg_temp.act_as(p_id uuid)
returns void language plpgsql as $$
begin
  reset role;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', p_id, 'role', 'authenticated', 'aal', 'aal2', 'iat', extract(epoch from now())::bigint)::text,
    true
  );
  set local role authenticated;
end;
$$;

select pg_temp.act_as('d7000000-0000-4000-8000-000000000101');

select is(
  (public.get_incident_list_summary('d7000000-0000-4000-8000-000000000011', null, null, null, null, date '2026-01-15') ->> 'total')::integer,
  1,
  'the evening probe is visible to the summary at all -- the window assertions are not vacuous'
);

select is(
  (public.get_incident_list_summary('d7000000-0000-4000-8000-000000000012', null, null, null, null, date '2026-01-15') ->> 'total')::integer,
  1,
  'the stale probe is visible to the summary at all'
);

select is(
  (public.get_incident_list_summary('d7000000-0000-4000-8000-000000000011', null, null, null, null, date '2026-01-15') ->> 'reportedLast7Days')::integer,
  1,
  'an incident at 21:30 ET is still today -- it must not fall off the card at the UTC midnight'
);

select is(
  (public.get_incident_list_summary('d7000000-0000-4000-8000-000000000012', null, null, null, null, date '2026-01-15') ->> 'reportedLast7Days')::integer,
  0,
  'an incident from the evening before the window opened is not in the last 7 days'
);

select is(
  (public.get_incident_list_summary('d7000000-0000-4000-8000-000000000012', null, null, null, null, date '2026-01-15') ->> 'reportedLast30Days')::integer,
  1,
  'the 30-day window opens at a Pennsylvania midnight too, and still holds the stale probe'
);

reset role;

-- The prosrc ratchet in pa_day_is_the_facility_day.test.sql cannot see a `default current_date`
-- in a function SIGNATURE, which is where this function kept one until 20260810111000 -- any
-- caller omitting p_today was querying tomorrow's window all evening. Pinned here instead.
select ok(
  (select pg_get_function_arguments(p.oid) !~* '\mcurrent_date\M'
   from pg_catalog.pg_proc p
   join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_incident_list_summary'),
  'get_incident_list_summary does not default p_today to current_date -- null falls back to pa_today()'
);

select * from finish();
rollback;
