-- pgTAP coverage for 20260905300000 and 20260905310000 (I23).
--
-- Two ways a Pennsylvania facility's records were wrong about time. complete_training_class
-- credited an attendee the class's SCHEDULED hours whenever no check-out was recorded, so signing
-- in at the door and leaving after five minutes produced a compliant training record for the full
-- four hours; and the record's status was the literal 'compliant' regardless of the hours, so a
-- one-minute attendance passed too. Separately, nine to_char() calls rendered a timestamptz in the
-- SESSION time zone -- UTC for every cron job and service-role call -- so an incident reported at
-- 8:30 PM appeared in the overdue-notification alert as the next day. Run with: supabase test db.

begin;
select plan(23);

------------------------------------------------------------------------------------------------
-- The credit rule
------------------------------------------------------------------------------------------------
select has_function(
  'app_private', 'class_attendance_credit',
  array['timestamp with time zone', 'timestamp with time zone', 'numeric'],
  'one function decides what an attendance is worth'
);
select ok(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('complete_training_class', 'correct_completed_class_attendee')
     and p.prosrc like '%class_attendance_credit%') = 2,
  'and both writers call it, rather than each keeping a copy'
);
select ok(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('complete_training_class', 'correct_completed_class_attendee')
     and p.prosrc like '%else v_class.duration_hours%') = 0,
  'and neither still falls back to the scheduled duration when nobody checked out'
);

select is(
  (select hours from app_private.class_attendance_credit(
     '2026-09-05 13:00:00+00', null, 4.0)),
  null,
  'no check-out means the hours attended are unknown, not the full class'
);
select is(
  (select status from app_private.class_attendance_credit(
     '2026-09-05 13:00:00+00', null, 4.0)),
  'pending_review',
  'and the record waits for a human rather than standing as compliant'
);
select is(
  (select approval_status from app_private.class_attendance_credit(
     '2026-09-05 13:00:00+00', null, 4.0)),
  'pending',
  'in the approval queue a trainer already works'
);

select is(
  (select hours from app_private.class_attendance_credit(
     '2026-09-05 13:00:00+00', '2026-09-05 13:01:00+00', 4.0)),
  0.02,
  'a one-minute attendance records the one minute, honestly'
);
select is(
  (select status from app_private.class_attendance_credit(
     '2026-09-05 13:00:00+00', '2026-09-05 13:01:00+00', 4.0)),
  'pending_review',
  'and does not read as compliant for a four-hour class'
);
select matches(
  (select review_comments from app_private.class_attendance_credit(
     '2026-09-05 13:00:00+00', '2026-09-05 13:01:00+00', 4.0)),
  '0\.02 of 4\.0 scheduled hours',
  'with both numbers stated, so the reviewer is not guessing'
);

select is(
  (select status from app_private.class_attendance_credit(
     '2026-09-05 13:00:00+00', '2026-09-05 17:00:00+00', 4.0)),
  'compliant',
  'a full attendance is compliant with nobody asked to look at it'
);
select is(
  (select hours from app_private.class_attendance_credit(
     '2026-09-05 13:00:00+00', '2026-09-05 17:00:00+00', 4.0)),
  4.00,
  'crediting the hours evidenced'
);
select is(
  (select status from app_private.class_attendance_credit(
     '2026-09-05 13:00:00+00', '2026-09-05 16:50:00+00', 4.0)),
  'compliant',
  'and leaving ten minutes at the end does not send a whole class to review'
);
select is(
  (select status from app_private.class_attendance_credit(
     '2026-09-05 13:00:00+00', '2026-09-05 16:20:00+00', 4.0)),
  'pending_review',
  'while missing the last forty minutes of four hours does'
);

-- The nightly recalc must not overwrite the verdict the credit rule reached.
select matches(
  (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'recalculate_compliance_core'),
  'pending_review',
  'and the nightly recalculation preserves pending_review rather than recomputing over it'
);

------------------------------------------------------------------------------------------------
-- End to end, through complete_training_class itself
------------------------------------------------------------------------------------------------
-- Not a redundant belt on the assertions above. Nothing in this suite called
-- complete_training_class with an attendee, so the first cut of this change shipped
-- `v_credit := app_private.class_attendance_credit(...)` -- which does not assign from a
-- TABLE-returning function -- through a clean replay and 3,861 green assertions. `db lint` caught
-- it. This is the assertion that should have.

insert into public.organizations(id, name, slug, subscription_status) values
  ('19000000-0000-4000-8000-000000000001', 'Seat Time Org', 'seat-time-org', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('19000000-0000-4000-8000-000000000011', '19000000-0000-4000-8000-000000000001',
   'Seat Time Facility', 'PCH');
insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values (
  '00000000-0000-0000-0000-000000000000', '19000000-0000-4000-8000-000000000101',
  'authenticated', 'authenticated', 'seat-trainer@test.local', 'x', now(), '{}', '{}',
  now(), now(), '', '', '', '', '', '', false, false
);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active)
values ('19000000-0000-4000-8000-000000000101', '19000000-0000-4000-8000-000000000001',
        'seat-trainer@test.local', 'Sam', 'Trainer', 'org_admin', true)
on conflict (id) do update
set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);

