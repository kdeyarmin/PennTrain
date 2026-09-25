-- The ALF final support plan, its quarterly review, and a due date that is not a month early.
--
-- Read against the text of 55 Pa. Code Chapter 2800 (pacodeandbulletin.gov, Chapter 2800 as
-- published through 56 Pa.B. 4026). Three defects in how the Assisted Living Facility admission
-- cycle was modelled, and one bound that was too loose for both chapters.
--
--   1. THE ALF INITIAL ASSESSMENT WAS DUE 30 DAYS BEFORE ADMISSION. 2800.224(a)(2) requires it
--      "within 30 days prior to admission" -- a window that ENDS at admission, not a deadline 30
--      days before it. 20260706155617 seeded the standard track as `before_admission`, 30, so the
--      item fell due a month before the resident moved in and a facility that completed the ASP
--      the week before admission -- squarely inside the window -- read three weeks late. The due
--      date is the admission date; the 30-day look-back is the earliest a form may be dated, and
--      that is what the completion bound (4) now enforces.
--
--   2. THE ONLY ALF SUPPORT PLAN THE PRODUCT TRACKED WAS THE PRELIMINARY ONE. Chapter 2800 has two:
--      the preliminary support plan of 2800.224(c), on the same clock as the initial assessment,
--      and the FINAL support plan of 2800.227(a), "developed and implemented within 30 days after
--      admission" (restated by 2800.22(a)(4)). The ALF `support_plan_30day` row was a second copy
--      of the 2800.224 deadline -- 30 days before admission on the standard track, 15 after on the
--      expedited one -- and the final plan the Department surveys against had no deadline anywhere.
--      The preliminary plan shares the initial assessment's window and citation, so it stays with
--      that item; `support_plan_30day` becomes what its name says for ALF too: the plan due 30 days
--      after admission, cited to 2800.227, on both tracks. Revisions after an annual or
--      significant-change assessment are 2800.227(c) as well, not 2800.224, and are re-cited.
--
--   3. THE QUARTERLY REVIEW DID NOT EXIST. 2800.227(c): "The residence shall review each resident's
--      final support plan on a quarterly basis." Chapter 2600 has no such requirement, which is
--      why the PCH packs were right and this is ALF-only. A new item type,
--      `support_plan_quarterly_review`, 90-day cycle, created by completing an ALF support plan
--      (never at admission) and renewing itself on completion like every other cycle.
--
--   4. A COMPLETION DATE COULD PRECEDE ADMISSION BY 180 DAYS FOR EVERY ITEM. The floor existed
--      because ALF pre-admission forms legitimately predate admission, but it was one number for
--      all of them. The regulation gives each form its own look-back: 60 days for a medical
--      evaluation (2600.141(a), 2800.22(a)(1)), 30 for a preadmission screening (2600.224) and for
--      the ALF initial assessment / preliminary plan (2800.224(a)(2), (c)(1)), and none at all for
--      the ALF final support plan, which is a post-admission document. A form dated outside its
--      window does not satisfy the requirement, and accepting it recorded compliance that a
--      surveyor would not. Items the regulation gives no look-back keep the 180-day sanity bound.
--
-- Every open item this changes is re-dated from the rule packs, the same way
-- rederive_resident_compliance_due_dates does, so a tenant that overrode a pack keeps its own
-- offset. Completed items are records of what happened and are never touched.

-- ---------------------------------------------------------------------------
-- 1. The new item type
-- ---------------------------------------------------------------------------

alter table public.resident_compliance_items
  drop constraint if exists resident_compliance_items_item_type_check;
alter table public.resident_compliance_items
  add constraint resident_compliance_items_item_type_check check (item_type in (
    'preadmission_screening', 'initial_assessment_15day', 'support_plan_30day',
    'annual_reassessment', 'medical_evaluation', 'annual_medical_evaluation',
    'significant_change_reassessment', 'support_plan_quarterly_review'
  ));

