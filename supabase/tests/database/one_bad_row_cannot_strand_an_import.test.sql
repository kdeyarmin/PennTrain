-- pgTAP for 20260906250000: the import that one bad row could strand, the archive that could be
-- made twice, and two Stripe events in the same second applied backwards.
--
-- RELEASE_READINESS_PLAN.md section 4.3 -- imports D1/D2/D5/D7, platform L6/L7/L10.
-- Run with: supabase test db.

begin;
select plan(41);

-- ---------------------------------------------------------------------------
-- Surface
-- ---------------------------------------------------------------------------

select has_function(
  'public', 'skip_data_import_rows', array['uuid', 'integer[]'],
  'an import manager can explicitly skip the rows finalize refuses to close over'
);
select has_function(
  'public', 'cancel_data_import_job', array['uuid', 'text'],
  'an import receipt that applied nothing can be closed'
);
select ok(
  not has_function_privilege('anon', 'public.cancel_data_import_job(uuid,text)', 'EXECUTE'),
  'and neither exit is reachable anonymously'
);

create or replace function pg_temp.act_as(p_profile_id uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_profile_id, 'role', p_role, 'aal', 'aal2',
    'iat', extract(epoch from now())::bigint
  )::text, true);
  set local role authenticated;
end;
$$;

insert into public.organizations(id, name, slug) values
  ('4d000000-0000-4000-8000-000000000001', 'Stranded Import Org', 'stranded-import-org');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('4d000000-0000-4000-8000-000000000011', '4d000000-0000-4000-8000-000000000001', 'Stranded Facility', 'PCH');

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values (
  '00000000-0000-0000-0000-000000000000', '4d000000-0000-4000-8000-000000000101',
  'authenticated', 'authenticated', 'stranded-admin@test.local', 'x', now(), '{}'::jsonb, '{}'::jsonb,
  now(), now(), '', '', '', '', '', '', false, false
);

select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('4d000000-0000-4000-8000-000000000101', '4d000000-0000-4000-8000-000000000001',
   'stranded-admin@test.local', 'Stranded', 'Admin', 'org_admin', true)
on conflict (id) do update set organization_id = excluded.organization_id, email = excluded.email,
  first_name = excluded.first_name, last_name = excluded.last_name, role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);

create temporary table strand_ids(key text primary key, id uuid) on commit drop;
grant all on table strand_ids to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- D1 -- one invalid row must not block Apply, Finalize and re-run
-- ---------------------------------------------------------------------------

insert into strand_ids values ('job', public.start_data_import_job(
  'employees', 'roster.csv', repeat('1', 64), 3, 'create', null,
  '4d000000-0000-4000-8000-000000000001'
));

insert into public.data_import_rows(
  organization_id, job_id, row_number, source_row, normalized_row, proposed_action, status,
  target_table, errors
)
select
  '4d000000-0000-4000-8000-000000000001', (select id from strand_ids where key = 'job'), v.n,
  '{}'::jsonb, '{}'::jsonb, 'create', v.status, 'employees', v.errors
from (values
  (2, 'valid', '[]'::jsonb),
  (3, 'valid', '[]'::jsonb),
  (4, 'invalid', '["job_title is required"]'::jsonb)
) v(n, status, errors);

select public.import_recount_job((select id from strand_ids where key = 'job'), false);
update public.data_import_jobs set status = 'ready' where id = (select id from strand_ids where key = 'job');

select is(
  (select error_rows from public.data_import_jobs where id = (select id from strand_ids where key = 'job')),
  1,
  'the receipt carries the one row that could not be imported'
);

select throws_ok(
  format('select public.finalize_data_import_job(%L)', (select id from strand_ids where key = 'job')),
  '22023',
  'Resolve or explicitly skip invalid rows before finalization',
  'finalize refuses the receipt, and asks for a skip nothing could perform before this migration'
);

