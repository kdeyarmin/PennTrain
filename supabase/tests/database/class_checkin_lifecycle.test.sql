-- pgTAP coverage for 20260905040000: one rule for when a class accepts check-ins.
--
-- Before this, generate_class_checkin_token and checkin_via_token required scheduled/in_progress
-- while checkin_via_kiosk_pin required draft -- so the two check-in paths were never available for
-- the same class, and ClassDetail rendered the QR card and the printed meeting notice only while
-- the class was a draft, which is exactly when both refuse. Nothing tested any of the three
-- against a class status other than the one it happened to want.
-- Run with: supabase test db (requires the local Supabase Docker stack).

begin;
select plan(12);

insert into public.organizations(id, name, slug) values
  ('4d000000-0000-4000-8000-000000000001', 'Checkin Org', 'checkin-lifecycle-org');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('4d000000-0000-4000-8000-000000000011', '4d000000-0000-4000-8000-000000000001', 'Checkin Facility', 'PCH');

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) select
  '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated',
  v.email, 'x', now(), '{}'::jsonb, '{}'::jsonb, now(), now(),
  '', '', '', '', '', '', false, false
from (values
  ('4d000000-0000-4000-8000-000000000101'::uuid, 'checkin-trainer@test.local'),
  ('4d000000-0000-4000-8000-000000000102'::uuid, 'checkin-aide@test.local')
) v(id, email);

select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('4d000000-0000-4000-8000-000000000101', '4d000000-0000-4000-8000-000000000001', 'checkin-trainer@test.local', 'Casey', 'Trainer', 'trainer', true),
  ('4d000000-0000-4000-8000-000000000102', '4d000000-0000-4000-8000-000000000001', 'checkin-aide@test.local', 'Alex', 'Aide', 'employee', true)
on conflict (id) do update set
  organization_id = excluded.organization_id, email = excluded.email,
  role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);

insert into public.facility_assignments(profile_id, facility_id) values
  ('4d000000-0000-4000-8000-000000000101', '4d000000-0000-4000-8000-000000000011')
on conflict do nothing;

insert into public.employees(
  id, organization_id, facility_id, profile_id, employee_number, first_name, last_name,
  email, hire_date, job_title, status, checkin_pin_hash
) values (
  '4d000000-0000-4000-8000-000000000201', '4d000000-0000-4000-8000-000000000001',
  '4d000000-0000-4000-8000-000000000011', '4d000000-0000-4000-8000-000000000102',
  'CK-1', 'Alex', 'Aide', 'checkin-aide@test.local', public.pa_today()-30, 'Direct Care', 'active',
  extensions.crypt('1234', extensions.gen_salt('bf'))
);

insert into public.training_types(id, organization_id, code, name, category) values
  ('4d000000-0000-4000-8000-000000000301', '4d000000-0000-4000-8000-000000000001',
   'CHECKIN-TEST', 'Check-in lifecycle drill', 'annual');

-- Two identical classes, differing only in the status a real trainer moves through.
insert into public.training_classes(
  id, organization_id, facility_id, trainer_profile_id, training_type_id,
  class_name, class_date, duration_hours, status
) values
  ('4d000000-0000-4000-8000-000000000401', '4d000000-0000-4000-8000-000000000001',
   '4d000000-0000-4000-8000-000000000011', '4d000000-0000-4000-8000-000000000101',
   '4d000000-0000-4000-8000-000000000301', 'Draft class', public.pa_today(), 2, 'draft'),
  ('4d000000-0000-4000-8000-000000000402', '4d000000-0000-4000-8000-000000000001',
   '4d000000-0000-4000-8000-000000000011', '4d000000-0000-4000-8000-000000000101',
   '4d000000-0000-4000-8000-000000000301', 'Open class', public.pa_today(), 2, 'scheduled'),
  ('4d000000-0000-4000-8000-000000000403', '4d000000-0000-4000-8000-000000000001',
   '4d000000-0000-4000-8000-000000000011', '4d000000-0000-4000-8000-000000000101',
   '4d000000-0000-4000-8000-000000000301', 'Finished class', public.pa_today(), 2, 'completed');

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
-- The QR path: a draft class is where the product SHOWS the card, so it has to work there.
-- ---------------------------------------------------------------------------------------
select pg_temp.act_as('4d000000-0000-4000-8000-000000000101');

