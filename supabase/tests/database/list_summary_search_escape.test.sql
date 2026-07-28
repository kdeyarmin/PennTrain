begin;
select plan(14);

-- Companion to work_item_queue_search_escape.test.sql, for the four list-summary routines that
-- 20260724190003 did not cover: get_resident_list_summary, get_incident_list_summary,
-- get_complaint_list_summary and get_survey_day_staff_roster. Each interpolated the raw search
-- string into ILIKE, so '%', '_' and '\' were read as LIKE metacharacters -- a bare '%' matched
-- every row and 'P_ain' matched 'Plain'. These functions feed the metric tiles above each list, so
-- an unescaped search made the tiles report unfiltered totals while the operator believed they
-- were reading a filtered view.

insert into public.organizations(id, name, slug, subscription_status) values
  ('c1000000-0000-4000-8000-000000000001', 'Escape Summary Org', 'escape-summary-org', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('c1000000-0000-4000-8000-000000000011', 'c1000000-0000-4000-8000-000000000001', 'Escape Summary Home', 'PCH');
insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', 'c1000000-0000-4000-8000-000000000101', 'authenticated', 'authenticated', 'escape-summary-admin@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('c1000000-0000-4000-8000-000000000101', 'c1000000-0000-4000-8000-000000000001', 'escape-summary-admin@test.local', 'Escape', 'Summary', 'org_admin', true)
on conflict(id) do update set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);

-- Exactly one resident/incident/complaint/employee carries the metacharacters literally; the other
-- two carry none. A literal search therefore answers 1 and a wildcard interpretation answers 3.
insert into public.residents(id, organization_id, facility_id, first_name, last_name, status, admission_date) values
  ('c1000000-0000-4000-8000-000000000201', 'c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000011', 'Ann', '100%_Pct', 'active', current_date),
  ('c1000000-0000-4000-8000-000000000202', 'c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000011', 'Bob', 'Plain', 'active', current_date),
  ('c1000000-0000-4000-8000-000000000203', 'c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000011', 'Cal', 'Ordinary', 'active', current_date);

insert into public.incidents(
  id, organization_id, facility_id, resident_id, incident_type, severity, status,
  occurred_at, narrative, reported_by_profile_id
) values
  ('c1000000-0000-4000-8000-000000000301', 'c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000011', 'c1000000-0000-4000-8000-000000000201', 'assault', 'minor', 'reported', now(), 'Progress at 100%_Pct complete', 'c1000000-0000-4000-8000-000000000101'),
  ('c1000000-0000-4000-8000-000000000302', 'c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000011', 'c1000000-0000-4000-8000-000000000202', 'assault', 'minor', 'reported', now(), 'Plain narrative', 'c1000000-0000-4000-8000-000000000101'),
  ('c1000000-0000-4000-8000-000000000303', 'c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000011', 'c1000000-0000-4000-8000-000000000203', 'assault', 'minor', 'reported', now(), 'Ordinary narrative', 'c1000000-0000-4000-8000-000000000101');

insert into public.complaints(
  id, organization_id, facility_id, complaint_number, method_received, complainant_type,
  category, complainant_name, date_received, status, immediate_risk, description
) values
  ('c1000000-0000-4000-8000-000000000401', 'c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000011', 'CMP-100%_Pct', 'phone', 'family', 'service', 'Ann Percent', current_date, 'received', 'low', 'Literal metacharacters in the complaint number'),
  ('c1000000-0000-4000-8000-000000000402', 'c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000011', 'CMP-Plain', 'phone', 'family', 'service', 'Bob Plain', current_date, 'received', 'low', 'No metacharacters anywhere in this one'),
  ('c1000000-0000-4000-8000-000000000403', 'c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000011', 'CMP-Ordinary', 'phone', 'family', 'service', 'Cal Ordinary', current_date, 'received', 'low', 'No metacharacters anywhere in this one');