alter table public.resident_compliance_rule_packs
  drop constraint if exists resident_compliance_rule_packs_item_type_check;
alter table public.resident_compliance_rule_packs
  add constraint resident_compliance_rule_packs_item_type_check check (item_type in (
    'preadmission_screening', 'initial_assessment_15day', 'support_plan_30day',
    'annual_reassessment', 'medical_evaluation', 'annual_medical_evaluation',
    'significant_change_reassessment', 'support_plan_quarterly_review'
  ));

-- ---------------------------------------------------------------------------
-- 2. A citation topic for 2800.227
-- ---------------------------------------------------------------------------
-- Unverified, like every row a migration writes (20260726200000): verification is a named person
-- recording the source through record_citation_verification(), which no migration can do.
insert into public.dhs_citation_topics (
  chapter, citation_ref, category, title, frequency_weight, notes, sort_order, source_url
)
select
  '2800', '2800.227', 'ALF Final Support Plan', 'ALF Final Support Plan & Quarterly Review', 1.2,
  '55 Pa. Code 2800.227(a): final support plan developed and implemented within 30 days after '
    || 'admission (also 2800.22(a)(4)); (b): reviewed and approved by an LPN under RN supervision; '
    || '(c): revised within 30 days of the annual assessment or a change in needs, and reviewed '
    || 'quarterly. The preliminary support plan is 2800.224(c).',
  158,
  'https://www.pacodeandbulletin.gov/Display/pacode?file=/secure/pacode/data/055/chapter2800/s2800.227.html'
where not exists (
  select 1 from public.dhs_citation_topics
  where citation_ref = '2800.227' or category = 'ALF Final Support Plan'
);

-- The 2800.224 row keeps covering the initial assessment and the preliminary plan; its note said
-- nothing about which support plan it meant, which is how the two were conflated.
update public.dhs_citation_topics
set notes = '55 Pa. Code 2800.224(a)(2) and (c)(1): the initial assessment and the preliminary '
    || 'support plan, both within 30 days PRIOR to admission (due by admission), or within 15 days '
    || 'after admission under the three conditions of 2800.224(a)(3) / (c)(2). The final support '
    || 'plan is 2800.227, a separate topic.'
where citation_ref = '2800.224';

-- Redeclared from 20260805170000. The only change: an ALF support plan -- final plan, revision or
-- quarterly review -- is 2800.227, no longer the 2800.224 initial-assessment topic.
create or replace function public.auto_tag_resident_compliance_item_citation_topic()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_facility_type text; v_category text;
begin
  if new.citation_topic_id is null then
    select facility_type into v_facility_type from public.facilities where id = new.facility_id;

    if new.item_type in ('medical_evaluation', 'annual_medical_evaluation') then
      v_category := case when v_facility_type = 'ALR' then 'ALF Medical Evaluations' else 'Resident Medical Evaluations' end;
    elsif new.item_type = 'preadmission_screening' then
      v_category := 'Resident Preadmission Screening';
    elsif new.item_type in ('support_plan_30day', 'support_plan_quarterly_review') then
      v_category := case when v_facility_type = 'ALR' then 'ALF Final Support Plan' else 'Resident Support Plans' end;
    elsif new.item_type = 'initial_assessment_15day' then
      v_category := case when v_facility_type = 'ALR' then 'ALF Initial Assessment & Support Plan' else 'Resident Assessments' end;
    else
      v_category := case when v_facility_type = 'ALR' then 'ALF Annual & Significant-Change Reassessment' else 'Resident Assessments' end;
    end if;

    select id into new.citation_topic_id from public.dhs_citation_topics where category = v_category;
  end if;
  return new;
end;
$$;

revoke all on function public.auto_tag_resident_compliance_item_citation_topic() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The ALF rule packs
-- ---------------------------------------------------------------------------
-- Platform rows only. A tenant override is the tenant's reading and is left as it is.

