-- BACKLOG.md REG27. Pins 20260925120300: a verified repair is not a fire drill (2600.132(a), (c)),
-- and an inoperative smoke detector or fire alarm is a 48-hour repair (2600.130(g) / 2800.130(f)).
begin;
select plan(13);

insert into public.organizations (id, name, slug, subscription_status) values
  ('e2700000-0000-4000-8000-000000000001', 'Drill Org', 'drill-org-reg27', 'active');
insert into public.facilities (id, organization_id, name, facility_type) values
  ('e2700000-0000-4000-8000-000000000011', 'e2700000-0000-4000-8000-000000000001', 'Drill Facility', 'PCH');
insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', 'e2700000-0000-4000-8000-000000000101', 'authenticated', 'authenticated', 'drill-admin@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('e2700000-0000-4000-8000-000000000101', 'e2700000-0000-4000-8000-000000000001', 'drill-admin@test.local', 'Riley', 'Admin', 'org_admin', true)
on conflict(id) do update set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);

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
end
$$;

-- Walks a work order from open to verified as the org admin.
create or replace function pg_temp.verify_order(p_order uuid)
returns void language plpgsql as $$
begin
  perform pg_temp.act_as('e2700000-0000-4000-8000-000000000101');
  perform public.transition_work_order(p_order, 'assigned', 'Assigned to maintenance');
  perform public.transition_work_order(p_order, 'in_progress', 'Work started on site');
  perform public.transition_work_order(p_order, 'pending_verification', 'Repair finished and tested end to end.');
  perform public.verify_work_order(p_order, 'verified', 'Supervisor checked the repair on site.');
  reset role;
end
$$;

insert into public.inspection_items (
  id, organization_id, facility_id, item_kind, item_type, label, inspection_interval_days, install_date
) values
  ('e2700000-0000-4000-8000-000000000201', 'e2700000-0000-4000-8000-000000000001',
   'e2700000-0000-4000-8000-000000000011', 'procedural', 'fire_drill_program',
   'Monthly Fire Drill', 30, public.pa_today() - 400),
  ('e2700000-0000-4000-8000-000000000202', 'e2700000-0000-4000-8000-000000000001',
   'e2700000-0000-4000-8000-000000000011', 'equipment', 'smoke_detector',
   'Hall Smoke Detector', 30, public.pa_today() - 400),
  ('e2700000-0000-4000-8000-000000000203', 'e2700000-0000-4000-8000-000000000001',
   'e2700000-0000-4000-8000-000000000011', 'equipment', 'emergency_lighting',
   'Stair Emergency Light', 30, public.pa_today() - 400),
  ('e2700000-0000-4000-8000-000000000204', 'e2700000-0000-4000-8000-000000000001',
   'e2700000-0000-4000-8000-000000000011', 'procedural', 'evacuation_time_letter',
   'Evacuation Time Letter', 365, public.pa_today() - 400),
  ('e2700000-0000-4000-8000-000000000205', 'e2700000-0000-4000-8000-000000000001',
   'e2700000-0000-4000-8000-000000000011', 'procedural', 'fire_drill_program',
   'Annex Fire Drill', 30, public.pa_today() - 400);

insert into public.inspection_events (
  id, organization_id, facility_id, inspection_item_id, performed_date, performed_by, result,
  alarm_or_detector_operative, alarm_sounded
) values
  -- A drill that failed.
  ('e2700000-0000-4000-8000-000000000301', 'e2700000-0000-4000-8000-000000000001',
   'e2700000-0000-4000-8000-000000000011', 'e2700000-0000-4000-8000-000000000201',
   public.pa_today(), 'Riley Admin', 'fail', true, true),
  -- A detector found with a deficiency on its own inspection.
  ('e2700000-0000-4000-8000-000000000302', 'e2700000-0000-4000-8000-000000000001',
   'e2700000-0000-4000-8000-000000000011', 'e2700000-0000-4000-8000-000000000202',
   public.pa_today(), 'Riley Admin', 'deficiency_noted', null, null),
  -- Ordinary equipment with a deficiency.
  ('e2700000-0000-4000-8000-000000000303', 'e2700000-0000-4000-8000-000000000001',
   'e2700000-0000-4000-8000-000000000011', 'e2700000-0000-4000-8000-000000000203',
   public.pa_today(), 'Riley Admin', 'deficiency_noted', null, null);

