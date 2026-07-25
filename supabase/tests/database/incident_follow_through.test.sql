begin;
select plan(34);

-- The claim this migration has to survive is that it changes nothing for incidents created the way
-- they are created today, and only adds behaviour when a pathway is deliberately chosen. Most of
-- these assertions exist to prove that the notification automation still fires exactly as it did.

select has_table('public', 'incident_pathways', 'the pathway catalogue exists');
select has_function('public', 'determine_incident_reportability', array['uuid', 'text', 'text'],
  'the reportability determination RPC exists');
select has_function('public', 'approve_incident_investigation', array['uuid', 'text'],
  'the administrator approval RPC exists');

-- Every pathway must record against a real incident_type. A pathway pointing at a type the check
-- constraint rejects would fail only at insert time, in production.
select is(
  (select count(*)::int from public.incident_pathways p
   where p.incident_type not in (
     'death','elopement','abuse_allegation','neglect_allegation','medication_error',
     'significant_injury','assault','fire','environmental_emergency','other')),
  0,
  'no pathway maps onto an incident_type the table would reject'
);

-- A presumed-reportable pathway must map onto a type that already had a notification preset,
-- otherwise "presumed reportable" would create a determination with no notifications behind it.
select is(
  (select count(*)::int from public.incident_pathways p
   where p.reportability = 'presumed_reportable'
     and p.incident_type not in (
       'death','abuse_allegation','neglect_allegation','assault','elopement',
       'medication_error','significant_injury','fire','environmental_emergency')),
  0,
  'every presumed-reportable pathway maps onto a type with notification presets'
);

-- Fixtures --------------------------------------------------------------------------
insert into public.organizations(id, name, slug, subscription_status) values
  ('e2000000-0000-4000-8000-000000000001', 'Incident Org', 'incident-org', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('e2000000-0000-4000-8000-000000000011', 'e2000000-0000-4000-8000-000000000001', 'Incident Facility', 'PCH');
insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', 'e2000000-0000-4000-8000-000000000101', 'authenticated', 'authenticated', 'e-admin@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('e2000000-0000-4000-8000-000000000101', 'e2000000-0000-4000-8000-000000000001', 'e-admin@test.local', 'Erin', 'Admin', 'org_admin', true)
on conflict(id) do update set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);
insert into public.residents(id, organization_id, facility_id, first_name, last_name, admission_date, status)
values ('e2000000-0000-4000-8000-000000000301', 'e2000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000011', 'Ellis', 'Resident', current_date - 60, 'active');

create or replace function pg_temp.act_as(p_id uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_id, 'role', p_role, 'aal', 'aal1',
    'iat', extract(epoch from now())::bigint)::text, true);
  if p_role = 'service_role' then set local role service_role; else set local role authenticated; end if;
end $$;

-- Behaviour preservation -------------------------------------------------------------
-- A death created exactly the way IncidentForm creates one: no pathway, no reportability passed.
select pg_temp.act_as('e2000000-0000-4000-8000-000000000101');
select lives_ok($$select public.create_incident_atomic(
  'e2000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000011',
  'death', now() - interval '3 hours', 'e2000000-0000-4000-8000-000000000301', null, 'Room 12',
  'Resident found unresponsive and pronounced by the responding crew.', 'critical',
  '[]'::jsonb, '[]'::jsonb, 'incident-death-key-1')$$,
  'a death is created with no pathway, exactly as the existing form does');

select is(
  (select reportability_status from public.incidents where idempotency_key = 'incident-death-key-1'),
  'reportable',
  'a death with no pathway is still treated as reportable, as it was before this migration'
);
select is(
  (select count(*)::int from public.incident_notifications n
   join public.incidents i on i.id = n.incident_id
   where i.idempotency_key = 'incident-death-key-1' and n.notification_type = 'state_hotline'),
  1,
  'the two-hour state hotline notification is still created automatically'
);

-- The hole the insert guard closes: a client cannot declare its own death not reportable.
select lives_ok($$insert into public.incidents(
  organization_id, facility_id, incident_type, occurred_at, resident_id, narrative, severity,
  reportability_status, idempotency_key
) values (
  'e2000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000011',
  'death', now() - interval '1 hour', 'e2000000-0000-4000-8000-000000000301',
  'Second death, inserted directly with a forged determination.', 'critical',
  'not_reportable', 'incident-death-key-2')$$,
  'a direct insert with a forged reportability value is accepted');
select is(
  (select reportability_status from public.incidents where idempotency_key = 'incident-death-key-2'),
  'reportable',
  'but the forged value is discarded and the type-derived determination wins'
);
select is(
  (select count(*)::int from public.incident_notifications n
   join public.incidents i on i.id = n.incident_id
   where i.idempotency_key = 'incident-death-key-2'),
  1,
  'so the required notification is created anyway'
);

-- A fall: significant_injury, but investigated through the fall pathway ---------------
select lives_ok($$select public.create_incident_atomic(
  'e2000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000011',
  'significant_injury', now() - interval '5 hours', 'e2000000-0000-4000-8000-000000000301', null,
  'Hallway', 'Resident found on the floor beside their walker, no obvious injury.', 'major',
  '[]'::jsonb, '[]'::jsonb, 'incident-fall-key-1')$$,
  'a fall is recorded as a significant_injury incident');

select ok(
  (select pathway_key is null from public.incidents where idempotency_key = 'incident-fall-key-1'),
  'the insert guard blanks any pathway supplied at creation'
);

select lives_ok($$select public.save_incident_pathway(
  (select id from public.incidents where idempotency_key = 'incident-fall-key-1'),
  'fall', '{"witnessed": "unwitnessed", "head_strike": "unknown"}'::jsonb, false)$$,
  'the fall pathway is attached after creation');

