begin;
select plan(91);

-- E5 Tier 1: offline service documentation drafts + conflict rules
-- (20260802030000_offline_service_documentation_drafts.sql).

-- Schema -----------------------------------------------------------------------------------------
select has_table('public', 'offline_draft_receipts', 'the offline draft receipt ledger exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.offline_draft_receipts'::regclass),
  'offline draft receipts are row-level secured'
);
select ok(
  not exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'offline_draft_receipts'
      and grantee in ('anon', 'public')
  ),
  'offline draft receipts are not readable by anon or public'
);
select ok(
  not has_table_privilege('authenticated', 'public.offline_draft_receipts', 'INSERT'),
  'offline clients cannot forge sync receipts directly -- only the RPC may write them'
);
select has_function(
  'public', 'register_offline_service_device', array['text', 'text'],
  'offline service devices register explicitly'
);
select has_function(
  'public', 'revoke_offline_service_device', array['uuid'],
  'offline service devices can be remotely wiped'
);
select has_function(
  'public', 'sync_offline_service_task_draft',
  array['uuid', 'uuid', 'text', 'timestamp with time zone', 'text', 'jsonb'],
  'offline service sync is a server command that classifies record_service_task_response'
);
select ok(
  (select pg_get_constraintdef(oid) from pg_constraint
   where conrelid = 'public.offline_draft_receipts'::regclass
     and pg_get_constraintdef(oid) like '%outcome%' and pg_get_constraintdef(oid) like '%applied%')
  like '%duplicate%' and
  (select pg_get_constraintdef(oid) from pg_constraint
   where conrelid = 'public.offline_draft_receipts'::regclass
     and pg_get_constraintdef(oid) like '%outcome%' and pg_get_constraintdef(oid) like '%applied%')
  like '%conflict%' and
  (select pg_get_constraintdef(oid) from pg_constraint
   where conrelid = 'public.offline_draft_receipts'::regclass
     and pg_get_constraintdef(oid) like '%outcome%' and pg_get_constraintdef(oid) like '%applied%')
  like '%stale%' and
  (select pg_get_constraintdef(oid) from pg_constraint
   where conrelid = 'public.offline_draft_receipts'::regclass
     and pg_get_constraintdef(oid) like '%outcome%' and pg_get_constraintdef(oid) like '%applied%')
  like '%rejected%' and
  (select pg_get_constraintdef(oid) from pg_constraint
   where conrelid = 'public.offline_draft_receipts'::regclass
     and pg_get_constraintdef(oid) like '%outcome%' and pg_get_constraintdef(oid) like '%applied%')
  like '%wipe_required%',
  'the outcome vocabulary covers every classified branch: applied, duplicate, conflict, stale, rejected, wipe_required'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.offline_draft_receipts'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) like '%device_id%'
      and pg_get_constraintdef(oid) like '%idempotency_key%'
  ),
  'device id and idempotency key are jointly unique, so a replayed sync cannot double-insert'
);

-- Fixtures -----------------------------------------------------------------------------------------

insert into public.organizations(id, name, slug, subscription_status)
values ('65000000-0000-4000-8000-000000000001', 'Offline Draft Org', 'offline-draft-org', 'active');
insert into public.facilities(id, organization_id, name, facility_type)
values ('65000000-0000-4000-8000-000000000011', '65000000-0000-4000-8000-000000000001', 'Offline Draft Facility', 'PCH');

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', '65000000-0000-4000-8000-000000000101',
   'authenticated', 'authenticated', 'offline-worker-a@test.local', 'x', now(), '{}', '{}',
   now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', '65000000-0000-4000-8000-000000000102',
   'authenticated', 'authenticated', 'offline-worker-b@test.local', 'x', now(), '{}', '{}',
   now(), now(), '', '', '', '', '', '', false, false);

select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active)
values
  ('65000000-0000-4000-8000-000000000101', '65000000-0000-4000-8000-000000000001',
   'offline-worker-a@test.local', 'Worker', 'A', 'employee', true),
  ('65000000-0000-4000-8000-000000000102', '65000000-0000-4000-8000-000000000001',
   'offline-worker-b@test.local', 'Worker', 'B', 'employee', true)
on conflict(id) do update
set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);

insert into public.employees(
  id, organization_id, facility_id, profile_id, first_name, last_name,
  email, job_title, hire_date, status
) values
  ('65000000-0000-4000-8000-000000000111', '65000000-0000-4000-8000-000000000001',
   '65000000-0000-4000-8000-000000000011', '65000000-0000-4000-8000-000000000101',
   'Worker', 'A', 'offline-worker-a@test.local', 'Direct Care Staff', public.pa_today(), 'active'),
  ('65000000-0000-4000-8000-000000000112', '65000000-0000-4000-8000-000000000001',
   '65000000-0000-4000-8000-000000000011', '65000000-0000-4000-8000-000000000102',
   'Worker', 'B', 'offline-worker-b@test.local', 'Direct Care Staff', public.pa_today(), 'active');

insert into public.residents(
  id, organization_id, facility_id, first_name, last_name, admission_date
) values (
  '65000000-0000-4000-8000-000000000201', '65000000-0000-4000-8000-000000000001',
  '65000000-0000-4000-8000-000000000011', 'Jamie', 'Resident', public.pa_today()
);

insert into public.resident_assessment_forms(
  id, organization_id, facility_id, resident_id, form_type, reason, status
) values (
  '65000000-0000-4000-8000-000000000301', '65000000-0000-4000-8000-000000000001',
  '65000000-0000-4000-8000-000000000011', '65000000-0000-4000-8000-000000000201',
  'RASP', 'initial', 'draft'
);

