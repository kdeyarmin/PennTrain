-- The Phase 1 synthetic health check has never once passed, and one of its two blockers is not
-- a defect at all.
--
-- THE FINDING. `phase1-synthetic-health` is registered critical and runs every 15 minutes. On
-- production its `last_known_good_at` is NULL: it has failed on every run it has ever made, with
--
--   {"exclusionSourcesWithoutActiveSnapshot": 1, "completedAssignmentsWithoutCertificate": 1}
--
-- This migration addresses the first counter. (The second is a genuine historical gap and is
-- repaired separately in 20260904040000, because the two have nothing in common but a job.)
--
-- The counter reads `count(*) from exclusion_source_state where active_snapshot_id is null`, and
-- the row it counts is `sam_exclusions`, whose `last_status` is 'not_loaded' and which has no
-- snapshot, no run, and no attempt -- ever. That is not an integrity violation. It is this
-- deployment's configuration: `screen-exclusions` reads SAM_GOV_API_KEY and, when it is absent,
-- says so and skips SAM by design ("SAM.gov exclusion screening is skipped for this deployment
-- (OIG LEIE screening still runs)"). A deployment that never configured a source has a source
-- that was never loaded, and the check has been paging about it every 15 minutes since the day it
-- was scheduled.
--
-- WHY THAT MATTERS MORE THAN THE FALSE POSITIVE ITSELF. This job is the one alerting channel the
-- platform has for integrity invariants -- certificate gaps, audit-trigger gaps, unresolved audit
-- integrity issues, exhausted PDF jobs, unknown notification outcomes. Because it has been red
-- continuously since it was created, a NEW violation in any of those changes nothing on any
-- screen: the job was already failing, the tile was already red, and the run history was already
-- a wall of the same message. An alarm that has never been silent cannot alarm.
--
-- THE FIX. Count a source as violating only when it has been loaded at some point and does not
-- have an active snapshot now -- `active_snapshot_id is null and last_status <> 'not_loaded'`.
-- That keeps every case the check exists for:
--
--   * a first refresh that FAILED leaves last_status = 'failed' -> still counted;
--   * a source that HAD an active snapshot and lost it -> still counted, and this is the
--     dangerous one, because it means screening silently started matching against nothing;
--   * a refresh stuck mid-flight leaves last_status = 'staging' -> still counted.
--
-- and drops exactly one case: a source nobody has ever configured on this deployment.
--
-- WHY NOT A `screening_enabled` COLUMN, which was the first design. Because it would have to be
-- SET by something, and the only honest setter is the deployment's own configuration -- which
-- lives in an Edge Function secret the database cannot see. A column defaulted true and flipped
-- false for SAM in this migration would hardcode one deployment's posture into every deployment,
-- including one that does hold a SAM_GOV_API_KEY. `last_status` already carries the fact, set by
-- the refresh path itself, so the check can read it instead of being told.
--
-- WHAT STAYS VISIBLE. Nothing is hidden by this. `public.exclusion_source_health` still reports
-- sam_exclusions as `health_status = 'not_loaded'` and `is_stale = true`, the Exclusion Screening
-- admin surface still reads that view, and the decision of whether this product screens against
-- SAM at all remains an open product question rather than a resolved one. What changes is only
-- which of those two surfaces is allowed to page a person every 15 minutes.
--
-- NOT ADDRESSED HERE, deliberately: the LEIE snapshot on production is itself stale (activated
-- 2026-07-12 against a 45-day `stale_after`) because the 2026-08-12 monthly refresh stranded
-- mid-run. Staleness is a real finding, it is reported by exclusion_source_health, and it is
-- tracked in BACKLOG.md -- but adding a staleness invariant to THIS job in the same change that
-- unsticks it would put it straight back to permanently red, which is the condition this
-- migration exists to end.
--
-- BLAST RADIUS. One predicate inside one SECURITY DEFINER function. The function's signature,
-- return type, grants and every other counter are untouched, so nothing that reads it changes
-- shape.
--
-- Rollback: restore the predicate from 20260711162509.

create or replace function public.run_phase1_synthetic_checks()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'completedAssignmentsWithoutCertificate', (
      select count(*) from public.course_assignments ca
      left join public.certificates c on c.course_assignment_id = ca.id
      where ca.status = 'completed' and c.id is null
    ),
    'certificatePdfJobsExhausted', (
      select count(*) from public.certificate_pdf_jobs j
      where j.status = 'failed' and j.attempt_count >= j.max_attempts
    ),
    'notificationOutcomesUnknown', (
      select count(*) from public.notification_deliveries n where n.final_outcome = 'unknown'
    ),
    -- `last_status <> 'not_loaded'` is the whole of this migration: a source this deployment has
    -- never configured is not missing a snapshot, it is absent by choice, and it is reported as
    -- 'not_loaded' by public.exclusion_source_health where that belongs. Every failure mode the
    -- counter exists for still lands here, because all of them leave a last_status of 'failed',
    -- 'staging' or 'succeeded'.
    'exclusionSourcesWithoutActiveSnapshot', (
      select count(*) from public.exclusion_source_state s
      where s.active_snapshot_id is null
        and s.last_status is distinct from 'not_loaded'
    ),
    'auditIntegrityIssuesOpen', (
      select count(*) from app_private.audit_integrity_issues i where i.resolved_at is null
    ),
    'auditTriggerGaps', (
      select count(*)
      from app_private.audit_entity_manifest m
      where m.audit_mode = 'row_trigger'
        and not exists (
          select 1
          from pg_catalog.pg_trigger tr
          join pg_catalog.pg_proc p on p.oid = tr.tgfoid
          where tr.tgrelid = pg_catalog.to_regclass(
            pg_catalog.format('%I.%I', m.table_schema, m.table_name)
          )
            and not tr.tgisinternal
            and p.proname = 'audit_log_trigger'
        )
    ),
    'checkedAt', now()
  ) into v_result;

  return v_result;
end;
$function$;

comment on function public.run_phase1_synthetic_checks() is
  'Phase 1 integrity invariants, read every 15 minutes by the phase1-synthetic-health system job. Every counter here must describe a DEFECT, never a configuration choice: this job pages, and a counter that can never reach zero on a correctly configured deployment makes the whole job unreadable. exclusionSourcesWithoutActiveSnapshot excludes never-loaded sources for exactly that reason (20260904030000).';
