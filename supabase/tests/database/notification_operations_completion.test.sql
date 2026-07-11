begin;
select plan(61);

select has_table('public', 'notification_templates', 'versioned notification templates exist');
select has_table('public', 'notification_channel_policies', 'channel fallback policies exist');
select has_table('public', 'notification_spend_policies', 'notification spend policies exist');
select has_table('public', 'notification_spend_alerts', 'notification spend alerts exist');
select has_column('public', 'profiles', 'preferred_notification_channel', 'profiles have a preferred channel');
select has_column('public', 'notification_deliveries', 'template_version_id', 'deliveries retain their template version');
select has_column('public', 'notification_delivery_attempts', 'estimated_cost_micros', 'attempts retain their cost estimate');

select ok(
  has_table_privilege('authenticated', 'public.notification_templates', 'SELECT')
  and not has_table_privilege('authenticated', 'public.notification_templates', 'INSERT'),
  'template tables are read-only through the Data API'
);
select ok(
  has_table_privilege('authenticated', 'public.notification_spend_alerts', 'SELECT')
  and not has_table_privilege('authenticated', 'public.notification_spend_alerts', 'UPDATE'),
  'spend alerts are read-only through the Data API'
);
select ok(
  not has_function_privilege(
    'authenticated', 'public.render_notification_template_text(text,text[],jsonb)', 'EXECUTE'
  ),
  'the internal template renderer is not a public RPC'
);

insert into public.organizations (id, name, slug) values
  ('11000000-0000-0000-0000-000000000001', 'Notification Operations A', 'notification-operations-a'),
  ('11000000-0000-0000-0000-000000000002', 'Notification Operations B', 'notification-operations-b');
insert into public.organization_settings (
  organization_id, email_notifications_enabled, sms_notifications_enabled
) values
  ('11000000-0000-0000-0000-000000000001', true, true),
  ('11000000-0000-0000-0000-000000000002', true, true);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
)
select '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated', v.email,
  'x', now(), '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '', '', '', false, false
from (values
  ('11000000-0000-0000-0000-000000000010'::uuid, 'notification-platform@test.local'),
  ('11000000-0000-0000-0000-000000000011'::uuid, 'notification-admin-a@test.local'),
  ('11000000-0000-0000-0000-000000000012'::uuid, 'notification-worker-a@test.local'),
  ('11000000-0000-0000-0000-000000000013'::uuid, 'notification-admin-b@test.local')
) as v(id, email);

insert into public.profiles (
  id, organization_id, first_name, last_name, email, phone, role, is_active,
  notification_timezone, sms_opt_in, sms_consent_at, preferred_notification_channel
) values
  ('11000000-0000-0000-0000-000000000010', null, 'Platform', 'Admin',
   'notification-platform@test.local', null, 'platform_admin', true,
   'America/New_York', false, null, 'email'),
  ('11000000-0000-0000-0000-000000000011', '11000000-0000-0000-0000-000000000001',
   'Organization', 'Admin A', 'notification-admin-a@test.local', null, 'org_admin', true,
   'America/New_York', false, null, 'email'),
  ('11000000-0000-0000-0000-000000000012', '11000000-0000-0000-0000-000000000001',
   'Notification', 'Worker', 'notification-worker-a@test.local', '+12155550199', 'employee', true,
   'America/New_York', true, now(), 'email'),
  ('11000000-0000-0000-0000-000000000013', '11000000-0000-0000-0000-000000000002',
   'Organization', 'Admin B', 'NOTIFICATION-WORKER-A@TEST.LOCAL', null, 'org_admin', true,
   'America/New_York', false, null, 'email');

create or replace function pg_temp.act_as(p_profile_id uuid) returns void as $$
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_profile_id::text, 'role', 'authenticated')::text,
    true
  );
  set local role authenticated;
end;
$$ language plpgsql;

select pg_temp.act_as('11000000-0000-0000-0000-000000000010');
select lives_ok(
  $$ select public.create_notification_template_version(
       null, 'default', 'email', '{{title}}', '{{body}}', array['title','body'], true
     ) $$,
  'platform admin can atomically activate a global template version'
);
reset role;
select results_eq(
  $$ select version from public.notification_templates
     where organization_id is null and template_key = 'default'
       and channel = 'email' and status = 'active' $$,
  array[2],
  'activation retires the prior active version'
);

