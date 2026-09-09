begin;
select plan(22);

select has_function('public', 'replay_system_job_dead_letter_for_job',
  array['uuid', 'text', 'text'], 'replay dispatch has a transaction-bound job check');
select ok(has_function_privilege('authenticated',
  'public.replay_system_job_dead_letter_for_job(uuid,text,text)', 'EXECUTE'),
  'authenticated callers can reach the role-guarded replay wrapper');
select ok(not has_function_privilege('anon',
  'public.replay_system_job_dead_letter_for_job(uuid,text,text)', 'EXECUTE'),
  'anonymous callers cannot execute the replay wrapper');
select ok(not has_function_privilege('service_role',
  'public.replay_system_job_dead_letter_for_job(uuid,text,text)', 'EXECUTE'),
  'the wrapper must be called with the operator identity, not the worker service key');

insert into public.organizations (id, name, slug) values
  ('bd100000-0000-4000-8000-000000000001', 'Replay Binding Test', 'replay-binding-test');
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
)
select '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated',
  v.email, 'x', now(), '{}'::jsonb, '{}'::jsonb, now(), now(),
  '', '', '', '', '', '', false, false
from (values
  ('bd100000-0000-4000-8000-000000000002'::uuid, 'replay-platform@test.local'),
  ('bd100000-0000-4000-8000-000000000003'::uuid, 'replay-employee@test.local')
) v(id, email);
select set_config('app.privileged_write', 'on', true);
update public.profiles set role = 'platform_admin', organization_id = null, is_active = true
where id = 'bd100000-0000-4000-8000-000000000002';
update public.profiles set role = 'employee', organization_id = 'bd100000-0000-4000-8000-000000000001', is_active = true
where id = 'bd100000-0000-4000-8000-000000000003';
select set_config('app.privileged_write', 'off', true);

insert into app_private.system_job_definitions (
  job_key, display_name, description, execution_kind, expected_interval, freshness_sla, retry_mode
) values
  ('binding-replay-billing', 'Binding billing fixture', 'Test only', 'edge_cron', interval '1 hour', interval '2 hours', 'manual'),
  ('binding-replay-other', 'Binding other fixture', 'Test only', 'edge_cron', interval '1 hour', interval '2 hours', 'manual');
insert into app_private.system_job_runs (
  id, job_key, correlation_id, status, started_at, finished_at, dead_lettered_at
) values
  ('bd100000-0000-4000-8000-000000000011', 'binding-replay-billing', 'binding-older', 'failed', now() - interval '2 days', now() - interval '2 days', now() - interval '2 days'),
  ('bd100000-0000-4000-8000-000000000012', 'binding-replay-billing', 'binding-latest', 'failed', now() - interval '1 day', now() - interval '1 day', now() - interval '1 day'),
  ('bd100000-0000-4000-8000-000000000013', 'binding-replay-other', 'binding-other', 'failed', now() - interval '1 day', now() - interval '1 day', now() - interval '1 day');

create temporary table binding_replay_result (run_id uuid, correlation_id text);
grant select, insert on binding_replay_result to authenticated;
create function pg_temp.replay_act_as(p_profile_id uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_profile_id::text, 'role', 'authenticated', 'aal', 'aal2'
  )::text, true);
  set local role authenticated;
end;
$$;

select pg_temp.replay_act_as('bd100000-0000-4000-8000-000000000003');
select throws_ok($$ select * from public.replay_system_job_dead_letter_for_job(
  'bd100000-0000-4000-8000-000000000011', 'binding-replay-billing', 'Retry after repair') $$,
  '42501', 'Only platform_admin may replay dead letters', 'non-platform operators remain denied');
reset role;
select is((select count(*)::int from app_private.system_job_runs where replay_of_run_id in (
  'bd100000-0000-4000-8000-000000000011', 'bd100000-0000-4000-8000-000000000012', 'bd100000-0000-4000-8000-000000000013'
)), 0, 'authorization rejection queues no replay');

select pg_temp.replay_act_as('bd100000-0000-4000-8000-000000000002');
select throws_ok($$ select * from public.replay_system_job_dead_letter_for_job(
  'bd100000-0000-4000-8000-000000000011', 'binding-replay-billing', 'short') $$,
  '22023', 'A meaningful replay reason is required', 'the original reason requirement is preserved');
select throws_ok($$ select * from public.replay_system_job_dead_letter_for_job(
  'bd100000-0000-4000-8000-000000000099', 'binding-replay-billing', 'Retry after repair') $$,
  'P0002', 'Dead-lettered run not found', 'missing originals fail before queueing');