-- requirement1: ordinary scheduled care, all seven responses -- backs task1/task2/task3/task5/task6.
insert into public.resident_service_requirements(
  id, organization_id, facility_id, resident_id, source_assessment_form_id, source_plan_version,
  source_section, source_key, service_code, service_name, special_instructions, frequency,
  responsible_role, effective_from
) values (
  '65000000-0000-4000-8000-000000000401', '65000000-0000-4000-8000-000000000001',
  '65000000-0000-4000-8000-000000000011', '65000000-0000-4000-8000-000000000201',
  '65000000-0000-4000-8000-000000000301', 1, 'section1', 'bathing', 'bathe', 'Bathing assistance',
  'Provide bathing assistance', 'daily', 'employee', public.pa_today()
);
-- requirement2: documentation_requirement, narrower response set -- backs task4 (the rejected case:
-- a resident cannot "refuse" paperwork, so resident_refused is not accepted for it).
insert into public.resident_service_requirements(
  id, organization_id, facility_id, resident_id, source_assessment_form_id, source_plan_version,
  source_section, source_key, service_code, service_name, special_instructions, frequency,
  responsible_role, effective_from, task_kind, acceptable_completion_responses
) values (
  '65000000-0000-4000-8000-000000000402', '65000000-0000-4000-8000-000000000001',
  '65000000-0000-4000-8000-000000000011', '65000000-0000-4000-8000-000000000201',
  '65000000-0000-4000-8000-000000000301', 1, 'section1', 'paperwork', 'chart-check', 'Chart review',
  'Confirm chart is current', 'daily', 'employee', public.pa_today(), 'documentation_requirement',
  array['completed_as_planned', 'partially_completed', 'not_completed']
);

insert into public.resident_service_task_instances(
  id, organization_id, facility_id, resident_id, requirement_id, source_assessment_form_id,
  source_plan_version, service_name, responsible_role, scheduled_start, scheduled_end, status
) values
  ('65000000-0000-4000-8000-000000000501', '65000000-0000-4000-8000-000000000001',
   '65000000-0000-4000-8000-000000000011', '65000000-0000-4000-8000-000000000201',
   '65000000-0000-4000-8000-000000000401', '65000000-0000-4000-8000-000000000301', 1,
   'Bathing assistance', 'employee', now() + interval '1 hour', now() + interval '2 hours', 'scheduled'),
  ('65000000-0000-4000-8000-000000000502', '65000000-0000-4000-8000-000000000001',
   '65000000-0000-4000-8000-000000000011', '65000000-0000-4000-8000-000000000201',
   '65000000-0000-4000-8000-000000000401', '65000000-0000-4000-8000-000000000301', 1,
   'Bathing assistance', 'employee', now() + interval '3 hours', now() + interval '4 hours', 'scheduled'),
  ('65000000-0000-4000-8000-000000000503', '65000000-0000-4000-8000-000000000001',
   '65000000-0000-4000-8000-000000000011', '65000000-0000-4000-8000-000000000201',
   '65000000-0000-4000-8000-000000000401', '65000000-0000-4000-8000-000000000301', 1,
   'Bathing assistance', 'employee', now() + interval '5 hours', now() + interval '6 hours', 'scheduled'),
  ('65000000-0000-4000-8000-000000000505', '65000000-0000-4000-8000-000000000001',
   '65000000-0000-4000-8000-000000000011', '65000000-0000-4000-8000-000000000201',
   '65000000-0000-4000-8000-000000000401', '65000000-0000-4000-8000-000000000301', 1,
   'Bathing assistance', 'employee', now() + interval '7 hours', now() + interval '8 hours', 'scheduled'),
  ('65000000-0000-4000-8000-000000000506', '65000000-0000-4000-8000-000000000001',
   '65000000-0000-4000-8000-000000000011', '65000000-0000-4000-8000-000000000201',
   '65000000-0000-4000-8000-000000000401', '65000000-0000-4000-8000-000000000301', 1,
   'Bathing assistance', 'employee', now() + interval '9 hours', now() + interval '10 hours', 'scheduled'),
  ('65000000-0000-4000-8000-000000000504', '65000000-0000-4000-8000-000000000001',
   '65000000-0000-4000-8000-000000000011', '65000000-0000-4000-8000-000000000201',
   '65000000-0000-4000-8000-000000000402', '65000000-0000-4000-8000-000000000301', 1,
   'Chart review', 'employee', now() + interval '1 hour', now() + interval '2 hours', 'scheduled');

create or replace function pg_temp.act_as(p_id uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  reset role;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', p_id, 'role', p_role, 'aal', 'aal2',
      'iat', extract(epoch from now())::bigint
    )::text,
    true
  );
  if p_role = 'service_role' then set local role service_role;
  else set local role authenticated;
  end if;
end
$$;

create temporary table t_ids(key text primary key, id uuid) on commit drop;
grant all on t_ids to authenticated, service_role;

-- Registration --------------------------------------------------------------------------------------
select pg_temp.act_as('65000000-0000-4000-8000-000000000101');
insert into t_ids values ('device-a', public.register_offline_service_device('device-a-public-key', repeat('a', 64)));
select ok((select id from t_ids where key = 'device-a') is not null, 'worker A can register an offline service device');

select pg_temp.act_as('65000000-0000-4000-8000-000000000102');
insert into t_ids values ('device-b', public.register_offline_service_device('device-b-public-key', repeat('b', 64)));
select ok((select id from t_ids where key = 'device-b') is not null, 'worker B can register an offline service device');

-- Device-ownership boundary ---------------------------------------------------------------------------
-- Still acting as B: B must not be able to sync using A's device id.
select throws_ok(
  $$select public.sync_offline_service_task_draft(
    (select id from t_ids where key = 'device-a'), '65000000-0000-4000-8000-000000000501',
    'boundary-key', now(), 'completed_as_planned', '{}'::jsonb
  )$$,
  '42501', null,
  'worker B cannot sync a draft using worker A''s device'
);

-- Applied ---------------------------------------------------------------------------------------------
select pg_temp.act_as('65000000-0000-4000-8000-000000000101');
select is(
  (select public.sync_offline_service_task_draft(
    (select id from t_ids where key = 'device-a'), '65000000-0000-4000-8000-000000000501',
    'sync-key-1', now(), 'completed_as_planned', '{}'::jsonb
  )->>'outcome'),
  'applied',
  'A''s first offline draft applies cleanly'
);
select is(
  (select status from public.resident_service_task_instances where id = '65000000-0000-4000-8000-000000000501'),
  'completed',
  'the underlying task reflects the applied response, via record_service_task_response'
);

