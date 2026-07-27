begin;
select plan(8);

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
--
-- Both assertions below were originally written with the SAME one-hop rule the migration used, which
-- made them restatements rather than tests: the converse could not see a table two hops from a
-- resident because it was looking for exactly what had already been flagged. Twenty tables were
-- missed that way -- clinical_observation_amendments, clinical_progress_note_versions, the
-- change-of-condition history and follow-up tables, and four resident-complaint tables. They are
-- written against the transitive CLOSURE now, so the property is "reachable from a data subject",
-- not "matches the query somebody happened to run".
create or replace function pg_temp.subject_closure()
returns table(t text) language sql stable as $fn$
  with recursive fk(child, parent) as (
    select c.relname::text collate "C", fc.relname::text collate "C"
    from pg_catalog.pg_constraint con
    join pg_catalog.pg_class c on c.oid = con.conrelid and c.relnamespace = 'public'::regnamespace
    join pg_catalog.pg_class fc on fc.oid = con.confrelid and fc.relnamespace = 'public'::regnamespace
    where con.contype = 'f' and c.relname <> fc.relname
  ),
  closure(t) as (
    select 'residents'::text collate "C"
    union select 'employees'::text collate "C"
    union select fk.child from closure c join fk on fk.parent = c.t
  )
  select t from closure
$fn$;

select is(
  (select coalesce(string_agg(r.table_name, ', ' order by r.table_name), '(none)')
   from app_private.regulated_unclassified_tables() r
   where r.table_name not in (select t from pg_temp.subject_closure())
     -- Polymorphic subject_type/subject_id tables carry no foreign key at all, so the closure cannot
     -- reach them; they are flagged on named evidence instead.
     and r.table_name not in ('compliance_copilot_runs', 'workflow_automation_runs')),
  '(none)',
  'every flagged table is reachable from a resident or employee, or named as polymorphic'
);
-- The converse, and the one that actually failed. This is the assertion the earlier version could not
-- make, because it asked the same question the flag was set from.
select is(
  (select coalesce(string_agg(m.table_name, ', ' order by m.table_name), '(none)')
   from app_private.audit_entity_manifest m
   where m.audit_mode = 'unclassified' and not m.contains_regulated_data
     and m.table_name in (select t from pg_temp.subject_closure())),
  '(none)',
  'no table reachable from a data subject by ANY number of foreign key hops is left unflagged'
);
-- A polymorphic subject column is invisible to foreign-key analysis entirely, so it gets its own
-- assertion rather than relying on the two names above staying correct.
select is(
  (select coalesce(string_agg(m.table_name, ', ' order by m.table_name), '(none)')
   from app_private.audit_entity_manifest m
   join pg_catalog.pg_class c on c.relname = m.table_name and c.relnamespace = 'public'::regnamespace
   where m.audit_mode = 'unclassified' and not m.contains_regulated_data
     and exists (
       select 1 from pg_catalog.pg_attribute a
       where a.attrelid = c.oid and not a.attisdropped and a.attname = 'subject_type'
     )),
  '(none)',
  'no table carrying a polymorphic subject_type is left unflagged either'
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
