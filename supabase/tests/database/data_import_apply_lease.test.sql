begin;
select plan(13);

-- BACKLOG.md G34. Two appliers, one ledger.
--
-- `claim_data_import_jobs` claims jobs stranded at 'applying' whose claim is absent or expired,
-- and the durable worker then applies every `data_import_rows` row still marked 'valid'. A
-- browser apply is exactly that shape: the bulk-import-* functions walk the CSV in chunks and
-- hold the job at 'applying' between them. Nothing on that side ever wrote `claim_expires_at`, so
-- the worker could not tell an import a manager was halfway through from one a dead tab had
-- stranded -- and both applied the same rows, because the browser's loop reads the CSV, not the
-- ledger. The visible result is duplicate rows in a customer's data from an import that reported
-- success on both sides.
--
-- The property under test is mutual exclusion between the two appliers, in BOTH directions, plus
-- the release paths that keep it from turning into a deadlock: a finished phase hands the job
-- back immediately, and an abandoned one is takeable once its claim expires. The last is the
-- reason the worker exists at all, so it has to survive the fix. A completed dry run parked at
-- 'ready' with its rows still 'valid' is the same shape as a claimable job from the ledger's
-- point of view -- and is exactly what the worker must never touch, because nobody pressed Apply.

insert into public.organizations (id, name, slug)
values ('b4000000-0000-4000-8000-000000000001', 'Import Lease Org', 'import-lease-org');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
)
select
  '00000000-0000-0000-0000-000000000000', fixture.id, 'authenticated',
  'authenticated', fixture.email, 'x', now(), '{}'::jsonb, '{}'::jsonb,
  now(), now(), '', '', '', '', '', '', false, false
from (values
  ('b4000000-0000-4000-8000-000000000101'::uuid, 'import-lease-first@test.local'),
  ('b4000000-0000-4000-8000-000000000102'::uuid, 'import-lease-second@test.local')
) as fixture(id, email);

select set_config('app.privileged_write', 'on', true);
insert into public.profiles (id, organization_id, email, first_name, last_name, role, is_active)
values
  ('b4000000-0000-4000-8000-000000000101', 'b4000000-0000-4000-8000-000000000001',
   'import-lease-first@test.local', 'First', 'Session', 'org_admin', true),
  ('b4000000-0000-4000-8000-000000000102', 'b4000000-0000-4000-8000-000000000001',
   'import-lease-second@test.local', 'Second', 'Session', 'org_admin', true)
on conflict (id) do update set
  organization_id = excluded.organization_id, role = excluded.role, is_active = excluded.is_active;
select set_config('app.privileged_write', 'off', true);

-- 201: a browser apply in progress. 202: an apply stranded mid-run (the rescue case).
-- 203: a completed dry run -- 'ready', all rows 'valid', and nobody has pressed Apply.
insert into public.data_import_jobs (
  id, organization_id, domain, status, original_file_name, original_file_sha256, total_rows
) values
  ('b4000000-0000-4000-8000-000000000201', 'b4000000-0000-4000-8000-000000000001', 'employees',
   'ready', 'roster.csv', repeat('b', 64), 5),
  ('b4000000-0000-4000-8000-000000000202', 'b4000000-0000-4000-8000-000000000001', 'residents',
   'applying', 'residents.csv', repeat('c', 64), 5),
  ('b4000000-0000-4000-8000-000000000203', 'b4000000-0000-4000-8000-000000000001', 'credentials',
   'ready', 'credentials.csv', repeat('d', 64), 5);

-- The rows a validate pass left behind: this is what the worker would apply.
insert into public.data_import_rows (organization_id, job_id, row_number, status)
select 'b4000000-0000-4000-8000-000000000001', job_id, n, 'valid'
from generate_series(2, 6) n
cross join (values
  ('b4000000-0000-4000-8000-000000000201'::uuid),
  ('b4000000-0000-4000-8000-000000000203'::uuid)
) as fixture(job_id);

create or replace function pg_temp.act_as(p_profile_id uuid)
returns void
language plpgsql
as $$
begin
  reset role;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', p_profile_id, 'role', 'authenticated', 'aal', 'aal2',
      'iat', extract(epoch from now())::bigint
    )::text,
    true
  );
  set local role authenticated;
end
$$;