select pg_temp.act_as('11000000-0000-0000-0000-000000000010');
select lives_ok(
  $$ select public.create_notification_template_version(
       null, 'default', 'email', 'Draft', 'Draft', '{}'::text[], false
     ) $$,
  'a new draft preserves the active version'
);
reset role;

select pg_temp.act_as('11000000-0000-0000-0000-000000000011');
select results_eq(
  $$ select count(*)::int
     from jsonb_array_elements(public.get_notification_template_library(null)) item
     where item ->> 'organizationId' is null and item ->> 'status' <> 'active' $$,
  array[0],
  'organization admins cannot read global draft or retired template bodies'
);
select results_eq(
  $$ select public.preview_notification_template(
       (select id from public.notification_templates
        where organization_id is null and template_key = 'default'
          and channel = 'email' and status = 'active'),
       '{"title":"Reminder","body":"Sign in securely"}'::jsonb
     ) ->> 'subject' $$,
  array['Reminder'],
  'authorized preview renders the exact active template'
);
select throws_ok(
  $$ select public.preview_notification_template_draft(
       'Notice', 'Hello {{resident_name}}', array['title'], '{"title":"Notice"}'::jsonb
     ) $$,
  '22023', null,
  'unknown or sensitive placeholders are rejected'
);
select lives_ok(
  $$ select public.create_notification_template_version(
       '11000000-0000-0000-0000-000000000001', 'training_due_soon', 'email',
       '{{title}}', '{{body}}', array['title','body'], true
     ) $$,
  'organization admin can activate a tenant template version'
);
select throws_ok(
  $$ select public.create_notification_template_version(
       '11000000-0000-0000-0000-000000000002', 'training_due_soon', 'email',
       'Wrong tenant', 'Wrong tenant', '{}'::text[], true
     ) $$,
  '42501', null,
  'organization admin cannot manage another tenant template'
);
reset role;

insert into public.notifications (
  id, organization_id, profile_id, notification_type, title, body, link
) values
  ('11000000-0000-0000-0000-000000000101', '11000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000012', 'training_due_soon', 'Due soon', 'Review securely', '/me'),
  ('11000000-0000-0000-0000-000000000102', '11000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000012', 'training_expired', 'Expired', 'Review securely', '/me'),
  ('11000000-0000-0000-0000-000000000103', '11000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000012', 'policy_attestation_due_soon', 'Policy due', 'Review securely', '/me'),
  ('11000000-0000-0000-0000-000000000104', '11000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000012', 'course_continuation_reminder', 'Continue course', 'Review securely', '/me'),
  ('11000000-0000-0000-0000-000000000105', '11000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000012', 'resident_compliance_due', 'Compliance due', 'Review securely', '/me'),
  ('11000000-0000-0000-0000-000000000106', '11000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000012', 'support_ticket_update', 'Ticket update', 'Review securely', '/me');
select results_eq(
  $$ select count(*)::int from public.notification_deliveries
     where notification_id in (
       '11000000-0000-0000-0000-000000000101', '11000000-0000-0000-0000-000000000102',
       '11000000-0000-0000-0000-000000000103', '11000000-0000-0000-0000-000000000104',
       '11000000-0000-0000-0000-000000000105', '11000000-0000-0000-0000-000000000106'
     ) $$,
  array[6],
  'all six legacy notification types queue exactly one preferred-channel delivery'
);
select results_eq(
  $$ select count(*)::int from public.notification_deliveries
     where notification_id in (
       '11000000-0000-0000-0000-000000000101', '11000000-0000-0000-0000-000000000102',
       '11000000-0000-0000-0000-000000000103', '11000000-0000-0000-0000-000000000104',
       '11000000-0000-0000-0000-000000000105', '11000000-0000-0000-0000-000000000106'
     ) and template_version_id is not null $$,
  array[6],
  'queued deliveries retain the exact template version'
);

select pg_temp.act_as('11000000-0000-0000-0000-000000000011');
select lives_ok(
  $$ select * from public.update_profile_contact_preferences(
       '11000000-0000-0000-0000-000000000012', 'Notification', 'Worker',
       '+12155550199', true, 'sms'
     ) $$,
  'organization admin can set an eligible preferred channel in its tenant'
);
reset role;
select pg_temp.act_as('11000000-0000-0000-0000-000000000013');
select throws_ok(
  $$ select * from public.update_profile_contact_preferences(
       '11000000-0000-0000-0000-000000000012', 'Notification', 'Worker',
       '+12155550199', true, 'email'
     ) $$,
  '42501', null,
  'another tenant administrator cannot change profile notification preferences'
);
reset role;
insert into public.notifications (
  id, organization_id, profile_id, notification_type, title, body
) values (
  '11000000-0000-0000-0000-000000000107', '11000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000012', 'course_continuation_reminder', 'Continue', 'Sign in'
);
select results_eq(
  $$ select channel from public.notification_deliveries
     where notification_id = '11000000-0000-0000-0000-000000000107' $$,
  array['sms'],
  'preference hierarchy selects an eligible preferred channel'
);

