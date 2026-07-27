-- The manifest says the resident clinical chart holds no regulated data, and cites a classification
-- that was never performed.
--
-- 20260726260000 closed the gap where tables were missing from app_private.audit_entity_manifest
-- entirely. It inserted a row per table, deriving audit_mode from whether the table already carried
-- an audit_log_trigger, and it wrote the literal `false` into contains_regulated_data for every
-- single row. Then it wrote one of two rationale strings:
--
--   with a trigger:     'Row audit trigger already present; classified from that evidence by 20260726260000'
--   without a trigger:  'Added after the Phase 1 manifest snapshot and not yet classified (20260726260000)'
--
-- The second sentence is true. The first is not. Nothing about that statement classified regulated
-- content -- the flag is a hardcoded literal in the SELECT list, one line above the CASE that writes
-- the sentence claiming it was decided. The half that admitted it was undecided went into the backlog
-- and has been worked twice since (20260726270000, 20260727080000). The half that claimed a finding
-- has never been looked at again, because it does not read like an open question.
--
-- The tables it caught are the ones added AFTER the Phase 1 snapshot -- which is to say the newest and
-- most sensitive part of the product. All 32 rows carrying that sentence are still flagged false, and
-- 21 of them are reachable from a resident or an employee by foreign key:
--
--   clinical_observations          vitals and structured observations
--   clinical_progress_notes        progress notes
--   clinical_care_plans            care plans
--   clinical_care_plan_goals       goals within them
--   clinical_assessments           clinical assessments
--   resident_legal_records         guardianship, power of attorney
--   resident_contacts              next of kin and designated persons
--   resident_property_items        the personal property inventory 55 Pa. Code Chapter 2800 requires
--   resident_evacuation_profiles   who needs what help to get out of the building
--   emergency_event_residents      which residents were moved, and where to
--   emergency_event_staff, emergency_event_actions, emergency_event_timeline, emergency_events,
--   emergency_communications, emergency_after_action_reviews, emergency_staff_assignments
--   survey_day_observations, work_orders, maintenance_documents, preventive_maintenance_schedules
--
-- docs/HIPAA_CLINICAL_DATA.md describes the clinical lane as first-class and deliberately built. The
-- compliance manifest describes it as holding nothing regulated.
--
-- WHAT THIS DOES NOT CHANGE. Retention: retention_days was derived from this flag once, by
-- 20260711162509, and every one of these 32 rows already sits at the 2555-day default because they
-- were created after that backfill ran. Nothing recomputes retention from the flag, so no row's
-- retention moves here -- checked rather than assumed, since flipping a flag that had once driven a
-- retention schedule is exactly the kind of thing that quietly re-derives one. audit_mode is
-- untouched, for the reason it has been untouched twice before: it is a compliance judgement with a
-- real write cost, and this is metadata.
--
-- WHAT IT DELIBERATELY LEAVES ALONE. Thirteen more tables inside the same closure are flagged false
-- with the rationale 'Classified during Phase 1 audit coverage review' -- the training and quiz
-- records, class_checkin_tokens, competency_record_items and incident_staff_involved. Those were
-- decided by a person. Overriding a judgement someone made is a different act from filling in one
-- that was never made, and it needs the reason the judgement was made, which is not in the row. They
-- are named in the companion test's exemption list instead, so they are visible rather than silently
-- outside the rule.
--
-- MY OWN PREVIOUS MIGRATION HAD THE SAME BLIND SPOT. 20260727080000 walked the full foreign-key
-- closure but scoped itself to `audit_mode = 'unclassified'`, inherited unexamined from the migration
-- before it. That scope is right for prioritising a backlog and wrong for a column that records what
-- a table holds: a table with a row audit trigger is not thereby free of regulated data. Dropping the
-- restriction is what surfaced these.
--
-- Rollback: set contains_regulated_data = false where rationale mentions 20260727100000, and restore
-- the original sentence.

-- The 21 inside the closure: flag them, and replace the sentence that claimed they were classified.
update app_private.audit_entity_manifest m set
  contains_regulated_data = true,
  rationale = replace(
      m.rationale,
      'Row audit trigger already present; classified from that evidence by 20260726260000',
      'Audit mode inferred from an existing row audit trigger by 20260726260000, which did not'
      || ' classify regulated content'
    ) || ' | Reachable from residents/employees by foreign key (transitive evidence, 20260727100000)',
  updated_at = now()
where not m.contains_regulated_data
  and m.rationale like '%classified from that evidence by 20260726260000%'
  and m.table_name in (
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
  );

-- The remaining 11 stay false -- nothing reaches them from a data subject -- but they stop claiming a
-- classification nobody made, so the next reader can tell an unexamined default from a decision.
update app_private.audit_entity_manifest m set
  rationale = replace(
      m.rationale,
      'Row audit trigger already present; classified from that evidence by 20260726260000',
      'Audit mode inferred from an existing row audit trigger by 20260726260000, which did not'
      || ' classify regulated content; not reachable from a resident or employee (20260727100000)'
    ),
  updated_at = now()
where m.rationale like '%classified from that evidence by 20260726260000%';