------------------------------------------------------------------------------------------------
-- 1-7. 48 hours for a detector or alarm, wherever it was found inoperative
------------------------------------------------------------------------------------------------
select is(
  (select target_completion_at from public.work_orders
   where source_inspection_event_id = 'e2700000-0000-4000-8000-000000000302'),
  now() + interval '48 hours',
  'a smoke detector with a deficiency is due in 48 hours, not the routine 7 days (2600.130(g))'
);
select is(
  (select priority from public.work_orders
   where source_inspection_event_id = 'e2700000-0000-4000-8000-000000000302'),
  'urgent',
  'and it is urgent'
);
select is(
  (select target_completion_at from public.work_orders
   where source_inspection_event_id = 'e2700000-0000-4000-8000-000000000303'),
  now() + interval '7 days',
  'other equipment with a deficiency keeps the 7-day target'
);
select is(
  (select target_completion_at from public.work_orders
   where source_inspection_event_id = 'e2700000-0000-4000-8000-000000000301'),
  now() + interval '24 hours',
  'a failed drill keeps its 24 hours, which is inside the 48-hour window'
);

insert into public.inspection_events (
  id, organization_id, facility_id, inspection_item_id, performed_date, performed_by, result,
  alarm_or_detector_operative, alarm_sounded
) values
  ('e2700000-0000-4000-8000-000000000304', 'e2700000-0000-4000-8000-000000000001',
   'e2700000-0000-4000-8000-000000000011', 'e2700000-0000-4000-8000-000000000205',
   public.pa_today(), 'Riley Admin', 'pass', false, true),
  ('e2700000-0000-4000-8000-000000000305', 'e2700000-0000-4000-8000-000000000001',
   'e2700000-0000-4000-8000-000000000011', 'e2700000-0000-4000-8000-000000000205',
   public.pa_today(), 'Riley Admin', 'pass', true, true);

select is(
  (select target_completion_at from public.work_orders
   where source_inspection_event_id = 'e2700000-0000-4000-8000-000000000304'),
  now() + interval '48 hours',
  'a passing drill that recorded the alarm as not operative opens a 48-hour repair'
);
select ok(
  (select problem_description like '%did not use an operative alarm%' from public.work_orders
   where source_inspection_event_id = 'e2700000-0000-4000-8000-000000000304'),
  'and the work order says why'
);
select is(
  (select count(*)::int from public.work_orders
   where source_inspection_event_id = 'e2700000-0000-4000-8000-000000000305'),
  0,
  'a passing drill with a working alarm opens nothing'
);

------------------------------------------------------------------------------------------------
-- 8-13. A verified repair is not a drill, a letter or a review
------------------------------------------------------------------------------------------------
select pg_temp.verify_order(
  (select id from public.work_orders where source_inspection_event_id = 'e2700000-0000-4000-8000-000000000301'));

select is(
  (select count(*)::int from public.inspection_events
   where inspection_item_id = 'e2700000-0000-4000-8000-000000000201' and result = 'pass'),
  0,
  'verifying the failed drill''s repair logs no passing drill (2600.132(a), (c))'
);
select is(
  (select last_inspected_date from public.inspection_items where id = 'e2700000-0000-4000-8000-000000000201'),
  null::date,
  'so the drill program has still not been drilled'
);
select is(
  (select status from public.inspection_items where id = 'e2700000-0000-4000-8000-000000000201'),
  'expired',
  'and it still reads overdue until a drill is held'
);
select is(
  (select follow_up_required from public.inspection_events where id = 'e2700000-0000-4000-8000-000000000301'),
  false,
  'the failed drill''s follow-up is still closed by the verified repair'
);

select pg_temp.act_as('e2700000-0000-4000-8000-000000000101');
create temporary table reg27_ids(key text primary key, id uuid) on commit drop;
grant all on reg27_ids to authenticated;
insert into reg27_ids values ('letter', public.create_work_order(
  'e2700000-0000-4000-8000-000000000011',
  'Replace the posted evacuation route map beside the letter',
  'e2700000-0000-4000-8000-000000000204'
));
reset role;
select pg_temp.verify_order((select id from reg27_ids where key = 'letter'));

select is(
  (select last_inspected_date from public.inspection_items where id = 'e2700000-0000-4000-8000-000000000204'),
  null::date,
  'a verified repair does not stand in for the fire safety expert''s evacuation letter (132(d))'
);

select pg_temp.verify_order(
  (select id from public.work_orders where source_inspection_event_id = 'e2700000-0000-4000-8000-000000000302'));

select is(
  (select last_inspected_date from public.inspection_items where id = 'e2700000-0000-4000-8000-000000000202'),
  public.pa_today(),
  'equipment still records the verified repair as a passing test'
);

select * from finish();
rollback;
