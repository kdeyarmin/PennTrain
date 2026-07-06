-- Further fixes for PR #36 review findings from Codex, on the seventh fix migration (round 11).
--
-- Finding Y (Codex P1): the backfill in 20260706100800 only matched the EARLIEST row per
-- (resident_id, item_type) -- correct for due_date (a renewal row's due_date is legitimately derived
-- from its own completed_date + renewal_interval_days, not from admission_date, and must not be
-- recomputed), but wrong for the other rule-pack-derived fields. complete_resident_compliance_item()'s
-- renewal insert copies renewal_interval_days/warning_days/grace_period_days straight from the item
-- it just completed, so if that completed item was itself wrong (e.g. an ALR resident's item still
-- carrying PCH-shaped values, or any pre-Phase-1 item stuck at the grace_period_days column's blanket
-- default of 0), every renewal cycle since has perpetuated the same wrong metadata -- and because
-- the earlier backfill's join was restricted to the earliest row's id, none of those live renewal
-- rows were ever touched. Split the two: recompute due_date only for the earliest not-yet-completed
-- row (unchanged from before), but recompute renewal_interval_days/warning_days/grace_period_days/
-- citation_topic_id for EVERY not-yet-completed row that matches a rule-pack entry, regardless of
-- whether it's the first cycle or a later renewal.
with earliest_rows as (
  select distinct on (resident_id, item_type) id
  from public.resident_compliance_items
  order by resident_id, item_type, created_at asc
),
resident_rule_match as (
  select distinct on (rci.id)
    rci.id as item_id,
    r.admission_date,
    (er.id = rci.id) as is_earliest,
    rp.offset_basis, rp.offset_days, rp.renewal_interval_days, rp.warning_days, rp.grace_period_days,
    (select ct.id from public.dhs_citation_topics ct where ct.citation_ref = rp.citation_ref) as citation_topic_id
  from public.resident_compliance_items rci
  join public.residents r on r.id = rci.resident_id
  join public.facilities f on f.id = r.facility_id
  left join earliest_rows er on er.id = rci.id
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
    when m.is_earliest then (
      case when m.offset_basis = 'before_admission' then m.admission_date - m.offset_days else m.admission_date + m.offset_days end
    )
    else rci.due_date
  end,
  renewal_interval_days = m.renewal_interval_days,
  warning_days = m.warning_days,
  grace_period_days = m.grace_period_days,
  citation_topic_id = coalesce(m.citation_topic_id, rci.citation_topic_id)
from resident_rule_match m
where rci.id = m.item_id;

-- Finding Z (Codex P2): stamp_scope_from_resident() is also only a before-insert trigger on
-- resident_informal_supports, and resident_informal_supports_update authorizes purely from the
-- row's own organization_id/facility_id -- the exact same gap just fixed for
-- resident_assessment_forms (20260706100800) applies here too: a facility_manager assigned to
-- facility A could PATCH an existing support row's resident_id to a resident in facility B while
-- leaving facility_id as A, attaching contact/support data (and, via the PDF generator, Part I
-- content) to an unrelated resident outside their assignment.
create trigger stamp_scope_on_resident_change before update of resident_id on public.resident_informal_supports
  for each row execute function public.stamp_scope_from_resident();