-- Duplicate: exact idempotency-key replay -------------------------------------------------------------
select is(
  (select public.sync_offline_service_task_draft(
    (select id from t_ids where key = 'device-a'), '65000000-0000-4000-8000-000000000501',
    'sync-key-1', now(), 'completed_as_planned', '{}'::jsonb
  )->>'outcome'),
  'duplicate',
  'replaying the same idempotency key returns duplicate rather than re-applying'
);
select is(
  (select count(*)::int from public.offline_draft_receipts
   where device_id = (select id from t_ids where key = 'device-a') and idempotency_key = 'sync-key-1'),
  1,
  'the replay does not insert a second receipt row'
);

-- Duplicate: same task, new idempotency key, but this profile already recorded it ----------------------
select is(
  (select public.sync_offline_service_task_draft(
    (select id from t_ids where key = 'device-a'), '65000000-0000-4000-8000-000000000501',
    'sync-key-2', now(), 'completed_with_more_assistance',
    '{"assistance_level":"one_person","persistence":"temporary"}'::jsonb
  )->>'outcome'),
  'duplicate',
  'a second draft for a task this same profile already recorded is also classified duplicate, not conflict'
);

-- Conflict: someone else documented the task while this device was offline ------------------------------
select pg_temp.act_as('65000000-0000-4000-8000-000000000102');
select lives_ok(
  $$select public.record_service_task_response('65000000-0000-4000-8000-000000000502', 'completed_as_planned', '{}'::jsonb, null)$$,
  'worker B documents task2 online directly, ahead of A''s queued offline draft'
);
select pg_temp.act_as('65000000-0000-4000-8000-000000000101');
select is(
  (select public.sync_offline_service_task_draft(
    (select id from t_ids where key = 'device-a'), '65000000-0000-4000-8000-000000000502',
    'sync-key-3', now(), 'completed_as_planned', '{}'::jsonb
  )->>'outcome'),
  'conflict',
  'A''s offline draft for a task someone else already documented is a conflict, not applied or duplicate'
);

-- Stale: the task was superseded (plan changed) while this device was offline ----------------------------
reset role;
update public.resident_service_task_instances set status = 'superseded'
where id = '65000000-0000-4000-8000-000000000503';
select pg_temp.act_as('65000000-0000-4000-8000-000000000101');
select is(
  (select public.sync_offline_service_task_draft(
    (select id from t_ids where key = 'device-a'), '65000000-0000-4000-8000-000000000503',
    'sync-key-4', now(), 'completed_as_planned', '{}'::jsonb
  )->>'outcome'),
  'stale',
  'a superseded task is reported stale, distinct from a conflict with another person''s documentation'
);

-- Rejected: the plan does not accept this response for this service ---------------------------------------
select is(
  (select public.sync_offline_service_task_draft(
    (select id from t_ids where key = 'device-a'), '65000000-0000-4000-8000-000000000504',
    'sync-key-5', now(), 'resident_refused', '{}'::jsonb
  )->>'outcome'),
  'rejected',
  'a response the service does not accept is rejected rather than silently coerced or applied'
);
select ok(
  (select error_message from public.offline_draft_receipts
   where device_id = (select id from t_ids where key = 'device-a') and idempotency_key = 'sync-key-5')
  ilike '%not accepted%',
  'the server message explaining the rejection is preserved on the receipt'
);

-- Wipe required: the device was revoked -------------------------------------------------------------------
select ok(
  public.revoke_offline_service_device((select id from t_ids where key = 'device-a')),
  'worker A can revoke her own device'
);
select is(
  (select public.sync_offline_service_task_draft(
    (select id from t_ids where key = 'device-a'), '65000000-0000-4000-8000-000000000505',
    'sync-key-6', now(), 'completed_as_planned', '{}'::jsonb
  )->>'outcome'),
  'wipe_required',
  'a revoked device receives wipe_required on its next sync attempt'
);
select is(
  (select status from public.resident_service_task_instances where id = '65000000-0000-4000-8000-000000000505'),
  'scheduled',
  'wipe_required never touches the underlying task -- nothing was attempted against it'
);

-- RLS: a profile sees only its own device's receipts --------------------------------------------------------
select pg_temp.act_as('65000000-0000-4000-8000-000000000102');
select is(
  (select public.sync_offline_service_task_draft(
    (select id from t_ids where key = 'device-b'), '65000000-0000-4000-8000-000000000506',
    'sync-key-b1', now(), 'completed_as_planned', '{}'::jsonb
  )->>'outcome'),
  'applied',
  'worker B can sync her own device independently of worker A''s device history'
);

select pg_temp.act_as('65000000-0000-4000-8000-000000000101');
select is(
  (select count(*)::int from public.offline_draft_receipts
   where device_id = (select id from t_ids where key = 'device-b')),
  0,
  'worker A cannot see worker B''s device receipts under RLS'
);

select pg_temp.act_as('65000000-0000-4000-8000-000000000102');
select ok(
  (select count(*)::int from public.offline_draft_receipts
   where device_id = (select id from t_ids where key = 'device-b')) >= 1,
  'worker B can see her own device''s receipts'
);

-- Append-only -------------------------------------------------------------------------------------------------
reset role;
select throws_ok(
  $$update public.offline_draft_receipts set outcome = 'applied'
    where id = (select id from public.offline_draft_receipts limit 1)$$,
  '55000', null,
  'offline draft receipts cannot be mutated after the fact'
);

-- Codex review fixes on PR #431 -----------------------------------------------------------------------------
-- 1. Idempotent replay of a conflict/stale/rejected/wipe_required receipt must return that same outcome,
--    not a blanket 'duplicate' (which the client treats as "recorded, delete the local draft").
-- 2. performed_at on the official task reflects the client-supplied occurrence time on a successful sync,
--    not the moment the device happened to reconnect.

