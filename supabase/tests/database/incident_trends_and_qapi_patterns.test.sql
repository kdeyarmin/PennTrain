begin;
select plan(16);

select has_function('public', 'get_incident_trend_records', array['uuid', 'timestamptz', 'timestamptz'],
  'the trend read path exists');
select has_column('public', 'qapi_projects', 'pattern_key', 'QAPI projects can carry a pattern key');

-- The old 12-argument create_qapi_project must be gone, not merely shadowed: leaving both makes
-- every existing 12-argument call ambiguous.
select is(
  (select count(*)::int from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_qapi_project'),
  1,
  'exactly one create_qapi_project signature exists'
);

-- Fixtures --------------------------------------------------------------------------
insert into public.organizations(id, name, slug, subscription_status) values
  ('f3000000-0000-4000-8000-000000000001', 'Trend Org', 'trend-org', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('f3000000-0000-4000-8000-000000000011', 'f3000000-0000-4000-8000-000000000001', 'Trend Facility', 'PCH');
insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', 'f3000000-0000-4000-8000-000000000101', 'authenticated', 'authenticated', 'f-admin@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('f3000000-0000-4000-8000-000000000101', 'f3000000-0000-4000-8000-000000000001', 'f-admin@test.local', 'Frankie', 'Admin', 'org_admin', true)
on conflict(id) do update set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);
insert into public.residents(id, organization_id, facility_id, first_name, last_name, admission_date, status)
values ('f3000000-0000-4000-8000-000000000301', 'f3000000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000011', 'Frances', 'Resident', public.pa_today() - 90, 'active');

create or replace function pg_temp.act_as(p_id uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_id, 'role', p_role, 'aal', 'aal1',
    'iat', extract(epoch from now())::bigint)::text, true);
  if p_role = 'service_role' then set local role service_role; else set local role authenticated; end if;
end $$;

select pg_temp.act_as('f3000000-0000-4000-8000-000000000101');
select lives_ok($$select public.create_incident_atomic(
  'f3000000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000011',
  'significant_injury', now() - interval '10 days', 'f3000000-0000-4000-8000-000000000301', null,
  'Bathroom', 'Resident found on the bathroom floor.', 'major',
  '[]'::jsonb, '[]'::jsonb, 'trend-fall-key-1')$$,
  'an in-window incident is recorded');
select lives_ok($$select public.create_incident_atomic(
  'f3000000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000011',
  'significant_injury', now() - interval '400 days', 'f3000000-0000-4000-8000-000000000301', null,
  'Bathroom', 'A much older fall, outside the window under test.', 'major',
  '[]'::jsonb, '[]'::jsonb, 'trend-fall-key-old')$$,
  'an out-of-window incident is recorded');

-- Window handling --------------------------------------------------------------------
select throws_ok($$select public.get_incident_trend_records(
  'f3000000-0000-4000-8000-000000000011', now(), now() - interval '1 day')$$,
  '22023', null, 'a window that ends before it starts is refused');

select throws_ok($$select public.get_incident_trend_records(
  'f3000000-0000-4000-8000-000000000011', now() - interval '900 days', now())$$,
  '22023', null, 'a window longer than 730 days is refused');

select is(
  jsonb_array_length(public.get_incident_trend_records(
    'f3000000-0000-4000-8000-000000000011', now() - interval '90 days', now()) -> 'incidents'),
  1,
  'the window excludes incidents outside it'
);

select is(
  public.get_incident_trend_records(
    'f3000000-0000-4000-8000-000000000011', now() - interval '90 days', now())
    -> 'incidents' -> 0 ->> 'resident_display',
  'Frances Resident',
  'each row carries a resident label so a trend can be read without a second query'
);

select is(
  public.get_incident_trend_records(
    'f3000000-0000-4000-8000-000000000011', now() - interval '90 days', now())
    -> 'incidents' -> 0 ->> 'location_detail',
  'Bathroom',
  'and the location the by-location trend groups on'
);

-- Pattern-keyed projects -------------------------------------------------------------
select lives_ok($$select public.create_qapi_project(
  'f3000000-0000-4000-8000-000000000011', 'Repeated falls - Frances Resident',
  'Frances Resident experienced repeated falls in the last 90 days.',
  '3 falls in the last 90 days', '3 falls', 'Reduce falls', 'Zero falls in 90 days',
  0, public.pa_today() + 90, 'f3000000-0000-4000-8000-000000000101',
  null, null, 'repeated_falls_resident:f3000000-0000-4000-8000-000000000301')$$,
  'a project is opened from a recommendation');

select is(
  (select pattern_key from public.qapi_projects where organization_id = 'f3000000-0000-4000-8000-000000000001'),
  'repeated_falls_resident:f3000000-0000-4000-8000-000000000301',
  'the pattern key is stored on the project'
);

-- Acting on the same recommendation twice returns the existing project rather than raising: the
-- second click is not an error, and it must not create a second project for one problem.
select is(
  public.create_qapi_project(
    'f3000000-0000-4000-8000-000000000011', 'Repeated falls - Frances Resident (again)',
    'A second attempt at the same pattern.',
    '3 falls in the last 90 days', '3 falls', 'Reduce falls', 'Zero falls in 90 days',
    0, public.pa_today() + 90, 'f3000000-0000-4000-8000-000000000101',
    null, null, 'repeated_falls_resident:f3000000-0000-4000-8000-000000000301'),
  (select id from public.qapi_projects where organization_id = 'f3000000-0000-4000-8000-000000000001'),
  'opening the same pattern twice returns the project that already exists'
);

select is(
  (select count(*)::int from public.qapi_projects where organization_id = 'f3000000-0000-4000-8000-000000000001'),
  1,
  'and no duplicate project was created'
);

-- The project-lead access check from 20260726000400 must survive every later re-declaration of
-- create_qapi_project. It was dropped once by a re-declaration that copied the original body, so it
-- is asserted here rather than trusted.
select throws_ok($$select public.create_qapi_project(
  'f3000000-0000-4000-8000-000000000011', 'Lead from nowhere',
  'A project naming a lead who cannot access this facility.',
  'Manager judgement', null, null, null,
  null, public.pa_today() + 90, 'f3000000-0000-4000-8000-000000000301')$$,
  '23514',
  null,
  'a project lead who is not an active manager for this facility is refused');

-- A project with no pattern key is unaffected by the partial unique index, so ordinary projects can
-- still be created freely.
select lives_ok($$select public.create_qapi_project(
  'f3000000-0000-4000-8000-000000000011', 'An ordinary project',
  'A project created without any pattern behind it.',
  'Manager judgement', null, null, null,
  null, public.pa_today() + 90, 'f3000000-0000-4000-8000-000000000101')$$,
  'projects without a pattern key are still unrestricted');

select * from finish();
rollback;
