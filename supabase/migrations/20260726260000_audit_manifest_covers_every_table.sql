-- Every public table is accounted for in the audit manifest, and the ones that are not yet
-- classified say so instead of being absent.
--
-- THE FINDING, and it is the same shape as 20260726250000's unwatched cron jobs.
--
-- public.get_audit_coverage() -- the platform-admin audit coverage report -- iterates
-- app_private.audit_entity_manifest. A table that is not IN the manifest produces no row, so it
-- cannot be reported as uncovered. It is simply absent, and the report reads as complete.
--
-- The manifest's own seeding shows the intent was total coverage: 20260711155016 populated it by
-- selecting every table in pg_tables and classifying each one. That was a ONE-TIME SNAPSHOT. Every
-- table created by a migration since is absent, unclassified, and invisible to the report.
--
-- At the time of writing: 415 public tables, 187 in the manifest. 228 unlisted, 193 of those with no
-- audit trigger either. The convention did not lapse for want of a decision -- several later
-- migrations (Phase 2 employee lifecycle, billing, regulatory, the document analyzer) do add their
-- manifest rows. It lapsed for want of enforcement, which is what this migration adds.
--
-- WHAT THIS DOES.
--
--   1. Adds an explicit 'unclassified' audit_mode. The alternative was to backfill the 193 as
--      'not_required', and that would be the same overclaim in a new place: "reviewed and found not
--      to need auditing" is a statement about work nobody did. 'unclassified' says what is true.
--
--   2. Backfills every unlisted public table. A table that ALREADY carries audit_log_trigger is
--      classified 'row_trigger' -- the trigger is the evidence, no judgement required, and that is
--      exactly how 20260711155016 handled the same case. Everything else becomes 'unclassified'.
--
--   3. get_audit_coverage() gains `is_classified`. It is reported as its own column rather than
--      folded into has_required_trigger, because those are different questions -- "does this row's
--      declared mode have its trigger" and "has anyone decided what this table's mode should be" --
--      and collapsing them would break the existing assertion that reads the first one.
--
-- WHAT THIS DELIBERATELY DOES NOT DO. It does not invent classifications for the 193. Deciding
-- whether a given table needs a row audit is a compliance judgement with a write-throughput cost,
-- and 193 guesses would be worth less than an honest count. The accompanying pgTAP suite ratchets
-- that count downward the way the journey coverage ratchet works: it may fall, never rise.
--
-- Rollback: drop the is_classified column from get_audit_coverage's signature, delete the rows
-- inserted here, and restore the audit_mode check constraint.

alter table app_private.audit_entity_manifest
  drop constraint if exists audit_entity_manifest_audit_mode_check;
alter table app_private.audit_entity_manifest
  add constraint audit_entity_manifest_audit_mode_check check (
    audit_mode in ('row_trigger', 'domain_evidence', 'access_log', 'not_required', 'unclassified')
  );

comment on column app_private.audit_entity_manifest.audit_mode is
  'How this table is audited. ''unclassified'' means no decision has been recorded yet -- it is a '
  'gap to close, not a statement that auditing is unnecessary. get_audit_coverage() reports it as '
  'unclassified rather than covered.';

-- Backfill. Tables already carrying the trigger are classified by that fact; the rest are recorded
-- as undecided.
insert into app_private.audit_entity_manifest (
  table_name, audit_mode, contains_regulated_data, rationale
)
select
  t.tablename,
  case when exists (
    select 1
    from pg_catalog.pg_trigger tr
    join pg_catalog.pg_proc p on p.oid = tr.tgfoid
    where tr.tgrelid = to_regclass(format('%I.%I', t.schemaname, t.tablename))
      and not tr.tgisinternal
      and p.proname = 'audit_log_trigger'
  ) then 'row_trigger' else 'unclassified' end,
  false,
  case when exists (
    select 1
    from pg_catalog.pg_trigger tr
    join pg_catalog.pg_proc p on p.oid = tr.tgfoid
    where tr.tgrelid = to_regclass(format('%I.%I', t.schemaname, t.tablename))
      and not tr.tgisinternal
      and p.proname = 'audit_log_trigger'
  ) then 'Row audit trigger already present; classified from that evidence by 20260726260000'
  else 'Added after the Phase 1 manifest snapshot and not yet classified (20260726260000)' end
from pg_catalog.pg_tables t
where t.schemaname = 'public'
  and t.tablename <> 'audit_logs'
