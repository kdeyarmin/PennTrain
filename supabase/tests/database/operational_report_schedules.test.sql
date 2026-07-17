begin;
select plan(35);

select has_table('public', 'report_schedule_runs', 'report schedule run receipts exist');
select has_column('public', 'report_schedules', 'frequency', 'report schedules store frequency explicitly');
select has_column('public', 'report_schedules', 'delivery_hour', 'report schedules store delivery hour');
select has_column('public', 'report_schedules', 'delivery_minute', 'report schedules store delivery minute');
select has_column('public', 'report_schedules', 'delivery_day_of_week', 'weekly schedules store their weekday');
select has_column('public', 'report_schedules', 'delivery_day_of_month', 'monthly schedules store their month day');
select has_function(
  'app_private', 'next_configured_report_schedule_run',
  array['text','text','timestamp with time zone','integer','integer','integer','integer'],
  'configured schedule calculation helper exists'
);
select has_function(
  'public', 'preview_report_schedule',
  array['text','text','integer','integer','integer','integer'],
  'schedule preview API exists'
);
select has_function(
  'public', 'save_report_schedule_configuration',
  array['uuid','text','text','jsonb','text','integer','integer','integer','integer','uuid'],
  'schedule create and edit API exists'
);
select has_function(
  'public', 'get_report_schedule_operations', array[]::text[],
  'schedule operations read model exists'
);
select ok(
  has_function_privilege('authenticated', 'public.preview_report_schedule(text,text,integer,integer,integer,integer)', 'EXECUTE'),
  'authenticated managers may preview schedules'
);
select ok(
  not has_function_privilege('anon', 'public.save_report_schedule_configuration(uuid,text,text,jsonb,text,integer,integer,integer,integer,uuid)', 'EXECUTE'),
  'anonymous callers cannot configure schedules'
);
select ok(
  not has_function_privilege('authenticated', 'public.process_due_report_schedules()', 'EXECUTE'),
  'authenticated callers cannot execute the schedule worker'
);
select ok(
  has_function_privilege('service_role', 'public.process_due_report_schedules()', 'EXECUTE'),
  'the trusted worker may execute due schedules'
);
select is(
  app_private.next_configured_report_schedule_run(
    'daily', 'America/New_York', '2026-03-07 14:00:00+00'::timestamptz,
    7, 0, null, null
  ),
  '2026-03-08 11:00:00+00'::timestamptz,
  'configured delivery remains at 7 AM across daylight-saving time'
);
select throws_ok(
  $$
    select app_private.next_configured_report_schedule_run(
      'weekly', 'America/New_York', now(), 7, 0, null, null
    )
  $$,
  '22023',
  'Report schedule configuration is invalid',
  'weekly schedules require an explicit weekday'
);
select matches(
  pg_get_functiondef('public.save_report_schedule(uuid,text,text,jsonb,text)'::regprocedure),
  'save_report_schedule_configuration',
  'the legacy save command routes through the explicit configuration model'
);

insert into public.organizations(id, name, slug, subscription_status)
values ('97600000-0000-4000-8000-000000000001', 'Schedule Roundtrip Org', 'schedule-roundtrip-org', 'active');

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  (
    '00000000-0000-0000-0000-000000000000',
    '97600000-0000-4000-8000-000000000101',
    'authenticated', 'authenticated', 'schedule-admin@test.local', 'x', now(),
    '{}', '{}', now(), now(), '', '', '', '', '', '', false, false
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '97600000-0000-4000-8000-000000000102',
    'authenticated', 'authenticated', 'schedule-employee@test.local', 'x', now(),
    '{}', '{}', now(), now(), '', '', '', '', '', '', false, false
  );

select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active, email_opt_out)
values
  (
    '97600000-0000-4000-8000-000000000101',
    '97600000-0000-4000-8000-000000000001',
    'schedule-admin@test.local', 'Schedule', 'Admin', 'org_admin', true, false
  ),
  (
    '97600000-0000-4000-8000-000000000102',
    '97600000-0000-4000-8000-000000000001',
    'schedule-employee@test.local', 'Schedule', 'Auditor', 'auditor', true, true
  )
on conflict(id) do update set
  organization_id = excluded.organization_id,
  role = excluded.role,
  is_active = true,
  email_opt_out = excluded.email_opt_out;
select set_config('app.privileged_write', 'off', true);

insert into public.organization_settings(organization_id, email_notifications_enabled)
values ('97600000-0000-4000-8000-000000000001', true)
on conflict (organization_id) do update
set email_notifications_enabled = excluded.email_notifications_enabled;

insert into public.saved_report_definitions(
  id, organization_id, name, report_type, retention_days
) values (
  '97600000-0000-4000-8000-000000000201',
  '97600000-0000-4000-8000-000000000001',
  'Friday compliance summary', 'compliance', 2555
);
insert into public.saved_report_versions(
  id, report_definition_id, organization_id, version_number, filters, columns,
  configuration_sha256, state, published_at
) values (
  '97600000-0000-4000-8000-000000000202',
  '97600000-0000-4000-8000-000000000201',
  '97600000-0000-4000-8000-000000000001',
  1, '{}'::jsonb, '["status"]'::jsonb, repeat('a', 64), 'published', now()
);
update public.saved_report_definitions
set current_version_id = '97600000-0000-4000-8000-000000000202'
where id = '97600000-0000-4000-8000-000000000201';

