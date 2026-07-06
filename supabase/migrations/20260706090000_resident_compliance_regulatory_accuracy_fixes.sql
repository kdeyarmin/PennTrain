-- Tier 3.6 Phase 1: regulatory-accuracy pass on Tier 3.5's resident compliance-date registry.
-- Fixes bugs its own migration comments flagged as unverified placeholders, verified directly
-- against 55 Pa Code and PA DHS's own Regulatory Compliance Guides (see plan doc for citations).

-- Grace-period support: PCH annual reassessment gets 12 months + a 15-day grace (~380 days total,
-- confirmed via the 2600 RCG's general Grace Periods table, which lists resident assessments as
-- covered and does not list 2600.225 among the excluded sections). Every other item type is
-- zero-grace, including medical_evaluation's annual cycle -- its grace period was only confirmed
-- for the ALR (2800) RCG, not re-verified for PCH's 2600 RCG, so it stays conservative at 0 until
-- confirmed (see plan's Open Items).
alter table public.resident_compliance_items add column grace_period_days integer not null default 0;
update public.resident_compliance_items set grace_period_days = 15 where item_type = 'annual_reassessment';

-- significant_change_reassessment: DHS states no numeric turnaround for this trigger anywhere in
-- the regulation text or the RCG's own discussion of it -- an earlier research pass's "5 calendar
-- days" figure did not survive a direct re-check of the source it was attributed to. Rather than
-- assert a fake regulatory deadline, this item type is due immediately (the date it's logged) with
-- zero grace, so it always surfaces on the dashboard/alerts without misrepresenting what DHS
-- actually requires.
alter table public.resident_compliance_items drop constraint resident_compliance_items_item_type_check;
alter table public.resident_compliance_items add constraint resident_compliance_items_item_type_check
  check (item_type in (
    'preadmission_screening', 'initial_assessment_15day', 'support_plan_30day',
    'annual_reassessment', 'medical_evaluation', 'significant_change_reassessment'
  ));

comment on column public.resident_compliance_items.grace_period_days is
  'Days past due_date before status flips to expired. 15 for annual_reassessment (confirmed via '
  '2600 RCG general Grace Periods table); 0 for every zero-grace item type. medical_evaluation '
  'stays 0 pending confirmation of the PCH-side (2600.141) RCG grace language.';

-- Full rewrite of instantiate_resident_compliance_items() -- adds a facility-type guard (stops
-- NH/HHA/HOS/GH residents from getting bogus PCH-shaped items ahead of Phase 5's real rule-pack;
-- ALR residents still get PCH-shaped after-admission sequencing until Phase 5 lands, a known
-- temporary approximation) and fixes the medical_evaluation initial-due-date bug: it was
-- `admission_date + 365` (reusing the *renewal* interval as the *initial* due date), so a brand-new
-- resident's DME could go undetected as missing for a full year. Per 2600.141 the initial DME is
-- due 60 days before or 30 days after admission -- corrected to `admission_date + 30`, the outer
-- edge of that window (a DME completed earlier than that is already covered once uploaded).
create or replace function public.instantiate_resident_compliance_items(p_resident_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_res record; v_facility_type text;
begin
  select id, organization_id, facility_id, admission_date into v_res from public.residents where id = p_resident_id;
  if v_res.id is null then
    return;
  end if;

  select facility_type into v_facility_type from public.facilities where id = v_res.facility_id;
  if v_facility_type not in ('PCH', 'ALR') then
    return;
  end if;

  insert into public.resident_compliance_items
    (organization_id, facility_id, resident_id, item_type, due_date, renewal_interval_days, warning_days, grace_period_days)
  values
    (v_res.organization_id, v_res.facility_id, v_res.id, 'preadmission_screening', v_res.admission_date, null, 7, 0),
    (v_res.organization_id, v_res.facility_id, v_res.id, 'initial_assessment_15day', v_res.admission_date + 15, null, 7, 0),
    (v_res.organization_id, v_res.facility_id, v_res.id, 'support_plan_30day', v_res.admission_date + 30, null, 14, 0),
    (v_res.organization_id, v_res.facility_id, v_res.id, 'annual_reassessment', v_res.admission_date + 365, 365, 30, 15),
    (v_res.organization_id, v_res.facility_id, v_res.id, 'medical_evaluation', v_res.admission_date + 30, 365, 30, 0);
end;
$$;
revoke all on function public.instantiate_resident_compliance_items(uuid) from public, anon, authenticated;

-- Full rewrite of recalculate_resident_compliance_statuses(): expired now checks
-- due_date + grace_period_days, not due_date -- due_soon stays keyed off the hard due_date (best
-- practice is "complete by the real deadline," not "coast into the grace window").
create or replace function public.recalculate_resident_compliance_statuses()
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  update public.resident_compliance_items
  set status = case
    when status = 'not_applicable' then status
    when completed_date is not null then 'compliant'
    when due_date is null then 'missing'
    when due_date + grace_period_days < current_date then 'expired'
    when due_date <= current_date + warning_days then 'due_soon'
    else 'missing'
  end
  where status <> 'not_applicable';
end;
$$;
revoke all on function public.recalculate_resident_compliance_statuses() from public, anon, authenticated;

-- Citation-topic split: preadmission screening is really 2600.224 and the support plan is really
-- 2600.227 -- Tier 3.5 conflated both under the "Resident Assessments" (2600.225) topic. Split them
-- out into their own dhs_citation_topics rows and re-point the auto-tag trigger. Categories must be
-- unique (dhs_citation_topics.category has a unique constraint).
insert into public.dhs_citation_topics (chapter, citation_ref, category, title, frequency_weight, notes, sort_order) values
  ('2600', '2600.224', 'Resident Preadmission Screening', 'Resident Preadmission Screening', 1.2,
   'Verified: 55 Pa Code 2600.224, preadmission screening within 30 days prior to admission, zero grace period.', 155),
  ('2600', '2600.227', 'Resident Support Plans', 'Resident Support Plan Development & Revision', 1.2,
   'Verified: 55 Pa Code 2600.227, support plan within 30 days of admission; revised within 30 days '
   'of completing the annual assessment or upon a significant-change reassessment.', 165);

update public.resident_compliance_items rci set citation_topic_id = ct.id
from public.dhs_citation_topics ct
where ct.category = 'Resident Preadmission Screening' and rci.item_type = 'preadmission_screening';

update public.resident_compliance_items rci set citation_topic_id = ct.id
from public.dhs_citation_topics ct
where ct.category = 'Resident Support Plans' and rci.item_type = 'support_plan_30day';

create or replace function public.auto_tag_resident_compliance_item_citation_topic()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.citation_topic_id is null then
    if new.item_type = 'medical_evaluation' then
      select id into new.citation_topic_id from public.dhs_citation_topics where category = 'Resident Medical Evaluations';
    elsif new.item_type = 'preadmission_screening' then
      select id into new.citation_topic_id from public.dhs_citation_topics where category = 'Resident Preadmission Screening';
    elsif new.item_type = 'support_plan_30day' then
      select id into new.citation_topic_id from public.dhs_citation_topics where category = 'Resident Support Plans';
    else
      -- initial_assessment_15day, annual_reassessment, significant_change_reassessment all fall
      -- under 2600.225 "Initial and annual assessment" (which also covers the significant-change
      -- trigger in its own subsection).
      select id into new.citation_topic_id from public.dhs_citation_topics where category = 'Resident Assessments';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.auto_tag_resident_compliance_item_citation_topic() from public, anon, authenticated;
-- get_facility_readiness_breakdown() needs no changes -- it already groups generically by
-- whatever citation_topic_id is present on each resident_compliance_items row.