select is(
  (public.skip_data_import_rows((select id from strand_ids where key = 'job')) ->> 'skippedNow')::integer,
  1,
  'skipping resolves exactly the row that failed'
);
select is(
  (select error_rows from public.data_import_jobs where id = (select id from strand_ids where key = 'job')),
  0,
  'and the receipt is recounted, which is what unblocks Apply'
);
select is(
  (select status from public.data_import_rows
   where job_id = (select id from strand_ids where key = 'job') and row_number = 4),
  'skipped',
  'the skipped row records that it was never written'
);
select ok(
  (select exists (
    select 1 from public.data_import_events
    where job_id = (select id from strand_ids where key = 'job') and event_type = 'rows_skipped'
  )),
  'and the skip is in the durable event ledger, not just in the counts'
);
select lives_ok(
  format('select public.finalize_data_import_job(%L)', (select id from strand_ids where key = 'job')),
  'finalize now closes the receipt'
);

select throws_ok(
  format('select public.skip_data_import_rows(%L)', (select id from strand_ids where key = 'job')),
  '22023',
  'A closed import receipt cannot be changed',
  'and a finalized receipt is closed to further skipping'
);

-- Cancel: the exit for a receipt that wrote nothing, which is also what releases the checksum.
insert into strand_ids values ('job2', public.start_data_import_job(
  'residents', 'residents.csv', repeat('2', 64), 2, 'create', null,
  '4d000000-0000-4000-8000-000000000001'
));
select is(
  public.start_data_import_job('residents', 'residents.csv', repeat('2', 64), 2, 'create', null,
    '4d000000-0000-4000-8000-000000000001'),
  (select id from strand_ids where key = 'job2'),
  'the same file comes back to the same open receipt -- which is why a stranded one owned the file'
);
select is(
  public.cancel_data_import_job((select id from strand_ids where key = 'job2'), 'Wrong file') ->> 'status',
  'canceled',
  'cancelling closes it'
);
select ok(
  (select canceled_at is not null and last_error = 'Wrong file'
   from public.data_import_jobs where id = (select id from strand_ids where key = 'job2')),
  'writing the canceled_at column data_import_jobs has always carried and nothing ever set'
);
select isnt(
  public.start_data_import_job('residents', 'residents.csv', repeat('2', 64), 2, 'create', null,
    '4d000000-0000-4000-8000-000000000001'),
  (select id from strand_ids where key = 'job2'),
  'and the corrected upload of the same bytes now starts a fresh receipt'
);

insert into strand_ids values ('job3', public.start_data_import_job(
  'rooms', 'rooms.csv', repeat('3', 64), 1, 'create', null,
  '4d000000-0000-4000-8000-000000000001'
));
update public.data_import_jobs set applied_rows = 1, status = 'applied'
where id = (select id from strand_ids where key = 'job3');
select throws_ok(
  format('select public.cancel_data_import_job(%L, %L)', (select id from strand_ids where key = 'job3'), 'nope'),
  '22023',
  'This import has applied rows; roll it back or finalize it instead of cancelling',
  'cancel never quietly describes applied rows as never having happened'
);

-- ---------------------------------------------------------------------------
-- D2 -- an HRIS row that failed validation can be dropped
-- ---------------------------------------------------------------------------

select matches(
  (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'set_hris_import_row_decision'),
  'validation_status <> ''valid'' and p_decision not in \(''skip'', ''reject''\)',
  'a row that failed validation may be skipped or rejected, and only that'
);
select matches(
  (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'apply_hris_import_batch'),
  'merge_decision not in \(''skip'', ''reject''\)',
  'and apply blocks on undecided rows rather than on the existence of an invalid one'
);
select unalike(
  (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'apply_hris_import_batch'),
  '%where import_run_id = v_run.id and validation_status <> ''valid''%',
  'the blanket refusal that no decision could ever clear is gone'
);

-- ---------------------------------------------------------------------------
-- D5 -- a failed export with attempts left is still queued
-- ---------------------------------------------------------------------------

