begin;
select plan(44);

select has_column('public', 'audit_logs', 'facility_id',
  'audit evidence carries facility scope');
select has_column('public', 'audit_logs', 'actor_subject_id',
  'audit evidence preserves the authenticated subject');
select has_column('public', 'audit_logs', 'request_id',
  'audit evidence carries request context');
select has_column('public', 'audit_logs', 'correlation_id',
  'audit evidence carries correlation context');
select has_column('public', 'audit_logs', 'source',
  'audit evidence identifies its source');
select has_column('public', 'audit_logs', 'event_hash',
  'audit evidence carries an integrity checksum');
select col_not_null('public', 'audit_logs', 'event_hash',
  'every audit row must have an integrity checksum');

select has_function(
  'public',
  'get_audit_coverage',
  array[]::text[],
  'platform administrators can inspect the audit manifest'
);
select has_function(
  'public',
  'get_audit_export_manifest',
  array['timestamp with time zone', 'timestamp with time zone', 'uuid'],
  'authorized users can create checksummed audit export manifests'
);
select has_function(
  'public',
  'get_system_job_control_plane',
  array[]::text[],
  'platform administrators can inspect system jobs'
);
select has_function(
  'public',
  'begin_system_job',
  array['text', 'text', 'text', 'text'],
  'workers have a standard idempotent job-start command'
);
select has_function(
  'public',
  'finish_system_job',
  array['uuid', 'text', 'bigint', 'bigint', 'bigint', 'jsonb', 'text', 'text'],
  'workers have a standard idempotent job-finish command'
);
select has_function(
  'public',
  'reconcile_audit_integrity',
  array['integer'],
  'audit integrity can be reconciled by a registered worker'
);
select has_function(
  'public',
  'create_audit_legal_hold',
  array['uuid', 'uuid', 'text', 'timestamp with time zone'],
  'platform administrators can place scoped audit legal holds'
);

insert into public.organizations (id, name, slug)
values (
  '00000000-0000-0000-0000-0000000000c1',
  'Phase One Test Org',
  'phase-one-test-org'
);

insert into public.facilities (id, organization_id, name, facility_type)
values
  (
    '00000000-0000-0000-0000-0000000000c2',
    '00000000-0000-0000-0000-0000000000c1',
    'Phase One Facility A',
    'PCH'
  ),
  (
    '00000000-0000-0000-0000-0000000000c3',
    '00000000-0000-0000-0000-0000000000c1',
    'Phase One Facility B',
    'PCH'
  );

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change,
  email_change_token_current,
  reauthentication_token,
  is_sso_user,
  is_anonymous
)
select
  '00000000-0000-0000-0000-000000000000',
  v.id,
  'authenticated',
  'authenticated',
  v.email,
  'x',
  now(),
  '{}'::jsonb,
  '{}'::jsonb,
  now(),
  now(),
  '',
  '',
  '',
  '',
  '',
  '',
  false,
  false
from (
  values
    (
      '00000000-0000-0000-0000-0000000000c4'::uuid,
      'phase1-platform@test.local'
    ),
    (
      '00000000-0000-0000-0000-0000000000c5'::uuid,
      'phase1-admin@test.local'
    ),
    (
      '00000000-0000-0000-0000-0000000000c6'::uuid,
      'phase1-manager-a@test.local'
    ),
    (
      '00000000-0000-0000-0000-0000000000c7'::uuid,
      'phase1-manager-b@test.local'
    )
) as v(id, email);

-- auth.users fires handle_new_user(); finish the trigger-created fixture rows under the
-- same transaction-local bypass used by trusted profile administration paths.
select set_config('app.privileged_write', 'on', true);

