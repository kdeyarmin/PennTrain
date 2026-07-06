-- Further fixes for PR #36 review findings from Codex, on the sixth fix migration (round 10).
--
-- Finding W (Codex P1): every fix in this PR to instantiate_resident_compliance_items() (the
-- medical_evaluation +365->+30 due-date bug, ALR facility-type awareness, grace periods, corrected
-- citation topics) only takes effect for residents inserted AFTER these migrations apply. Any
-- resident_compliance_items rows already seeded under Tier 3.5's original instantiator (before this
-- PR) keep their old, wrong values -- an existing resident's medical_evaluation due date stays at
-- admission_date + 365, an existing ALR resident's items stay PCH-shaped, and every existing
-- annual_reassessment row's grace_period_days stayed at the column's blanket `default 0` (added by
-- this PR) since nothing ever backfilled it to the correct 15. Recompute these in place, using the
-- exact same rule-pack lookup instantiate_resident_compliance_items() itself now uses, scoped to:
--   * only the EARLIEST row per (resident_id, item_type) -- a later row for the same pairing is a
--     renewal cycle spawned by complete_resident_compliance_item(), whose due_date is legitimately
--     derived from that cycle's own completed_date, not from admission_date, and must not be
--     overwritten by an admission-date-based recompute;
--   * only rows not yet completed -- a completed item is a historical record, not a live deadline;
--   * only rows that actually match a current rule-pack row for their resident's facility_type/
--     admission_track/item_type. A resident whose facility_type+item_type combination has no
--     rule-pack row (e.g. a legacy ALR preadmission_screening item -- ALR never gets one under the
--     new rule pack) is deliberately left untouched here: silently deleting a tracked item a
--     resident already has is a data-cleanup decision that needs explicit review, not something an
--     automated migration should decide unilaterally.
with earliest_rows as (
  select distinct on (resident_id, item_type) id
  from public.resident_compliance_items
  order by resident_id, item_type, created_at asc
),
resident_rule_match as (
  select distinct on (rci.id)
    rci.id as item_id,
    r.admission_date,
    rp.offset_basis, rp.offset_days, rp.renewal_interval_days, rp.warning_days, rp.grace_period_days,
    (select ct.id from public.dhs_citation_topics ct where ct.citation_ref = rp.citation_ref) as citation_topic_id
  from public.resident_compliance_items rci
  join earliest_rows er on er.id = rci.id
  join public.residents r on r.id = rci.resident_id
  join public.facilities f on f.id = r.facility_id
  join public.resident_compliance_rule_packs rp
    on rp.facility_type = f.facility_type
   and rp.admission_track = r.admission_track
   and rp.item_type = rci.item_type
   and rp.state = 'PA'
   and rp.is_active
   and (rp.organization_id = r.organization_id or rp.organization_id is null)
  where rci.completed_date is null
  order by rci.id, (rp.organization_id is not null) desc
)
update public.resident_compliance_items rci
set
  due_date = case
    when m.offset_basis = 'before_admission' then m.admission_date - m.offset_days
    else m.admission_date + m.offset_days
  end,
  renewal_interval_days = m.renewal_interval_days,
  warning_days = m.warning_days,
  grace_period_days = m.grace_period_days,
  citation_topic_id = coalesce(m.citation_topic_id, rci.citation_topic_id)
from resident_rule_match m
where rci.id = m.item_id;

-- Finding X (Codex P2): stamp_scope_from_resident() only runs "before insert" on
-- resident_assessment_forms, so it derives organization_id/facility_id from resident_id exactly
-- once, at creation. The update RLS policy authorizes based solely on the row's OWN
-- organization_id/facility_id/status -- it never re-validates that resident_id still points at a
-- resident actually in that facility. A facility_manager assigned only to facility A could PATCH an
-- existing draft's resident_id to a resident in facility B (leaving facility_id = A, which still
-- satisfies the update policy's is_assigned_to_facility(facility_id) check), then finalize a form
-- that marks a compliance item belonging to a resident outside their assignment as compliant.
-- Rather than duplicate a resident/facility consistency check into the RLS policy (another special
-- case alongside the compliance-item validation this PR already had to consolidate once), re-run the
-- same stamp_scope_from_resident() trigger on any update that changes resident_id: Postgres
-- evaluates a row-level policy's WITH CHECK against the row *after* BEFORE-trigger changes, so
-- forcibly re-deriving organization_id/facility_id from the (possibly changed) resident_id here means
-- the update policy's is_assigned_to_facility() check is always evaluated against the resident's
-- true facility -- a caller not assigned to that facility gets rejected by the existing policy with
-- no new predicate needed.
create trigger stamp_scope_on_resident_change before update of resident_id on public.resident_assessment_forms
  for each row execute function public.stamp_scope_from_resident();