update public.resident_compliance_rule_packs
set offset_basis = 'before_admission',
    offset_days = 0,
    notes = '55 Pa. Code 2800.224(a)(2): initial assessment (and the preliminary support plan of '
      || '2800.224(c)(1), same window) within 30 days prior to admission -- due by the admission '
      || 'date, and not dated earlier than 30 days before it. Was offset 30 days before admission '
      || 'until 20260925110000, which made an on-time assessment read late.'
where organization_id is null
  and state = 'PA'
  and facility_type = 'ALR'
  and item_type = 'initial_assessment_15day'
  and admission_track = 'standard';

update public.resident_compliance_rule_packs
set offset_basis = 'after_admission',
    offset_days = 30,
    warning_days = 14,
    grace_period_days = 0,
    citation_ref = '2800.227',
    notes = '55 Pa. Code 2800.227(a) / 2800.22(a)(4): the FINAL support plan, developed and '
      || 'implemented within 30 days after admission on both admission tracks. Until '
      || '20260925110000 this row duplicated the 2800.224 preliminary-plan deadline.'
where organization_id is null
  and state = 'PA'
  and facility_type = 'ALR'
  and item_type = 'support_plan_30day';

insert into public.resident_compliance_rule_packs (
  organization_id, state, facility_type, item_type, admission_track,
  offset_basis, offset_days, renewal_interval_days, grace_period_days, warning_days,
  citation_ref, is_active, instantiate_at_admission, notes
)
select
  null, 'PA', 'ALR', 'support_plan_quarterly_review', t.admission_track,
  -- Nominal: instantiate_at_admission is false, so the offset is never read. The first review is
  -- created by completing the final support plan and is due 90 days after that completion.
  'after_admission', 120, 90, 0, 14,
  '2800.227', true, false,
  '55 Pa. Code 2800.227(c): "The residence shall review each resident''s final support plan on a '
    || 'quarterly basis and modify as necessary." Created by complete_resident_compliance_item when an '
    || 'ALF support plan is completed; renews every 90 days from the date of the review. Chapter 2600 '
    || 'has no quarterly review, so there is no PCH row.'
from (values ('standard'), ('expedited')) as t(admission_track)
where not exists (
  select 1 from public.resident_compliance_rule_packs rp
  where rp.item_type = 'support_plan_quarterly_review'
    and rp.facility_type = 'ALR'
    and rp.admission_track = t.admission_track
    and rp.state = 'PA'
    and rp.organization_id is null
);

-- ---------------------------------------------------------------------------
-- 4. How far before admission each form may be dated
-- ---------------------------------------------------------------------------

create or replace function public.resident_compliance_backdate_days(
  p_item_type text,
  p_facility_type text
)
returns integer
language sql
immutable
set search_path = ''
as $function$
  select case
    when p_item_type = 'medical_evaluation' then 60
    when p_item_type = 'preadmission_screening' then 30
    when p_item_type = 'initial_assessment_15day' and p_facility_type = 'ALR' then 30
    when p_item_type = 'support_plan_30day' and p_facility_type = 'ALR' then 0
    else 180
  end;
$function$;

comment on function public.resident_compliance_backdate_days(text, text) is
  'The most days before admission a completed form for this item may be dated. 60 for a medical '
  'evaluation (2600.141(a), 2800.22(a)(1)); 30 for a preadmission screening (2600.224) and the ALF '
  'initial assessment / preliminary support plan (2800.224(a)(2), (c)(1)); 0 for the ALF final '
  'support plan, a post-admission document (2800.227(a)). Everything else keeps the 180-day sanity '
  'bound. Mirrored by stateFormBackdateDays in src/lib/residentCompliance.ts.';