insert into public.profiles (
  id,
  organization_id,
  email,
  first_name,
  last_name,
  role,
  is_active
)
values
  (
    '00000000-0000-0000-0000-0000000000c4',
    null,
    'phase1-platform@test.local',
    'Platform',
    'Admin',
    'platform_admin',
    true
  ),
  (
    '00000000-0000-0000-0000-0000000000c5',
    '00000000-0000-0000-0000-0000000000c1',
    'phase1-admin@test.local',
    'Org',
    'Admin',
    'org_admin',
    true
  ),
  (
    '00000000-0000-0000-0000-0000000000c6',
    '00000000-0000-0000-0000-0000000000c1',
    'phase1-manager-a@test.local',
    'Manager',
    'A',
    'facility_manager',
    true
  ),
  (
    '00000000-0000-0000-0000-0000000000c7',
    '00000000-0000-0000-0000-0000000000c1',
    'phase1-manager-b@test.local',
    'Manager',
    'B',
    'facility_manager',
    true
  )
on conflict (id) do update set
  organization_id = excluded.organization_id,
  email = excluded.email,
  first_name = excluded.first_name,
  last_name = excluded.last_name,
  role = excluded.role,
  is_active = excluded.is_active;

select set_config('app.privileged_write', 'off', true);

insert into public.facility_assignments (profile_id, facility_id)
values
  (
    '00000000-0000-0000-0000-0000000000c6',
    '00000000-0000-0000-0000-0000000000c2'
  ),
  (
    '00000000-0000-0000-0000-0000000000c7',
    '00000000-0000-0000-0000-0000000000c3'
  );

insert into public.schedules (
  id,
  organization_id,
  facility_id,
  title,
  period_start,
  period_end,
  status,
  created_by
)
values (
  '00000000-0000-0000-0000-0000000000c8',
  '00000000-0000-0000-0000-0000000000c1',
  '00000000-0000-0000-0000-0000000000c2',
  'Phase One Schedule',
  current_date,
  current_date + 6,
  'draft',
  '00000000-0000-0000-0000-0000000000c5'
);

-- Direct/manual audit inserts still pass through the context/redaction trigger.
insert into public.audit_logs (
  organization_id,
  entity_type,
  entity_id,
  action,
  new_values
)
values (
  '00000000-0000-0000-0000-0000000000c1',
  'phase1_test',
  'redaction',
  'phase1_test_created',
  '{"password":"do-not-store","nested":{"access_token":"do-not-store"}}'::jsonb
);

select results_eq(
  $$
    select array[
      new_values->>'password',
      new_values->'nested'->>'access_token'
    ]
    from public.audit_logs
    where entity_type = 'phase1_test'
      and entity_id = 'redaction'
  $$,
  $$ values (array['[REDACTED]', '[REDACTED]']::text[]) $$,
  'audit payload redaction is recursive for credential fields'
);

select is(
  (
    select count(*)::bigint
    from public.audit_logs
    where event_hash is null
       or request_id is null
       or correlation_id is null
       or source is null
  ),
  0::bigint,
  'all audit evidence has integrity and request context'
);

select is(
  (select count(*)::bigint from public.audit_logs where hash_version <> 2),
  0::bigint,
  'all audit evidence uses the complete version-2 integrity hash'
);

select throws_ok(
  $$ update public.audit_logs set reason = 'mutation must fail'
     where entity_type = 'phase1_test' and entity_id = 'redaction' $$,
  '55000',
  null,
  'audit evidence is append-only even for a privileged database caller'
);

select is(
  (public.reconcile_audit_integrity(10000)->>'openIssues')::bigint,
  0::bigint,
  'audit reconciliation finds no malformed hashes, context, or trigger coverage gaps'
);

create or replace function pg_temp.act_as(p_profile_id uuid)
returns void
language plpgsql
as $$
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub',
      p_profile_id::text,
      'role',
      'authenticated',
      'aal',
      'aal1'
    )::text,
    true
  );
  set local role authenticated;
end;
$$;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000c4');

select is(
  (
    select count(*)::bigint
    from public.get_audit_coverage()
    where not has_required_trigger
  ),
  0::bigint,
  'every row-trigger entry in the audit manifest has its required trigger'
);

select is(
  (select count(*)::bigint from public.get_system_job_control_plane()),
  21::bigint,
  'the control plane registers every platform job, including organization exports and the weekly manager digest'
);

