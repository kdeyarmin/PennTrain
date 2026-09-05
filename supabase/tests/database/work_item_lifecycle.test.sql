-- pgTAP coverage for 20260905070000: one work item per source, closed when the source resolves.
--
-- Before this, the hourly sweep and submit_plan_of_correction each opened their own item for the
-- same corrective action under different keys; nothing at all closed an incident, citation,
-- corrective-action or inspection item when the source record settled; a refreshed due date never
-- cleared escalated_at, which escalate_overdue_work_items will never revisit; and due dates were
-- anchored to midnight UTC or to 23:59 server time rather than to the end of the Pennsylvania day.
-- Two weeks into a pilot the queue was mostly finished work shouting.
-- Run with: supabase test db (requires the local Supabase Docker stack).

begin;
select plan(17);

insert into public.organizations(id, name, slug) values
  ('7b000000-0000-4000-8000-000000000001', 'Work Queue Org', 'work-queue-org');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('7b000000-0000-4000-8000-000000000011', '7b000000-0000-4000-8000-000000000001', 'Work Queue Facility', 'PCH');

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values (
  '00000000-0000-0000-0000-000000000000', '7b000000-0000-4000-8000-000000000021', 'authenticated',
  'authenticated', 'work-queue-admin@test.local', 'x', now(), '{}'::jsonb, '{}'::jsonb, now(), now(),
  '', '', '', '', '', '', false, false
);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('7b000000-0000-4000-8000-000000000021', '7b000000-0000-4000-8000-000000000001',
   'work-queue-admin@test.local', 'Quinn', 'Admin', 'org_admin', true)
on conflict (id) do update set organization_id = excluded.organization_id, role = 'org_admin', is_active = true;
select set_config('app.privileged_write', 'off', true);

create or replace function pg_temp.act_as(p_profile_id uuid)
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_profile_id, 'role', 'authenticated', 'aal', 'aal2',
    'iat', extract(epoch from now())::bigint
  )::text, true);
  set local role authenticated;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- An incident's item closes when the incident does.
-- ---------------------------------------------------------------------------------------
insert into public.incidents(
  id, organization_id, facility_id, incident_type, occurred_at, reported_at,
  narrative, severity, status
) values (
  '7b000000-0000-4000-8000-000000000101', '7b000000-0000-4000-8000-000000000001',
  '7b000000-0000-4000-8000-000000000011', 'significant_injury', now() - interval '2 hours', now() - interval '1 hour',
  'Resident found on the floor of their room.', 'major', 'reported'
);

select is(
  (select state from public.work_items
   where deduplication_key = 'incident:7b000000-0000-4000-8000-000000000101'),
  'open',
  'reporting an incident opens the investigation item'
);

-- Closing an incident legitimately requires the final report and an administrator approval; the
-- point here is that the work item follows a REAL closure, not that closure is easy.
update public.incidents set
  status = 'closed',
  final_report_submitted_at = now(),
  administrator_approved_at = now()
where id = '7b000000-0000-4000-8000-000000000101';

-- This is the assertion the whole row is about: two weeks in, the queue held an escalated
-- "Investigate ..." for every incident that had long since been closed.
select is(
  (select state from public.work_items
   where deduplication_key = 'incident:7b000000-0000-4000-8000-000000000101'),
  'closed',
  'closing the incident closes its work item'
);

select is(
  (select closure_reason from public.work_items
   where deduplication_key = 'incident:7b000000-0000-4000-8000-000000000101'),
  'The incident was closed.',
  'and says why, rather than leaving a closed item with no explanation'
);

select is(
  (select count(*)::int from public.work_item_history h
   join public.work_items w on w.id = h.work_item_id
   where w.deduplication_key = 'incident:7b000000-0000-4000-8000-000000000101'
     and h.event_type = 'closed'),
  1,
  'the closure is in the item history'
);

-- ---------------------------------------------------------------------------------------
-- A citation is settled by `corrected`/`verified`, not by filing a plan.
-- ---------------------------------------------------------------------------------------
insert into public.dhs_violations(
  id, organization_id, facility_id, inspection_date, description, severity, status
) values (
  '7b000000-0000-4000-8000-000000000201', '7b000000-0000-4000-8000-000000000001',
  '7b000000-0000-4000-8000-000000000011', public.pa_today() - 3,
  'Medication storage not secured.', 'high', 'open'
);

-- ---------------------------------------------------------------------------------------
-- One item per corrective action, from either creator, closed when it completes.
-- ---------------------------------------------------------------------------------------
insert into public.corrective_actions(
  id, organization_id, facility_id, violation_id, description, due_date, status
) values (
  '7b000000-0000-4000-8000-000000000301', '7b000000-0000-4000-8000-000000000001',
  '7b000000-0000-4000-8000-000000000011', '7b000000-0000-4000-8000-000000000201',
  'Fit a keyed lock to the medication room.', public.pa_today() + 7, 'open'
);

-- The sweep runs first, as it does hourly.
select set_config('app.privileged_write', 'on', true);
select public.register_outstanding_work_items();
select set_config('app.privileged_write', 'off', true);

select is(
  (select count(*)::int from public.work_items
   where source_id = '7b000000-0000-4000-8000-000000000301'),
  1,
  'the sweep opens exactly one item for the corrective action'
);

-- The due date is the END of the Pennsylvania day, not midnight UTC (20:00 the evening before)
-- and not 23:59 server time (19:59 local, on the due day itself).
select is(
  (select due_at from public.work_items
   where deduplication_key = 'corrective-action:7b000000-0000-4000-8000-000000000301'),
  public.pa_midnight(public.pa_today() + 8),
  'and it is due when the Pennsylvania day it is due on actually ends'
);

