-- One rule-pack row cannot carry two regulatory cycles (BACKLOG.md F9).
--
-- WHAT IS ACTUALLY WRONG, IN BOTH DIRECTIONS. `medical_evaluation` is a single item_type covering
-- two different regulatory requirements: the evaluation due at admission, and the annual one due
-- every twelve months after. It has one rule-pack row per facility type, and one
-- `grace_period_days` on it. `instantiate_resident_compliance_items()` copies that value onto the
-- initial item; `complete_resident_compliance_item()` copies whatever the completed row carried
-- onto every annual successor. So one number governs both cycles -- and the two facility types
-- have resolved that impossible choice in opposite directions:
--
--   * ALF (`facility_type = 'ALR'`) carries `grace_period_days = 15` on both tracks. This
--     repository's own note on those rows calls it a "15-day ANNUAL grace" -- and it is being
--     applied to the initial evaluation as well. Initial evaluations are treated as compliant for
--     15 days past their deadline. This is the permissive error, and it is the dangerous one.
--   * PCH carries 0, deliberately. `20260804000000` confirmed the annual figure at 15 days from
--     the 2600 RCG and refused to apply it precisely because of this sharing, leaving annual
--     evaluations flagged overdue 15 days before they actually are. That is the strict error: an
--     operational cost, not a compliance risk, and it says so in its own notes.
--
-- Neither is fixable while one row serves both cycles. This migration performs the split the
-- assessment items already have -- `initial_assessment_15day` and `annual_reassessment` are
-- separate item_types with separate rows and separate grace -- and gives medical evaluations the
-- same shape.
--
-- WHAT EACH CYCLE GETS, AND ON WHOSE AUTHORITY. Nothing here re-researches the regulation; both
-- figures are already recorded in this table with their sources.
--   * `medical_evaluation` keeps its meaning as the INITIAL evaluation, and gets grace 0 for both
--     facility types. For PCH that is unchanged. For ALF it removes 15 days the row's own note
--     describes as annual-cycle grace.
--   * `annual_medical_evaluation` is new, and takes the 15 days `20260804000000` confirmed for PCH
--     via the 2600 RCG and `20260706155617` recorded for ALF via the 2800 RCG. It is the row those
--     figures were always about.
--
-- WHY THE INITIAL ROW STOPS RENEWING ITSELF. `renewal_interval_days` goes null on the initial rows
-- because they no longer spawn their own successor: the redeclared completion function looks up the
-- annual rule pack instead. Leaving 365 there would be a second, contradictory source for the same
-- successor.
--
-- BACKFILL. Existing `medical_evaluation` items are split by position: a resident's earliest one is
-- the initial evaluation, and every later one is an annual renewal that the old code produced by
-- copying the initial's item_type forward. The later ones are retyped and take the annual grace;
-- the earliest keeps its type and drops to grace 0. This changes live compliance status for ALF
-- residents whose initial evaluation is between 1 and 15 days past due -- they move from compliant
-- to expired, which is what the regulation says they were the whole time.
--
-- Rollback: retype `annual_medical_evaluation` items back to `medical_evaluation`, restore the
-- rule-pack rows, and redeclare the completion function from 20260729120000.

-- ---------------------------------------------------------------------------
-- 1. The new item type
-- ---------------------------------------------------------------------------

alter table public.resident_compliance_items
  drop constraint if exists resident_compliance_items_item_type_check;
alter table public.resident_compliance_items
  add constraint resident_compliance_items_item_type_check check (item_type in (
    'preadmission_screening', 'initial_assessment_15day', 'support_plan_30day',
    'annual_reassessment', 'medical_evaluation', 'annual_medical_evaluation',
    'significant_change_reassessment'
  ));

alter table public.resident_compliance_rule_packs
  drop constraint if exists resident_compliance_rule_packs_item_type_check;
alter table public.resident_compliance_rule_packs
  add constraint resident_compliance_rule_packs_item_type_check check (item_type in (
    'preadmission_screening', 'initial_assessment_15day', 'support_plan_30day',
    'annual_reassessment', 'medical_evaluation', 'annual_medical_evaluation',
    'significant_change_reassessment'
  ));

