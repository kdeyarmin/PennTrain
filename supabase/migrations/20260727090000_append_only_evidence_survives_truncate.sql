-- Every append-only guarantee in this schema is enforced by a row-level trigger, and TRUNCATE fires
-- no row-level triggers.
--
-- 87 triggers across the schema exist to say some record is evidence and may not be changed:
-- prevent_audit_log_mutation ('Audit evidence is append-only; export and archive it instead of
-- mutating it'), prevent_clinical_evidence_mutation, prevent_phase5_evidence_mutation on 34 tables,
-- the resident financial and personal-fund history, the portal access events, the survey-day events.
-- Every one of them is BEFORE UPDATE OR DELETE ... FOR EACH ROW. Not one is declared on TRUNCATE.
--
-- TRUNCATE fires only statement-level TRUNCATE triggers, and it is not subject to row-level security
-- either. So a single statement empties any of those tables and no guard runs, no policy applies, and
-- reconcile_audit_integrity reports nothing wrong afterwards -- it verifies that each surviving row's
-- hash matches its own contents, which is true of an empty table. The integrity check cannot see what
-- is missing from it.
--
-- AND THE PRIVILEGE WAS GRANTED. Measured on a fresh database:
--
--     role            TRUNCATE  TRIGGER  REFERENCES  SELECT   (of 415 tables in public)
--     anon                  83       83          83       0
--     authenticated        103      103         103     402
--
-- `anon` -- the role an unauthenticated HTTP request runs as -- holds TRUNCATE on 83 tables it cannot
-- read a single row of, including residents, employees, profiles, organizations, facilities and
-- incidents. `authenticated` holds TRUNCATE on audit_logs, where it has no DELETE and no UPDATE:
--
--     set role authenticated;
--     delete from public.audit_logs;   -- ERROR: permission denied for table audit_logs
--     update public.audit_logs ... ;   -- ERROR: permission denied for table audit_logs
--     truncate public.audit_logs;      -- TRUNCATE TABLE.  596 rows -> 0.
--
-- WHERE IT CAME FROM. Supabase's default privileges grant `arwdDxtm` on new tables to anon,
-- authenticated and service_role. This project already narrowed that -- pg_default_acl carries a
-- postgres-granted entry of `Dxtm` for all three -- so somebody did go and strip the four verbs they
-- thought of (select, insert, update, delete) and left the four they did not: TRUNCATE, TRIGGER,
-- REFERENCES and MAINTAIN. It is still live: a table created by a migration today grants `anon`
-- TRUNCATE and no SELECT. Fixing only the existing tables would leave the next one exposed.
--
-- HOW REACHABLE IS IT, HONESTLY. PostgREST issues SELECT, INSERT, UPDATE, DELETE and function calls;
-- there is no HTTP verb that emits TRUNCATE, and sweeping public for SECURITY INVOKER functions
-- reachable by anon or authenticated that run dynamic SQL returns nothing -- so this is not an open
-- door today. It is a privilege that should not exist, held by the two roles that are reachable from
-- a browser, that voids a guarantee the product states in its own error messages. The order of the
-- fix matters more than the current reachability: the trigger is the guarantee, the grant is the
-- reason nobody noticed it was missing.
--
-- WHAT THIS DOES
--
-- 1. Attaches a BEFORE TRUNCATE statement trigger to every table already carrying an UNCONDITIONAL
--    append-only row guard -- the 16 guard functions whose entire body is `raise exception ...
--    append-only`, covering 69 tables. Each table reuses ITS OWN guard function, so the error a
--    caller sees is the sentence already written for that table rather than a new generic one. The
--    conditional guards (lock_published_quiz_question, prevent_shift_assignment_overlap and the rest)
--    are deliberately left alone: they refuse a state transition, not the existence of the row, and
--    turning them into blanket TRUNCATE refusals would be inventing a rule nobody wrote.
--
-- 2. Revokes TRUNCATE, TRIGGER, REFERENCES (and MAINTAIN, where the server has it) from anon and
--    authenticated on every table in public, and fixes the default privileges so the next table does
--    not inherit them again.
--
-- A CONSEQUENCE WORTH NAMING: a TRUNCATE trigger fires on cascaded truncates too, so `truncate
-- public.residents cascade` is now refused as well -- it reaches resident financial evidence,
-- agreement history and the portal access log through foreign keys without ever naming them. That is
-- the intended reach rather than an accident of it: the destructive path a per-table allowlist misses
-- is the one where nobody typed the evidence table's name. Nothing in this product truncates
-- anything, so no working call site changes.
--
-- NOT TOUCHING service_role. It keeps TRUNCATE on 262 tables. That is a backend credential which
-- never reaches a browser, narrowing it has a different blast radius, and it is now behind the same
-- trigger as everyone else on the evidence tables -- a trigger fires regardless of who is asking,
-- which is exactly why the trigger is the part that matters. audit_logs already had TRUNCATE revoked
-- from service_role by 20260711162509; that revoke is the one place the gap was seen, and it was
-- treated as a grant problem rather than a missing guard.
--
-- ALSO NOT FIXED, and out of reach from here: pg_default_acl still carries a supabase_admin-granted
-- `arwdDxtm` entry for schema public. It applies only to tables created BY supabase_admin, which no
-- migration does, and altering another role's default privileges requires membership in it.
--
-- Rollback: drop trigger prevent_evidence_truncate on each table below, and re-grant if some caller
-- turns out to need DDL privileges on application tables (none does).

-- 1. The TRUNCATE guards ---------------------------------------------------------------------------
--
-- Driven off the catalogue rather than a typed list, so it cannot disagree with the row guards it is
-- mirroring. The companion test asserts the invariant structurally, which is what catches the next
-- evidence table that arrives with a row guard and no TRUNCATE guard.
do $$
declare
  r record;
begin
  for r in
    select distinct c.relname as table_name, p.oid::regprocedure::text as guard
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_class c on c.oid = t.tgrelid and c.relnamespace = 'public'::regnamespace
    join pg_catalog.pg_proc p on p.oid = t.tgfoid
    where not t.tgisinternal
      -- an unconditional refusal: the whole body is a raise, so it says the row may never change,
      -- not that some particular transition is disallowed
      and p.prosrc !~* '\mif\M'
      and p.prosrc !~* '\mcase\M'
      and p.prosrc ~* 'append-only'
      and not exists (
        select 1 from pg_catalog.pg_trigger t2
        where t2.tgrelid = c.oid and not t2.tgisinternal and (t2.tgtype::int & 32) <> 0
      )
    order by 1
  loop
    execute format(
      'create trigger prevent_evidence_truncate before truncate on public.%I '
      'for each statement execute function %s',
      r.table_name, r.guard
    );
  end loop;
end $$;

-- 2. The privileges --------------------------------------------------------------------------------
--
-- None of these are checked at query time: TRIGGER and REFERENCES are read only by CREATE TRIGGER and
-- by constraint creation, MAINTAIN by VACUUM/ANALYZE/CLUSTER/REINDEX/REFRESH MATERIALIZED VIEW, and
-- nothing in this product truncates a table. Existing triggers and foreign keys are unaffected --
-- both privileges are checked when the object is created, never afterwards.
revoke truncate, trigger, references on all tables in schema public from anon, authenticated;
alter default privileges in schema public
  revoke truncate, trigger, references on tables from anon, authenticated;

-- MAINTAIN is Postgres 17 and later. Spelled dynamically so this migration still applies to an older
-- server rather than failing to parse on a keyword that does not exist there yet.
do $$
begin
  if current_setting('server_version_num')::int >= 170000 then
    execute 'revoke maintain on all tables in schema public from anon, authenticated';
    execute 'alter default privileges in schema public '
            'revoke maintain on tables from anon, authenticated';
  end if;
end $$;