-- 1a. Replay of a conflict receipt (device-a, task2, sync-key-3 -- already revoked at this point in the
-- file, proving the replay branch is reached and answered before the device-status check runs at all).
select pg_temp.act_as('65000000-0000-4000-8000-000000000101');
select is(
  (select public.sync_offline_service_task_draft(
    (select id from t_ids where key = 'device-a'), '65000000-0000-4000-8000-000000000502',
    'sync-key-3', now(), 'completed_as_planned', '{}'::jsonb
  )->>'outcome'),
  'conflict',
  'replaying a conflict receipt returns conflict again, not duplicate'
);
select is(
  (select count(*)::int from public.offline_draft_receipts
   where device_id = (select id from t_ids where key = 'device-a') and idempotency_key = 'sync-key-3'),
  1,
  'the conflict replay does not insert a second receipt row'
);

-- 1b. Replay of a stale receipt (task3, sync-key-4).
select is(
  (select public.sync_offline_service_task_draft(
    (select id from t_ids where key = 'device-a'), '65000000-0000-4000-8000-000000000503',
    'sync-key-4', now(), 'completed_as_planned', '{}'::jsonb
  )->>'outcome'),
  'stale',
  'replaying a stale receipt returns stale again, not duplicate'
);
select is(
  (select count(*)::int from public.offline_draft_receipts
   where device_id = (select id from t_ids where key = 'device-a') and idempotency_key = 'sync-key-4'),
  1,
  'the stale replay does not insert a second receipt row'
);

-- 1c. Replay of a rejected receipt (task4, sync-key-5).
select is(
  (select public.sync_offline_service_task_draft(
    (select id from t_ids where key = 'device-a'), '65000000-0000-4000-8000-000000000504',
    'sync-key-5', now(), 'resident_refused', '{}'::jsonb
  )->>'outcome'),
  'rejected',
  'replaying a rejected receipt returns rejected again, not duplicate'
);
select is(
  (select count(*)::int from public.offline_draft_receipts
   where device_id = (select id from t_ids where key = 'device-a') and idempotency_key = 'sync-key-5'),
  1,
  'the rejected replay does not insert a second receipt row'
);

-- 1d. Replay of a wipe_required receipt (task5, sync-key-6) -- the outcome that would be most harmful to
-- mislabel duplicate, since the client would delete just the one local draft instead of wiping the whole
-- store of an untrusted device.
select is(
  (select public.sync_offline_service_task_draft(
    (select id from t_ids where key = 'device-a'), '65000000-0000-4000-8000-000000000505',
    'sync-key-6', now(), 'completed_as_planned', '{}'::jsonb
  )->>'outcome'),
  'wipe_required',
  'replaying a wipe_required receipt still returns wipe_required, not duplicate'
);
select is(
  (select count(*)::int from public.offline_draft_receipts
   where device_id = (select id from t_ids where key = 'device-a') and idempotency_key = 'sync-key-6'),
  1,
  'the wipe_required replay does not insert a second receipt row'
);

-- 2. performed_at reflects the client-supplied occurrence time, not sync time -------------------------------
-- Back to the unrestricted fixture-setup role first -- the preceding replay block left the session
-- impersonating worker A ('authenticated'), which (correctly) has no direct INSERT grant on
-- resident_service_task_instances; only record_service_task_response and the generator job write it.
reset role;
insert into public.resident_service_task_instances(
  id, organization_id, facility_id, resident_id, requirement_id, source_assessment_form_id,
  source_plan_version, service_name, responsible_role, scheduled_start, scheduled_end, status
) values
  ('65000000-0000-4000-8000-000000000507', '65000000-0000-4000-8000-000000000001',
   '65000000-0000-4000-8000-000000000011', '65000000-0000-4000-8000-000000000201',
   '65000000-0000-4000-8000-000000000401', '65000000-0000-4000-8000-000000000301', 1,
   'Bathing assistance', 'employee', now() + interval '11 hours', now() + interval '12 hours', 'scheduled'),
  ('65000000-0000-4000-8000-000000000508', '65000000-0000-4000-8000-000000000001',
   '65000000-0000-4000-8000-000000000011', '65000000-0000-4000-8000-000000000201',
   '65000000-0000-4000-8000-000000000401', '65000000-0000-4000-8000-000000000301', 1,
   'Bathing assistance', 'employee', now() + interval '13 hours', now() + interval '14 hours', 'scheduled'),
  ('65000000-0000-4000-8000-000000000509', '65000000-0000-4000-8000-000000000001',
   '65000000-0000-4000-8000-000000000011', '65000000-0000-4000-8000-000000000201',
   '65000000-0000-4000-8000-000000000401', '65000000-0000-4000-8000-000000000301', 1,
   'Bathing assistance', 'employee', now() + interval '15 hours', now() + interval '16 hours', 'scheduled');

-- device-b (worker B) is still active throughout -- device-a was revoked above.
select pg_temp.act_as('65000000-0000-4000-8000-000000000102');

-- 2a. A plausible past occurrence time (device queued the draft 2 hours ago) is trusted verbatim.
select is(
  (select public.sync_offline_service_task_draft(
    (select id from t_ids where key = 'device-b'), '65000000-0000-4000-8000-000000000507',
    'sync-key-b2', now() - interval '2 hours', 'completed_as_planned', '{}'::jsonb
  )->>'outcome'),
  'applied',
  'a delayed offline sync with a plausible client occurrence time still applies cleanly'
);
select is(
  (select performed_at from public.resident_service_task_instances where id = '65000000-0000-4000-8000-000000000507'),
  now() - interval '2 hours',
  'performed_at reflects the client-supplied occurrence time, not the sync (now()) time'
);

-- 2b. An implausible future occurrence time does not block the sync, but is not trusted for performed_at.
select is(
  (select public.sync_offline_service_task_draft(
    (select id from t_ids where key = 'device-b'), '65000000-0000-4000-8000-000000000508',
    'sync-key-b3', now() + interval '10 days', 'completed_as_planned', '{}'::jsonb
  )->>'outcome'),
  'applied',
  'a client occurrence time far in the future does not block the sync'
);
select is(
  (select performed_at from public.resident_service_task_instances where id = '65000000-0000-4000-8000-000000000508'),
  now(),
  'an implausible future occurrence time is not trusted; performed_at falls back to sync time'
);

