-- The audit backlog is prioritised: tables holding a data subject's records are flagged as
-- regulated, so the coverage report opens on the ones that matter.
--
-- WHY THIS IS SEPARATE FROM CLASSIFYING THEM. 20260726260000 made the gap visible and counted:
-- 188 tables carry audit_mode = 'unclassified'. But an undifferentiated list of 188 is only slightly
-- more useful than the invisible list it replaced. Whoever works it needs to know which entries hold
-- resident or employee records and which are lookup and configuration tables.
--
-- THE EVIDENCE IS MECHANICAL, NOT A JUDGEMENT. A table with a foreign key to public.residents or
-- public.employees is keyed to a data subject -- that is a schema fact, not an opinion. 70 of the 188
-- qualify.
--
-- Deliberately NOT keyed on a foreign key to public.profiles. Almost every table in the schema has
-- one for created_by / actor / owner columns, so including it matched 152 tables and would have
-- flagged the whole backlog as regulated, which carries exactly as much information as flagging none
-- of it.
--
-- WHAT THIS DOES NOT DO: it does not set audit_mode. Deciding that a given table needs a row trigger
-- is a compliance judgement with a real write-throughput cost -- audit_log_trigger fires on every
-- insert, update and delete -- and 70 of those decisions made mechanically would be 70 guesses.
-- `contains_regulated_data` is metadata; setting it costs nothing and cannot break a write path.
-- get_audit_coverage() already orders by (unclassified, then regulated), so the effect is that the
-- report now opens on "holds subject records, no audit decision recorded" instead of an alphabetical
-- list in which those tables are indistinguishable from a colour palette lookup.
--
-- Rollback: set contains_regulated_data = false where rationale matches the string written below.

update app_private.audit_entity_manifest m set
  contains_regulated_data = true,
  rationale = m.rationale || ' | Holds resident- or employee-keyed records (foreign key evidence, 20260726270000)',
  updated_at = now()
where m.audit_mode = 'unclassified'
  and not m.contains_regulated_data
  and exists (
    select 1
    from pg_catalog.pg_constraint con
    join pg_catalog.pg_class c on c.oid = con.conrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    join pg_catalog.pg_class fc on fc.oid = con.confrelid
    where n.nspname = 'public'
      and con.contype = 'f'
      and c.relname = m.table_name
      and fc.relname in ('residents', 'employees')
  );

-- Reports the prioritised backlog: unclassified AND holding subject records. This is the queue an
-- operator should actually work, and it exists as a function so the pgTAP suite can assert on the
-- same definition the report uses rather than a restatement of it that could drift.
create or replace function app_private.regulated_unclassified_tables()
returns table (table_name text)
language sql
stable
set search_path = ''
as $$
  select m.table_name
  from app_private.audit_entity_manifest m
  where m.audit_mode = 'unclassified' and m.contains_regulated_data
  order by m.table_name;
$$;
revoke all on function app_private.regulated_unclassified_tables()
  from public, anon, authenticated, service_role;
