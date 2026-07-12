-- Closes the exact gap ROADMAP.md cites as this tier's rationale: "Resident assessments (#9) and
-- medical evaluations (#10) are the largest citation surface the product doesn't touch" -- both
-- previously listed as "Absent (resident-side)" in the citation-frequency table. Wires
-- resident_compliance_items into the same citation-weighted readiness score built in Tier 3.1
-- (dhs_citation_topics / get_facility_readiness_breakdown), mirroring that migration's
-- auto-tag-on-insert convention exactly.
insert into public.dhs_citation_topics (chapter, citation_ref, category, title, frequency_weight, notes, sort_order) values
  ('2600', '2600.225', 'Resident Assessments', 'Resident Assessment & Support Plan Deadlines', 1.2, 'Configurable default weight; section number approximate -- verify against current regulations.', 160),
  ('2600', '2600.141', 'Resident Medical Evaluations', 'Resident Medical Evaluation Cycle', 1.15, 'Configurable default weight; section number approximate -- verify against current regulations.', 170);

alter table public.resident_compliance_items add column citation_topic_id uuid references public.dhs_citation_topics(id);

update public.resident_compliance_items rci set citation_topic_id = ct.id
from public.dhs_citation_topics ct
where rci.citation_topic_id is null
  and (
    (rci.item_type = 'medical_evaluation' and ct.category = 'Resident Medical Evaluations')
    or (rci.item_type <> 'medical_evaluation' and ct.category = 'Resident Assessments')
  );

create or replace function public.auto_tag_resident_compliance_item_citation_topic()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.citation_topic_id is null then
    if new.item_type = 'medical_evaluation' then
      select id into new.citation_topic_id from public.dhs_citation_topics where category = 'Resident Medical Evaluations';
    else
      select id into new.citation_topic_id from public.dhs_citation_topics where category = 'Resident Assessments';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.auto_tag_resident_compliance_item_citation_topic() from public, anon, authenticated;
create trigger trg_auto_tag_resident_compliance_item_citation_topic
  before insert on public.resident_compliance_items
  for each row execute function public.auto_tag_resident_compliance_item_citation_topic();

create or replace function public.get_facility_readiness_breakdown(p_facility_id uuid)
returns table (
  citation_topic_id uuid,
  chapter text,
  citation_ref text,
  category text,
  title text,
  frequency_weight numeric,
  compliant_count bigint,
  total_count bigint
) language sql stable set search_path to 'public' as $$
  with training as (
    select tt.citation_topic_id,
           count(*) filter (where r.status = 'compliant') as compliant,
           count(*) filter (where r.status <> 'not_applicable') as total
    from public.employee_training_records r
    join public.training_types tt on tt.id = r.training_type_id
    where r.facility_id = p_facility_id
    group by tt.citation_topic_id
  ),
  credentials as (
    select ec.citation_topic_id,
           count(*) filter (where ec.status = 'compliant') as compliant,
           count(*) filter (where ec.status <> 'not_applicable') as total
    from public.employee_credentials ec
    where ec.facility_id = p_facility_id
    group by ec.citation_topic_id
  ),
  inspections as (
    select ii.citation_topic_id,
           count(*) filter (where ii.status = 'compliant') as compliant,
           count(*) filter (where ii.status <> 'not_applicable') as total
    from public.inspection_items ii
    where ii.facility_id = p_facility_id and ii.is_active
    group by ii.citation_topic_id
  ),
  resident_compliance as (
    select rci.citation_topic_id,
           count(*) filter (where rci.status = 'compliant') as compliant,
           count(*) filter (where rci.status <> 'not_applicable') as total
    from public.resident_compliance_items rci
    where rci.facility_id = p_facility_id
    group by rci.citation_topic_id
  ),
  combined as (
    select * from training
    union all select * from credentials
    union all select * from inspections
    union all select * from resident_compliance
  ),
  agg as (
    select citation_topic_id, sum(compliant) as compliant_count, sum(total) as total_count
    from combined
    group by citation_topic_id
  )
  select ct.id, ct.chapter, ct.citation_ref, ct.category, ct.title, ct.frequency_weight,
         coalesce(a.compliant_count, 0), coalesce(a.total_count, 0)
  from public.dhs_citation_topics ct
  left join agg a on a.citation_topic_id = ct.id
  order by ct.sort_order;
$$;
revoke all on function public.get_facility_readiness_breakdown(uuid) from public, anon;
grant execute on function public.get_facility_readiness_breakdown(uuid) to authenticated;