-- 2c. An implausibly old occurrence time does not block the sync, but is not trusted for performed_at
-- either -- same reasoning, the other direction.
select is(
  (select public.sync_offline_service_task_draft(
    (select id from t_ids where key = 'device-b'), '65000000-0000-4000-8000-000000000509',
    'sync-key-b4', now() - interval '400 days', 'completed_as_planned', '{}'::jsonb
  )->>'outcome'),
  'applied',
  'a client occurrence time far in the past does not block the sync'
);
select is(
  (select performed_at from public.resident_service_task_instances where id = '65000000-0000-4000-8000-000000000509'),
  now(),
  'an implausibly old occurrence time is not trusted; performed_at falls back to sync time'
);

---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Tier 2: unscheduled services (BACKLOG.md E5)
--
-- Tier 1 above can only document a task that was already queued. The care nobody else knows
-- happened -- the unplanned kind -- had no offline path at all, which is exactly backwards.
--
-- These assertions live in this file rather than their own because the two tiers share one
-- receipt ledger, and the uniqueness promise that ledger makes is only meaningful ACROSS both
-- kinds. Splitting them would let that assertion quietly stop being tested.
--
-- Fresh devices: the Tier 1 section above revokes device-a and device-b to test wipe_required, so
-- reusing them here would assert the revocation path while claiming to assert authorization.
------------------------------------------------------------------------------------------------
select has_function(
  'public', 'sync_offline_unscheduled_service_draft',
  array['uuid', 'uuid', 'text', 'timestamptz', 'text', 'integer', 'boolean', 'text'],
  'the unscheduled-service sync exists'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.sync_offline_unscheduled_service_draft(uuid,uuid,text,timestamptz,text,integer,boolean,text)',
    'EXECUTE'),
  'and is closed to anonymous callers'
);

select pg_temp.act_as('65000000-0000-4000-8000-000000000101');
insert into t_ids values ('device-c', public.register_offline_service_device('device-c-public-key', repeat('c', 64)));

select is(
  (select public.sync_offline_unscheduled_service_draft(
    (select id from t_ids where key = 'device-c'), '65000000-0000-4000-8000-000000000201',
    'unsched-key-1', now() - interval '20 minutes', 'unscheduled_toileting', 10, false,
    'Assisted after a fall risk moment.'
  )->>'outcome'),
  'applied',
  'an aide can document unscheduled care captured offline'
);

select is(
  (select count(*)::int from public.resident_unscheduled_services
   where resident_id = '65000000-0000-4000-8000-000000000201'
     and service_kind = 'unscheduled_toileting'),
  1,
  'and it lands as a real unscheduled service, not just a receipt'
);

select is(
  (select occurred_at from public.resident_unscheduled_services
   where resident_id = '65000000-0000-4000-8000-000000000201'
     and service_kind = 'unscheduled_toileting'),
  (select client_occurred_at from public.offline_draft_receipts
   where idempotency_key = 'unsched-key-1'),
  'recorded at the time the care happened on the device, not the time it reached the server'
);

-- The replay reports what happened the FIRST time. A blanket duplicate for a rejected first
-- attempt would tell the client the care was recorded, and it would delete the only local copy of
-- a note that never applied.
select is(
  (select public.sync_offline_unscheduled_service_draft(
    (select id from t_ids where key = 'device-c'), '65000000-0000-4000-8000-000000000201',
    'unsched-key-1', now() - interval '20 minutes', 'unscheduled_toileting', 10, false,
    'Assisted after a fall risk moment.'
  )->>'outcome'),
  'duplicate',
  'replaying the same key reports duplicate rather than recording the care twice'
);

select is(
  (select count(*)::int from public.resident_unscheduled_services
   where resident_id = '65000000-0000-4000-8000-000000000201'
     and service_kind = 'unscheduled_toileting'),
  1,
  'and really does not record it twice'
);

-- record_unscheduled_service owns the "may this caller record for this resident" rule. The
-- property worth pinning is that the offline path DELEGATES to it rather than carrying its own
-- copy to drift out of step with -- which is the failure this program has already hit twice with
-- duplicated predicates. Asserted against the function body, because the fixture has a single
-- facility and every worker in it is legitimately in scope.
select ok(
  pg_get_functiondef(
    'public.sync_offline_unscheduled_service_draft(uuid,uuid,text,timestamptz,text,integer,boolean,text)'::regprocedure
  ) like '%record_unscheduled_service%',
  'the offline path delegates authorization instead of restating it'
);

-- A refusal must come back as a receipt the client can block-and-flag, not as an exception it
-- would retry forever. An unrecognised service_kind is a real instance of that: the closed enum on
-- resident_unscheduled_services rejects it inside the delegated call.
select is(
  (select public.sync_offline_unscheduled_service_draft(
    (select id from t_ids where key = 'device-c'), '65000000-0000-4000-8000-000000000201',
    'unsched-key-4', now(), 'not_a_real_service_kind', null, false, null
  )->>'outcome'),
  'rejected',
  'a refusal inside the delegated call becomes a rejected receipt, not a raised exception'
);

select ok(
  (select error_message from public.offline_draft_receipts
   where idempotency_key = 'unsched-key-4') is not null,
  'and carries the reason, so a human reviewing the flagged draft can see why'
);

select is(
  (select count(*)::int from public.resident_unscheduled_services
   where resident_id = '65000000-0000-4000-8000-000000000201'),
  1,
  'while nothing from the rejected attempt reaches the resident record'
);

-- The reason both kinds share one ledger, asserted structurally: draft_kind is deliberately NOT
-- part of the uniqueness key, so one device cannot reuse a key across kinds. Two tables would
-- have given two independent uniqueness domains and a quietly weaker promise.
select ok(
  exists(
    select 1 from pg_constraint
    where conrelid = 'public.offline_draft_receipts'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (device_id, idempotency_key)'
  ),
  'idempotency is unique per device across BOTH draft kinds, not per kind'
);