-- The worker: a service-role token and no user. assert_import_manager recognises the superuser
-- test connection the same way it recognises the worker's, and claim_data_import_jobs reads
-- auth.role(), so this is the shape the cron invocation actually presents.
create or replace function pg_temp.act_as_worker()
returns void
language plpgsql
as $$
begin
  reset role;
  perform set_config(
    'request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
end
$$;

------------------------------------------------------------------------------------------------
-- A browser chunk holds the job
------------------------------------------------------------------------------------------------
select pg_temp.act_as('b4000000-0000-4000-8000-000000000101');

select lives_ok(
  $$ select public.record_data_import_chunk(
       'b4000000-0000-4000-8000-000000000201',
       '[{"rowNumber":2,"status":"applied","targetTable":"employees"}]'::jsonb,
       'applying', null) $$,
  'the first session records a chunk'
);

select ok(
  (select claimed_by from public.data_import_jobs
   where id = 'b4000000-0000-4000-8000-000000000201') = 'b4000000-0000-4000-8000-000000000101'
  and (select claim_expires_at > now() from public.data_import_jobs
       where id = 'b4000000-0000-4000-8000-000000000201'),
  'and that chunk leaves a live claim naming the session that recorded it'
);

select pg_temp.act_as_worker();

select is(
  (select count(*)::integer from public.claim_data_import_jobs(5, 600)
   where id = 'b4000000-0000-4000-8000-000000000201'),
  0,
  'the durable worker no longer claims an import a browser session is applying'
);

select pg_temp.act_as('b4000000-0000-4000-8000-000000000102');

select throws_ok(
  $$ select public.record_data_import_chunk(
       'b4000000-0000-4000-8000-000000000201',
       '[{"rowNumber":3,"status":"applied","targetTable":"employees"}]'::jsonb,
       'applying', null) $$,
  '55006',
  null,
  'and a second session is refused rather than applying the same rows alongside the first'
);

select pg_temp.act_as('b4000000-0000-4000-8000-000000000101');

select lives_ok(
  $$ select public.record_data_import_chunk(
       'b4000000-0000-4000-8000-000000000201',
       '[{"rowNumber":3,"status":"applied","targetTable":"employees"}]'::jsonb,
       'applying', null) $$,
  'the holder is not locked out by its own claim'
);

------------------------------------------------------------------------------------------------
-- The empty chunk the importers use to take the claim before applying anything
------------------------------------------------------------------------------------------------
select is(
  (public.record_data_import_chunk(
    'b4000000-0000-4000-8000-000000000201', '[]'::jsonb, null, null) ->> 'recorded')::integer,
  0,
  'an empty chunk with no status records nothing -- it exists only to take the claim'
);

select is(
  (select status from public.data_import_jobs
   where id = 'b4000000-0000-4000-8000-000000000201'),
  'applying',
  'and leaves the job status exactly where it was'
);

------------------------------------------------------------------------------------------------
-- Release: a finished phase, and an abandoned one
------------------------------------------------------------------------------------------------
select lives_ok(
  $$ select public.record_data_import_chunk(
       'b4000000-0000-4000-8000-000000000201',
       '[{"rowNumber":4,"status":"applied","targetTable":"employees"}]'::jsonb,
       'applied', null) $$,
  'the last chunk reports the phase finished'
);

select ok(
  (select claimed_by is null and claim_expires_at is null
   from public.data_import_jobs where id = 'b4000000-0000-4000-8000-000000000201'),
  'which hands the job back immediately instead of holding it for the rest of the lease'
);

------------------------------------------------------------------------------------------------
-- The other direction, on the second job
--
-- The worker's sweep above ran against the whole queue, so it saw all three jobs: it declined
-- the one a session held and took the stranded apply, which is also what stops the assertion
-- above from passing because the sweep found nothing at all.
------------------------------------------------------------------------------------------------
select ok(
  (select claimed_by = 'worker' and claim_expires_at > now()
   from public.data_import_jobs where id = 'b4000000-0000-4000-8000-000000000202'),
  'the same sweep did claim the stranded apply nobody was holding -- the skip above was a decision, not an empty queue'
);

select ok(
  (select status = 'ready' and claimed_by is null and claim_expires_at is null
   from public.data_import_jobs where id = 'b4000000-0000-4000-8000-000000000203'),
  'and it left the completed dry run at ready alone -- a preview nobody applied is not the worker''s to write'
);

select pg_temp.act_as('b4000000-0000-4000-8000-000000000101');

select throws_ok(
  $$ select public.record_data_import_chunk(
       'b4000000-0000-4000-8000-000000000202', '[]'::jsonb, null, null) $$,
  '55006',
  null,
  'and a session cannot start applying an import the worker is already running'
);

-- Aged to stand for a run that died mid-apply. Recovering that is the reason the worker exists,
-- so the interlock must not turn an abandoned claim into a permanently stuck import.
select pg_temp.act_as_worker();
update public.data_import_jobs
set claim_expires_at = now() - interval '1 minute'
where id = 'b4000000-0000-4000-8000-000000000202';

select pg_temp.act_as('b4000000-0000-4000-8000-000000000101');

select lives_ok(
  $$ select public.record_data_import_chunk(
       'b4000000-0000-4000-8000-000000000202', '[]'::jsonb, null, null) $$,
  'an expired claim is still takeable, so an abandoned run cannot strand the import'
);

select * from finish();
rollback;