select pg_temp.act_as('4d000000-0000-4000-8000-000000000101');
insert into strand_ids
select 'export', (public.request_organization_export()).id;
reset role;

update public.organization_export_jobs
set status = 'failed', attempt_count = 1, max_attempts = 3, available_at = now() + interval '5 minutes'
where id = (select id from strand_ids where key = 'export');

select ok(
  (select count(*) from public.organization_export_jobs j
   where (j.status in ('pending','processing')
       or (j.status = 'failed' and j.attempt_count < j.max_attempts))
     and j.id = (select id from strand_ids where key = 'export')) = 1,
  'claim_organization_export_jobs will pick this failed job up again, so it is not finished'
);

select pg_temp.act_as('4d000000-0000-4000-8000-000000000101');
select throws_ok(
  'select public.request_organization_export()',
  '55000',
  'An organization export is already in progress or queued for retry',
  'so a second complete archive of the same tenant is refused for the whole retry window'
);
reset role;

update public.organization_export_jobs
set attempt_count = 3
where id = (select id from strand_ids where key = 'export');
select pg_temp.act_as('4d000000-0000-4000-8000-000000000101');
select lives_ok(
  'select public.request_organization_export()',
  'and once the attempts budget is spent, a new export can be requested'
);
reset role;

-- `act_as` sets request.jwt.claims for the whole transaction; `reset role` does not clear it, and
-- the remaining sections must run as the trusted database session, not as that org admin.
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- D7 -- an employee number is unique inside its organization
-- ---------------------------------------------------------------------------

select has_index(
  'public', 'employees', 'employees_org_employee_number_key',
  'employee numbers are unique per organization'
);

insert into public.employees(organization_id, facility_id, employee_number, first_name, last_name, job_title, status)
values ('4d000000-0000-4000-8000-000000000001', '4d000000-0000-4000-8000-000000000011', 'EMP-1', 'A', 'One', 'Direct Care', 'active');

select throws_ok(
  $$insert into public.employees(organization_id, facility_id, employee_number, first_name, last_name, job_title, status)
    values ('4d000000-0000-4000-8000-000000000001', '4d000000-0000-4000-8000-000000000011', 'EMP-1', 'B', 'Two', 'Direct Care', 'active')$$,
  '23505',
  null,
  'a number reused at a second facility in the same organization is refused'
);

select lives_ok(
  $$insert into public.employees(organization_id, facility_id, employee_number, first_name, last_name, job_title, status)
    values ('4d000000-0000-4000-8000-000000000001', '4d000000-0000-4000-8000-000000000011', null, 'C', 'Three', 'Direct Care', 'active'),
           ('4d000000-0000-4000-8000-000000000001', '4d000000-0000-4000-8000-000000000011', null, 'D', 'Four', 'Direct Care', 'active')$$,
  'while an unrecorded employee number stays a non-value that any number of rows may share'
);

-- ---------------------------------------------------------------------------
-- L6 / L10 -- the job registry
-- ---------------------------------------------------------------------------

select matches(
  (select description from app_private.system_job_definitions
   where job_key = 'compliance-requirement-maintenance'),
  'four daily compliance-maintenance statements',
  'the compliance-maintenance registration finally describes what the wrapper runs -- two earlier '
  'migrations updated it by cron name and matched nothing'
);

select unalike(
  (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'execute_registered_sql_job'),
  '%monday-digest%',
  'and the retired monday-digest keeps no arm in the claim path'
);
select ok(
  (select not is_active and cron_job_name is null
   from app_private.system_job_definitions where job_key = 'monday-digest'),
  'monday-digest is still retired, which is what makes removing the arm correct'
);

-- ---------------------------------------------------------------------------
-- L7 -- two real Stripe events in the same second
-- ---------------------------------------------------------------------------

