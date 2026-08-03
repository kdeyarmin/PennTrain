begin;
select plan(33);

-- BACKLOG.md C4, SMS half. The claim under test is narrow and worth stating plainly: an overdue
-- plan of correction reaches a manager by SMS, an upcoming one does not, and neither carries the
-- violation's free-text description off-platform.
--
-- The delivery-row assertions are the ones that matter. Everything upstream of them (notification
-- type accepted, template registered, routing branch taken) can be green while
-- notification_deliveries stays empty, which is exactly the failure this ticket exists to fix.

------------------------------------------------------------------------------------------------
-- Shape and access boundary
------------------------------------------------------------------------------------------------
select has_function(
  'public', 'run_plan_of_correction_escalations', array['timestamptz'],
  'the escalation sweep exists'
);

select is(
  (select prosecdef from pg_proc
   where oid = 'public.run_plan_of_correction_escalations(timestamptz)'::regprocedure),
  true,
  'the sweep is SECURITY DEFINER -- it notifies across every tenant'
);

select is(
  (select coalesce(array_to_string(proconfig, ','), '')::text from pg_proc
   where oid = 'public.run_plan_of_correction_escalations(timestamptz)'::regprocedure),
  'search_path=""'::text,
  'the sweep pins an empty search path'
);

select ok(
  not has_function_privilege(
    'authenticated', 'public.run_plan_of_correction_escalations(timestamptz)', 'EXECUTE'),
  'authenticated users cannot run the sweep'
);

select ok(
  not has_function_privilege(
    'anon', 'public.run_plan_of_correction_escalations(timestamptz)', 'EXECUTE'),
  'anonymous callers cannot run the sweep'
);

select ok(
  has_function_privilege(
    'service_role', 'public.run_plan_of_correction_escalations(timestamptz)', 'EXECUTE'),
  'service_role can run the sweep'
);

------------------------------------------------------------------------------------------------
-- Scheduled and watched
------------------------------------------------------------------------------------------------
select is(
  (select schedule from cron.job where jobname = 'escalate-plans-of-correction'),
  '30 11 * * *',
  'the sweep runs daily -- a weekly digest is the wrong cadence for a deadline'
);

select ok(
  exists(select 1 from app_private.system_job_definitions
         where cron_job_name = 'escalate-plans-of-correction' and is_critical and is_active),
  'the sweep is registered in the job control plane as critical'
);

select ok(
  not exists(select 1 from app_private.unwatched_cron_jobs()
             where job_name = 'escalate-plans-of-correction'),
  'and is therefore not an unwatched cron job'
);

------------------------------------------------------------------------------------------------
-- Templates
------------------------------------------------------------------------------------------------
select is(
  (select count(*)::int from public.notification_templates
   where organization_id is null and status = 'active'
     and template_key in ('plan_of_correction_due_soon', 'plan_of_correction_overdue')
     and channel in ('email', 'sms')),
  4,
  'both notification types have active global email and SMS templates'
);

select ok(
  not exists(
    select 1 from public.notification_templates
    where organization_id is null
      and template_key in ('plan_of_correction_due_soon', 'plan_of_correction_overdue')
      and cardinality(allowed_variables) > 0
  ),
  'the templates interpolate no notification free text -- nothing from the violation goes out'
);

------------------------------------------------------------------------------------------------
-- Fixture
------------------------------------------------------------------------------------------------
insert into public.organizations(id, name, slug, subscription_status) values
  ('2c000000-0000-4000-8000-000000000001', 'POC Org A', 'poc-org-a', 'active'),
  ('2c000000-0000-4000-8000-000000000002', 'POC Org B', 'poc-org-b', 'active');

-- Both channels enabled at the org level; without this enqueue_critical_notification_delivery
-- correctly creates nothing and the SMS assertions below would pass for the wrong reason.
insert into public.organization_settings(organization_id, email_notifications_enabled, sms_notifications_enabled)
values
  ('2c000000-0000-4000-8000-000000000001', true, true),
  ('2c000000-0000-4000-8000-000000000002', true, true)
on conflict (organization_id) do update set
  email_notifications_enabled = excluded.email_notifications_enabled,
  sms_notifications_enabled = excluded.sms_notifications_enabled;

insert into public.facilities(id, organization_id, name, facility_type, is_sandbox, sandbox_seed_version) values
  ('2c000000-0000-4000-8000-000000000011', '2c000000-0000-4000-8000-000000000001', 'POC A One', 'PCH', false, null),
  ('2c000000-0000-4000-8000-000000000012', '2c000000-0000-4000-8000-000000000001', 'POC A Two', 'ALR', false, null),
  ('2c000000-0000-4000-8000-000000000021', '2c000000-0000-4000-8000-000000000002', 'POC B One', 'PCH', false, null);

insert into auth.users(
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at,
  confirmation_token,recovery_token,email_change_token_new,email_change,
  email_change_token_current,reauthentication_token,is_sso_user,is_anonymous
)
select
  '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated',
  v.email, 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false
