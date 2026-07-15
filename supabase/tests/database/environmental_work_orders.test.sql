begin;
select plan(37);

select has_table('public', 'work_orders', 'environmental work orders are first-class records');
select has_table('public', 'work_order_history', 'work-order lifecycle history exists');
select has_table('public', 'preventive_maintenance_schedules', 'recurring preventive maintenance exists');
select has_table('public', 'maintenance_locations', 'QR-addressable rooms and locations exist');
select has_table('public', 'maintenance_documents', 'repair photos and contract documents exist');
select has_column('public', 'inspection_items', 'qr_token', 'equipment has durable QR identity');
select is(
  (select public from storage.buckets where id = 'maintenance-documents'),
  false,
  'maintenance evidence bucket is private'
);
select ok(
  not has_table_privilege('authenticated', 'public.work_orders', 'INSERT'),
  'browser roles cannot bypass governed work-order creation'
);
select ok(
  not has_table_privilege('authenticated', 'public.work_orders', 'UPDATE'),
  'browser roles cannot bypass lifecycle transitions or verification'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.create_work_order(uuid,text,uuid,uuid,text,text,text,text,text,uuid,text,timestamp with time zone,text,numeric,text)',
    'EXECUTE'
  ),
  'anonymous callers cannot create maintenance work'
);
select ok(
  not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('work_orders','work_order_history','preventive_maintenance_schedules','maintenance_locations','maintenance_documents')
      and not c.relrowsecurity
  ),
  'every exposed maintenance table has RLS enabled'
);

insert into public.organizations(id, name, slug, subscription_status) values
  ('61000000-0000-4000-8000-000000000001', 'Maintenance Org', 'maintenance-org', 'active'),
  ('61000000-0000-4000-8000-000000000002', 'Other Maintenance Org', 'other-maintenance-org', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('61000000-0000-4000-8000-000000000011', '61000000-0000-4000-8000-000000000001', 'Maintenance Facility', 'PCH'),
  ('61000000-0000-4000-8000-000000000013', '61000000-0000-4000-8000-000000000001', 'Maintenance Annex', 'PCH'),
  ('61000000-0000-4000-8000-000000000012', '61000000-0000-4000-8000-000000000002', 'Other Facility', 'PCH');
insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', '61000000-0000-4000-8000-000000000101', 'authenticated', 'authenticated', 'maintenance-manager@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', '61000000-0000-4000-8000-000000000102', 'authenticated', 'authenticated', 'maintenance-worker@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', '61000000-0000-4000-8000-000000000103', 'authenticated', 'authenticated', 'maintenance-trainer@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', '61000000-0000-4000-8000-000000000104', 'authenticated', 'authenticated', 'other-manager@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('61000000-0000-4000-8000-000000000101', '61000000-0000-4000-8000-000000000001', 'maintenance-manager@test.local', 'Morgan', 'Manager', 'org_admin', true),
  ('61000000-0000-4000-8000-000000000102', '61000000-0000-4000-8000-000000000001', 'maintenance-worker@test.local', 'Casey', 'Worker', 'employee', true),
  ('61000000-0000-4000-8000-000000000103', '61000000-0000-4000-8000-000000000001', 'maintenance-trainer@test.local', 'Taylor', 'Trainer', 'trainer', true),
  ('61000000-0000-4000-8000-000000000104', '61000000-0000-4000-8000-000000000002', 'other-manager@test.local', 'Other', 'Manager', 'org_admin', true)
on conflict(id) do update set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);
insert into public.facility_assignments(profile_id, facility_id)
values ('61000000-0000-4000-8000-000000000103', '61000000-0000-4000-8000-000000000011');
insert into public.employees(
  id, organization_id, facility_id, profile_id, first_name, last_name,
  email, job_title, hire_date, status
) values (
  '61000000-0000-4000-8000-000000000111', '61000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000011', '61000000-0000-4000-8000-000000000102',
  'Casey', 'Worker', 'maintenance-worker@test.local', 'Maintenance Technician', current_date - 100, 'active'
);

create or replace function pg_temp.act_as(p_id uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  reset role;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', p_id, 'role', p_role, 'aal', 'aal1', 'iat', extract(epoch from now())::bigint)::text,
    true
  );
  if p_role = 'service_role' then set local role service_role;
  else set local role authenticated;
  end if;
end
$$;
create temporary table maintenance_ids(key text primary key, id uuid) on commit drop;
grant all on maintenance_ids to authenticated, service_role;

