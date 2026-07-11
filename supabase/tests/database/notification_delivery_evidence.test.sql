begin;
select plan(31);

select is(
  public.notification_next_permitted_at('2026-01-15 15:00:00+00', 'America/New_York'),
  '2026-01-15 15:00:00+00'::timestamptz,
  'SMS requested inside the local window is not deferred'
);
select is(
  public.notification_next_permitted_at('2026-01-15 07:00:00+00', 'America/New_York'),
  '2026-01-15 13:00:00+00'::timestamptz,
  'SMS requested before 08:00 local is deferred to 08:00 local'
);
select is(
  public.notification_next_permitted_at('2026-01-16 03:00:00+00', 'America/New_York'),
  '2026-01-16 13:00:00+00'::timestamptz,
  'SMS requested at or after 21:00 local is deferred to next-day 08:00 local'
);
select throws_ok(
  $$ select public.notification_next_permitted_at(now(), 'Not/A_Timezone') $$,
  '22023', null,
  'unknown recipient time zones are rejected'
);

insert into public.organizations (id, name, slug) values
  ('10000000-0000-0000-0000-000000000001', 'Notification Test Org', 'notification-test-org');
insert into public.facilities (id, organization_id, name, facility_type) values
  ('10000000-0000-0000-0000-000000000020', '10000000-0000-0000-0000-000000000001', 'Notification Facility A', 'PCH'),
  ('10000000-0000-0000-0000-000000000021', '10000000-0000-0000-0000-000000000001', 'Notification Facility B', 'PCH');
insert into public.organization_settings (
  organization_id, email_notifications_enabled, sms_notifications_enabled
) values (
  '10000000-0000-0000-0000-000000000001', true, true
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
)
select '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated', v.email,
  'x', now(), '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '', '', '', false, false
from (values
  ('10000000-0000-0000-0000-000000000002'::uuid, 'delivery-admin@test.local'),
  ('10000000-0000-0000-0000-000000000003'::uuid, 'delivery-sms@test.local'),
  ('10000000-0000-0000-0000-000000000004'::uuid, 'delivery-worker@test.local'),
  ('10000000-0000-0000-0000-000000000005'::uuid, 'delivery-manager-a@test.local'),
  ('10000000-0000-0000-0000-000000000006'::uuid, 'delivery-manager-b@test.local')
) as v(id, email);

insert into public.profiles (
  id, organization_id, email, phone, first_name, last_name, role, is_active,
  notification_timezone, sms_opt_in, sms_consent_at
) values
  ('10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001',
   'delivery-admin@test.local', null, 'Delivery', 'Admin', 'org_admin', true,
   'America/New_York', false, null),
  ('10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001',
   'delivery-sms@test.local', '+12155550123', 'Delivery', 'SMS', 'employee', true,
   'America/New_York', true, now()),
  ('10000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001',
   'delivery-worker@test.local', null, 'Delivery', 'Worker', 'employee', true,
   'America/New_York', false, null),
  ('10000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001',
   'delivery-manager-a@test.local', null, 'Delivery', 'Manager A', 'facility_manager', true,
   'America/New_York', false, null),
  ('10000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001',
   'delivery-manager-b@test.local', null, 'Delivery', 'Manager B', 'facility_manager', true,
   'America/New_York', false, null);

insert into public.facility_assignments (profile_id, facility_id) values
  ('10000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000020'),
  ('10000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000021');

insert into public.employees (
  id, organization_id, facility_id, profile_id, first_name, last_name, job_title, status
) values
  (
    '10000000-0000-0000-0000-000000000030', '10000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000020', '10000000-0000-0000-0000-000000000003',
    'Delivery', 'SMS', 'Aide', 'active'
  ),
  (
    '10000000-0000-0000-0000-000000000031', '10000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000020', '10000000-0000-0000-0000-000000000004',
    'Delivery', 'Worker', 'Aide', 'active'
  );

select throws_ok(
  $$ update public.profiles
     set notification_timezone = 'Mars/Olympus_Mons'
     where id = '10000000-0000-0000-0000-000000000002' $$,
  '23514', null,
  'profile notification time zone must be a real IANA zone'
);

insert into public.notification_deliveries (
  id, organization_id, profile_id, channel, delivery_type, recipient, status
) values (
  '10000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000002', 'email', 'alert',
  'delivery-admin@test.local', 'pending'
);
update public.notification_deliveries
set status = 'processing'
where id = '10000000-0000-0000-0000-000000000010';

