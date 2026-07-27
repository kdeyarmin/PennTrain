begin;
select plan(10);

-- The audit coverage report iterates app_private.audit_entity_manifest, so a table that is not IN
-- the manifest produces no row and cannot be reported as uncovered -- it is simply absent, and the
-- report reads as complete. The manifest was seeded from pg_tables once, in Phase 1, and every table
-- added since was invisible to it.
--
-- Same shape as the unwatched cron jobs, in the audit trail of a compliance product.


-- get_audit_coverage() is platform-admin only, so the two assertions that read the REPORT (rather
-- than the manifest behind it) need an actor. The report is what an operator sees, so testing it
-- through the guard rather than around it is the point.
insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', 'ff000000-0000-4000-8000-000000000101', 'authenticated', 'authenticated', 'ff-platform@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active)
values ('ff000000-0000-4000-8000-000000000101', null, 'ff-platform@test.local', 'Pat', 'Platform', 'platform_admin', true)
on conflict(id) do update set role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);

create or replace function pg_temp.act_as(p_id uuid)
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_id, 'role', 'authenticated',
    'aal', 'aal2', 'iat', extract(epoch from now())::bigint)::text, true);
  set local role authenticated;
end $$;

-- The ratchet ------------------------------------------------------------------------------------
select is(
  (select count(*)::int from app_private.unmanifested_tables()),
  0,
  'every public table has an audit manifest row'
);
-- Named, not counted: on failure the next person needs to know which table, not that a number moved.
select is(
  (select coalesce(string_agg(table_name, ', ' order by table_name), '(none)')
   from app_private.unmanifested_tables()),
  '(none)',
  'and none is left unmanifested (any listed above needs a classification)'
);

-- Unclassified is honest, and stays visible -------------------------------------------------------
-- The backlog is recorded rather than backfilled as 'not_required', because "reviewed and found not
-- to need auditing" would be a statement about work nobody did. This ceiling may fall, never rise --
-- the same ratchet the journey coverage check uses.
select ok(
  (select count(*) from app_private.audit_entity_manifest where audit_mode = 'unclassified') <= 193,
  'the unclassified backlog is at or below its ceiling of 193'
);

select pg_temp.act_as('ff000000-0000-4000-8000-000000000101');
-- An unclassified table must not report as covered. This is the assertion that stops the new state
-- from becoming a quieter version of the bug it replaces.
-- Read entirely from the report, not from the manifest behind it: this is the operator's view, and
-- an assertion that reached past it into app_private would not be testing what an operator sees.
select is(
  (select count(*)::int from public.get_audit_coverage()
   where audit_mode = 'unclassified' and (is_classified or has_required_trigger)),
  0,
  'no unclassified table is reported as classified or as satisfying a trigger requirement'
);
-- And the report does surface them rather than omitting them, which was the original defect.
select ok(
  (select count(*) from public.get_audit_coverage() where not is_classified) > 0,
  'the report shows the unclassified backlog instead of leaving those tables absent'
);

-- The pre-existing invariant still holds: a row that DECLARES row_trigger has one. Kept separate
-- from is_classified on purpose -- "does the declared mode have its trigger" and "has anyone decided
-- the mode" are different questions, and folding them together would have hidden one behind the
-- other.
select is(
  (select count(*)::int from public.get_audit_coverage() where not has_required_trigger and is_classified),
  0,
  'every classified entry satisfies the audit mode it declares'
);

reset role;

-- The gaps that classifying actually found ---------------------------------------------------------
-- Each of these held resident-identifiable care records with no audit trail before this migration.
select ok(
  exists (select 1 from pg_catalog.pg_trigger tr
          join pg_catalog.pg_proc p on p.oid = tr.tgfoid
          where tr.tgrelid = 'public.support_plan_acknowledgments'::regclass
            and not tr.tgisinternal and p.proname = 'audit_log_trigger'),
  'who has read the revised plan is now audited -- it had no audit writes at all'
);
select ok(
  exists (select 1 from pg_catalog.pg_trigger tr
          join pg_catalog.pg_proc p on p.oid = tr.tgfoid
          where tr.tgrelid = 'public.resident_service_task_instances'::regclass
            and not tr.tgisinternal and p.proname = 'audit_log_trigger'),
  'the record that care was delivered is now audited'
);
select ok(
  exists (select 1 from pg_catalog.pg_trigger tr
          join pg_catalog.pg_proc p on p.oid = tr.tgfoid
          where tr.tgrelid = 'public.resident_service_requirements'::regclass
            and not tr.tgisinternal and p.proname = 'audit_log_trigger'),
  'the schedule care is delivered against is now audited'
);

-- domain_evidence is a claim about explicit logging, so it must not be applied to a table nothing
-- logs. support_plan_proposals earns it: generation and review both write audit_logs by hand.
select is(
  (select audit_mode from app_private.audit_entity_manifest where table_name = 'support_plan_proposals'),
  'domain_evidence',
  'a table audited by explicit RPC writes is classified as such rather than given a duplicate trigger'
);

select * from finish();
rollback;