select pg_temp.act_as('61000000-0000-4000-8000-000000000101');
insert into public.maintenance_locations(
  id, organization_id, facility_id, label, room_number, location_detail
) values (
  '61000000-0000-4000-8000-000000000201', '61000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000011', 'East Hall Bathroom', '112', 'East residential hallway'
);
select ok(
  (select qr_token is not null from public.maintenance_locations where id = '61000000-0000-4000-8000-000000000201'),
  'room/location creation produces a QR token'
);
insert into public.inspection_items(
  id, organization_id, facility_id, item_kind, item_type, label,
  location_detail, inspection_interval_days
) values (
  '61000000-0000-4000-8000-000000000301', '61000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000011', 'equipment', 'emergency_lighting',
  'East Hall Emergency Light', 'Outside room 112', 30
);
insert into public.inspection_events(
  id, organization_id, facility_id, inspection_item_id, performed_date,
  performed_by, performed_by_profile_id, result, deficiency_notes, follow_up_required
) values (
  '61000000-0000-4000-8000-000000000302', '61000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000011', '61000000-0000-4000-8000-000000000301',
  current_date, 'Morgan Manager', '61000000-0000-4000-8000-000000000101',
  'fail', 'Battery backup did not illuminate during test', true
);
insert into maintenance_ids(key, id)
select 'failed_order', id from public.work_orders
where source_inspection_event_id = '61000000-0000-4000-8000-000000000302';
select is(
  (select count(*)::integer from public.work_orders where source_inspection_event_id = '61000000-0000-4000-8000-000000000302'),
  1,
  'failed inspection automatically creates exactly one work order'
);
select is(
  (select priority from public.work_orders where id = (select id from maintenance_ids where key = 'failed_order')),
  'urgent',
  'failed inspection creates urgent repair work'
);
select throws_ok(
  $$insert into public.work_orders(
      organization_id, facility_id, work_order_number, problem_description
    ) values (
      '61000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000011',
      'BYPASS', 'Attempt to bypass lifecycle'
    )$$,
  '42501', null,
  'direct browser insert cannot bypass governed work-order creation'
);
select throws_ok(
  $$select public.create_work_order(
    '61000000-0000-4000-8000-000000000013', 'Cross-facility asset attempt',
    '61000000-0000-4000-8000-000000000301'
  )$$,
  '23514', null,
  'governed creation rejects an asset outside the selected facility'
);
select lives_ok(
  $$select public.update_work_order_details(
    (select id from maintenance_ids where key = 'failed_order'),
    'Outside room 112', '112', 'high', 'urgent',
    'Emergency light tagged out; portable lighting placed in hallway.',
    '61000000-0000-4000-8000-000000000111', null,
    now() + interval '12 hours', 'Replacement battery pack', 175.00,
    'Alternate lighting is in place; no resident relocation required.'
  )$$,
  'manager assigns employee, protective action, target, parts, cost, and resident impact'
);

select pg_temp.act_as('61000000-0000-4000-8000-000000000102');
select lives_ok(
  $$select public.transition_work_order((select id from maintenance_ids where key = 'failed_order'), 'assigned', 'Assignment accepted');
    select public.transition_work_order((select id from maintenance_ids where key = 'failed_order'), 'in_progress', 'Replacement battery installed and fixture tested');
    select public.transition_work_order((select id from maintenance_ids where key = 'failed_order'), 'pending_verification', 'Battery replaced; fixture illuminated for full backup test.', 162.50, now() - interval '2 hours', now())$$,
  'assigned maintenance employee records repair, cost, downtime, and completion'
);
select is(
  (select status from public.work_orders where id = (select id from maintenance_ids where key = 'failed_order')),
  'pending_verification',
  'repair completion routes to pending verification'
);
select isnt(
  (select status from public.inspection_items where id = '61000000-0000-4000-8000-000000000301'),
  'compliant',
  'completion alone does not mark failed equipment compliant'
);

select pg_temp.act_as('61000000-0000-4000-8000-000000000103');
select throws_ok(
  $$select public.verify_work_order(
    (select id from maintenance_ids where key = 'failed_order'), 'verified',
    'Trainer attempting final maintenance verification'
  )$$,
  '42501', null,
  'trainer cannot perform supervisor verification'
);

