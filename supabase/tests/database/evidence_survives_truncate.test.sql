begin;
-- A refused `truncate ... cascade` still announces every table it would have reached first, which is
-- over a hundred NOTICE lines for one assertion. pgTAP reports through its result set, not through
-- notices, so nothing diagnostic is lost by quietening them.
set local client_min_messages to warning;
select plan(11);

-- 87 triggers in this schema exist to say a record is evidence and may not be changed, and every one
-- of them is FOR EACH ROW. TRUNCATE fires no row-level triggers and is not subject to row-level
-- security, so before 20260727090000 a single statement emptied any of those tables with no guard
-- run and no policy applied -- and `anon` held TRUNCATE on 83 tables it could not read a row of,
-- while `authenticated` held it on audit_logs, where it has neither DELETE nor UPDATE.
--
-- The controls come first. Every assertion below is a refusal, and a refusal proves nothing if the
-- statement is refused everywhere.

-- CONTROL: TRUNCATE still works -------------------------------------------------------------------
-- benchmark_snapshots carries no append-only guard and nothing references it, so it is the one shape
-- of table this change is meant to leave alone. The first draft of this control used facility_units,
-- which looked unguarded but cascades into resident evidence -- it was refused, and would have made
-- every assertion below vacuous while looking like a passing control.
select lives_ok(
  $$truncate public.benchmark_snapshots$$,
  'CONTROL: truncating an unguarded leaf table still works, so the refusals below are about the guard'
);

-- The guard fires for the table owner, not merely for a role missing the grant -------------------
-- Asserted as the owner deliberately. Revoking the privilege from anon and authenticated is the
-- lesser half of the fix; the trigger is the half that holds regardless of who is asking, and a test
-- run as a role without TRUNCATE would pass against a schema that had no trigger at all.
select throws_ok(
  $$truncate public.audit_logs$$,
  '55000',
  null,
  'the audit trail refuses TRUNCATE for the table owner'
);
select throws_ok(
  $$truncate public.resident_financial_transactions$$,
  '55000',
  null,
  'so does resident financial evidence'
);
select throws_ok(
  $$truncate public.resident_portal_access_events$$,
  '55000',
  null,
  'and the portal access log, which is the record of who read what'
);
-- A cascading truncate reaches an evidence table through a foreign key without ever naming it. This
-- is the case a per-table allowlist would miss: nobody typed the evidence table's name.
select throws_ok(
  $$truncate public.residents cascade$$,
  '55000',
  null,
  'a CASCADE that reaches evidence through a foreign key is refused without naming it'
);

-- Structural: the two kinds of guard cannot drift apart --------------------------------------------
--
-- Derived from the catalogue rather than a list of table names, because the failure mode this is
-- guarding against is a NEW evidence table arriving with a row guard and no TRUNCATE guard. A named
-- list would still be green on the day that happens.
select is(
  (select coalesce(string_agg(distinct c.relname, ', ' order by c.relname), '(none)')
   from pg_catalog.pg_trigger t
   join pg_catalog.pg_class c on c.oid = t.tgrelid and c.relnamespace = 'public'::regnamespace
   join pg_catalog.pg_proc p on p.oid = t.tgfoid
   where not t.tgisinternal
     -- an unconditional refusal: the whole body is a raise, so the row may never change
     and p.prosrc !~* '\mif\M' and p.prosrc !~* '\mcase\M' and p.prosrc ~* 'append-only'
     and not exists (
       select 1 from pg_catalog.pg_trigger t2
       where t2.tgrelid = c.oid and not t2.tgisinternal and (t2.tgtype::int & 32) <> 0
     )),
  '(none)',
  'every table with an unconditional append-only row guard also refuses TRUNCATE'
);

-- Privilege ratchets -------------------------------------------------------------------------------
--
-- Named rather than counted: which table regained the privilege is the useful half of the failure.
-- These four are DDL and maintenance privileges. A PostgREST role issues SELECT, INSERT, UPDATE,
-- DELETE and function calls, and needs none of them; they were left behind when somebody narrowed
-- Supabase's `grant all` default down to `Dxtm` and stripped only the verbs they thought of.
select is(
  (select coalesce(string_agg(c.relname, ', ' order by c.relname), '(none)')
   from pg_catalog.pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
     and (has_table_privilege('anon', c.oid, 'TRUNCATE')
       or has_table_privilege('authenticated', c.oid, 'TRUNCATE'))),
  '(none)',
  'no browser-reachable role can TRUNCATE any application table'
);
select is(
  (select coalesce(string_agg(c.relname, ', ' order by c.relname), '(none)')
   from pg_catalog.pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
     and (has_table_privilege('anon', c.oid, 'TRIGGER')
       or has_table_privilege('authenticated', c.oid, 'TRIGGER'))),
  '(none)',
  'nor attach a trigger to one -- 79 trigger functions are executable by authenticated'
);
select is(
  (select coalesce(string_agg(c.relname, ', ' order by c.relname), '(none)')
   from pg_catalog.pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
     and (has_table_privilege('anon', c.oid, 'REFERENCES')
       or has_table_privilege('authenticated', c.oid, 'REFERENCES')
       or has_table_privilege('anon', c.oid, 'MAINTAIN')
       or has_table_privilege('authenticated', c.oid, 'MAINTAIN'))),
  '(none)',
  'nor hold REFERENCES or MAINTAIN on one'
);

-- The default privileges, which are where this came back from ---------------------------------------
--
-- The grants above were not typed by anyone; they were inherited. Asserting only the current tables
-- would go green today and be wrong again on the next CREATE TABLE, so this creates one and asks.
create table public.zz_default_privilege_probe(id int primary key);
select is(
  (select coalesce(string_agg(x.priv, ', ' order by x.priv), '(none)')
   from (values ('TRUNCATE'), ('TRIGGER'), ('REFERENCES'), ('MAINTAIN')) x(priv)
   where has_table_privilege('anon', 'public.zz_default_privilege_probe', x.priv)
      or has_table_privilege('authenticated', 'public.zz_default_privilege_probe', x.priv)),
  '(none)',
  'a table created today inherits none of them either'
);
-- Control for the assertion above: default privileges are not simply empty for everybody, and
-- has_table_privilege is not simply answering false. service_role is deliberately unchanged.
select ok(
  has_table_privilege('service_role', 'public.zz_default_privilege_probe', 'TRUNCATE'),
  'CONTROL: service_role still inherits TRUNCATE, so the assertion above is not vacuous'
);

select * from finish();
rollback;