select lives_ok(
  $$ select public.generate_class_checkin_token('4d000000-0000-4000-8000-000000000401', false) $$,
  'a trainer can issue a QR code for a draft class -- the state ClassDetail shows the card in'
);

select lives_ok(
  $$ select public.generate_class_checkin_token('4d000000-0000-4000-8000-000000000402', false) $$,
  'and for a class already open for enrolment'
);

-- The printed "Notice of Staff Meeting" mints a long-lived token through the same generator, so it
-- was unreachable for exactly the same reason.
select lives_ok(
  $$ select public.generate_class_checkin_token('4d000000-0000-4000-8000-000000000401', true) $$,
  'the printed meeting notice can be produced for a draft class'
);

select throws_ok(
  $$ select public.generate_class_checkin_token('4d000000-0000-4000-8000-000000000403', false) $$,
  '23514',
  'This class is no longer accepting check-ins.',
  'a completed class issues no more codes'
);

-- ---------------------------------------------------------------------------------------
-- The kiosk path: the same two classes, the opposite requirement before this migration.
-- ---------------------------------------------------------------------------------------
select lives_ok(
  $$ select public.checkin_via_kiosk_pin(
       '4d000000-0000-4000-8000-000000000401', '4d000000-0000-4000-8000-000000000201', '1234') $$,
  'kiosk PIN check-in still works on a draft class -- nothing that worked stops working'
);

select lives_ok(
  $$ select public.checkin_via_kiosk_pin(
       '4d000000-0000-4000-8000-000000000402', '4d000000-0000-4000-8000-000000000201', '1234') $$,
  'and now works once the class is open for enrolment, which is when the class meets'
);

select throws_ok(
  $$ select public.checkin_via_kiosk_pin(
       '4d000000-0000-4000-8000-000000000403', '4d000000-0000-4000-8000-000000000201', '1234') $$,
  '23514',
  'This class is no longer accepting check-ins.',
  'a completed class takes no more kiosk check-ins'
);

select is(
  (select checkin_method from public.training_class_attendees
   where class_id = '4d000000-0000-4000-8000-000000000402'
     and employee_id = '4d000000-0000-4000-8000-000000000201'),
  'kiosk_pin',
  'the open class recorded the walk-in the way the draft one does'
);

-- The PIN is still the thing being checked, not merely the status.
select throws_ok(
  $$ select public.checkin_via_kiosk_pin(
       '4d000000-0000-4000-8000-000000000401', '4d000000-0000-4000-8000-000000000201', '9999') $$,
  'Incorrect PIN',
  'a wrong PIN is still refused'
);

-- ---------------------------------------------------------------------------------------
-- The QR scan itself, end to end, on a class open for enrolment.
-- ---------------------------------------------------------------------------------------
reset role;
delete from public.training_class_attendees
where class_id = '4d000000-0000-4000-8000-000000000402';

select pg_temp.act_as('4d000000-0000-4000-8000-000000000101');
create temporary table pg_temp_token(token text) on commit drop;
insert into pg_temp_token
select public.generate_class_checkin_token('4d000000-0000-4000-8000-000000000402', false);

select pg_temp.act_as('4d000000-0000-4000-8000-000000000102');
select lives_ok(
  $$ select public.checkin_via_token((select token from pg_temp_token)) $$,
  'an aide can scan into a class that is open for enrolment'
);

reset role;
select is(
  (select checkin_method from public.training_class_attendees
   where class_id = '4d000000-0000-4000-8000-000000000402'
     and employee_id = '4d000000-0000-4000-8000-000000000201'),
  'qr',
  'and the scan is recorded as a QR check-in'
);

-- ---------------------------------------------------------------------------------------
-- The rule itself, named once so the three callers cannot drift apart again.
-- ---------------------------------------------------------------------------------------
select is(
  (select array_agg(s order by s)
   from unnest(array['draft','scheduled','in_progress','completed','cancelled']) s
   where app_private.class_accepts_checkins(s)),
  array['draft','in_progress','scheduled']::text[],
  'a class accepts check-ins until it is completed or cancelled'
);

select * from finish();
rollback;