select pg_temp.act_as('11000000-0000-0000-0000-000000000011');
select lives_ok(
  $$ select public.set_notification_channel_policy(
       '11000000-0000-0000-0000-000000000001', true, 0, 1
     ) $$,
  'organization admin can configure its own fallback policy'
);
select throws_ok(
  $$ select public.set_notification_channel_policy(
       '11000000-0000-0000-0000-000000000002', true, 0, 1
     ) $$,
  '42501', null,
  'organization admin cannot configure another tenant fallback policy'
);
reset role;

insert into public.notification_deliveries (
  id, organization_id, profile_id, channel, delivery_type, recipient, status
) values (
  '11000000-0000-0000-0000-000000000201', '11000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000012', 'email', 'digest',
  'notification-worker-a@test.local', 'pending'
);
update public.notification_deliveries
set status = 'failed', final_outcome = 'failed', finalized_at = now()
where id = '11000000-0000-0000-0000-000000000201';
select results_eq(
  $$ select count(*)::int from public.notification_deliveries
     where parent_delivery_id = '11000000-0000-0000-0000-000000000201' $$,
  array[1],
  'a permanent failure queues one eligible alternate-channel fallback'
);
select results_eq(
  $$ select fallback_sequence, channel from public.notification_deliveries
     where parent_delivery_id = '11000000-0000-0000-0000-000000000201' $$,
  $$ values (1::smallint, 'sms'::text) $$,
  'fallback evidence links the bounded escalation sequence and channel'
);
update public.notification_deliveries
set status = 'failed', final_outcome = 'failed'
where id = '11000000-0000-0000-0000-000000000201';
select results_eq(
  $$ select count(*)::int from public.notification_deliveries
     where parent_delivery_id = '11000000-0000-0000-0000-000000000201' $$,
  array[1],
  'replayed terminal updates cannot duplicate the fallback'
);

select pg_temp.act_as('11000000-0000-0000-0000-000000000011');
select public.set_notification_channel_policy(
  '11000000-0000-0000-0000-000000000001', false, 0, 1
);
reset role;
insert into public.notification_deliveries (
  id, organization_id, profile_id, channel, delivery_type, recipient, status
) values (
  '11000000-0000-0000-0000-000000000202', '11000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000012', 'email', 'escalation',
  'notification-worker-a@test.local', 'pending'
);
update public.notification_deliveries
set status = 'failed', final_outcome = 'failed', finalized_at = now()
where id = '11000000-0000-0000-0000-000000000202';
select results_eq(
  $$ select count(*)::int from public.notification_deliveries
     where parent_delivery_id = '11000000-0000-0000-0000-000000000202' $$,
  array[0],
  'the fallback kill switch prevents alternate-channel sends'
);

select pg_temp.act_as('11000000-0000-0000-0000-000000000011');
select lives_ok(
  $$ select public.set_notification_spend_policy(
       '11000000-0000-0000-0000-000000000001', 0.01, 0.01, 0.01, 80
     ) $$,
  'organization admin can configure explicit provider cost estimates and budget'
);
reset role;
insert into public.notification_deliveries (
  id, organization_id, profile_id, channel, delivery_type, recipient, status
) values (
  '11000000-0000-0000-0000-000000000203', '11000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000012', 'email', 'digest',
  'notification-worker-a@test.local', 'pending'
);
update public.notification_deliveries set status = 'processing'
where id = '11000000-0000-0000-0000-000000000203';
select lives_ok(
  $$ select * from public.begin_notification_delivery_attempt(
       '11000000-0000-0000-0000-000000000203', 'sendgrid', repeat('d', 64)
     ) $$,
  'attempt creation applies the configured cost estimate'
);
select results_eq(
  $$ select estimated_cost_micros from public.notification_delivery_attempts
     where delivery_id = '11000000-0000-0000-0000-000000000203' $$,
  array[10000::bigint],
  'attempt evidence snapshots the configured estimate in USD micros'
);
select results_eq(
  $$ select count(*)::int from public.notification_spend_alerts
     where organization_id = '11000000-0000-0000-0000-000000000001'
       and period_start = (date_trunc('month', now() at time zone 'UTC'))::date $$,
  array[2],
  'warning and budget spend thresholds each create one deduplicated alert'
);

