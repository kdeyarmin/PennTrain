-- Extends the prior migration's backfill to ALL not-yet-completed rows (not just the earliest) for
-- renewal_interval_days/warning_days/grace_period_days/citation_topic_id -- due_date stays
-- earliest-only (recurring rows' due_date was already computed correctly at insert time).
with ranked as (
  select
    rci.id,
    rci.resident_id,
    rci.item_type,
    r.admission_track,
    f.facility_type,
    row_number() over (partition by rci.resident_id, rci.item_type order by rci.due_date asc nulls last, rci.created_at asc) = 1 as is_earliest
  from public.resident_compliance_items rci
  join public.residents r on r.id = rci.resident_id
  join public.facilities f on f.id = r.facility_id
  where rci.completed_date is null
),
matched as (
  select
    ranked.id,
    ranked.is_earliest,
    rp.renewal_interval_days,
    rp.grace_period_days,
    rp.warning_days,
    ct.id as citation_topic_id
  from ranked
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
  renewal_interval_days = matched.renewal_interval_days,
  grace_period_days = matched.grace_period_days,
  warning_days = matched.warning_days,
  citation_topic_id = coalesce(matched.citation_topic_id, rci.citation_topic_id)
from matched
where rci.id = matched.id;

create trigger stamp_scope_on_resident_change before update of resident_id on public.resident_informal_supports
  for each row execute function public.stamp_scope_from_resident();