-- Dropping NOT NULL from task_id and response so the unscheduled kind can omit them must not let
-- a service_task receipt exist with neither. Asserted from the catalogue rather than by attempting
-- an insert: this table's RLS refuses a direct authenticated write first, so an insert test would
-- pass on 42501 and prove nothing about the CHECK.
select ok(
  exists(
    select 1 from pg_constraint
    where conrelid = 'public.offline_draft_receipts'::regclass
      and conname = 'offline_draft_receipt_kind_shape_check'
      and pg_get_constraintdef(oid) like '%task_id IS NOT NULL%response IS NOT NULL%'
      and pg_get_constraintdef(oid) like '%resident_id IS NOT NULL%service_kind IS NOT NULL%'
  ),
  'each receipt kind must still carry the columns that make it meaningful'
);

---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Tier 3: change-of-condition monitoring observations (BACKLOG.md E5 -- closes the row)
--
-- A change-of-condition event carries a monitoring cadence ("every two hours for 24 hours"), and
-- walking that cadence is what produces the evidence the resident was actually watched. It happens
-- in resident rooms and back hallways, where the wifi is worst. Tiers 1 and 2 covered the floor
-- queue and unscheduled care; this is the third and last surface.
--
-- Same file as the other two tiers, for the same reason: one receipt ledger, and the uniqueness
-- promise it makes is only meaningful ACROSS all three kinds.
------------------------------------------------------------------------------------------------
select has_function(
  'public', 'sync_offline_change_observation_draft',
  array['uuid', 'uuid', 'text', 'timestamptz', 'text', 'text', 'boolean'],
  'the change-observation sync exists'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.sync_offline_change_observation_draft(uuid,uuid,text,timestamptz,text,text,boolean)',
    'EXECUTE'),
  'and is closed to anonymous callers'
);

-- add_change_event_monitoring owns "may this caller record on this event" -- for an employee that
-- means the event must be assigned to them. Pinned against the body rather than re-derived, so the
-- offline path cannot grow its own copy of the rule to drift out of step with.
select ok(
  pg_get_functiondef(
    'public.sync_offline_change_observation_draft(uuid,uuid,text,timestamptz,text,text,boolean)'::regprocedure
  ) like '%add_change_event_monitoring%',
  'the offline path delegates authorization instead of restating it'
);

reset role;
-- event-1 is worker A's; event-2 belongs to worker B and event-3 gets closed below.
insert into public.resident_change_events(
  id, organization_id, facility_id, resident_id, category, identified_at,
  identified_by_profile_id, immediate_observations, immediate_action_taken,
  assigned_profile_id, follow_up_due_at, monitoring_instructions, monitoring_frequency, status
) values
  ('65000000-0000-4000-8000-000000000601', '65000000-0000-4000-8000-000000000001',
   '65000000-0000-4000-8000-000000000011', '65000000-0000-4000-8000-000000000201',
   'mobility_decline', now() - interval '6 hours', '65000000-0000-4000-8000-000000000101',
   'Unsteady on transfer.', 'Two-person assist put in place.',
   '65000000-0000-4000-8000-000000000101', now() + interval '2 hours',
   'Watch transfers and gait.', 'Every 2 hours', 'monitoring'),
  ('65000000-0000-4000-8000-000000000602', '65000000-0000-4000-8000-000000000001',
   '65000000-0000-4000-8000-000000000011', '65000000-0000-4000-8000-000000000201',
   'skin_concern', now() - interval '5 hours', '65000000-0000-4000-8000-000000000102',
   'Redness at left heel.', 'Offloaded and repositioned.',
   '65000000-0000-4000-8000-000000000102', now() + interval '3 hours',
   'Check heel each round.', 'Every 2 hours', 'monitoring'),
  ('65000000-0000-4000-8000-000000000603', '65000000-0000-4000-8000-000000000001',
   '65000000-0000-4000-8000-000000000011', '65000000-0000-4000-8000-000000000201',
   'appetite_intake_change', now() - interval '4 hours', '65000000-0000-4000-8000-000000000101',
   'Ate under half of lunch.', 'Offered a supplement.',
   '65000000-0000-4000-8000-000000000101', now() + interval '4 hours',
   'Record intake at each meal.', 'Each meal', 'monitoring');

-- device-c is worker A's, registered in the Tier 2 block above and never revoked.
select pg_temp.act_as('65000000-0000-4000-8000-000000000101');

select is(
  (select public.sync_offline_change_observation_draft(
    (select id from t_ids where key = 'device-c'), '65000000-0000-4000-8000-000000000601',
    'coc-key-1', now() - interval '90 minutes',
    'Transferred with two-person assist, no buckling. Distinctive-marker-Q7.',
    'Reminded to use the call bell.', true
  )->>'outcome'),
  'applied',
  'an aide can file a monitoring observation captured offline'
);

select is(
  (select count(*)::int from public.resident_change_monitoring_entries
   where event_id = '65000000-0000-4000-8000-000000000601'),
  1,
  'and it lands as a real monitoring entry, not just a receipt'
);

select is(
  (select observed_at from public.resident_change_monitoring_entries
   where event_id = '65000000-0000-4000-8000-000000000601'),
  (select client_occurred_at from public.offline_draft_receipts
   where idempotency_key = 'coc-key-1'),
  'observed at the time the aide looked at the resident, not the time the device found signal'
);

select is(
  (select supervisor_notified from public.resident_change_monitoring_entries
   where event_id = '65000000-0000-4000-8000-000000000601'),
  true,
  'and carries the supervisor-notified flag through the offline path'
);

-- THE OBSERVATION TEXT MUST NOT LAND IN THE RECEIPT LEDGER. That table is append-only -- update and
-- delete both raise -- so a clinical observation copied into it could never be corrected or removed,
-- including for an attempt that was rejected and therefore never entered the resident's record at
-- all. Asserted by hunting the whole row rather than by naming columns, so adding a column that
-- happens to capture the text later still fails this.
select ok(
  not exists(
    select 1 from public.offline_draft_receipts r
    where r::text like '%Distinctive-marker-Q7%'
  ),
  'the observation text itself is never written to the append-only receipt ledger'
);

select ok(
  exists(
    select 1 from public.resident_change_monitoring_entries
    where event_id = '65000000-0000-4000-8000-000000000601'
      and observations like '%Distinctive-marker-Q7%'
  ),
  'while the resident''s own record has it in full'
);