select pg_temp.act_as('11000000-0000-0000-0000-000000000011');
select public.set_notification_channel_policy(
  '11000000-0000-0000-0000-000000000001', true, 0, 1
);
reset role;
insert into public.notification_deliveries (
  id, organization_id, profile_id, channel, delivery_type, recipient, status
) values (
  '11000000-0000-0000-0000-000000000205', '11000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000012', 'email', 'alert',
  'notification-worker-a@test.local', 'pending'
);
update public.notification_deliveries set status = 'processing'
where id = '11000000-0000-0000-0000-000000000205';
do $block$
declare v_attempt_id uuid;
begin
  perform 1 from public.begin_notification_delivery_attempt(
    '11000000-0000-0000-0000-000000000205', 'sendgrid', repeat('f', 64)
  );
  select id into v_attempt_id from public.notification_delivery_attempts
  where delivery_id = '11000000-0000-0000-0000-000000000205';
  perform public.complete_notification_delivery_attempt(
    v_attempt_id, 'accepted', 'sg-monotonic-message', 'accepted', 202, null, null
  );
end;
$block$;
select is(
  public.record_notification_provider_event(
    'sendgrid', 'sg-monotonic-failed-1',
    (select id from public.notification_delivery_attempts
     where delivery_id = '11000000-0000-0000-0000-000000000205'),
    'sg-monotonic-message', 'bounce', 'failed', 'bounce', 'Mailbox rejected', now()
  ),
  true,
  'a signed terminal failure is recorded'
);
select results_eq(
  $$ select count(*)::int from public.notification_deliveries
     where parent_delivery_id = '11000000-0000-0000-0000-000000000205'
       and status = 'pending' $$,
  array[1],
  'the failure queues an unsent alternate-channel fallback'
);
select pg_temp.act_as('11000000-0000-0000-0000-000000000010');
select public.retry_notification_delivery('11000000-0000-0000-0000-000000000205');
reset role;
update public.notification_deliveries set status = 'processing'
where id = '11000000-0000-0000-0000-000000000205';
do $block$
declare v_attempt_id uuid;
begin
  perform 1 from public.begin_notification_delivery_attempt(
    '11000000-0000-0000-0000-000000000205', 'sendgrid', repeat('1', 64)
  );
  select id into v_attempt_id from public.notification_delivery_attempts
  where delivery_id = '11000000-0000-0000-0000-000000000205'
    and attempt_number = 2;
  perform public.complete_notification_delivery_attempt(
    v_attempt_id, 'accepted', 'sg-monotonic-retry', 'accepted', 202, null, null
  );
end;
$block$;
select is(
  public.record_notification_provider_event(
    'sendgrid', 'sg-monotonic-current-failed',
    (select id from public.notification_delivery_attempts
     where delivery_id = '11000000-0000-0000-0000-000000000205'
       and attempt_number = 2),
    'sg-monotonic-retry', 'bounce', 'failed', 'bounce', 'Retry failed', now()
  ),
  true,
  'the current retry can record its own terminal failure'
);
select is(
  public.record_notification_provider_event(
    'sendgrid', 'sg-monotonic-delivered-1',
    (select id from public.notification_delivery_attempts
     where delivery_id = '11000000-0000-0000-0000-000000000205'
       and attempt_number = 1),
    'sg-monotonic-message', 'delivered', 'delivered', null, null,
    now() - interval '1 hour'
  ),
  true,
  'older positive delivery proof dominates a previously received failure'
);
select results_eq(
  $$ select d.final_outcome,
       (select a.status from public.notification_delivery_attempts a
        where a.delivery_id = d.id and a.attempt_number = 1),
       (select a.status from public.notification_delivery_attempts a
        where a.delivery_id = d.id and a.attempt_number = 2)
     from public.notification_deliveries d
     where d.id = '11000000-0000-0000-0000-000000000205' $$,
  $$ values ('delivered'::text, 'delivered'::text, 'failed'::text) $$,
  'positive proof from an earlier attempt completes the aggregate delivery'
);
select results_eq(
  $$ select status from public.notification_deliveries
     where parent_delivery_id = '11000000-0000-0000-0000-000000000205' $$,
  array['skipped'],
  'delivery correction cancels the still-unsent fallback'
);
select is(
  public.record_notification_provider_event(
    'sendgrid', 'sg-monotonic-failed-2',
    (select id from public.notification_delivery_attempts
     where delivery_id = '11000000-0000-0000-0000-000000000205'
       and attempt_number = 1),
    'sg-monotonic-message', 'dropped', 'failed', 'dropped', 'Later failure',
    now() + interval '1 hour'
  ),
  true,
  'later contradictory failure remains available as provider evidence'
);
select results_eq(
  $$ select d.final_outcome,
       (select a.status from public.notification_delivery_attempts a
        where a.delivery_id = d.id and a.attempt_number = 1)
     from public.notification_deliveries d
     where d.id = '11000000-0000-0000-0000-000000000205' $$,
  $$ values ('delivered'::text, 'delivered'::text) $$,
  'proven delivery cannot be downgraded by a later failure callback'
);
select results_eq(
  $$ select count(*)::int from public.notification_provider_events
     where delivery_id = '11000000-0000-0000-0000-000000000205' $$,
  array[4],
  'all contradictory signed callbacks remain in the immutable event ledger'
);