select throws_ok($$ select * from public.replay_system_job_dead_letter_for_job(
  'bd100000-0000-4000-8000-000000000011', 'binding-replay-other', 'Retry after repair') $$,
  '22023', 'Dead-lettered run does not belong to the requested job', 'mismatched jobs fail before first replay creation');
reset role;
select is((select count(*)::int from app_private.system_job_runs where replay_of_run_id in (
  'bd100000-0000-4000-8000-000000000011', 'bd100000-0000-4000-8000-000000000012', 'bd100000-0000-4000-8000-000000000013'
)), 0, 'bad reason, missing original, and wrong target create no replay');

select pg_temp.replay_act_as('bd100000-0000-4000-8000-000000000002');
select lives_ok($$ insert into pg_temp.binding_replay_result
  select * from public.replay_system_job_dead_letter_for_job(
    'bd100000-0000-4000-8000-000000000011', 'binding-replay-billing', 'Retry after repair') $$,
  'a matching older dead letter can still be replayed');
reset role;
select is((select count(*)::int from app_private.system_job_runs r
  join pg_temp.binding_replay_result returned on returned.run_id = r.id and returned.correlation_id = r.correlation_id
  where r.replay_of_run_id = 'bd100000-0000-4000-8000-000000000011'
    and r.job_key = 'binding-replay-billing' and r.status = 'queued'), 1,
  'the returned run and correlation belong to the requested job and older original');
select is((select count(*)::int from app_private.system_job_runs
  where replay_of_run_id = 'bd100000-0000-4000-8000-000000000012'), 0,
  'replaying an older dead letter does not select the latest one instead');
select is((select count(*)::int from public.audit_logs
  where action = 'system_job_dead_letter_replayed' and entity_id = 'binding-replay-billing'), 1,
  'delegation preserves the original replay audit record');

-- Browser retries may arrive while the canonical worker is already running.
update app_private.system_job_runs set status = 'running'
where replay_of_run_id = 'bd100000-0000-4000-8000-000000000011';
select pg_temp.replay_act_as('bd100000-0000-4000-8000-000000000002');
select throws_ok($$ select * from public.replay_system_job_dead_letter_for_job(
  'bd100000-0000-4000-8000-000000000011', 'binding-replay-other', 'Retry after repair') $$,
  '22023', 'Dead-lettered run does not belong to the requested job', 'wrong job cannot reuse an existing canonical replay');
reset role;
select is((select status from app_private.system_job_runs
  where replay_of_run_id = 'bd100000-0000-4000-8000-000000000011'), 'running',
  'wrong-job reuse leaves the existing worker run untouched');
select is((select count(*)::int from app_private.system_job_runs
  where replay_of_run_id = 'bd100000-0000-4000-8000-000000000011'), 1,
  'wrong-job reuse creates no extra run');
select pg_temp.replay_act_as('bd100000-0000-4000-8000-000000000002');
select results_eq($$ select * from public.replay_system_job_dead_letter_for_job(
  'bd100000-0000-4000-8000-000000000011', 'binding-replay-billing', 'Retry after repair') $$,
  $$ select * from pg_temp.binding_replay_result $$, 'matching retries preserve canonical run and correlation IDs');
reset role;
select is((select count(*)::int from app_private.system_job_runs
  where replay_of_run_id = 'bd100000-0000-4000-8000-000000000011'), 1,
  'matching canonical reuse creates no duplicate replay');
select is((select count(*)::int from public.audit_logs
  where action = 'system_job_dead_letter_replayed' and entity_id = 'binding-replay-billing'), 1,
  'matching canonical reuse does not write a duplicate creation audit');

update app_private.system_job_definitions set kill_switch_enabled = true where job_key = 'binding-replay-other';
select pg_temp.replay_act_as('bd100000-0000-4000-8000-000000000002');
select throws_ok($$ select * from public.replay_system_job_dead_letter_for_job(
  'bd100000-0000-4000-8000-000000000013', 'binding-replay-other', 'Retry after repair') $$,
  '55000', 'Job is disabled by its kill switch', 'the delegated kill switch remains enforced');
reset role;
update app_private.system_job_definitions set kill_switch_enabled = false, circuit_state = 'open',
  circuit_open_until = now() + interval '1 hour' where job_key = 'binding-replay-other';
select pg_temp.replay_act_as('bd100000-0000-4000-8000-000000000002');
select throws_ok($$ select * from public.replay_system_job_dead_letter_for_job(
  'bd100000-0000-4000-8000-000000000013', 'binding-replay-other', 'Retry after repair') $$,
  '55000', 'Job is disabled by its open circuit', 'the delegated circuit guard remains enforced');
reset role;

select * from finish();
rollback;