select ok(
  (select due_at from public.work_items
   where deduplication_key = 'corrective-action:7b000000-0000-4000-8000-000000000301')
    > (public.pa_today() + 7)::timestamptz,
  'which is later than the bare cast this used to use'
);

-- Now the OTHER creator runs over the same corrective action. This is the defect, exactly as an
-- administrator would produce it: submit_plan_of_correction used to insert a second item under
-- violation_ca:<id>, because its `ca.work_item_id is null` guard cannot see the sweep's row -- the
-- sweep never sets work_item_id.
select pg_temp.act_as('7b000000-0000-4000-8000-000000000021');
select lives_ok(
  $$ select public.submit_plan_of_correction('7b000000-0000-4000-8000-000000000201', null) $$,
  'a plan of correction can be filed for the citation'
);
reset role;

select is(
  (select state from public.work_items
   where deduplication_key = 'violation:7b000000-0000-4000-8000-000000000201'),
  'open',
  'filing the plan does NOT close the citation item -- carrying the plan out is the work'
);

select is(
  (select count(*)::int from public.work_items
   where source_id = '7b000000-0000-4000-8000-000000000301'),
  1,
  'and it does NOT open a second item for a corrective action the sweep already registered'
);

select is(
  (select work_item_id from public.corrective_actions
   where id = '7b000000-0000-4000-8000-000000000301'),
  (select id from public.work_items
   where deduplication_key = 'corrective-action:7b000000-0000-4000-8000-000000000301'),
  'the corrective action is linked to that one item, so the violation page opens the same row the queue shows'
);

update public.corrective_actions set status = 'completed'
where id = '7b000000-0000-4000-8000-000000000301';

select is(
  (select state from public.work_items
   where deduplication_key = 'corrective-action:7b000000-0000-4000-8000-000000000301'),
  'closed',
  'completing the corrective action closes its item'
);

-- The citation itself settles only when somebody records it as corrected -- after the plan was
-- filed and the corrective actions under it were done, which is the order this test now follows.
update public.dhs_violations set status = 'corrected'
where id = '7b000000-0000-4000-8000-000000000201';

select is(
  (select state from public.work_items
   where deduplication_key = 'violation:7b000000-0000-4000-8000-000000000201'),
  'closed',
  'recording the citation as corrected closes it'
);

-- ---------------------------------------------------------------------------------------
-- An inspection deficiency closes when it stops being a deficiency.
-- ---------------------------------------------------------------------------------------
insert into public.inspection_items(
  id, organization_id, facility_id, item_kind, item_type, label, inspection_interval_days
) values (
  '7b000000-0000-4000-8000-000000000401', '7b000000-0000-4000-8000-000000000001',
  '7b000000-0000-4000-8000-000000000011', 'equipment', 'fire_extinguisher', 'Kitchen extinguisher', 30
);
insert into public.inspection_events(
  id, organization_id, facility_id, inspection_item_id, performed_date, performed_by,
  result, follow_up_required
) values (
  '7b000000-0000-4000-8000-000000000402', '7b000000-0000-4000-8000-000000000001',
  '7b000000-0000-4000-8000-000000000011', '7b000000-0000-4000-8000-000000000401',
  public.pa_today(), 'Maintenance', 'deficiency_noted', true
);

select is(
  (select state from public.work_items
   where deduplication_key = 'inspection:7b000000-0000-4000-8000-000000000402'),
  'open',
  'a noted deficiency opens an item'
);

update public.inspection_events set result = 'pass', follow_up_required = false
where id = '7b000000-0000-4000-8000-000000000402';

select is(
  (select state from public.work_items
   where deduplication_key = 'inspection:7b000000-0000-4000-8000-000000000402'),
  'closed',
  'resolving it closes the item'
);

-- ---------------------------------------------------------------------------------------
-- A due date that moves forward un-escalates.
-- ---------------------------------------------------------------------------------------
-- escalate_overdue_work_items only ever looks at items with `escalated_at is null`, so an item
-- escalated once could never recover on its own: it stayed urgent and overdue against a date that
-- had since moved into the future.
insert into public.residents(id, organization_id, facility_id, first_name, last_name, admission_date, status)
values ('7b000000-0000-4000-8000-000000000502', '7b000000-0000-4000-8000-000000000001',
        '7b000000-0000-4000-8000-000000000011', 'Robin', 'Resident', public.pa_today() - 400, 'active');
insert into public.resident_compliance_items(
  id, organization_id, facility_id, resident_id, item_type, status, due_date
) values (
  '7b000000-0000-4000-8000-000000000501', '7b000000-0000-4000-8000-000000000001',
  '7b000000-0000-4000-8000-000000000011', '7b000000-0000-4000-8000-000000000502',
  'annual_reassessment', 'missing', public.pa_today() - 5
);

select set_config('app.privileged_write', 'on', true);
select public.register_outstanding_work_items();
select public.escalate_overdue_work_items();

select ok(
  (select escalated_at is not null from public.work_items
   where deduplication_key = 'resident-compliance:7b000000-0000-4000-8000-000000000501'),
  'an overdue item escalates'
);

-- The requirement's date moves out; the next sweep refreshes it.
update public.resident_compliance_items set due_date = public.pa_today() + 30
where id = '7b000000-0000-4000-8000-000000000501';
select public.register_outstanding_work_items();
select set_config('app.privileged_write', 'off', true);

select is(
  (select escalated_at from public.work_items
   where deduplication_key = 'resident-compliance:7b000000-0000-4000-8000-000000000501'),
  null,
  'and un-escalates when its due date moves into the future, which no later run could otherwise undo'
);

select * from finish();
rollback;