insert into public.alerts (
  id, organization_id, alert_type, title, message, severity, status, created_at
) values (
  '11000000-0000-0000-0000-000000000301', '11000000-0000-0000-0000-000000000001',
  'due_7', 'Operations alert', 'Test alert requiring escalation', 'critical', 'open',
  now() - interval '6 days'
);
select public.escalate_unactioned_alerts();
select results_eq(
  $$ select count(*)::int from public.notifications
     where organization_id = '11000000-0000-0000-0000-000000000001'
       and profile_id = '11000000-0000-0000-0000-000000000011'
       and title = 'Unresolved: Operations alert' $$,
  array[1],
  'unactioned-alert escalation creates one in-app notification per scoped administrator'
);
select results_eq(
  $$ select count(*)::int, min(d.delivery_type)
     from public.notification_deliveries d
     join public.notifications n on n.id = d.notification_id
     where n.organization_id = '11000000-0000-0000-0000-000000000001'
       and n.profile_id = '11000000-0000-0000-0000-000000000011'
       and n.title = 'Unresolved: Operations alert' $$,
  $$ values (1, 'escalation'::text) $$,
  'escalation uses exactly one preferred provider delivery without duplicate fanout'
);
select public.send_monday_digest();
select results_eq(
  $$ select count(*)::int from public.notifications
     where organization_id = '11000000-0000-0000-0000-000000000001'
       and profile_id = '11000000-0000-0000-0000-000000000011'
       and title = 'Weekly compliance digest' $$,
  array[1],
  'weekly digest creates one in-app notification for the organization administrator'
);
select results_eq(
  $$ select count(*)::int, min(d.delivery_type)
     from public.notification_deliveries d
     join public.notifications n on n.id = d.notification_id
     where n.organization_id = '11000000-0000-0000-0000-000000000001'
       and n.profile_id = '11000000-0000-0000-0000-000000000011'
       and n.title = 'Weekly compliance digest' $$,
  $$ values (1, 'digest'::text) $$,
  'digest uses exactly one preferred provider delivery without duplicate fanout'
);

