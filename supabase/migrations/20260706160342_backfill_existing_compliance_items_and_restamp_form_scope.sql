-- Tier 3.6 Phase 6 follow-up: backfill existing resident_compliance_items rows created before the
-- rule-pack (Phase 5) existed, so they carry the correct citation_topic_id/grace_period_days/etc.
-- Only touches the earliest not-yet-completed row per (resident_id, item_type) for due_date, since
-- later cycles' due_date was already computed correctly by complete_resident_compliance_item().
with ranked as (
  select
    rci.id,
    rci.resident_id,
    rci.item_type,
    r.admission_track,
    f.facility_type,
    row_number() over (partition by rci.resident_id, rci.item_type order by rci.due_date asc nulls last, rci.created_at asc) as rn
  from public.resident_compliance_items rci
  join public.residents r on r.id = rci.resident_id
  join public.facilities f on f.id = r.facility_id
  where rci.completed_date is null
),
matched as (
  select
    ranked.id,
    ranked.rn,
    rp.offset_basis,
    rp.offset_days,
    rp.renewal_interval_days,
    rp.grace_period_days,
    rp.warning_days,
    ct.id as citation_topic_id,
    r2.admission_date
  from ranked
  join public.residents r2 on r2.id = ranked.resident_id
  join public.resident_compliance_rule_packs rp
    on rp.facility_type = ranked.facility_type
   and rp.item_type = ranked.item_type
   and rp.admission_track = ranked.admission_track
   and rp.state = 'PA'
   and rp.is_active
  left join public.dhs_citation_topics ct on ct.citation_ref = rp.citation_ref
)
update public.resident_compliance_items rci
set
  due_date = case when matched.rn = 1 then
    case when matched.offset_basis = 'before_admission'
      then matched.admission_date - matched.offset_days
      else matched.admission_date + matched.offset_days
    end
    else rci.due_date
  end,
  renewal_interval_days = matched.renewal_interval_days,
  grace_period_days = matched.grace_period_days,
  warning_days = matched.warning_days,
  citation_topic_id = coalesce(matched.citation_topic_id, rci.citation_topic_id)
from matched
where rci.id = matched.id;

create trigger stamp_scope_on_resident_change before update of resident_id on public.resident_assessment_forms
  for each row execute function public.stamp_scope_from_resident();