create temporary table phase1_hold_ids as
select public.create_audit_legal_hold(
  null,
  '00000000-0000-0000-0000-0000000000c2',
  'Preserve Phase 1 facility evidence for the test matter',
  now() + interval '7 days'
) as hold_id;

select is(
  (public.get_audit_governance_status()->>'activeLegalHolds')::bigint,
  1::bigint,
  'an active legal hold is visible in audit governance health'
);

reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c5');

select throws_ok(
  $$ select * from public.get_system_job_control_plane() $$,
  '42501',
  null,
  'organization administrators cannot inspect platform system jobs'
);

select throws_ok(
  $$
    select public.begin_system_job(
      'notification-dispatch',
      'unauthorized-run',
      'manual',
      null
    )
  $$,
  '42501',
  null,
  'authenticated users cannot start internal system jobs'
);

reset role;
insert into app_private.system_job_definitions (
  job_key, display_name, description, execution_kind, expected_interval,
  freshness_sla, retry_mode
) values (
  'phase1-test-unsupported', 'Phase 1 unsupported test',
  'Exercises durable SQL-worker failure recording', 'sql_cron',
  interval '1 day', interval '1 day', 'none'
);
set local role service_role;
create temporary table phase1_job_ids (first_id uuid, second_id uuid);
insert into phase1_job_ids (first_id, second_id)
select
  public.begin_system_job(
    'notification-dispatch',
    'phase1-idempotent-run',
    'manual',
    'provider-request-1'
  ),
  public.begin_system_job(
    'notification-dispatch',
    'phase1-idempotent-run',
    'manual',
    'provider-request-1'
  );

select is(
  (select first_id from phase1_job_ids),
  (select second_id from phase1_job_ids),
  'replaying a job start returns the original run'
);

select lives_ok(
  $$ select public.run_phase1_synthetic_checks() $$,
  'the service worker can run Phase 1 synthetic checks without a user JWT'
);

create temporary table phase1_failed_job_outcome on commit drop as
select public.execute_registered_sql_job(
  'phase1-test-unsupported', 'phase1-durable-failure', 'scheduled'
) as result;

select results_eq(
  $$ select o.result->>'status', r.status
     from phase1_failed_job_outcome o
     join app_private.system_job_runs r
       on r.id = (o.result->>'runId')::uuid $$,
  $$ values ('failed'::text, 'failed'::text) $$,
  'a SQL worker failure remains durable instead of rolling back with the job error'
);

select lives_ok(
  $$
    select public.finish_system_job(
      (select first_id from phase1_job_ids),
      'succeeded',
      3,
      3,
      0,
      '{"reconciled":true}'::jsonb,
      null,
      null
    )
  $$,
  'a worker can finish a running job'
);

select lives_ok(
  $$
    select public.finish_system_job(
      (select first_id from phase1_job_ids),
      'succeeded',
      3,
      3,
      0,
      '{"reconciled":true}'::jsonb,
      null,
      null
    )
  $$,
  'replaying the same terminal job state is safe'
);

select throws_ok(
  $$
    select public.finish_system_job(
      (select first_id from phase1_job_ids),
      'failed',
      3,
      2,
      1,
      '{}'::jsonb,
      'conflict',
      'must not overwrite terminal success'
    )
  $$,
  null,
  null,
  'a conflicting terminal replay is rejected'
);

insert into app_private.system_job_definitions (
  job_key, display_name, description, execution_kind, expected_interval,
  freshness_sla, retry_mode, failure_alert_threshold
) values (
  'phase1-test-circuit', 'Phase 1 circuit test',
  'Exercises provider circuit open, half-open, and recovery behavior',
  'edge_cron', interval '1 hour', interval '2 hours', 'manual', 1
);

create temporary table phase1_circuit_ids (failed_id uuid, trial_id uuid);
insert into phase1_circuit_ids (failed_id)
select public.begin_system_job(
  'phase1-test-circuit', 'phase1-circuit-failure', 'scheduled', null
);