insert into public.employees(id, organization_id, facility_id, first_name, last_name, job_title, status, hire_date) values
  ('c1000000-0000-4000-8000-000000000501', 'c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000011', 'Ann', '100%_Pct', 'Aide', 'active', current_date),
  ('c1000000-0000-4000-8000-000000000502', 'c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000011', 'Bob', 'Plain', 'Aide', 'active', current_date),
  ('c1000000-0000-4000-8000-000000000503', 'c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000011', 'Cal', 'Ordinary', 'Aide', 'active', current_date);

insert into public.survey_day_sessions(id, organization_id, facility_id, status, activated_by)
values ('c1000000-0000-4000-8000-000000000601', 'c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000011', 'active', 'c1000000-0000-4000-8000-000000000101');

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

select pg_temp.act_as('c1000000-0000-4000-8000-000000000101');

-- Residents --------------------------------------------------------------------------------------
select is(
  (public.get_resident_list_summary('c1000000-0000-4000-8000-000000000011', null, '%') ->> 'residents')::integer,
  1,
  'a bare percent matches only the resident whose name contains a literal percent'
);
select is(
  (public.get_resident_list_summary('c1000000-0000-4000-8000-000000000011', null, '_') ->> 'residents')::integer,
  1,
  'a bare underscore matches only the resident with a literal underscore'
);
select is(
  (public.get_resident_list_summary('c1000000-0000-4000-8000-000000000011', null, 'P_ain') ->> 'residents')::integer,
  0,
  'an underscore does not stand in for a character in the middle of a resident search'
);
select is(
  (public.get_resident_list_summary('c1000000-0000-4000-8000-000000000011', null, 'Plain') ->> 'residents')::integer,
  1,
  'an ordinary resident search is unaffected by the escaping'
);
select is(
  (public.get_resident_list_summary('c1000000-0000-4000-8000-000000000011', null, '100%_Pct') ->> 'residents')::integer,
  1,
  'the full literal term still matches its own resident'
);

-- Incidents --------------------------------------------------------------------------------------
select is(
  (public.get_incident_list_summary('c1000000-0000-4000-8000-000000000011', null, null, null, '%') ->> 'total')::integer,
  1,
  'a bare percent matches only the incident containing a literal percent'
);
select is(
  (public.get_incident_list_summary('c1000000-0000-4000-8000-000000000011', null, null, null, '_') ->> 'total')::integer,
  1,
  'a bare underscore matches only the incident with a literal underscore'
);
select is(
  (public.get_incident_list_summary('c1000000-0000-4000-8000-000000000011', null, null, null, 'Plain') ->> 'total')::integer,
  1,
  'an ordinary incident search is unaffected by the escaping'
);

-- Complaints -------------------------------------------------------------------------------------
select is(
  (public.get_complaint_list_summary('c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000011', null, null, '%') ->> 'total')::integer,
  1,
  'a bare percent matches only the complaint number containing a literal percent'
);
select is(
  (public.get_complaint_list_summary('c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000011', null, null, '_') ->> 'total')::integer,
  1,
  'a bare underscore matches only the complaint with a literal underscore'
);
select is(
  (public.get_complaint_list_summary('c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000011', null, null, 'CMP-Plain') ->> 'total')::integer,
  1,
  'an ordinary complaint search is unaffected by the escaping'
);

-- Survey Day roster ------------------------------------------------------------------------------
-- The roster returns count and rows from two separate reads of the same term, so both must agree.
select is(
  (public.get_survey_day_staff_roster('c1000000-0000-4000-8000-000000000601', '%') ->> 'count')::integer,
  1,
  'a bare percent matches only the employee whose name contains a literal percent'
);
select is(
  jsonb_array_length(public.get_survey_day_staff_roster('c1000000-0000-4000-8000-000000000601', '%') -> 'rows'),
  1,
  'the roster page agrees with its own count when the search carries a metacharacter'
);
select is(
  (public.get_survey_day_staff_roster('c1000000-0000-4000-8000-000000000601', 'P_ain') ->> 'count')::integer,
  0,
  'an underscore does not stand in for a character in the Survey Day roster search'
);

select * from finish();
rollback;