create or replace function pg_temp.act_as(p_id uuid)
returns void
language plpgsql
as $$
begin
  reset role;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', p_id,
      'role', 'authenticated',
      'aal', 'aal2',
      'iat', extract(epoch from now())::bigint
    )::text,
    true
  );
  set local role authenticated;
end;
$$;

select pg_temp.act_as('97600000-0000-4000-8000-000000000101');

select throws_ok(
  $$
    select public.save_report_schedule_configuration(
      '97600000-0000-4000-8000-000000000201',
      'weekly',
      'in_app',
      '{"roles":["employee"]}'::jsonb,
      'America/New_York',
      9,
      30,
      5,
      null
    )
  $$,
  '22023',
  'Report audience role is invalid',
  'schedule audiences cannot include roles that cannot open saved reports'
);

select lives_ok(
  $$
    select public.save_report_schedule_configuration(
      '97600000-0000-4000-8000-000000000201',
      'weekly',
      'email_link',
      '{"roles":["org_admin","auditor"]}'::jsonb,
      'America/New_York',
      9,
      30,
      5,
      null
    )
  $$,
  'an organization admin can create a configurable email-link schedule'
);
select is(
  (select count(*)::integer from public.report_schedules
   where report_definition_id = '97600000-0000-4000-8000-000000000201'),
  1,
  'schedule creation persists one subscription'
);
select is(
  (select cron_expression from public.report_schedules
   where report_definition_id = '97600000-0000-4000-8000-000000000201'),
  '30 9 * * 5',
  'schedule creation persists the matching cron expression'
);
select ok(
  (select next_run_at > now() from public.report_schedules
   where report_definition_id = '97600000-0000-4000-8000-000000000201'),
  'schedule creation calculates a future next run'
);
select lives_ok(
  $$
    select public.save_report_schedule_configuration(
      '97600000-0000-4000-8000-000000000201',
      'weekly',
      'email_link',
      '{"roles":["org_admin","auditor"]}'::jsonb,
      'America/New_York',
      9,
      45,
      5,
      null,
      (select id from public.report_schedules where report_definition_id = '97600000-0000-4000-8000-000000000201')
    )
  $$,
  'an organization admin can edit an existing schedule'
);
select is(
  (select count(*)::integer from public.report_schedules
   where report_definition_id = '97600000-0000-4000-8000-000000000201'),
  1,
  'editing does not create a duplicate subscription'
);
select is(
  (select delivery_minute from public.report_schedules
   where report_definition_id = '97600000-0000-4000-8000-000000000201'),
  45,
  'editing persists the changed delivery minute'
);
select is(
  jsonb_array_length(public.get_report_schedule_operations()->'schedules'),
  1,
  'the operations read model returns the scoped schedule'
);

reset role;
update public.report_schedules
set next_run_at = now() - interval '1 minute'
where report_definition_id = '97600000-0000-4000-8000-000000000201';

select is(public.process_due_report_schedules(), 1, 'the worker processes the due schedule once');
select is(
  (select status from public.report_schedule_runs),
  'partial',
  'a skipped opted-out email produces a visible partial receipt'
);
select is(
  (select audience_count from public.report_schedule_runs),
  2,
  'the run receipt records the resolved audience count'
);
select is(
  (select concat(email_queued_count, '/', email_skipped_count) from public.report_schedule_runs),
  '1/1',
  'the run receipt distinguishes queued and skipped email links'
);
select is(
  (select count(*)::integer from public.notifications
   where organization_id = '97600000-0000-4000-8000-000000000001'
     and notification_type = 'report_subscription_ready'),
  2,
  'every active audience member receives an in-app notification'
);
select is(
  (select count(*)::integer from public.notification_deliveries d
   join public.notifications n on n.id = d.notification_id
   where n.organization_id = '97600000-0000-4000-8000-000000000001'
     and n.notification_type = 'report_subscription_ready'
     and d.channel = 'email'),
  1,
  'eligible email-link recipients are queued in the delivery outbox'
);
select ok(
  (select next_run_at > now() from public.report_schedules
   where report_definition_id = '97600000-0000-4000-8000-000000000201'),
  'the worker advances the schedule to a future run'
);

select pg_temp.act_as('97600000-0000-4000-8000-000000000101');
select is(
  jsonb_array_length(public.get_report_schedule_operations()->'schedules'->0->'runs'),
  1,
  'delivery history is visible in the tenant-scoped operations read model'
);

reset role;
select throws_ok(
  $$update public.report_schedule_runs set status = 'completed'$$,
  '55000',
  'Product value execution evidence is append-only',
  'report schedule run receipts are append-only'
);

select * from finish();
rollback;