from (values
  ('2c000000-0000-4000-8000-000000000101'::uuid, 'poc-admin-a@test.local'),
  ('2c000000-0000-4000-8000-000000000102'::uuid, 'poc-mgr-one@test.local'),
  ('2c000000-0000-4000-8000-000000000103'::uuid, 'poc-mgr-two@test.local'),
  ('2c000000-0000-4000-8000-000000000104'::uuid, 'poc-employee-a@test.local'),
  ('2c000000-0000-4000-8000-000000000201'::uuid, 'poc-admin-b@test.local')
) as v(id,email);

select set_config('app.privileged_write','on',true);
insert into public.profiles(
  id, organization_id, email, first_name, last_name, role, is_active,
  phone, sms_opt_in, sms_consent_at
) values
  ('2c000000-0000-4000-8000-000000000101', '2c000000-0000-4000-8000-000000000001', 'poc-admin-a@test.local', 'POC', 'Admin A', 'org_admin', true, '+15555550101', true, now()),
  ('2c000000-0000-4000-8000-000000000102', '2c000000-0000-4000-8000-000000000001', 'poc-mgr-one@test.local', 'POC', 'Manager One', 'facility_manager', true, '+15555550102', true, now()),
  ('2c000000-0000-4000-8000-000000000103', '2c000000-0000-4000-8000-000000000001', 'poc-mgr-two@test.local', 'POC', 'Manager Two', 'facility_manager', true, '+15555550103', true, now()),
  ('2c000000-0000-4000-8000-000000000104', '2c000000-0000-4000-8000-000000000001', 'poc-employee-a@test.local', 'POC', 'Employee A', 'employee', true, '+15555550104', true, now()),
  ('2c000000-0000-4000-8000-000000000201', '2c000000-0000-4000-8000-000000000002', 'poc-admin-b@test.local', 'POC', 'Admin B', 'org_admin', true, '+15555550201', true, now())
on conflict(id) do update set
  organization_id = excluded.organization_id,
  role = excluded.role,
  is_active = excluded.is_active,
  phone = excluded.phone,
  sms_opt_in = excluded.sms_opt_in,
  sms_consent_at = excluded.sms_consent_at;
select set_config('app.privileged_write','off',true);

-- Manager One covers the facility the violations are on; Manager Two covers the other one and is
-- the control for "assigned managers only".
insert into public.facility_assignments(profile_id, facility_id) values
  ('2c000000-0000-4000-8000-000000000102', '2c000000-0000-4000-8000-000000000011'),
  ('2c000000-0000-4000-8000-000000000103', '2c000000-0000-4000-8000-000000000012');

insert into public.dhs_violations(
  id, organization_id, facility_id, citation_ref, inspection_date, description, status, poc_due_date
) values
  -- V1: overdue, and the only row in scope for the first sweep.
  ('2c000000-0000-4000-8000-000000000301', '2c000000-0000-4000-8000-000000000001',
   '2c000000-0000-4000-8000-000000000011', '2800.11(a)', public.pa_today() - 30,
   'Resident record detail that must never leave the platform', 'open', public.pa_today() - 1),
  -- V3: real, but far outside the three-day warning window -- and far enough out that it stays
  -- outside it even for the sweep below that runs with the clock moved eight days forward.
  ('2c000000-0000-4000-8000-000000000303', '2c000000-0000-4000-8000-000000000001',
   '2c000000-0000-4000-8000-000000000011', '2800.33(c)', public.pa_today() - 30,
   'Not yet in the warning window', 'open', public.pa_today() + 60),
  -- V4: overdue on paper but already corrected -- closed work is not escalated.
  ('2c000000-0000-4000-8000-000000000304', '2c000000-0000-4000-8000-000000000001',
   '2c000000-0000-4000-8000-000000000011', '2800.44(d)', public.pa_today() - 30,
   'Already corrected', 'corrected', public.pa_today() - 5);

------------------------------------------------------------------------------------------------
-- Overdue escalation
------------------------------------------------------------------------------------------------
select is(
  public.run_plan_of_correction_escalations(),
  1,
  'exactly one violation escalates -- not the far-out one, not the corrected one'
);

select is(
  (select count(*)::int from public.notifications
   where profile_id = '2c000000-0000-4000-8000-000000000101'
     and notification_type = 'plan_of_correction_overdue'),
  1,
  'the org admin is notified'
);

select is(
  (select count(*)::int from public.notifications
   where profile_id = '2c000000-0000-4000-8000-000000000102'
     and notification_type = 'plan_of_correction_overdue'),
  1,
  'the manager assigned to the facility is notified'
);

select is(
  (select count(*)::int from public.notifications
   where profile_id = '2c000000-0000-4000-8000-000000000103'),
  0,
  'a manager assigned elsewhere in the same org is not'
);

select is(
  (select count(*)::int from public.notifications
   where profile_id = '2c000000-0000-4000-8000-000000000104'),
  0,
  'employees are not -- a plan of correction is not their obligation'
);