-- ---------------------------------------------------------------------------
-- 2. Citation topics follow the item, not the word "annual"
-- ---------------------------------------------------------------------------
--
-- The existing trigger routes anything that is not one of four named types into the assessment
-- categories via its `else` branch. `annual_medical_evaluation` would land there and be filed under
-- reassessments. It is a medical evaluation and belongs with the other one.

create or replace function public.auto_tag_resident_compliance_item_citation_topic()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_facility_type text; v_category text;
begin
  if new.citation_topic_id is null then
    select facility_type into v_facility_type from public.facilities where id = new.facility_id;

    if new.item_type in ('medical_evaluation', 'annual_medical_evaluation') then
      v_category := case when v_facility_type = 'ALR' then 'ALR Medical Evaluations' else 'Resident Medical Evaluations' end;
    elsif new.item_type = 'preadmission_screening' then
      v_category := 'Resident Preadmission Screening';
    elsif new.item_type in ('support_plan_30day', 'initial_assessment_15day') then
      v_category := case
        when v_facility_type = 'ALR' then 'ALR Initial Assessment & Support Plan'
        when new.item_type = 'support_plan_30day' then 'Resident Support Plans'
        else 'Resident Assessments'
      end;
    else
      v_category := case when v_facility_type = 'ALR' then 'ALR Annual & Significant-Change Reassessment' else 'Resident Assessments' end;
    end if;

    select id into new.citation_topic_id from public.dhs_citation_topics where category = v_category;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Not every rule is an admission-time rule