create or replace function pg_temp.stripe_subscription_event(
  p_event_id text, p_created timestamptz, p_status text, p_org uuid, p_sha text
) returns boolean language plpgsql as $$
declare r record;
begin
  select * into r from public.process_stripe_billing_event(
    p_event_id, 'customer.subscription.updated', p_created,
    jsonb_build_object(
      'id', p_event_id, 'type', 'customer.subscription.updated',
      'created', extract(epoch from p_created)::bigint,
      'data', jsonb_build_object('object', jsonb_build_object(
        'id', 'sub_strandtest', 'object', 'subscription', 'status', p_status,
        'customer', 'cus_strandtest',
        'metadata', jsonb_build_object('organization_id', p_org::text),
        'items', jsonb_build_object('data', jsonb_build_array(jsonb_build_object(
          'id', 'si_strandtest', 'quantity', 3,
          'price', jsonb_build_object('id', 'price_strandtest'),
          'current_period_start', extract(epoch from p_created)::bigint,
          'current_period_end', extract(epoch from p_created + interval '30 days')::bigint)))
      ))),
    p_sha, 'strand-' || p_event_id);
  return r.was_applied;
end;
$$;

update public.billing_accounts set stripe_customer_id = 'cus_strandtest'
where organization_id = '4d000000-0000-4000-8000-000000000001';

-- Two REAL events in the same Stripe second, delivered in causal order. The later one carries the
-- lexically SMALLER event id, which is what the old tie-break compared.
select ok(
  pg_temp.stripe_subscription_event(
    'evt_zzzzzzzzzzstrand1', '2026-09-01T12:00:00Z'::timestamptz, 'past_due',
    '4d000000-0000-4000-8000-000000000001', repeat('a', 64)),
  'the first of two same-second subscription events applies'
);
select pg_sleep(0.02);
select ok(
  pg_temp.stripe_subscription_event(
    'evt_aaaaaaaaaastrand2', '2026-09-01T12:00:00Z'::timestamptz, 'active',
    '4d000000-0000-4000-8000-000000000001', repeat('b', 64)),
  'and so does the second, whose lower event id used to make it look stale'
);
select is(
  (select provider_status from public.billing_subscriptions where stripe_subscription_id = 'sub_strandtest'),
  'active',
  'the tenant ends on the state Stripe last sent, not the one whose random id happened to sort higher'
);

-- Ordering across seconds is unchanged: a genuinely older event delivered later is still refused.
select ok(
  not pg_temp.stripe_subscription_event(
    'evt_zzzzzzzzzzstrand3', '2026-08-31T12:00:00Z'::timestamptz, 'canceled',
    '4d000000-0000-4000-8000-000000000001', repeat('c', 64)),
  'an event from an earlier second arriving last is still stale'
);
select is(
  (select provider_status from public.billing_subscriptions where stripe_subscription_id = 'sub_strandtest'),
  'active',
  'and does not overwrite the newer state'
);

-- ---------------------------------------------------------------------------
-- Section 4.4 row I5 -- the import worker's resident-contact writes go through the RPC
-- ---------------------------------------------------------------------------

select matches(
  (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'import_apply_resident_contact'),
  'is_trusted_database_session',
  'the durable worker service-role session can reach the RPC the browser processor already used'
);

insert into public.residents(id, organization_id, facility_id, first_name, last_name, admission_date)
values ('4d000000-0000-4000-8000-000000000301', '4d000000-0000-4000-8000-000000000001',
        '4d000000-0000-4000-8000-000000000011', 'Rose', 'Contact', public.pa_today() - 30);

insert into strand_ids values ('contactjob', public.start_data_import_job(
  'resident_contacts', 'contacts.csv', repeat('4', 64), 1, 'create', null,
  '4d000000-0000-4000-8000-000000000001'
));

