-- BACKLOG.md J74 (P3 long tail), section 4.3 "Safety / incidents / survey" and "Resident care".
-- Pins the six defects 20260906270000 fixed. Each block names the behaviour that was wrong.
begin;
select plan(24);

------------------------------------------------------------------------------------------------
-- 1-6. The 48-hour written report exists, as data, with the same anchor as the department call
------------------------------------------------------------------------------------------------
select has_function(
  'public', 'inspection_item_due_soon_lead_days', array['text', 'integer'],
  'the due_soon lead time is a function, so one rule decides it for every schedule'
);

select is(
  (select count(*)::int
   from public.incident_notification_rules call
   where call.notification_type = 'state_hotline' and call.is_active
     and not exists (
       select 1 from public.incident_notification_rules report
       where report.incident_type = call.incident_type
         and report.notification_type = 'written_report'
         and report.is_active)),
  0,
  'every incident type that owes the department a call also owes the written report that follows it'
);

select is(
  (select count(distinct due_hours)::int from public.incident_notification_rules
   where notification_type = 'written_report' and is_active),
  1,
  'the written-report window is one number, not one per type'
);
select is(
  (select distinct due_hours from public.incident_notification_rules
   where notification_type = 'written_report' and is_active),
  48,
  'and that number is 48 hours'
);
-- The same posture I10 gave the two-hour rows: the deadline is visible and dated, and the fact that
-- this repository has not read it against 55 Pa. Code is in the data rather than in a commit message.
select is(
  (select count(*)::int from public.incident_notification_rules
   where notification_type = 'written_report' and source_confidence <> 'unverified'),
  0,
  'the written-report window is marked unverified until someone reads the regulation against it'
);
select ok(
  (select bool_and(length(btrim(citation)) >= 3) from public.incident_notification_rules
   where notification_type = 'written_report'),
  'and it names a citation, because the column refuses a deadline nobody can source'
);

------------------------------------------------------------------------------------------------
-- Fixture
------------------------------------------------------------------------------------------------
insert into public.organizations (id, name, slug, subscription_status) values
  ('d1000000-0000-4000-8000-000000000001', 'Clock Org', 'clock-org', 'active');
insert into public.facilities (id, organization_id, name, facility_type) values
  ('d1000000-0000-4000-8000-000000000011', 'd1000000-0000-4000-8000-000000000001', 'Clock Facility', 'PCH');
insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', 'd1000000-0000-4000-8000-000000000101', 'authenticated', 'authenticated', 'clock-admin@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', 'd1000000-0000-4000-8000-000000000102', 'authenticated', 'authenticated', 'clock-aide@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('d1000000-0000-4000-8000-000000000101', 'd1000000-0000-4000-8000-000000000001', 'clock-admin@test.local', 'Morgan', 'Admin', 'org_admin', true),
  ('d1000000-0000-4000-8000-000000000102', 'd1000000-0000-4000-8000-000000000001', 'clock-aide@test.local', 'Casey', 'Aide', 'employee', true)
on conflict(id) do update set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);
insert into public.employees(
  id, organization_id, facility_id, profile_id, first_name, last_name,
  email, job_title, hire_date, status
) values (
  'd1000000-0000-4000-8000-000000000111', 'd1000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000011', 'd1000000-0000-4000-8000-000000000102',
  'Casey', 'Aide', 'clock-aide@test.local', 'Direct Care Staff', public.pa_today() - 100, 'active'
);

create or replace function pg_temp.act_as(p_id uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  reset role;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', p_id, 'role', p_role, 'aal', 'aal2', 'iat', extract(epoch from now())::bigint)::text,
    true
  );
  if p_role = 'service_role' then set local role service_role;
  else set local role authenticated;
  end if;
end
$$;
create temporary table clock_ids(key text primary key, id uuid) on commit drop;
grant all on clock_ids to authenticated, service_role;