insert into public.notification_deliveries (
  id, organization_id, profile_id, channel, delivery_type, recipient, status
) values (
  '11000000-0000-0000-0000-000000000204', '11000000-0000-0000-0000-000000000002',
  '11000000-0000-0000-0000-000000000013', 'email', 'digest',
  'NOTIFICATION-WORKER-A@TEST.LOCAL', 'pending'
);
select is(
  public.record_notification_consent_event(
    'email', 'opt_out', 'sendgrid', 'sg-email-opt-out-normalized-1', repeat('e', 64),
    now(), 'sendgrid_unsubscribe',
    (select id from public.notification_delivery_attempts
     where delivery_id = '11000000-0000-0000-0000-000000000203'),
    ' notification-worker-a@test.local '
  ),
  2,
  'a signed SendGrid opt-out updates every profile for the normalized address'
);
select results_eq(
  $$ select count(*)::int from public.profiles
     where lower(btrim(email)) = 'notification-worker-a@test.local'
       and email_opt_out $$,
  array[2],
  'email suppression applies across case variants and tenant send paths'
);
select results_eq(
  $$ select count(*)::int from public.notification_deliveries
     where id in (
       '11000000-0000-0000-0000-000000000203',
       '11000000-0000-0000-0000-000000000204'
     ) and status = 'skipped' $$,
  array[2],
  'address-wide opt-out cancels every queued or processing email delivery'
);
select is(
  public.record_notification_consent_event(
    'email', 'opt_out', 'sendgrid', 'sg-email-opt-out-normalized-1', repeat('e', 64),
    now(), 'sendgrid_unsubscribe',
    (select id from public.notification_delivery_attempts
     where delivery_id = '11000000-0000-0000-0000-000000000203'),
    'notification-worker-a@test.local'
  ),
  0,
  'replayed SendGrid suppression evidence is idempotent'
);
select is(
  public.record_notification_consent_event(
    'email', 'opt_in', 'sendgrid', 'sg-email-stale-resubscribe-1', repeat('e', 64),
    now() - interval '1 day', 'sendgrid_group_resubscribe',
    (select id from public.notification_delivery_attempts
     where delivery_id = '11000000-0000-0000-0000-000000000203'),
    'notification-worker-a@test.local'
  ),
  0,
  'an out-of-order older consent event is retained without changing current state'
);
select results_eq(
  $$ select count(*)::int from public.profiles
     where lower(btrim(email)) = 'notification-worker-a@test.local'
       and email_opt_out $$,
  array[2],
  'a stale opt-in cannot undo a newer address-wide opt-out'
);

select pg_temp.act_as('11000000-0000-0000-0000-000000000011');
select ok(
  (public.get_notification_delivery_operations(null, 24) -> 'summary' ->> 'delivered') is not null,
  'organization admin receives a tenant-scoped delivery operations summary'
);
reset role;
select pg_temp.act_as('11000000-0000-0000-0000-000000000013');
select throws_ok(
  $$ select public.get_notification_delivery_evidence(
       '11000000-0000-0000-0000-000000000203'
     ) $$,
  '42501', null,
  'another tenant administrator cannot read delivery evidence'
);
reset role;

update public.profiles set sms_consent_at = '2025-01-01 00:00:00+00'
where id = '11000000-0000-0000-0000-000000000012';
select pg_temp.act_as('11000000-0000-0000-0000-000000000011');
select lives_ok(
  $$ select * from public.update_profile_contact_preferences(
       '11000000-0000-0000-0000-000000000012', 'Notification', 'Worker',
       '+12155550200', true, 'sms'
     ) $$,
  'changing an opted-in phone number requires a new consent attestation'
);
reset role;
select results_eq(
  $$ select phone, sms_consent_at > '2025-01-01 00:00:00+00'::timestamptz
     from public.profiles where id = '11000000-0000-0000-0000-000000000012' $$,
  $$ values ('+12155550200'::text, true) $$,
  'phone-change consent is timestamped for the new recipient'
);

select pg_temp.act_as('11000000-0000-0000-0000-000000000011');
select lives_ok(
  $$ select * from public.update_profile_contact_preferences(
       '11000000-0000-0000-0000-000000000012', 'Notification', 'Worker',
       '+12155550200', false, 'email'
     ) $$,
  'an authorized administrator can record a direct SMS preference opt-out'
);
reset role;
select results_eq(
  $$ select sms_opt_in, sms_opt_out_at is not null, preferred_notification_channel
     from public.profiles where id = '11000000-0000-0000-0000-000000000012' $$,
  $$ values (false, true, 'email'::text) $$,
  'direct opt-out records its timestamp and restores an eligible channel preference'
);
select throws_ok(
  $$ update public.profiles set preferred_notification_channel = 'sms'
     where id = '11000000-0000-0000-0000-000000000012' $$,
  '23514', null,
  'a database invariant blocks direct SMS preference without active consent'
);

select results_eq(
  $$ select count(*)::int from app_private.audit_entity_manifest
     where table_name in (
       'notification_templates', 'notification_channel_policies',
       'notification_spend_policies', 'notification_spend_alerts'
     ) and audit_mode = 'row_trigger' $$,
  array[4],
  'notification operations tables are registered in the audited-entity manifest'
);
select ok(
  not has_table_privilege('authenticated', 'public.notification_channel_policies', 'UPDATE'),
  'channel policies cannot be bypassed with a direct table update'
);

select * from finish();
rollback;