on conflict (table_name) do nothing;

-- ---------------------------------------------------------------------------
-- Classify the tables this program added, and close the gaps that classifying found
-- ---------------------------------------------------------------------------
--
-- These carry resident-identifiable care records, so they were checked individually rather than
-- left in the backlog. Checking them found three with no audit trail at all:
--
--   * support_plan_acknowledgments -- who has read the revised plan. ZERO audit writes. This is
--     evidence a surveyor asks for directly.
--   * resident_service_task_instances -- the record that care was delivered. Audited for exactly
--     one narrow action (service_exception.follow_up_created); record_service_task_response, the
--     path that documents the care itself, wrote nothing.
--   * resident_service_requirements -- the schedule care is delivered against.
--
-- They get the row trigger. support_plan_proposals does NOT need one: nine explicit audit_logs
-- writes cover generation and review, which is what 'domain_evidence' means -- and adding a trigger
-- on top would duplicate every one of them.

create trigger audit_log after insert or update or delete on public.support_plan_acknowledgments
  for each row execute function public.audit_log_trigger();
create trigger audit_log after insert or update or delete on public.resident_service_task_instances
  for each row execute function public.audit_log_trigger();
create trigger audit_log after insert or update or delete on public.resident_service_requirements
  for each row execute function public.audit_log_trigger();

update app_private.audit_entity_manifest set
  audit_mode = 'row_trigger',
  contains_regulated_data = true,
  rationale = 'Resident-identifiable care record; row-audited by 20260726260000',
  updated_at = now()
where table_name in (
  'resident_unscheduled_services',
  'resident_assessment_reviews',
  'resident_care_conflict_dispositions',
  'support_plan_acknowledgments',
  'resident_service_task_instances',
  'resident_service_requirements'
);

update app_private.audit_entity_manifest set
  audit_mode = 'domain_evidence',
  contains_regulated_data = true,
  rationale = 'Generation and review each write an explicit audit_logs entry; a row trigger would duplicate them',
  updated_at = now()
where table_name = 'support_plan_proposals';

-- Dropped first: adding a column to a RETURNS TABLE signature changes the return type, which
-- `create or replace` refuses (42P13). The grants below are therefore not optional -- a dropped
-- function takes its grants with it.
drop function if exists public.get_audit_coverage();

create function public.get_audit_coverage()
returns table (
  table_name text,
  audit_mode text,
  contains_regulated_data boolean,
  has_required_trigger boolean,
  is_classified boolean,
  rationale text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform_admin may inspect audit coverage'
      using errcode = '42501';
  end if;

  return query
  select
    m.table_name,
    m.audit_mode,
    m.contains_regulated_data,
    case
      -- Unclassified is not "no trigger required"; there is no declared requirement to satisfy yet,
      -- so this reports false rather than vacuously true.
      when m.audit_mode = 'unclassified' then false
      when m.audit_mode <> 'row_trigger' then true
      else exists (
        select 1
        from pg_catalog.pg_trigger as tr
        join pg_catalog.pg_proc as p on p.oid = tr.tgfoid
        where tr.tgrelid = to_regclass(format('%I.%I', m.table_schema, m.table_name))
          and not tr.tgisinternal
          and p.proname = 'audit_log_trigger'
      )
    end,
    m.audit_mode <> 'unclassified',
    m.rationale
  from app_private.audit_entity_manifest as m
  -- Unclassified first: the report should open on the work outstanding, not bury it.
  order by (m.audit_mode = 'unclassified') desc, m.contains_regulated_data desc, m.table_name;
end;
$$;
revoke all on function public.get_audit_coverage() from public, anon;
grant execute on function public.get_audit_coverage() to authenticated, service_role;

-- The ratchet's input: public tables with no manifest row at all. Distinct from 'unclassified',
-- which is a recorded decision to decide later; this is the invisible case the whole migration is
-- about.
create or replace function app_private.unmanifested_tables()
returns table (table_name text)
language sql
stable
set search_path = ''
as $$
  select t.tablename::text
  from pg_catalog.pg_tables t
  where t.schemaname = 'public'
    and t.tablename <> 'audit_logs'
    and not exists (
      select 1 from app_private.audit_entity_manifest m where m.table_name = t.tablename
    )
  order by t.tablename;
$$;
revoke all on function app_private.unmanifested_tables() from public, anon, authenticated, service_role;