select lives_ok(
  $$ select * from public.begin_notification_delivery_attempt(
       '10000000-0000-0000-0000-000000000010', 'sendgrid', repeat('a', 64)
     ) $$,
  'provider attempt can begin for an enabled and consent-eligible delivery'
);
select results_eq(
  $$ select attempt_number from public.notification_delivery_attempts
     where delivery_id = '10000000-0000-0000-0000-000000000010' $$,
  array[1],
  'attempt evidence records the first attempt number'
);
select results_eq(
  $$ select content_sha256 from public.notification_delivery_attempts
     where delivery_id = '10000000-0000-0000-0000-000000000010' $$,
  array[repeat('a', 64)],
  'attempt evidence records a non-content-revealing payload hash'
);

select lives_ok(
  $$ select public.complete_notification_delivery_attempt(
       (select id from public.notification_delivery_attempts
        where delivery_id = '10000000-0000-0000-0000-000000000010'),
       'accepted', 'sg-message-1', 'accepted', 202, null, null
     ) $$,
  'provider API acceptance is recorded without claiming final delivery'
);
select results_eq(
  $$ select status from public.notification_deliveries
     where id = '10000000-0000-0000-0000-000000000010' $$,
  array['accepted'],
  'provider acceptance remains non-terminal'
);

select ok(
  public.record_notification_provider_event(
    'sendgrid', 'sg-event-delivered-1',
    (select id from public.notification_delivery_attempts
     where delivery_id = '10000000-0000-0000-0000-000000000010'),
    'sg-message-1', 'delivered', 'delivered', null, null, now()
  ),
  'signed provider event is recorded once'
);
select is(
  public.record_notification_provider_event(
    'sendgrid', 'sg-event-delivered-1',
    (select id from public.notification_delivery_attempts
     where delivery_id = '10000000-0000-0000-0000-000000000010'),
    'sg-message-1', 'delivered', 'delivered', null, null, now()
  ),
  false,
  'replayed provider event is ignored'
);
select results_eq(
  $$ select status, final_outcome from public.notification_deliveries
     where id = '10000000-0000-0000-0000-000000000010' $$,
  $$ values ('delivered'::text, 'delivered'::text) $$,
  'terminal callback reconciles the delivery outcome'
);
select results_eq(
  $$ with recorded as (
       select public.record_notification_provider_event(
         'sendgrid', 'sg-event-late-processed-1',
         (select id from public.notification_delivery_attempts
          where delivery_id = '10000000-0000-0000-0000-000000000010'),
         'sg-message-1', 'processed', null, null, null, now() - interval '1 minute'
       )
     )
     select d.status, d.final_outcome, d.last_provider_status
     from public.notification_deliveries d, recorded
     where d.id = '10000000-0000-0000-0000-000000000010' $$,
  $$ values ('delivered'::text, 'delivered'::text, 'delivered'::text) $$,
  'out-of-order progress callbacks cannot downgrade a terminal outcome'
);
select results_eq(
  $$ select count(*)::int from public.notification_provider_events
     where provider_event_id = 'sg-event-delivered-1' $$,
  array[1],
  'replay safety preserves exactly one provider event row'
);

insert into public.notification_deliveries (
  id, organization_id, profile_id, channel, delivery_type, recipient, status
) values (
  '10000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000004', 'email', 'alert',
  'delivery-worker@test.local', 'pending'
);
update public.notification_deliveries
set status = 'processing'
where id = '10000000-0000-0000-0000-000000000012';
do $block$
declare v_attempt_id uuid;
begin
  perform 1 from public.begin_notification_delivery_attempt(
    '10000000-0000-0000-0000-000000000012', 'sendgrid', repeat('c', 64)
  );
  select id into v_attempt_id from public.notification_delivery_attempts
  where delivery_id = '10000000-0000-0000-0000-000000000012';
  perform public.complete_notification_delivery_attempt(
    v_attempt_id, 'unknown', null, 'network_error', null, 'network_error',
    'Connection closed before a response'
  );
end;
$block$;
select results_eq(
  $$ select status, final_outcome from public.notification_deliveries
     where id = '10000000-0000-0000-0000-000000000012' $$,
  $$ values ('failed'::text, 'unknown'::text) $$,
  'ambiguous transport outcomes are quarantined instead of automatically replayed'
);
select results_eq(
  $$ with recorded as (
       select public.record_notification_provider_event(
         'sendgrid', 'sg-event-delivered-after-unknown',
         (select id from public.notification_delivery_attempts
          where delivery_id = '10000000-0000-0000-0000-000000000012'),
         'sg-message-after-unknown', 'delivered', 'delivered', null, null,
         now() - interval '1 minute'
       )
     )
     select d.status, d.final_outcome
     from public.notification_deliveries d, recorded
     where d.id = '10000000-0000-0000-0000-000000000012' $$,
  $$ values ('delivered'::text, 'delivered'::text) $$,
  'a later signed terminal callback resolves an ambiguous transport outcome'
);

