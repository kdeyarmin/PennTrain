begin;
select plan(7);

-- An undifferentiated backlog of 188 tables is only slightly more useful than the invisible list it
-- replaced. These assertions are about the backlog being ORDERED by consequence: the tables holding
-- resident and employee records have to be distinguishable from lookup and configuration tables, or
-- nobody can tell where to start.

-- The flag is applied, and to a meaningful subset rather than everything ------------------------
select ok(
  (select count(*) from app_private.regulated_unclassified_tables()) > 0,
  'the prioritised backlog is not empty -- subject-keyed tables are flagged'
);
-- The bound that makes the flag informative. Keying on a profiles foreign key instead would have
-- matched 152 of the 188 (created_by/actor columns are near-universal), and a flag on almost
-- everything carries as much information as a flag on nothing.
select ok(
  (select count(*) from app_private.regulated_unclassified_tables())
    < (select count(*) from app_private.audit_entity_manifest where audit_mode = 'unclassified'),
  'and it is a strict subset -- the flag discriminates rather than marking the whole backlog'
);

-- The evidence is a schema fact, so it is checked against the schema, not against a stored list.
select is(
  (select count(*)::int
   from app_private.regulated_unclassified_tables() r
   where not exists (
     select 1
     from pg_catalog.pg_constraint con
     join pg_catalog.pg_class c on c.oid = con.conrelid
     join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     join pg_catalog.pg_class fc on fc.oid = con.confrelid
     where n.nspname = 'public' and con.contype = 'f'
       and c.relname = r.table_name and fc.relname in ('residents', 'employees')
   )),
  0,
  'every flagged table really is keyed to a resident or an employee'
);
-- And the converse: nothing subject-keyed was missed.
select is(
  (select count(*)::int
   from app_private.audit_entity_manifest m
   where m.audit_mode = 'unclassified' and not m.contains_regulated_data
     and exists (
       select 1
       from pg_catalog.pg_constraint con
       join pg_catalog.pg_class c on c.oid = con.conrelid
       join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       join pg_catalog.pg_class fc on fc.oid = con.confrelid
       where n.nspname = 'public' and con.contype = 'f'
         and c.relname = m.table_name and fc.relname in ('residents', 'employees')
     )),
  0,
  'no subject-keyed table is left unflagged in the backlog'
);

-- Flagging must not be mistaken for classifying ---------------------------------------------------
-- This migration records what a table HOLDS. It deliberately does not decide how the table is
-- audited, because that is a compliance judgement with a write-throughput cost. If a later change
-- quietly starts setting audit_mode from the same evidence, this assertion is what catches it.
-- The count is pinned rather than a self-satisfying predicate. An earlier draft of this assertion
-- read `audit_mode = 'unclassified' and audit_mode <> 'unclassified'`, which is always false, so the
-- surrounding NOT EXISTS was always true -- it passed without testing anything. Pinning the total
-- means that if a future change starts deriving audit_mode from the regulated flag, the backlog
-- shrinks and this fails, which is the whole point of separating the two.
select is(
  (select count(*)::int from app_private.audit_entity_manifest where audit_mode = 'unclassified'),
  188,
  'flagging changed no table''s audit_mode -- holding regulated data is not itself an audit decision'
);

-- The report surfaces the priority ----------------------------------------------------------------
-- get_audit_coverage orders by (unclassified, then regulated), so the prioritised backlog is what an
-- operator sees first rather than something they have to sort for.
insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', 'fa000000-0000-4000-8000-000000000101', 'authenticated', 'authenticated', 'fa-platform@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active)
values ('fa000000-0000-4000-8000-000000000101', null, 'fa-platform@test.local', 'Priya', 'Platform', 'platform_admin', true)
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

select pg_temp.act_as('fa000000-0000-4000-8000-000000000101');
select ok(
  (select bool_and(not is_classified and contains_regulated_data)
   from (select * from public.get_audit_coverage() limit 5) top),
  'the report opens on unclassified tables that hold regulated data'
);
select ok(
  (select count(*) from public.get_audit_coverage() where not is_classified and contains_regulated_data) > 0,
  'and those rows are reachable through the report an operator actually reads'
);
reset role;

select * from finish();
rollback;