-- ---------------------------------------------------------------------------
--
-- `instantiate_resident_compliance_items()` creates one item per active rule pack at admission,
-- anchoring each to `admission_date`. That is right for every existing item type, including
-- `annual_reassessment` -- 2600.225's annual cycle really does run from admission.
--
-- It is wrong for the annual medical evaluation. 2600.141(b)(1) is an anniversary of the *most
-- recent evaluation*, not of admission: the RCG's own wording is "within 12 months and 15 days of
-- the most recent medical evaluation." A resident admitted on the 1st whose initial evaluation
-- happens on the 25th owes the next one 12 months after the 25th. Anchoring it to admission would
-- make it due 24 days early, every year, forever.
--
-- So this row is created by completing the previous evaluation, not at admission -- and needs a way
-- to say so. An explicit column rather than overloading `is_active` (which means "this rule is in
-- force") or `offset_basis` (which describes the anchor, not whether there is one yet).

alter table public.resident_compliance_rule_packs
  add column if not exists instantiate_at_admission boolean not null default true;
comment on column public.resident_compliance_rule_packs.instantiate_at_admission is
  'False for cycles anchored to the completion of a previous item rather than to admission -- those rows are created by complete_resident_compliance_item(), not by instantiate_resident_compliance_items().';

create or replace function public.instantiate_resident_compliance_items(p_resident_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_res record; v_facility_type text; v_admission_track text; v_rule record;
begin
  select id, organization_id, facility_id, admission_date, admission_track into v_res
  from public.residents where id = p_resident_id;
  if v_res.id is null then
    return;
  end if;

  select facility_type into v_facility_type from public.facilities where id = v_res.facility_id;
  v_admission_track := case when v_facility_type = 'ALR' then v_res.admission_track else 'standard' end;

  for v_rule in
    select distinct on (item_type) *
    from public.resident_compliance_rule_packs
    where facility_type = v_facility_type
      and admission_track = v_admission_track
      and state = 'PA'
      and is_active
      -- CHANGE (20260804170000): the only line that differs from 20260706155928.
      and instantiate_at_admission
      and (organization_id = v_res.organization_id or organization_id is null)
    order by item_type, organization_id nulls last
  loop
    insert into public.resident_compliance_items
      (organization_id, facility_id, resident_id, item_type, due_date, renewal_interval_days, warning_days, grace_period_days, citation_topic_id)
    values (
      v_res.organization_id, v_res.facility_id, v_res.id, v_rule.item_type,
      case when v_rule.offset_basis = 'before_admission'
        then v_res.admission_date - v_rule.offset_days
        else v_res.admission_date + v_rule.offset_days
      end,
      v_rule.renewal_interval_days, v_rule.warning_days, v_rule.grace_period_days,
      (select id from public.dhs_citation_topics where citation_ref = v_rule.citation_ref)
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Rule packs: the initial cycle keeps the item type, the annual cycle gets its own
-- ---------------------------------------------------------------------------

insert into public.resident_compliance_rule_packs
  (organization_id, state, facility_type, item_type, admission_track, offset_basis, offset_days,
   renewal_interval_days, grace_period_days, warning_days, citation_ref, is_active, notes,
   instantiate_at_admission)
select
  rp.organization_id, rp.state, rp.facility_type, 'annual_medical_evaluation', rp.admission_track,
  'after_admission', 365, 365, 15, rp.warning_days, rp.citation_ref, rp.is_active,
  case rp.facility_type
    when 'PCH' then 'The annual cycle of 2600.141, split out from the initial evaluation by 20260804170000. '
      'Grace 15 days: PA DHS 2600 RCG p.5 Grace Periods table names "Medical evaluations (2600.141)" in the '
      '15-day list and p.118 restates it under 2600.141(b)(1); the same page''s exclusion list names only '
      '2600.141(a), the initial evaluation. That figure was confirmed by 20260804000000 and could not be '
      'applied until this row existed to carry it.'
    else 'The annual cycle of 2800.141, split out from the initial evaluation by 20260804170000. '
      'Grace 15 days, carried from the figure 20260706155617 recorded for this citation as a "15-day annual '
      'grace confirmed via the 2800 RCG" -- which had been sitting on the shared row and therefore also '
      'covering the initial evaluation it was never meant to.'
  end,
  false
from public.resident_compliance_rule_packs rp
where rp.item_type = 'medical_evaluation'
  and not exists (
    select 1 from public.resident_compliance_rule_packs existing
    where existing.item_type = 'annual_medical_evaluation'
      and existing.facility_type = rp.facility_type
      and existing.admission_track = rp.admission_track
      and existing.organization_id is not distinct from rp.organization_id
  );

-- The initial rows: no grace, and no self-renewal now that the annual row owns the successor.
update public.resident_compliance_rule_packs
set grace_period_days = 0,
    renewal_interval_days = null,
    notes = 'The INITIAL evaluation only, since 20260804170000 split the annual cycle into '
      'annual_medical_evaluation. Grace stays 0: the 15-day figure both RCGs give for this citation is '
      'an annual-cycle grace, and their exclusion lists name the initial evaluation directly. '
      'renewal_interval_days is null because completing this item now creates an annual_medical_evaluation '
      'from that row rather than another copy of this one.'
where item_type = 'medical_evaluation';

-- ---------------------------------------------------------------------------
-- 5. Existing items: the earliest per resident is the initial, the rest are renewals
-- ---------------------------------------------------------------------------

with ranked as (
  select id, row_number() over (
    partition by resident_id order by due_date, created_at, id
  ) as position
  from public.resident_compliance_items
  where item_type = 'medical_evaluation'
)
update public.resident_compliance_items ci
set item_type = 'annual_medical_evaluation',
    grace_period_days = 15,
    renewal_interval_days = 365
from ranked
where ranked.id = ci.id and ranked.position > 1;

-- What is left is every resident's first medical evaluation. It loses the grace the ALF rows were
-- handing it, and stops carrying a renewal interval it no longer uses.
update public.resident_compliance_items
set grace_period_days = 0,
    renewal_interval_days = null
where item_type = 'medical_evaluation';

-- ---------------------------------------------------------------------------
-- 6. Completion creates the annual cycle from the annual row
-- ---------------------------------------------------------------------------
--
-- Redeclared from 20260729120000 (verified byte-identical to the live function before editing).
-- One block changes, marked CHANGE inline; every other line is carried forward verbatim.

CREATE OR REPLACE FUNCTION public.complete_resident_compliance_item(p_item_id uuid, p_document_id uuid)
 RETURNS resident_compliance_items
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_item public.resident_compliance_items;
  v_document public.resident_documents;
  v_completed_date date := public.pa_today();
  v_updated public.resident_compliance_items;
  v_facility_type text;
  v_support_plan_citation_ref text;
  v_annual_rule public.resident_compliance_rule_packs;
begin
  select * into v_item from public.resident_compliance_items where id = p_item_id for update;
  if v_item.id is null then
    raise exception 'resident compliance item % not found', p_item_id using errcode = 'no_data_found';
  end if;

  if not coalesce((
    public.is_platform_admin()
    or (v_item.organization_id = public.current_org_id()
        and public.current_role() in ('org_admin', 'facility_manager')
        and public.is_assigned_to_facility(v_item.facility_id))
  ), false) then
    raise exception 'not authorized to complete this resident compliance item' using errcode = 'insufficient_privilege';
  end if;

  if v_item.status = 'compliant' and v_item.completed_date is not null then
    return v_item;
  end if;

  -- The document must exist, belong to the same resident, be linked to THIS item specifically
  -- (not just any state form on file for the resident), and be flagged as the actual state form.
  -- IS DISTINCT FROM (not <>) so a document with a null compliance_item_id -- e.g. uploaded via the
  -- generic per-resident Documents uploader without picking an item -- is correctly rejected instead
  -- of silently passing through three-valued-logic NULL comparison.
  select * into v_document from public.resident_documents where id = p_document_id;
  if v_document.id is null
     or v_document.resident_id is distinct from v_item.resident_id
     or v_document.compliance_item_id is distinct from p_item_id
     or v_document.is_state_form is not true then
    raise exception 'the state-approved DHS form for this item must be uploaded and attached before it can be marked complete -- no exception'
      using errcode = 'check_violation';
  end if;

  update public.resident_compliance_items
  set completed_date = v_completed_date, status = 'compliant'
  where id = p_item_id
  returning * into v_updated;

  -- CHANGE (20260804170000): the successor's item_type and grace are no longer inherited blindly.
  -- A completed *initial* medical evaluation renews as `annual_medical_evaluation`, and takes that
  -- item type's own rule-pack row -- which is the only reason the 15-day annual grace can be
  -- applied at all without also handing it to the initial cycle. Every other item type renews as
  -- itself on its own carried values, exactly as before.
  if v_item.item_type = 'medical_evaluation' then
    select facility_type into v_facility_type from public.facilities where id = v_item.facility_id;
    select * into v_annual_rule
    from public.resident_compliance_rule_packs rp
    where rp.item_type = 'annual_medical_evaluation'
      and rp.facility_type = v_facility_type
      and rp.is_active
      and (rp.organization_id = v_item.organization_id or rp.organization_id is null)
    order by rp.organization_id nulls last
    limit 1;

    if v_annual_rule.id is not null then
      insert into public.resident_compliance_items
        (organization_id, facility_id, resident_id, item_type, due_date, renewal_interval_days, warning_days, grace_period_days)
      values
        (v_item.organization_id, v_item.facility_id, v_item.resident_id, 'annual_medical_evaluation',
         v_completed_date + v_annual_rule.renewal_interval_days, v_annual_rule.renewal_interval_days,
         v_annual_rule.warning_days, v_annual_rule.grace_period_days);
    end if;
  elsif v_item.renewal_interval_days is not null then
    insert into public.resident_compliance_items
      (organization_id, facility_id, resident_id, item_type, due_date, renewal_interval_days, warning_days, grace_period_days)
    values
      (v_item.organization_id, v_item.facility_id, v_item.resident_id, v_item.item_type,
       v_completed_date + v_item.renewal_interval_days, v_item.renewal_interval_days, v_item.warning_days, v_item.grace_period_days);
  end if;

  if v_item.item_type in ('annual_reassessment', 'significant_change_reassessment')
     and not exists (select 1 from public.resident_compliance_items where triggered_by_item_id = p_item_id) then
    select facility_type into v_facility_type from public.facilities where id = v_item.facility_id;
    v_support_plan_citation_ref := case when v_facility_type = 'ALR' then '2800.224' else '2600.227' end;

    insert into public.resident_compliance_items
      (organization_id, facility_id, resident_id, item_type, due_date, renewal_interval_days, warning_days, grace_period_days, citation_topic_id, triggered_by_item_id)
    values
      (v_item.organization_id, v_item.facility_id, v_item.resident_id, 'support_plan_30day',
       v_completed_date + 30, null, 14, 0,
       (select id from public.dhs_citation_topics where citation_ref = v_support_plan_citation_ref),
       p_item_id);
  end if;

  return v_updated;
end;
$function$;

