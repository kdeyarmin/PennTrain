begin;
select plan(15);

select has_table('public', 'survey_day_surveyors', 'the surveyor roster exists');
select has_table('public', 'survey_day_requests', 'the request log exists');
select has_table('public', 'survey_day_observations', 'the observation log exists');
select has_function('public', 'get_survey_day_packet', array['uuid'], 'the packet read path exists');

-- Fixtures --------------------------------------------------------------------------
insert into public.organizations(id, name, slug, subscription_status) values
  ('f9000000-0000-4000-8000-000000000001', 'Survey Org', 'survey-org', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('f9000000-0000-4000-8000-000000000011', 'f9000000-0000-4000-8000-000000000001', 'Survey Facility', 'PCH');
insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', 'f9000000-0000-4000-8000-000000000101', 'authenticated', 'authenticated', 'f9-admin@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('f9000000-0000-4000-8000-000000000101', 'f9000000-0000-4000-8000-000000000001', 'f9-admin@test.local', 'Frankie', 'Admin', 'org_admin', true)
on conflict(id) do update set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);

-- The session is created directly: activate_survey_day gates on the survey_day_mode entitlement,
-- and this suite is about the workspace on top of a session rather than about that gate.
insert into public.survey_day_sessions(
  id, organization_id, facility_id, status, activated_by
) values (
  'f9000000-0000-4000-8000-000000000601', 'f9000000-0000-4000-8000-000000000001',
  'f9000000-0000-4000-8000-000000000011', 'active', 'f9000000-0000-4000-8000-000000000101'
);

-- Surveyors and requests -----------------------------------------------------------------
insert into public.survey_day_surveyors(
  id, session_id, organization_id, facility_id, surveyor_name, title, agency, is_lead
) values (
  'f9000000-0000-4000-8000-000000000611', 'f9000000-0000-4000-8000-000000000601',
  'f9000000-0000-4000-8000-000000000001', 'f9000000-0000-4000-8000-000000000011',
  'R. Surveyor', 'Licensing Representative', 'PA DHS', true
);

insert into public.survey_day_requests(
  id, session_id, organization_id, facility_id, surveyor_id, request_text, due_at
) values (
  'f9000000-0000-4000-8000-000000000621', 'f9000000-0000-4000-8000-000000000601',
  'f9000000-0000-4000-8000-000000000001', 'f9000000-0000-4000-8000-000000000011',
  'f9000000-0000-4000-8000-000000000611',
  'Staffing schedules for the last 30 days', now() - interval '10 minutes'
);

-- A request marked provided with no record of what was provided is the gap the table exists to
-- close: "we gave them something" is not an answer three months later.
select throws_ok($$update public.survey_day_requests
  set status = 'provided', provided_at = now()
  where id = 'f9000000-0000-4000-8000-000000000621'$$,
  '23514',
  null,
  'a request cannot be marked provided without recording what was provided');

select is(
  (public.get_survey_day_packet('f9000000-0000-4000-8000-000000000601') ->> 'openRequests')::int,
  1,
  'an unresolved request is counted as open'
);
select is(
  (public.get_survey_day_packet('f9000000-0000-4000-8000-000000000601') ->> 'overdueRequests')::int,
  1,
  'and one past its deadline is counted as overdue, which is the number that matters mid-survey'
);

update public.survey_day_requests
set status = 'provided', provided_at = now(), provided_note = 'Printed schedules for 25 June to 25 July.'
where id = 'f9000000-0000-4000-8000-000000000621';
select is(
  (public.get_survey_day_packet('f9000000-0000-4000-8000-000000000601') ->> 'openRequests')::int,
  0,
  'a resolved request stops being open'
);