insert into public.notification_deliveries (
  id, organization_id, profile_id, channel, delivery_type, recipient, status
) values (
  '10000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000003', 'sms', 'alert', '+12155550123', 'pending'
);

select is(
  public.record_notification_consent_event(
    'sms', 'opt_out', 'twilio', 'SM-stop-1', repeat('b', 64), now(),
    'twilio_advanced_opt_out', null, '+12155550123'
  ),
  1,
  'STOP records evidence and updates the matching profile'
);
select results_eq(
  $$ select sms_opt_in from public.profiles
     where id = '10000000-0000-0000-0000-000000000003' $$,
  array[false],
  'STOP disables SMS immediately'
);
select results_eq(
  $$ select status from public.notification_deliveries
     where id = '10000000-0000-0000-0000-000000000011' $$,
  array['skipped'],
  'STOP cancels queued SMS across the centralized send path'
);
select is(
  public.record_notification_consent_event(
    'sms', 'opt_out', 'twilio', 'SM-stop-1', repeat('b', 64), now(),
    'twilio_advanced_opt_out', null, '+12155550123'
  ),
  0,
  'replayed STOP event is idempotent'
);
select is(
  public.record_notification_consent_event(
    'sms', 'opt_in', 'twilio', 'SM-start-1', repeat('b', 64), now(),
    'twilio_advanced_opt_out', null, '+12155550123'
  ),
  1,
  'START creates a new affirmative consent event'
);
select results_eq(
  $$ select sms_opt_in, sms_consent_at is not null, sms_opt_out_at is null
     from public.profiles where id = '10000000-0000-0000-0000-000000000003' $$,
  $$ values (true, true, true) $$,
  'START restores SMS only with timestamped consent evidence'
);

select ok(
  has_table_privilege('authenticated', 'public.notification_delivery_attempts', 'SELECT')
  and not has_table_privilege('authenticated', 'public.notification_delivery_attempts', 'INSERT'),
  'authenticated users receive read-only attempt table grants'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.begin_notification_delivery_attempt(uuid,text,text)',
    'EXECUTE'
  ),
  'attempt mutation RPC is service-role only'
);
select results_eq(
  $$ select table_name, audit_mode
     from app_private.audit_entity_manifest
     where table_name in (
       'notification_consent_events',
       'notification_delivery_attempts',
       'notification_provider_events'
     )
     order by table_name $$,
  $$ values
       ('notification_consent_events'::text, 'domain_evidence'::text),
       ('notification_delivery_attempts'::text, 'row_trigger'::text),
       ('notification_provider_events'::text, 'domain_evidence'::text) $$,
  'notification evidence tables are classified in the audit manifest'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.notification_delivery_attempts'::regclass
      and t.tgname = 'audit_log'
      and not t.tgisinternal
  ),
  'mutable notification attempts carry the shared row audit trigger'
);
select ok(
  not has_table_privilege('service_role', 'public.notification_provider_events', 'UPDATE')
  and not has_table_privilege('service_role', 'public.notification_provider_events', 'DELETE')
  and not has_table_privilege('service_role', 'public.notification_consent_events', 'UPDATE')
  and not has_table_privilege('service_role', 'public.notification_consent_events', 'DELETE'),
  'append-only provider and consent evidence exposes no mutation grants'
);

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

select pg_temp.act_as('10000000-0000-0000-0000-000000000002');
select results_eq(
  $$ select count(*)::int from public.notification_delivery_attempts
     where organization_id = '10000000-0000-0000-0000-000000000001' $$,
  array[2],
  'org admin can inspect provider attempt evidence in their tenant'
);

reset role;
select pg_temp.act_as('10000000-0000-0000-0000-000000000005');
select results_eq(
  $$ select
       (select count(*)::int from public.notification_deliveries),
       (select count(*)::int from public.notification_delivery_attempts),
       (select count(*)::int from public.notification_provider_events),
       (select count(*)::int from public.notification_consent_events) $$,
  $$ values (2, 1, 1, 1) $$,
  'a facility manager sees notification evidence only for recipients in an assigned facility'
);

reset role;
select pg_temp.act_as('10000000-0000-0000-0000-000000000006');
select results_eq(
  $$ select
       (select count(*)::int from public.notification_deliveries),
       (select count(*)::int from public.notification_delivery_attempts),
       (select count(*)::int from public.notification_provider_events),
       (select count(*)::int from public.notification_consent_events) $$,
  $$ values (0, 0, 0, 0) $$,
  'a facility manager cannot read notification evidence for an unassigned facility'
);

select * from finish();
rollback;
