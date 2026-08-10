begin;
select plan(8);

-- import_apply_room_with_beds only ever added beds, so a rooms import that lowered
-- bed_count reported "applied" while the surplus bed rows survived -- a semi-private
-- room converted to private kept four beds and overstated capacity everywhere bed
-- counts roll up. The property under test: reducing bed_count removes plainly
-- available surplus beds, and refuses -- loudly, not silently -- when a surplus bed
-- is occupied, reserved, or held.

insert into public.organizations (id, name, slug)
values ('b5000000-0000-4000-8000-000000000001', 'Bed Reconcile Org', 'bed-reconcile-org');

insert into public.facilities (id, organization_id, name, facility_type)
values ('b5000000-0000-4000-8000-000000000011', 'b5000000-0000-4000-8000-000000000001',
        'Bed Reconcile Facility', 'PCH');

-- The RPC reads auth.role(); this is the shape the durable worker's invocation presents.
create or replace function pg_temp.act_as_worker()
returns void
language plpgsql
as $$
begin
  reset role;
  perform set_config(
    'request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
end
$$;

select pg_temp.act_as_worker();

-- Seed a four-bed room through the RPC itself.
select lives_ok(
  $$ select public.import_apply_room_with_beds(
       'b5000000-0000-4000-8000-000000000001', 'b5000000-0000-4000-8000-000000000011',
       'Main', 'North', '101', 'semi_private', 4) $$,
  'a four-bed room imports cleanly'
);

select is(
  (select count(*)::int from public.facility_beds b
   join public.facility_rooms r on r.id = b.room_id
   where r.facility_id = 'b5000000-0000-4000-8000-000000000011' and r.room_number = '101'),
  4,
  'the import created beds A through D'
);

-- Lowering the count removes the plainly-available surplus; is_active lands through
-- the RPC (the table's UPDATE grant is revoked from authenticated, so this is the
-- only path an import's status column can take).
select lives_ok(
  $$ select public.import_apply_room_with_beds(
       'b5000000-0000-4000-8000-000000000001', 'b5000000-0000-4000-8000-000000000011',
       'Main', 'North', '101', 'private', 2, 'none', false) $$,
  'an update that lowers bed_count applies'
);

select ok(
  (select not r.is_active from public.facility_rooms r
   where r.facility_id = 'b5000000-0000-4000-8000-000000000011' and r.room_number = '101'),
  'p_is_active=false deactivates the room through the definer path'
);

select lives_ok(
  $$ select public.import_apply_room_with_beds(
       'b5000000-0000-4000-8000-000000000001', 'b5000000-0000-4000-8000-000000000011',
       'Main', 'North', '101', 'private', 2, 'none', true) $$,
  'a later row can restore the room'
);

select is(
  (select string_agg(b.bed_label, ',' order by b.bed_label) from public.facility_beds b
   join public.facility_rooms r on r.id = b.room_id
   where r.facility_id = 'b5000000-0000-4000-8000-000000000011' and r.room_number = '101'),
  'A,B',
  'the surplus beds C and D are gone; A and B remain'
);

-- A held surplus bed blocks the reduction instead of vanishing. (maintenance_hold is
-- the simplest constraint-legal non-available state; 'occupied' requires an occupant.)
select pg_temp.act_as_worker();
update public.facility_beds b
set status = 'maintenance_hold', hold_reason = 'Deep clean'
from public.facility_rooms r
where r.id = b.room_id
  and r.facility_id = 'b5000000-0000-4000-8000-000000000011'
  and r.room_number = '101'
  and b.bed_label = 'B';

select throws_ok(
  $$ select public.import_apply_room_with_beds(
       'b5000000-0000-4000-8000-000000000001', 'b5000000-0000-4000-8000-000000000011',
       'Main', 'North', '101', 'private', 1) $$,
  '55000',
  null,
  'reducing past a held bed fails loudly instead of silently overstating capacity'
);

select is(
  (select count(*)::int from public.facility_beds b
   join public.facility_rooms r on r.id = b.room_id
   where r.facility_id = 'b5000000-0000-4000-8000-000000000011' and r.room_number = '101'),
  2,
  'the blocked reduction removed nothing'
);

select * from finish();
rollback;