------------------------------------------------------------------------------------------------
-- 7-9. A reportable incident is now told about both deadlines
------------------------------------------------------------------------------------------------
insert into public.incidents(
  id, organization_id, facility_id, incident_type, occurred_at, reported_at,
  narrative, severity, status, reportability_status
) values (
  'd1000000-0000-4000-8000-000000000201', 'd1000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000011', 'death',
  now() - interval '90 minutes', now() - interval '30 minutes',
  'Resident died overnight; coroner notified.', 'critical', 'reported', 'reportable'
);

select is(
  (select count(*)::int from public.incident_notifications
   where incident_id = 'd1000000-0000-4000-8000-000000000201'
     and notification_type = 'written_report'),
  1,
  'a reportable incident opens a written-report deadline -- before this there was none anywhere'
);
-- Same anchor as the call: coalesce(reportability_determined_at, reported_at, occurred_at), which
-- is reported_at here. Measured from occurred_at it would already have burned 60 of its 48 hours.
select ok(
  (select due_at from public.incident_notifications
   where incident_id = 'd1000000-0000-4000-8000-000000000201'
     and notification_type = 'written_report')
    between (select reported_at + interval '47 hours' from public.incidents where id = 'd1000000-0000-4000-8000-000000000201')
        and (select reported_at + interval '49 hours' from public.incidents where id = 'd1000000-0000-4000-8000-000000000201'),
  'and it runs 48 hours from when the facility knew, not from when the event occurred'
);
select ok(
  (select due_at from public.incident_notifications
   where incident_id = 'd1000000-0000-4000-8000-000000000201' and notification_type = 'written_report')
  > (select due_at from public.incident_notifications
     where incident_id = 'd1000000-0000-4000-8000-000000000201' and notification_type = 'state_hotline'),
  'the report is due after the call it follows, not instead of it'
);

------------------------------------------------------------------------------------------------
-- 10-12. "Mark Notified" cannot overwrite a determination that the notification was not required
------------------------------------------------------------------------------------------------
select set_config('app.privileged_write', 'on', true);
update public.incident_notifications
set status = 'not_required', notes = 'Determined not reportable: witnessed, no injury.'
where incident_id = 'd1000000-0000-4000-8000-000000000201' and notification_type = 'state_hotline';
select set_config('app.privileged_write', 'off', true);

select pg_temp.act_as('d1000000-0000-4000-8000-000000000101');
select throws_ok(
  $$update public.incident_notifications
    set status = 'completed', completed_at = now()
    where incident_id = 'd1000000-0000-4000-8000-000000000201'
      and notification_type = 'state_hotline'$$,
  '55000', null,
  'a stood-down notification cannot be marked notified -- that would record a call nobody made'
);
select is(
  (select status from public.incident_notifications
   where incident_id = 'd1000000-0000-4000-8000-000000000201' and notification_type = 'state_hotline'),
  'not_required',
  'and the determination survives the attempt'
);
-- The written report is a live duty on the same incident and is unaffected by the guard.
select lives_ok(
  $$update public.incident_notifications
    set status = 'completed', notification_method = 'portal'
    where incident_id = 'd1000000-0000-4000-8000-000000000201'
      and notification_type = 'written_report'$$,
  'a pending notification on the same incident is still completable'
);
reset role;

------------------------------------------------------------------------------------------------
-- 13-15. A cancelled corrective action cannot be completed
------------------------------------------------------------------------------------------------
select set_config('app.privileged_write', 'on', true);
insert into public.corrective_actions(
  id, organization_id, facility_id, incident_id, description, due_date, status
) values (
  'd1000000-0000-4000-8000-000000000301', 'd1000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000011', 'd1000000-0000-4000-8000-000000000201',
  'Re-brief the overnight shift on the fall protocol', public.pa_today() + 7, 'cancelled'
);
select set_config('app.privileged_write', 'off', true);

