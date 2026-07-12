-- pgTAP tests for the resident state-form reminder sweep, digest coverage, and the
-- notify-trigger changes from 20260712160000_state_forms_reminders_and_digest.sql.
--
-- Run with: supabase test db  (requires the local Docker dev stack; see supabase/config.toml).
-- NOTE: this file was written and syntax-reviewed but NOT executed against a running Postgres
-- instance in the environment that authored it (no Docker daemon was available there) -- run it
-- once before relying on it, and treat a first failure as "fix the test" as plausibly as "fix
-- the app," same as any newly-written test.

begin;
select plan(9);

select has_column(
  'public', 'resident_compliance_items', 'reminder_sent_at',
  'compliance items carry the reminder dedup stamp'
);

-- ---------------------------------------------------------------------------
-- Fixtures: one org, one PCH facility, one org_admin, one active resident
-- (whose insert auto-instantiates the rule-pack compliance items).
-- ---------------------------------------------------------------------------
insert into public.organizations (id, name, slug) values
  ('77000000-0000-0000-0000-000000000001', 'State Forms Reminders A', 'state-forms-reminders-a');
insert into public.organization_settings (
  organization_id, email_notifications_enabled, sms_notifications_enabled
) values
  ('77000000-0000-0000-0000-000000000001', true, true);

insert into public.facilities (id, organization_id, name, facility_type) values
  ('77000000-0000-0000-0000-000000000002', '77000000-0000-0000-0000-000000000001', 'Reminder Test Home', 'PCH');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
)
select '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated', v.email,
  'x', now(), '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '', '', '', false, false
from (values
  ('77000000-0000-0000-0000-000000000003'::uuid, 'state-forms-admin@test.local')
) as v(id, email);

-- auth.users fires handle_new_user(); finish the trigger-created fixture rows under the
-- same transaction-local bypass used by trusted profile administration paths.
select set_config('app.privileged_write', 'on', true);

insert into public.profiles (id, organization_id, email, first_name, last_name, role, is_active) values
  ('77000000-0000-0000-0000-000000000003', '77000000-0000-0000-0000-000000000001',
   'state-forms-admin@test.local', 'State', 'FormsAdmin', 'org_admin', true)
on conflict (id) do update set
  organization_id = excluded.organization_id,
  email = excluded.email,
  first_name = excluded.first_name,
  last_name = excluded.last_name,
  role = excluded.role,
  is_active = excluded.is_active;

insert into public.residents (id, organization_id, facility_id, first_name, last_name, admission_date, status) values
  ('77000000-0000-0000-0000-000000000004', '77000000-0000-0000-0000-000000000001',
   '77000000-0000-0000-0000-000000000002', 'Reminder', 'Resident', current_date - 30, 'active');

select ok(
  (select count(*) from public.resident_compliance_items
   where resident_id = '77000000-0000-0000-0000-000000000004') > 0,
  'resident insert auto-instantiates rule-pack compliance items'
);

-- Org B: same shape but with NO active org_admin and no assigned facility_manager -- its items
-- have zero possible recipients, and the sweep must not stamp them (stamping would silently
-- suppress their reminders for a week even though nobody was ever notified).
insert into public.organizations (id, name, slug) values
  ('77000000-0000-0000-0000-000000000011', 'State Forms Reminders B', 'state-forms-reminders-b');
insert into public.organization_settings (organization_id) values
  ('77000000-0000-0000-0000-000000000011')
on conflict do nothing;
insert into public.facilities (id, organization_id, name, facility_type) values
  ('77000000-0000-0000-0000-000000000012', '77000000-0000-0000-0000-000000000011', 'No Admin Home', 'PCH');
insert into public.residents (id, organization_id, facility_id, first_name, last_name, admission_date, status) values
  ('77000000-0000-0000-0000-000000000014', '77000000-0000-0000-0000-000000000011',
   '77000000-0000-0000-0000-000000000012', 'Unheard', 'Resident', current_date - 30, 'active');
update public.resident_compliance_items
set status = 'due_soon', reminder_sent_at = null
where resident_id = '77000000-0000-0000-0000-000000000014'
  and item_type = 'annual_reassessment';

-- ---------------------------------------------------------------------------
-- Weekly sweep: one AGGREGATED notification per recipient, stamped, no re-fire
-- inside the 7-day window.
-- ---------------------------------------------------------------------------
update public.resident_compliance_items
set status = 'due_soon', reminder_sent_at = null
where resident_id = '77000000-0000-0000-0000-000000000004'
  and item_type = 'annual_reassessment';

select public.send_resident_compliance_reminders();

select ok(
  (select reminder_sent_at is null from public.resident_compliance_items
   where resident_id = '77000000-0000-0000-0000-000000000014'
     and item_type = 'annual_reassessment'),
  'the sweep never stamps items that had no possible recipient'
);

select is(
  (select count(*)::int from public.notifications
   where profile_id = '77000000-0000-0000-0000-000000000003'
     and notification_type = 'resident_compliance_due'
     and link = '/app/state-forms'),
  1,
  'sweep sends one aggregated reminder linking the State Forms Center'
);

select ok(
  (select reminder_sent_at is not null from public.resident_compliance_items
   where resident_id = '77000000-0000-0000-0000-000000000004'
     and item_type = 'annual_reassessment'),
  'sweep stamps reminder_sent_at on the swept item'
);

select public.send_resident_compliance_reminders();

select is(
  (select count(*)::int from public.notifications
   where profile_id = '77000000-0000-0000-0000-000000000003'
     and notification_type = 'resident_compliance_due'),
  1,
  'a second sweep inside the 7-day window does not re-notify'
);

-- ---------------------------------------------------------------------------
-- Monday digest now reports resident state-form counts (and fires even when
-- training/alert counts are all zero, because the resident counts are part of
-- the skip-if-all-zero check).
-- ---------------------------------------------------------------------------
select public.send_monday_digest();

select ok(
  exists (
    select 1 from public.notifications
    where profile_id = '77000000-0000-0000-0000-000000000003'
      and title = 'Weekly compliance digest'
      and body like '%Resident state forms: 0 expired, 1 due soon.%'
  ),
  'monday digest includes the resident state-form counts'
);

-- ---------------------------------------------------------------------------
-- Alert-open notifications link the State Forms Center and count as reminder #1.
-- ---------------------------------------------------------------------------
update public.resident_compliance_items
set reminder_sent_at = null
where resident_id = '77000000-0000-0000-0000-000000000004'
  and item_type = 'medical_evaluation';

insert into public.alerts (
  organization_id, facility_id, alert_type, title, message, severity,
  resident_compliance_item_id
)
select i.organization_id, i.facility_id, 'resident_compliance_due_soon',
  'Medical evaluation due soon', 'Test alert for the notify trigger', 'warning', i.id
from public.resident_compliance_items i
where i.resident_id = '77000000-0000-0000-0000-000000000004'
  and i.item_type = 'medical_evaluation';

select ok(
  exists (
    select 1 from public.notifications
    where profile_id = '77000000-0000-0000-0000-000000000003'
      and notification_type = 'resident_compliance_due'
      and title = 'Medical evaluation due soon'
      and link = '/app/state-forms'
  ),
  'alert-open notification links the State Forms Center'
);

select ok(
  (select reminder_sent_at is not null from public.resident_compliance_items
   where resident_id = '77000000-0000-0000-0000-000000000004'
     and item_type = 'medical_evaluation'),
  'alert-open notification stamps reminder_sent_at (counts as reminder #1)'
);

select * from finish();
rollback;