select is(
  (select public.sync_offline_change_observation_draft(
    (select id from t_ids where key = 'device-c'), '65000000-0000-4000-8000-000000000601',
    'coc-key-1', now() - interval '90 minutes',
    'Transferred with two-person assist, no buckling. Distinctive-marker-Q7.',
    'Reminded to use the call bell.', true
  )->>'outcome'),
  'duplicate',
  'replaying the same key reports duplicate rather than filing the observation twice'
);

select is(
  (select count(*)::int from public.resident_change_monitoring_entries
   where event_id = '65000000-0000-4000-8000-000000000601'),
  1,
  'and really does not file it twice'
);

-- CLAMPED, NOT NULLED -- the one place Tier 3 differs from Tiers 1 and 2, forced by
-- resident_change_monitoring_entries.observed_at being NOT NULL. A wrong device clock must not turn
-- a real bedside observation into a rejected receipt.
select is(
  (select public.sync_offline_change_observation_draft(
    (select id from t_ids where key = 'device-c'), '65000000-0000-4000-8000-000000000601',
    'coc-key-2', now() - interval '400 days', 'Steady on the second round.', null, false
  )->>'outcome'),
  'applied',
  'an implausible device clock does not cost the aide the observation'
);

select is(
  (select observed_at from public.resident_change_monitoring_entries
   where event_id = '65000000-0000-4000-8000-000000000601'
     and observations = 'Steady on the second round.'),
  now(),
  'the implausible time is clamped to sync time rather than trusted or nulled'
);

select ok(
  (select client_occurred_at from public.offline_draft_receipts
   where idempotency_key = 'coc-key-2') < now() - interval '300 days',
  'and the raw client time stays on the receipt, so a bad clock is still visible in the ledger'
);

-- A CLOSED EVENT IS 'stale', NOT 'rejected'. add_change_event_monitoring raises the same 22023 for a
-- closed event and for unusable text; they are not the same failure. The aide's observation is real
-- and needs a supervisor, not a retry and not "this couldn't be submitted".
reset role;
update public.resident_change_events
set status = 'closed', closed_at = now(), final_review_summary = 'Resolved; no further monitoring.'
where id = '65000000-0000-4000-8000-000000000603';
select pg_temp.act_as('65000000-0000-4000-8000-000000000101');

select is(
  (select public.sync_offline_change_observation_draft(
    (select id from t_ids where key = 'device-c'), '65000000-0000-4000-8000-000000000603',
    'coc-key-3', now() - interval '30 minutes', 'Ate most of dinner.', null, false
  )->>'outcome'),
  'stale',
  'an event closed while the device was offline is stale, not rejected'
);

select ok(
  (select error_message from public.offline_draft_receipts
   where idempotency_key = 'coc-key-3') like '%closed%',
  'and says so, rather than passing through a message about invalid input'
);

select is(
  (select count(*)::int from public.resident_change_monitoring_entries
   where event_id = '65000000-0000-4000-8000-000000000603'),
  0,
  'nothing is appended to a closed event -- the offline path is not a way around that rule'
);

-- Worker A filing on worker B's event. The employee branch of assert_change_event_contributor
-- requires the event be assigned to the caller, so this is a real authorization refusal reaching the
-- client as a flaggable receipt rather than an exception it would retry forever.
select is(
  (select public.sync_offline_change_observation_draft(
    (select id from t_ids where key = 'device-c'), '65000000-0000-4000-8000-000000000602',
    'coc-key-4', now(), 'Heel looks unchanged.', null, false
  )->>'outcome'),
  'rejected',
  'an aide cannot file observations on another aide''s event through the offline path'
);

-- Deliberately NOT a "count is still zero on that event" assertion. resident_change_events' own RLS
-- already hides worker B's event from worker A, so a version of this function that skipped
-- authorization entirely would still write nothing there and that count would still read zero --
-- it would pass while proving nothing. What is worth pinning is the part only this function
-- decides: a refusal has to come back as a receipt carrying the server's reason, because that is
-- what lets the client block-and-flag the draft for a human instead of retrying it forever.
select ok(
  (select error_message from public.offline_draft_receipts
   where idempotency_key = 'coc-key-4') is not null,
  'and the refusal comes back as a receipt carrying the reason, not as a silent no-op'
);

-- THE SHARED LEDGER, ASSERTED BEHAVIOURALLY. unsched-key-4 is a Tier 2 receipt on this same device
-- (a rejected unscheduled service). Replaying it through the Tier 3 RPC must return that ORIGINAL
-- outcome -- proving the (device_id, idempotency_key) promise really does span kinds, not just that
-- the constraint text mentions two columns.
select is(
  (select public.sync_offline_change_observation_draft(
    (select id from t_ids where key = 'device-c'), '65000000-0000-4000-8000-000000000601',
    'unsched-key-4', now(), 'Reused key from a different kind.', null, false
  )->>'outcome'),
  'rejected',
  'a key already spent on another draft kind replays that kind''s outcome -- one ledger, one promise'
);

select is(
  (select count(*)::int from public.resident_change_monitoring_entries
   where event_id = '65000000-0000-4000-8000-000000000601'),
  2,
  'and the cross-kind replay files nothing new'
);

select ok(
  (select pg_get_constraintdef(oid) from pg_constraint
   where conrelid = 'public.offline_draft_receipts'::regclass
     and conname = 'offline_draft_receipt_kind_shape_check')
  like '%change_observation%change_event_id IS NOT NULL%',
  'the third kind must carry the column that makes it meaningful, like the other two'
);

-- Tier 2 tested only revoked_at; every writer moves status, revoked_at and wipe_required_at
-- together, so this changes nothing reachable today -- it stops a later change that moves only one
-- of them from silently defeating the check on one of the three tiers but not the others.
select ok(
  pg_get_functiondef(
    'public.sync_offline_unscheduled_service_draft(uuid,uuid,text,timestamptz,text,integer,boolean,text)'::regprocedure
  ) like '%wipe_required_at is not null%'
  and pg_get_functiondef(
    'public.sync_offline_change_observation_draft(uuid,uuid,text,timestamptz,text,text,boolean)'::regprocedure
  ) like '%wipe_required_at is not null%',
  'all three tiers test the same columns before trusting a device'
);