select pg_temp.act_as('d1000000-0000-4000-8000-000000000101');
select throws_ok(
  $$update public.corrective_actions
    set status = 'completed', completed_date = public.pa_today()
    where id = 'd1000000-0000-4000-8000-000000000301'$$,
  '55000', null,
  'a cancelled corrective action cannot be resolved as done through the table'
);
select throws_ok(
  $$select public.verify_corrective_action(
    'd1000000-0000-4000-8000-000000000301',
    'Checked the shift briefing sheet and the sign-off from every overnight aide.')$$,
  '55000', null,
  'and the RPC refuses it too, as it has since 20260906090000'
);
-- Reinstating it is the supported route, and it still works.
select lives_ok(
  $$update public.corrective_actions set status = 'in_progress'
    where id = 'd1000000-0000-4000-8000-000000000301';
    update public.corrective_actions set status = 'completed', completed_date = public.pa_today()
    where id = 'd1000000-0000-4000-8000-000000000301'$$,
  'reopening the action first and then completing it is still allowed'
);
reset role;

------------------------------------------------------------------------------------------------
-- 16-19. "Due soon" is half the cadence, capped at a month
------------------------------------------------------------------------------------------------
select is(
  public.inspection_item_due_soon_lead_days('fire_drill_program', 30), 15,
  'a calendar-month drill warns for its last fortnight, not for the whole month'
);
select is(
  public.inspection_item_due_soon_lead_days('sleeping_hours_fire_drill', 183), 30,
  'the six-month sleeping-hours drill keeps the 30-day window it had'
);
select is(
  public.inspection_item_due_soon_lead_days('generator', 365), 30,
  'and so does an annual inspection'
);
select is(
  public.inspection_item_due_soon_lead_days('other_equipment', 14), 7,
  'a fortnightly check warns for a week -- half its cycle, not twice it'
);

------------------------------------------------------------------------------------------------
-- 20-21. The ladder consults it
------------------------------------------------------------------------------------------------
insert into public.inspection_items (
  id, organization_id, facility_id, item_kind, item_type, label, inspection_interval_days
) values
  ('d1000000-0000-4000-8000-000000000401', 'd1000000-0000-4000-8000-000000000001',
   'd1000000-0000-4000-8000-000000000011', 'procedural', 'emergency_prep_plan_review',
   'Fortnightly Plan Check', 14),
  ('d1000000-0000-4000-8000-000000000402', 'd1000000-0000-4000-8000-000000000001',
   'd1000000-0000-4000-8000-000000000011', 'equipment', 'generator',
   'Backup Generator', 365);
insert into public.inspection_events (
  organization_id, facility_id, inspection_item_id, performed_date, performed_by, result
) values
  ('d1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000011',
   'd1000000-0000-4000-8000-000000000401', public.pa_today(), 'Morgan Admin', 'pass'),
  ('d1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000011',
   'd1000000-0000-4000-8000-000000000402', public.pa_today() - 340, 'Morgan Admin', 'pass');

select is(
  (select status from public.inspection_items where id = 'd1000000-0000-4000-8000-000000000401'),
  'compliant',
  'a fortnightly item checked today is compliant -- the flat 30-day window called it due_soon the same day it passed'
);
select is(
  (select status from public.inspection_items where id = 'd1000000-0000-4000-8000-000000000402'),
  'due_soon',
  'and an annual item 25 days from its deadline still reads due_soon, unchanged'
);

------------------------------------------------------------------------------------------------
-- 22-23. Verifying a repair no longer rewrites the drill calendar
------------------------------------------------------------------------------------------------
insert into public.inspection_items (
  id, organization_id, facility_id, item_kind, item_type, label, inspection_interval_days, install_date
) values (
  'd1000000-0000-4000-8000-000000000403', 'd1000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000011', 'procedural', 'fire_drill_program',
  'Monthly Fire Drill', 30, public.pa_today() - 400
);

