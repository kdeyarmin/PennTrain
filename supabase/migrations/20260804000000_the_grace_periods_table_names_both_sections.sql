-- Closes the research question behind both grace-period pending_confirmation rows 20260706155617
-- left open, using a source that migration's research pass didn't reach: the PA DHS Regulatory
-- Compliance Guide's own "Grace Periods" table (p.5 of both the 2600 and 2800 RCGs), which names
-- every section it covers by number rather than describing them generically. 2800.225's confirmed
-- figure is applied below. 2600.141's is recorded but deliberately NOT applied to
-- grace_period_days -- see that statement's own comment for why.
--
-- 2600 RCG (Personal_Care_Home-2600_Regulatory_Compliance_Guide_RCG.pdf, pa.gov), p.5,
-- "Grace Periods": "A 15-day flex or grace period is allowed for any item that has a time
-- requirement of one year or more. This includes, but is not limited to: * Medical evaluations
-- (2600.141) * ... * Completion of ANNUAL Resident Assessments (2600.225(c)(1))". The same
-- page's "does NOT apply" list separately carves out only "2600.141(a) - Initial medical
-- evaluations" -- confirming the grace is for the ANNUAL cycle at 2600.141(b)(1), not the
-- initial admission window (which 20260706155617 already correctly left at zero grace). p.118,
-- the guide's own discussion of 2600.141(b)(1), restates the identical figure directly: "the
-- Department allows a 15-day grace period for completion of the annual evaluation, so annually
-- actually means within 12 months and 15 days of the most recent medical evaluation."
--
-- 2800 RCG (Assisted_Living_Residences-2800_Regulatory_Compliance_Guide_RCG.pdf, pa.gov), p.5,
-- the identical "Grace Periods" table: "...Completion of ANNUAL Resident Assessments
-- (2800.225(a)(1))" is named in the same 15-day list, and the "does NOT apply" list separately
-- carves out only "2800.225(a) - Initial assessments" -- same initial-vs-annual split as 2600.
-- This is the same evidentiary bar (a section named directly in the general Grace Periods table)
-- 20260706155617 already accepted as "confirmed" for 2600.225's own annual cycle and for
-- 2800.141's annual cycle; 2800.225's annual cycle was left pending only because that research
-- pass checked the section-specific discussion and not this table.
--
-- Both PDFs are DHS's own current publications, linked from pa.gov, and are the exact documents
-- resident_compliance_rule_packs.notes already names as "the 2600 RCG" / "the 2800 RCG" for
-- every other confirmed row in this table -- this is the same source, not a new one.

-- NOT setting grace_period_days = 15 here despite confirming the figure below. This rule-pack row
-- is the ONLY medical_evaluation row PCH has -- unlike the assessment items, which already split
-- the initial occurrence (initial_assessment_15day) from the annual one (annual_reassessment) into
-- separate item_types/rows, medical_evaluation has never had that split. instantiate_resident_-
-- compliance_items() (20260706155928) copies this single grace_period_days value onto the INITIAL
-- evaluation item (due admission_date + 30), and complete_resident_compliance_item()
-- (20260706143049, redefined since) copies whatever grace_period_days the just-completed row
-- carried onto every annual successor it inserts. So one grace value covers both cycles, and this
-- migration's own cited source explicitly excludes the initial cycle from the 15-day grace
-- (2600.141(a), same p.5 "does NOT apply" list the annual figure comes from) -- setting it here
-- would silently hand a real initial-cycle violation 15 days of cover it is not entitled to.
-- Recording the confirmed annual figure in notes only; applying it needs medical_evaluation split
-- into separate initial/annual item_types first, tracked as F9 in BACKLOG.md.
update public.resident_compliance_rule_packs
set notes = 'Annual-cycle grace period CONFIRMED at 15 days: PA DHS 2600 RCG (Personal_Care_Home-2600_Regulatory_Compliance_Guide_RCG.pdf), '
      'p.5 Grace Periods table names "Medical evaluations (2600.141)" in the 15-day list, and p.118''s '
      'discussion of 2600.141(b)(1) restates the figure directly. The "does NOT apply" list on the same '
      'p.5 separately carves out only "2600.141(a) - Initial medical evaluations." NOT applied to '
      'grace_period_days: this row is shared between the initial evaluation and every annual renewal '
      '(see migration comment above), so applying it here would grant the initial cycle the same 15 '
      'days the source explicitly excludes it from. Stays at its existing conservative 0 until F9 '
      '(BACKLOG.md) splits medical_evaluation into separate initial/annual item_types.'
where facility_type = 'PCH' and item_type = 'medical_evaluation' and citation_ref = '2600.141'
  and organization_id is null;

update public.resident_compliance_rule_packs
set grace_period_days = 15,
    notes = '15-day grace confirmed: PA DHS 2800 RCG (Assisted_Living_Residences-2800_Regulatory_Compliance_Guide_RCG.pdf), '
      'p.5 Grace Periods table names "Completion of ANNUAL Resident Assessments (2800.225(a)(1))" in the '
      '15-day list -- the same evidentiary standard already accepted for 2600.225 and 2800.141 in this '
      'table. The "does NOT apply" list on the same p.5 separately carves out only "2800.225(a) - Initial '
      'assessments," confirming this grace applies to the annual/significant-change cycle, not the initial '
      'assessment (which stays zero grace).'
where facility_type = 'ALR' and item_type = 'annual_reassessment' and citation_ref = '2800.225'
  and organization_id is null;

-- annual_reassessment has no initial/annual collision -- the initial resident assessment is
-- already a separate item_type (initial_assessment_15day, untouched here), so every
-- annual_reassessment row, existing or future, really is an annual cycle and can safely take the
-- grace uniformly. Backfill already-instantiated rows seeded at the old conservative default
-- before this confirmation. This only ever relaxes a status (moves due_date + grace forward),
-- never tightens one -- it cannot newly hide a real violation, only stop misreporting an item
-- that is compliant-within-grace as expired. instantiate_resident_compliance_items
-- (20260706155928) reads grace_period_days from the rule pack at insert time rather than joining
-- live, so already-instantiated rows do not pick up the update above on their own.
update public.resident_compliance_items
set grace_period_days = 15
where item_type = 'annual_reassessment' and grace_period_days = 0;

update public.dhs_citation_topics
set notes = 'Verified: 55 Pa Code 2800.225. Annual-cycle grace period confirmed at 15 days via the '
  '2800 RCG''s Grace Periods table (p.5), which names 2800.225(a)(1) directly -- see '
  'resident_compliance_rule_packs for the full citation.'
where chapter = '2800' and citation_ref = '2800.225';