------------------------------------------------------------------------------------------------
-- Tier 4: the vitals lane joins the ledger (BACKLOG.md open question 8, second half)
--
-- 20260803110000 shipped offline clinical observation drafts with their OWN receipt table -- written
-- before the one-ledger argument landed, and a divergence all the same. 20260803150000 absorbed it.
--
-- Tested in this file rather than one of its own for the reason the file has now given three times:
-- the promise the ledger makes is `unique (device_id, idempotency_key)`, and that promise is only
-- meaningful ACROSS kinds. A separate test file would have exercised the fourth kind in isolation,
-- which is the exact shape of the gap the merge closed.
------------------------------------------------------------------------------------------------
reset role;
select hasnt_table(
  'public', 'offline_observation_draft_receipts',
  'the second receipt ledger is gone, not merely deprecated'
);

-- Both registries key on the table NAME, so nothing in Postgres would have complained if the drop
-- had left them behind -- the absorbed table would simply have gone on being described by the
-- entitlement and audit registries as a thing that exists.
select is(
  (select count(*)::int from app_private.product_module_resources
   where resource_name = 'offline_observation_draft_receipts'),
  0,
  'and it no longer claims a modules.carebase resource that cannot be queried'
);

select is(
  (select count(*)::int from app_private.audit_entity_manifest
   where table_name = 'offline_observation_draft_receipts'),
  0,
  'nor a row in the audit manifest that get_audit_coverage would report on a dropped table'
);

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app_private' and p.proname = 'prevent_offline_observation_receipt_mutation'),
  0,
  'and the append-only guard that only that table used went with it'
);

-- The survivor still registered in both, asserted separately: "the absorbed rows are gone" and
-- "the surviving row is there" are different claims, and a delete that took one too many would
-- satisfy the first while quietly dropping the ledger out of governance entirely.
select ok(
  exists(select 1 from app_private.product_module_resources
         where resource_schema = 'public' and resource_name = 'offline_draft_receipts')
  and exists(select 1 from app_private.audit_entity_manifest
             where table_name = 'offline_draft_receipts'),
  'while the one surviving ledger is still governed by both registries'
);

-- Charting needs the org entitled to clinical.ehr and CareBase and the facility switch on. Granted
-- here, at the point of use, rather than in the fixture block: every assertion above this line ran
-- without them, and moving them up would quietly change what those tests were standing on.
insert into public.organization_entitlement_grants(
  organization_id, feature_key, decision, entitlement_value, reason
) values
  ('65000000-0000-4000-8000-000000000001', 'clinical.ehr', 'grant', 'true'::jsonb,
   'pgTAP fixture for the absorbed vitals lane'),
  ('65000000-0000-4000-8000-000000000001', 'modules.carebase', 'grant', 'true'::jsonb,
   'pgTAP fixture for the absorbed vitals lane');
update public.facilities set clinical_enabled = true
where id = '65000000-0000-4000-8000-000000000011';

select pg_temp.act_as('65000000-0000-4000-8000-000000000101');

select is(
  (select public.sync_offline_clinical_observation_draft(
    (select id from t_ids where key = 'device-c'), '65000000-0000-4000-8000-000000000201',
    'vitals-key-1', now() - interval '20 minutes', 'blood_pressure', now() - interval '20 minutes',
    142, 88, null, 'mmHg'
  )->>'outcome'),
  'applied',
  'a vitals draft still syncs after the merge'
);

-- THE assertion this whole migration is for. If draft_kind had been left off the retargeted insert
-- it would have defaulted to service_task and the widened shape CHECK would have refused the row --
-- so this pins both that the receipt lands in the shared ledger AND that it lands as itself.
select is(
  (select draft_kind from public.offline_draft_receipts where idempotency_key = 'vitals-key-1'),
  'clinical_observation',
  'and its receipt lands in the one ledger, carrying its own kind'
);

select ok(
  (select resident_id is not null and observation_type = 'blood_pressure' and observation_id is not null
   from public.offline_draft_receipts where idempotency_key = 'vitals-key-1'),
  'carrying the columns the widened shape check requires, and a link to what it charted'
);

-- The cross-kind promise, extended to the fourth kind and asserted behaviourally rather than by
-- reading the constraint text. coc-key-2 is a Tier 3 change-observation receipt on this same device;
-- while the two ledgers were separate this key was free for the vitals lane to reuse, and a
-- reconnect could have charted a reading under a key the ledger had already spent.
select is(
  (select public.sync_offline_clinical_observation_draft(
    (select id from t_ids where key = 'device-c'), '65000000-0000-4000-8000-000000000201',
    'coc-key-2', now(), 'heart_rate', now(), 78, null, null, 'bpm'
  )->>'outcome'),
  'duplicate',
  'a key already spent by a change observation is spent for vitals too -- one ledger, one promise'
);

-- 'duplicate' has to mean nothing was charted, not just that the caller was told a word. A fresh
-- key could never produce it, so this pair is what separates a real replay from a lucky string.
select is(
  (select count(*)::int from public.clinical_observations
   where resident_id = '65000000-0000-4000-8000-000000000201' and observation_type = 'heart_rate'),
  0,
  'and the cross-kind replay charts nothing'
);

select ok(
  (select pg_get_constraintdef(oid) from pg_constraint
   where conrelid = 'public.offline_draft_receipts'::regclass
     and conname = 'offline_draft_receipt_kind_shape_check')
  like '%clinical_observation%resident_id IS NOT NULL%observation_type IS NOT NULL%',
  'the fourth kind must carry the columns that make it meaningful, like the other three'
);

-- Same check the other three tiers get. The vitals lane was written against revoked_at alone in
-- 20260803110000 and aligned by 20260803130000; asserted here so all four tiers are pinned in one
-- place rather than three.
select ok(
  pg_get_functiondef(
    'public.sync_offline_clinical_observation_draft(uuid,uuid,text,timestamptz,text,timestamptz,numeric,numeric,text,text,text,text,text)'::regprocedure
  ) like '%wipe_required_at is not null%',
  'and the fourth tier tests the same columns before trusting a device'
);

select * from finish();
rollback;
