-- The regulated-data flag saw one foreign key hop, and said so as though it saw all of them.
--
-- 20260726270000 flagged every unclassified table with a foreign key to public.residents or
-- public.employees, and its header called the evidence "mechanical, not a judgement" -- true of what
-- it checked, and misleading about what it did not. It checked ONE hop. Twenty tables hold records
-- keyed to a resident or an employee and were left unflagged, including:
--
--   clinical_observation_amendments      -> clinical_observations   -> residents
--   clinical_progress_note_versions      -> clinical_progress_notes -> residents
--   resident_change_event_history        -> resident_change_events  -> residents
--   resident_change_follow_ups           -> resident_change_events  -> residents
--   resident_change_monitoring_entries   -> resident_change_events  -> residents
--   complaint_interviews                 -> complaints              -> residents
--   complaint_corrective_actions         -> complaints              -> residents
--   complaint_monitoring_entries         -> complaints              -> residents
--   complaint_history                    -> complaints              -> residents
--
-- Amendments to clinical observations, versions of progress notes, the monitoring entries behind a
-- change of condition, and the interview and corrective-action record of a resident complaint. These
-- are the rows a 55 Pa. Code Chapter 2800 complaint investigation is made of, and the backlog report
-- listed them next to colour-palette lookups.
--
-- THE DEPTH WAS CHOSEN BY MEASUREMENT, not by picking a bigger number. The original rule stopped at
-- one hop because going further looked like it would flag the entire schema, which "carries exactly
-- as much information as flagging none of it" -- that reasoning was sound and the premise was never
-- checked. Following every foreign key from residents and employees until it stops:
--
--     depth 1: 144 tables   depth 2: 180   depth 3: 187   depth 4: 188   depth 5: 190, then closed
--
-- 190 of 414. The closure converges at under half the schema, so it discriminates. Had it come out
-- at 400 the original instinct would have been right and this migration would not exist.
--
-- POLYMORPHIC REFERENCES ARE INVISIBLE TO ALL OF THAT. compliance_copilot_runs and
-- workflow_automation_runs carry a subject_type/subject_id pair with no foreign key at all, and the
-- values the product writes into subject_type include 'resident' and 'employee'. No amount of
-- foreign-key walking finds them; they are named explicitly, with their own rationale string, so a
-- reader can tell the two kinds of evidence apart.
--
-- STILL NOT DOING: setting audit_mode. That remains a compliance judgement with a real write-cost --
-- audit_log_trigger fires on every insert, update and delete -- and 20 more of those made
-- mechanically would be 20 more guesses. contains_regulated_data is metadata; it costs nothing and
-- cannot break a write path. The backlog report just stops understating itself.
--
-- Rollback: set contains_regulated_data = false where rationale matches either string below.

update app_private.audit_entity_manifest m set
  contains_regulated_data = true,
  rationale = m.rationale || ' | Reachable from residents/employees by foreign key (transitive'
              || ' evidence, 20260727080000)',
  updated_at = now()
where m.audit_mode = 'unclassified'
  and not m.contains_regulated_data
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

update app_private.audit_entity_manifest m set
  contains_regulated_data = true,
  rationale = m.rationale || ' | Polymorphic subject_type/subject_id reference admitting resident'
              || ' and employee subjects (20260727080000)',
  updated_at = now()
where m.audit_mode = 'unclassified'
  and not m.contains_regulated_data
  and m.table_name in ('compliance_copilot_runs', 'workflow_automation_runs');