select is(
  (public.import_apply_resident_contact(
    (select id from strand_ids where key = 'contactjob'),
    '4d000000-0000-4000-8000-000000000301',
    jsonb_build_object('name', 'Ada Kin', 'contact_type', 'emergency_contact', 'is_primary', true)
  )).facility_id,
  '4d000000-0000-4000-8000-000000000011'::uuid,
  'and the RPC derives facility_id from the resident rather than trusting the ledger payload'
);

select throws_ok(
  format($fmt$select public.import_apply_resident_contact(%L, %L, '{"name":"Bad Kin","contact_type":"not_a_type"}'::jsonb)$fmt$,
    (select id from strand_ids where key = 'contactjob'), '4d000000-0000-4000-8000-000000000301'),
  '22023',
  'Invalid contact type',
  'which is the validation the direct table writes skipped entirely'
);

-- ---------------------------------------------------------------------------
-- Section 4.4 row I13 -- the `unknown` dead end and the unbounded health counter
-- ---------------------------------------------------------------------------

select alike(
  (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'run_phase1_synthetic_checks'),
  '%interval ''24 hours''%',
  'the synthetic health check counts recent ambiguous outcomes, not every one ever recorded'
);

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values (
  '00000000-0000-0000-0000-000000000000', '4d000000-0000-4000-8000-000000000102',
  'authenticated', 'authenticated', 'stranded-platform@test.local', 'x', now(), '{}'::jsonb, '{}'::jsonb,
  now(), now(), '', '', '', '', '', '', false, false
);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('4d000000-0000-4000-8000-000000000102', '4d000000-0000-4000-8000-000000000001',
   'stranded-platform@test.local', 'Stranded', 'Platform', 'platform_admin', true)
on conflict (id) do update set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);

insert into public.notification_deliveries(
  id, organization_id, profile_id, channel, recipient, status, attempt_count,
  final_outcome, finalized_at
) values
  ('4d000000-0000-4000-8000-000000000401', '4d000000-0000-4000-8000-000000000001',
   '4d000000-0000-4000-8000-000000000101', 'email', 'stranded-admin@test.local', 'failed', 1,
   'unknown', now() - interval '9 hours'),
  ('4d000000-0000-4000-8000-000000000402', '4d000000-0000-4000-8000-000000000001',
   '4d000000-0000-4000-8000-000000000101', 'email', 'stranded-admin@test.local', 'failed', 1,
   'unknown', now() - interval '1 hour');

select is(
  ((public.run_phase1_synthetic_checks()) ->> 'notificationOutcomesUnknown')::integer,
  2,
  'a fresh ambiguous outcome is what the health check is for'
);
update public.notification_deliveries
set finalized_at = now() - interval '40 hours', updated_at = now() - interval '40 hours'
where id in ('4d000000-0000-4000-8000-000000000401', '4d000000-0000-4000-8000-000000000402');
select is(
  ((public.run_phase1_synthetic_checks()) ->> 'notificationOutcomesUnknown')::integer,
  0,
  'and an old one no longer reddens phase1-synthetic-health on every run for ever'
);
update public.notification_deliveries
set finalized_at = now() - interval '9 hours', updated_at = now() - interval '9 hours'
where id = '4d000000-0000-4000-8000-000000000401';
update public.notification_deliveries
set finalized_at = now() - interval '1 hour', updated_at = now() - interval '1 hour'
where id = '4d000000-0000-4000-8000-000000000402';

select pg_temp.act_as('4d000000-0000-4000-8000-000000000102');
select lives_ok(
  $q$select public.retry_notification_delivery('4d000000-0000-4000-8000-000000000401')$q$,
  'a platform admin can finally re-send an ambiguous delivery the provider never spoke about again'
);
select throws_ok(
  $q$select public.retry_notification_delivery('4d000000-0000-4000-8000-000000000402')$q$,
  'P0002',
  null,
  'while one still inside the six-hour quarantine is refused, so a late callback is not pre-empted'
);
reset role;
select set_config('request.jwt.claims', '', true);

select * from finish();
rollback;