revoke all on function public.resident_compliance_backdate_days(text, text) from public, anon, authenticated;
grant execute on function public.resident_compliance_backdate_days(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 5. complete_resident_compliance_item
-- ---------------------------------------------------------------------------
-- Redeclared from 20260906080000, the last migration to define it (nothing since has spliced it).
-- Three changes, each marked CHANGE (20260925110000).

create or replace function public.complete_resident_compliance_item(
  p_item_id uuid,
  p_document_id uuid,
  p_completed_on date default null
)
returns public.resident_compliance_items
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_item public.resident_compliance_items;
  v_document public.resident_documents;
  v_completed_date date;
  v_updated public.resident_compliance_items;
  v_facility_type text;
  v_support_plan_citation_ref text;
  v_annual_rule public.resident_compliance_rule_packs;
  v_quarterly_rule public.resident_compliance_rule_packs;
  v_admission_track text;
  v_admission_date date;
  v_backdate_days integer;
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

  -- BACKLOG J5. The date the assessor signed the form, not the day somebody got round to
  -- uploading the scan. Everything downstream is anchored on it: `completed_date` is what the
  -- checklist prints and what get_resident_care_header.lastAssessment.completedOn shows, and every
  -- successor item this function inserts is due `completed_date + interval`.
  --
  -- Bounded on both sides. Not in the future, because a completion is a record of something that
  -- has happened. Not earlier than the regulation allows the form to predate admission.
  select r.admission_date into v_admission_date
  from public.residents r where r.id = v_item.resident_id;
  select facility_type into v_facility_type from public.facilities where id = v_item.facility_id;

  v_completed_date := coalesce(p_completed_on, public.pa_today());
  if v_completed_date > public.pa_today() then
    raise exception 'a completion date cannot be in the future' using errcode = 'check_violation';
  end if;
  -- CHANGE (20260925110000): the floor is the item's own regulatory look-back, not a flat 180 days.
  -- A medical evaluation dated 90 days before admission, or an ALF final support plan dated before
  -- the resident moved in, does not satisfy 2600.141 / 2800.22 / 2800.227, and recording it as
  -- compliant told the facility it was covered when a surveyor would cite it.
  v_backdate_days := public.resident_compliance_backdate_days(v_item.item_type, v_facility_type);
  if v_admission_date is not null and v_completed_date < v_admission_date - v_backdate_days then
    raise exception 'a form dated % is outside the window for this item: it must be dated on or after %',
      v_completed_date, v_admission_date - v_backdate_days
      using errcode = 'check_violation';
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

  select case when v_facility_type = 'ALR' then r.admission_track else 'standard' end
  into v_admission_track
  from public.residents r where r.id = v_item.resident_id;

  -- CHANGE (20260804170000): the successor's item_type and grace are no longer inherited blindly.
  -- A completed *initial* medical evaluation renews as `annual_medical_evaluation`, and takes that
  -- item type's own rule-pack row -- which is the only reason the 15-day annual grace can be
  -- applied at all without also handing it to the initial cycle. Every other item type renews as
  -- itself on its own carried values, exactly as before.
  if v_item.item_type = 'medical_evaluation' then
    -- CHANGE (20260805160000): admission_track and state, the two predicates every other
    -- rule-pack lookup in this schema uses. PCH has one track, exactly as
    -- instantiate_resident_compliance_items assumes when it substitutes 'standard'.
    select * into v_annual_rule
    from public.resident_compliance_rule_packs rp
    where rp.item_type = 'annual_medical_evaluation'
      and rp.facility_type = v_facility_type
      and rp.admission_track = coalesce(v_admission_track, 'standard')
      and rp.state = 'PA'
      and rp.is_active
      and (rp.organization_id = v_item.organization_id or rp.organization_id is null)
    -- A tenant override wins, and beyond that the newest row does: two rows on the same key are
    -- not supposed to exist, and if they ever do the answer must still not depend on the plan.
    order by rp.organization_id nulls last, rp.created_at desc, rp.id
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
    -- CHANGE (20260925110000): an ALF plan revised after a reassessment is 2800.227(c), the final
    -- support plan's own section. 2800.224 is the initial assessment and preliminary plan.
    v_support_plan_citation_ref := case when v_facility_type = 'ALR' then '2800.227' else '2600.227' end;

    insert into public.resident_compliance_items
      (organization_id, facility_id, resident_id, item_type, due_date, renewal_interval_days, warning_days, grace_period_days, citation_topic_id, triggered_by_item_id)
    values
      (v_item.organization_id, v_item.facility_id, v_item.resident_id, 'support_plan_30day',
       v_completed_date + 30, null, 14, 0,
       (select id from public.dhs_citation_topics where citation_ref = v_support_plan_citation_ref),
       p_item_id);
  end if;

  -- CHANGE (20260925110000): 2800.227(c) -- an ALF final support plan is reviewed quarterly. The
  -- first review is started by completing the plan (initial or revised). After that the review
  -- renews itself through the renewal branch above, so this only fires when no review is open:
  -- a revision mid-quarter does not stack a second review on top of the one already running.
  if v_facility_type = 'ALR'
     and v_item.item_type = 'support_plan_30day'
     and not exists (
       select 1 from public.resident_compliance_items q
       where q.resident_id = v_item.resident_id
         and q.item_type = 'support_plan_quarterly_review'
         and q.completed_date is null
     ) then
    select * into v_quarterly_rule
    from public.resident_compliance_rule_packs rp
    where rp.item_type = 'support_plan_quarterly_review'
      and rp.facility_type = 'ALR'
      and rp.admission_track = coalesce(v_admission_track, 'standard')
      and rp.state = 'PA'
      and rp.is_active
      and (rp.organization_id = v_item.organization_id or rp.organization_id is null)
    order by rp.organization_id nulls last, rp.created_at desc, rp.id
    limit 1;

    if v_quarterly_rule.id is not null then
      insert into public.resident_compliance_items
        (organization_id, facility_id, resident_id, item_type, due_date, renewal_interval_days, warning_days, grace_period_days, citation_topic_id)
      values
        (v_item.organization_id, v_item.facility_id, v_item.resident_id, 'support_plan_quarterly_review',
         v_completed_date + v_quarterly_rule.renewal_interval_days, v_quarterly_rule.renewal_interval_days,
         v_quarterly_rule.warning_days, v_quarterly_rule.grace_period_days,
         (select id from public.dhs_citation_topics where citation_ref = v_quarterly_rule.citation_ref));
    end if;
  end if;

  return v_updated;
end;
$function$;

comment on function public.complete_resident_compliance_item(uuid, uuid, date) is
  'Marks a resident compliance item complete against its uploaded state form. p_completed_on is '
  'the date on the form -- when the assessor signed it -- defaulting to today, not in the future, '
  'and not earlier than resident_compliance_backdate_days allows before admission. Every successor '
  'this function inserts is anchored on it (BACKLOG J5). Completing an ALF support plan starts the '
  '2800.227(c) quarterly review when none is open.';

revoke all on function public.complete_resident_compliance_item(uuid, uuid, date)
  from public, anon, authenticated;
grant execute on function public.complete_resident_compliance_item(uuid, uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Open items re-dated and re-cited
-- ---------------------------------------------------------------------------
-- Only items still open and still on their first cycle, chosen with the same rule selection as
-- rederive_resident_compliance_due_dates: one rule per resident and item type, a tenant's own pack
-- ahead of the platform one.
with target as (
  select i.id,
         case when rp.offset_basis = 'before_admission'
           then r.admission_date - rp.offset_days
           else r.admission_date + rp.offset_days
         end as due_date
  from public.resident_compliance_items i
  join public.residents r on r.id = i.resident_id
  join public.facilities f on f.id = r.facility_id
  cross join lateral (
    select p.offset_basis, p.offset_days
    from public.resident_compliance_rule_packs p
    where p.facility_type = f.facility_type
      and p.item_type = i.item_type
      and p.admission_track = coalesce(r.admission_track, 'standard')
      and p.state = 'PA'
      and p.is_active
      and p.instantiate_at_admission
      and (p.organization_id = r.organization_id or p.organization_id is null)
    order by p.organization_id nulls last, p.created_at desc, p.id
    limit 1
  ) rp
  where f.facility_type = 'ALR'
    and i.item_type in ('initial_assessment_15day', 'support_plan_30day')
    and i.completed_date is null
    and i.triggered_by_item_id is null
    and r.admission_date is not null
)
update public.resident_compliance_items i
set due_date = t.due_date
from target t
where i.id = t.id
  and i.due_date is distinct from t.due_date;

-- An ALF support plan that is still open, or one spawned by a reassessment, is a 2800.227 plan.
-- A COMPLETED first-cycle item was recorded against the 2800.224 preliminary-plan deadline it was
-- created under, and keeps that citation: re-citing it would rewrite what the record said.
update public.resident_compliance_items i
set citation_topic_id = (select id from public.dhs_citation_topics where citation_ref = '2800.227')
from public.facilities f
where f.id = i.facility_id
  and f.facility_type = 'ALR'
  and i.item_type = 'support_plan_30day'
  and (i.completed_date is null or i.triggered_by_item_id is not null);

-- Residents already past their support plan have no quarterly review running, and would get none
-- until their next annual reassessment revised the plan. Start one for every current ALF resident
-- whose support plan is on file, due 90 days after the most recent one. If that date has passed,
-- the item reads overdue, which is the truth: 2800.227(c) required a review and none is recorded.
insert into public.resident_compliance_items
  (organization_id, facility_id, resident_id, item_type, due_date, renewal_interval_days,
   warning_days, grace_period_days, citation_topic_id)
select
  latest.organization_id, latest.facility_id, latest.resident_id, 'support_plan_quarterly_review',
  latest.completed_date + rule.renewal_interval_days, rule.renewal_interval_days,
  rule.warning_days, rule.grace_period_days,
  (select id from public.dhs_citation_topics where citation_ref = rule.citation_ref)
from (
  select distinct on (i.resident_id)
         i.organization_id, i.facility_id, i.resident_id, i.completed_date,
         coalesce(r.admission_track, 'standard') as admission_track
  from public.resident_compliance_items i
  join public.residents r on r.id = i.resident_id
  join public.facilities f on f.id = i.facility_id
  where f.facility_type = 'ALR'
    and i.item_type = 'support_plan_30day'
    and i.completed_date is not null
    and r.status in ('active', 'temporarily_out')
  order by i.resident_id, i.completed_date desc
) latest
cross join lateral (
  select p.renewal_interval_days, p.warning_days, p.grace_period_days, p.citation_ref
  from public.resident_compliance_rule_packs p
  where p.item_type = 'support_plan_quarterly_review'
    and p.facility_type = 'ALR'
    and p.admission_track = latest.admission_track
    and p.state = 'PA'
    and p.is_active
    and (p.organization_id = latest.organization_id or p.organization_id is null)
  order by p.organization_id nulls last, p.created_at desc, p.id
  limit 1
) rule
where not exists (
  select 1 from public.resident_compliance_items q
  where q.resident_id = latest.resident_id
    and q.item_type = 'support_plan_quarterly_review'
    and q.completed_date is null
);

select public.recalculate_resident_compliance_statuses();

-- The trigger must still find every category it asks for.
do $$
declare v_missing text;
begin
  select wanted into v_missing
  from unnest(array[
    'ALF Medical Evaluations', 'Resident Medical Evaluations', 'Resident Preadmission Screening',
    'ALF Final Support Plan', 'Resident Support Plans', 'ALF Initial Assessment & Support Plan',
    'Resident Assessments', 'ALF Annual & Significant-Change Reassessment'
  ]) as wanted
  where not exists (select 1 from public.dhs_citation_topics t where t.category = wanted)
  limit 1;
  if v_missing is not null then
    raise exception 'auto_tag_resident_compliance_item_citation_topic asks for a category that does not exist: %', v_missing;
  end if;
  if (select count(*) from public.dhs_citation_topics where citation_ref = '2800.227') <> 1 then
    raise exception 'complete_resident_compliance_item needs exactly one citation topic for 2800.227';
  end if;
end;
$$;