insert into public.employees(
  id, organization_id, facility_id, first_name, last_name, job_title, status
) values
  ('19000000-0000-4000-8000-000000000031', '19000000-0000-4000-8000-000000000001',
   '19000000-0000-4000-8000-000000000011', 'Stayed', 'Through', 'Aide', 'active'),
  ('19000000-0000-4000-8000-000000000032', '19000000-0000-4000-8000-000000000001',
   '19000000-0000-4000-8000-000000000011', 'Never', 'Checkedout', 'Aide', 'active');

insert into public.training_types(
  id, code, name, category, applies_to_facility_type, warning_days_default,
  document_required, is_system_default, is_active, sort_order, admin_approval_required, state,
  audience_verification_required, applies_to_administers_insulin
) values (
  '19000000-0000-4000-8000-000000000041', 'seat-time-drill', 'Seat Time Drill', 'safety',
  'PCH', 30, false, false, true, 100, false, 'PA', false, false
);

insert into public.training_classes(
  id, organization_id, facility_id, trainer_profile_id, training_type_id, class_name, class_date,
  duration_hours, status, capacity, resource_requirements, lock_version
) values (
  '19000000-0000-4000-8000-000000000051', '19000000-0000-4000-8000-000000000001',
  '19000000-0000-4000-8000-000000000011', '19000000-0000-4000-8000-000000000101',
  '19000000-0000-4000-8000-000000000041', 'Fire safety refresher', public.pa_today(),
  4.00, 'scheduled', 20, '{}'::jsonb, 1
);
insert into public.training_class_attendees(
  id, class_id, employee_id, attended, checked_in_at, checked_out_at, lifecycle_disposition
) values
  ('19000000-0000-4000-8000-000000000061', '19000000-0000-4000-8000-000000000051',
   '19000000-0000-4000-8000-000000000031', true,
   now() - interval '5 hours', now() - interval '1 hour', 'active'),
  ('19000000-0000-4000-8000-000000000062', '19000000-0000-4000-8000-000000000051',
   '19000000-0000-4000-8000-000000000032', true,
   now() - interval '5 hours', null, 'active');

create or replace function pg_temp.act_as(p_id uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_id, 'role', p_role, 'aal', 'aal2',
      'iat', extract(epoch from now())::bigint)::text, true);
  if p_role = 'service_role' then set local role service_role; else set local role authenticated; end if;
end $$;

select pg_temp.act_as('19000000-0000-4000-8000-000000000101');
-- Read through the attendee's training_record_id rather than employee_id:
-- instantiate_missing_requirements already wrote a `missing` row for the same employee and the
-- same training type, so employee_id alone matches two.
select lives_ok(
  $$ select public.complete_training_class('19000000-0000-4000-8000-000000000051') $$,
  'completing a class writes its attendance records'
);
reset role;
select is(
  (select r.status from public.employee_training_records r
   join public.training_class_attendees a on a.training_record_id = r.id
   where a.id = '19000000-0000-4000-8000-000000000061'),
  'compliant',
  'the attendee who checked out after four hours is compliant'
);
select is(
  (select r.hours from public.employee_training_records r
   join public.training_class_attendees a on a.training_record_id = r.id
   where a.id = '19000000-0000-4000-8000-000000000061'),
  4.00,
  'credited the four hours the evidence shows'
);
select is(
  (select r.status from public.employee_training_records r
   join public.training_class_attendees a on a.training_record_id = r.id
   where a.id = '19000000-0000-4000-8000-000000000062'),
  'pending_review',
  'and the one who never checked out waits for a human'
);
select is(
  (select r.hours from public.employee_training_records r
   join public.training_class_attendees a on a.training_record_id = r.id
   where a.id = '19000000-0000-4000-8000-000000000062'),
  null,
  'with no hours invented for them -- this used to read 4.00'
);

------------------------------------------------------------------------------------------------
-- The clock a facility reads
------------------------------------------------------------------------------------------------
set local time zone 'UTC';

select has_function(
  'public', 'pa_local', array['timestamp with time zone'],
  'pa_local exists beside pa_day, for the whole timestamp rather than the date'
);
select is(
  to_char(public.pa_local('2026-09-05 20:30:00-04'::timestamptz), 'Mon DD, YYYY HH12:MI AM'),
  'Sep 05, 2026 08:30 PM',
  'an incident reported at 8:30 PM in Pennsylvania reads as 8:30 PM'
);
-- The bug, kept as an assertion so nobody restores it by accident.
select is(
  to_char('2026-09-05 20:30:00-04'::timestamptz, 'Mon DD, YYYY HH12:MI AM'),
  'Sep 06, 2026 12:30 AM',
  'where the bare to_char every one of these used to do says the next DAY'
);
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'app_private')
     and p.proname in ('recalculate_incident_notifications', 'notify_incident_reported',
                       'recalculate_all_compliance', 'get_resident_timeline',
                       'start_emergency_event', 'sample_survey_rehearsal',
                       'enqueue_trial_expiry_notices')
     and p.prosrc not like '%pa_local%'),
  0,
  'and every one of the seven functions that rendered a timestamptz now goes through it'
);

select * from finish();
rollback;