select is(
  (select count(*)::int from public.notifications
   where profile_id = '2c000000-0000-4000-8000-000000000201'),
  0,
  'and neither is another tenant'
);

select ok(
  exists(
    select 1 from public.notifications
    where notification_type = 'plan_of_correction_overdue'
      and body like 'Citation 2800.11(a):%'
      and body not like '%Resident record detail%'
  ),
  'the body identifies the citation and carries none of the violation description'
);

select isnt(
  (select poc_overdue_notified_at from public.dhs_violations
   where id = '2c000000-0000-4000-8000-000000000301'),
  null,
  'the escalation is stamped on the violation'
);

------------------------------------------------------------------------------------------------
-- The SMS half itself
------------------------------------------------------------------------------------------------
select is(
  (select count(*)::int from public.notification_deliveries d
   join public.notifications n on n.id = d.notification_id
   where n.notification_type = 'plan_of_correction_overdue'
     and d.profile_id = '2c000000-0000-4000-8000-000000000102'
     and d.channel = 'sms'),
  1,
  'an overdue plan of correction queues an SMS to the assigned manager'
);

select is(
  (select count(*)::int from public.notification_deliveries d
   join public.notifications n on n.id = d.notification_id
   where n.notification_type = 'plan_of_correction_overdue'
     and d.profile_id = '2c000000-0000-4000-8000-000000000102'
     and d.channel = 'email'),
  1,
  'and an email alongside it -- the critical path is both channels, not a choice between them'
);

------------------------------------------------------------------------------------------------
-- Repeat rules
------------------------------------------------------------------------------------------------
select is(
  public.run_plan_of_correction_escalations(),
  0,
  'a second sweep the same day escalates nothing -- a daily job with no memory is how a real '
  'deadline gets muted'
);

select is(
  (select count(*)::int from public.notifications
   where notification_type = 'plan_of_correction_overdue'),
  2,
  'and adds no notifications'
);

select is(
  public.run_plan_of_correction_escalations(now() + interval '8 days'),
  1,
  'a still-outstanding plan of correction escalates again a week later'
);

------------------------------------------------------------------------------------------------
-- The approaching-deadline warning
------------------------------------------------------------------------------------------------
insert into public.dhs_violations(
  id, organization_id, facility_id, citation_ref, inspection_date, description, status, poc_due_date
) values
  ('2c000000-0000-4000-8000-000000000302', '2c000000-0000-4000-8000-000000000001',
   '2c000000-0000-4000-8000-000000000011', '2800.22(b)', public.pa_today() - 30,
   'Coming due', 'poc_submitted', public.pa_today() + 2);

select is(
  (select count(*)::int from public.notifications
   where notification_type = 'plan_of_correction_due_soon'),
  0,
  'nothing is warned before a sweep runs'
);

select is(
  public.run_plan_of_correction_escalations(),
  1,
  'the approaching deadline is picked up on the next sweep'
);

select is(
  (select count(*)::int from public.notifications
   where notification_type = 'plan_of_correction_due_soon'),
  2,
  'the admin and the assigned manager are warned'
);

select is(
  (select count(*)::int from public.notification_deliveries d
   join public.notifications n on n.id = d.notification_id
   where n.notification_type = 'plan_of_correction_due_soon'
     and d.channel = 'sms'),
  0,
  'a warning does NOT send SMS -- spending it on something merely upcoming trains people to '
  'ignore the escalation that follows'
);

select is(
  public.run_plan_of_correction_escalations(),
  0,
  'the warning fires once, not every morning until the due date'
);

-- Extending a deadline has to re-arm the warning. Without the trigger the row stays stamped and
-- the new date is never warned about at all.
update public.dhs_violations set poc_due_date = public.pa_today() + 3
where id = '2c000000-0000-4000-8000-000000000302';

select is(
  (select poc_due_soon_notified_at from public.dhs_violations
   where id = '2c000000-0000-4000-8000-000000000302'),
  null,
  'moving the due date clears the warning stamp'
);

select is(
  public.run_plan_of_correction_escalations(),
  1,
  'so the extended deadline is warned about against its new date'
);

------------------------------------------------------------------------------------------------
-- Rows that must stay out of scope throughout
------------------------------------------------------------------------------------------------
select is(
  (select count(*)::int from public.notifications
   where body like 'Citation 2800.33(c)%' or body like 'Citation 2800.44(d)%'),
  0,
  'neither the far-out violation nor the corrected one ever notified anyone'
);

select is(
  (select count(*)::int from public.notifications
   where notification_type in ('plan_of_correction_due_soon', 'plan_of_correction_overdue')
     and profile_id not in (
       '2c000000-0000-4000-8000-000000000101', '2c000000-0000-4000-8000-000000000102')),
  0,
  'across every sweep, only the org admin and the assigned manager were ever notified'
);

select * from finish();
rollback;