select lives_ok(
  $$ select public.finish_system_job(
       (select failed_id from phase1_circuit_ids),
       'failed', 1, 0, 1, '{}'::jsonb, 'provider_down', 'provider unavailable'
     ) $$,
  'a failed provider run opens a threshold-one circuit'
);

select is(
  (select circuit_state from app_private.system_job_definitions
   where job_key = 'phase1-test-circuit'),
  'open',
  'the provider circuit records its open state'
);

select throws_ok(
  $$ select public.begin_system_job(
       'phase1-test-circuit', 'phase1-circuit-blocked', 'scheduled', null
     ) $$,
  '55000',
  null,
  'an open provider circuit rejects new work'
);

update app_private.system_job_definitions
set circuit_open_until = now() - interval '1 second'
where job_key = 'phase1-test-circuit';

update phase1_circuit_ids
set trial_id = public.begin_system_job(
  'phase1-test-circuit', 'phase1-circuit-trial', 'scheduled', null
);

select is(
  (select circuit_state from app_private.system_job_definitions
   where job_key = 'phase1-test-circuit'),
  'half_open',
  'an expired open interval admits one half-open trial'
);

select throws_ok(
  $$ select public.begin_system_job(
       'phase1-test-circuit', 'phase1-circuit-second-trial', 'scheduled', null
     ) $$,
  '55000',
  null,
  'a half-open circuit rejects a concurrent second trial'
);

select lives_ok(
  $$ select public.finish_system_job(
       (select trial_id from phase1_circuit_ids),
       'succeeded', 1, 1, 0, '{"providerHealthy":true}'::jsonb, null, null
     ) $$,
  'a successful half-open provider trial finishes normally'
);

select is(
  (select circuit_state from app_private.system_job_definitions
   where job_key = 'phase1-test-circuit'),
  'closed',
  'a successful half-open trial closes the provider circuit'
);

reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c4');

select results_eq(
  $$
    select last_status
    from public.get_system_job_control_plane()
    where job_key = 'notification-dispatch'
  $$,
  $$ values ('succeeded'::text) $$,
  'the control plane exposes the latest worker outcome'
);

reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c6');

select lives_ok(
  $$
    update public.schedules
    set title = 'Phase One Schedule Updated'
    where id = '00000000-0000-0000-0000-0000000000c8'
  $$,
  'an assigned facility manager can update an in-scope schedule'
);

select is(
  (
    select actor_subject_id
    from public.audit_logs
    where entity_type = 'schedules'
      and entity_id = '00000000-0000-0000-0000-0000000000c8'
      and action = 'schedules_updated'
    order by created_at desc
    limit 1
  ),
  '00000000-0000-0000-0000-0000000000c6',
  'the schedule audit row identifies its authenticated actor'
);

select isnt_empty(
  $$
    select 1
    from public.audit_logs
    where entity_type = 'schedules'
      and entity_id = '00000000-0000-0000-0000-0000000000c8'
      and facility_id = '00000000-0000-0000-0000-0000000000c2'
  $$,
  'a facility manager can read audit evidence for an assigned facility'
);

reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c7');

select is_empty(
  $$
    select 1
    from public.audit_logs
    where entity_type = 'schedules'
      and entity_id = '00000000-0000-0000-0000-0000000000c8'
  $$,
  'a facility manager cannot read audit evidence for another facility'
);

reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c5');

select cmp_ok(
  (
    public.get_audit_export_manifest(
      now() - interval '1 hour',
      now() + interval '1 hour',
      '00000000-0000-0000-0000-0000000000c1'
    )->>'rowCount'
  )::bigint,
  '>',
  0::bigint,
  'an organization audit export manifest includes its evidence rows'
);

select is(
  length(
    public.get_audit_export_manifest(
      now() - interval '1 hour',
      now() + interval '1 hour',
      '00000000-0000-0000-0000-0000000000c1'
    )->>'sha256'
  ),
  64,
  'an audit export manifest includes a SHA-256 checksum'
);

select * from finish();
rollback;