select throws_ok($$select public.save_incident_pathway(
  (select id from public.incidents where idempotency_key = 'incident-fall-key-1'),
  'medication_event', '{}'::jsonb, false)$$,
  '23514',
  null,
  'a pathway for a different incident_type is refused');

select is(
  (select status from public.incidents where idempotency_key = 'incident-fall-key-1'),
  'investigating',
  'attaching a pathway moves the incident out of reported'
);

-- The heart of item 13. A fall is recorded as significant_injury, which has a 24-hour state-hotline
-- preset, so one was auto-created at insert exactly as it always has been. Attaching the fall
-- pathway -- whose posture is determination_required -- hands that question back to a person.
select is(
  (select count(*)::int from public.incident_notifications n
   join public.incidents i on i.id = n.incident_id
   where i.idempotency_key = 'incident-fall-key-1'),
  1,
  'the type preset still auto-created a notification at insert, as it did before this migration'
);
select is(
  (select reportability_status from public.incidents where idempotency_key = 'incident-fall-key-1'),
  'pending_review',
  'attaching a determination-required pathway returns reportability to a human decision'
);

-- The reportability determination ----------------------------------------------------
select throws_ok($$select public.determine_incident_reportability(
  (select id from public.incidents where idempotency_key = 'incident-fall-key-1'),
  'not_reportable', 'no')$$,
  '22023',
  null,
  'a determination without a written rationale is refused');

select throws_ok($$select public.determine_incident_reportability(
  (select id from public.incidents where idempotency_key = 'incident-fall-key-1'),
  'maybe', 'A rationale long enough to pass the length check.')$$,
  '22023',
  null,
  'a determination must be one of the two real answers');

-- Determining it NOT reportable stands the auto-created preset down rather than deleting it: the
-- row survives with the reasoning attached, and stops counting as outstanding work.
select is(
  public.determine_incident_reportability(
    (select id from public.incidents where idempotency_key = 'incident-fall-key-1'),
    'not_reportable', 'Witnessed, no injury, no head strike; below the reporting threshold.'),
  0,
  'a not-reportable determination creates no notifications'
);
select is(
  (select n.status from public.incident_notifications n
   join public.incidents i on i.id = n.incident_id
   where i.idempotency_key = 'incident-fall-key-1'),
  'not_required',
  'the auto-created notification is stood down rather than deleted'
);
select ok(
  (select n.notes like '%below the reporting threshold%' from public.incident_notifications n
   join public.incidents i on i.id = n.incident_id
   where i.idempotency_key = 'incident-fall-key-1'),
  'and it carries the reasoning that stood it down'
);

-- Reversing the determination re-creates nothing, because the row is still there.
select is(
  public.determine_incident_reportability(
    (select id from public.incidents where idempotency_key = 'incident-fall-key-1'),
    'reportable', 'Reversed after the physician review found a possible head strike.'),
  0,
  'reversing the determination does not duplicate the existing notification row'
);
select is(
  (select count(*)::int from public.incident_notifications n
   join public.incidents i on i.id = n.incident_id
   where i.idempotency_key = 'incident-fall-key-1'),
  1,
  'and there is still exactly one notification for the incident'
);
-- A reversal that left the obligation dormant would be the worst outcome of this whole mechanism.
select isnt(
  (select n.status from public.incident_notifications n
   join public.incidents i on i.id = n.incident_id
   where i.idempotency_key = 'incident-fall-key-1'),
  'not_required',
  'the stood-down notification is reinstated rather than left dormant'
);

-- Approval gate ----------------------------------------------------------------------
select throws_ok($$select public.approve_incident_investigation(
  (select id from public.incidents where idempotency_key = 'incident-fall-key-1'), null)$$,
  '55000',
  null,
  'approval is refused while the investigation is incomplete');

select lives_ok($$select public.save_incident_investigation_step(
  (select id from public.incidents where idempotency_key = 'incident-fall-key-1'),
  'Assisted to bed, vitals taken, physician called.',
  'Resident reached for the call bell without their walker.',
  'The call bell was mounted out of reach from the chair.',
  'five_whys')$$,
  'the investigation steps are recorded');

select throws_ok($$select public.save_incident_investigation_step(
  (select id from public.incidents where idempotency_key = 'incident-fall-key-1'),
  null, null, null, 'gut_feeling')$$,
  '22023',
  null,
  'an unrecognized root cause method is refused');

-- Closure gate -----------------------------------------------------------------------
-- Closure still requires the final report; the approval requirement is additional, never a
-- replacement for it.
select throws_ok($$update public.incidents
  set status = 'closed'
  where idempotency_key = 'incident-fall-key-1'$$,
  '23514',
  null,
  'an incident cannot be closed without the final report, exactly as before');

select lives_ok($$update public.incidents
  set final_report_submitted_at = now()
  where idempotency_key = 'incident-fall-key-1'$$,
  'the final report submission is recorded');

select throws_ok($$update public.incidents
  set status = 'closed'
  where idempotency_key = 'incident-fall-key-1'$$,
  '23514',
  null,
  'and it still cannot be closed without administrator approval');

-- QAPI consideration -----------------------------------------------------------------
select throws_ok($$select public.set_incident_qapi_consideration(
  (select id from public.incidents where idempotency_key = 'incident-fall-key-1'),
  'linked', null, null)$$,
  '22023',
  null,
  'linking to QAPI without naming a project is refused');

select lives_ok($$select public.set_incident_qapi_consideration(
  (select id from public.incidents where idempotency_key = 'incident-fall-key-1'),
  'not_indicated', null, 'Single event, no pattern across the quarter.')$$,
  'recording that QAPI is not indicated is accepted as an answer');

select * from finish();
rollback;