select pg_temp.act_as('d1000000-0000-4000-8000-000000000101');
insert into clock_ids values ('order', public.create_work_order(
  'd1000000-0000-4000-8000-000000000011',
  'Drill alarm panel did not sound on the east wing during the drill',
  'd1000000-0000-4000-8000-000000000403'
));
select public.transition_work_order((select id from clock_ids where key = 'order'), 'assigned', 'Assigned to maintenance');
select public.transition_work_order((select id from clock_ids where key = 'order'), 'in_progress', 'Panel opened and relay replaced');
select public.transition_work_order(
  (select id from clock_ids where key = 'order'), 'pending_verification',
  'Relay replaced and the panel sounded on a full end-to-end test.');
select public.verify_work_order(
  (select id from clock_ids where key = 'order'), 'verified',
  'Walked the east wing with the panel sounding; all three pull stations answered.');
reset role;

select is(
  (select next_due_date from public.inspection_items where id = 'd1000000-0000-4000-8000-000000000403'),
  (date_trunc('month', public.pa_today()) + interval '2 months' - interval '1 day')::date,
  'a verified repair leaves the drill deadline on the last day of next month, not pa_today() + 30'
);
select is(
  (select last_inspected_date from public.inspection_items where id = 'd1000000-0000-4000-8000-000000000403'),
  public.pa_today(),
  'and the verification still counts as the drill program''s passing event'
);

------------------------------------------------------------------------------------------------
-- 24. The offline lane stops blaming a colleague for a discharge
------------------------------------------------------------------------------------------------
insert into public.residents(
  id, organization_id, facility_id, first_name, last_name, admission_date, status
) values (
  'd1000000-0000-4000-8000-000000000501', 'd1000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000011', 'Jamie', 'Resident', public.pa_today() - 30, 'discharged'
);
insert into public.resident_assessment_forms(
  id, organization_id, facility_id, resident_id, form_type, reason, status
) values (
  'd1000000-0000-4000-8000-000000000502', 'd1000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000011', 'd1000000-0000-4000-8000-000000000501',
  'RASP', 'initial', 'draft'
);
insert into public.resident_service_requirements(
  id, organization_id, facility_id, resident_id, source_assessment_form_id, source_plan_version,
  source_section, source_key, service_code, service_name, special_instructions, frequency,
  responsible_role, effective_from
) values (
  'd1000000-0000-4000-8000-000000000503', 'd1000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000011', 'd1000000-0000-4000-8000-000000000501',
  'd1000000-0000-4000-8000-000000000502', 1, 'section1', 'bathing', 'bathe', 'Bathing assistance',
  'Provide bathing assistance', 'daily', 'employee', public.pa_today() - 30
);
insert into public.resident_service_task_instances(
  id, organization_id, facility_id, resident_id, requirement_id, source_assessment_form_id,
  source_plan_version, service_name, responsible_role, scheduled_start, scheduled_end, status
) values (
  'd1000000-0000-4000-8000-000000000504', 'd1000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000011', 'd1000000-0000-4000-8000-000000000501',
  'd1000000-0000-4000-8000-000000000503', 'd1000000-0000-4000-8000-000000000502', 1,
  'Bathing assistance', 'employee', now() - interval '3 hours', now() - interval '2 hours', 'scheduled'
);

select pg_temp.act_as('d1000000-0000-4000-8000-000000000102');
insert into clock_ids values ('device', public.register_offline_service_device('clock-device-key', repeat('c', 64)));
-- The whole point: the task is still 'scheduled' and nobody has recorded it, so the old ladder fell
-- through to 'conflict' and the panel told the aide a colleague had beaten them to it.
select is(
  (select public.sync_offline_service_task_draft(
    (select id from clock_ids where key = 'device'), 'd1000000-0000-4000-8000-000000000504',
    'clock-sync-key-1', now() - interval '2 hours', 'completed_as_planned', '{}'::jsonb
  )->>'outcome'),
  'rejected',
  'a draft for a discharged resident is rejected with the guard''s own reason, not reported as a conflict'
);
reset role;

select * from finish();
rollback;