-- Observations and findings ----------------------------------------------------------------
insert into public.survey_day_observations(
  session_id, organization_id, facility_id, entry_type, summary, subject_role
) values
  ('f9000000-0000-4000-8000-000000000601', 'f9000000-0000-4000-8000-000000000001',
   'f9000000-0000-4000-8000-000000000011', 'interview',
   'Surveyor spoke with a direct care worker about medication procedures.', 'Direct care staff'),
  ('f9000000-0000-4000-8000-000000000601', 'f9000000-0000-4000-8000-000000000001',
   'f9000000-0000-4000-8000-000000000011', 'observation',
   'Surveyor observed the lunch service in the main dining room.', null);

select is(
  jsonb_array_length(public.get_survey_day_packet('f9000000-0000-4000-8000-000000000601') -> 'interviews'),
  1,
  'interviews are separated from observations in the packet'
);
select is(
  jsonb_array_length(public.get_survey_day_packet('f9000000-0000-4000-8000-000000000601') -> 'observations'),
  1,
  'and observations from interviews'
);

-- A disposition only makes sense on a finding.
select throws_ok($$insert into public.survey_day_observations(
  session_id, organization_id, facility_id, entry_type, summary, finding_disposition
) values (
  'f9000000-0000-4000-8000-000000000601', 'f9000000-0000-4000-8000-000000000001',
  'f9000000-0000-4000-8000-000000000011', 'observation',
  'An observation that claims to have a finding disposition.', 'accepted'
)$$,
  '23514',
  null,
  'a disposition on something that is not a finding is refused');

-- Disputing a finding without saying why is worse than recording it plainly.
select throws_ok($$insert into public.survey_day_observations(
  session_id, organization_id, facility_id, entry_type, summary, finding_disposition
) values (
  'f9000000-0000-4000-8000-000000000601', 'f9000000-0000-4000-8000-000000000001',
  'f9000000-0000-4000-8000-000000000011', 'potential_finding',
  'Medication record gap identified in room 12.', 'disputed'
)$$,
  '23514',
  null,
  'a disputed finding requires the basis for disputing it');

insert into public.survey_day_observations(
  session_id, organization_id, facility_id, entry_type, summary, citation, finding_disposition, finding_basis
) values (
  'f9000000-0000-4000-8000-000000000601', 'f9000000-0000-4000-8000-000000000001',
  'f9000000-0000-4000-8000-000000000011', 'potential_finding',
  'Medication record gap identified in room 12.', '2600.181', 'disputed',
  'The MAR entry exists on the paper record signed the same shift.'
);
select is(
  public.get_survey_day_packet('f9000000-0000-4000-8000-000000000601')
    -> 'potentialFindings' -> 0 ->> 'citation',
  '2600.181',
  'a potential finding carries the citation it is about'
);

-- Writes are refused once the session is closed ---------------------------------------------
-- A closed session is the record of a survey that finished; appending later would change what the
-- facility says happened on the day.
update public.survey_day_sessions set status = 'closed', closed_at = now()
where id = 'f9000000-0000-4000-8000-000000000601';

-- aal2 with a current `iat`: assert_survey_day_manager requires a fresh step-up, and it runs BEFORE
-- the closed-session check -- correctly, since a caller who is not allowed to write should not learn
-- the session's state from the error. An aal1 claim here would fail on 42501 and never reach the
-- behaviour this assertion is about.
create or replace function pg_temp.act_as(p_id uuid)
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_id, 'role', 'authenticated', 'aal', 'aal2',
    'iat', extract(epoch from now())::bigint)::text, true);
  set local role authenticated;
end $$;

select pg_temp.act_as('f9000000-0000-4000-8000-000000000101');
select throws_ok($$select public.record_survey_day_observation(
  'f9000000-0000-4000-8000-000000000601', 'observation', 'Recorded after the survey closed.')$$,
  '55000',
  null,
  'a closed session cannot be added to');
reset role;

-- The packet still reads after closure: it is the record of what happened.
select is(
  public.get_survey_day_packet('f9000000-0000-4000-8000-000000000601') ->> 'status',
  'closed',
  'and the packet still reads afterwards, because it is the record'
);

select * from finish();
rollback;