select pg_temp.act_as('61000000-0000-4000-8000-000000000101');
select lives_ok(
  $$select public.verify_work_order(
    (select id from maintenance_ids where key = 'failed_order'), 'verified',
    'Observed full battery-backup test; illumination and duration meet the facility standard.'
  )$$,
  'manager records attributed supervisor verification'
);
select is(
  (select status from public.work_orders where id = (select id from maintenance_ids where key = 'failed_order')),
  'verified',
  'verified repair reaches terminal verified status'
);
select is(
  (select follow_up_required from public.inspection_events where id = '61000000-0000-4000-8000-000000000302'),
  false,
  'verification closes the failed inspection follow-up requirement'
);
select ok(
  exists (
    select 1 from public.inspection_events
    where inspection_item_id = '61000000-0000-4000-8000-000000000301'
      and result = 'pass'
      and notes like 'WO-% verified after repair:%'
  ),
  'verification creates passing follow-up inspection evidence'
);
select is(
  (select status from public.inspection_items where id = '61000000-0000-4000-8000-000000000301'),
  'compliant',
  'equipment becomes compliant only after verification'
);
select is(
  (select count(*)::integer from public.work_order_history where work_order_id = (select id from maintenance_ids where key = 'failed_order')),
  6,
  'immutable history retains creation, detail update, repair transitions, and verification'
);
reset role;
select throws_ok(
  $$update public.work_order_history set notes = 'rewrite' where work_order_id = (select id from maintenance_ids where key = 'failed_order')$$,
  '55000', null,
  'work-order history cannot be rewritten'
);

select pg_temp.act_as('61000000-0000-4000-8000-000000000101');
insert into public.preventive_maintenance_schedules(
  id, organization_id, facility_id, maintenance_location_id, title, description,
  frequency_unit, frequency_interval, next_due_date, default_priority,
  assigned_employee_id, estimated_duration_minutes, estimated_cost, parts_needed
) values (
  '61000000-0000-4000-8000-000000000401', '61000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000011', '61000000-0000-4000-8000-000000000201',
  'Bathroom exhaust inspection', 'Inspect and clean exhaust fan; verify grille and airflow.',
  'month', 1, current_date, 'routine', '61000000-0000-4000-8000-000000000111', 30, 25.00, 'Replacement filter if needed'
);
select is(
  public.generate_due_preventive_maintenance_work_orders(current_date),
  1,
  'due preventive-maintenance schedule generates one work order'
);
select is(
  public.generate_due_preventive_maintenance_work_orders(current_date),
  0,
  'repeated generation does not duplicate an open scheduled work order'
);
select is(
  (select next_due_date from public.preventive_maintenance_schedules where id = '61000000-0000-4000-8000-000000000401'),
  (current_date + interval '1 month')::date,
  'recurring schedule advances to its next due date'
);
select ok(
  exists (
    select 1 from public.work_orders
    where preventive_maintenance_schedule_id = '61000000-0000-4000-8000-000000000401'
      and assigned_employee_id = '61000000-0000-4000-8000-000000000111'
      and parts_needed = 'Replacement filter if needed'
  ),
  'generated work order carries assignment, parts, and schedule linkage'
);

insert into public.maintenance_documents(
  id, organization_id, facility_id, work_order_id, document_type,
  storage_path, file_name, file_type, file_size
) values (
  '61000000-0000-4000-8000-000000000501', '00000000-0000-0000-0000-000000000000',
  '61000000-0000-4000-8000-000000000012', (select id from maintenance_ids where key = 'failed_order'),
  'after_photo', '61000000-0000-4000-8000-000000000001/61000000-0000-4000-8000-000000000011/work/after.jpg',
  'after.jpg', 'image/jpeg', 1200
);
select is(
  (select organization_id from public.maintenance_documents where id = '61000000-0000-4000-8000-000000000501'),
  '61000000-0000-4000-8000-000000000001'::uuid,
  'document scope is stamped from its work-order parent'
);
select lives_ok(
  $$select public.log_maintenance_document_access('61000000-0000-4000-8000-000000000501')$$,
  'authorized maintenance-document access is logged'
);
select ok(
  exists (
    select 1 from public.audit_logs
    where entity_type = 'maintenance_documents'
      and entity_id = '61000000-0000-4000-8000-000000000501'
      and action = 'document_viewed'
  ),
  'document-view audit evidence is retained'
);

select pg_temp.act_as('61000000-0000-4000-8000-000000000102');
select is(
  (select count(*)::integer from public.work_orders),
  2,
  'assigned employee sees only their own repair and preventive work'
);
select pg_temp.act_as('61000000-0000-4000-8000-000000000104');
select is(
  (select count(*)::integer from public.work_orders),
  0,
  'other organization cannot read maintenance work across tenant boundaries'
);

select * from finish();
rollback;
